const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const Users = require("../models/user");
const PasswordResetToken = require("../models/passwordResetToken");
const logger = require("../configs/logger");
const Properties = require("../models/property");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function normalizeResetCode(value) {
  const normalized = String(value ?? "").replace(/\s+/g, "").replace(/\D/g, "");

  if (!normalized || normalized.length !== 6) {
    throw new Error("Reset code must be 6 digits.");
  }

  return normalized;
}

function buildPasswordResetEmailHtml(code) {
  const appName = process.env.APP_NAME || "Estate App";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f6f8fb; padding: 24px; color: #101828;">
      <div style="background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #e5e7eb;">
        <div style="padding: 24px 32px 12px; background: linear-gradient(135deg, #0f172a, #2563eb); color: #ffffff;">
          <h2 style="margin: 0; font-size: 24px;">Reset your password</h2>
        </div>
        <div style="padding: 32px;">
          <p style="font-size: 16px; margin: 0 0 12px;">Hi there,</p>
          <p style="font-size: 15px; line-height: 1.6; color: #475467; margin: 0 0 24px;">
            We received a request to reset the password for your ${appName} account. Use the 6-digit code below to continue.
          </p>
          <div style="text-align: center; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 14px; padding: 24px 16px; margin-bottom: 24px;">
            <div style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #1d4ed8; font-weight: 700; margin-bottom: 10px;">Your OTP</div>
            <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #111827;">${code}</div>
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #667085; margin: 0 0 12px;">
            This code expires in 10 minutes. If you did not request a password reset, you can safely ignore this email.
          </p>
        </div>
        <div style="padding: 0 32px 24px; color: #667085; font-size: 12px;">
          © ${new Date().getFullYear()} ${appName}
        </div>
      </div>
    </div>
  `;
}

async function sendPasswordResetOtpEmail(email, code) {
  const appName = process.env.APP_NAME || "Estate App";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@example.com";

  if (!resend) {
    console.log(`Development OTP for ${email}: ${code}`);
    return;
  }

  await resend.emails.send({
    from: `"${appName}" <${supportEmail}>`,
    to: [email],
    subject: "Your password reset code",
    html: buildPasswordResetEmailHtml(code),
  });
}

async function verifyResetCodeForUser(email, code, record) {
  if (!record) {
    return false;
  }

  if (record.expiresAt < new Date()) {
    return false;
  }

  const normalizedCode = normalizeResetCode(code);
  return bcrypt.compare(normalizedCode, record.codeHash);
}

exports.normalizeResetCode = normalizeResetCode;
exports.buildPasswordResetEmailHtml = buildPasswordResetEmailHtml;

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await Users.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account matches this email, a reset code has been sent.",
      });
    }

    await PasswordResetToken.deleteMany({ userId: user._id });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await PasswordResetToken.create({
      userId: user._id,
      email: user.email,
      codeHash,
      expiresAt,
    });

    await sendPasswordResetOtpEmail(user.email, code);

    return res.status(200).json({
      success: true,
      message: "A password reset code has been sent to your email.",
    });
  } catch (error) {
    logger.error("Password reset request failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send a password reset code right now.",
    });
  }
};

exports.verifyPasswordResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const latestToken = await PasswordResetToken.findOne({
      email: normalizedEmail,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const isValid = await verifyResetCodeForUser(normalizedEmail, code, latestToken);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "The code is incorrect or has expired.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Code verified successfully.",
    });
  } catch (error) {
    logger.error("Password reset verification failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify the reset code.",
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res.status(400).json({ message: "Email, code, and new password are required." });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const latestToken = await PasswordResetToken.findOne({
      email: normalizedEmail,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const isValid = await verifyResetCodeForUser(normalizedEmail, code, latestToken);

    if (!isValid || !latestToken) {
      return res.status(400).json({
        success: false,
        message: "The code is incorrect or has expired.",
      });
    }

    const user = await Users.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    user.password = await bcrypt.hash(String(password), 10);
    await user.save();

    latestToken.usedAt = new Date();
    await latestToken.save();

    await PasswordResetToken.deleteMany({ userId: user._id, _id: { $ne: latestToken._id } });

    return res.status(200).json({
      success: true,
      message: "Password reset successful.",
    });
  } catch (error) {
    logger.error("Password reset failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to reset the password right now.",
    });
  }
};

exports.registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      gender,
      nin,
      dob,
      phone,
      coordinates,
    } = req.body;
    const accountRole = role || "user";

    if (!firstName || !lastName || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!["user", "landlord", "propertyManager"].includes(accountRole)) {
      return res.status(400).json({ message: "Invalid account type" });
    }

    const existingUser = await Users.findOne({
      email,
      nin,
      phoneNumber: phone,
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Account with similar details already exists!" });
    }

    let newUser = null;

    newUser = new Users({
      firstName,
      lastName,
      email,
      password: await bcrypt.hash(password.toString(), 10),
      role: accountRole,
      nin,
      dob,
      gender,
      phoneNumber: phone,
      coordinates: coordinates
        ? { long: coordinates.long, lat: coordinates.lat }
        : { long: null, lat: null },
      isLoggedIn: true,
      saved: [],
      messages: [],
      properties: [],
      subscription: [],
      avatar: { url: null, publicId: null },
    });
    await newUser.save();

    const token = jwt.sign(
      { userId: newUser._id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    const userData = {
      id: newUser._id,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      email: newUser.email,
      role: newUser.role,
      nin: newUser.nin,
      dob: newUser.dob,
      gender: newUser.gender,
      phoneNumber: phone,
      coordinates: newUser.coordinates,
      avatar: newUser.avatar,
      bio: newUser.bio,
      publicContact: newUser.publicContact,
    };
    res.status(201).json({
      message: "User registered successfully",
      success: true,
      user: userData,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.error("Error in registerUser:", error);
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Identifier and password are required" });
    }

    console.log("Login request received with identifier:", req.body);
    const user = await Users.findOne({
      $or: [{ email: identifier }, { phoneNumber: identifier }],
    }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const stringPassword = password.toString();

    const isMatch = await bcrypt.compare(stringPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    const userData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      nin: user.nin,
      dob: user.dob,
      gender: user.gender,
      phoneNumber: user.phoneNumber,
      coordinates: user.coordinates,
      saved: user.saved,
      messages: user.messages,
      avatar: user.avatar,
      bio: user.bio,
      publicContact: user.publicContact,
    };
    res.status(200).json({
      message: "Login successful",
      success: true,
      token,
      user: userData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.error("Error in loginUser:", error);
  }
};

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Users = require("../models/user");
const logger = require("../configs/logger");
const Properties = require("../models/property");

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

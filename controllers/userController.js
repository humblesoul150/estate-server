const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Users = require("../models/user");
const Properties = require("../models/property");
const Messages = require("../models/message");
const Conversations = require("../models/converation");
const cloudinary = require("../configs/cloudinary");

const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    stream.end(buffer);
  });

const deleteCloudinaryImage = async (publicId) => {
  if (!publicId) {
    return;
  }

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
  } catch (error) {
    console.error("Cloudinary avatar cleanup error:", error.message);
  }
};

const toSafeUser = (user) => {
  const result = user.toObject();
  result.id = String(result._id);
  result.username = result.email;
  delete result._id;
  delete result.__v;
  delete result.password;
  return result;
};

exports.updateAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Avatar image is required" });
  }

  try {
    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const previousPublicId = user.avatar?.publicId;
    const uploadResult = await uploadBuffer(req.file.buffer, {
      folder: "estate-app/profile-images",
      resource_type: "image",
    });

    try {
      user.avatar = {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      };
      await user.save();
    } catch (error) {
      await deleteCloudinaryImage(uploadResult.public_id);
      throw error;
    }

    await deleteCloudinaryImage(previousPublicId);

    return res.status(200).json({
      success: true,
      user: user.toObject(),
    });
  } catch (error) {
    console.error("Avatar upload error:", error.message);
    return res.status(500).json({ message: "Unable to upload avatar" });
  }
};

exports.updateProfile = async (req, res) => {
  const allowedFields = [
    "firstName",
    "lastName",
    "email",
    "dob",
    "gender",
    "nin",
    "phoneNumber",
  ];
  const updates = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] =
        typeof req.body[field] === "string" ? req.body[field].trim() : "";
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "bio")) {
      if (typeof req.body.bio !== "string") {
        return res.status(400).json({ message: "Bio must be text" });
      }
      updates.bio = req.body.bio.trim();
      if (updates.bio.length > 280) {
        return res
          .status(400)
          .json({ message: "Bio must be 280 characters or less" });
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "publicContact")) {
      const publicContact = req.body.publicContact;
      const allowedContactFields = ["showPhone", "showEmail"];
      if (
        !publicContact ||
        typeof publicContact !== "object" ||
        Array.isArray(publicContact) ||
        Object.keys(publicContact).some(
          (field) => !allowedContactFields.includes(field),
        ) ||
        Object.values(publicContact).some((value) => typeof value !== "boolean")
      ) {
        return res
          .status(400)
          .json({ message: "Invalid public contact settings" });
      }
      updates.publicContact = publicContact;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: "No profile fields provided" });
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, "nin") &&
    !["admin", "landlord", "propertyManager"].includes(req.user.role)
  ) {
    return res
      .status(403)
      .json({ message: "Only admin accounts can update NIN" });
  }

  if (
    updates.gender !== undefined &&
    !["male", "female", "other"].includes(updates.gender.toLowerCase())
  ) {
    return res.status(400).json({ message: "Invalid gender" });
  }

  if (updates.gender !== undefined) {
    updates.gender = updates.gender.toLowerCase();
  }

  if (updates.email !== undefined) {
    updates.email = updates.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
      return res
        .status(400)
        .json({ message: "A valid email address is required" });
    }
  }

  if (
    (updates.firstName !== undefined && !updates.firstName) ||
    (updates.lastName !== undefined && !updates.lastName) ||
    (updates.phoneNumber !== undefined && !updates.phoneNumber)
  ) {
    return res
      .status(400)
      .json({ message: "Name and phone fields cannot be empty" });
  }

  try {
    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      (updates.bio !== undefined || updates.publicContact !== undefined) &&
      !["landlord", "propertyManager"].includes(user.role)
    ) {
      return res.status(403).json({
        message:
          "Only landlords and property managers can edit public profiles",
      });
    }

    if (
      updates.email &&
      (await Users.exists({
        email: {
          $regex: `^${updates.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
        _id: { $ne: user._id },
      }))
    ) {
      return res.status(409).json({ message: "Email is already in use" });
    }

    if (updates.nin === "") {
      user.nin = undefined;
      delete updates.nin;
    }
    if (updates.publicContact) {
      user.publicContact = {
        showPhone:
          updates.publicContact.showPhone ??
          user.publicContact?.showPhone ??
          false,
        showEmail:
          updates.publicContact.showEmail ??
          user.publicContact?.showEmail ??
          false,
      };
      delete updates.publicContact;
    }
    Object.assign(user, updates);
    await user.save();
    return res.status(200).json({ success: true, user: toSafeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "Phone or NIN is already in use" });
    }
    console.error("Profile update error:", error.message);
    return res.status(500).json({ message: "Unable to update profile" });
  }
};

exports.getPublicProfile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(404).json({ message: "Lister profile not found" });
    }

    const user = await Users.findById(req.params.userId).select(
      "firstName lastName email phoneNumber role avatar bio publicContact createdAt",
    );
    if (!user || !["landlord", "propertyManager"].includes(user.role)) {
      return res.status(404).json({ message: "Lister profile not found" });
    }

    const profile = {
      id: String(user._id),
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatar: { url: user.avatar?.url },
      bio: user.bio || "",
      createdAt: user.createdAt,
    };
    if (user.publicContact?.showPhone && user.phoneNumber) {
      profile.phoneNumber = user.phoneNumber;
    }
    if (user.publicContact?.showEmail && user.email) {
      profile.email = user.email;
    }

    return res.status(200).json({ user: profile });
  } catch (error) {
    console.error("Public lister profile lookup failed:", error.message);
    return res.status(500).json({ message: "Unable to load lister profile" });
  }
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Current and new passwords are required" });
  }
  if (String(newPassword).length < 8) {
    return res
      .status(400)
      .json({ message: "New password must be at least 8 characters" });
  }

  try {
    const user = await Users.findById(req.user.userId).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!(await bcrypt.compare(String(currentPassword), user.password))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(String(newPassword), 10);
    await user.save();
    return res.status(200).json({ success: true, message: "Password updated" });
  } catch (error) {
    console.error("Password change error:", error.message);
    return res.status(500).json({ message: "Unable to update password" });
  }
};

exports.deleteAccount = async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res
      .status(400)
      .json({ message: "Password confirmation is required" });
  }

  const session = await mongoose.startSession();
  let avatarPublicId;
  let attachmentPublicIds = [];

  try {
    await session.withTransaction(async () => {
      const user = await Users.findById(req.user.userId)
        .select("+password")
        .session(session);
      if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }
      if (!(await bcrypt.compare(String(password), user.password))) {
        const error = new Error("Password is incorrect");
        error.statusCode = 400;
        throw error;
      }

      avatarPublicId = user.avatar?.publicId;
      const relatedMessages = await Messages.find({
        $or: [{ sender: user._id }, { receiver: user._id }],
      })
        .select("attachment.publicId")
        .session(session);
      attachmentPublicIds = relatedMessages
        .map((message) => message.attachment?.publicId)
        .filter(Boolean);

      await Properties.updateMany(
        { owner: user._id },
        {
          $set: {
            owner: null,
            isArchived: true,
            archivedAt: new Date(),
          },
        },
        { session },
      );

      await Messages.updateMany(
        { $or: [{ sender: user._id }, { receiver: user._id }] },
        {
          $set: {
            text: "",
            deleted: true,
            "attachment.url": null,
            "attachment.publicId": null,
            "attachment.fileName": null,
            "attachment.fileSize": null,
          },
        },
        { session },
      );

      await Conversations.updateMany(
        { participants: user._id },
        { $pull: { participants: user._id } },
        { session },
      );
      await Users.deleteOne({ _id: user._id }, { session });
    });

    await Promise.allSettled(
      [avatarPublicId, ...attachmentPublicIds]
        .filter(Boolean)
        .map((publicId) => deleteCloudinaryImage(publicId)),
    );
    return res.status(200).json({ success: true, message: "Account deleted" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Account deletion error:", error.message);
    return res.status(500).json({ message: "Unable to delete account" });
  } finally {
    await session.endSession();
  }
};

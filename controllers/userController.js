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
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
    if (result?.result !== "ok" && result?.result !== "not found") {
      console.error("Cloudinary avatar cleanup returned an unexpected result:", result);
    }
  } catch (error) {
    console.error("Cloudinary avatar cleanup error:", error.message);
  }
};

const toggleSavedPropertyIds = (savedPropertyIds = [], propertyId) => {
  const normalized = (savedPropertyIds || []).map((id) => String(id));
  const targetId = String(propertyId);

  if (normalized.includes(targetId)) {
    return normalized.filter((id) => id !== targetId);
  }

  return [...normalized, targetId];
};

const normalizeSearchHistoryEntry = (entry = {}) => {
  const query = String(entry.query ?? "").trim().replace(/\s+/g, " ");
  if (!query) {
    return null;
  }

  const purpose = typeof entry.purpose === "string" ? entry.purpose.trim() : "";
  const category = typeof entry.category === "string" ? entry.category.trim() : "";
  const now = new Date();

  return {
    id: new mongoose.Types.ObjectId().toString(),
    query,
    purpose: purpose || undefined,
    category: category || undefined,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
};

const pruneExpiredSearchHistory = (entries = [], now = Date.now()) => {
  return (entries || []).filter((entry) => {
    if (!entry) {
      return false;
    }

    const expiresAt = entry.expiresAt
      ? new Date(entry.expiresAt).getTime()
      : new Date(entry.createdAt ?? now).getTime() + 3 * 24 * 60 * 60 * 1000;

    return expiresAt > now;
  });
};

const limitSearchHistory = (entries = [], maxEntries = 5) => {
  return [...(entries || [])]
    .filter(Boolean)
    .sort(
      (first, second) =>
        new Date(second.createdAt ?? 0).getTime() -
        new Date(first.createdAt ?? 0).getTime(),
    )
    .slice(0, maxEntries);
};

exports.toggleSavedPropertyIds = toggleSavedPropertyIds;
exports.normalizeSearchHistoryEntry = normalizeSearchHistoryEntry;
exports.pruneExpiredSearchHistory = pruneExpiredSearchHistory;
exports.limitSearchHistory = limitSearchHistory;

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

exports.removeAvatar = async (req, res) => {
  try {
    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const previousPublicId = user.avatar?.publicId;
    user.avatar = { url: null, publicId: null };
    await user.save();

    await deleteCloudinaryImage(previousPublicId);

    return res.status(200).json({
      success: true,
      message: "Profile photo removed",
      user: user.toObject(),
    });
  } catch (error) {
    console.error("Avatar removal error:", error.message);
    return res.status(500).json({ message: "Unable to remove profile photo" });
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

exports.getSavedProperties = async (req, res) => {
  try {
    const user = await Users.findById(req.user.userId).populate("saved");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const savedPropertyIds = user.saved.map((property) => String(property._id));
    return res.status(200).json({
      success: true,
      savedPropertyIds,
      savedCount: savedPropertyIds.length,
      properties: user.saved,
    });
  } catch (error) {
    console.error("Error fetching saved properties:", error.message);
    return res.status(500).json({ message: "Unable to load saved properties" });
  }
};

exports.getSearchHistory = async (req, res) => {
  try {
    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const nextHistory = limitSearchHistory(
      pruneExpiredSearchHistory(user.searchHistory || []),
      5,
    );

    if (JSON.stringify(nextHistory) !== JSON.stringify(user.searchHistory || [])) {
      user.searchHistory = nextHistory;
      await user.save();
    }

    return res.status(200).json({ success: true, history: nextHistory });
  } catch (error) {
    console.error("Error fetching search history:", error.message);
    return res.status(500).json({ message: "Unable to load search history" });
  }
};

exports.addSearchHistory = async (req, res) => {
  try {
    const normalizedEntry = normalizeSearchHistoryEntry(req.body);
    if (!normalizedEntry) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const existingHistory = pruneExpiredSearchHistory(user.searchHistory || []);
    const dedupedHistory = existingHistory.filter((entry) => {
      const sameQuery =
        String(entry.query ?? "").toLowerCase() !==
        normalizedEntry.query.toLowerCase();
      const samePurpose =
        (entry.purpose ?? "") !== (normalizedEntry.purpose ?? "");
      const sameCategory =
        (entry.category ?? "") !== (normalizedEntry.category ?? "");
      return sameQuery || samePurpose || sameCategory;
    });

    const nextHistory = limitSearchHistory(
      [normalizedEntry, ...dedupedHistory],
      5,
    );

    user.searchHistory = nextHistory;
    await user.save();

    return res.status(200).json({ success: true, history: nextHistory });
  } catch (error) {
    console.error("Error saving search history:", error.message);
    return res.status(500).json({ message: "Unable to save search history" });
  }
};

exports.clearSearchHistory = async (req, res) => {
  try {
    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.searchHistory = [];
    await user.save();

    return res.status(200).json({ success: true, history: [] });
  } catch (error) {
    console.error("Error clearing search history:", error.message);
    return res.status(500).json({ message: "Unable to clear search history" });
  }
};

exports.toggleSavedProperty = async (req, res) => {
  try {
    const propertyId = req.params.propertyId;

    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return res.status(400).json({ message: "Invalid property id" });
    }

    const property = await Properties.findById(propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    const user = await Users.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const savedIds = user.saved.map((id) => String(id));
    const isSaved = savedIds.includes(propertyId);
    const nextSavedIds = toggleSavedPropertyIds(savedIds, propertyId);

    user.saved = nextSavedIds.map((id) => new mongoose.Types.ObjectId(id));
    await user.save();

    return res.status(200).json({
      success: true,
      saved: !isSaved,
      savedPropertyIds: user.saved.map((id) => String(id)),
      savedCount: user.saved.length,
    });
  } catch (error) {
    console.error("Error toggling saved property:", error.message);
    return res.status(500).json({ message: "Unable to update saved property" });
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
      averageRating: Number(user.averageRating ?? 0),
      totalReviews: Number(user.totalReviews ?? 0),
      ratingCount: Number(user.ratingCount ?? 0),
      lastReviewedAt: user.lastReviewedAt || null,
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

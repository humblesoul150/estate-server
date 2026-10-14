const mongoose = require("mongoose");

const publicContactSchema = new mongoose.Schema(
  {
    showPhone: { type: Boolean, default: false },
    showEmail: { type: Boolean, default: false },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String },
    lastName: { type: String },
    avatar: { url: { type: String }, publicId: { type: String } },
    email: { type: String },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["admin", "user", "landlord", "propertyManager"],
      default: "user",
    },
    saved: [{ type: mongoose.Schema.Types.ObjectId, ref: "Property" }],
    searchHistory: [
      {
        id: { type: String },
        query: { type: String, trim: true },
        purpose: { type: String, trim: true },
        category: { type: String, trim: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, default: Date.now },
      },
    ],
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
    properties: [{ type: mongoose.Schema.Types.ObjectId, ref: "Property" }],
    subscription: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    ],
    nin: { type: String, unique: true },
    dob: { type: String },
    gender: { type: String, enum: ["male", "female", "other"] },
    phoneNumber: { type: String, unique: true, sparse: true, required: true },
    bio: { type: String, trim: true, maxlength: 280, default: "" },
    publicContact: { type: publicContactSchema, default: () => ({}) },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 },
    lastReviewedAt: { type: Date, default: null },

    coordinates: {
      long: { type: Number },
      lat: { type: Number },
    },
    isLoggedIn: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", UserSchema);

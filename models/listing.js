const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    purpose: { type: String, enum: ["rent", "sale"], required: true },
    billingPeriod: {
      type: String,
      enum: ["weekly", "monthly", "yearly", "one-time"],
    },
    status: {
      type: String,
      enum: ["draft", "published", "paused", "closed"],
      default: "draft",
      index: true,
    },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, trim: true, uppercase: true },
    serviceFee: { type: Number, min: 0 },
    negotiable: { type: Boolean, default: false },
    availableFrom: { type: String, trim: true },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

listingSchema.index({ propertyId: 1, purpose: 1, status: 1 });

module.exports =
  mongoose.models.Listing || mongoose.model("Listing", listingSchema);

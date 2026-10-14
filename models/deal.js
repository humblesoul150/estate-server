const mongoose = require("mongoose");

const dealSchema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    discount: {
      type: {
        type: String,
        enum: ["percentage", "fixed"],
        required: true,
      },
      value: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    pricingSnapshot: {
      basePrice: {
        type: Number,
        required: true,
        min: 0,
      },
      dealPrice: {
        type: Number,
        required: true,
        min: 0,
      },
      currency: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },
      billingPeriod: {
        type: String,
        enum: ["weekly", "monthly", "yearly", "one-time"],
      },
    },
    status: {
      type: String,
      enum: ["draft", "published", "paused", "removed"],
      default: "draft",
      index: true,
    },
    startsAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    endsAt: {
      type: Date,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    publishedAt: {
      type: Date,
    },
    removedAt: {
      type: Date,
    },
    removedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    removalReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

dealSchema.index({ listingId: 1, status: 1 });
dealSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.models.Deal || mongoose.model("Deal", dealSchema);

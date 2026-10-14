const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
    category: { type: String, trim: true },
    estate: { type: String, trim: true },
    price_per_unit: { type: Number, min: 0 },
    propertyType: { type: String, trim: true },
    description: { type: String, trim: true },
    location: { lat: Number, lng: Number },
    policies: {
      pets: { allowed: Boolean, details: String },
      parking: { allowed: Boolean, details: String },
      lease: String,
      other: [{ title: String, body: String }],
    },
    images: [
      {
        title: { type: String },
        url: { type: String },
        publicId: { type: String },
      },
    ],
    features: [{ type: String }],
    specifications: [
      {
        title: { type: String },
        value: { type: String },
        default: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    serviceFee: { type: Number, min: 0 },
    units_available: { type: Number },
    customizeUnits: { type: Boolean },
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    moderationReason: { type: String, trim: true },
    units: [
      {
        unitNumber: String,
        rent: Number,
        unitType: String,
        description: { type: String, trim: true },
        price: Number,
        currency: String,
        billingPeriod: {
          type: String,
          enum: ["weekly", "monthly", "yearly", "one-time"],
        },
        isAvailable: Boolean,
        specifications: [
          {
            title: { type: String },
            value: { type: String },
            default: { type: mongoose.Schema.Types.Mixed },
          },
        ],
        images: [
          {
            title: { type: String },
            url: { type: String },
            publicId: { type: String },
          },
        ],
      },
    ],
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

propertySchema.virtual("listings", {
  ref: "Listing",
  localField: "_id",
  foreignField: "propertyId",
});

propertySchema.index({ moderationStatus: 1, createdAt: -1 });

module.exports =
  mongoose.models.Property || mongoose.model("Property", propertySchema);

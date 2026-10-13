const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    name: { type: String },
    address: { type: String },
    city: { type: String },
    country: { type: String },
    category: { type: String },
    estate: { type: String },
    price_per_unit: { type: String },
    propertyType: { type: String },
    description: { type: String },
    location: { lat: Number, lng: Number },
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
        defaulut: { type: Null },
      },
    ],
    serviceFee: { type: Number },
    units_available: { type: Number },
    customizeUnits: { type: Boolean },
    units: [
      {
        unitNumber: String,
        rent: Number,
        unitType: String,
        description: { type: String, trim: true },
        price: Number,
        currency: String,
        billingPeriod: { enum: ["weekly" | "monthly" | "yearly" | "one-time"] },
        isAvailable: Boolean,
        specifications: [
          {
            title: { type: String },
            value: { type: String },
            defaulut: { type: Null },
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
    listings: { type: mongoose.Schema.Types.ObjectId, ref: "Listings" },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.Property || mongoose.model("Property", propertySchema);

const mongoose = require("mongoose");

const ListingSchema = new mongoose.Schema({
  propertyId: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
  purpose: { type: String, enum: ["rent", "sale"] },
  billingPeriod: {
    type: String,
    enum: ["weekly", "monthly", "yearly", "one-time"],
  },
  status: { type: String, enum: ["draft", "published", "paused", "closed"] },
  price: Number,
  currency: String,
  serviceFee: String,
  negotiable: Boolean,
  availableFrom: String,
  publishedAt: Date,
});
module.export = mongoose.model("Listing", ListingSchema);

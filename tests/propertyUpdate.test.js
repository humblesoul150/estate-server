const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const { updateMarketplaceProperty } = require("../controllers/propertyController");
const Property = require("../models/property");
const Listing = require("../models/listing");

const response = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("marketplace update persists full profile fields and clears a nullable service fee", async () => {
  const originals = {
    findPropertyById: Property.findById,
    findListing: Listing.findOne,
    updateListing: Listing.findOneAndUpdate,
  };
  const propertyId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const property = {
    _id: propertyId,
    name: "Old name",
    images: [],
    units: [],
    save: async () => {},
    toJSON() {
      return {
        _id: this._id,
        name: this.name,
        images: this.images,
        units: this.units,
        policies: this.policies,
        specifications: this.specifications,
        listings: [{ _id: listingId, serviceFee: null }],
      };
    },
  };
  let propertyLookupCount = 0;
  let listingUpdate;
  Property.findById = () => {
    propertyLookupCount += 1;
    return propertyLookupCount === 1
      ? Promise.resolve(property)
      : { populate: async () => property };
  };
  Listing.findOne = async () => ({ _id: listingId });
  Listing.findOneAndUpdate = async (_filter, update) => {
    listingUpdate = update;
    return { _id: listingId, ...update.$set };
  };

  try {
    const res = response();
    await updateMarketplaceProperty(
      {
        params: { propertyId: propertyId.toString() },
        files: [],
        body: {
          payload: JSON.stringify({
            listingId: listingId.toString(),
            listing: {
              purpose: "rent",
              price: 250000,
              currency: "UGX",
              billingPeriod: "monthly",
              serviceFee: null,
              negotiable: true,
              availableFrom: null,
            },
            name: "Updated name",
            address: "New address",
            city: "Kampala",
            country: "Uganda",
            category: "residential",
            estate: "Central",
            propertyType: "apartment",
            description: "Updated description",
            location: { lat: 0.3, lng: 32.6 },
            images: [{ title: "Main", url: "https://images.example/main.jpg" }],
            features: ["Balcony"],
            specifications: [{ title: "Bedrooms", value: "3" }],
            policies: {
              pets: { allowed: true, details: "Small pets" },
              parking: { allowed: true, details: "One space" },
              lease: "12 months",
              other: [{ title: "Quiet hours", body: "After 10 PM" }],
            },
            units: [
              {
                unitNumber: "A1",
                unitType: "Apartment",
                isAvailable: true,
                images: [{ title: "Unit", url: "https://images.example/unit.jpg" }],
              },
            ],
          }),
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(property.name, "Updated name");
    assert.equal(property.address, "New address");
    assert.equal(property.location.lng, 32.6);
    assert.equal(property.images[0].url, "https://images.example/main.jpg");
    assert.equal(property.specifications[0].value, "3");
    assert.equal(property.policies.other[0].title, "Quiet hours");
    assert.equal(property.units[0].images[0].url, "https://images.example/unit.jpg");
    assert.equal(property.units_available, 1);
    assert.equal(property.serviceFee, null);
    assert.equal(listingUpdate.$set.serviceFee, null);
  } finally {
    Property.findById = originals.findPropertyById;
    Listing.findOne = originals.findListing;
    Listing.findOneAndUpdate = originals.updateListing;
  }
});

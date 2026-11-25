const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const {
  getMarketplacePropertiesForReview,
  moderateMarketplaceProperty,
} = require("../controllers/propertyController");
const Listing = require("../models/listing");
const Property = require("../models/property");

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

test("property management returns only the authenticated user's properties", async () => {
  const originalFind = Property.find;
  const ownerId = new mongoose.Types.ObjectId().toString();
  const serializedProperty = {
    id: new mongoose.Types.ObjectId().toString(),
    isArchived: true,
  };
  const ownedProperty = { toJSON: () => serializedProperty };
  let filter;
  const query = {
    populate() {
      return this;
    },
    sort: async () => [ownedProperty],
  };
  Property.find = (queryFilter) => {
    filter = queryFilter;
    return query;
  };

  try {
    const res = response();
    await getMarketplacePropertiesForReview(
      { user: { userId: ownerId } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(filter, { ownerId });
    assert.deepEqual(res.body.properties, [serializedProperty]);
  } finally {
    Property.find = originalFind;
  }
});

test("platform admins can review all marketplace properties", async () => {
  const originalFind = Property.find;
  const property = { toJSON: () => ({ id: "submitted-property" }) };
  let filter;
  const query = {
    populate() {
      return this;
    },
    sort: async () => [property],
  };
  Property.find = (queryFilter) => {
    filter = queryFilter;
    return query;
  };

  try {
    const res = response();
    await getMarketplacePropertiesForReview(
      { user: { userId: "admin-id", role: "admin" } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(filter, {});
    assert.equal(res.body.properties.length, 1);
  } finally {
    Property.find = originalFind;
  }
});

test("property moderation cannot change another user's property", async () => {
  const originals = {
    findOne: Property.findOne,
    updateListings: Listing.updateMany,
  };
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId().toString();
  let filter;
  let listingUpdates = 0;
  Property.findOne = async (queryFilter) => {
    filter = queryFilter;
    return null;
  };
  Listing.updateMany = async () => {
    listingUpdates += 1;
  };

  try {
    const res = response();
    await moderateMarketplaceProperty(
      {
        params: { propertyId },
        user: { userId: ownerId },
        body: { status: "approved" },
      },
      res,
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(filter, { _id: propertyId, ownerId });
    assert.equal(listingUpdates, 0);
  } finally {
    Property.findOne = originals.findOne;
    Listing.updateMany = originals.updateListings;
  }
});

test("platform admins can approve another user's property and publish its listing", async () => {
  const originals = {
    findOne: Property.findOne,
    findById: Property.findById,
    updateListings: Listing.updateMany,
  };
  const propertyId = new mongoose.Types.ObjectId();
  const property = {
    _id: propertyId,
    moderationStatus: "pending",
    moderationReason: undefined,
    save: async () => {},
    toJSON() {
      return { _id: this._id, moderationStatus: this.moderationStatus };
    },
  };
  let propertyFilter;
  let listingFilter;
  let listingUpdate;
  Property.findOne = async (filter) => {
    propertyFilter = filter;
    return property;
  };
  Property.findById = () => ({ populate: async () => property });
  Listing.updateMany = async (filter, update) => {
    listingFilter = filter;
    listingUpdate = update;
  };

  try {
    const res = response();
    await moderateMarketplaceProperty(
      {
        params: { propertyId: propertyId.toString() },
        user: { userId: "admin-id", role: "admin" },
        body: { status: "approved" },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(propertyFilter, { _id: propertyId.toString() });
    assert.deepEqual(listingFilter, { propertyId });
    assert.equal(listingUpdate.$set.status, "published");
    assert.equal(property.moderationStatus, "approved");
  } finally {
    Property.findOne = originals.findOne;
    Property.findById = originals.findById;
    Listing.updateMany = originals.updateListings;
  }
});

test("property owners can moderate their own property", async () => {
  const originals = {
    findOwnedProperty: Property.findOne,
    findPropertyById: Property.findById,
    updateListings: Listing.updateMany,
  };
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId();
  const property = {
    _id: propertyId,
    moderationStatus: "pending",
    moderationReason: undefined,
    save: async () => {},
    toJSON() {
      return { _id: this._id, moderationStatus: this.moderationStatus };
    },
  };
  let filter;
  let listingFilter;
  Property.findOne = (queryFilter) => {
    filter = queryFilter;
    return Promise.resolve(property);
  };
  Property.findById = () => ({ populate: async () => property });
  Listing.updateMany = async (queryFilter) => {
    listingFilter = queryFilter;
  };

  try {
    const res = response();
    await moderateMarketplaceProperty(
      {
        params: { propertyId: propertyId.toString() },
        user: { userId: ownerId },
        body: { status: "approved" },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(filter, {
      _id: propertyId.toString(),
      ownerId,
    });
    assert.deepEqual(listingFilter, { propertyId });
    assert.equal(property.moderationStatus, "approved");
  } finally {
    Property.findOne = originals.findOwnedProperty;
    Property.findById = originals.findPropertyById;
    Listing.updateMany = originals.updateListings;
  }
});

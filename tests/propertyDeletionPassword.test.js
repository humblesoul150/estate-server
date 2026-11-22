const assert = require("node:assert/strict");
const { test } = require("node:test");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { deleteMarketplaceProperty } = require("../controllers/propertyController");
const { verifyCurrentPassword } = require("../controllers/userController");
const Property = require("../models/property");
const Listing = require("../models/listing");
const Users = require("../models/user");

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

test("current password verification rejects an incorrect password", async () => {
  const originalFindById = Users.findById;
  const passwordHash = await bcrypt.hash("correct-password", 4);
  Users.findById = () => ({
    select: async () => ({ password: passwordHash }),
  });

  try {
    const res = response();
    await verifyCurrentPassword(
      { body: { currentPassword: "incorrect-password" }, user: { userId: "user-id" } },
      res,
    );

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Current password is incorrect.");
  } finally {
    Users.findById = originalFindById;
  }
});

test("marketplace deletion verifies the password before deleting property data", async () => {
  const originals = {
    findUserById: Users.findById,
    findPropertyById: Property.findById,
    deleteProperty: Property.deleteOne,
    deleteListings: Listing.deleteMany,
  };
  const passwordHash = await bcrypt.hash("correct-password", 4);
  const propertyId = new mongoose.Types.ObjectId().toString();
  let propertyReads = 0;
  let propertyDeletes = 0;
  let listingDeletes = 0;
  Users.findById = () => ({
    select: async () => ({ password: passwordHash }),
  });
  Property.findById = async (id) => {
    propertyReads += 1;
    return { _id: id };
  };
  Property.deleteOne = async () => {
    propertyDeletes += 1;
  };
  Listing.deleteMany = async () => {
    listingDeletes += 1;
    return { deletedCount: 1 };
  };

  try {
    const invalidResponse = response();
    await deleteMarketplaceProperty(
      {
        params: { propertyId },
        body: { currentPassword: "incorrect-password" },
        user: { userId: "user-id" },
      },
      invalidResponse,
    );

    assert.equal(invalidResponse.statusCode, 403);
    assert.equal(propertyReads, 0);
    assert.equal(propertyDeletes, 0);
    assert.equal(listingDeletes, 0);

    const validResponse = response();
    await deleteMarketplaceProperty(
      {
        params: { propertyId },
        body: { currentPassword: "correct-password" },
        user: { userId: "user-id" },
      },
      validResponse,
    );

    assert.equal(validResponse.statusCode, 200);
    assert.equal(propertyReads, 1);
    assert.equal(propertyDeletes, 1);
    assert.equal(listingDeletes, 1);
  } finally {
    Users.findById = originals.findUserById;
    Property.findById = originals.findPropertyById;
    Property.deleteOne = originals.deleteProperty;
    Listing.deleteMany = originals.deleteListings;
  }
});

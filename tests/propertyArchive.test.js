const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const {
  archiveMarketplaceProperty,
  getMarketplaceProperties,
  unarchiveMarketplaceProperty,
} = require("../controllers/propertyController");
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

test("archive and restore only update the authenticated owner's property state", async () => {
  const originalFindOneAndUpdate = Property.findOneAndUpdate;
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId().toString();
  let filter;
  let update;
  let options;
  Property.findOneAndUpdate = async (queryFilter, queryUpdate, queryOptions) => {
    filter = queryFilter;
    update = queryUpdate;
    options = queryOptions;
    return {
      toJSON: () => ({ _id: propertyId, ...queryUpdate.$set }),
    };
  };

  try {
    for (const [handler, isArchived] of [
      [archiveMarketplaceProperty, true],
      [unarchiveMarketplaceProperty, false],
    ]) {
      const res = response();
      await handler(
        {
          params: { propertyId },
          user: { userId: ownerId },
        },
        res,
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(filter, { _id: propertyId, ownerId });
      assert.equal(update.$set.isArchived, isArchived);
      assert.equal(
        isArchived ? update.$set.archivedAt instanceof Date : update.$set.archivedAt,
        isArchived ? true : null,
      );
      assert.deepEqual(options, { new: true, runValidators: true });
      assert.equal(res.body.property.isArchived, isArchived);
    }
  } finally {
    Property.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("archiving returns not found for a property owned by another user", async () => {
  const originalFindOneAndUpdate = Property.findOneAndUpdate;
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId().toString();
  let filter;
  Property.findOneAndUpdate = async (queryFilter) => {
    filter = queryFilter;
    return null;
  };

  try {
    const res = response();
    await archiveMarketplaceProperty(
      {
        params: { propertyId },
        user: { userId: ownerId },
      },
      res,
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(filter, { _id: propertyId, ownerId });
  } finally {
    Property.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("public marketplace query excludes archived properties", async () => {
  const originalFind = Property.find;
  let queryFilter;
  const query = {
    populate() {
      return this;
    },
    sort: async () => [],
  };
  Property.find = (filter) => {
    queryFilter = filter;
    return query;
  };

  try {
    const res = response();
    await getMarketplaceProperties({}, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(queryFilter, {
      moderationStatus: "approved",
      isArchived: { $ne: true },
    });
    assert.deepEqual(res.body.properties, []);
  } finally {
    Property.find = originalFind;
  }
});

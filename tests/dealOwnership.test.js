const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const {
  createDeal,
  getDealsForFeaturedCuration,
  getPublicDeals,
  getDealsForManagement,
  removeDeal,
  updateDeal,
  updateDealFeaturedStatus,
  updateDealStatus,
} = require("../controllers/dealController");
const Deal = require("../models/deal");
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

test("deal management lists only deals attached to properties owned by the user", async () => {
  const originals = {
    distinct: Property.distinct,
    find: Deal.find,
  };
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyIds = [new mongoose.Types.ObjectId()];
  let propertyFilter;
  let dealFilter;
  Property.distinct = async (field, filter) => {
    assert.equal(field, "_id");
    propertyFilter = filter;
    return propertyIds;
  };
  const query = {
    populate() {
      return this;
    },
    sort: async () => [],
  };
  Deal.find = (filter) => {
    dealFilter = filter;
    return query;
  };

  try {
    const res = response();
    await getDealsForManagement({ user: { userId: ownerId } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(propertyFilter, { ownerId });
    assert.deepEqual(dealFilter, { propertyId: { $in: propertyIds } });
    assert.deepEqual(res.body.deals, []);
  } finally {
    Property.distinct = originals.distinct;
    Deal.find = originals.find;
  }
});

test("deal creation rejects a property not owned by the requesting user", async () => {
  const originalFindOne = Property.findOne;
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId().toString();
  const listingId = new mongoose.Types.ObjectId().toString();
  let propertyFilter;
  Property.findOne = (filter) => {
    propertyFilter = filter;
    return { lean: async () => null };
  };

  try {
    const res = response();
    await createDeal(
      {
        user: { userId: ownerId },
        body: { title: "Test deal", propertyId, listingId },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.deepEqual(propertyFilter, { _id: propertyId, ownerId });
  } finally {
    Property.findOne = originalFindOne;
  }
});

test("deal creation rejects archived properties", async () => {
  const originals = {
    findOwnedProperty: Property.findOne,
    findListing: Listing.findOne,
  };
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyId = new mongoose.Types.ObjectId().toString();
  const listingId = new mongoose.Types.ObjectId().toString();
  let listingLookups = 0;
  Property.findOne = () => ({
    lean: async () => ({ isArchived: true }),
  });
  Listing.findOne = async () => {
    listingLookups += 1;
    return { status: "published" };
  };

  try {
    const res = response();
    await createDeal(
      {
        user: { userId: ownerId },
        body: { title: "Test deal", propertyId, listingId },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /archived properties/i);
    assert.equal(listingLookups, 0);
  } finally {
    Property.findOne = originals.findOwnedProperty;
    Listing.findOne = originals.findListing;
  }
});

test("public deals include only active deals with eligible properties and listings", async () => {
  const originalFind = Deal.find;
  const now = new Date();
  const visibleProperty = {
    toJSON: () => ({
      _id: new mongoose.Types.ObjectId(),
      name: "Visible",
    }),
  };
  const visibleListing = {
    toJSON: () => ({
      _id: new mongoose.Types.ObjectId(),
      status: "published",
    }),
  };
  const visibleDeal = {
    _id: new mongoose.Types.ObjectId(),
    propertyId: visibleProperty,
    listingId: visibleListing,
    status: "published",
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: null,
  };
  const archivedDeal = {
    ...visibleDeal,
    _id: new mongoose.Types.ObjectId(),
    propertyId: null,
  };
  const unpublishedListingDeal = {
    ...visibleDeal,
    _id: new mongoose.Types.ObjectId(),
    listingId: null,
  };
  const futureDeal = {
    ...visibleDeal,
    _id: new mongoose.Types.ObjectId(),
    startsAt: new Date(now.getTime() + 60_000),
  };
  const populateOptions = [];
  const query = {
    populate(option) {
      populateOptions.push(option);
      return this;
    },
    sort: async () => [
      visibleDeal,
      archivedDeal,
      unpublishedListingDeal,
      futureDeal,
    ],
  };
  Deal.find = (filter) => {
    assert.deepEqual(filter, { status: "published" });
    return query;
  };

  try {
    const res = response();
    await getPublicDeals({}, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(populateOptions, [
      {
        path: "propertyId",
        match: {
          moderationStatus: "approved",
          isArchived: { $ne: true },
        },
      },
      {
        path: "listingId",
        match: { status: "published" },
      },
    ]);
    assert.equal(res.body.deals.length, 1);
    assert.deepEqual(res.body.deals[0].property.name, "Visible");
    assert.equal(res.body.deals[0].featured, false);
  } finally {
    Deal.find = originalFind;
  }
});

test("new deals default to not featured", () => {
  const deal = new Deal();

  assert.equal(deal.featured, false);
});

test("featured curation rejects users without platform admin role", async () => {
  const listRes = response();
  await getDealsForFeaturedCuration({ user: { role: "landlord" } }, listRes);

  const updateRes = response();
  await updateDealFeaturedStatus(
    {
      user: { role: "propertyManager" },
      params: { dealId: new mongoose.Types.ObjectId().toString() },
      body: { featured: true },
    },
    updateRes,
  );

  assert.equal(listRes.statusCode, 403);
  assert.equal(updateRes.statusCode, 403);
});

test("platform admins can feature eligible published deals", async () => {
  const originalFindById = Deal.findById;
  const deal = {
    _id: new mongoose.Types.ObjectId(),
    status: "published",
    featured: false,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: null,
    propertyId: {
      name: "Eligible property",
      moderationStatus: "approved",
      isArchived: false,
    },
    listingId: { status: "published" },
    save: async () => {},
  };
  Deal.findById = () => ({
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(deal).then(resolve, reject);
    },
  });

  try {
    const res = response();
    await updateDealFeaturedStatus(
      {
        user: { role: "admin" },
        params: { dealId: deal._id.toString() },
        body: { featured: true },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(deal.featured, true);
    assert.equal(res.body.deal.featured, true);
  } finally {
    Deal.findById = originalFindById;
  }
});

test("deal updates and removals reject deals on another user's properties", async () => {
  const originals = {
    distinct: Property.distinct,
    findOne: Deal.findOne,
  };
  const ownerId = new mongoose.Types.ObjectId().toString();
  const propertyIds = [new mongoose.Types.ObjectId()];
  const dealId = new mongoose.Types.ObjectId().toString();
  const handlers = [
    { handler: updateDeal, body: { title: "Not allowed" } },
    { handler: updateDealStatus, body: { status: "paused" } },
    { handler: removeDeal, body: {} },
  ];
  let dealFilter;
  Property.distinct = async (_field, filter) => {
    assert.deepEqual(filter, { ownerId });
    return propertyIds;
  };
  Deal.findOne = async (filter) => {
    dealFilter = filter;
    return null;
  };

  try {
    for (const { handler, body } of handlers) {
      const res = response();
      await handler(
        {
          params: { dealId },
          user: { userId: ownerId },
          body,
        },
        res,
      );

      assert.equal(res.statusCode, 404);
      assert.deepEqual(dealFilter, {
        _id: dealId,
        propertyId: { $in: propertyIds },
      });
    }
  } finally {
    Property.distinct = originals.distinct;
    Deal.findOne = originals.findOne;
  }
});

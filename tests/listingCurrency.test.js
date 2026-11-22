const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Listing = require("../models/listing");
const currencies = require("../utils/currencies");

const createListing = (currency) =>
  new Listing({
    propertyId: new mongoose.Types.ObjectId(),
    purpose: "rent",
    price: 100,
    currency,
  });

test("listing accepts every currency supported by the property form", async () => {
  await Promise.all(currencies.map((currency) => createListing(currency).validate()));
});

test("listing rejects unsupported currencies", async () => {
  await assert.rejects(
    createListing("ZZZ").validate(),
    (error) =>
      error.name === "ValidationError" &&
      Boolean(error.errors.currency),
  );
});

test("listing currency is normalized to uppercase", async () => {
  const listing = createListing("ugx");
  await listing.validate();
  assert.equal(listing.currency, "UGX");
});

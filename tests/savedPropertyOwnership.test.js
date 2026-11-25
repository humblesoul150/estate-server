const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const { toggleSavedProperty } = require("../controllers/userController");
const Properties = require("../models/property");
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

test("users cannot save their own properties", async () => {
  const originals = {
    findProperty: Properties.findById,
    findUser: Users.findById,
  };
  const userId = new mongoose.Types.ObjectId();
  const propertyId = new mongoose.Types.ObjectId();
  let userLookups = 0;
  Properties.findById = async () => ({ ownerId: userId });
  Users.findById = async () => {
    userLookups += 1;
    return { saved: [], save: async () => {} };
  };

  try {
    const res = response();
    await toggleSavedProperty(
      {
        params: { propertyId: propertyId.toString() },
        user: { userId: userId.toString() },
      },
      res,
    );

    assert.equal(res.statusCode, 403);
    assert.equal(userLookups, 0);
    assert.deepEqual(res.body, {
      message: "You cannot save your own property",
    });
  } finally {
    Properties.findById = originals.findProperty;
    Users.findById = originals.findUser;
  }
});

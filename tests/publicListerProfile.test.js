const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const { getPublicProfile } = require("../controllers/userController");
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

test("public lister profile includes public ratings for an admin-owned listing", async () => {
  const originalFindById = Users.findById;
  const userId = new mongoose.Types.ObjectId();
  let selectedFields;
  Users.findById = (id) => {
    assert.equal(id, userId.toString());
    return {
      select: async (fields) => {
        selectedFields = fields;
        return {
          _id: userId,
          firstName: "Property",
          lastName: "Lister",
          role: "admin",
          avatar: {},
          bio: "",
          publicContact: {},
          averageRating: 4.5,
          totalReviews: 2,
          ratingCount: 2,
        };
      },
    };
  };

  try {
    const res = response();
    await getPublicProfile({ params: { userId: userId.toString() } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.id, userId.toString());
    assert.equal(res.body.user.role, "admin");
    assert.equal(res.body.user.averageRating, 4.5);
    assert.equal(res.body.user.totalReviews, 2);
    assert.match(selectedFields, /averageRating/);
    assert.match(selectedFields, /totalReviews/);
  } finally {
    Users.findById = originalFindById;
  }
});

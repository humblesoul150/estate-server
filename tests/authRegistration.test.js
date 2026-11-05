const assert = require("node:assert/strict");
const { test } = require("node:test");
const Users = require("../models/user");
const { registerUser } = require("../controllers/authController");

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const validRegistration = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: " ADA@example.com ",
  password: "password123",
  role: "user",
  phone: "+1 (202) 555-0142",
  dob: "01/01/2000",
  gender: "female",
};

test("registration rejects invalid phone numbers before database access", async (t) => {
  const originalFindOne = Users.findOne;
  let queried = false;
  Users.findOne = () => {
    queried = true;
    return Promise.resolve(null);
  };
  t.after(() => {
    Users.findOne = originalFindOne;
  });

  const res = response();
  await registerUser(
    { body: { ...validRegistration, phone: "not a phone" } },
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /valid phone number/i);
  assert.equal(queried, false);
});

test("registration rejects a duplicate email or phone as a conflict", async (t) => {
  const originalFindOne = Users.findOne;
  const originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-registration-secret";
  let query;
  Users.findOne = (value) => {
    query = value;
    return Promise.resolve({ _id: "existing-user" });
  };
  t.after(() => {
    Users.findOne = originalFindOne;
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  const res = response();
  await registerUser({ body: validRegistration }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already exists/i);
  assert.equal(query.$or.length, 2);
});

test("registration normalizes email and phone and returns the created session", async (t) => {
  const originalFindOne = Users.findOne;
  const originalSave = Users.prototype.save;
  const originalJwtSecret = process.env.JWT_SECRET;
  let savedUser;
  process.env.JWT_SECRET = "test-registration-secret";
  Users.findOne = () => Promise.resolve(null);
  Users.prototype.save = async function save() {
    savedUser = this;
    return this;
  };
  t.after(() => {
    Users.findOne = originalFindOne;
    Users.prototype.save = originalSave;
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  const res = response();
  await registerUser({ body: validRegistration }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(savedUser.email, "ada@example.com");
  assert.equal(savedUser.phoneNumber, "+12025550142");
  assert.equal(res.body.user.phoneNumber, "+12025550142");
  assert.equal(typeof res.body.token, "string");
});

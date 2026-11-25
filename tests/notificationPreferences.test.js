const assert = require("node:assert/strict");
const { test } = require("node:test");
const Users = require("../models/user");
const {
  getNotificationPreferences,
  updateNotificationPreferences,
} = require("../controllers/userController");
const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getApplicableNotificationFields,
  serializeNotificationPreferences,
  validateNotificationPreferencePatch,
} = require("../utils/notificationPreferences");

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

test("notification preferences default to enabled with marketing opt-in disabled", () => {
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.notificationsEnabled, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.messageAndViewingUpdates, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.promotionalEmails, false);
});

test("notification preferences are scoped to each account role", () => {
  const userFields = getApplicableNotificationFields("user");
  const ownerFields = getApplicableNotificationFields("landlord");
  const adminFields = getApplicableNotificationFields("admin");

  assert.ok(userFields.includes("deals"));
  assert.ok(!userFields.includes("ownerPropertySaves"));
  assert.ok(ownerFields.includes("ownerPropertySaves"));
  assert.ok(adminFields.includes("customerCareRequests"));
  assert.ok(!adminFields.includes("deals"));
});

test("serialization returns defaults only for the role's applicable settings", () => {
  const serialized = serializeNotificationPreferences(
    { notificationsEnabled: false },
    "propertyManager",
  );

  assert.equal(serialized.notificationsEnabled, false);
  assert.equal(serialized.savedSearchFrequency, "daily");
  assert.equal(serialized.ownerPropertyReviews, true);
  assert.equal("customerCareRequests" in serialized, false);
});

test("validation rejects invalid values and preferences unavailable to the role", () => {
  assert.equal(
    validateNotificationPreferencePatch(
      { savedSearchFrequency: "monthly" },
      "user",
    ).valid,
    false,
  );
  assert.equal(
    validateNotificationPreferencePatch(
      { ownerPropertyReviews: false },
      "user",
    ).status,
    403,
  );
  assert.equal(
    validateNotificationPreferencePatch(
      { notificationsEnabled: "yes" },
      "admin",
    ).valid,
    false,
  );
});

test("notification preference reads expose only settings for the authenticated role", async () => {
  const originalFindById = Users.findById;
  Users.findById = () => ({
    select: async () => ({
      role: "user",
      notificationPreferencesVersion: 1,
      notificationPreferences: { deals: false },
    }),
  });

  try {
    const res = response();
    await getNotificationPreferences({ user: { userId: "user-id" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.preferences.deals, false);
    assert.equal("ownerPropertySaves" in res.body.preferences, false);
  } finally {
    Users.findById = originalFindById;
  }
});

test("first preference save initializes role defaults and records the configured version", async () => {
  const originals = {
    findById: Users.findById,
    updateOne: Users.updateOne,
  };
  const updates = [];
  let findCount = 0;
  Users.findById = () => ({
    select: async () => {
      findCount += 1;
      if (findCount === 1) {
        return {
          role: "landlord",
          notificationPreferencesVersion: 0,
          notificationPreferences: {},
        };
      }

      const preferences = {};
      for (const [path, value] of Object.entries(updates[0].$set)) {
        if (path.startsWith("notificationPreferences.")) {
          preferences[path.slice("notificationPreferences.".length)] = value;
        }
      }
      return {
        role: "landlord",
        notificationPreferencesVersion: 1,
        notificationPreferences: preferences,
      };
    },
  });
  Users.updateOne = async (filter, update) => {
    updates.push({ filter, ...update });
    return { modifiedCount: 1 };
  };

  try {
    const res = response();
    await updateNotificationPreferences(
      {
        user: { userId: "owner-id" },
        body: { preferences: { ownerPropertySaves: false } },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.preferences.ownerPropertySaves, false);
    assert.equal(res.body.preferences.notificationsEnabled, true);
    assert.equal(
      updates[0].$set.notificationPreferencesVersion,
      1,
    );
    assert.equal(
      "notificationPreferences.customerCareRequests" in updates[0].$set,
      false,
    );
  } finally {
    Users.findById = originals.findById;
    Users.updateOne = originals.updateOne;
  }
});

test("partial preference updates change only requested fields", async () => {
  const originals = {
    findById: Users.findById,
    findByIdAndUpdate: Users.findByIdAndUpdate,
  };
  const updates = [];
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  Users.findById = () => ({
    select: async () => ({
      role: "user",
      notificationPreferencesVersion: 1,
      notificationPreferences: preferences,
    }),
  });
  Users.findByIdAndUpdate = (userId, update) => {
    updates.push(update);
    Object.assign(preferences, {
      deals: update.$set["notificationPreferences.deals"],
    });
    return {
      select: async () => ({
        role: "user",
        notificationPreferencesVersion: 1,
        notificationPreferences: preferences,
      }),
    };
  };

  try {
    const res = response();
    await updateNotificationPreferences(
      { user: { userId: "user-id" }, body: { preferences: { deals: false } } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(updates[0].$set), [
      "notificationPreferences.deals",
    ]);
    assert.equal(res.body.preferences.deals, false);
  } finally {
    Users.findById = originals.findById;
    Users.findByIdAndUpdate = originals.findByIdAndUpdate;
  }
});

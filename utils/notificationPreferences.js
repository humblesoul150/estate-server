const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  notificationsEnabled: true,
  emailNotifications: true,
  messageAndViewingUpdates: true,
  deals: true,
  contactedOwnerListings: true,
  savedSearchMatches: true,
  savedPropertyUpdates: true,
  savedPropertyReminders: true,
  termsAndConditionsUpdates: true,
  customerCareUpdates: true,
  customerCareRequests: true,
  ownerPropertyReviews: true,
  ownerPropertySaves: true,
  promotionalEmails: false,
  savedSearchFrequency: "daily",
});

const COMMON_FIELDS = [
  "notificationsEnabled",
  "emailNotifications",
  "termsAndConditionsUpdates",
  "promotionalEmails",
];

const CLIENT_FIELDS = [
  "messageAndViewingUpdates",
  "deals",
  "contactedOwnerListings",
  "savedSearchMatches",
  "savedPropertyUpdates",
  "savedPropertyReminders",
  "customerCareUpdates",
  "savedSearchFrequency",
];

const OWNER_FIELDS = ["ownerPropertyReviews", "ownerPropertySaves"];
const ADMIN_FIELDS = ["messageAndViewingUpdates", "customerCareRequests"];

const ROLE_RESTRICTED_FIELDS = {
  ownerPropertyReviews: ["landlord", "propertyManager"],
  ownerPropertySaves: ["landlord", "propertyManager"],
  customerCareRequests: ["admin"],
};

const getApplicableNotificationFields = (role) => {
  const fields = [...COMMON_FIELDS];
  if (role === "admin") {
    fields.push(...ADMIN_FIELDS);
  } else {
    fields.push(...CLIENT_FIELDS);
    if (role === "landlord" || role === "propertyManager") {
      fields.push(...OWNER_FIELDS);
    }
  }
  return fields;
};

const isPlainObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const validateNotificationPreferencePatch = (patch, role) => {
  if (!isPlainObject(patch)) {
    return { valid: false, status: 400, message: "Preferences must be an object." };
  }

  const fields = Object.keys(patch);
  if (!fields.length) {
    return { valid: false, status: 400, message: "At least one preference is required." };
  }

  const allowedFields = getApplicableNotificationFields(role);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_NOTIFICATION_PREFERENCES, field)) {
      return { valid: false, status: 400, message: `Unknown notification preference: ${field}.` };
    }

    if (!allowedFields.includes(field)) {
      const allowedRoles = ROLE_RESTRICTED_FIELDS[field];
      if (allowedRoles) {
        return {
          valid: false,
          status: 403,
          message: "This notification preference is not available for your account role.",
        };
      }
      return {
        valid: false,
        status: 400,
        message: `Notification preference is not supported for role ${role}.`,
      };
    }

    if (field === "savedSearchFrequency") {
      if (!["off", "daily", "weekly"].includes(patch[field])) {
        return {
          valid: false,
          status: 400,
          message: "Saved-search frequency must be off, daily, or weekly.",
        };
      }
    } else if (typeof patch[field] !== "boolean") {
      return {
        valid: false,
        status: 400,
        message: `${field} must be a boolean.`,
      };
    }
  }

  return { valid: true };
};

const serializeNotificationPreferences = (preferences, role) => {
  const source = preferences?.toObject?.() || preferences || {};
  return Object.fromEntries(
    getApplicableNotificationFields(role).map((field) => [
      field,
      source[field] ?? DEFAULT_NOTIFICATION_PREFERENCES[field],
    ]),
  );
};

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getApplicableNotificationFields,
  isPlainObject,
  serializeNotificationPreferences,
  validateNotificationPreferencePatch,
};

const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { getProperties } = require("../controllers/propertyController");

const router = express.Router();

const propertyFeedLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many property requests. Please try again shortly." },
});

router.get("/all", propertyFeedLimiter, getProperties);

module.exports = router;

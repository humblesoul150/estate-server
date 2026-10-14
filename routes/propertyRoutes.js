const express = require("express");
const { rateLimit } = require("express-rate-limit");
const {
  getProperties,
  createMarketplaceProperty,
  getMarketplaceProperties,
  getMarketplacePropertiesForReview,
  moderateMarketplaceProperty,
  updateMarketplaceProperty,
  deleteMarketplaceProperty,
} = require("../controllers/propertyController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

const propertyFeedLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many property requests. Please try again shortly." },
});

const requireAdmin = (req, res, next) => {
  if (!["admin", "landlord", "propertyManager"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Administrator access required." });
  }
  return next();
};

router.get("/marketplace", propertyFeedLimiter, getMarketplaceProperties);
router.post(
  "/marketplace",
  authMiddleware,
  upload.array("images", 60),
  createMarketplaceProperty,
);
router.get(
  "/marketplace/manage",
  authMiddleware,
  requireAdmin,
  getMarketplacePropertiesForReview,
);
router.patch(
  "/marketplace/:propertyId",
  authMiddleware,
  requireAdmin,
  updateMarketplaceProperty,
);
router.delete(
  "/marketplace/:propertyId",
  authMiddleware,
  requireAdmin,
  deleteMarketplaceProperty,
);
router.patch(
  "/marketplace/:propertyId/moderation",
  authMiddleware,
  requireAdmin,
  moderateMarketplaceProperty,
);
router.get("/all", propertyFeedLimiter, getProperties);

module.exports = router;

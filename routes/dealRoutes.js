const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createDeal,
  getDealsForFeaturedCuration,
  getDealsForManagement,
  getPublicDeals,
  removeDeal,
  updateDeal,
  updateDealFeaturedStatus,
  updateDealStatus,
} = require("../controllers/dealController");

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (!["admin", "landlord", "propertyManager"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Administrator access required." });
  }
  return next();
};

const requirePlatformAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Platform administrator access required." });
  }
  return next();
};

router.get("/", getPublicDeals);
router.get(
  "/featured-management",
  authMiddleware,
  requirePlatformAdmin,
  getDealsForFeaturedCuration,
);
router.get("/manage", authMiddleware, requireAdmin, getDealsForManagement);
router.post("/", authMiddleware, requireAdmin, createDeal);
router.patch("/:dealId", authMiddleware, requireAdmin, updateDeal);
router.patch(
  "/:dealId/featured",
  authMiddleware,
  requirePlatformAdmin,
  updateDealFeaturedStatus,
);
router.patch("/:dealId/status", authMiddleware, requireAdmin, updateDealStatus);
router.delete("/:dealId", authMiddleware, requireAdmin, removeDeal);

module.exports = router;

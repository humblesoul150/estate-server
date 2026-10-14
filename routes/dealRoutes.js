const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createDeal,
  getDealsForManagement,
  getPublicDeals,
  removeDeal,
  updateDeal,
  updateDealStatus,
} = require("../controllers/dealController");

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (!["admin", "landlord", "propertyManager"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Administrator access required." });
  }
  return next();
};

router.get("/", getPublicDeals);
router.get("/manage", authMiddleware, requireAdmin, getDealsForManagement);
router.post("/", authMiddleware, requireAdmin, createDeal);
router.patch("/:dealId", authMiddleware, requireAdmin, updateDeal);
router.patch("/:dealId/status", authMiddleware, requireAdmin, updateDealStatus);
router.delete("/:dealId", authMiddleware, requireAdmin, removeDeal);

module.exports = router;

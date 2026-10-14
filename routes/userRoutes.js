const express = require("express");
const {
  updateAvatar,
  removeAvatar,
  updateProfile,
  getPublicProfile,
  changePassword,
  deleteAccount,
  getSavedProperties,
  toggleSavedProperty,
  getSearchHistory,
  addSearchHistory,
  clearSearchHistory,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/me/saved", authMiddleware, getSavedProperties);
router.patch("/me/saved/:propertyId", authMiddleware, toggleSavedProperty);
router.get("/me/search-history", authMiddleware, getSearchHistory);
router.post("/me/search-history", authMiddleware, addSearchHistory);
router.delete("/me/search-history", authMiddleware, clearSearchHistory);
router.get("/:userId/public", getPublicProfile);
router.patch(
  "/me/avatar",
  authMiddleware,
  upload.single("avatar"),
  updateAvatar,
);
router.delete("/me/avatar", authMiddleware, removeAvatar);
router.patch("/me", authMiddleware, updateProfile);
router.patch("/me/password", authMiddleware, changePassword);
router.delete("/me", authMiddleware, deleteAccount);

module.exports = router;

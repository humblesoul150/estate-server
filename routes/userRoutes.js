const express = require("express");
const {
  updateAvatar,
  updateProfile,
  getPublicProfile,
  changePassword,
  deleteAccount,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/:userId/public", getPublicProfile);
router.patch(
  "/me/avatar",
  authMiddleware,
  upload.single("avatar"),
  updateAvatar,
);
router.patch("/me", authMiddleware, updateProfile);
router.patch("/me/password", authMiddleware, changePassword);
router.delete("/me", authMiddleware, deleteAccount);

module.exports = router;

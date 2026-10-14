const express = require("express");
const router = express.Router();
const {
	registerUser,
	loginUser,
	requestPasswordReset,
	verifyPasswordResetCode,
	resetPassword,
} = require("../controllers/authController");
// Register route
router.post("/register", registerUser);
// Login route
router.post("/login", loginUser);
router.post("/password-reset/request", requestPasswordReset);
router.post("/password-reset/verify", verifyPasswordResetCode);
router.post("/password-reset/reset", resetPassword);

module.exports = router;

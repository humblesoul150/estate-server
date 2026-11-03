const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getOrCreatePropertyConversation,
  listConversations,
  listMessages,
  sendMessage,
  markRead,
  deleteMessage,
  archiveConversation,
} = require("../controllers/messageControllers");

const router = express.Router();

router.use(authMiddleware);
router.post("/conversations", getOrCreatePropertyConversation);
router.get("/conversations", listConversations);
router.get("/conversations/:conversationId/messages", listMessages);
router.post("/conversations/:conversationId/messages", sendMessage);
router.patch("/conversations/:conversationId/read", markRead);
router.patch("/conversations/:conversationId/archive", archiveConversation);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  deleteMessage,
);

module.exports = router;

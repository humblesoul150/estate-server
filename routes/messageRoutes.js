const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const messageUploadMiddleware = require("../middleware/messageUploadMiddleware");
const {
  getOrCreatePropertyConversation,
  getOrCreateSupportConversation,
  listConversations,
  claimSupportConversation,
  listMessages,
  sendMessage,
  sendAttachment,
  markRead,
  deleteMessage,
  archiveConversation,
  restoreConversation,
} = require("../controllers/messageControllers");

const router = express.Router();

router.use(authMiddleware);
router.post("/conversations", getOrCreatePropertyConversation);
router.post("/conversations/support", getOrCreateSupportConversation);
router.get("/conversations", listConversations);
router.post(
  "/conversations/:conversationId/claim",
  claimSupportConversation,
);
router.get("/conversations/:conversationId/messages", listMessages);
router.post("/conversations/:conversationId/messages", sendMessage);
router.post(
  "/conversations/:conversationId/messages/attachment",
  messageUploadMiddleware,
  sendAttachment,
);
router.patch("/conversations/:conversationId/read", markRead);
router.patch("/conversations/:conversationId/archive", archiveConversation);
router.patch("/conversations/:conversationId/restore", restoreConversation);
router.delete("/conversations/:conversationId", archiveConversation);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  deleteMessage,
);

module.exports = router;

const mongoose = require("mongoose");
const Conversation = require("../models/converation");
const Message = require("../models/message");
const Property = require("../models/property");

const serializeConversation = (conversation, currentUserId) => ({
  id: conversation._id,
  property: conversation.property,
  participants: conversation.participants,
  lastMessage: conversation.lastMessage,
  lastMessageAt: conversation.lastMessageAt,
  unreadCount: conversation.unreadCount?.get?.(String(currentUserId)) || 0,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

exports.getOrCreatePropertyConversation = async (req, res) => {
  try {
    const { propertyId } = req.body;
    if (!mongoose.isValidObjectId(propertyId)) {
      return res.status(400).json({ message: "A valid propertyId is required." });
    }

    const property = await Property.findById(propertyId).select("ownerId");
    if (!property?.ownerId) {
      return res.status(404).json({ message: "Property owner was not found." });
    }

    const ownerId = String(property.ownerId);
    const userId = String(req.user.userId);
    if (ownerId === userId) {
      return res.status(400).json({ message: "Property owners cannot start a chat with themselves." });
    }

    const participantKey = [propertyId, ownerId, userId].sort().join(":");
    let conversation = await Conversation.findOne({ participantKey })
      .populate("participants", "firstName lastName avatar role")
      .populate("lastMessage")
      .populate("property", "name address city country images");

    if (!conversation) {
      conversation = await Conversation.create({
        property: propertyId,
        participants: [userId, ownerId],
        participantKey,
        unreadCount: {},
      });
      conversation = await Conversation.findById(conversation._id)
        .populate("participants", "firstName lastName avatar role")
        .populate("lastMessage")
        .populate("property", "name address city country images");
    }

    return res.status(200).json({
      conversation: serializeConversation(conversation, userId),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to open conversation." });
  }
};

exports.listConversations = async (req, res) => {
  const conversations = await Conversation.find({
    participants: req.user.userId,
    archivedBy: { $ne: req.user.userId },
  })
    .populate("participants", "firstName lastName avatar role")
    .populate("lastMessage")
    .populate("property", "name address city country images")
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  return res.status(200).json({
    conversations: conversations.map((conversation) =>
      serializeConversation(conversation, req.user.userId),
    ),
  });
};

exports.listMessages = async (req, res) => {
  const { conversationId } = req.params;
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }

  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: req.user.userId,
  });
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const query = { conversation: conversationId };
  if (req.query.before && mongoose.isValidObjectId(req.query.before)) {
    const before = await Message.findById(req.query.before).select("createdAt");
    if (before) query.createdAt = { $lt: before.createdAt };
  }

  const messages = await Message.find(query)
    .populate("replyTo", "sender text messageType deleted deletedAt")
    .sort({ createdAt: -1 })
    .limit(limit);

  return res.status(200).json({ messages: messages.reverse() });
};

exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const clientMessageId = String(req.body.clientMessageId || "").trim();
    const replyTo = req.body.replyTo;

    if (!text || text.length > 4000) {
      return res.status(400).json({ message: "Message text must be between 1 and 4000 characters." });
    }
    if (!clientMessageId || clientMessageId.length > 100) {
      return res.status(400).json({ message: "clientMessageId is required." });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.userId,
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    const existing = await Message.findOne({
      conversation: conversationId,
      sender: req.user.userId,
      clientMessageId,
    });
    if (existing) return res.status(200).json({ message: existing });

    let replyMessage = null;
    if (replyTo) {
      if (!mongoose.isValidObjectId(replyTo)) {
        return res.status(400).json({ message: "Invalid reply message." });
      }
      replyMessage = await Message.findOne({
        _id: replyTo,
        conversation: conversationId,
      });
      if (!replyMessage) {
        return res.status(400).json({ message: "Reply target is not in this conversation." });
      }
    }

    const receiver = conversation.participants.find(
      (participant) => String(participant) !== String(req.user.userId),
    );
    const message = await Message.create({
      conversation: conversationId,
      sender: req.user.userId,
      receiver,
      clientMessageId,
      text,
      replyTo: replyMessage?._id || null,
      status: "sent",
    });

    conversation.lastMessage = message._id;
    conversation.lastMessageAt = message.createdAt;
    const unreadRecipient = String(receiver);
    const unreadCount = conversation.unreadCount?.get?.(unreadRecipient) || 0;
    conversation.unreadCount?.set(unreadRecipient, unreadCount + 1);
    await conversation.save();

    await message.populate("replyTo", "sender text messageType deleted deletedAt");
    req.app.get("io")?.to(`conversation:${conversationId}`).emit("message:new", message);
    req.app.get("io")?.emit("conversation:updated", {
      conversationId,
      recipientId: String(receiver),
    });
    return res.status(201).json({ message });
  } catch (error) {
    if (error?.code === 11000) {
      const message = await Message.findOne({
        conversation: req.params.conversationId,
        sender: req.user.userId,
        clientMessageId: req.body.clientMessageId,
      });
      if (message) return res.status(200).json({ message });
    }
    return res.status(500).json({ message: error.message || "Unable to send message." });
  }
};

exports.markRead = async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    participants: req.user.userId,
  });
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  conversation.unreadCount?.set(String(req.user.userId), 0);
  await conversation.save();
  await Message.updateMany(
    {
      conversation: conversation._id,
      receiver: req.user.userId,
      status: { $ne: "read" },
      deleted: false,
    },
    { status: "read", readAt: new Date() },
  );
  req.app.get("io")?.to(`conversation:${conversation._id}`).emit("message:read", {
    conversationId: conversation._id,
    readerId: req.user.userId,
  });
  return res.status(200).json({ success: true });
};

exports.archiveConversation = async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    participants: req.user.userId,
  });
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $addToSet: { archivedBy: req.user.userId } },
  );
  req.app.get("io")?.emit("conversation:updated", {
    conversationId: conversation._id,
    recipientId: req.user.userId,
  });
  return res.status(200).json({ success: true });
};

exports.deleteMessage = async (req, res) => {
  const message = await Message.findOne({
    _id: req.params.messageId,
    conversation: req.params.conversationId,
    sender: req.user.userId,
  });
  if (!message) {
    return res.status(404).json({ message: "Message not found." });
  }

  message.deleted = true;
  message.deletedAt = new Date();
  await message.save();
  req.app.get("io")?.to(`conversation:${req.params.conversationId}`).emit("message:deleted", {
    conversationId: req.params.conversationId,
    messageId: message._id,
  });
  return res.status(200).json({ message });
};
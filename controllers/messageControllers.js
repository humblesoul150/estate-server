const mongoose = require("mongoose");
const { Readable } = require("stream");
const Conversation = require("../models/converation");
const Message = require("../models/message");
const Property = require("../models/property");
const cloudinary = require("../configs/cloudinary");
const logger = require("../configs/logger");

const isPlatformAdmin = (user) => user?.role === "admin";
const sameId = (left, right) => String(left) === String(right);
const conversationRoom = (id) => `conversation:${id}`;
const userRoom = (id) => `user:${id}`;

const emitConversationUpdated = (req, conversation) => {
  const io = req.app.get("io");
  if (!io) return;

  for (const participant of conversation.participants || []) {
    io.to(userRoom(participant)).emit("conversation:updated", {
      conversationId: String(conversation._id),
      recipientId: String(participant),
    });
  }
  if (conversation.type === "support") {
    io.to("support:admins").emit("conversation:updated", {
      conversationId: String(conversation._id),
      supportQueue: !conversation.supportAssignee,
    });
  }
};

const serializeConversation = (conversation, currentUserId, currentUserRole) => ({
  id: String(conversation._id),
  type: conversation.type || "property",
  property: conversation.property,
  supportUser: conversation.supportUser,
  supportAssignee: conversation.supportAssignee,
  participants: conversation.participants,
  lastMessage: conversation.lastMessage,
  lastMessageAt: conversation.lastMessageAt,
  unreadCount:
    isPlatformAdmin({ role: currentUserRole }) &&
    conversation.type === "support" &&
    !conversation.supportAssignee
      ? conversation.supportUnreadCount || 0
      : conversation.unreadCount?.get?.(String(currentUserId)) || 0,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const populateConversation = (query) =>
  query
    .populate("participants", "firstName lastName avatar role")
    .populate("supportUser", "firstName lastName avatar role")
    .populate("supportAssignee", "firstName lastName avatar role")
    .populate("lastMessage")
    .populate("property", "name address city country images");

const findParticipantConversation = (conversationId, userId) =>
  Conversation.findOne({
    _id: conversationId,
    participants: userId,
  });

const uploadAttachment = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "estate/messages", resource_type: "auto" },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      },
    );
    Readable.from(file.buffer).pipe(stream);
  });

const destroyAttachment = (publicId, resourceType) =>
  cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

const createAndEmitMessage = async ({
  req,
  conversation,
  text,
  clientMessageId,
  replyTo,
  attachment,
  messageType = "text",
}) => {
  const senderId = String(req.user.userId);
  const receiver = conversation.type === "support"
    ? (sameId(conversation.supportUser, senderId)
      ? conversation.supportAssignee
      : conversation.supportUser)
    : conversation.participants.find((participant) => !sameId(participant, senderId));

  const existing = await Message.findOne({
    conversation: conversation._id,
    sender: senderId,
    clientMessageId,
  });
  if (existing) return { message: existing, duplicate: true };

  let replyMessage = null;
  if (replyTo) {
    if (!mongoose.isValidObjectId(replyTo)) {
      const error = new Error("Invalid reply message.");
      error.status = 400;
      throw error;
    }
    replyMessage = await Message.findOne({
      _id: replyTo,
      conversation: conversation._id,
    });
    if (!replyMessage) {
      const error = new Error("Reply target is not in this conversation.");
      error.status = 400;
      throw error;
    }
  }

  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    receiver: receiver || null,
    clientMessageId,
    text,
    messageType,
    attachment,
    replyTo: replyMessage?._id || null,
    status: "sent",
  });

  const restoreIds = receiver ? [senderId, String(receiver)] : [senderId];
  const update = {
    $set: {
      lastMessage: message._id,
      lastMessageAt: message.createdAt,
    },
    $pull: { archivedBy: { $in: restoreIds } },
  };
  if (receiver) {
    update.$inc = { [`unreadCount.${String(receiver)}`]: 1 };
  } else if (conversation.type === "support") {
    update.$inc = { supportUnreadCount: 1 };
  }
  await Conversation.updateOne({ _id: conversation._id }, update);

  await message.populate("replyTo", "sender text messageType attachment deleted deletedAt");
  req.app.get("io")?.to(conversationRoom(conversation._id)).emit("message:new", message);
  emitConversationUpdated(req, conversation);
  return { message, duplicate: false };
};

exports.getOrCreatePropertyConversation = async (req, res) => {
  try {
    const propertyId = req.body?.propertyId;
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
    let conversation = await Conversation.findOne({ participantKey });
    if (!conversation) {
      try {
        conversation = await Conversation.create({
          type: "property",
          property: propertyId,
          participants: [userId, ownerId],
          participantKey,
          unreadCount: {},
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        conversation = await Conversation.findOne({ participantKey });
      }
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      { $pull: { archivedBy: userId } },
    );
    conversation = await populateConversation(
      Conversation.findById(conversation._id),
    );
    return res.status(200).json({
      conversation: serializeConversation(conversation, userId, req.user.role),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || "Unable to open conversation.",
    });
  }
};

exports.getOrCreateSupportConversation = async (req, res) => {
  if (isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: "Platform admins cannot start user support conversations." });
  }
  try {
    const userId = String(req.user.userId);
    const participantKey = `support:${userId}`;
    let conversation = await Conversation.findOne({ participantKey });
    if (!conversation) {
      try {
        conversation = await Conversation.create({
          type: "support",
          property: null,
          supportUser: userId,
          supportAssignee: null,
          participants: [userId],
          participantKey,
          unreadCount: {},
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        conversation = await Conversation.findOne({ participantKey });
      }
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      { $pull: { archivedBy: userId } },
    );
    conversation = await populateConversation(
      Conversation.findById(conversation._id),
    );
    return res.status(200).json({
      conversation: serializeConversation(conversation, userId, req.user.role),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to open support conversation.",
    });
  }
};

exports.listConversations = async (req, res) => {
  const userId = String(req.user.userId);
  const access = [{ participants: userId }];
  if (isPlatformAdmin(req.user)) {
    access.push({
      type: "support",
      supportAssignee: null,
    });
  }
  const conversations = await populateConversation(
    Conversation.find({
      $and: [
        {
          archivedBy: req.query.archived === "true"
            ? userId
            : { $ne: userId },
        },
        { $or: access },
      ],
    }).sort({ lastMessageAt: -1, updatedAt: -1 }),
  );

  return res.status(200).json({
    conversations: conversations.map((conversation) =>
      serializeConversation(conversation, userId, req.user.role),
    ),
  });
};

exports.claimSupportConversation = async (req, res) => {
  if (!isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: "Only platform admins can claim support conversations." });
  }
  if (!mongoose.isValidObjectId(req.params.conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }

  const adminId = String(req.user.userId);
  let conversation = await Conversation.findOneAndUpdate(
    {
      _id: req.params.conversationId,
      type: "support",
      $or: [{ supportAssignee: null }, { supportAssignee: adminId }],
    },
    {
      $set: { supportAssignee: adminId },
      $addToSet: { participants: adminId },
    },
    { new: true },
  );
  if (!conversation) {
    const existing = await Conversation.findOne({
      _id: req.params.conversationId,
      type: "support",
    }).select("supportAssignee");
    if (!existing) return res.status(404).json({ message: "Support conversation not found." });
    return res.status(409).json({ message: "This support conversation is assigned to another administrator." });
  }

  const pendingCount = await Message.countDocuments({
    conversation: conversation._id,
    sender: conversation.supportUser,
    receiver: null,
    status: "sent",
    deleted: false,
    deleted: false,
  });
  await Message.updateMany(
    {
      conversation: conversation._id,
      sender: conversation.supportUser,
      receiver: null,
      status: "sent",
      deleted: false,
    },
    { $set: { receiver: adminId } },
  );
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        [`unreadCount.${adminId}`]: pendingCount,
        supportUnreadCount: 0,
      },
      $pull: { archivedBy: adminId },
    },
  );
  conversation = await populateConversation(
    Conversation.findById(conversation._id),
  );
  emitConversationUpdated(req, conversation);
  return res.status(200).json({
    conversation: serializeConversation(conversation, adminId, req.user.role),
  });
};

exports.listMessages = async (req, res) => {
  const { conversationId } = req.params;
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }

  const conversation = await findParticipantConversation(
    conversationId,
    req.user.userId,
  );
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 100))
    : 30;
  const query = { conversation: conversationId };
  if (req.query.before) {
    if (!mongoose.isValidObjectId(req.query.before)) {
      return res.status(400).json({ message: "Invalid message cursor." });
    }
    const before = await Message.findOne({
      _id: req.query.before,
      conversation: conversationId,
    }).select("createdAt _id");
    if (!before) {
      return res.status(400).json({ message: "Message cursor is not in this conversation." });
    }
    query.$or = [
      { createdAt: { $lt: before.createdAt } },
      { createdAt: before.createdAt, _id: { $lt: before._id } },
    ];
  }

  const results = await Message.find(query)
    .populate("replyTo", "sender text messageType attachment deleted deletedAt")
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  const hasMore = results.length > limit;
  const messages = results.slice(0, limit).reverse();

  return res.status(200).json({
    messages,
    hasMore,
    nextCursor: hasMore ? messages[0]?._id || null : null,
  });
};

exports.sendMessage = async (req, res) => {
  const { conversationId } = req.params;
  const body = req.body || {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const clientMessageId = String(body.clientMessageId || "").trim();
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }
  if (!text || text.length > 4000) {
    return res.status(400).json({ message: "Message text must be between 1 and 4000 characters." });
  }
  if (!clientMessageId || clientMessageId.length > 100) {
    return res.status(400).json({ message: "clientMessageId is required." });
  }

  try {
    const conversation = await findParticipantConversation(
      conversationId,
      req.user.userId,
    );
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    const { message, duplicate } = await createAndEmitMessage({
      req,
      conversation,
      text,
      clientMessageId,
      replyTo: body.replyTo,
    });
    return res.status(duplicate ? 200 : 201).json({ message });
  } catch (error) {
    if (error?.code === 11000) {
      const message = await Message.findOne({
        conversation: conversationId,
        sender: req.user.userId,
        clientMessageId,
      });
      if (message) return res.status(200).json({ message });
    }
    return res.status(error.status || 500).json({
      message: error.message || "Unable to send message.",
    });
  }
};

exports.sendAttachment = async (req, res) => {
  const { conversationId } = req.params;
  const body = req.body || {};
  const clientMessageId = String(body.clientMessageId || "").trim();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }
  if (!clientMessageId || clientMessageId.length > 100) {
    return res.status(400).json({ message: "clientMessageId is required." });
  }
  if (text.length > 4000) {
    return res.status(400).json({ message: "Message text cannot exceed 4000 characters." });
  }
  if (!req.file) {
    return res.status(400).json({ message: "An attachment is required." });
  }

  const supportedTypes = new Map([
    ["image/jpeg", { type: "image", resourceType: "image" }],
    ["image/png", { type: "image", resourceType: "image" }],
    ["image/webp", { type: "image", resourceType: "image" }],
    ["image/heic", { type: "image", resourceType: "image" }],
    ["image/heif", { type: "image", resourceType: "image" }],
    ["video/mp4", { type: "video", resourceType: "video" }],
    ["video/quicktime", { type: "video", resourceType: "video" }],
    ["application/pdf", { type: "file", resourceType: "raw" }],
    ["text/plain", { type: "file", resourceType: "raw" }],
  ]);
  const fileType = supportedTypes.get(req.file.mimetype);
  if (!fileType) {
    return res.status(415).json({ message: "This attachment type is not supported." });
  }

  let uploaded;
  try {
    const conversation = await findParticipantConversation(
      conversationId,
      req.user.userId,
    );
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found." });
    }
    const existing = await Message.findOne({
      conversation: conversationId,
      sender: req.user.userId,
      clientMessageId,
    });
    if (existing) return res.status(200).json({ message: existing });

    uploaded = await uploadAttachment(req.file);
    if (!uploaded?.secure_url || !uploaded?.public_id) {
      throw new Error("Attachment storage did not return a usable file reference.");
    }
    const fileName = String(req.file.originalname || "attachment")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 180);
    const { message } = await createAndEmitMessage({
      req,
      conversation,
      text,
      clientMessageId,
      replyTo: body.replyTo,
      messageType: fileType.type,
      attachment: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        fileName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        resourceType: uploaded.resource_type || fileType.resourceType,
      },
    });
    return res.status(201).json({ message });
  } catch (error) {
    if (uploaded?.public_id) {
      try {
        await destroyAttachment(
          uploaded.public_id,
          uploaded.resource_type || fileType.resourceType,
        );
      } catch (cleanupError) {
        logger.error("Unable to clean up an unused message attachment", {
          message: cleanupError.message,
          publicId: uploaded.public_id,
        });
      }
    }
    if (error?.code === 11000) {
      const message = await Message.findOne({
        conversation: conversationId,
        sender: req.user.userId,
        clientMessageId,
      });
      if (message) return res.status(200).json({ message });
    }
    return res.status(error.status || 500).json({
      message: error.message || "Unable to send attachment.",
    });
  }
};

exports.markRead = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }
  const conversation = await findParticipantConversation(
    req.params.conversationId,
    req.user.userId,
  );
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const readerId = String(req.user.userId);
  const unreadUpdate = { $set: { [`unreadCount.${readerId}`]: 0 } };
  if (conversation.type === "support" && sameId(conversation.supportAssignee, readerId)) {
    unreadUpdate.$set.supportUnreadCount = 0;
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    unreadUpdate,
  );
  await Message.updateMany(
    {
      conversation: conversation._id,
      receiver: readerId,
      status: { $ne: "read" },
      deleted: false,
    },
    { status: "read", readAt: new Date() },
  );
  req.app.get("io")?.to(conversationRoom(conversation._id)).emit("message:read", {
    conversationId: String(conversation._id),
    readerId,
  });
  emitConversationUpdated(req, conversation);
  return res.status(200).json({ success: true });
};

exports.archiveConversation = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }
  const conversation = await findParticipantConversation(
    req.params.conversationId,
    req.user.userId,
  );
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $addToSet: { archivedBy: req.user.userId } },
  );
  conversation.archivedBy = [...(conversation.archivedBy || []), req.user.userId];
  emitConversationUpdated(req, conversation);
  return res.status(200).json({ success: true, hidden: true });
};

exports.restoreConversation = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.conversationId)) {
    return res.status(400).json({ message: "Invalid conversation." });
  }
  const conversation = await findParticipantConversation(
    req.params.conversationId,
    req.user.userId,
  );
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $pull: { archivedBy: req.user.userId } },
  );
  conversation.archivedBy = (conversation.archivedBy || []).filter(
    (userId) => !sameId(userId, req.user.userId),
  );
  emitConversationUpdated(req, conversation);
  return res.status(200).json({ success: true, restored: true });
};

exports.deleteMessage = async (req, res) => {
  if (
    !mongoose.isValidObjectId(req.params.conversationId) ||
    !mongoose.isValidObjectId(req.params.messageId)
  ) {
    return res.status(400).json({ message: "Invalid message." });
  }
  const message = await Message.findOne({
    _id: req.params.messageId,
    conversation: req.params.conversationId,
    sender: req.user.userId,
  });
  if (!message) {
    return res.status(404).json({ message: "Message not found." });
  }

  const wasPendingSupportMessage =
    !message.deleted &&
    (message.receiver === null || message.receiver === undefined) &&
    message.status === "sent";
  if (message.attachment?.publicId) {
    try {
      const resourceType = message.attachment.resourceType ||
        (message.messageType === "image" || message.messageType === "video"
          ? message.messageType
          : "raw");
      await destroyAttachment(message.attachment.publicId, resourceType);
    } catch (error) {
      logger.error("Unable to remove deleted message attachment", {
        message: error.message,
        publicId: message.attachment.publicId,
      });
      return res.status(502).json({
        message: "Unable to remove the message attachment. Please try again.",
      });
    }
  }

  message.deleted = true;
  message.deletedAt = new Date();
  message.text = "";
  message.attachment = undefined;
  await message.save();
  const conversation = await Conversation.findById(req.params.conversationId);
  if (
    wasPendingSupportMessage &&
    conversation?.type === "support" &&
    !conversation.supportAssignee &&
    sameId(message.sender, conversation.supportUser)
  ) {
    await Conversation.updateOne(
      { _id: conversation._id, supportUnreadCount: { $gt: 0 } },
      { $inc: { supportUnreadCount: -1 } },
    );
    conversation.supportUnreadCount = Math.max(
      0,
      (conversation.supportUnreadCount || 0) - 1,
    );
  }
  req.app.get("io")?.to(conversationRoom(req.params.conversationId)).emit("message:deleted", {
    conversationId: req.params.conversationId,
    messageId: String(message._id),
  });
  if (conversation) emitConversationUpdated(req, conversation);
  return res.status(200).json({ message });
};

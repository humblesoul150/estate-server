const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Conversation = require("./models/converation");
const Message = require("./models/message");
const dotenv = require("dotenv");
const cors = require("cors");
const { connectDb } = require("./configs/connectDb");
const logger = require("./configs/logger");
dotenv.config();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});
app.set("io", io);

io.use((socket, next) => {
  const authToken = socket.handshake.auth?.token;
  const headerToken = socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = authToken || headerToken;
  if (!token) return next(new Error("Authentication required"));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.user.userId);
  socket.join(`user:${userId}`);
  if (socket.user.role === "admin") socket.join("support:admins");

  socket.on("conversation:join", async (conversationId, acknowledge = () => {}) => {
    const acknowledgeSafely =
      typeof acknowledge === "function" ? acknowledge : () => {};
    try {
      if (!mongoose.isValidObjectId(conversationId)) {
        return acknowledgeSafely({ success: false, message: "Invalid conversation." });
      }
      const conversation = await Conversation.findOne({
        _id: conversationId,
        $or: [
          { participants: userId },
          {
            type: "support",
            supportAssignee: userId,
          },
        ],
      }).select("_id");
      if (!conversation) {
        return acknowledgeSafely({ success: false, message: "Conversation not found." });
      }
      socket.join(`conversation:${conversationId}`);
      await Message.updateMany(
        {
          conversation: conversationId,
          receiver: userId,
          status: "sent",
          deleted: false,
        },
        { status: "delivered", deliveredAt: new Date() },
      );
      socket.to(`conversation:${conversationId}`).emit("message:status", {
        conversationId,
        status: "delivered",
        receiverId: userId,
      });
      return acknowledgeSafely({ success: true, conversationId });
    } catch (error) {
      logger.error("Unable to join messaging conversation", {
        message: error.message,
      });
      return acknowledgeSafely({ success: false, message: "Unable to join conversation." });
    }
  });

  socket.on("typing:start", async (conversationId) => {
    try {
      if (!mongoose.isValidObjectId(conversationId)) return;
      const conversation = await Conversation.exists({
        _id: conversationId,
        $or: [
          { participants: userId },
          { type: "support", supportAssignee: userId },
        ],
      });
      if (!conversation) return;
      socket.to(`conversation:${conversationId}`).emit("typing:start", {
        conversationId,
        userId,
      });
    } catch (error) {
      logger.error("Unable to process typing event", { message: error.message });
    }
  });

  socket.on("typing:stop", async (conversationId) => {
    try {
      if (!mongoose.isValidObjectId(conversationId)) return;
      const conversation = await Conversation.exists({
        _id: conversationId,
        $or: [
          { participants: userId },
          { type: "support", supportAssignee: userId },
        ],
      });
      if (!conversation) return;
      socket.to(`conversation:${conversationId}`).emit("typing:stop", {
        conversationId,
        userId,
      });
    } catch (error) {
      logger.error("Unable to process typing event", { message: error.message });
    }
  });

  socket.on("message:delivered", async (payload = {}) => {
    try {
      const { conversationId, messageId } = payload || {};
      if (
        !mongoose.isValidObjectId(conversationId) ||
        !mongoose.isValidObjectId(messageId)
      ) return;
      const conversation = await Conversation.exists({
        _id: conversationId,
        participants: userId,
      });
      if (!conversation) return;
      const result = await Message.updateOne(
        {
          _id: messageId,
          conversation: conversationId,
          receiver: userId,
          status: "sent",
          deleted: false,
        },
        { status: "delivered", deliveredAt: new Date() },
      );
      if (!result.modifiedCount) return;
      io.to(`conversation:${conversationId}`).emit("message:status", {
        conversationId,
        messageId,
        status: "delivered",
        receiverId: userId,
      });
    } catch (error) {
      logger.error("Unable to update message delivery status", {
        message: error.message,
      });
    }
  });

  socket.on("disconnecting", () => {
    for (const room of socket.rooms) {
      if (!room.startsWith("conversation:")) continue;
      const conversationId = room.slice("conversation:".length);
      socket.to(room).emit("typing:stop", { conversationId, userId });
    }
  });
});

const PORT = process.env.PORT || 4444;
const HOST = process.env.HOST || "0.0.0.0";
app.use(cors());
app.use(express.json());

// Connect to DB, then start server
if (process.env.SKIP_DB === "true") {
  logger.warn("Skipping database connection for testing");

  httpServer.listen(PORT, HOST, () => {
    logger.info(
      `Server running at http://${HOST}:${PORT} in ${process.env.NODE_ENV || "development"} mode (DB SKIPPED)`,
    );
  });
} else {
  connectDb(process.env.DB_URL)
    .then(() => {
      httpServer.listen(PORT, HOST, () => {
        logger.info(
          `Server running at http://${HOST}:${PORT} in ${process.env.NODE_ENV || "development"} mode`,
        );
      });
    })
    .catch((err) => {
      logger.error("Failed to start server due to DB connection error", err);
      process.exit(1);
    });
}

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy" });
});

//Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const propertyRoutes = require("./routes/propertyRoutes");
const dealRoutes = require("./routes/dealRoutes");
const messageRoutes = require("./routes/messageRoutes");

//use routes
app.use("/api", reviewRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/deals", dealRoutes);
app.use("/api", messageRoutes);

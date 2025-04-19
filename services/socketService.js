const { Server } = require("socket.io");
const redis = require("../config/redis");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const mongoose = require("mongoose");

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*", 
      methods: ["GET", "POST"],
    },
  });

  // Centralized user socket management
  const userSockets = new Map();
  const getUserIdBySocketId = (socketId) => {
    for (const [userId, storedSocketId] of userSockets.entries()) {
      if (storedSocketId === socketId) return userId;
    }
    return null;
  };
  // Authentication middleware
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }

    try {
      const extractedToken = token.startsWith("Bearer ")
        ? token.split(" ")[1]
        : token;

      const decoded = jwt.verify(extractedToken, process.env.JWT_SECRET);
      socket.user = decoded;
      userSockets.set(decoded.id, socket.id);

      next();
    } catch (error) {
      console.error("JWT Verification Failed:", error.message);
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Global Redis message subscription
  redis.subscribe("chat", async (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      const recipientSocketId = userSockets.get(parsedMessage.recipient);
      const senderSockerId = userSockets.get(parsedMessage.sender);

      if (recipientSocketId) {
        io.to(recipientSocketId).emit("receive_Message", parsedMessage);
      }
      if (senderSockerId) {
        io.to(senderSockerId).emit("receive_Message", parsedMessage);
      }
    } catch (error) {
      console.error("Error processing Redis message:", error);
    }
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Send Message Handler
    socket.on("send_Message", async ({ sender, recipient, content }) => {
      try {
        // Validate input
        if (!sender || !recipient || !content) {
          return socket.emit("error", "Missing required fields");
        }

        // Find or create conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [sender, recipient] },
        });

        if (!conversation) {
          conversation = await new Conversation({
            participants: [sender, recipient],
            lastMessage: content,
            lastMessageTime: Date.now(),
          }).save();
        }

        // Create and save message
        const message = await new Message({
          conversationId: conversation._id,
          sender,
          recipient,
          content,
        }).save();

        // Update conversation
        await conversation.updateOne({
          lastMessage: content,
          lastMessageTime: Date.now(),
        });

        // Prepare message for publishing
        const messageToPublish = {
          _id: message._id, // Include message ID for client reference
          conversationId: conversation._id,
          sender,
          recipient,
          content,
          timestamp: message.createdAt,        };

        // Publish to Redis (centralized message distribution)
        redis.publish("chat", JSON.stringify(messageToPublish));
      } catch (error) {
        console.error("Error in send_Message:", error);
        socket.emit("error", "Failed to send message");
      }
    });

    // Get Conversations Handler
    socket.on("Get_Conversations", async (payload) => {
      try {
        if (!payload || !payload.userId) {
          return socket.emit("error", {
            message: "User ID is required",
            code: "INVALID_INPUT",
          });
        }
        const connectedUserID = getUserIdBySocketId(socket.id);

        if (!connectedUserID) {
          return socket.emit("error", { message: "User not authenticated" });
        }
        if (!connectedUserID == payload.userId) {
          return socket.emit("error", {
            message: "You are not Authorized to get these conversations.",
          });
        }

        const { userId, page = 1, limit = 12 } = payload;
        const skip = (page - 1) * limit;

        const conversations = await Conversation.aggregate([
          {
            $match: {
              participants: new mongoose.Types.ObjectId(userId),
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "participants",
              foreignField: "_id",
              as: "participantDetails",
              pipeline: [
                {
                  $lookup: {
                    from: 'categories',
                    localField: "category",
                    foreignField: "_id",
                    as: "categoryDetails",
                  }
                },
                {$unwind: {path: "$categoryDetails", preserveNullAndEmptyArrays: true}}
              ],
            },
          },
          {
            $addFields: {
              otherParticipants: {
                $filter: {
                  input: "$participantDetails",
                  as: "participant",
                  cond: {
                    $ne: [
                      "$$participant._id",
                      new mongoose.Types.ObjectId(userId),
                    ],
                  },
                },
              },
            },
          },
          {
            $lookup: {
              from: "messages",
              let: { conversationId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$conversationId", "$$conversationId"] },
                  },
                },
                { $sort: { createdAt: -1 } },
                { $limit: 1 },
              ],
              as: "lastMessageDetails",
            },
          },
          {
            $unwind: {
              path: "$lastMessageDetails",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              // lastMessage: "$lastMessageDetails.content",
              lastMessage: 1,
              lastMessageTime: "$lastMessageDetails.timestamp",
              
              otherParticipant: {
                _id: { $arrayElemAt: ["$otherParticipants._id", 0] },
                category: { $arrayElemAt: ["$otherParticipants.categoryDetails.name", 0] },
                fullName: { $arrayElemAt: ["$otherParticipants.fullName", 0] },
                profilePicUrl: {
                  $arrayElemAt: ["$otherParticipants.profilePicUrl", 0],
                },
              },
            },
          },
          { $sort: { lastMessageTime: -1 } },
          { $skip: skip },
          { $limit: limit },
        ]);

        const totalConversations = await Conversation.countDocuments({
          participants: new mongoose.Types.ObjectId(userId),
        });

        if (!conversations.length) {
          return socket.emit("Conversations", {
            conversations: [],
            message: "No conversations found",
            page,
            totalPages: Math.ceil(totalConversations / limit),
          });
        }

        socket.emit("Conversations", {
          conversations,
          page,
          totalPages: Math.ceil(totalConversations / limit),
        });
      } catch (error) {
        console.error("Error in Get_Conversations:", error);

        socket.emit("error", {
          message: "Failed to fetch conversations",
          code: "FETCH_CONVERSATIONS_ERROR",
          details: error.message,
        });
      }
    });

    // Get Recent Messages Handler
    socket.on("Get_Recent_Messages", async ({ conversationId, page = 1 }) => {
      try {
        if (!conversationId) {
          return socket.emit("error", {
            message: "Conversation ID is required",
            code: "INVALID_INPUT",
          });
        }
        const limit = 15;
        const skip = (page - 1) * limit;

        const userId = getUserIdBySocketId(socket.id);

        if (!userId) {
          return socket.emit("error", { message: "User not authenticated" });
        }
        const isParticipant = await Conversation.findOne({
          _id: conversationId,
          participants: userId, // Check if userId exists in participants array
        });

        if (!isParticipant) {
          return socket.emit("error", {
            message: "Access denied. Not a participant",
          });
        }

        const messages = await Message.find({ conversationId })
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .select("conversationId sender recipient content timestamp"); // Only required fields

        const totalMessages = await Message.countDocuments({ conversationId });

        socket.emit("Recent_Messages", {
          messages,
          conversation: isParticipant,
          page,
          totalPages: Math.ceil(totalMessages / limit),
        });
      } catch (error) {
        console.error("Error in Get_Recent_Messages:", error);
        socket.emit("error", {
          message: "Failed to fetch recent messages",
          code: "FETCH_MESSAGES_ERROR",
          details: error.message,
        });
      }
    });

    // Disconnect Handler
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      userSockets.delete(socket.user?.id);
    });
  });

  return io;
};

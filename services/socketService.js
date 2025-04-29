const { Server } = require("socket.io");
const redis = require("../config/redis");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const Category = require("../models/Category");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const mongoose = require("mongoose");
const Review = require("../models/Review");

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*", // More secure origin handling
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

        // If message is a job offer, populate category details
        if (parsedMessage.messageType === 'job_offer' && parsedMessage.categoryId) {
          const category = await Category.findById(parsedMessage.categoryId).select('name');
          if (category) {
            parsedMessage.categoryDetails = {
              _id: category._id,
              name: category.name
            };
          }
        }

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

    // Subscribe to chat updates
    redis.subscribe("chat_update", async (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const recipientSocketId = userSockets.get(parsedMessage.recipient);
        const senderSocketId = userSockets.get(parsedMessage.sender);

        if (recipientSocketId) {
          io.to(recipientSocketId).emit("chat_update", parsedMessage);
        }
        if (senderSocketId) {
          io.to(senderSocketId).emit("chat_update", parsedMessage);
        }
      } catch (error) {
        console.error("Error processing Redis chat update:", error);
      }
    });

    // Subscribe to job status updates
    redis.subscribe("job_status_update", async (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const recipientSocketId = userSockets.get(parsedMessage.recipient);
        const senderSocketId = userSockets.get(parsedMessage.sender);

        if (recipientSocketId) {
          io.to(recipientSocketId).emit("job_status_update", parsedMessage);
        }
        if (senderSocketId) {
          io.to(senderSocketId).emit("job_status_update", parsedMessage);
        }
      } catch (error) {
        console.error("Error processing Redis job status update:", error);
      }
    });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Send Message Handler
    socket.on("send_Message", async ({ sender, recipient, content, messageType, categoryId, newConversation }) => {
      try {
        // Validate input
        if (!sender || !recipient || !content) {
          return socket.emit("error", "Missing required fields");
        }

        // Additional validation for job offer messages
        if (messageType === 'job_offer' && !categoryId) {
          return socket.emit("error", "Category ID is required for job offer messages");
        }

        // Find existing conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [sender, recipient] },
        });

        // Handle new conversation case
        if (newConversation) {
          if (conversation) {
            const messageToPublish = {
              conversationId: conversation._id,
              sender,
              recipient,
              content,
              messageType: 'text',
            };
            return redis.publish("chat", JSON.stringify(messageToPublish));
            // If conversation exists, don't send message
            // return socket.emit("error", "Conversation already exists");
          }
          // If conversation doesn't exist, create it
          conversation = await new Conversation({
            participants: [sender, recipient],
            lastMessage: content,
            lastMessageTime: Date.now(),
          }).save();
        } 
        // Handle existing conversation case
        else {
          if (!conversation) {
            // If conversation doesn't exist, create it
            conversation = await new Conversation({
              participants: [sender, recipient],
              lastMessage: content,
              lastMessageTime: Date.now(),
            }).save();
          }
        }

        // Create and save message
        const message = await new Message({
          conversationId: conversation._id,
          sender,
          recipient,
          content,
          messageType: messageType || 'text',
          categoryId: messageType === 'job_offer' ? categoryId : undefined,
          jobOfferStatus: messageType === 'job_offer' ? 'pending' : undefined,
          createdAt: Date.now(),
        }).save();

        // Update conversation
        await conversation.updateOne({
          lastMessage: content,
          lastMessageTime: Date.now(),
        });

        // Prepare message for publishing
        const messageToPublish = {
          _id: message._id,
          conversationId: conversation._id,
          sender,
          recipient,
          content,
          messageType: message.messageType,
          categoryId: message.categoryId,
          jobOfferStatus: message.jobOfferStatus,
          createdAt: message.createdAt
        };

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
              as: "participantDetails"
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
              lastMessageTime: "$lastMessageDetails.createdAt",
              
              otherParticipant: {
                _id: { $arrayElemAt: ["$otherParticipants._id", 0] },
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
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("conversationId sender recipient content messageType categoryId jobOfferStatus reviewId createdAt");

        // Populate category details for job offer messages and review details for completed jobs
        const messagesWithDetails = await Promise.all(messages.map(async (message) => {
          const messageObj = message.toObject(); // Convert Mongoose document to plain object
          
          // Populate category details for job offer messages
          if (messageObj.messageType === 'job_offer' && messageObj.categoryId) {
            const category = await Category.findById(messageObj.categoryId).select('name');
            if (category) {
              messageObj.categoryDetails = {
                _id: category._id,
                name: category.name
              };
            }
          }
          
          // Populate review details for completed job offers
          if (messageObj.messageType === 'job_offer' && 
              messageObj.jobOfferStatus === 'completed' && 
              messageObj.reviewId) {
            const review = await Review.findById(messageObj.reviewId).select('stars comment');
            if (review) {
              messageObj.reviewDetails = {
                stars: review.stars,
                comment: review.comment
              };
            }
          }
          
          return messageObj;
        }));

        const totalMessages = await Message.countDocuments({ conversationId });

        socket.emit("Recent_Messages", {
          messages: messagesWithDetails,
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

    // Accept Job Offer Handler
    socket.on("accept_Job_Offer", async ({ messageId, userId }) => {
      try {
        if (!messageId || !userId) {
          return socket.emit("error", "Message ID and User ID are required");
        }

        // Find the message
        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit("error", "Message not found");
        }

        // Verify the user is the recipient
        if (message.recipient.toString() !== userId) {
          return socket.emit("error", "You are not authorized to accept this job offer");
        }

        // Verify it's a job offer message
        if (message.messageType !== 'job_offer') {
          return socket.emit("error", "This is not a job offer message");
        }

        // Check if job offer is already accepted
        if (message.jobOfferStatus === 'accepted') {
          return socket.emit("error", "This job offer has already been accepted");
        }

        // Update the message status
        message.jobOfferStatus = 'accepted';
        await message.save();

        // Prepare update message
        const updateMessage = {
          _id: message._id,
          conversationId: message.conversationId,
          sender: message.sender,
          recipient: message.recipient,
          content: message.content,
          messageType: message.messageType,
          categoryId: message.categoryId,
          jobOfferStatus: message.jobOfferStatus,
          updatedAt: message.updatedAt
        };

        // Publish the update to Redis
        redis.publish("chat_update", JSON.stringify(updateMessage));

        // Create and send a new message about job acceptance
        const acceptanceMessage = await new Message({
          conversationId: message.conversationId,
          sender: userId,
          recipient: message.sender,
          content: 'Auto Message: Job accepted',
          messageType: 'text',
          createdAt: Date.now(),
        }).save();

        // Prepare acceptance message for publishing
        const messageToPublish = {
          _id: acceptanceMessage._id,
          conversationId: acceptanceMessage.conversationId,
          sender: acceptanceMessage.sender,
          recipient: acceptanceMessage.recipient,
          content: acceptanceMessage.content,
          messageType: acceptanceMessage.messageType,
          createdAt: acceptanceMessage.createdAt
        };

        // Publish the acceptance message to Redis
        redis.publish("chat", JSON.stringify(messageToPublish));

      } catch (error) {
        console.error("Error in accept_Job_Offer:", error);
        socket.emit("error", "Failed to accept job offer");
      }
    });

    // Mark Job as Completed Handler
    socket.on("mark_job_completed", async ({ messageId, userId }) => {
      try {
        if (!messageId || !userId) {
          return socket.emit("error", "Message ID and User ID are required");
        }

        // Find the message
        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit("error", "Message not found");
        }

        // Verify the user is the recipient
        if (message.recipient.toString() !== userId) {
          return socket.emit("error", "You are not authorized to mark this job as completed");
        }

        // Verify it's a job offer message
        if (message.messageType !== 'job_offer') {
          return socket.emit("error", "This is not a job offer message");
        }

        // Check if job offer is accepted
        if (message.jobOfferStatus !== 'accepted') {
          return socket.emit("error", "Only accepted jobs can be marked as completed");
        }

        // Update the message status
        message.jobOfferStatus = 'completed';
        await message.save();

        // Prepare update message
        const updateMessage = {
          _id: message._id,
          conversationId: message.conversationId,
          sender: message.sender,
          recipient: message.recipient,
          content: message.content,
          messageType: message.messageType,
          categoryId: message.categoryId,
          jobOfferStatus: message.jobOfferStatus,
          updatedAt: message.updatedAt
        };

        // Publish the update to Redis
        redis.publish("chat_update", JSON.stringify(updateMessage));

        // Prepare job status update message
        const jobStatusUpdate = {
          sender: message.sender,
          recipient: message.recipient,
        };

        // Publish job status update to Redis
        redis.publish("job_status_update", JSON.stringify(jobStatusUpdate));

        // Create and send a new message about job completion
        const completionMessage = await new Message({
          conversationId: message.conversationId,
          sender: userId,
          recipient: message.sender,
          content: 'Auto Message: Job is completed/delivered',
          messageType: 'text',
          createdAt: Date.now(),
        }).save();

        // Prepare completion message for publishing
        const messageToPublish = {
          _id: completionMessage._id,
          conversationId: completionMessage.conversationId,
          sender: completionMessage.sender,
          recipient: completionMessage.recipient,
          content: completionMessage.content,
          messageType: completionMessage.messageType,
          createdAt: completionMessage.createdAt
        };

        // Publish the completion message to Redis
        redis.publish("chat", JSON.stringify(messageToPublish));

      } catch (error) {
        console.error("Error in mark_job_completed:", error);
        socket.emit("error", "Failed to mark job as completed");
      }
    });

    // Leave Review Handler
    socket.on("leave_review", async ({ messageId, userId, stars, comment }) => {
      try {
        if (!messageId || !userId || !stars || !comment) {
          return socket.emit("error", "Message ID, User ID, stars, and comment are required");
        }

        // Find the message
        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit("error", "Message not found");
        }

        // Verify the user is the sender
        if (message.sender.toString() !== userId) {
          return socket.emit("error", "Only the job sender can leave a review");
        }

        // Verify it's a job offer message and is completed
        if (message.messageType !== 'job_offer' || message.jobOfferStatus !== 'completed') {
          return socket.emit("error", "Reviews can only be left on completed jobs");
        }

        // Check if review already exists
        if (message.reviewId) {
          return socket.emit("error", "A review has already been left for this job");
        }

        // Validate stars
        if (stars < 1 || stars > 5) {
          return socket.emit("error", "Stars must be between 1 and 5");
        }

        // Create the review
        const review = await new Review({
          messageId: message._id,
          stars,
          comment,
          receiver: message.recipient
        }).save();

        // Update the message with the review ID
        message.reviewId = review._id;
        await message.save();

        // Prepare update message with review details
        const updateMessage = {
          _id: message._id,
          conversationId: message.conversationId,
          sender: message.sender,
          recipient: message.recipient,
          content: message.content,
          messageType: message.messageType,
          reviewId: message.reviewId,
          jobOfferStatus: message.jobOfferStatus,
          reviewDetails: {
            stars: review.stars,
            comment: review.comment
          },
          updatedAt: message.updatedAt
        };

        // Publish the update to Redis
        redis.publish("chat_update", JSON.stringify(updateMessage));

      } catch (error) {
        console.error("Error in leave_review:", error);
        socket.emit("error", "Failed to leave review");
      }
    });

    // Get Service Provider Stats Handler
    socket.on("get_service_provider_stats", async (userId) => {
      try {
        if (!userId) {
          return socket.emit("error", {
            message: "User ID is required",
            code: "INVALID_INPUT"
          });
        }

        const connectedUserId = getUserIdBySocketId(socket.id);
        if (!connectedUserId || connectedUserId !== userId) {
          return socket.emit("error", {
            message: "Unauthorized access",
            code: "UNAUTHORIZED"
          });
        }

        // Get completed jobs (accepted job offers)
        const completedJobs = await Message.countDocuments({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'completed'
        });

        // Get pending jobs (pending job offers)
        const pendingJobs = await Message.countDocuments({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'pending'
        });

        // Get accepted jobs (accepted job offers)
        const acceptedJobs = await Message.countDocuments({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'accepted'
        });

        // Get recent completed jobs with details
        const recentCompletedJobs = await Message.find({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'completed'
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate({
          path: 'sender',
          select: 'fullName location phoneNumber'
        })
        .populate({
          path: 'categoryId',
          select: 'name'
        })
        .populate({
          path: 'reviewId',
          select: 'stars comment'
        })
        .select('content createdAt reviewId');

        // Get recent pending jobs with details
        const recentPendingJobs = await Message.find({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'pending'
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate({
          path: 'sender',
          select: 'fullName location phoneNumber'
        })
        .populate({
          path: 'categoryId',
          select: 'name'
        })
        .select('content createdAt');

        // Get recent accepted jobs with details
        const recentAcceptedJobs = await Message.find({
          recipient: userId,
          messageType: 'job_offer',
          jobOfferStatus: 'accepted'
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate({
          path: 'sender',
          select: 'fullName location phoneNumber'
        })
        .populate({
          path: 'categoryId',
          select: 'name'
        })
        .select('content createdAt');

        socket.emit("service_provider_stats", {
          completedJobs,
          pendingJobs,
          acceptedJobs,
          totalJobs: completedJobs + pendingJobs + acceptedJobs,
          recentCompletedJobs: recentCompletedJobs.map(job => ({
            categoryName: job.categoryId?.name || 'Unknown Category',
            senderName: job.sender?.fullName || 'Unknown Sender',
            address: job.sender?.location || 'No Address Provided',
            phoneNumber: job.sender?.phoneNumber || 'No Phone Provided',
            content: job.content,
            date: job.createdAt,
            status: 'completed',
            reviewDetails: job.reviewId ? {
              stars: job.reviewId.stars,
              comment: job.reviewId.comment
            } : null
          })),
          recentPendingJobs: recentPendingJobs.map(job => ({
            categoryName: job.categoryId?.name || 'Unknown Category',
            senderName: job.sender?.fullName || 'Unknown Sender',
            address: job.sender?.location || 'No Address Provided',
            phoneNumber: job.sender?.phoneNumber || 'No Phone Provided',
            content: job.content,
            date: job.createdAt,
            status: 'pending'
          })),
          recentAcceptedJobs: recentAcceptedJobs.map(job => ({
            _id: job._id,
            categoryName: job.categoryId?.name || 'Unknown Category',
            senderName: job.sender?.fullName || 'Unknown Sender',
            address: job.sender?.location || 'No Address Provided',
            phoneNumber: job.sender?.phoneNumber || 'No Phone Provided',
            content: job.content,
            date: job.createdAt,
            status: 'accepted'
          }))
        });
      } catch (error) {
        console.error("Error in get_service_provider_stats:", error);
        socket.emit("error", {
          message: "Failed to fetch service provider stats",
          code: "FETCH_STATS_ERROR",
          details: error.message
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

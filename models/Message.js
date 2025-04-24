const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    content: { type: String, required: true },
    messageType: { 
      type: String, 
      enum: ['text', 'job_offer'],
      default: 'text'
    },
    categoryId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Category",
      required: function() {
        return this.messageType === 'job_offer';
      }
    },
    jobOfferStatus: {
      type: String,
      enum: ['pending', 'accepted'],
      default: 'pending',
      required: function() {
        return this.messageType === 'job_offer';
      }
    }
  },
  {
    timestamps: true, // This will automatically add createdAt and updatedAt fields
  }
);

module.exports = mongoose.model("Message", MessageSchema);

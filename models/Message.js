const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    content: { type: String, required: true },
  },
  {
    timestamps: true, // This will automatically add createdAt and updatedAt fields
  }
);

module.exports = mongoose.model("Message", MessageSchema);

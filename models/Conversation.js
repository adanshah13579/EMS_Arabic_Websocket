const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  lastMessage: { type: String, default: "" },
  lastMessageTime: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Conversation", ConversationSchema);

const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema(
  {
    messageId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Message",
      required: true,
      unique: true // One review per job offer
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      required: true,
      trim: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true // This will automatically add createdAt and updatedAt fields
  }
);

module.exports = mongoose.model("Review", ReviewSchema); 
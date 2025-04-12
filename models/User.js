const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      // Make fullName optional for admin
      required: function () {
        return this.userType !== "admin";
      },
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please fill a valid email address",
      ],
    },
    bio: {
      type: String,
      trim: true,
      default: function () {
        return this.userType === "serviceProvider"
          ? "Hi there, I am EMS user, let's connect!!"
          : "";
      },
    },

    phoneNumber: {
      type: String,
      trim: true,
      // Make phone number optional for admin
      required: function () {
        return this.userType !== "admin";
      },
      unique: function () {
        return this.userType !== "admin";
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
    },
    userType: {
      type: String,
      enum: ["user", "serviceProvider", "admin"],
      default: "user",
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: function () {
        return this.userType === "serviceProvider";
      },
    },
    rank: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
      streetAddress: {
        type: String,
        default: "N/A",
      },
    },
    accoutStatus: {
      type: String,
      enum: ["active", "suspended", "deleted"],
      default: "active",
    },
    profilePicUrl: {
      type: String,

      default:
        "https://icons.veryicon.com/png/o/miscellaneous/standard/avatar-15.png",
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Create a geospatial index for location-based queries
UserSchema.index({ location: "2dsphere" });

// Create an index for category and rank for efficient querying
UserSchema.index({ category: 1, rank: -1 });

module.exports = mongoose.model("User", UserSchema);

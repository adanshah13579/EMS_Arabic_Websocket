const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      // Make fullName optional for admin
      required: function () {
        return !this.isAdmin;
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
        return this.isProvider
          ? "Hi there, I am EMS Service Provider, let's connect!!"
          : "";
      },
    },
    phoneNumber: {
      type: String,
      trim: true,
      // Make phone number optional for admin
      required: function () {
        return !this.isAdmin;
      },
      unique: function () {
        return !this.isAdmin;
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
    },
    isClient: {
      type: Boolean,
      default: false,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isProvider: {
      type: Boolean,
      default: false,
    },
    category: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Category",
      required: function () {
        return this.isProvider;
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
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "deleted","pending"],
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
    images: {
      type: [String],
      default: [],
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    hourlyRate: {
      type: Number,
      min: [0, "Hourly rate cannot be negative"],
      default: 0,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true, // This allows multiple null values
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
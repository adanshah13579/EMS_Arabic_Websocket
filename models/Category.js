const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
  {
    name: {
      en: {
        type: String,
        required: [true, "English category name is required"],
        unique: true,
        trim: true,
        lowercase: true,
      },
      ar: {
        type: String,
        required: [true, "Arabic category name is required"],
        trim: true,
        lowercase: true,
      },
    },
    description: {
      en: {
        type: String,
        trim: true,
      },
      ar: {
        type: String,
        trim: true,
      },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    icon: {
      type: String,
      default: "https://img.icons8.com/color/512/services.png",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Category", CategorySchema);

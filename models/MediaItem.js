const mongoose = require('mongoose');

const mediaItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  caption: {
    type: String,
    trim: true,
    default: ''
  },
  category: {
    type: String,
    trim: true,
    default: 'Matchday Action',
    index: true
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  },
  url: {
    type: String,
    required: true,
    trim: true
  },
  publicId: {
    type: String,
    default: ''
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    ref: 'media_images.files'
  },
  storageType: {
    type: String,
    enum: ['gridfs', 'cloudinary', 'external'],
    default: 'gridfs'
  },
  width: {
    type: Number,
    default: 0
  },
  height: {
    type: Number,
    default: 0
  },
  matchTag: {
    type: String,
    trim: true,
    default: ''
  },
  fixtureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fixture',
    default: null
  },
  isPublished: {
    type: Boolean,
    default: true,
    index: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  dateTaken: {
    type: Date,
    default: Date.now
  },
  views: {
    type: Number,
    default: 0
  },
  likes: {
    type: Number,
    default: 0
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

mediaItemSchema.index({ createdAt: -1 });
mediaItemSchema.index({ category: 1, isPublished: 1 });

module.exports = mongoose.model('MediaItem', mediaItemSchema);

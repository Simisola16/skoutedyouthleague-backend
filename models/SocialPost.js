const mongoose = require('mongoose');

const socialPostSchema = new mongoose.Schema({
  platform: { 
    type: String, 
    enum: ['youtube', 'instagram', 'facebook', 'tiktok'], 
    required: true,
    index: true
  },
  externalId: { 
    type: String, 
    unique: true, 
    sparse: true,
    index: true
  },
  title: { 
    type: String, 
    default: '' 
  },
  caption: { 
    type: String, 
    default: '' 
  },
  postUrl: { 
    type: String, 
    required: true 
  },
  thumbnailUrl: { 
    type: String, 
    default: '' 
  },
  mediaType: { 
    type: String, 
    enum: ['video', 'image', 'reel', 'post'], 
    default: 'post' 
  },
  publishedAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  pinned: { 
    type: Boolean, 
    default: false,
    index: true
  }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('SocialPost', socialPostSchema);

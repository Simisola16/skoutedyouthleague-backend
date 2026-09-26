const mongoose = require('mongoose');

const newsArticleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  excerpt: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  coverImageUrl: {
    type: String,
    default: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&q=80&w=1200'
  },
  category: {
    type: String,
    enum: ['Matchday Recap', 'Scouting Report', 'League Announcement', 'Player Spotlight', 'Youth Development'],
    default: 'League Announcement'
  },
  author: {
    type: String,
    default: 'SYL Editorial Team'
  },
  readTime: {
    type: String,
    default: '3 min read'
  },
  featured: {
    type: Boolean,
    default: false
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  publishedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('NewsArticle', newsArticleSchema);

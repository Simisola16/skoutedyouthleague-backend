const mongoose = require('mongoose');

const podcastEpisodeSchema = new mongoose.Schema({
  episodeNumber: {
    type: Number,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  coverImageUrl: {
    type: String,
    default: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1200'
  },
  audioUrl: {
    type: String,
    default: ''
  },
  youtubeUrl: {
    type: String,
    default: ''
  },
  spotifyUrl: {
    type: String,
    default: ''
  },
  duration: {
    type: String,
    default: '32 mins'
  },
  host: {
    type: String,
    default: 'Skouted Youth League Media'
  },
  guest: {
    type: String,
    default: ''
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

module.exports = mongoose.model('PodcastEpisode', podcastEpisodeSchema);

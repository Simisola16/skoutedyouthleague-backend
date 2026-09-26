const mongoose = require('mongoose');

const sponsorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  logoUrl: {
    type: String,
    required: true
  },
  tier: {
    type: String,
    enum: ['Official Partner', 'Technical Sponsor', 'Scouting Partner', 'Media Partner'],
    default: 'Official Partner'
  },
  websiteUrl: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Sponsor', sponsorSchema);

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  keys: {
    p256dh: {
      type: String,
      required: true
    },
    auth: {
      type: String,
      required: true
    }
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null
  },
  allMatches: {
    type: Boolean,
    default: true
  },
  notifyKickoff: {
    type: Boolean,
    default: true
  },
  notifyGoals: {
    type: Boolean,
    default: true
  },
  notifySubs: {
    type: Boolean,
    default: true
  },
  notifyCards: {
    type: Boolean,
    default: true
  },
  notifyFullTime: {
    type: Boolean,
    default: true
  },
  userAgent: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);

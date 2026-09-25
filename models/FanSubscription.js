const mongoose = require('mongoose');

const fanSubscriptionSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: false,
    default: null
  },
  allMatches: {
    type: Boolean,
    default: false
  },
  notifyGoals: {
    type: Boolean,
    default: true
  },
  notifyKickoff: {
    type: Boolean,
    default: true
  },
  notifyFT: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for email queries and subscriptions
fanSubscriptionSchema.index({ email: 1, team: 1 });
fanSubscriptionSchema.index({ team: 1, notifyGoals: 1 });
fanSubscriptionSchema.index({ allMatches: 1, notifyGoals: 1 });

module.exports = mongoose.model('FanSubscription', fanSubscriptionSchema);

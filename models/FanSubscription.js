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
    required: true
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

// Compound unique index so one email can only subscribe to a team once
fanSubscriptionSchema.index({ email: 1, team: 1 }, { unique: true });
fanSubscriptionSchema.index({ team: 1, notifyGoals: 1 });

module.exports = mongoose.model('FanSubscription', fanSubscriptionSchema);

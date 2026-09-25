const mongoose = require('mongoose');

const leagueSettingsSchema = new mongoose.Schema({
  competitionName: {
    type: String,
    default: 'Skouted Youth League Championship'
  },
  maxSquadSize: {
    type: Number,
    default: 35
  },
  transferWindowStatus: {
    type: String,
    enum: ['closed', 'open'],
    default: 'closed'
  },
  registrationLocked: {
    type: Boolean,
    default: false
  },
  seasonPhase: {
    type: String,
    enum: ['pre_season', 'leg_1', 'mid_season_break', 'leg_2', 'completed'],
    default: 'pre_season'
  },
  seasonKickoffDate: {
    type: Date,
    default: null
  },
  initialRegistrationClosesAt: {
    type: Date,
    default: null
  },
  transferWindowOpenedAt: {
    type: Date,
    default: null
  },
  transferWindowClosesAt: {
    type: Date,
    default: null
  },
  autoTransferWindowTriggered: {
    type: Boolean,
    default: false
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Singleton helper to fetch or initialize settings
leagueSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      competitionName: 'Skouted Youth League Championship',
      maxSquadSize: 35,
      transferWindowStatus: 'closed',
      registrationLocked: false,
      seasonPhase: 'pre_season'
    });
  }
  return settings;
};

// Helper to evaluate whether squad registration is currently active or locked
leagueSettingsSchema.methods.checkRegistrationEligibility = function() {
  // If the transfer window is explicitly open, registration is unlocked
  if (this.transferWindowStatus === 'open') {
    return {
      allowed: true,
      reason: 'Transfer window is currently OPEN.'
    };
  }

  // If registration is marked locked while transfer window is closed
  if (this.registrationLocked === true) {
    return {
      allowed: false,
      reason: 'Player registration is currently closed. New players cannot be added until the mid-season transfer window opens.'
    };
  }

  // If initial registration cutoff date has passed
  if (this.initialRegistrationClosesAt && new Date() > new Date(this.initialRegistrationClosesAt)) {
    return {
      allowed: false,
      reason: 'Initial squad registration window has closed (2 weeks post-kickoff cutoff reached). Player registration will reopen during the mid-season transfer window.'
    };
  }

  // If active in competitive leg and locked
  if (['leg_1', 'leg_2', 'completed'].includes(this.seasonPhase) && this.registrationLocked) {
    return {
      allowed: false,
      reason: 'Player registration is currently closed for the active competition phase.'
    };
  }

  return {
    allowed: true,
    reason: 'Registration window active.'
  };
};

module.exports = mongoose.model('LeagueSettings', leagueSettingsSchema);

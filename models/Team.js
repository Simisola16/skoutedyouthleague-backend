const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  shortCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    maxlength: 4
  },
  logo: {
    type: String,
    default: ''
  },
  homeGround: {
    type: String,
    default: 'National Stadium Arena, Pitch 1'
  },
  group: {
    type: String,
    default: 'Group A'
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Verified', 'Pending Verification', 'Suspended'],
    default: 'Pending Verification'
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  managerName: {
    type: String,
    default: ''
  },
  managerEmail: {
    type: String,
    default: ''
  },
  managerPhone: {
    type: String,
    default: ''
  },
  stats: {
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    drawn: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },
    goalsAgainst: { type: Number, default: 0 },
    goalDifference: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    form: { type: [String], default: [] } // e.g. ['W', 'D', 'L']
  },
  followersCount: {
    type: Number,
    default: 0
  },
  homeKitColor: {
    type: String,
    default: '#00E676'
  },
  awayKitColor: {
    type: String,
    default: '#3B82F6'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual populate squad
teamSchema.virtual('squad', {
  ref: 'Player',
  localField: '_id',
  foreignField: 'team'
});

// Virtual playerCount representing active registered players (must never exceed 35)
teamSchema.virtual('playerCount', {
  ref: 'Player',
  localField: '_id',
  foreignField: 'team',
  count: true
});

// Indexes for fast league queries
teamSchema.index({ shortCode: 1 }, { unique: true });
teamSchema.index({ 'stats.points': -1, 'stats.goalDifference': -1, 'stats.goalsFor': -1 });
teamSchema.index({ manager: 1 });
teamSchema.index({ verificationStatus: 1 });

module.exports = mongoose.model('Team', teamSchema);

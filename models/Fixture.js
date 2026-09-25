const mongoose = require('mongoose');

const lineupSlotSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    required: true
  },
  position: { type: String, required: true },
  gridX: { type: Number, default: 50 },
  gridY: { type: Number, default: 50 },
  isCaptain: { type: Boolean, default: false }
}, { _id: false });

const benchSlotSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    required: true
  },
  position: { type: String, default: 'SUB' }
}, { _id: false });

const teamLineupSchema = new mongoose.Schema({
  formation: { type: String, default: '4-3-3' },
  startingXI: [lineupSlotSchema],
  bench: [benchSlotSchema],
  isLocked: { type: Boolean, default: false },
  submittedAt: { type: Date, default: null }
}, { _id: false });

const fixtureSchema = new mongoose.Schema({
  homeTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  awayTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  stage: {
    type: String,
    default: 'Matchday 1'
  },
  leg: {
    type: Number,
    enum: [1, 2],
    default: 1
  },
  matchday: {
    type: Number,
    default: 1
  },
  date: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  venue: {
    type: String,
    default: 'Lekan Salami Stadium, Adamasingba, Ibadan'
  },
  status: {
    type: String,
    enum: ['UPCOMING', '1ST HALF', 'HT', '2ND HALF', 'FT', 'PENS'],
    default: 'UPCOMING'
  },
  minute: {
    type: Number,
    default: 0
  },
  homeScore: {
    type: Number,
    default: 0
  },
  awayScore: {
    type: Number,
    default: 0
  },
  homeLineup: {
    type: teamLineupSchema,
    default: () => ({ formation: '4-3-3', startingXI: [], bench: [], isLocked: false })
  },
  awayLineup: {
    type: teamLineupSchema,
    default: () => ({ formation: '4-3-3', startingXI: [], bench: [], isLocked: false })
  },
  stats: {
    homePossession: { type: Number, default: 50 },
    awayPossession: { type: Number, default: 50 },
    homeShotsOnTarget: { type: Number, default: 0 },
    awayShotsOnTarget: { type: Number, default: 0 },
    homeShotsTotal: { type: Number, default: 0 },
    awayShotsTotal: { type: Number, default: 0 },
    homeCorners: { type: Number, default: 0 },
    awayCorners: { type: Number, default: 0 },
    homeFouls: { type: Number, default: 0 },
    awayFouls: { type: Number, default: 0 },
    homeOffsides: { type: Number, default: 0 },
    awayOffsides: { type: Number, default: 0 }
  },
  lineupWarningSent: {
    type: Boolean,
    default: false
  },
  scheduledNoticeSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual populate events
fixtureSchema.virtual('events', {
  ref: 'MatchEvent',
  localField: '_id',
  foreignField: 'fixture'
});

// Production indexes
fixtureSchema.index({ status: 1 });
fixtureSchema.index({ date: 1, time: 1 });
fixtureSchema.index({ homeTeam: 1 });
fixtureSchema.index({ awayTeam: 1 });
fixtureSchema.index({ status: 1, lineupWarningSent: 1, date: 1 });

module.exports = mongoose.model('Fixture', fixtureSchema);

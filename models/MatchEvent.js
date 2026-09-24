const mongoose = require('mongoose');

const matchEventSchema = new mongoose.Schema({
  fixture: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fixture',
    required: true
  },
  minute: {
    type: Number,
    required: true,
    min: 0,
    max: 130
  },
  type: {
    type: String,
    enum: ['GOAL', 'OWN_GOAL', 'YELLOW_CARD', 'RED_CARD', 'SUB_IN', 'SUB_OUT', 'VAR_DECISION', 'PENALTY_MISSED'],
    required: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player'
  },
  assistPlayer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    default: null
  },
  description: {
    type: String,
    default: ''
  },
  scoreAtEvent: {
    home: { type: Number, default: 0 },
    away: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MatchEvent', matchEventSchema);

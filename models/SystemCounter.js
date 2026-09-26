const mongoose = require('mongoose');

const systemCounterSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
    index: true // Formatted YYYY-MM-DD (UTC/WAT)
  },
  primaryCount: {
    type: Number,
    default: 0
  },
  backupCount: {
    type: Number,
    default: 0
  },
  primaryExhausted: {
    type: Boolean,
    default: false
  },
  exhaustedReason: {
    type: String,
    default: null
  },
  lastDispatchedAt: {
    type: Date,
    default: null
  },
  dispatches: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    keyUsed: {
      type: String,
      enum: ['primary', 'backup', 'smtp']
    },
    recipients: [{
      type: String
    }],
    subject: {
      type: String
    },
    status: {
      type: String,
      enum: ['success', 'failover_retry', 'error']
    },
    resendId: {
      type: String
    },
    error: {
      type: String
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('SystemCounter', systemCounterSchema);

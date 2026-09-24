const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  jerseyNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 99
  },
  dateOfBirth: {
    type: Date,
    default: null
  },
  position: {
    type: String,
    required: true,
    trim: true
  },
  subPosition: {
    type: String,
    default: ''
  },
  roles: {
    type: [String],
    default: ['Regular Squad Player']
  },
  role: {
    type: String,
    default: 'Squad Player'
  },
  preferredFoot: {
    type: String,
    enum: ['Right', 'Left', 'Both'],
    default: 'Right'
  },
  heightCm: {
    type: Number,
    min: 100,
    max: 230,
    default: null
  },
  weightKg: {
    type: Number,
    min: 30,
    max: 150,
    default: null
  },
  nationality: {
    type: String,
    trim: true,
    default: 'Nigeria'
  },
  photo: {
    type: String,
    default: ''
  },
  photoUrl: {
    type: String,
    default: ''
  },
  age: {
    type: Number,
    default: 17
  },
  status: {
    type: String,
    enum: ['Eligible', 'Suspended', 'Under Review'],
    default: 'Eligible'
  },
  isEligible: {
    type: Boolean,
    default: true
  },
  suspensionReason: {
    type: String,
    default: ''
  },
  stats: {
    matches: { type: Number, default: 0 },
    goals: { type: Number, default: 0 },
    assists: { type: Number, default: 0 },
    yellowCards: { type: Number, default: 0 },
    redCards: { type: Number, default: 0 },
    cleanSheets: { type: Number, default: 0 },
    minutesPlayed: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual teamId
playerSchema.virtual('teamId').get(function () {
  return this.team;
});

// Pre-save calculation hook for age, photo syncing, and roles
playerSchema.pre('save', function (next) {
  // 1. Calculate age from dateOfBirth
  if (this.dateOfBirth) {
    const dob = new Date(this.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const today = new Date();
      let calculatedAge = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        calculatedAge--;
      }
      if (calculatedAge >= 0) {
        this.age = calculatedAge;
      }
    }
  }

  // 2. Sync photo and photoUrl
  if (this.photoUrl && !this.photo) {
    this.photo = this.photoUrl;
  } else if (this.photo && !this.photoUrl) {
    this.photoUrl = this.photo;
  }

  // 3. Sync roles and primary role
  if (Array.isArray(this.roles) && this.roles.length > 0) {
    if (this.roles.includes('Captain')) this.role = 'Captain';
    else if (this.roles.includes('Vice Captain')) this.role = 'Vice Captain';
    else if (!this.role || this.role === 'Squad Player') this.role = this.roles[0];
  } else if (this.role && (!this.roles || this.roles.length === 0)) {
    this.roles = [this.role];
  }

  next();
});

// Production indexes
playerSchema.index({ team: 1, jerseyNumber: 1 });
playerSchema.index({ 'stats.goals': -1, 'stats.assists': -1 });
playerSchema.index({ 'stats.assists': -1 });
playerSchema.index({ position: 1, 'stats.cleanSheets': -1 });

module.exports = mongoose.model('Player', playerSchema);

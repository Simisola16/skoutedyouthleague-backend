const mongoose = require('mongoose');
const User = require('../models/User');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const MatchEvent = require('../models/MatchEvent');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skoutedleague';

async function purgeDemoData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas for Cleanup');

    // 1. Remove all demo fixtures & match events
    const fixturesDel = await Fixture.deleteMany({});
    console.log(`🧹 Deleted ${fixturesDel.deletedCount} demo fixtures`);

    const eventsDel = await MatchEvent.deleteMany({});
    console.log(`🧹 Deleted ${eventsDel.deletedCount} demo match events`);

    // 2. Remove demo teams (keep real user registered team e.g. Telu FC)
    const demoShortCodes = ['LRS', 'CFA', 'BLF', 'SSF', 'TAF', 'GBF'];
    const demoTeams = await Team.find({ shortCode: { $in: demoShortCodes } });
    const demoTeamIds = demoTeams.map(t => t._id);

    const playersDel = await Player.deleteMany({ team: { $in: demoTeamIds } });
    console.log(`🧹 Deleted ${playersDel.deletedCount} demo players`);

    const teamsDel = await Team.deleteMany({ _id: { $in: demoTeamIds } });
    console.log(`🧹 Deleted ${teamsDel.deletedCount} demo teams`);

    // 3. Remove demo users (keep admin and real registered user)
    const demoEmails = [
      'official@skoutedleague.com',
      'manager.lrs@skoutedleague.com',
      'manager.cfa@skoutedleague.com'
    ];
    const usersDel = await User.deleteMany({ email: { $in: demoEmails } });
    console.log(`🧹 Deleted ${usersDel.deletedCount} demo user accounts`);

    // 4. Ensure master admin exists with secure credentials
    let admin = await User.findOne({ email: 'admin@skoutedleague.com' });
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Skouted2026!';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    if (!admin) {
      admin = new User({
        name: 'Tournament Director',
        email: 'admin@skoutedleague.com',
        password: hashedPassword,
        role: 'admin',
        isVerified: true
      });
      await admin.save();
      console.log('👑 Created Master Tournament Admin: admin@skoutedleague.com');
    } else {
      admin.password = hashedPassword;
      admin.role = 'admin';
      admin.isVerified = true;
      await admin.save();
      console.log('👑 Updated Master Tournament Admin credentials: admin@skoutedleague.com');
    }

    // 5. Verification count
    const remainingTeams = await Team.find({}, 'name shortCode');
    console.log('Remaining real teams:', remainingTeams);
    const remainingUsers = await User.find({}, 'name email role');
    console.log('Remaining real users:', remainingUsers);

    console.log('✨ CLEAN PRODUCTION DATABASE READY');
    process.exit(0);
  } catch (err) {
    console.error('❌ Cleanup failed:', err);
    process.exit(1);
  }
}

purgeDemoData();

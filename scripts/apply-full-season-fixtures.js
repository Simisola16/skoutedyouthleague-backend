require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');
const Fixture = require('../models/Fixture');
const Team = require('../models/Team');

const weeklySchedule = {
  6: {
    bye: 'DFA',
    satDate: '2026-12-12',
    sunDate: '2026-12-13',
    matches: [
      { home: '3SC', away: 'EFC', day: 'sat', time: '08:00' },
      { home: 'G-17', away: 'RRFA', day: 'sat', time: '10:00' },
      { home: 'IFA', away: 'OB12FA', day: 'sun', time: '08:00' },
      { home: 'JSFC', away: 'TELU FC', day: 'sun', time: '10:00' },
      { home: 'VIA', away: 'TFA', day: 'sun', time: '12:00' }
    ]
  },
  7: {
    bye: 'RRFA',
    satDate: '2026-12-19',
    sunDate: '2026-12-20',
    matches: [
      { home: '3SC', away: 'DFA', day: 'sat', time: '08:00' },
      { home: 'EFC', away: 'G-17', day: 'sat', time: '10:00' },
      { home: 'IFA', away: 'TELU FC', day: 'sun', time: '08:00' },
      { home: 'JSFC', away: 'TFA', day: 'sun', time: '10:00' },
      { home: 'OB12FA', away: 'VIA', day: 'sun', time: '12:00' }
    ]
  },
  8: {
    bye: 'IFA',
    satDate: '2026-12-26',
    sunDate: '2026-12-27',
    matches: [
      { home: '3SC', away: 'G-17', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'OB12FA', day: 'sat', time: '10:00' },
      { home: 'EFC', away: 'JSFC', day: 'sun', time: '08:00' },
      { home: 'RRFA', away: 'TFA', day: 'sun', time: '10:00' },
      { home: 'TELU FC', away: 'VIA', day: 'sun', time: '12:00' }
    ]
  },
  9: {
    bye: 'JSFC',
    satDate: '2027-01-02',
    sunDate: '2027-01-03',
    matches: [
      { home: '3SC', away: 'IFA', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'G-17', day: 'sat', time: '10:00' },
      { home: 'EFC', away: 'VIA', day: 'sun', time: '08:00' },
      { home: 'OB12FA', away: 'RRFA', day: 'sun', time: '10:00' },
      { home: 'TELU FC', away: 'TFA', day: 'sun', time: '12:00' }
    ]
  },
  10: {
    bye: 'TFA',
    satDate: '2027-01-09',
    sunDate: '2027-01-10',
    matches: [
      { home: '3SC', away: 'JSFC', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'IFA', day: 'sat', time: '10:00' },
      { home: 'EFC', away: 'RRFA', day: 'sun', time: '08:00' },
      { home: 'G-17', away: 'VIA', day: 'sun', time: '10:00' },
      { home: 'OB12FA', away: 'TELU FC', day: 'sun', time: '12:00' }
    ]
  },
  11: {
    bye: 'VIA',
    satDate: '2027-01-16',
    sunDate: '2027-01-17',
    matches: [
      { home: '3SC', away: 'OB12FA', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'TFA', day: 'sat', time: '10:00' },
      { home: 'EFC', away: 'IFA', day: 'sun', time: '08:00' },
      { home: 'G-17', away: 'TELU FC', day: 'sun', time: '10:00' },
      { home: 'JSFC', away: 'RRFA', day: 'sun', time: '12:00' }
    ]
  },
  12: {
    bye: 'OB12FA',
    satDate: '2027-01-23',
    sunDate: '2027-01-24',
    matches: [
      { home: 'VIA', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'TELU FC', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'TFA', away: 'EFC', day: 'sun', time: '08:00' },
      { home: 'G-17', away: 'JSFC', day: 'sun', time: '10:00' },
      { home: 'RRFA', away: 'IFA', day: 'sun', time: '12:00' }
    ]
  },
  13: {
    bye: 'EFC',
    satDate: '2027-01-30',
    sunDate: '2027-01-31',
    matches: [
      { home: '3SC', away: 'TELU FC', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'RRFA', day: 'sat', time: '10:00' },
      { home: 'IFA', away: 'G-17', day: 'sun', time: '08:00' },
      { home: 'JSFC', away: 'VIA', day: 'sun', time: '10:00' },
      { home: 'TFA', away: 'OB12FA', day: 'sun', time: '12:00' }
    ]
  },
  14: {
    bye: 'TELU FC',
    satDate: '2027-02-06',
    sunDate: '2027-02-07',
    matches: [
      { home: 'TFA', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'JSFC', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'EFC', away: 'OB12FA', day: 'sun', time: '08:00' },
      { home: 'RRFA', away: 'G-17', day: 'sun', time: '10:00' },
      { home: 'VIA', away: 'IFA', day: 'sun', time: '12:00' }
    ]
  },
  15: {
    bye: '3SC',
    satDate: '2027-02-13',
    sunDate: '2027-02-14',
    matches: [
      { home: 'DFA', away: 'EFC', day: 'sat', time: '08:00' },
      { home: 'OB12FA', away: 'G-17', day: 'sat', time: '10:00' },
      { home: 'IFA', away: 'JSFC', day: 'sun', time: '08:00' },
      { home: 'TFA', away: 'RRFA', day: 'sun', time: '10:00' },
      { home: 'VIA', away: 'TELU FC', day: 'sun', time: '12:00' }
    ]
  },
  16: {
    bye: 'DFA',
    satDate: '2027-02-20',
    sunDate: '2027-02-21',
    matches: [
      { home: '3SC', away: 'RRFA', day: 'sat', time: '08:00' },
      { home: 'EFC', away: 'TELU FC', day: 'sat', time: '10:00' },
      { home: 'VIA', away: 'G-17', day: 'sun', time: '08:00' },
      { home: 'IFA', away: 'TFA', day: 'sun', time: '10:00' },
      { home: 'OB12FA', away: 'JSFC', day: 'sun', time: '12:00' }
    ]
  },
  17: {
    bye: 'RRFA',
    satDate: '2027-02-27',
    sunDate: '2027-02-28',
    matches: [
      { home: 'EFC', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'DFA', away: 'VIA', day: 'sat', time: '10:00' },
      { home: 'TELU FC', away: 'G-17', day: 'sun', time: '08:00' },
      { home: 'OB12FA', away: 'IFA', day: 'sun', time: '10:00' },
      { home: 'TFA', away: 'JSFC', day: 'sun', time: '12:00' }
    ]
  },
  18: {
    bye: 'IFA',
    satDate: '2027-03-06',
    sunDate: '2027-03-07',
    matches: [
      { home: 'DFA', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'JSFC', away: 'EFC', day: 'sat', time: '10:00' },
      { home: 'G-17', away: 'TFA', day: 'sun', time: '08:00' },
      { home: 'TELU FC', away: 'OB12FA', day: 'sun', time: '10:00' },
      { home: 'RRFA', away: 'VIA', day: 'sun', time: '12:00' }
    ]
  },
  19: {
    bye: 'JSFC',
    satDate: '2027-03-13',
    sunDate: '2027-03-14',
    matches: [
      { home: 'G-17', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'IFA', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'VIA', away: 'EFC', day: 'sun', time: '08:00' },
      { home: 'RRFA', away: 'OB12FA', day: 'sun', time: '10:00' },
      { home: 'TFA', away: 'TELU FC', day: 'sun', time: '12:00' }
    ]
  },
  20: {
    bye: 'TFA',
    satDate: '2027-03-20',
    sunDate: '2027-03-21',
    matches: [
      { home: 'OB12FA', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'G-17', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'RRFA', away: 'EFC', day: 'sun', time: '08:00' },
      { home: 'TELU FC', away: 'IFA', day: 'sun', time: '10:00' },
      { home: 'VIA', away: 'JSFC', day: 'sun', time: '12:00' }
    ]
  },
  21: {
    bye: 'VIA',
    satDate: '2027-03-27',
    sunDate: '2027-03-28',
    matches: [
      { home: 'JSFC', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'OB12FA', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'IFA', away: 'EFC', day: 'sun', time: '08:00' },
      { home: 'TFA', away: 'G-17', day: 'sun', time: '10:00' },
      { home: 'RRFA', away: 'TELU FC', day: 'sun', time: '12:00' }
    ]
  },
  22: {
    bye: 'OB12FA',
    satDate: '2027-04-03',
    sunDate: '2027-04-04',
    matches: [
      { home: 'IFA', away: '3SC', day: 'sat', time: '08:00' },
      { home: 'TFA', away: 'DFA', day: 'sat', time: '10:00' },
      { home: 'G-17', away: 'EFC', day: 'sun', time: '08:00' },
      { home: 'TELU FC', away: 'JSFC', day: 'sun', time: '10:00' },
      { home: 'VIA', away: 'RRFA', day: 'sun', time: '12:00' }
    ]
  }
};

async function applyFullSeason() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  const teams = await Team.find({ isDeleted: { $ne: true } }).lean();
  console.log(`Loaded ${teams.length} teams.`);
  const teamMap = {};
  teams.forEach(t => {
    teamMap[t.shortCode] = t._id;
  });

  // Verify all 11 team shortCodes exist in teamMap
  const requiredShortCodes = ['3SC', 'DFA', 'EFC', 'G-17', 'IFA', 'JSFC', 'OB12FA', 'RRFA', 'TELU FC', 'TFA', 'VIA'];
  for (const code of requiredShortCodes) {
    if (!teamMap[code]) {
      throw new Error(`Team with shortCode "${code}" not found in DB!`);
    }
  }

  // Delete only future fixtures from Week 6 onwards (leaving Weeks 1-5 completely untouched)
  const delResult = await Fixture.deleteMany({
    matchday: { $gte: 6 }
  });
  console.log(`Deleted ${delResult.deletedCount} old placeholder fixtures for Week 6 onwards.`);

  // Build new fixture documents for Weeks 6 to 22
  const newFixtures = [];
  for (let w = 6; w <= 22; w++) {
    const weekData = weeklySchedule[w];
    if (!weekData) throw new Error(`Missing schedule for Week ${w}`);

    for (const m of weekData.matches) {
      const matchDate = m.day === 'sat' ? weekData.satDate : weekData.sunDate;
      const leg = w <= 11 ? 1 : 2;

      newFixtures.push({
        homeTeam: teamMap[m.home],
        awayTeam: teamMap[m.away],
        stage: `Week ${w}`,
        matchday: w,
        leg: leg,
        date: matchDate,
        time: m.time,
        venue: 'Lekan Salami Stadium, Adamasingba, Ibadan',
        status: 'UPCOMING',
        homeScore: 0,
        awayScore: 0,
        homeLineup: { formation: '4-3-3', startingXI: [], bench: [], isLocked: false },
        awayLineup: { formation: '4-3-3', startingXI: [], bench: [], isLocked: false },
        stats: {
          homePossession: 50,
          awayPossession: 50,
          homeShotsOnTarget: 0,
          awayShotsOnTarget: 0,
          homeShotsTotal: 0,
          awayShotsTotal: 0,
          homeCorners: 0,
          awayCorners: 0,
          homeFouls: 0,
          awayFouls: 0,
          homeOffsides: 0,
          awayOffsides: 0
        },
        lineupWarningSent: false,
        scheduledNoticeSent: false,
        isDeleted: false
      });
    }
  }

  console.log(`Inserting ${newFixtures.length} new professional fixtures for Weeks 6 through 22...`);
  const insertResult = await Fixture.insertMany(newFixtures);
  console.log(`Successfully inserted ${insertResult.length} fixtures!`);

  // Final count in DB:
  const totalFixtures = await Fixture.countDocuments({ isDeleted: { $ne: true } });
  console.log(`Total fixtures now in database: ${totalFixtures} (Expected: 110)`);

  const ftFixtures = await Fixture.countDocuments({ status: 'FT', isDeleted: { $ne: true } });
  console.log(`Total completed (FT) matches: ${ftFixtures} (Expected: 10 from Weeks 1 & 2)`);

  await mongoose.disconnect();
  console.log('Done!');
}

applyFullSeason().catch(console.error);

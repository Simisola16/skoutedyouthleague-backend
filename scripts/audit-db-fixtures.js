require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');
const Fixture = require('../models/Fixture');
require('../models/Team');

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);

  const fixtures = await Fixture.find({ isDeleted: { $ne: true } })
    .populate('homeTeam awayTeam')
    .sort({ matchday: 1, date: 1, time: 1 })
    .lean();

  console.log(`=== DATABASE FIXTURES AUDIT ===`);
  console.log(`Total fixtures found: ${fixtures.length}`);

  if (fixtures.length !== 110) {
    throw new Error(`Expected 110 fixtures, found ${fixtures.length}`);
  }

  const byWeek = {};
  const teamAppearances = {};
  const teamHome = {};
  const teamAway = {};
  const directedPairs = new Set();

  fixtures.forEach(f => {
    const w = f.matchday;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(f);

    const hCode = f.homeTeam.shortCode;
    const aCode = f.awayTeam.shortCode;

    teamAppearances[hCode] = (teamAppearances[hCode] || 0) + 1;
    teamAppearances[aCode] = (teamAppearances[aCode] || 0) + 1;
    teamHome[hCode] = (teamHome[hCode] || 0) + 1;
    teamAway[aCode] = (teamAway[aCode] || 0) + 1;

    const pairKey = `${hCode} vs ${aCode}`;
    if (directedPairs.has(pairKey)) {
      throw new Error(`DUPLICATE MATCH DETECTED IN DB: ${pairKey}`);
    }
    directedPairs.add(pairKey);
  });

  console.log(`\nWeekly Distribution (all weeks 1..22):`);
  for (let w = 1; w <= 22; w++) {
    const list = byWeek[w] || [];
    const active = new Set();
    list.forEach(f => {
      active.add(f.homeTeam.shortCode);
      active.add(f.awayTeam.shortCode);
    });
    const allCodes = Object.keys(teamAppearances);
    const bye = allCodes.filter(c => !active.has(c));
    console.log(`  Week ${w}: ${list.length} matches | Active: ${active.size} teams | Bye: ${bye.join(', ')} | Status: ${list.map(f => f.status)[0]}`);
    if (list.length !== 5) throw new Error(`Week ${w} does not have 5 matches!`);
    if (active.size !== 10) throw new Error(`Week ${w} does not have 10 distinct teams!`);
    if (bye.length !== 1) throw new Error(`Week ${w} does not have exactly 1 bye!`);
  }

  console.log(`\nTeam Appearance Audit:`);
  for (const [code, count] of Object.entries(teamAppearances)) {
    console.log(`  ${code.padEnd(8)}: ${count} matches (${teamHome[code]} Home, ${teamAway[code]} Away)`);
    if (count !== 20) throw new Error(`Team ${code} has ${count} matches instead of 20!`);
    if (teamHome[code] !== 10) throw new Error(`Team ${code} has ${teamHome[code]} Home matches instead of 10!`);
    if (teamAway[code] !== 10) throw new Error(`Team ${code} has ${teamAway[code]} Away matches instead of 10!`);
  }

  const ftMatches = fixtures.filter(f => f.status === 'FT');
  console.log(`\nCompleted matches (FT): ${ftMatches.length}`);
  ftMatches.forEach(f => {
    console.log(`  [${f.stage}] ${f.homeTeam.shortCode} ${f.homeScore} - ${f.awayScore} ${f.awayTeam.shortCode} (${f.date})`);
  });

  if (ftMatches.length !== 10) throw new Error(`Expected 10 FT matches in Weeks 1 & 2!`);

  console.log(`\n>>> AUDIT PASSED 100%! ALL 110 MATCHES PERFECTLY CONFIGURED <<<`);
  await mongoose.disconnect();
}

audit().catch(console.error);

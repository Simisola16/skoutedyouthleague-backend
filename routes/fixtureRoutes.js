const express = require('express');
const router = express.Router();
const Fixture = require('../models/Fixture');
const MatchEvent = require('../models/MatchEvent');
const Team = require('../models/Team');
const Player = require('../models/Player');
const FanSubscription = require('../models/FanSubscription');
const User = require('../models/User');
const EmailService = require('../services/emailService');
const { broadcastMatchUpdate, broadcastMatchEvent, broadcastStandingsUpdate } = require('../services/socketService');
const { requireAdmin, requireOfficialOrAdmin } = require('../middleware/authMiddleware');

// Helper to recalculate league standings
async function recalculateStandings() {
  try {
    const teams = await Team.find();
    const fixtures = await Fixture.find({ status: 'FT' });

    const statsMap = {};
    teams.forEach(t => {
      statsMap[t._id.toString()] = {
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        form: []
      };
    });

    // Sort fixtures chronologically
    fixtures.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));

    for (const f of fixtures) {
      const hId = f.homeTeam.toString();
      const aId = f.awayTeam.toString();
      if (!statsMap[hId] || !statsMap[aId]) continue;

      const hScore = f.homeScore || 0;
      const aScore = f.awayScore || 0;

      statsMap[hId].played += 1;
      statsMap[aId].played += 1;
      statsMap[hId].goalsFor += hScore;
      statsMap[hId].goalsAgainst += aScore;
      statsMap[aId].goalsFor += aScore;
      statsMap[aId].goalsAgainst += hScore;

      if (hScore > aScore) {
        statsMap[hId].won += 1;
        statsMap[hId].points += 3;
        statsMap[hId].form.push('W');
        statsMap[aId].lost += 1;
        statsMap[aId].form.push('L');
      } else if (hScore < aScore) {
        statsMap[aId].won += 1;
        statsMap[aId].points += 3;
        statsMap[aId].form.push('W');
        statsMap[hId].lost += 1;
        statsMap[hId].form.push('L');
      } else {
        statsMap[hId].drawn += 1;
        statsMap[aId].drawn += 1;
        statsMap[hId].points += 1;
        statsMap[aId].points += 1;
        statsMap[hId].form.push('D');
        statsMap[aId].form.push('D');
      }
    }

    // Save updated team stats
    for (const t of teams) {
      const s = statsMap[t._id.toString()];
      if (s) {
        s.goalDifference = s.goalsFor - s.goalsAgainst;
        s.form = s.form.slice(-5); // keep last 5
        await Team.findByIdAndUpdate(t._id, { stats: s });
      }
    }

    const updatedStandings = await Team.find().sort({ 'stats.points': -1, 'stats.goalDifference': -1, 'stats.goalsFor': -1 });
    broadcastStandingsUpdate(updatedStandings);
  } catch (err) {
    console.error('[Recalculate Standings Error]:', err);
  }
}

// 1. Get all fixtures (with filter options: status, date)
router.get('/', async (req, res) => {
  try {
    const { status, stage } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (stage) filter.stage = stage;

    const fixtures = await Fixture.find(filter)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player')
      .sort({ date: 1, time: 1 });

    res.json({ success: true, data: fixtures });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get single fixture with populated events & lineups
router.get('/:id', async (req, res) => {
  try {
    const fixture = await Fixture.findById(req.params.id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player homeLineup.bench.player awayLineup.bench.player');

    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Fixture not found' });
    }

    const events = await MatchEvent.find({ fixture: fixture._id })
      .populate('team player assistPlayer')
      .sort({ minute: 1, createdAt: 1 });

    res.json({ success: true, data: { fixture, events } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Create Fixture (Admin) + Send Fixture Announcement Email
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { homeTeam, awayTeam, stage, leg, matchday, date, time, venue } = req.body;

    if (!homeTeam || !awayTeam || !date || !time) {
      return res.status(400).json({ success: false, error: 'Home team, away team, date, and time are required' });
    }

    if (homeTeam === awayTeam) {
      return res.status(400).json({ success: false, error: 'A team cannot play against itself' });
    }

    const calculatedMatchday = Number(matchday) || (stage && stage.match(/Matchday\s*(\d+)/i) ? Number(stage.match(/Matchday\s*(\d+)/i)[1]) : 1);
    const calculatedLeg = Number(leg) || (calculatedMatchday > 11 ? 2 : 1);

    const fixture = new Fixture({
      homeTeam,
      awayTeam,
      stage: stage || `Matchday ${calculatedMatchday}`,
      leg: calculatedLeg,
      matchday: calculatedMatchday,
      date,
      time,
      venue: venue || 'Lekan Salami Stadium, Adamasingba, Ibadan',
      status: 'UPCOMING'
    });

    await fixture.save();

    const populated = await Fixture.findById(fixture._id).populate('homeTeam awayTeam');

    // Trigger fixture announcement email to both managers (with fallback to User accounts)
    let homeEmail = populated.homeTeam?.managerEmail;
    let awayEmail = populated.awayTeam?.managerEmail;

    if (!homeEmail && populated.homeTeam?._id) {
      const homeMgr = await User.findOne({ team: populated.homeTeam._id });
      if (homeMgr) homeEmail = homeMgr.email;
    }
    if (!awayEmail && populated.awayTeam?._id) {
      const awayMgr = await User.findOne({ team: populated.awayTeam._id });
      if (awayMgr) awayEmail = awayMgr.email;
    }

    if (homeEmail || awayEmail) {
      console.log(`[Fixture Dispatch]: Sending match notice to Home: ${homeEmail || 'None'}, Away: ${awayEmail || 'None'}`);
      EmailService.sendFixtureAnnouncement({
        homeManagerEmail: homeEmail,
        awayManagerEmail: awayEmail,
        homeTeamName: populated.homeTeam?.name,
        awayTeamName: populated.awayTeam?.name,
        date: populated.date,
        time: populated.time,
        venue: populated.venue,
        stage: populated.stage
      }).then(res => {
        console.log('[Fixture Notice Sent Result]:', res);
      }).catch(e => console.error('[Fixture Email Notice Error]:', e.message));

      populated.scheduledNoticeSent = true;
      await populated.save();
    }

    broadcastMatchUpdate(populated);

    res.status(201).json({ success: true, message: 'Fixture created successfully', data: populated });
  } catch (err) {
    console.error('[Create Fixture Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Match Controller: Quick Score Update (+1 / -1)
router.patch('/:id/score', requireOfficialOrAdmin, async (req, res) => {
  try {
    const { homeScore, awayScore, minute } = req.body;
    const fixture = await Fixture.findById(req.params.id);
    if (!fixture) return res.status(404).json({ success: false, error: 'Fixture not found' });

    if (homeScore !== undefined) fixture.homeScore = Math.max(0, Number(homeScore));
    if (awayScore !== undefined) fixture.awayScore = Math.max(0, Number(awayScore));
    if (minute !== undefined) fixture.minute = Number(minute);

    await fixture.save();

    const populated = await Fixture.findById(fixture._id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player');

    broadcastMatchUpdate(populated);

    if (fixture.status === 'FT') {
      await recalculateStandings();
    }

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Match Controller: Change Match Period / Status ('UPCOMING', '1ST HALF', 'HT', '2ND HALF', 'FT', 'PENS')
router.patch('/:id/period', requireOfficialOrAdmin, async (req, res) => {
  try {
    const { status, minute } = req.body;
    const fixture = await Fixture.findById(req.params.id);
    if (!fixture) return res.status(404).json({ success: false, error: 'Fixture not found' });

    if (status) fixture.status = status;
    if (minute !== undefined) fixture.minute = Number(minute);

    await fixture.save();

    const populated = await Fixture.findById(fixture._id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player');

    broadcastMatchUpdate(populated);

    if (fixture.status === 'FT') {
      await recalculateStandings();
    }

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Match Controller: Log Match Event (Goal, Card, Substitution, VAR) + Instant Socket.io & Email Dispatch
router.post('/:id/events', requireOfficialOrAdmin, async (req, res) => {
  try {
    const { fixtureId } = req.params;
    const { minute, type, teamId, playerId, assistPlayerId, description } = req.body;

    const fixture = await Fixture.findById(req.params.id).populate('homeTeam awayTeam');
    if (!fixture) return res.status(404).json({ success: false, error: 'Fixture not found' });

    const event = new MatchEvent({
      fixture: fixture._id,
      minute: Number(minute) || fixture.minute || 0,
      type,
      team: teamId,
      player: playerId || null,
      assistPlayer: assistPlayerId || null,
      description: description || '',
      scoreAtEvent: {
        home: fixture.homeScore,
        away: fixture.awayScore
      }
    });

    // If GOAL, automatically increment score and player stats
    if (type === 'GOAL') {
      const isHome = teamId ? fixture.homeTeam._id.toString() === teamId.toString() : true;
      if (isHome) {
        fixture.homeScore += 1;
      } else {
        fixture.awayScore += 1;
      }
      event.scoreAtEvent = { home: fixture.homeScore, away: fixture.awayScore };
      await fixture.save();

      // Update scoring player stats
      if (playerId) {
        await Player.findByIdAndUpdate(playerId, { $inc: { 'stats.goals': 1 } });
      }
      // Update assist player stats
      if (assistPlayerId) {
        await Player.findByIdAndUpdate(assistPlayerId, { $inc: { 'stats.assists': 1 } });
      }

      // ASYNC FAN GOAL EMAIL DISPATCH
      try {
        const scoringTeam = isHome ? fixture.homeTeam : fixture.awayTeam;
        const opponentTeam = isHome ? fixture.awayTeam : fixture.homeTeam;
        const scoringPlayer = playerId ? await Player.findById(playerId) : null;
        const playerName = scoringPlayer ? `${scoringPlayer.firstName} ${scoringPlayer.lastName}` : scoringTeam.name;

        // Fetch fans who subscribed to either team in this match, OR subscribed to all matches
        const fanSubs = await FanSubscription.find({
          notifyGoals: true,
          $or: [
            { team: scoringTeam._id },
            { team: opponentTeam._id },
            { allMatches: true },
            { team: null }
          ]
        });

        const emails = [...new Set(fanSubs.map(f => f.email?.toLowerCase().trim()).filter(Boolean))];
        console.log(`[Fan Goal Dispatch]: Found ${emails.length} subscriber(s) for ${scoringTeam.name} vs ${opponentTeam.name}:`, emails);

        if (emails.length > 0) {
          EmailService.sendFanGoalAlert({
            fanEmails: emails,
            scoringTeamName: scoringTeam.name,
            opponentTeamName: opponentTeam.name,
            playerName,
            minute: event.minute,
            homeScore: fixture.homeScore,
            awayScore: fixture.awayScore,
            isHomeScoring: isHome
          }).then(res => {
            console.log('[Fan Goal Email Sent Result]:', res);
          }).catch(e => console.error('[Fan Goal Email Error]:', e.message));
        }
      } catch (emailErr) {
        console.error('[Goal Email Trigger Error]:', emailErr.message);
      }
    } else if (type === 'OWN_GOAL') {
      const isHome = teamId ? fixture.homeTeam._id.toString() === teamId.toString() : true;
      // Own goal goes to the opponent
      if (isHome) {
        fixture.awayScore += 1;
      } else {
        fixture.homeScore += 1;
      }
      event.scoreAtEvent = { home: fixture.homeScore, away: fixture.awayScore };
      await fixture.save();

      // ASYNC FAN GOAL EMAIL DISPATCH (OWN GOAL)
      try {
        const creditedTeam = isHome ? fixture.awayTeam : fixture.homeTeam;
        const concedingTeam = isHome ? fixture.homeTeam : fixture.awayTeam;
        const ogPlayer = playerId ? await Player.findById(playerId) : null;
        const playerName = ogPlayer ? `${ogPlayer.firstName} ${ogPlayer.lastName} (O.G.)` : `${concedingTeam.name} (O.G.)`;

        const fanSubs = await FanSubscription.find({
          notifyGoals: true,
          $or: [
            { team: creditedTeam._id },
            { team: concedingTeam._id },
            { allMatches: true },
            { team: null }
          ]
        });

        const emails = [...new Set(fanSubs.map(f => f.email?.toLowerCase().trim()).filter(Boolean))];
        console.log(`[Fan Own Goal Dispatch]: Found ${emails.length} subscriber(s) for ${creditedTeam.name} vs ${concedingTeam.name}:`, emails);

        if (emails.length > 0) {
          EmailService.sendFanGoalAlert({
            fanEmails: emails,
            scoringTeamName: creditedTeam.name,
            opponentTeamName: concedingTeam.name,
            playerName,
            minute: event.minute,
            homeScore: fixture.homeScore,
            awayScore: fixture.awayScore,
            isHomeScoring: !isHome
          }).then(res => {
            console.log('[Fan Own Goal Email Sent Result]:', res);
          }).catch(e => console.error('[Fan Own Goal Email Error]:', e.message));
        }
      } catch (emailErr) {
        console.error('[Goal Email Trigger Error - Own Goal]:', emailErr.message);
      }
    } else if (type === 'YELLOW_CARD') {
      if (playerId) await Player.findByIdAndUpdate(playerId, { $inc: { 'stats.yellowCards': 1 } });
    } else if (type === 'RED_CARD') {
      if (playerId) await Player.findByIdAndUpdate(playerId, { $inc: { 'stats.redCards': 1 } });
    }

    await event.save();

    const populatedEvent = await MatchEvent.findById(event._id).populate('team player assistPlayer');
    const populatedFixture = await Fixture.findById(fixture._id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player');

    // Realtime broadcast to all clients & room
    broadcastMatchEvent(populatedEvent);
    broadcastMatchUpdate(populatedFixture);

    res.status(201).json({
      success: true,
      message: 'Match event recorded and broadcasted',
      data: { event: populatedEvent, fixture: populatedFixture }
    });
  } catch (err) {
    console.error('[Log Event Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Update Match In-Game Stats (Possession, Shots, Corners, Fouls)
router.patch('/:id/stats', requireOfficialOrAdmin, async (req, res) => {
  try {
    const fixture = await Fixture.findById(req.params.id);
    if (!fixture) return res.status(404).json({ success: false, error: 'Fixture not found' });

    fixture.stats = { ...fixture.stats.toObject(), ...req.body };
    await fixture.save();

    const populated = await Fixture.findById(fixture._id).populate('homeTeam awayTeam');
    broadcastMatchUpdate(populated);

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Delete Fixture (Admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const fixture = await Fixture.findByIdAndDelete(req.params.id);
    if (!fixture) return res.status(404).json({ success: false, error: 'Fixture not found' });
    await MatchEvent.deleteMany({ fixture: req.params.id });
    await recalculateStandings();
    res.json({ success: true, message: 'Fixture deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Force Recalculate Standings (Admin)
router.post('/recalculate', requireAdmin, async (req, res) => {
  try {
    await recalculateStandings();
    res.json({ success: true, message: 'League standings recalculated and broadcasted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for round-robin scheduling (Berger rotation method with 2-leg Home & Away support)
function buildRoundRobinSchedule(teamsList, legs = 2) {
  const teams = [...teamsList];
  if (teams.length < 2) return [];

  const isOdd = teams.length % 2 !== 0;
  if (isOdd) {
    teams.push(null); // Ghost team for BYE
  }

  const n = teams.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const leg1Rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const teamA = teams[m];
      const teamB = teams[n - 1 - m];

      if (teamA !== null && teamB !== null) {
        // Alternate home/away based on round to balance home advantage
        if (r % 2 === 1) {
          roundMatches.push({ homeTeam: teamB, awayTeam: teamA, leg: 1 });
        } else {
          roundMatches.push({ homeTeam: teamA, awayTeam: teamB, leg: 1 });
        }
      }
    }
    leg1Rounds.push(roundMatches);

    // Rotate array: keep teams[0] fixed, rotate the rest
    const last = teams.pop();
    teams.splice(1, 0, last);
  }

  if (Number(legs) === 1) {
    return leg1Rounds;
  }

  // Leg 2: Exact reverse of home and away, scheduled after all Leg 1 matchdays
  // This guarantees teams NEVER play back-to-back matches against each other!
  const leg2Rounds = leg1Rounds.map(roundMatches => {
    return roundMatches.map(m => ({
      homeTeam: m.awayTeam,
      awayTeam: m.homeTeam,
      leg: 2
    }));
  });

  return [...leg1Rounds, ...leg2Rounds];
}

// 10. POST /api/fixtures/auto-generate - Automated Tournament Scheduling Engine
router.post('/auto-generate', requireAdmin, async (req, res) => {
  try {
    const {
      mode = 'LEAGUE_22', // 'LEAGUE_22' | 'ALL_IN_ONE' | 'BY_GROUPS' | 'KNOCKOUT'
      legs = 2, // 2 (Home & Away, default) or 1 (Single Leg)
      startDate,
      daysBetweenRounds = 7,
      timeSlots = ['10:00', '13:00', '15:30', '18:00'],
      venues = ['Lekan Salami Stadium, Adamasingba, Ibadan'],
      clearExistingUpcoming = false,
      autoNotifyManagers = false
    } = req.body;

    const parsedLegs = (legs === '1_LEG' || Number(legs) === 1) ? 1 : 2;
    const baseDate = startDate ? new Date(startDate) : new Date();
    const effectiveVenues = (venues && venues.length > 0)
      ? venues
      : ['Lekan Salami Stadium, Adamasingba, Ibadan'];

    // 1. Fetch eligible teams
    const allTeams = await Team.find().sort({ name: 1 });
    if (allTeams.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'At least 2 registered teams are required to generate an automated tournament schedule.'
      });
    }

    // 2. Clear existing upcoming fixtures if requested
    let deletedCount = 0;
    if (clearExistingUpcoming) {
      const delRes = await Fixture.deleteMany({ status: 'UPCOMING' });
      deletedCount = delRes.deletedCount;
    }

    const scheduledFixtures = [];

    if (mode === 'LEAGUE_22' || mode === 'ALL_IN_ONE') {
      // 12-Team (or all-teams) League Format: 2 Legs (Home & Away) = 22 Matchdays for 12 clubs
      const rounds = buildRoundRobinSchedule(allTeams, parsedLegs);

      rounds.forEach((matches, roundIdx) => {
        const matchdayNum = roundIdx + 1;
        const roundDate = new Date(baseDate);
        roundDate.setDate(roundDate.getDate() + (roundIdx * Number(daysBetweenRounds)));
        const dateStr = roundDate.toISOString().split('T')[0];

        matches.forEach((m, matchIdx) => {
          const time = timeSlots[matchIdx % timeSlots.length];
          const venue = effectiveVenues[matchIdx % effectiveVenues.length];

          scheduledFixtures.push({
            homeTeam: m.homeTeam._id,
            awayTeam: m.awayTeam._id,
            stage: `Matchday ${matchdayNum}`,
            matchday: matchdayNum,
            leg: m.leg || (matchdayNum <= rounds.length / 2 ? 1 : 2),
            date: dateStr,
            time: time,
            venue: venue,
            status: 'UPCOMING'
          });
        });
      });
    } else if (mode === 'BY_GROUPS') {
      // Group teams by their designated group with 2-leg option
      const groupsMap = {};
      allTeams.forEach(t => {
        const grp = t.group || 'Group A';
        if (!groupsMap[grp]) groupsMap[grp] = [];
        groupsMap[grp].push(t);
      });

      const groupNames = Object.keys(groupsMap).sort();
      
      // Calculate max rounds across all groups
      let maxRounds = 0;
      const groupRoundsMap = {};
      groupNames.forEach(grp => {
        const rounds = buildRoundRobinSchedule(groupsMap[grp], parsedLegs);
        groupRoundsMap[grp] = rounds;
        if (rounds.length > maxRounds) maxRounds = rounds.length;
      });

      // Distribute rounds across matchday dates
      for (let roundIdx = 0; roundIdx < maxRounds; roundIdx++) {
        const matchdayNum = roundIdx + 1;
        const roundDate = new Date(baseDate);
        roundDate.setDate(roundDate.getDate() + (roundIdx * Number(daysBetweenRounds)));
        const dateStr = roundDate.toISOString().split('T')[0];

        let matchSlotIdx = 0;

        groupNames.forEach(grp => {
          const groupRounds = groupRoundsMap[grp];
          if (roundIdx < groupRounds.length) {
            const matches = groupRounds[roundIdx];
            matches.forEach(m => {
              const time = timeSlots[matchSlotIdx % timeSlots.length];
              const venue = effectiveVenues[matchSlotIdx % effectiveVenues.length];
              matchSlotIdx++;

              scheduledFixtures.push({
                homeTeam: m.homeTeam._id,
                awayTeam: m.awayTeam._id,
                stage: `${grp} - Matchday ${matchdayNum}`,
                matchday: matchdayNum,
                leg: m.leg || (matchdayNum <= groupRounds.length / 2 ? 1 : 2),
                date: dateStr,
                time: time,
                venue: venue,
                status: 'UPCOMING'
              });
            });
          }
        });
      }
    } else if (mode === 'KNOCKOUT') {
      // Single elimination tournament bracket round 1
      const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
      const half = Math.floor(shuffled.length / 2);
      const dateStr = baseDate.toISOString().split('T')[0];

      for (let i = 0; i < half; i++) {
        const time = timeSlots[i % timeSlots.length];
        const venue = effectiveVenues[i % effectiveVenues.length];
        scheduledFixtures.push({
          homeTeam: shuffled[i * 2]._id,
          awayTeam: shuffled[i * 2 + 1]._id,
          stage: half >= 4 ? 'Quarter-Final' : half === 2 ? 'Semi-Final' : 'Grand Final',
          matchday: 1,
          leg: 1,
          date: dateStr,
          time: time,
          venue: venue,
          status: 'UPCOMING'
        });
      }
    }

    if (scheduledFixtures.length === 0) {
      return res.status(400).json({ success: false, error: 'No matchups could be generated with the current team roster.' });
    }

    // 3. Save all fixtures in database
    const createdDocs = await Fixture.insertMany(scheduledFixtures);

    // 4. Populate with team details
    const populated = await Fixture.find({ _id: { $in: createdDocs.map(d => d._id) } })
      .populate('homeTeam awayTeam')
      .sort({ date: 1, time: 1 });

    // 5. Broadcast live update to all connected screens
    populated.forEach(f => broadcastMatchUpdate(f));

    // 6. Optional automated manager notification
    let notifiedCount = 0;
    if (autoNotifyManagers) {
      const allUsers = await User.find({ role: 'manager' });
      const userEmailByTeamId = {};
      allUsers.forEach(u => {
        if (u.team) userEmailByTeamId[u.team.toString()] = u.email;
      });

      for (const f of populated) {
        const homeEmail = f.homeTeam?.managerEmail || (f.homeTeam?._id ? userEmailByTeamId[f.homeTeam._id.toString()] : null);
        const awayEmail = f.awayTeam?.managerEmail || (f.awayTeam?._id ? userEmailByTeamId[f.awayTeam._id.toString()] : null);

        if (homeEmail || awayEmail) {
          EmailService.sendFixtureAnnouncement({
            homeManagerEmail: homeEmail,
            awayManagerEmail: awayEmail,
            homeTeamName: f.homeTeam?.name,
            awayTeamName: f.awayTeam?.name,
            date: f.date,
            time: f.time,
            venue: f.venue,
            stage: f.stage
          }).catch(e => console.error('[Auto Scheduler Email Error]:', e.message));
          notifiedCount++;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `Tournament scheduling completed! ${createdDocs.length} official match fixture(s) automatically created across ${allTeams.length} teams.`,
      data: {
        fixturesCount: createdDocs.length,
        deletedOldUpcomingCount: deletedCount,
        teamsCount: allTeams.length,
        notifiedCount,
        fixtures: populated
      }
    });
  } catch (err) {
    console.error('[Auto Generate Fixtures Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

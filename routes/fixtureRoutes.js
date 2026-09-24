const express = require('express');
const router = express.Router();
const Fixture = require('../models/Fixture');
const MatchEvent = require('../models/MatchEvent');
const Team = require('../models/Team');
const Player = require('../models/Player');
const FanSubscription = require('../models/FanSubscription');
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
    const { homeTeam, awayTeam, stage, date, time, venue } = req.body;

    if (!homeTeam || !awayTeam || !date || !time) {
      return res.status(400).json({ success: false, error: 'Home team, away team, date, and time are required' });
    }

    if (homeTeam === awayTeam) {
      return res.status(400).json({ success: false, error: 'A team cannot play against itself' });
    }

    const fixture = new Fixture({
      homeTeam,
      awayTeam,
      stage: stage || 'Matchday 1',
      date,
      time,
      venue: venue || 'Pitch 1, Legacy Arena',
      status: 'UPCOMING'
    });

    await fixture.save();

    const populated = await Fixture.findById(fixture._id).populate('homeTeam awayTeam');

    // Trigger fixture announcement email to both managers
    if (populated.homeTeam?.managerEmail || populated.awayTeam?.managerEmail) {
      EmailService.sendFixtureAnnouncement({
        homeManagerEmail: populated.homeTeam.managerEmail,
        awayManagerEmail: populated.awayTeam.managerEmail,
        homeTeamName: populated.homeTeam.name,
        awayTeamName: populated.awayTeam.name,
        date: populated.date,
        time: populated.time,
        venue: populated.venue,
        stage: populated.stage
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
      const isHome = fixture.homeTeam._id.toString() === teamId.toString();
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

        // Fetch fans who subscribed to this scoring team
        const fanSubs = await FanSubscription.find({ team: scoringTeam._id, notifyGoals: true });
        const emails = fanSubs.map(f => f.email);

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
          }).catch(e => console.error('[Fan Goal Email Error]:', e.message));
        }
      } catch (emailErr) {
        console.error('[Goal Email Trigger Error]:', emailErr.message);
      }
    } else if (type === 'OWN_GOAL') {
      const isHome = fixture.homeTeam._id.toString() === teamId.toString();
      // Own goal goes to the opponent
      if (isHome) {
        fixture.awayScore += 1;
      } else {
        fixture.homeScore += 1;
      }
      event.scoreAtEvent = { home: fixture.homeScore, away: fixture.awayScore };
      await fixture.save();
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

// Helper for round-robin scheduling (Berger rotation method)
function buildRoundRobinSchedule(teamsList) {
  const teams = [...teamsList];
  if (teams.length < 2) return [];

  const isOdd = teams.length % 2 !== 0;
  if (isOdd) {
    teams.push(null); // Ghost team for BYE
  }

  const n = teams.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const teamA = teams[m];
      const teamB = teams[n - 1 - m];

      if (teamA !== null && teamB !== null) {
        // Alternate home/away based on round to balance home advantage
        if (r % 2 === 1) {
          roundMatches.push({ homeTeam: teamB, awayTeam: teamA });
        } else {
          roundMatches.push({ homeTeam: teamA, awayTeam: teamB });
        }
      }
    }
    rounds.push(roundMatches);

    // Rotate array: keep teams[0] fixed, rotate the rest
    const last = teams.pop();
    teams.splice(1, 0, last);
  }

  return rounds;
}

// 10. POST /api/fixtures/auto-generate - Automated Tournament Scheduling Engine
router.post('/auto-generate', requireAdmin, async (req, res) => {
  try {
    const {
      mode = 'BY_GROUPS', // 'BY_GROUPS' | 'ALL_IN_ONE' | 'KNOCKOUT'
      startDate,
      daysBetweenRounds = 7,
      timeSlots = ['10:00', '13:00', '16:00', '18:30'],
      venues = ['Legacy Arena Pitch 1', 'Legacy Arena Pitch 2', 'National Stadium Arena'],
      clearExistingUpcoming = false,
      autoNotifyManagers = false
    } = req.body;

    const baseDate = startDate ? new Date(startDate) : new Date();

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

    if (mode === 'BY_GROUPS') {
      // Group teams by their designated group
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
        const rounds = buildRoundRobinSchedule(groupsMap[grp]);
        groupRoundsMap[grp] = rounds;
        if (rounds.length > maxRounds) maxRounds = rounds.length;
      });

      // Distribute rounds across matchday dates
      for (let roundIdx = 0; roundIdx < maxRounds; roundIdx++) {
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
              const venue = venues[matchSlotIdx % venues.length];
              matchSlotIdx++;

              scheduledFixtures.push({
                homeTeam: m.homeTeam._id,
                awayTeam: m.awayTeam._id,
                stage: `${grp} - Matchday ${roundIdx + 1}`,
                date: dateStr,
                time: time,
                venue: venue,
                status: 'UPCOMING'
              });
            });
          }
        });
      }
    } else if (mode === 'ALL_IN_ONE') {
      // All-play-all full championship schedule
      const rounds = buildRoundRobinSchedule(allTeams);
      rounds.forEach((matches, roundIdx) => {
        const roundDate = new Date(baseDate);
        roundDate.setDate(roundDate.getDate() + (roundIdx * Number(daysBetweenRounds)));
        const dateStr = roundDate.toISOString().split('T')[0];

        matches.forEach((m, matchIdx) => {
          const time = timeSlots[matchIdx % timeSlots.length];
          const venue = venues[matchIdx % venues.length];

          scheduledFixtures.push({
            homeTeam: m.homeTeam._id,
            awayTeam: m.awayTeam._id,
            stage: `Matchday ${roundIdx + 1}`,
            date: dateStr,
            time: time,
            venue: venue,
            status: 'UPCOMING'
          });
        });
      });
    } else if (mode === 'KNOCKOUT') {
      // Single elimination tournament bracket round 1
      const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
      const half = Math.floor(shuffled.length / 2);
      const dateStr = baseDate.toISOString().split('T')[0];

      for (let i = 0; i < half; i++) {
        const time = timeSlots[i % timeSlots.length];
        const venue = venues[i % venues.length];
        scheduledFixtures.push({
          homeTeam: shuffled[i * 2]._id,
          awayTeam: shuffled[i * 2 + 1]._id,
          stage: half >= 4 ? 'Quarter-Final' : half === 2 ? 'Semi-Final' : 'Grand Final',
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
      for (const f of populated) {
        if (f.homeTeam?.managerEmail || f.awayTeam?.managerEmail) {
          EmailService.sendFixtureAnnouncement({
            homeManagerEmail: f.homeTeam?.managerEmail,
            awayManagerEmail: f.awayTeam?.managerEmail,
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

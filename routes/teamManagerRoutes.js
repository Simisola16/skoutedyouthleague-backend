const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const { requireTeamManager } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinary');
const { broadcastMatchUpdate } = require('../services/socketService');
const EmailService = require('../services/emailService');

// All endpoints in this router require authenticated team manager clearance
router.use(requireTeamManager);

// MAX REGISTERED SQUAD LIMIT
const MAX_SQUAD_LIMIT = 25;

// Helper: Calculate fixture kickoff Date
function getKickoffDateTime(fixture) {
  try {
    if (fixture.date && fixture.time) {
      return new Date(`${fixture.date}T${fixture.time}:00`);
    }
    if (fixture.date) {
      return new Date(fixture.date);
    }
  } catch (e) {
    // fallback
  }
  return new Date();
}

// -------------------------------------------------------------
// 1. GET /api/team/dashboard - Overview Dashboard Data
// -------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  try {
    const team = await Team.findById(req.teamId);
    const players = await Player.find({ team: req.teamId }).sort({ jerseyNumber: 1 });

    // Find all fixtures for this team
    const allFixtures = await Fixture.find({
      $or: [{ homeTeam: req.teamId }, { awayTeam: req.teamId }]
    })
      .populate('homeTeam', 'name shortCode logo homeKitColor awayKitColor')
      .populate('awayTeam', 'name shortCode logo homeKitColor awayKitColor')
      .sort({ date: 1, time: 1 });

    const now = new Date();

    // Upcoming fixture: nearest future fixture or active live fixture
    const upcomingFixtures = allFixtures.filter(f => f.status !== 'FT');
    const pastFixtures = allFixtures.filter(f => f.status === 'FT');

    let nextMatch = null;
    let nextMatchAlert = null;

    if (upcomingFixtures.length > 0) {
      const targetFixture = upcomingFixtures[0];
      const isHome = targetFixture.homeTeam?._id?.toString() === req.teamId.toString();
      const myLineup = isHome ? targetFixture.homeLineup : targetFixture.awayLineup;
      const isLineupSubmitted = myLineup && myLineup.isLocked;

      const kickoffTime = getKickoffDateTime(targetFixture);
      const diffMs = kickoffTime.getTime() - now.getTime();
      const hoursUntilKickoff = diffMs / (1000 * 60 * 60);

      // 3 hours before kickoff deadline
      const deadlineMs = kickoffTime.getTime() - (3 * 60 * 60 * 1000);
      const isPastDeadline = now.getTime() > deadlineMs;

      let lineupStatus = 'Pending Submission';
      if (isLineupSubmitted) {
        lineupStatus = 'Submitted & Locked';
      } else if (isPastDeadline || targetFixture.status !== 'SCHEDULED') {
        lineupStatus = 'Late / Unsubmitted';
      }

      nextMatch = {
        _id: targetFixture._id,
        date: targetFixture.date,
        time: targetFixture.time,
        venue: targetFixture.venue,
        round: targetFixture.round,
        status: targetFixture.status,
        isHome,
        homeTeam: targetFixture.homeTeam,
        awayTeam: targetFixture.awayTeam,
        opponent: isHome ? targetFixture.awayTeam : targetFixture.homeTeam,
        kickoffTimestamp: kickoffTime.getTime(),
        hoursUntilKickoff: Math.max(0, hoursUntilKickoff),
        isLineupSubmitted: !!isLineupSubmitted,
        lineupStatus,
        lineupDeadline: new Date(deadlineMs).toISOString(),
        myLineup
      };

      // Check for urgent banner (within 6 hours and lineup not yet submitted)
      if (!isLineupSubmitted && hoursUntilKickoff <= 6 && hoursUntilKickoff > 0) {
        nextMatchAlert = {
          level: hoursUntilKickoff <= 3 ? 'danger' : 'warning',
          message: hoursUntilKickoff <= 3
            ? `⚠️ CRITICAL: Kickoff in ${Math.round(hoursUntilKickoff * 60)} minutes! Your official Starting XI deadline has expired. Submit lineup immediately!`
            : `⚠️ URGENT: Kickoff is in under ${Math.ceil(hoursUntilKickoff)} hours! Official Starting XI must be locked in at least 3 hours before kickoff.`
        };
      }
    }

    res.json({
      success: true,
      data: {
        team,
        user: {
          _id: req.teamUser._id,
          name: req.teamUser.name,
          email: req.teamUser.email,
          phone: req.teamUser.phone,
          role: req.teamUser.role
        },
        squadCount: players.length,
        maxSquadLimit: MAX_SQUAD_LIMIT,
        nextMatch,
        nextMatchAlert,
        summary: {
          totalMatches: allFixtures.length,
          upcomingCount: upcomingFixtures.length,
          pastCount: pastFixtures.length,
          points: team.stats?.points || 0,
          won: team.stats?.won || 0,
          drawn: team.stats?.drawn || 0,
          lost: team.stats?.lost || 0,
          goalsFor: team.stats?.goalsFor || 0,
          goalsAgainst: team.stats?.goalsAgainst || 0
        }
      }
    });
  } catch (err) {
    console.error('[Team Dashboard Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 2. SQUAD ROSTER ENDPOINTS (/api/team/roster)
// -------------------------------------------------------------

// GET full squad
router.get('/roster', async (req, res) => {
  try {
    const players = await Player.find({ team: req.teamId }).sort({ jerseyNumber: 1 });
    res.json({
      success: true,
      data: {
        players,
        count: players.length,
        maxLimit: MAX_SQUAD_LIMIT
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add player to squad (/api/team/roster and /api/team/players)
const handleAddPlayer = async (req, res) => {
  try {
    const team = await Team.findById(req.teamId);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const isApproved = team.verificationStatus === 'approved' || (team.status === 'Verified' && team.verificationStatus !== 'rejected' && team.verificationStatus !== 'pending');
    if (!isApproved) {
      return res.status(403).json({
        success: false,
        error: 'Your team has not yet been verified by the administrator. Player registration is locked.'
      });
    }

    const currentCount = await Player.countDocuments({ team: req.teamId });
    if (currentCount >= MAX_SQUAD_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `Squad roster limit reached (${MAX_SQUAD_LIMIT} players maximum). Remove an existing player or contact tournament organizers.`
      });
    }

    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      preferredFoot,
      age,
      dateOfBirth,
      roles,
      role,
      heightCm,
      weightKg,
      nationality
    } = req.body;

    if (!firstName || !lastName || !jerseyNumber || !position) {
      return res.status(400).json({
        success: false,
        error: 'First name, last name, jersey number, and playing position are required'
      });
    }

    const parsedNumber = Number(jerseyNumber);
    if (isNaN(parsedNumber) || parsedNumber < 1 || parsedNumber > 99) {
      return res.status(400).json({
        success: false,
        error: 'Jersey number must be between 1 and 99'
      });
    }

    // Duplicate jersey validation within team
    const duplicate = await Player.findOne({
      team: req.teamId,
      jerseyNumber: parsedNumber
    });

    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: `Jersey #${parsedNumber} is already registered to ${duplicate.firstName} ${duplicate.lastName}. Each player on your squad must have a unique number.`
      });
    }

    const photoUrl = req.file ? req.file.path : (req.body.photoUrl || req.body.photo || '');

    // Parse roles if provided as string or array
    let parsedRoles = ['Regular Squad Player'];
    if (roles) {
      if (Array.isArray(roles)) parsedRoles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          if (Array.isArray(parsed)) parsedRoles = parsed;
          else parsedRoles = roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          parsedRoles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    } else if (role) {
      parsedRoles = [role];
    }

    const newPlayer = new Player({
      team: req.teamId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jerseyNumber: parsedNumber,
      position: position.trim(),
      subPosition: subPosition ? subPosition.trim() : '',
      preferredFoot: preferredFoot || 'Right',
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      nationality: nationality ? nationality.trim() : 'Nigeria',
      age: Number(age) || 17,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      roles: parsedRoles,
      role: role || (parsedRoles.includes('Captain') ? 'Captain' : parsedRoles.includes('Vice Captain') ? 'Vice Captain' : parsedRoles[0]),
      photo: photoUrl,
      photoUrl: photoUrl,
      status: 'Eligible',
      isEligible: true
    });

    await newPlayer.save();

    res.status(201).json({
      success: true,
      message: `Player #${newPlayer.jerseyNumber} ${newPlayer.firstName} ${newPlayer.lastName} successfully registered!`,
      data: newPlayer
    });
  } catch (err) {
    console.error('[Add Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/roster', upload.single('photo'), handleAddPlayer);
router.post('/players', upload.single('photo'), handleAddPlayer);

// PUT edit player
router.put('/roster/:playerId', upload.single('photo'), async (req, res) => {
  try {
    const { playerId } = req.params;
    const player = await Player.findOne({ _id: playerId, team: req.teamId });
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player record not found in your squad' });
    }

    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      preferredFoot,
      age,
      dateOfBirth,
      roles,
      role,
      heightCm,
      weightKg,
      nationality
    } = req.body;

    if (jerseyNumber) {
      const parsedNumber = Number(jerseyNumber);
      if (parsedNumber !== player.jerseyNumber) {
        // Check duplicate excluding this player
        const duplicate = await Player.findOne({
          team: req.teamId,
          jerseyNumber: parsedNumber,
          _id: { $ne: player._id }
        });
        if (duplicate) {
          return res.status(400).json({
            success: false,
            error: `Jersey #${parsedNumber} is already taken by ${duplicate.firstName} ${duplicate.lastName}`
          });
        }
        player.jerseyNumber = parsedNumber;
      }
    }

    if (firstName) player.firstName = firstName.trim();
    if (lastName) player.lastName = lastName.trim();
    if (position) player.position = position.trim();
    if (subPosition !== undefined) player.subPosition = subPosition.trim();
    if (preferredFoot) player.preferredFoot = preferredFoot;
    if (heightCm !== undefined) player.heightCm = heightCm ? Number(heightCm) : null;
    if (weightKg !== undefined) player.weightKg = weightKg ? Number(weightKg) : null;
    if (nationality) player.nationality = nationality.trim();
    if (age) player.age = Number(age);
    if (dateOfBirth) player.dateOfBirth = new Date(dateOfBirth);

    if (roles) {
      if (Array.isArray(roles)) player.roles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          if (Array.isArray(parsed)) player.roles = parsed;
          else player.roles = roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          player.roles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    }
    if (role) player.role = role;

    if (req.file) {
      player.photo = req.file.path;
      player.photoUrl = req.file.path;
    } else if (req.body.photoUrl) {
      player.photo = req.body.photoUrl;
      player.photoUrl = req.body.photoUrl;
    } else if (req.body.photo) {
      player.photo = req.body.photo;
      player.photoUrl = req.body.photo;
    }

    await player.save();

    res.json({
      success: true,
      message: 'Player information updated successfully',
      data: player
    });
  } catch (err) {
    console.error('[Edit Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE remove player (before tournament lock)
router.delete('/roster/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const player = await Player.findOne({ _id: playerId, team: req.teamId });
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player record not found in your squad' });
    }

    await Player.deleteOne({ _id: playerId });

    res.json({
      success: true,
      message: `Player #${player.jerseyNumber} ${player.firstName} ${player.lastName} removed from squad roster.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. MATCHDAY LINEUP SUBMISSION & FIXTURES HUB
// -------------------------------------------------------------

// GET team fixtures & results
router.get('/fixtures', async (req, res) => {
  try {
    const fixtures = await Fixture.find({
      $or: [{ homeTeam: req.teamId }, { awayTeam: req.teamId }]
    })
      .populate('homeTeam', 'name shortCode logo homeKitColor awayKitColor')
      .populate('awayTeam', 'name shortCode logo homeKitColor awayKitColor')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player homeLineup.bench.player awayLineup.bench.player')
      .sort({ date: 1, time: 1 });

    const now = new Date();

    const formatted = fixtures.map(f => {
      const isHome = f.homeTeam?._id?.toString() === req.teamId.toString();
      const myLineup = isHome ? f.homeLineup : f.awayLineup;
      const isLocked = myLineup && myLineup.isLocked;

      const kickoffTime = getKickoffDateTime(f);
      const deadlineMs = kickoffTime.getTime() - (3 * 60 * 60 * 1000);
      const isPastDeadline = now.getTime() > deadlineMs;

      let lineupStatus = 'Pending Submission';
      if (isLocked) {
        lineupStatus = 'Submitted & Locked';
      } else if (isPastDeadline || f.status !== 'SCHEDULED') {
        lineupStatus = 'Late / Unsubmitted';
      }

      // Filter events relevant to this team
      const teamEvents = (f.events || []).filter(e => {
        return e.team && e.team.toString() === req.teamId.toString();
      });

      return {
        _id: f._id,
        date: f.date,
        time: f.time,
        venue: f.venue,
        round: f.round,
        status: f.status,
        minute: f.minute,
        score: f.score,
        isHome,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        opponent: isHome ? f.awayTeam : f.homeTeam,
        kickoffTimestamp: kickoffTime.getTime(),
        lineupDeadline: new Date(deadlineMs).toISOString(),
        lineupStatus,
        isLocked: !!isLocked,
        myLineup,
        events: f.events || [],
        teamEvents
      };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST submit & lock-in matchday lineup
router.post('/lineup', async (req, res) => {
  try {
    const { fixtureId, formation = '4-3-3', startingXI, bench } = req.body;

    if (!fixtureId) {
      return res.status(400).json({ success: false, error: 'Fixture ID is required' });
    }

    if (!startingXI || !Array.isArray(startingXI) || startingXI.length !== 11) {
      return res.status(400).json({
        success: false,
        error: `Starting XI must contain exactly 11 players. Currently selected: ${startingXI ? startingXI.length : 0}`
      });
    }

    if (bench && bench.length > 7) {
      return res.status(400).json({
        success: false,
        error: 'A maximum of 7 substitutes may be selected on the matchday bench.'
      });
    }

    const fixture = await Fixture.findById(fixtureId);
    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Match fixture not found' });
    }

    const isHome = fixture.homeTeam.toString() === req.teamId.toString();
    const isAway = fixture.awayTeam.toString() === req.teamId.toString();

    if (!isHome && !isAway) {
      return res.status(403).json({ success: false, error: 'Your team is not scheduled in this fixture' });
    }

    // Verify all players belong to this team and are eligible
    const playerIds = [
      ...startingXI.map(s => s.playerId || s.player),
      ...(bench || []).map(b => b.playerId || b.player)
    ];

    const teamPlayers = await Player.find({ _id: { $in: playerIds }, team: req.teamId });
    if (teamPlayers.length !== playerIds.length) {
      return res.status(400).json({
        success: false,
        error: 'One or more selected players are not registered to your squad.'
      });
    }

    // Check for suspended players
    const suspended = teamPlayers.filter(p => !p.isEligible || p.status === 'Suspended');
    if (suspended.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Disciplinary block: Player #${suspended[0].jerseyNumber} ${suspended[0].firstName} ${suspended[0].lastName} is currently suspended and ineligible.`
      });
    }

    // Verify exactly one captain
    const captainCount = startingXI.filter(s => s.isCaptain).length;
    if (captainCount !== 1) {
      return res.status(400).json({
        success: false,
        error: 'You must designate exactly 1 Captain among your starting 11 players.'
      });
    }

    const lineupPayload = {
      formation,
      startingXI: startingXI.map(slot => ({
        player: slot.playerId || slot.player,
        position: slot.position,
        gridX: slot.gridX !== undefined ? slot.gridX : 50,
        gridY: slot.gridY !== undefined ? slot.gridY : 50,
        isCaptain: !!slot.isCaptain
      })),
      bench: (bench || []).map(b => ({
        player: b.playerId || b.player,
        position: b.position || 'SUB'
      })),
      isLocked: true,
      submittedAt: new Date()
    };

    if (isHome) {
      fixture.homeLineup = lineupPayload;
    } else {
      fixture.awayLineup = lineupPayload;
    }

    await fixture.save();

    const populated = await Fixture.findById(fixture._id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player homeLineup.bench.player awayLineup.bench.player');

    broadcastMatchUpdate(populated);

    res.json({
      success: true,
      message: 'Official Starting XI and Matchday Bench successfully locked in and submitted!',
      data: populated
    });
  } catch (err) {
    console.error('[Submit Lineup Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 4. TEAM PROFILE & SETTINGS ENDPOINTS
// -------------------------------------------------------------

// GET team profile
router.get('/profile', async (req, res) => {
  try {
    const team = await Team.findById(req.teamId);
    res.json({
      success: true,
      data: {
        team,
        user: {
          _id: req.teamUser._id,
          name: req.teamUser.name,
          email: req.teamUser.email,
          phone: req.teamUser.phone,
          role: req.teamUser.role
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update team profile (crest, kit colors, contact info)
router.put('/profile', upload.single('crest'), async (req, res) => {
  try {
    const team = await Team.findById(req.teamId);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const {
      homeGround,
      homeKitColor,
      awayKitColor,
      managerName,
      managerPhone
    } = req.body;

    if (homeGround) team.homeGround = homeGround.trim();
    if (homeKitColor) team.homeKitColor = homeKitColor;
    if (awayKitColor) team.awayKitColor = awayKitColor;
    if (managerName) team.managerName = managerName.trim();
    if (managerPhone) team.managerPhone = managerPhone.trim();

    if (req.file) {
      team.logo = req.file.path;
    } else if (req.body.logo) {
      team.logo = req.body.logo;
    }

    await team.save();

    // Also update User profile if name/phone changed
    if (managerName || managerPhone) {
      await User.findByIdAndUpdate(req.teamUser._id, {
        name: managerName || req.teamUser.name,
        phone: managerPhone || req.teamUser.phone
      });
    }

    res.json({
      success: true,
      message: 'Club profile and kit colors updated successfully!',
      data: team
    });
  } catch (err) {
    console.error('[Update Profile Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST change password with Resend security email
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(req.teamUser._id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password does not match' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Send Resend security confirmation email
    await EmailService.sendPasswordChangeNotice({
      email: user.email,
      name: user.name,
      teamName: req.team.name
    });

    res.json({
      success: true,
      message: 'Password updated successfully. A confirmation email has been dispatched to your inbox.'
    });
  } catch (err) {
    console.error('[Change Password Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

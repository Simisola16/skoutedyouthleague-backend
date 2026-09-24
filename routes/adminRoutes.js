const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const EmailService = require('../services/emailService');
const { requireAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinary');

// All routes in this router require role: "admin"
router.use(requireAdmin);

// 1. GET /api/admin/teams
// Directory of all teams with search, group filter, squad count, and lineup status
router.get('/teams', async (req, res) => {
  try {
    const { search, group } = req.query;
    const filter = {};

    if (group && group !== 'All') {
      filter.group = group;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { shortCode: { $regex: search, $options: 'i' } }
      ];
    }

    const teams = await Team.find(filter).sort({ name: 1 });

    // Enhance each team with squad count, manager user verification status, and upcoming lineup status
    const teamsWithDetails = await Promise.all(
      teams.map(async (t) => {
        const squadCount = await Player.countDocuments({ team: t._id });
        
        // Find associated manager user account
        let managerUser = null;
        if (t.manager) {
          managerUser = await User.findById(t.manager).select('name email phone isVerified role');
        } else if (t.managerEmail) {
          managerUser = await User.findOne({ email: t.managerEmail.toLowerCase().trim() }).select('name email phone isVerified role');
        } else {
          managerUser = await User.findOne({ team: t._id }).select('name email phone isVerified role');
        }

        const isVerified = t.status === 'Verified' && (managerUser ? managerUser.isVerified : true);

        // Find next upcoming fixture for this team
        const nextFixture = await Fixture.findOne({
          $or: [{ homeTeam: t._id }, { awayTeam: t._id }],
          status: { $in: ['UPCOMING', '1ST HALF', 'HT', '2ND HALF'] }
        }).sort({ date: 1, time: 1 });

        let lineupStatus = 'No Match';
        let pendingFixtureId = null;

        if (nextFixture) {
          const isHome = nextFixture.homeTeam.toString() === t._id.toString();
          const lineup = isHome ? nextFixture.homeLineup : nextFixture.awayLineup;
          
          if (lineup?.isLocked) {
            lineupStatus = 'Lineup Locked';
          } else {
            lineupStatus = 'Pending Lineup';
            pendingFixtureId = nextFixture._id;
          }
        }

        return {
          ...t.toObject(),
          squadCount,
          lineupStatus,
          pendingFixtureId,
          nextFixture,
          managerUser: managerUser ? {
            _id: managerUser._id,
            name: managerUser.name,
            email: managerUser.email,
            phone: managerUser.phone,
            isVerified: managerUser.isVerified,
            role: managerUser.role
          } : null,
          isVerified
        };
      })
    );

    res.json({ success: true, data: teamsWithDetails });
  } catch (err) {
    console.error('[Admin Get Teams Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/admin/teams/:id/players
// Full squad list for specific team
router.get('/teams/:id/players', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const players = await Player.find({ team: team._id }).sort({ jerseyNumber: 1 });

    res.json({
      success: true,
      data: {
        team,
        players
      }
    });
  } catch (err) {
    console.error('[Admin Get Squad Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PATCH /api/admin/players/:id
// Correct player info, upload photo, or toggle eligibility/suspension
router.patch('/players/:id', upload.single('photo'), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      roles,
      role,
      status,
      isEligible,
      suspensionReason,
      age,
      dateOfBirth,
      preferredFoot,
      heightCm,
      weightKg,
      nationality
    } = req.body;

    const player = await Player.findById(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    // Check jersey number collision within same team if changing
    if (jerseyNumber !== undefined && Number(jerseyNumber) !== player.jerseyNumber) {
      const duplicate = await Player.findOne({
        team: player.team,
        jerseyNumber: Number(jerseyNumber),
        _id: { $ne: player._id }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: `Jersey #${jerseyNumber} is already taken by ${duplicate.firstName} ${duplicate.lastName}`
        });
      }
      player.jerseyNumber = Number(jerseyNumber);
    }

    if (firstName) player.firstName = firstName.trim();
    if (lastName) player.lastName = lastName.trim();
    if (position) player.position = position.trim();
    if (subPosition !== undefined) player.subPosition = subPosition.trim();
    if (role) player.role = role;
    if (roles) {
      if (Array.isArray(roles)) player.roles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          player.roles = Array.isArray(parsed) ? parsed : roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          player.roles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    }
    if (status) player.status = status;
    if (isEligible !== undefined) player.isEligible = Boolean(isEligible);
    if (suspensionReason !== undefined) player.suspensionReason = suspensionReason;
    if (age !== undefined) player.age = Number(age);
    if (dateOfBirth) player.dateOfBirth = new Date(dateOfBirth);
    if (preferredFoot) player.preferredFoot = preferredFoot;
    if (heightCm !== undefined) player.heightCm = heightCm ? Number(heightCm) : null;
    if (weightKg !== undefined) player.weightKg = weightKg ? Number(weightKg) : null;
    if (nationality) player.nationality = nationality.trim();

    if (req.file) {
      player.photo = req.file.path;
      player.photoUrl = req.file.path;
    } else if (req.body.photoUrl) {
      player.photo = req.body.photoUrl;
      player.photoUrl = req.body.photoUrl;
    }

    await player.save();

    res.json({
      success: true,
      message: 'Player record updated successfully',
      data: player
    });
  } catch (err) {
    console.error('[Admin Update Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3B. POST /api/admin/teams/:teamId/players - Admin Add Player to Team
router.post('/teams/:teamId/players', upload.single('photo'), async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });

    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      roles,
      role,
      preferredFoot,
      heightCm,
      weightKg,
      nationality,
      dateOfBirth,
      age
    } = req.body;

    if (!firstName || !lastName || !jerseyNumber || !position) {
      return res.status(400).json({ success: false, error: 'First name, last name, jersey number, and position are required' });
    }

    const parsedNumber = Number(jerseyNumber);
    const duplicate = await Player.findOne({ team: teamId, jerseyNumber: parsedNumber });
    if (duplicate) {
      return res.status(400).json({ success: false, error: `Jersey #${parsedNumber} is already registered on this squad` });
    }

    const photoUrl = req.file ? req.file.path : (req.body.photoUrl || req.body.photo || '');
    let parsedRoles = ['Regular Squad Player'];
    if (roles) {
      if (Array.isArray(roles)) parsedRoles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          parsedRoles = Array.isArray(parsed) ? parsed : roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          parsedRoles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    } else if (role) {
      parsedRoles = [role];
    }

    const newPlayer = new Player({
      team: teamId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jerseyNumber: parsedNumber,
      position: position.trim(),
      subPosition: subPosition ? subPosition.trim() : '',
      preferredFoot: preferredFoot || 'Right',
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      nationality: nationality ? nationality.trim() : 'Nigeria',
      age: Number(age) || 18,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      roles: parsedRoles,
      role: role || (parsedRoles.includes('Captain') ? 'Captain' : parsedRoles[0]),
      photo: photoUrl,
      photoUrl: photoUrl,
      status: 'Eligible',
      isEligible: true
    });

    await newPlayer.save();
    res.status(201).json({ success: true, message: 'Player registered successfully', data: newPlayer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/admin/fixtures/:id/remind-lineup
// Manually dispatch Starting XI urgent reminder email to team manager(s)
router.post('/fixtures/:id/remind-lineup', async (req, res) => {
  try {
    const fixture = await Fixture.findById(req.params.id).populate('homeTeam awayTeam');
    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Fixture not found' });
    }

    const { teamId } = req.body; // optional: target specific team or both

    let sentCount = 0;
    const errors = [];

    // Check Home Team
    if (!teamId || teamId.toString() === fixture.homeTeam?._id.toString()) {
      if (fixture.homeTeam?.managerEmail && !fixture.homeLineup?.isLocked) {
        try {
          await EmailService.sendLineupUrgentReminder({
            managerEmail: fixture.homeTeam.managerEmail,
            teamName: fixture.homeTeam.name,
            opponentName: fixture.awayTeam?.name,
            date: fixture.date,
            time: fixture.time,
            venue: fixture.venue,
            fixtureId: fixture._id
          });
          sentCount++;
        } catch (e) {
          errors.push(`Home manager email error: ${e.message}`);
        }
      }
    }

    // Check Away Team
    if (!teamId || teamId.toString() === fixture.awayTeam?._id.toString()) {
      if (fixture.awayTeam?.managerEmail && !fixture.awayLineup?.isLocked) {
        try {
          await EmailService.sendLineupUrgentReminder({
            managerEmail: fixture.awayTeam.managerEmail,
            teamName: fixture.awayTeam.name,
            opponentName: fixture.homeTeam?.name,
            date: fixture.date,
            time: fixture.time,
            venue: fixture.venue,
            fixtureId: fixture._id
          });
          sentCount++;
        } catch (e) {
          errors.push(`Away manager email error: ${e.message}`);
        }
      }
    }

    res.json({
      success: true,
      message: `Lineup reminder email sent to ${sentCount} team manager(s).`,
      sentCount,
      errors
    });
  } catch (err) {
    console.error('[Admin Lineup Reminder Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/admin/teams/:id/verify (and PATCH /api/admin/teams/:id/status)
// Directly verify a team and its manager without needing OTP
router.post('/teams/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { status = 'Verified' } = req.body;

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    team.status = status;
    await team.save();

    const isVerifiedBool = status === 'Verified';

    // Query for manager user(s) associated with this team
    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }

    const updatedUsers = await User.updateMany(
      { $or: userQueries },
      {
        $set: {
          isVerified: isVerifiedBool,
          verificationOtp: null,
          otpExpiresAt: null,
          team: team._id
        }
      }
    );

    // If team.manager was not set, link it to the matching user
    if (!team.manager) {
      const foundUser = await User.findOne({ $or: userQueries });
      if (foundUser) {
        team.manager = foundUser._id;
        await team.save();
      }
    }

    const updatedTeam = await Team.findById(id);

    res.json({
      success: true,
      message: isVerifiedBool
        ? `Team "${team.name}" and manager account successfully verified! The manager can now login directly without OTP.`
        : `Team "${team.name}" status updated to "${status}".`,
      data: {
        team: updatedTeam,
        isVerified: isVerifiedBool,
        usersUpdated: updatedUsers.modifiedCount
      }
    });
  } catch (err) {
    console.error('[Admin Verify Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/teams/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Verified', 'Pending Verification', 'Suspended'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status is required (Verified, Pending Verification, Suspended)' });
    }

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    team.status = status;
    await team.save();

    const isVerifiedBool = status === 'Verified';

    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }

    await User.updateMany(
      { $or: userQueries },
      {
        $set: {
          isVerified: isVerifiedBool,
          verificationOtp: null,
          otpExpiresAt: null,
          team: team._id
        }
      }
    );

    res.json({
      success: true,
      message: `Team "${team.name}" status updated to "${status}".`,
      data: {
        team,
        isVerified: isVerifiedBool
      }
    });
  } catch (err) {
    console.error('[Admin Update Team Status Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const { upload } = require('../services/cloudinary');
const { broadcastMatchUpdate } = require('../services/socketService');

// 1. Get all teams
router.get('/', async (req, res) => {
  try {
    const teams = await Team.find().populate('squad').sort({ 'stats.points': -1, 'stats.goalDifference': -1 });
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get single team with squad
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('squad');
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    // Also get upcoming and recent fixtures for this team
    const fixtures = await Fixture.find({
      $or: [{ homeTeam: team._id }, { awayTeam: team._id }]
    }).populate('homeTeam awayTeam').sort({ date: 1, time: 1 });

    res.json({ success: true, data: { team, fixtures } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Register / Create a Team (with optional crest upload)
router.post('/', upload.single('crest'), async (req, res) => {
  try {
    const { name, shortCode, homeGround, managerName, managerEmail, managerPhone, userId } = req.body;

    if (!name || !shortCode) {
      return res.status(400).json({ success: false, error: 'Team name and short code are required' });
    }

    const existingTeam = await Team.findOne({
      $or: [{ name: name.trim() }, { shortCode: shortCode.trim().toUpperCase() }]
    });

    if (existingTeam) {
      return res.status(400).json({ success: false, error: 'A team with this name or short code already exists' });
    }

    const logo = req.file ? req.file.path : (req.body.logo || '');

    const team = new Team({
      name: name.trim(),
      shortCode: shortCode.trim().toUpperCase(),
      homeGround: homeGround || 'Legacy Pitch Arena A',
      manager: userId || null,
      managerName: managerName || '',
      managerEmail: managerEmail || '',
      managerPhone: managerPhone || '',
      verificationStatus: 'pending',
      status: 'Pending Verification',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: '',
      logo
    });

    await team.save();

    // Link team to manager user if provided
    if (userId) {
      await User.findByIdAndUpdate(userId, { team: team._id });
    }

    res.status(201).json({ success: true, message: 'Team registered successfully', data: team });
  } catch (err) {
    console.error('[Create Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Add Player to Team Squad (with optional Cloudinary photo)
router.post('/:id/players', upload.single('photo'), async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
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

    const { firstName, lastName, jerseyNumber, position, subPosition, preferredFoot, age, dateOfBirth } = req.body;

    if (!firstName || !lastName || !jerseyNumber || !position) {
      return res.status(400).json({ success: false, error: 'First name, last name, jersey number, and position are required' });
    }

    // Check duplicate jersey number in same team
    const duplicateJersey = await Player.findOne({ team: team._id, jerseyNumber: Number(jerseyNumber) });
    if (duplicateJersey) {
      return res.status(400).json({ success: false, error: `Jersey #${jerseyNumber} is already assigned to ${duplicateJersey.firstName} ${duplicateJersey.lastName}` });
    }

    const photo = req.file ? req.file.path : (req.body.photo || '');

    const player = new Player({
      team: team._id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jerseyNumber: Number(jerseyNumber),
      position,
      subPosition: subPosition || '',
      photo,
      preferredFoot: preferredFoot || 'Right',
      age: Number(age) || 17,
      dateOfBirth: dateOfBirth || ''
    });

    await player.save();

    res.status(201).json({ success: true, message: 'Player added to squad', data: player });
  } catch (err) {
    console.error('[Add Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Submit & Lock-in Matchday Lineup
router.post('/lineup/:fixtureId', async (req, res) => {
  try {
    const { fixtureId } = req.params;
    const { teamId, formation, startingXI, bench } = req.body;

    if (!teamId || !startingXI || startingXI.length !== 11) {
      return res.status(400).json({ success: false, error: 'Starting XI must contain exactly 11 players' });
    }

    const fixture = await Fixture.findById(fixtureId);
    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Fixture not found' });
    }

    const isHome = fixture.homeTeam.toString() === teamId.toString();
    const isAway = fixture.awayTeam.toString() === teamId.toString();

    if (!isHome && !isAway) {
      return res.status(400).json({ success: false, error: 'This team is not playing in this fixture' });
    }

    const lineupPayload = {
      formation: formation || '4-3-3',
      startingXI: startingXI.map(slot => ({
        player: slot.player || slot.playerId,
        position: slot.position,
        gridX: slot.gridX || 50,
        gridY: slot.gridY || 50,
        isCaptain: !!slot.isCaptain
      })),
      bench: (bench || []).map(b => ({
        player: b.player || b.playerId,
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
      message: 'Matchday Starting XI submitted and locked!',
      data: populated
    });
  } catch (err) {
    console.error('[Submit Lineup Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. One-tap Follow / Unfollow Team
router.post('/:id/follow', async (req, res) => {
  try {
    const { follow = true } = req.body;
    const increment = follow ? 1 : -1;
    const team = await Team.findByIdAndUpdate(
      req.params.id,
      { $inc: { followersCount: increment } },
      { new: true }
    );
    res.json({ success: true, followersCount: Math.max(0, team.followersCount) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

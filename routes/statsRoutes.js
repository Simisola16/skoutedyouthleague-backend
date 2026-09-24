const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');

// 1. Live Standings / Table
router.get('/standings', async (req, res) => {
  try {
    const teams = await Team.find()
      .select('name shortCode logo stats followersCount')
      .sort({ 'stats.points': -1, 'stats.goalDifference': -1, 'stats.goalsFor': -1 });
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Tournament Leaders: Golden Boot (Top Scorers), Playmaker (Top Assists), Clean Sheets
router.get('/leaders', async (req, res) => {
  try {
    // Top Scorers
    const topScorers = await Player.find({ 'stats.goals': { $gt: 0 } })
      .populate('team', 'name shortCode logo')
      .sort({ 'stats.goals': -1, 'stats.assists': -1 })
      .limit(10);

    // Top Assists (Playmakers)
    const topAssists = await Player.find({ 'stats.assists': { $gt: 0 } })
      .populate('team', 'name shortCode logo')
      .sort({ 'stats.assists': -1, 'stats.goals': -1 })
      .limit(10);

    // Clean Sheets (Goalkeepers)
    const topKeepers = await Player.find({ position: 'GK' })
      .populate('team', 'name shortCode logo')
      .sort({ 'stats.cleanSheets': -1, 'stats.matches': -1 })
      .limit(10);

    // Tournament Summary
    const totalGoals = await Player.aggregate([
      { $group: { _id: null, total: { $sum: '$stats.goals' } } }
    ]);

    const totalMatches = await Fixture.countDocuments({ status: 'FT' });

    res.json({
      success: true,
      data: {
        topScorers,
        topAssists,
        topKeepers,
        totalGoals: totalGoals[0]?.total || 0,
        totalMatches
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

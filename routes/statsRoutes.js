const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const { getLeadersPayload, recalculateAllPlayerStats } = require('../services/statsService');
const { requireAdmin } = require('../middleware/authMiddleware');

// 1. Live Standings / Table
router.get('/standings', async (req, res) => {
  try {
    const teams = await Team.find({ isDeleted: { $ne: true } })
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
    const limit = parseInt(req.query.limit || '50', 10);
    const data = await getLeadersPayload(limit);

    res.json({
      success: true,
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Force Recalculate All Player Stats (Admin)
router.post('/recalculate', requireAdmin, async (req, res) => {
  try {
    const result = await recalculateAllPlayerStats();
    res.json({
      success: true,
      message: `Player statistics recalculated (${result.updatedPlayers} players updated) and broadcasted.`,
      data: result.leaders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

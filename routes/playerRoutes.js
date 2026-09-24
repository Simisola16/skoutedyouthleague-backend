const express = require('express');
const router = express.Router();
const Player = require('../models/Player');

// 1. Get all players (with optional position, team, search filters)
router.get('/', async (req, res) => {
  try {
    const { position, team, search } = req.query;
    const filter = {};

    if (position) filter.position = position;
    if (team) filter.team = team;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }

    const players = await Player.find(filter)
      .populate('team', 'name shortCode logo')
      .sort({ 'stats.goals': -1, 'stats.matches': -1 });

    res.json({ success: true, data: players });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get single player details
router.get('/:id', async (req, res) => {
  try {
    const player = await Player.findById(req.params.id).populate('team');
    if (!player) return res.status(404).json({ success: false, error: 'Player not found' });
    res.json({ success: true, data: player });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

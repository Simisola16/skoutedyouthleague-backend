const express = require('express');
const router = express.Router();
const LeagueSettings = require('../models/LeagueSettings');

// GET /api/league/settings - Public & client competition settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await LeagueSettings.getSettings();
    res.json({
      success: true,
      data: {
        competitionName: settings.competitionName,
        maxSquadSize: settings.maxSquadSize || 35,
        transferWindowStatus: settings.transferWindowStatus || 'closed',
        registrationLocked: settings.registrationLocked || false,
        seasonPhase: settings.seasonPhase || 'pre_season',
        initialRegistrationClosesAt: settings.initialRegistrationClosesAt,
        transferWindowClosesAt: settings.transferWindowClosesAt,
        transferWindowOpenedAt: settings.transferWindowOpenedAt,
        isRegistrationOpen: settings.checkRegistrationEligibility().allowed
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

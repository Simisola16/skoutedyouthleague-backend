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
        isRegistrationOpen: settings.checkRegistrationEligibility().allowed,
        aboutImageUrl: settings.aboutImageUrl || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80',
        aboutImageCaption: settings.aboutImageCaption || 'Youth talent competing in the Skouted Youth League Championship'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const FanSubscription = require('../models/FanSubscription');
const Team = require('../models/Team');

// 1. Subscribe fan to team or all-tournament goal alerts
router.post('/subscribe', async (req, res) => {
  try {
    const { email, teamId, notifyGoals = true, notifyKickoff = true } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    if (!teamId || teamId === 'ALL') {
      const subscription = await FanSubscription.findOneAndUpdate(
        { email: cleanEmail, allMatches: true },
        { notifyGoals, notifyKickoff, notifyFT: true, allMatches: true, team: null },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.json({
        success: true,
        message: 'Subscribed! You will receive instant goal alerts for all championship matches.',
        data: subscription
      });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const subscription = await FanSubscription.findOneAndUpdate(
      { email: cleanEmail, team: teamId },
      { notifyGoals, notifyKickoff, notifyFT: true, allMatches: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: `Subscribed! You will receive instant goal alerts whenever ${team.name} plays or scores.`,
      data: subscription
    });
  } catch (err) {
    console.error('[Fan Subscribe Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get subscriptions for an email
router.get('/my-subscriptions', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const subs = await FanSubscription.find({ email: email.toLowerCase().trim() }).populate('team');
    res.json({ success: true, data: subs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Unsubscribe
router.delete('/:id', async (req, res) => {
  try {
    await FanSubscription.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

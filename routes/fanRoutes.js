const express = require('express');
const router = express.Router();
const FanSubscription = require('../models/FanSubscription');
const Team = require('../models/Team');

// 1. Subscribe fan to team goal alerts
router.post('/subscribe', async (req, res) => {
  try {
    const { email, teamId, notifyGoals = true, notifyKickoff = true } = req.body;

    if (!email || !teamId) {
      return res.status(400).json({ success: false, error: 'Email and team selection are required' });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const subscription = await FanSubscription.findOneAndUpdate(
      { email: email.toLowerCase().trim(), team: teamId },
      { notifyGoals, notifyKickoff, notifyFT: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: `Subscribed! You will receive instant goal alerts whenever ${team.name} scores.`,
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

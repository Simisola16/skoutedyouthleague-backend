const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const pushService = require('../services/pushNotificationService');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPVZF8chhf-_Ew3GxAF72uCUi4LU7-aEcYm0Ye1oBLmOYe6sUeBDDBWI-3_1BjeoM_zjI8TRfJOSWEnVcReXkvw';

// 1. Get VAPID Public Key
router.get('/vapid-public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: VAPID_PUBLIC_KEY
  });
});

// 2. Subscribe Device for Push Notifications
router.post('/subscribe', async (req, res) => {
  try {
    const {
      subscription,
      teamId,
      allMatches = true,
      notifyKickoff = true,
      notifyGoals = true,
      notifySubs = true,
      notifyCards = true,
      notifyFullTime = true
    } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ success: false, error: 'Invalid subscription payload' });
    }

    const subDoc = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        },
        team: teamId && teamId !== 'ALL' ? teamId : null,
        allMatches: !teamId || teamId === 'ALL' || Boolean(allMatches),
        notifyKickoff: Boolean(notifyKickoff),
        notifyGoals: Boolean(notifyGoals),
        notifySubs: Boolean(notifySubs),
        notifyCards: Boolean(notifyCards),
        notifyFullTime: Boolean(notifyFullTime),
        userAgent: req.headers['user-agent'] || ''
      },
      { upsert: true, new: true }
    );

    console.log(`[PushRoute] New subscriber registered: ${subDoc._id}`);

    // Immediately trigger a welcome test notification to verify delivery
    pushService.sendDirectTest(subscription).catch(err => {
      console.warn('[PushRoute] Initial welcome test failed:', err.message);
    });

    res.json({
      success: true,
      message: 'Subscribed to live match push alerts!',
      data: { id: subDoc._id }
    });
  } catch (err) {
    console.error('[PushRoute] Subscribe error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Unsubscribe Device
router.post('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ success: false, error: 'Endpoint required' });

    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('[PushRoute] Unsubscribe error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Send Test Notification to All Subscribers (Admin / Testing)
router.post('/test', async (req, res) => {
  try {
    const { title, body } = req.body;
    const result = await pushService.sendToSubscribers({
      title: title || '🔔 Skouted Youth League Live Alert',
      body: body || 'This is a test notification from the match controller.',
      url: 'https://skoutedyouthleague.com/#fixtures'
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Total Active Subscribers Stats
router.get('/stats', async (req, res) => {
  try {
    const count = await PushSubscription.countDocuments();
    res.json({ success: true, totalSubscribers: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

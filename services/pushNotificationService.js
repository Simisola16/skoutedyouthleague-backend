const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPVZF8chhf-_Ew3GxAF72uCUi4LU7-aEcYm0Ye1oBLmOYe6sUeBDDBWI-3_1BjeoM_zjI8TRfJOSWEnVcReXkvw';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'tg2KE5cRFW0fodcufv1oXImecJ9pFgPcUMYJpKAGffI';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:tournaments@skoutedyouthleague.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[WebPush] VAPID details initialized successfully.');
  } catch (err) {
    console.error('[WebPush] Error setting VAPID details:', err.message);
  }
}

class PushNotificationService {
  /**
   * Broadcast push payload to matched subscribers in DB
   */
  async sendToSubscribers(payload, filter = {}) {
    try {
      const subs = await PushSubscription.find(filter).lean();
      if (!subs.length) {
        console.log('[WebPush] No subscribers found for filter:', filter);
        return { sent: 0, failed: 0 };
      }

      console.log(`[WebPush] Dispatching notification to ${subs.length} device(s)...`);

      const jsonPayload = JSON.stringify({
        title: payload.title || 'Skouted Youth League',
        body: payload.body || 'Live match alert',
        icon: payload.icon || '/icon-192.png',
        badge: payload.badge || '/icon-192.png',
        tag: payload.tag || 'syl-match-alert',
        vibrate: [200, 100, 200, 100, 200],
        timestamp: Date.now(),
        data: {
          url: payload.url || 'https://skoutedyouthleague.com/#fixtures',
          ...payload.data
        }
      });

      const promises = subs.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth
          }
        };

        try {
          await webpush.sendNotification(pushSubscription, jsonPayload);
          return { success: true };
        } catch (err) {
          // If status is 410 (Gone) or 404 (Not Found), subscriber uninstalled or subscription expired
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`[WebPush] Removing expired subscription: ${sub._id}`);
            await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          } else {
            console.warn(`[WebPush] Push failed for ${sub._id}:`, err.message);
          }
          return { success: false, error: err.message };
        }
      });

      const results = await Promise.allSettled(promises);
      const sent = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = subs.length - sent;

      console.log(`[WebPush] Completed dispatch: ${sent} sent, ${failed} failed.`);
      return { sent, failed };
    } catch (err) {
      console.error('[WebPush] Broadcast error:', err);
      return { sent: 0, failed: 0, error: err.message };
    }
  }

  /**
   * 1. Kickoff Notification
   */
  async notifyKickoff(fixture) {
    if (!fixture) return;
    const home = fixture.homeTeam?.name || 'Home';
    const away = fixture.awayTeam?.name || 'Away';
    const stage = fixture.stage || `Week ${fixture.matchday || 1}`;

    const homeId = fixture.homeTeam?._id;
    const awayId = fixture.awayTeam?._id;

    const filter = {
      notifyKickoff: true,
      $or: [
        { allMatches: true },
        ...(homeId ? [{ team: homeId }] : []),
        ...(awayId ? [{ team: awayId }] : [])
      ]
    };

    return this.sendToSubscribers({
      title: `⚽ KICKOFF | ${fixture.homeTeam?.shortCode || home} vs ${fixture.awayTeam?.shortCode || away}`,
      body: `Match is underway in ${stage}! Watch live score updates from Lekan Salami Stadium.`,
      tag: `kickoff-${fixture._id}`,
      url: `https://skoutedyouthleague.com/#fixtures`
    }, filter);
  }

  /**
   * 2. Goal Notification
   */
  async notifyGoal(fixture, { scoringTeam, player, minute }) {
    if (!fixture) return;
    const teamName = scoringTeam?.name || 'Team';
    const playerName = player?.name || (player?.firstName ? `${player.firstName} ${player.lastName}` : teamName);
    const minText = minute ? `${minute}'` : 'Live';

    const hCode = fixture.homeTeam?.shortCode || fixture.homeTeam?.name || 'Home';
    const aCode = fixture.awayTeam?.shortCode || fixture.awayTeam?.name || 'Away';
    const hScore = fixture.homeScore !== undefined ? fixture.homeScore : 0;
    const aScore = fixture.awayScore !== undefined ? fixture.awayScore : 0;

    const homeId = fixture.homeTeam?._id;
    const awayId = fixture.awayTeam?._id;

    const filter = {
      notifyGoals: true,
      $or: [
        { allMatches: true },
        ...(homeId ? [{ team: homeId }] : []),
        ...(awayId ? [{ team: awayId }] : [])
      ]
    };

    return this.sendToSubscribers({
      title: `⚽ GOAL! ${teamName} (${minText})`,
      body: `⚡ ${playerName} scores! Current score: ${hCode} ${hScore} - ${aScore} ${aCode}`,
      tag: `goal-${fixture._id}-${minute}`,
      url: `https://skoutedyouthleague.com/#fixtures`
    }, filter);
  }

  /**
   * 3. Substitution Notification
   */
  async notifySub(fixture, { team, playerIn, playerOut, minute }) {
    if (!fixture) return;
    const teamName = team?.name || team?.shortCode || 'Club';
    const inName = playerIn?.name || (playerIn?.firstName ? `${playerIn.firstName} ${playerIn.lastName}` : 'Substitute');
    const outName = playerOut?.name || (playerOut?.firstName ? `${playerOut.firstName} ${playerOut.lastName}` : 'Player');
    const minText = minute ? `${minute}'` : 'Live';

    const homeId = fixture.homeTeam?._id;
    const awayId = fixture.awayTeam?._id;

    const filter = {
      notifySubs: true,
      $or: [
        { allMatches: true },
        ...(homeId ? [{ team: homeId }] : []),
        ...(awayId ? [{ team: awayId }] : [])
      ]
    };

    return this.sendToSubscribers({
      title: `🔄 SUB | ${teamName} (${minText})`,
      body: `🟢 ON: ${inName} ⇄ 🔴 OFF: ${outName}`,
      tag: `sub-${fixture._id}-${minute}`,
      url: `https://skoutedyouthleague.com/#fixtures`
    }, filter);
  }

  /**
   * 4. Cards Notification (Yellow / Red)
   */
  async notifyCard(fixture, { team, player, cardType, minute }) {
    if (!fixture) return;
    const isRed = cardType === 'RED_CARD' || cardType === 'RED';
    const teamName = team?.name || team?.shortCode || 'Club';
    const playerName = player?.name || (player?.firstName ? `${player.firstName} ${player.lastName}` : 'Player');
    const minText = minute ? `${minute}'` : 'Live';

    const homeId = fixture.homeTeam?._id;
    const awayId = fixture.awayTeam?._id;

    const filter = {
      notifyCards: true,
      $or: [
        { allMatches: true },
        ...(homeId ? [{ team: homeId }] : []),
        ...(awayId ? [{ team: awayId }] : [])
      ]
    };

    return this.sendToSubscribers({
      title: `${isRed ? '🟥 RED CARD' : '🟨 YELLOW CARD'} | ${teamName} (${minText})`,
      body: `${playerName} has been issued a ${isRed ? 'red card' : 'yellow card'}.`,
      tag: `card-${fixture._id}-${minute}`,
      url: `https://skoutedyouthleague.com/#fixtures`
    }, filter);
  }

  /**
   * 5. Full-Time Notification
   */
  async notifyFullTime(fixture) {
    if (!fixture) return;
    const hCode = fixture.homeTeam?.shortCode || fixture.homeTeam?.name || 'Home';
    const aCode = fixture.awayTeam?.shortCode || fixture.awayTeam?.name || 'Away';
    const hScore = fixture.homeScore !== undefined ? fixture.homeScore : 0;
    const aScore = fixture.awayScore !== undefined ? fixture.awayScore : 0;

    const homeId = fixture.homeTeam?._id;
    const awayId = fixture.awayTeam?._id;

    const filter = {
      notifyFullTime: true,
      $or: [
        { allMatches: true },
        ...(homeId ? [{ team: homeId }] : []),
        ...(awayId ? [{ team: awayId }] : [])
      ]
    };

    return this.sendToSubscribers({
      title: `🏁 FULL-TIME | ${hCode} ${hScore} - ${aScore} ${aCode}`,
      body: `Final whistle blown at Lekan Salami Stadium. Check full stats & updated standings.`,
      tag: `ft-${fixture._id}`,
      url: `https://skoutedyouthleague.com/#standings`
    }, filter);
  }

  /**
   * Instant Test Notification for Device
   */
  async sendDirectTest(subscription) {
    if (!subscription || !subscription.endpoint) throw new Error('Invalid subscription');
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    };

    const payload = JSON.stringify({
      title: '🔔 Skouted Youth League Active!',
      body: 'Live match push alerts are connected! You will receive instant notifications for kickoffs, goals, and substitutions.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'syl-test',
      vibrate: [200, 100, 200],
      data: {
        url: 'https://skoutedyouthleague.com/#fixtures'
      }
    });

    return webpush.sendNotification(pushSubscription, payload);
  }
}

module.exports = new PushNotificationService();

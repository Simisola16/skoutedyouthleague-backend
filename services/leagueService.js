const LeagueSettings = require('../models/LeagueSettings');
const Fixture = require('../models/Fixture');
const Team = require('../models/Team');
const Player = require('../models/Player');
const User = require('../models/User');
const EmailService = require('./emailService');
const { broadcastLeagueSettingsUpdate } = require('./socketService');

/**
 * Service to handle automated league state transitions, roster limits,
 * and the mid-season transfer window engine.
 */
class LeagueService {
  /**
   * Evaluates if Leg 1 (Matchdays 1 to 11) is 100% completed.
   * If all Leg 1 fixtures have concluded at Full Time ('FT') and the window
   * hasn't yet been automatically triggered, unlocks the transfer window
   * and dispatches email announcements to all 12 verified club managers.
   */
  static async checkLeg1CompletionAndTriggerTransferWindow() {
    try {
      const settings = await LeagueSettings.getSettings();

      // If already opened or auto-triggered, skip re-evaluating
      if (settings.autoTransferWindowTriggered && settings.transferWindowStatus === 'open') {
        return { triggered: false, reason: 'Transfer window already active' };
      }

      // Query all fixtures designated for Leg 1 (matchdays 1-11 or leg === 1)
      const leg1Fixtures = await Fixture.find({
        $or: [
          { leg: 1 },
          { matchday: { $lte: 11 } }
        ]
      });

      if (!leg1Fixtures || leg1Fixtures.length === 0) {
        return { triggered: false, reason: 'No Leg 1 fixtures found' };
      }

      // Check if all Leg 1 fixtures have status 'FT'
      const allFinished = leg1Fixtures.every(f => f.status === 'FT');

      if (allFinished) {
        console.log('[LeagueService]: 🏆 All Leg 1 fixtures have concluded! Triggering Mid-Season Transfer Window...');

        // Update settings
        settings.transferWindowStatus = 'open';
        settings.registrationLocked = false;
        settings.seasonPhase = 'mid_season_break';
        settings.autoTransferWindowTriggered = true;
        settings.transferWindowOpenedAt = new Date();

        // Default window closing date: 14 days from now if not explicitly set
        if (!settings.transferWindowClosesAt || new Date(settings.transferWindowClosesAt) < new Date()) {
          settings.transferWindowClosesAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        }

        await settings.save();

        // Broadcast realtime update to connected managers & admin consoles
        broadcastLeagueSettingsUpdate(settings);

        // Dispatch Resend broadcast emails to all verified team managers
        const emailResults = await this.broadcastTransferWindowAnnouncement(settings);

        return {
          triggered: true,
          message: 'Mid-Season Transfer Window opened and notifications dispatched.',
          settings,
          emailResults
        };
      }

      return {
        triggered: false,
        reason: `${leg1Fixtures.filter(f => f.status === 'FT').length}/${leg1Fixtures.length} Leg 1 matches completed.`
      };
    } catch (err) {
      console.error('[LeagueService Error - Leg 1 Check]:', err);
      return { triggered: false, error: err.message };
    }
  }

  /**
   * Broadcasts the transfer window opening announcement to all approved club managers
   */
  static async broadcastTransferWindowAnnouncement(settings) {
    try {
      const teams = await Team.find({
        $or: [
          { verificationStatus: 'approved' },
          { status: 'Verified' }
        ]
      });

      console.log(`[LeagueService]: Dispatching transfer window announcement to ${teams.length} clubs...`);

      const dispatchPromises = teams.map(async (team) => {
        let recipientEmail = team.managerEmail;
        let recipientName = team.managerName;

        // Fallback to linked User record if managerEmail is blank on Team
        if (!recipientEmail) {
          const managerUser = await User.findOne({
            $or: [
              { _id: team.manager },
              { team: team._id }
            ]
          });
          if (managerUser) {
            recipientEmail = managerUser.email;
            recipientName = recipientName || managerUser.name;
          }
        }

        if (!recipientEmail) {
          return { team: team.name, success: false, error: 'No recipient email found' };
        }

        // Count current registered squad members
        const currentCount = await Player.countDocuments({ team: team._id });

        return await EmailService.sendTransferWindowOpenEmail({
          managerEmail: recipientEmail,
          managerName: recipientName,
          teamName: team.name,
          squadCount: currentCount,
          maxSquadSize: settings.maxSquadSize || 35,
          closingDate: settings.transferWindowClosesAt
        });
      });

      const results = await Promise.allSettled(dispatchPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

      console.log(`[LeagueService]: Transfer window emails sent: ${successful}/${teams.length}`);
      return { count: successful, total: teams.length };
    } catch (err) {
      console.error('[LeagueService Error - Broadcast Notice]:', err);
      return { error: err.message };
    }
  }
}

module.exports = LeagueService;

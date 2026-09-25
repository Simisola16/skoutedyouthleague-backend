const cron = require('node-cron');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const EmailService = require('./emailService');

function startScheduler() {
  console.log('[Scheduler]: Starting 3-Hour Lineup Warning Cron Job (running every 5 minutes)...');

  // Check every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      
      // Look for upcoming matches in the next 180-210 minutes (3 hours to 3.5 hours away)
      const fixtures = await Fixture.find({
        status: 'UPCOMING',
        lineupWarningSent: { $ne: true }
      }).populate('homeTeam awayTeam');

      for (const fixture of fixtures) {
        if (!fixture.date || !fixture.time) continue;

        // Parse fixture kickoff datetime
        // fixture.date formatted YYYY-MM-DD, fixture.time formatted HH:mm
        const kickoffStr = `${fixture.date}T${fixture.time}:00`;
        const kickoffTime = new Date(kickoffStr);
        if (isNaN(kickoffTime.getTime())) continue;

        const diffMinutes = Math.round((kickoffTime.getTime() - now.getTime()) / (1000 * 60));

        // If kickoff is between 150 and 210 minutes (approximately 3 hours away)
        if (diffMinutes > 0 && diffMinutes <= 210) {
          console.log(`[Scheduler]: Checking match ${fixture.homeTeam?.name} vs ${fixture.awayTeam?.name} kicking off in ${diffMinutes}m`);

          let reminderSent = false;

          // Check Home Team Lineup (with User email fallback)
          let homeMgrEmail = fixture.homeTeam?.managerEmail;
          if (!homeMgrEmail && fixture.homeTeam?._id) {
            const u = await User.findOne({ team: fixture.homeTeam._id });
            if (u) homeMgrEmail = u.email;
          }

          if (!fixture.homeLineup?.isLocked && homeMgrEmail) {
            await EmailService.sendLineupReminderEmail({
              managerEmail: homeMgrEmail,
              managerName: fixture.homeTeam.managerName,
              teamName: fixture.homeTeam.name,
              opponentName: fixture.awayTeam?.name || 'Opponent',
              kickoffTime: `${fixture.time} on ${fixture.date}`,
              fixtureId: fixture._id
            });
            reminderSent = true;
          }

          // Check Away Team Lineup (with User email fallback)
          let awayMgrEmail = fixture.awayTeam?.managerEmail;
          if (!awayMgrEmail && fixture.awayTeam?._id) {
            const u = await User.findOne({ team: fixture.awayTeam._id });
            if (u) awayMgrEmail = u.email;
          }

          if (!fixture.awayLineup?.isLocked && awayMgrEmail) {
            await EmailService.sendLineupReminderEmail({
              managerEmail: awayMgrEmail,
              managerName: fixture.awayTeam.managerName,
              teamName: fixture.awayTeam.name,
              opponentName: fixture.homeTeam?.name || 'Opponent',
              kickoffTime: `${fixture.time} on ${fixture.date}`,
              fixtureId: fixture._id
            });
            reminderSent = true;
          }

          if (reminderSent) {
            fixture.lineupWarningSent = true;
            await fixture.save();
            console.log(`[Scheduler]: Marked lineupWarningSent=true for fixture ${fixture._id}`);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler Error]:', err.message);
    }
  });
}

module.exports = { startScheduler };

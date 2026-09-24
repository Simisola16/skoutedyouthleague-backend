const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY || '';
const emailFrom = process.env.EMAIL_FROM || 'Skouted League <tournaments@thevillagecoders.com>';

const resend = new Resend(apiKey);

// Athletic Dark Theme Base Template Helper
function wrapEmailHtml({ title, preheader, content, badgeText = 'SKOUTED LEAGUE' }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0D0F14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #E2E8F0; }
    .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
    .card { background-color: #161922; border: 1px solid #232733; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #1A1D28 0%, #0F1219 100%); padding: 24px; border-bottom: 1px solid #232733; text-align: center; }
    .logo-badge { display: inline-block; background-color: rgba(0, 230, 118, 0.12); border: 1px solid #00E676; color: #00E676; font-size: 11px; font-weight: 800; letter-spacing: 2px; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 12px; }
    .content { padding: 28px 24px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #00E676 0%, #00B359 100%); color: #07120B !important; font-weight: 800; font-size: 14px; text-decoration: none; padding: 12px 28px; border-radius: 10px; margin: 18px 0; text-transform: uppercase; letter-spacing: 0.5px; }
    .footer { text-align: center; padding: 20px; font-size: 11px; color: #64748B; border-top: 1px solid #1E222D; }
    .highlight-box { background-color: #1F2430; border-radius: 12px; padding: 18px; margin: 16px 0; border-left: 4px solid #00E676; }
    .goal-box { background-color: #1F2430; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 4px solid #FF4B4B; text-align: center; }
    .score-badge { font-size: 28px; font-weight: 900; color: #FFFFFF; letter-spacing: 2px; margin: 10px 0; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${preheader || title}
  </div>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo-badge">${badgeText}</div>
        <h1 style="margin:0; font-size:22px; font-weight:900; color:#FFFFFF; letter-spacing:-0.5px;">SKOUTED LEAGUE</h1>
        <p style="margin:4px 0 0 0; font-size:12px; color:#94A3B8;">Premier Youth Football Championship & Social Scouting</p>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p style="margin:0 0 6px 0;">Official Skouted League Tournament Notification System</p>
        <p style="margin:0;">&copy; ${new Date().getFullYear()} Skouted League. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

class EmailService {
  // 1. Send OTP Verification Code
  static async sendOtpEmail({ email, name, otp }) {
    try {
      const subject = `🔐 Your Skouted League Verification Code: ${otp}`;
      const content = `
        <h2 style="color:#FFFFFF; font-size:18px; margin-top:0;">Verify Your Manager Account</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${name || 'Team Manager'}</strong>,<br>
          Welcome to Skouted League. Please use the 6-digit confirmation code below to verify your club account and unlock match-day lineup submissions.
        </p>
        <div style="text-align:center; margin:24px 0;">
          <div style="display:inline-block; background-color:#1E2433; border:2px dashed #00E676; border-radius:12px; padding:16px 36px;">
            <span style="font-family:monospace; font-size:32px; font-weight:900; letter-spacing:8px; color:#00E676;">${otp}</span>
          </div>
        </div>
        <p style="color:#64748B; font-size:12px; text-align:center;">
          ⏱ This code will expire in <strong>10 minutes</strong>. If you did not request this registration, please disregard this email.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Account Verification Code',
        preheader: `Your verification code is ${otp}. Valid for 10 minutes.`,
        content,
        badgeText: 'SECURITY VERIFICATION'
      });

      const data = await resend.emails.send({
        from: emailFrom,
        to: email,
        subject,
        html
      });
      console.log(`[EmailService]: OTP sent to ${email} (ID: ${data?.data?.id || 'ok'})`);
      return { success: true, id: data?.data?.id };
    } catch (error) {
      console.error('[EmailService Error - OTP]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 2. Fixture Announcement to Team Managers
  static async sendFixtureAnnouncement({ homeManagerEmail, awayManagerEmail, homeTeamName, awayTeamName, date, time, venue, stage }) {
    try {
      const recipients = [homeManagerEmail, awayManagerEmail].filter(Boolean);
      if (recipients.length === 0) return { success: false, error: 'No recipients provided' };

      const subject = `🏆 Fixture Confirmed: ${homeTeamName} vs ${awayTeamName} (${stage})`;
      const content = `
        <h2 style="color:#FFFFFF; font-size:18px; margin-top:0;">Official Match Fixture Scheduled</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Attention Managers: An official tournament match has been scheduled on the Skouted League platform.
        </p>
        <div class="highlight-box">
          <div style="font-size:16px; font-weight:900; color:#FFFFFF; margin-bottom:12px; text-align:center;">
            ${homeTeamName} <span style="color:#00E676;">VS</span> ${awayTeamName}
          </div>
          <table style="width:100%; font-size:13px; color:#CBD5E1; border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0; color:#64748B;">Stage:</td>
              <td style="padding:4px 0; font-weight:700; text-align:right;">${stage}</td>
            </tr>
            <tr>
              <td style="padding:4px 0; color:#64748B;">Date:</td>
              <td style="padding:4px 0; font-weight:700; text-align:right;">${date}</td>
            </tr>
            <tr>
              <td style="padding:4px 0; color:#64748B;">Kick-off:</td>
              <td style="padding:4px 0; font-weight:700; text-align:right; color:#00E676;">${time}</td>
            </tr>
            <tr>
              <td style="padding:4px 0; color:#64748B;">Venue:</td>
              <td style="padding:4px 0; font-weight:700; text-align:right;">${venue}</td>
            </tr>
          </table>
        </div>
        <p style="color:#94A3B8; font-size:13px; line-height:1.5;">
          ⚠️ <strong>Lineup Regulation:</strong> Both team managers are required to submit and lock in their official <strong>Starting XI</strong> at least 3 hours prior to kickoff via the Team Portal.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Fixture Scheduled',
        preheader: `${homeTeamName} vs ${awayTeamName} on ${date} at ${time}`,
        content,
        badgeText: 'TOURNAMENT FIXTURE'
      });

      const data = await resend.emails.send({
        from: emailFrom,
        to: recipients,
        subject,
        html
      });
      console.log(`[EmailService]: Fixture notice sent to ${recipients.join(', ')}`);
      return { success: true, id: data?.data?.id };
    } catch (error) {
      console.error('[EmailService Error - Fixture Announcement]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 3. 3-Hour Lineup Warning Cron Job Reminder
  static async sendLineupReminderEmail({ managerEmail, managerName, teamName, opponentName, kickoffTime, fixtureId }) {
    try {
      if (!managerEmail) return { success: false, error: 'No manager email' };

      const subject = `⚡ URGENT: 3 Hours to Kickoff - Submit Starting XI for ${teamName} vs ${opponentName}`;
      const content = `
        <h2 style="color:#FF4B4B; font-size:18px; margin-top:0;">⚠️ Mandatory Starting XI Required</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${managerName || 'Coach'}</strong>,<br>
          Your match against <strong style="color:#FFFFFF;">${opponentName}</strong> kicks off in approximately <strong>3 hours</strong> (scheduled for <span style="color:#00E676;">${kickoffTime}</span>).
        </p>
        <div class="highlight-box" style="border-left-color: #FFB800;">
          <p style="margin:0; font-size:13px; color:#F1F5F9;">
            Tournament match officials require the verified 11 starting players and substitutes on record before the team arrives on pitch.
          </p>
        </div>
        <div style="text-align:center; margin:24px 0;">
          <a href="http://localhost:5055/" class="btn" style="background:#00E676; color:#0A0D14 !important;">
            Lock In Starting XI Now →
          </a>
        </div>
        <p style="color:#64748B; font-size:12px; text-align:center;">
          Failure to upload your lineup may delay kickoff and incur competition disciplinary penalties.
        </p>
      `;

      const html = wrapEmailHtml({
        title: '3-Hour Lineup Warning',
        preheader: `Kickoff in 3 hours! Submit Starting XI for ${teamName}.`,
        content,
        badgeText: 'MATCHDAY WARNING'
      });

      const data = await resend.emails.send({
        from: emailFrom,
        to: managerEmail,
        subject,
        html
      });
      console.log(`[EmailService]: 3-hour lineup warning sent to ${managerEmail}`);
      return { success: true, id: data?.data?.id };
    } catch (error) {
      console.error('[EmailService Error - 3H Warning]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 4. Real-time Fan Goal Alert
  static async sendFanGoalAlert({ fanEmails, scoringTeamName, opponentTeamName, playerName, minute, homeScore, awayScore, isHomeScoring }) {
    try {
      if (!fanEmails || fanEmails.length === 0) return { success: true, note: 'No fan subscribers' };

      const subject = `⚽ GOAL! ${playerName} ${minute}' - ${scoringTeamName} [${homeScore}-${awayScore}] ${opponentTeamName}`;
      const content = `
        <div class="goal-box">
          <div style="font-size:32px; margin-bottom:4px;">⚽🔥</div>
          <h2 style="color:#FF4B4B; font-size:24px; font-weight:900; margin:0; letter-spacing:1px;">GOAAAL!</h2>
          <div style="color:#FFFFFF; font-size:18px; font-weight:800; margin-top:6px;">
            ${playerName} <span style="color:#00E676; font-size:14px;">(${minute}')</span>
          </div>
          <div style="color:#94A3B8; font-size:13px; margin-top:2px;">
            scored for <strong style="color:#FFFFFF;">${scoringTeamName}</strong>
          </div>
          <div class="score-badge">
            ${homeScore} - ${awayScore}
          </div>
          <div style="color:#64748B; font-size:12px;">Live in Skouted League Tournament</div>
        </div>
        <div style="text-align:center; margin:20px 0;">
          <a href="http://localhost:5055/" class="btn">
            Open Live Match Center →
          </a>
        </div>
      `;

      const html = wrapEmailHtml({
        title: `Goal Alert: ${scoringTeamName}`,
        preheader: `GOAL! ${playerName} scores in the ${minute}'! Score: ${homeScore}-${awayScore}`,
        content,
        badgeText: 'LIVE GOAL ALERT'
      });

      // Send to fan recipients (up to batch limit)
      const data = await resend.emails.send({
        from: emailFrom,
        to: fanEmails.slice(0, 50), // batch safe
        subject,
        html
      });
      console.log(`[EmailService]: Fan goal alert sent to ${fanEmails.length} subscriber(s)`);
      return { success: true, id: data?.data?.id };
    } catch (error) {
      console.error('[EmailService Error - Fan Goal Alert]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 6. Password Change Security Notice
  static async sendPasswordChangeNotice({ email, name, teamName }) {
    try {
      const subject = `🔒 Security Notice: Password Changed for ${teamName || 'Your Account'}`;
      const content = `
        <h2 style="color:#FFFFFF; font-size:18px; margin-top:0;">Account Password Updated</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${name || 'Team Manager'}</strong>,<br>
          This is an official security confirmation that the password for your Skouted League club manager account 
          ${teamName ? `(<strong>${teamName}</strong>)` : ''} was successfully updated.
        </p>
        <div style="background-color:#1F2430; border-radius:12px; padding:16px; margin:20px 0; border-left:4px solid #00E676;">
          <p style="margin:0; font-size:13px; color:#E2E8F0;">
            📅 <strong>Timestamp:</strong> ${new Date().toUTCString()}<br>
            🔐 <strong>Action:</strong> Team Manager Credential Reset
          </p>
        </div>
        <p style="color:#64748B; font-size:12px;">
          If you made this change, you can safely ignore this notification. If you did NOT authorize this change, please contact Tournament Administration immediately.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Password Security Notice',
        preheader: 'Your Skouted League account password was successfully updated.',
        content,
        badgeText: 'SECURITY NOTICE'
      });

      const data = await resend.emails.send({
        from: emailFrom,
        to: email,
        subject,
        html
      });
      return { success: true, id: data?.data?.id };
    } catch (error) {
      console.error('[EmailService Error - Password Notice]:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;

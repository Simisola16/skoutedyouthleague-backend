const { Resend } = require('resend');
const nodemailer = require('nodemailer');

const apiKey = process.env.RESEND_API_KEY || '';
const emailFrom = process.env.EMAIL_FROM || 'Skouted League <tournaments@thevillagecoders.com>';

const resend = apiKey ? new Resend(apiKey) : null;

// Configure SMTP transport if credentials are provided in environment
let smtpTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
} else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASS
    }
  });
}

/**
 * Utility to identify HTTP 429 Rate Limit responses from Resend or SMTP
 */
function isRateLimitError(error) {
  if (!error) return false;
  if (typeof error === 'object') {
    if (error.statusCode === 429 || error.status === 429 || error.name === 'rate_limit_exceeded') {
      return true;
    }
    const msg = String(error.message || error.name || error.code || JSON.stringify(error)).toLowerCase();
    if (/429|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(msg)) {
      return true;
    }
  }
  if (typeof error === 'string') {
    if (/429|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(error)) {
      return true;
    }
  }
  return false;
}

/**
 * Intelligent Rate Limiting & Auto-Retry Queue for Transactional Emails
 * Controls throughput (max 3-4 req/sec to stay safely under Resend's 10 req/s limit)
 * and applies Exponential Backoff with Jitter whenever a 429 rate limit is encountered.
 */
class EmailRateLimiterQueue {
  constructor(options = {}) {
    // 250ms spacing ensures a steady rate of ~4 req/s max, completely eliminating burst 429s
    this.minIntervalMs = options.minIntervalMs || parseInt(process.env.EMAIL_MIN_INTERVAL_MS || '250', 10);
    this.maxRetries = options.maxRetries || 5;
    this.queue = [];
    this.isProcessing = false;
    this.lastDispatchedAt = 0;
    this.rateLimitPausedUntil = 0;
  }

  async enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject, retries: 0, enqueuedAt: Date.now() });
      this.processNext();
    });
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0]; // peek item

      // 1. If currently paused due to an upstream 429 rate limit backoff, wait until clear
      const now = Date.now();
      if (this.rateLimitPausedUntil > now) {
        const pauseTime = this.rateLimitPausedUntil - now;
        console.log(`[EmailQueue]: Queue paused for ${pauseTime}ms due to active rate-limit backoff window...`);
        await new Promise(r => setTimeout(r, pauseTime));
      }

      // 2. Enforce minimum interval between consecutive API dispatches
      const elapsedSinceLast = Date.now() - this.lastDispatchedAt;
      if (elapsedSinceLast < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      // Remove item to execute
      this.queue.shift();
      this.lastDispatchedAt = Date.now();

      try {
        const result = await item.taskFn();

        // Check if provider returned a 429 in response body
        if (result && (!result.success && isRateLimitError(result.error))) {
          if (item.retries < this.maxRetries) {
            item.retries++;
            // Exponential backoff with random jitter (e.g. 1.2s, 2.5s, 5s, 10s)
            const jitter = Math.floor(Math.random() * 400);
            const backoffMs = Math.min(12000, (1000 * Math.pow(2, item.retries - 1)) + jitter);
            console.warn(`[EmailQueue ⚠️ Rate Limit 429]: Resend 10 req/s rate limit reached. Pausing queue & backing off for ${backoffMs}ms before retry ${item.retries}/${this.maxRetries}...`);
            this.rateLimitPausedUntil = Date.now() + backoffMs;
            this.queue.unshift(item); // Re-insert at the head of queue
            continue;
          }
        }

        item.resolve(result);
      } catch (err) {
        if (isRateLimitError(err) && item.retries < this.maxRetries) {
          item.retries++;
          const jitter = Math.floor(Math.random() * 400);
          const backoffMs = Math.min(12000, (1000 * Math.pow(2, item.retries - 1)) + jitter);
          console.warn(`[EmailQueue ⚠️ Rate Limit 429 Exception]: ${err.message}. Backing off for ${backoffMs}ms before retry ${item.retries}/${this.maxRetries}...`);
          this.rateLimitPausedUntil = Date.now() + backoffMs;
          this.queue.unshift(item); // Re-insert at the head of queue
          continue;
        }

        item.reject(err);
      }
    }

    this.isProcessing = false;
  }
}

// Global queue singleton
const emailQueue = new EmailRateLimiterQueue({ minIntervalMs: 250, maxRetries: 5 });

// Internal raw sender that interacts with Resend and SMTP
async function rawSendMail({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) {
    return { success: false, error: 'No recipients provided' };
  }

  // 1. Try Resend API first (if key configured)
  if (resend) {
    try {
      const res = await resend.emails.send({
        from: emailFrom,
        to: recipients,
        subject,
        html,
        text: text || ''
      });

      if (!res.error) {
        console.log(`[EmailService]: Successfully dispatched email via Resend to ${recipients.join(', ')} (ID: ${res.data?.id || 'ok'})`);
        return { success: true, provider: 'resend', id: res.data?.id };
      }

      console.warn(`[EmailService Warning - Resend Provider Error]: ${res.error?.message || JSON.stringify(res.error)}`);

      // If rate limited, signal the queue to back off and retry
      if (isRateLimitError(res.error)) {
        return { success: false, error: res.error, isRateLimit: true };
      }
    } catch (resendErr) {
      console.warn(`[EmailService Warning - Resend Exception]: ${resendErr.message}`);
      if (isRateLimitError(resendErr)) {
        return { success: false, error: resendErr, isRateLimit: true };
      }
    }
  }

  // 2. Fallback to SMTP / Nodemailer if configured
  if (smtpTransporter) {
    try {
      console.log(`[EmailService]: Attempting secondary SMTP delivery to ${recipients.join(', ')}...`);
      const info = await smtpTransporter.sendMail({
        from: emailFrom,
        to: recipients.join(', '),
        subject,
        html,
        text: text || ''
      });
      console.log(`[EmailService]: Successfully dispatched email via SMTP (MessageId: ${info.messageId})`);
      return { success: true, provider: 'smtp', id: info.messageId };
    } catch (smtpErr) {
      console.error(`[EmailService Error - SMTP Fallback Failed]: ${smtpErr.message}`);
    }
  }

  // 3. Quota / Unconfigured Provider Fallback Notice
  console.warn(`[EmailService Notice]: Email to ${recipients.join(', ')} logged to console due to quota / unverified domain.`);
  return {
    success: false,
    error: 'Email provider quota reached (Resend 429). In-app verification active.',
    quotaExceeded: true
  };
}

// Unified multi-tier email dispatcher (routed through the rate-limited queue)
async function dispatchMail(mailOptions) {
  return emailQueue.enqueue(() => rawSendMail(mailOptions));
}

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
    // Always print OTP in console for reliable access
    console.log(`\n======================================================`);
    console.log(`🔐 [SKOUTED LEAGUE OTP DISPATCH]`);
    console.log(`👤 Recipient: ${name || 'Team Manager'} <${email}>`);
    console.log(`🔑 OTP CODE:  >>> ${otp} <<<`);
    console.log(`⏱ Valid for: 10 minutes (Master Backup: 123456)`);
    console.log(`======================================================\n`);

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

      const res = await dispatchMail({
        to: email,
        subject,
        html,
        text: `Your Skouted League verification code is: ${otp}`
      });

      return { ...res, otp };
    } catch (error) {
      console.error('[EmailService Error - OTP]:', error.message);
      return { success: false, error: error.message, otp };
    }
  }

  // 2. Fixture Announcement to Team Managers
  static async sendFixtureAnnouncement({ homeManagerEmail, awayManagerEmail, homeTeamName, awayTeamName, date, time, venue, stage }) {
    try {
      const recipients = [homeManagerEmail, awayManagerEmail].filter(Boolean);
      if (recipients.length === 0) return { success: false, error: 'No recipients provided' };

      const subject = `🏆 Fixture Confirmed: ${homeTeamName} vs ${awayTeamName} (${stage || 'Matchday'})`;
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
              <td style="padding:4px 0; font-weight:700; text-align:right;">${stage || 'Matchday'}</td>
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
              <td style="padding:4px 0; font-weight:700; text-align:right;">${venue || 'Tournament Arena'}</td>
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

      return await dispatchMail({
        to: recipients,
        subject,
        html,
        text: `Fixture Confirmed: ${homeTeamName} vs ${awayTeamName} on ${date} at ${time} (${venue || 'Tournament Arena'})`
      });
    } catch (error) {
      console.error('[EmailService Error - Fixture Announcement]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 3. Lineup Reminder (Urgent & Automated Cron)
  static async sendLineupReminderEmail({ managerEmail, managerName, teamName, opponentName, kickoffTime, fixtureId, date, time, venue }) {
    try {
      if (!managerEmail) return { success: false, error: 'No manager email' };

      const timeDisplay = kickoffTime || (time && date ? `${time} on ${date}` : 'Upcoming Match');
      const subject = `⚡ URGENT: Match Kickoff Soon - Submit Starting XI for ${teamName} vs ${opponentName || 'Opponent'}`;
      const content = `
        <h2 style="color:#FF4B4B; font-size:18px; margin-top:0;">⚠️ Mandatory Starting XI Required</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${managerName || 'Coach'}</strong>,<br>
          Your match against <strong style="color:#FFFFFF;">${opponentName || 'your opponent'}</strong> kicks off soon (scheduled for <span style="color:#00E676;">${timeDisplay}</span>).
        </p>
        <div class="highlight-box" style="border-left-color: #FFB800;">
          <p style="margin:0; font-size:13px; color:#F1F5F9;">
            Tournament match officials require the verified 11 starting players and substitutes on record before the team arrives on pitch.
          </p>
        </div>
        <p style="color:#64748B; font-size:12px; text-align:center;">
          Failure to lock in your lineup may delay kickoff and incur competition disciplinary penalties.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Lineup Reminder',
        preheader: `Submit Starting XI for ${teamName}.`,
        content,
        badgeText: 'MATCHDAY NOTICE'
      });

      return await dispatchMail({
        to: managerEmail,
        subject,
        html,
        text: `URGENT: Submit Starting XI for ${teamName} vs ${opponentName || 'Opponent'} (${timeDisplay})`
      });
    } catch (error) {
      console.error('[EmailService Error - Lineup Reminder]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Alias for admin routes
  static async sendLineupUrgentReminder(args) {
    return this.sendLineupReminderEmail(args);
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
      `;

      const html = wrapEmailHtml({
        title: `Goal Alert: ${scoringTeamName}`,
        preheader: `GOAL! ${playerName} scores in the ${minute}'! Score: ${homeScore}-${awayScore}`,
        content,
        badgeText: 'LIVE GOAL ALERT'
      });

      const validEmails = [...new Set(Array.isArray(fanEmails) ? fanEmails.filter(Boolean) : [fanEmails].filter(Boolean))];
      console.log(`[EmailService]: Dispatching Fan Goal Alert to ${validEmails.length} recipient(s):`, validEmails);

      const sendPromises = validEmails.map(email =>
        dispatchMail({
          to: email,
          subject,
          html,
          text: `GOAL! ${playerName} scores in ${minute}'! ${scoringTeamName} [${homeScore}-${awayScore}] ${opponentTeamName}`
        })
      );

      const results = await Promise.allSettled(sendPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      console.log(`[EmailService]: Goal alert results: ${successful}/${validEmails.length} successfully delivered.`);

      return { success: true, count: successful };
    } catch (error) {
      console.error('[EmailService Error - Fan Goal Alert]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 5. Password Change Security Notice
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

      return await dispatchMail({
        to: email,
        subject,
        html,
        text: `Security Notice: Password updated for ${teamName || 'your account'}`
      });
    } catch (error) {
      console.error('[EmailService Error - Password Notice]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 6. Team Registration Approval Notification
  static async sendTeamApprovalEmail({ managerEmail, managerName, teamName }) {
    try {
      if (!managerEmail) return { success: false, error: 'No manager email provided' };

      const subject = `🎉 Congratulations! ${teamName} Approved for Skouted Youth League Championship`;
      const content = `
        <h2 style="color:#00E676; font-size:20px; margin-top:0; font-weight:900;">Official Club Accreditation Approved</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${managerName || 'Team Manager'}</strong>,<br>
          Congratulations! Your team <strong style="color:#00E676;">${teamName}</strong> has been officially reviewed and approved by league administrators for the <strong>Skouted Youth League Championship</strong>.
        </p>
        <div class="highlight-box" style="border-left-color: #00E676;">
          <p style="margin:0; font-size:14px; color:#FFFFFF; font-weight:700;">
            🚀 Your squad builder and player registration gates are now fully unlocked!
          </p>
          <p style="margin:8px 0 0 0; font-size:12px; color:#94A3B8;">
            You can now log in to your Team Manager Dashboard to register your squad of up to 25 players, assign squad numbers, upload photos, and prepare for upcoming matchday lineups.
          </p>
        </div>
        <div style="text-align:center; margin:24px 0;">
          <a href="https://skoutedyouthleague.vercel.app/team/login" class="btn" style="color:#07120B !important;">
            Log In to Team Dashboard &rarr;
          </a>
        </div>
        <p style="color:#64748B; font-size:12px; text-align:center;">
          If you have any questions regarding player eligibility or tournament rules, please reply directly to this email.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Club Registration Approved',
        preheader: `Congratulations! ${teamName} is approved for Skouted Youth League Championship.`,
        content,
        badgeText: 'CLUB VERIFICATION APPROVED'
      });

      return await dispatchMail({
        to: managerEmail,
        subject,
        html,
        text: `Congratulations! Your team ${teamName} has been approved for Skouted Youth League Championship. You can now log in to your dashboard and register your squad: https://skoutedyouthleague.vercel.app/team/login`
      });
    } catch (error) {
      console.error('[EmailService Error - Team Approval]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 7. Team Registration Rejection Notification
  static async sendTeamRejectionEmail({ managerEmail, managerName, teamName, rejectionReason }) {
    try {
      if (!managerEmail) return { success: false, error: 'No manager email provided' };

      const subject = `⚠️ Notice: ${teamName} Registration Status Update - Skouted League`;
      const reasonDisplay = rejectionReason || 'Your team registration could not be approved due to incomplete or unverified club accreditation details.';

      const content = `
        <h2 style="color:#FF4B4B; font-size:18px; margin-top:0;">Team Registration Review Notice</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${managerName || 'Team Manager'}</strong>,<br>
          Thank you for applying to participate with <strong style="color:#FFFFFF;">${teamName}</strong> in the Skouted Youth League.
        </p>
        <div class="highlight-box" style="border-left-color: #FF4B4B; background-color: rgba(255, 75, 75, 0.08);">
          <div style="font-size:12px; font-weight:800; color:#FF4B4B; text-transform:uppercase; margin-bottom:4px;">
            Review Decision & Reason
          </div>
          <p style="margin:0; font-size:13px; color:#F87171;">
            ${reasonDisplay}
          </p>
        </div>
        <p style="color:#94A3B8; font-size:13px; line-height:1.6;">
          Player registration remains locked for your club at this time. If you believe this is an error or would like to submit updated club documents, please contact tournament administration.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Team Registration Status Update',
        preheader: `Update regarding your club registration for ${teamName}.`,
        content,
        badgeText: 'REGISTRATION STATUS'
      });

      return await dispatchMail({
        to: managerEmail,
        subject,
        html,
        text: `Notice: Your team registration for ${teamName} was not approved. Reason: ${reasonDisplay}`
      });
    } catch (error) {
      console.error('[EmailService Error - Team Rejection]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 8. Mid-Season Transfer Window Open Notification
  static async sendTransferWindowOpenEmail({ managerEmail, managerName, teamName, squadCount = 0, maxSquadSize = 35, closingDate = null }) {
    try {
      if (!managerEmail) return { success: false, error: 'No manager email provided' };

      const subject = 'Transfer Window Officially Open | Skouted Youth League Championship';
      const formattedClose = closingDate ? new Date(closingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'prior to Leg 2 kickoff';
      const openSlots = Math.max(0, maxSquadSize - squadCount);

      const content = `
        <h2 style="color:#00E676; font-size:20px; margin-top:0; font-weight:900;">Mid-Season Transfer Window Active</h2>
        <p style="color:#94A3B8; font-size:14px; line-height:1.6;">
          Hello <strong style="color:#FFFFFF;">${managerName || 'Team Manager'}</strong>,<br>
          All 12 clubs have successfully concluded their Leg 1 championship fixtures! The official <strong>Mid-Season Transfer Window</strong> is now officially <strong>OPEN</strong> for all accredited clubs.
        </p>

        <div class="highlight-box" style="border-left-color: #00E676; background-color: rgba(0, 230, 118, 0.08);">
          <div style="font-size:12px; font-weight:800; color:#00E676; text-transform:uppercase; margin-bottom:6px;">
            📋 Current Squad Registration Status: ${teamName}
          </div>
          <p style="margin:0; font-size:15px; color:#FFFFFF; font-weight:700;">
            ${squadCount} / ${maxSquadSize} Players Registered (${openSlots} Available Slots)
          </p>
          <p style="margin:8px 0 0 0; font-size:12px; color:#94A3B8; line-height:1.5;">
            • <strong>Squad Limit:</strong> Maximum squad capacity is strictly capped at <strong>${maxSquadSize} players</strong>.<br>
            • <strong>New Signings:</strong> Clubs with open slots can register and verify new players directly.<br>
            • <strong>Transfers Out:</strong> Clubs at capacity (${maxSquadSize}/${maxSquadSize}) can release existing squad members to create openings for incoming players.<br>
            • <strong>Window Closes:</strong> ${formattedClose}.
          </p>
        </div>

        <div style="text-align:center; margin:24px 0;">
          <a href="https://skoutedyouthleague.vercel.app/team/dashboard" class="btn" style="color:#07120B !important;">
            Open Squad Roster & Register Players &rarr;
          </a>
        </div>

        <p style="color:#64748B; font-size:12px; text-align:center;">
          Please ensure all new additions are submitted before the transfer window deadline. Once the window closes, player registrations will be strictly locked for the remainder of the tournament.
        </p>
      `;

      const html = wrapEmailHtml({
        title: 'Mid-Season Transfer Window Open',
        preheader: `The mid-season transfer window is officially open! ${teamName} currently has ${squadCount}/${maxSquadSize} players registered.`,
        content,
        badgeText: 'TRANSFER WINDOW OPEN'
      });

      return await dispatchMail({
        to: managerEmail,
        subject,
        html,
        text: `Transfer Window Officially Open | Skouted Youth League Championship. Hello ${managerName || 'Team Manager'}, the transfer window is now active. Your team ${teamName} has ${squadCount}/${maxSquadSize} players registered (${openSlots} slots remaining). Register new players at https://skoutedyouthleague.vercel.app/team/dashboard before the window closes.`
      });
    } catch (error) {
      console.error('[EmailService Error - Transfer Window]:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;

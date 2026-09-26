const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const SystemCounter = require('../models/SystemCounter');

// Dual Resend API Key Configuration (Free tier 100 emails/day per key)
const primaryKey = process.env.RESEND_PRIMARY_KEY || process.env.RESEND_API_KEY || '';
const backupKey = process.env.RESEND_BACKUP_KEY || '';
const emailFrom = process.env.EMAIL_FROM || 'Skouted League <tournaments@thevillagecoders.com>';

const primaryResend = primaryKey ? new Resend(primaryKey) : null;
const backupResend = backupKey ? new Resend(backupKey) : null;

// Configure SMTP transport fallback if credentials are provided in environment
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
 * Identify HTTP 429 Rate Limit responses or Daily Quota errors from Resend
 */
function isRateLimitOrQuotaError(error) {
  if (!error) return false;
  if (typeof error === 'object') {
    const code = error.statusCode || error.status || error.code;
    if (code === 429 || code === '429') return true;
    const msg = String(error.message || error.name || error.code || JSON.stringify(error)).toLowerCase();
    if (/429|rate\s*limit|quota|daily\s*limit|too\s*many\s*requests|restricted|limit\s*exceeded/i.test(msg)) {
      return true;
    }
  }
  if (typeof error === 'string') {
    if (/429|rate\s*limit|quota|daily\s*limit|too\s*many\s*requests|restricted|limit\s*exceeded/i.test(error)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns current UTC calendar date as "YYYY-MM-DD"
 * Resend free-tier daily quotas reset at midnight UTC (00:00:00 UTC)
 */
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// In-memory cache for high-speed tracking and instant offline resilience
let inMemoryQuota = {
  date: getTodayDateString(),
  primaryCount: 0,
  backupCount: 0,
  primaryExhausted: false,
  exhaustedReason: null,
  lastDispatchedAt: null
};

/**
 * Synchronize daily quota state from MongoDB SystemCounter collection
 */
async function syncDailyCounter() {
  const today = getTodayDateString();

  // If calendar day rolled over, automatically reset in-memory counter for the new day
  if (inMemoryQuota.date !== today) {
    console.log(`[EmailService 🌅 Midnight Rollover]: Calendar date changed from ${inMemoryQuota.date} to ${today}. Resetting active key to RESEND_PRIMARY_KEY.`);
    inMemoryQuota = {
      date: today,
      primaryCount: 0,
      backupCount: 0,
      primaryExhausted: false,
      exhaustedReason: null,
      lastDispatchedAt: null
    };
  }

  try {
    if (SystemCounter.db && SystemCounter.db.readyState === 1) {
      let doc = await SystemCounter.findOne({ date: today });
      if (!doc) {
        doc = await SystemCounter.create({
          date: today,
          primaryCount: inMemoryQuota.primaryCount,
          backupCount: inMemoryQuota.backupCount,
          primaryExhausted: inMemoryQuota.primaryExhausted,
          exhaustedReason: inMemoryQuota.exhaustedReason
        });
      }
      inMemoryQuota.primaryCount = doc.primaryCount || 0;
      inMemoryQuota.backupCount = doc.backupCount || 0;
      inMemoryQuota.primaryExhausted = Boolean(doc.primaryExhausted);
      inMemoryQuota.exhaustedReason = doc.exhaustedReason || null;
      inMemoryQuota.lastDispatchedAt = doc.lastDispatchedAt || null;
      return doc;
    }
  } catch (err) {
    console.warn(`[EmailService Warning - SystemCounter DB Sync]: ${err.message}. Relying on in-memory tracker.`);
  }

  return inMemoryQuota;
}

/**
 * Flag primary Resend key as exhausted for the remainder of today
 */
async function markPrimaryExhausted(reason) {
  const today = getTodayDateString();
  inMemoryQuota.date = today;
  inMemoryQuota.primaryExhausted = true;
  inMemoryQuota.exhaustedReason = reason;

  console.warn(`[EmailService 🛑 Primary Key Exhausted]: Flagged primary key as exhausted for ${today}. Reason: ${reason}`);

  try {
    if (SystemCounter.db && SystemCounter.db.readyState === 1) {
      await SystemCounter.updateOne(
        { date: today },
        {
          $set: {
            primaryExhausted: true,
            exhaustedReason: reason
          }
        },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error(`[EmailService Error - markPrimaryExhausted]: ${err.message}`);
  }
}

/**
 * Record successful dispatch and increment appropriate counter
 */
async function recordDispatchSuccess(keyUsed, recipients, subject, resendId) {
  const today = getTodayDateString();
  inMemoryQuota.date = today;
  inMemoryQuota.lastDispatchedAt = new Date();

  if (keyUsed === 'primary') {
    inMemoryQuota.primaryCount++;
    if (inMemoryQuota.primaryCount >= 100) {
      inMemoryQuota.primaryExhausted = true;
      inMemoryQuota.exhaustedReason = 'Daily quota threshold of 100 reached';
      console.log(`[EmailService 🎯 100 Emails Reached]: Primary key reached 100 emails today. Automatically rotating to BACKUP key for subsequent emails.`);
    }
  } else if (keyUsed === 'backup') {
    inMemoryQuota.backupCount++;
  }

  try {
    if (SystemCounter.db && SystemCounter.db.readyState === 1) {
      const update = {
        $set: {
          lastDispatchedAt: new Date()
        },
        $inc: {
          ...(keyUsed === 'primary' ? { primaryCount: 1 } : {}),
          ...(keyUsed === 'backup' ? { backupCount: 1 } : {})
        },
        $push: {
          dispatches: {
            $each: [{
              timestamp: new Date(),
              keyUsed,
              recipients: Array.isArray(recipients) ? recipients : [recipients],
              subject: subject || '',
              status: 'success',
              resendId: resendId || ''
            }],
            $slice: -200 // Keep last 200 logs per calendar day
          }
        }
      };

      if (keyUsed === 'primary' && inMemoryQuota.primaryCount >= 100) {
        update.$set.primaryExhausted = true;
        update.$set.exhaustedReason = 'Daily quota threshold of 100 reached';
      }

      await SystemCounter.updateOne({ date: today }, update, { upsert: true });
    }
  } catch (err) {
    console.error(`[EmailService Error - recordDispatchSuccess]: ${err.message}`);
  }
}

// Scheduled check for automatic midnight UTC reset
function scheduleMidnightReset() {
  const now = new Date();
  const nextMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1));
  const delay = Math.max(1000, nextMidnightUtc.getTime() - now.getTime());

  const timer = setTimeout(async () => {
    console.log(`[EmailService 🌙 Midnight UTC]: Resetting daily quota counter back to RESEND_PRIMARY_KEY.`);
    try {
      await syncDailyCounter();
    } catch (e) {
      // ignore
    }
    scheduleMidnightReset();
  }, delay);
  if (timer.unref) timer.unref();
}
scheduleMidnightReset();

/**
 * Intelligent Rate Limiting & Auto-Retry Queue for Transactional Emails
 */
class EmailRateLimiterQueue {
  constructor(options = {}) {
    this.minIntervalMs = options.minIntervalMs || parseInt(process.env.EMAIL_MIN_INTERVAL_MS || '250', 10);
    this.maxRetries = options.maxRetries || 3;
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
      const item = this.queue[0];

      const now = Date.now();
      if (this.rateLimitPausedUntil > now) {
        const pauseTime = this.rateLimitPausedUntil - now;
        console.log(`[EmailQueue]: Queue paused for ${pauseTime}ms due to active rate-limit window...`);
        await new Promise(r => setTimeout(r, pauseTime));
      }

      const elapsedSinceLast = Date.now() - this.lastDispatchedAt;
      if (elapsedSinceLast < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      this.queue.shift();
      this.lastDispatchedAt = Date.now();

      try {
        const result = await item.taskFn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.isProcessing = false;
  }
}

// Global queue singleton
const emailQueue = new EmailRateLimiterQueue({ minIntervalMs: 250, maxRetries: 3 });

/**
 * Dispatch email via Backup Resend client
 */
async function dispatchWithBackup({ recipients, subject, html, text, failoverReason }) {
  if (backupResend) {
    try {
      console.log(`[EmailService 🔄 Backup Dispatch]: Dispatching to ${recipients.join(', ')} via BACKUP Resend key (Reason: ${failoverReason || 'rotation'})...`);
      const backupRes = await backupResend.emails.send({
        from: emailFrom,
        to: recipients,
        subject,
        html,
        text: text || ''
      });

      if (!backupRes.error) {
        await recordDispatchSuccess('backup', recipients, subject, backupRes.data?.id);
        console.log(`[EmailService ✅ Backup Dispatched]: Successfully sent via Resend BACKUP to ${recipients.join(', ')} (ID: ${backupRes.data?.id || 'ok'}) [Backup Count: ${inMemoryQuota.backupCount}]`);
        return { success: true, provider: 'resend_backup', id: backupRes.data?.id, failover: true };
      }

      console.warn(`[EmailService Warning - Resend Backup Error]: ${backupRes.error?.message || JSON.stringify(backupRes.error)}`);
    } catch (backupErr) {
      console.error(`[EmailService Error - Resend Backup Exception]: ${backupErr.message}`);
    }
  } else {
    console.warn('[EmailService Warning]: RESEND_BACKUP_KEY is not configured.');
  }

  // Fallback to SMTP if configured
  return await dispatchWithSmtp({ recipients, subject, html, text });
}

/**
 * Dispatch email via SMTP fallback
 */
async function dispatchWithSmtp({ recipients, subject, html, text }) {
  if (smtpTransporter) {
    try {
      console.log(`[EmailService]: Attempting tertiary SMTP delivery to ${recipients.join(', ')}...`);
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

  console.warn(`[EmailService Notice]: Email to ${recipients.join(', ')} logged to console due to quota limits on all providers.`);
  return {
    success: false,
    error: 'Email quota reached on all keys. In-app verification active.',
    quotaExceeded: true
  };
}

/**
 * Primary dispatch engine with 100/day auto-rotation and instant 429 failover
 */
async function rawSendMail({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) {
    return { success: false, error: 'No recipients provided' };
  }

  // Sync latest quota state for today
  await syncDailyCounter();

  const isPrimaryExhausted = inMemoryQuota.primaryExhausted || inMemoryQuota.primaryCount >= 100;

  // 1. If primary key is healthy and under 100 dispatches today, use PRIMARY
  if (!isPrimaryExhausted && primaryResend) {
    try {
      console.log(`[EmailService]: Sending via Resend PRIMARY (${inMemoryQuota.primaryCount + 1}/100) to ${recipients.join(', ')}...`);
      const res = await primaryResend.emails.send({
        from: emailFrom,
        to: recipients,
        subject,
        html,
        text: text || ''
      });

      if (!res.error) {
        await recordDispatchSuccess('primary', recipients, subject, res.data?.id);
        console.log(`[EmailService ✅ Primary Dispatched]: Successfully sent via Resend PRIMARY to ${recipients.join(', ')} (ID: ${res.data?.id || 'ok'}) [Daily Primary: ${inMemoryQuota.primaryCount}/100]`);
        return { success: true, provider: 'resend_primary', id: res.data?.id };
      }

      // Check if primary returned 429 Too Many Requests or quota exceeded
      const errMsg = res.error?.message || JSON.stringify(res.error);
      const isQuota = isRateLimitOrQuotaError(res.error);

      if (isQuota) {
        console.warn(`[EmailService ⚠️ FAILOVER TRIGGERED]: Resend PRIMARY returned rate limit / quota error: ${errMsg}. Flagging primary key as exhausted for today and immediately retrying with BACKUP key...`);
        await markPrimaryExhausted(`Resend 429/Quota: ${errMsg}`);
        return await dispatchWithBackup({ recipients, subject, html, text, failoverReason: errMsg });
      }

      console.warn(`[EmailService Warning - Resend Primary Error]: ${errMsg}. Attempting failover to backup key...`);
      return await dispatchWithBackup({ recipients, subject, html, text, failoverReason: errMsg });
    } catch (resendErr) {
      console.warn(`[EmailService ⚠️ FAILOVER Exception]: Primary Resend key threw exception: ${resendErr.message}`);
      if (isRateLimitOrQuotaError(resendErr)) {
        await markPrimaryExhausted(`Resend Exception: ${resendErr.message}`);
      }
      return await dispatchWithBackup({ recipients, subject, html, text, failoverReason: resendErr.message });
    }
  }

  // 2. If primary reached 100/day or is flagged exhausted, rotate directly to BACKUP
  if (isPrimaryExhausted) {
    console.log(`[EmailService 🔄 Daily Rotation]: Primary key exhausted/limit reached (${inMemoryQuota.primaryCount}/100). Routing to BACKUP Resend key...`);
    return await dispatchWithBackup({ recipients, subject, html, text, failoverReason: 'Primary 100/day quota reached' });
  }

  // 3. If primary key is unconfigured, try backup directly
  if (backupResend) {
    return await dispatchWithBackup({ recipients, subject, html, text, failoverReason: 'Primary unconfigured' });
  }

  // 4. Fallback to SMTP
  return await dispatchWithSmtp({ recipients, subject, html, text });
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
        <div style="margin-bottom: 12px; text-align: center;">
          <img src="https://api.skoutedyouthleague.com/logo.png" alt="Skouted Youth League" style="width: 68px; height: auto; max-height: 78px; margin: 0 auto; display: block; filter: drop-shadow(0 4px 10px rgba(0, 230, 118, 0.2));" />
        </div>
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

  // 9. Alert Admin of New Team Registration with One-Click Direct Approval
  static async sendNewTeamRegistrationAlert({
    recipientEmail = 'maroophadek@gmail.com',
    team,
    approveUrl,
    rejectUrl,
    adminPortalUrl
  }) {
    try {
      if (!recipientEmail) return { success: false, error: 'No recipient provided' };

      const teamName = team.name || 'New Team';
      const shortCode = team.shortCode || 'N/A';
      const managerName = team.managerName || 'Not specified';
      const managerEmail = team.managerEmail || 'Not specified';
      const managerPhone = team.managerPhone || 'Not specified';
      const homeGround = team.homeGround || 'Not specified';
      const registeredAt = team.createdAt ? new Date(team.createdAt).toUTCString() : new Date().toUTCString();
      const crestUrl = team.logo && (team.logo.startsWith('http') || team.logo.startsWith('/')) ? team.logo : null;

      const subject = `⚽ New Club Registration: ${teamName} (${shortCode}) - Accreditation Required`;

      const content = `
        <div style="background: linear-gradient(135deg, rgba(0, 230, 118, 0.12) 0%, rgba(56, 189, 248, 0.06) 100%); border: 1px solid rgba(0, 230, 118, 0.3); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
          <div style="margin-bottom: 8px;">
            <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #00E676; text-transform: uppercase; background: rgba(0, 230, 118, 0.15); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(0, 230, 118, 0.3); display: inline-block;">
              ⏳ PENDING ACCREDITATION
            </span>
            <span style="font-size: 11px; color: #94A3B8; font-family: monospace; float: right; margin-top: 4px;">
              ${registeredAt}
            </span>
          </div>
          <div style="clear: both;"></div>
          <h2 style="color: #FFFFFF; font-size: 22px; font-weight: 900; margin: 12px 0 6px 0; letter-spacing: -0.5px;">
            ${teamName} <span style="color: #00E676; font-size: 16px; font-weight: 800;">[${shortCode}]</span>
          </h2>
          <p style="color: #CBD5E1; font-size: 13px; margin: 0; line-height: 1.5;">
            A new football club has completed portal registration and submitted their official accreditation application for the <strong>Skouted Youth League Championship Season 2026/2027</strong>.
          </p>
        </div>

        <!-- Club Profile Overview -->
        <h3 style="color: #FFFFFF; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; margin: 24px 0 10px 0; border-bottom: 1px solid #232733; padding-bottom: 6px;">
          🏟️ Club Details
        </h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 22px; font-size: 13px;">
          ${crestUrl ? `
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B; width: 35%;">Club Crest</td>
            <td style="padding: 10px 0; text-align: right;">
              <img src="${crestUrl}" alt="${teamName}" style="width: 44px; height: 44px; object-fit: contain; border-radius: 8px; background: #0D0F14; padding: 4px; border: 1px solid #283042; display: inline-block;" />
            </td>
          </tr>` : ''}
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B; width: 35%;">Club Name</td>
            <td style="padding: 10px 0; color: #FFFFFF; font-weight: 700; text-align: right;">${teamName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B;">Short Code</td>
            <td style="padding: 10px 0; color: #00E676; font-weight: 800; font-family: monospace; text-align: right;">${shortCode}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B;">Home Ground</td>
            <td style="padding: 10px 0; color: #E2E8F0; text-align: right;">${homeGround}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B;">Kit Colors</td>
            <td style="padding: 10px 0; color: #E2E8F0; text-align: right;">
              Home: <span style="display:inline-block; width:12px; height:12px; background:${team.homeKitColor || '#00E676'}; border-radius:50%; vertical-align:middle; border:1px solid #444;"></span> &nbsp;|&nbsp; 
              Away: <span style="display:inline-block; width:12px; height:12px; background:${team.awayKitColor || '#3B82F6'}; border-radius:50%; vertical-align:middle; border:1px solid #444;"></span>
            </td>
          </tr>
        </table>

        <!-- Manager / Point of Contact Details -->
        <h3 style="color: #FFFFFF; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; margin: 24px 0 10px 0; border-bottom: 1px solid #232733; padding-bottom: 6px;">
          👤 Team Manager & Point of Contact
        </h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B; width: 35%;">Manager / Coach</td>
            <td style="padding: 10px 0; color: #FFFFFF; font-weight: 700; text-align: right;">${managerName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B;">Official Email</td>
            <td style="padding: 10px 0; text-align: right;">
              <a href="mailto:${managerEmail}" style="color: #38BDF8; text-decoration: none; font-weight: 600;">${managerEmail}</a>
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2330;">
            <td style="padding: 10px 0; color: #64748B;">Phone / WhatsApp</td>
            <td style="padding: 10px 0; text-align: right;">
              <a href="tel:${managerPhone}" style="color: #00E676; text-decoration: none; font-weight: 600;">${managerPhone}</a>
            </td>
          </tr>
        </table>

        <!-- Interactive Direct Approval Action Center -->
        <div style="background-color: #171B26; border: 2px solid #00E676; border-radius: 16px; padding: 26px 20px; text-align: center; margin: 28px 0; box-shadow: 0 10px 30px rgba(0, 230, 118, 0.15);">
          <div style="font-size: 11px; font-weight: 800; color: #00E676; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">
            ⚡ Quick Accreditation Action
          </div>
          <h4 style="color: #FFFFFF; font-size: 18px; margin: 0 0 10px 0; font-weight: 900;">
            Accept & Verify This Club Immediately
          </h4>
          <p style="color: #94A3B8; font-size: 12px; margin: 0 0 20px 0; line-height: 1.5;">
            Clicking the button below directly verifies <strong>${teamName}</strong>, unlocks player roster registrations for the manager, and sends the manager their official welcome accreditation email.
          </p>
          
          <div style="margin: 18px 0;">
            <a href="${approveUrl}" class="btn" style="display: inline-block; background: linear-gradient(135deg, #00E676 0%, #00B359 100%); color: #07120B !important; font-weight: 900; font-size: 15px; text-decoration: none; padding: 14px 34px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 15px rgba(0,230,118,0.4);">
              ✅ Accept & Approve Team &rarr;
            </a>
          </div>

          <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #94A3B8;">
            <a href="${adminPortalUrl}" style="color: #38BDF8; text-decoration: none; font-weight: 600; margin-right: 16px;">
              🛡️ View in Admin Portal
            </a>
            <span style="color: #475569;">|</span>
            <a href="${rejectUrl}" style="color: #F87171; text-decoration: none; font-weight: 600; margin-left: 16px;">
              ❌ Reject Application
            </a>
          </div>
        </div>

        <p style="color: #64748B; font-size: 11px; text-align: center; margin-top: 16px; line-height: 1.5;">
          This secure automated dispatch was sent directly to <strong>${recipientEmail}</strong> for tournament administration.
        </p>
      `;

      const html = wrapEmailHtml({
        title: `New Team Registration: ${teamName}`,
        preheader: `New Club Registration: ${teamName} (${shortCode}) registered. Review details and accept directly.`,
        content,
        badgeText: 'CLUB REGISTRATION ALERT'
      });

      return await dispatchMail({
        to: recipientEmail,
        subject,
        html,
        text: `New Team Registration: ${teamName} (${shortCode})\nManager: ${managerName} (${managerEmail}, ${managerPhone})\nApprove directly: ${approveUrl}\nAdmin portal: ${adminPortalUrl}`
      });
    } catch (error) {
      console.error('[EmailService Error - New Team Registration Alert]:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 10. Daily Email Quota & Rotation Status
  static async getQuotaStatus() {
    await syncDailyCounter();
    const today = getTodayDateString();
    const isPrimaryExhausted = inMemoryQuota.primaryExhausted || inMemoryQuota.primaryCount >= 100;
    return {
      date: today,
      primaryCount: inMemoryQuota.primaryCount,
      backupCount: inMemoryQuota.backupCount,
      totalDispatchedToday: inMemoryQuota.primaryCount + inMemoryQuota.backupCount,
      dailyQuotaLimit: 100,
      primaryRemaining: Math.max(0, 100 - inMemoryQuota.primaryCount),
      primaryExhausted: isPrimaryExhausted,
      exhaustedReason: inMemoryQuota.exhaustedReason,
      activeKey: isPrimaryExhausted ? 'backup' : 'primary',
      lastDispatchedAt: inMemoryQuota.lastDispatchedAt,
      primaryKeyConfigured: Boolean(primaryResend),
      backupKeyConfigured: Boolean(backupResend),
      senderEmail: emailFrom
    };
  }

  // 10. Manual Quota Reset (for admin or testing)
  static async resetDailyQuota(dateOverride) {
    const today = dateOverride || getTodayDateString();
    inMemoryQuota = {
      date: today,
      primaryCount: 0,
      backupCount: 0,
      primaryExhausted: false,
      exhaustedReason: null,
      lastDispatchedAt: null
    };

    if (SystemCounter.db && SystemCounter.db.readyState === 1) {
      await SystemCounter.updateOne(
        { date: today },
        {
          $set: {
            primaryCount: 0,
            backupCount: 0,
            primaryExhausted: false,
            exhaustedReason: null
          }
        },
        { upsert: true }
      );
    }
    return await this.getQuotaStatus();
  }

  // 11. Simulate 429 Quota Exhaustion & Immediate Failover
  static async simulateFailover(reason = 'Simulated 429 Quota Exhaustion') {
    await markPrimaryExhausted(reason);
    return await this.getQuotaStatus();
  }
}

module.exports = EmailService;

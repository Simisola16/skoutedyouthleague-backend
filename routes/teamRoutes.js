const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const LeagueSettings = require('../models/LeagueSettings');
const { upload } = require('../services/cloudinary');
const { broadcastMatchUpdate } = require('../services/socketService');
const jwt = require('jsonwebtoken');
const EmailService = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'skouted_league_super_secret_jwt_key_2026';

function renderActionStatusPage({
  success,
  alreadyApproved = false,
  title,
  badge,
  message,
  team = null,
  managerNotified = false,
  actionUrl = 'https://skoutedyouthleague.vercel.app/admin',
  actionText = 'Open Admin Command Center'
}) {
  const accentColor = success ? '#00E676' : '#FF4B4B';
  const icon = success ? '✓' : '✕';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Skouted Youth League</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 16px; min-height: 100vh;
      background: radial-gradient(circle at 50% 20%, #151928 0%, #080A0F 100%);
      color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      width: 100%; max-width: 520px; background: #121522;
      border: 1px solid #232A3D; border-radius: 28px;
      padding: 36px 28px; text-align: center;
      box-shadow: 0 25px 60px rgba(0,0,0,0.7);
    }
    .logo-container {
      width: 80px; height: 80px; margin: 0 auto 18px auto;
      padding: 6px; background: rgba(0, 230, 118, 0.08);
      border: 1px solid rgba(0, 230, 118, 0.25); border-radius: 20px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 10px 25px rgba(0, 230, 118, 0.15);
    }
    .logo-img { width: 100%; height: 100%; object-fit: contain; }
    .badge {
      display: inline-block; background: ${success ? 'rgba(0, 230, 118, 0.12)' : 'rgba(255, 75, 75, 0.12)'};
      border: 1px solid ${accentColor}; color: ${accentColor};
      font-size: 11px; font-weight: 800; letter-spacing: 1.5px;
      padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 18px;
    }
    .icon-badge {
      width: 58px; height: 58px; border-radius: 50%;
      background: ${success ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 75, 75, 0.15)'};
      border: 2px solid ${accentColor}; color: ${accentColor};
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 900; margin: 0 auto 16px auto;
      box-shadow: 0 0 20px ${success ? 'rgba(0, 230, 118, 0.3)' : 'rgba(255, 75, 75, 0.3)'};
    }
    h1 { color: #FFFFFF; font-size: 22px; font-weight: 900; margin: 0 0 12px 0; letter-spacing: -0.5px; }
    p { color: #94A3B8; font-size: 14px; line-height: 1.6; margin: 0 0 22px 0; }
    .details-box {
      background: #181C2B; border: 1px solid #283044; border-radius: 16px;
      padding: 16px 20px; text-align: left; font-size: 13px; margin: 20px 0 24px 0;
    }
    .detail-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #64748B; font-weight: 500; }
    .detail-value { color: #FFFFFF; font-weight: 700; text-align: right; }
    .btn {
      display: inline-block; width: 100%;
      background: linear-gradient(135deg, #00E676 0%, #00B359 100%);
      color: #07120B !important; font-weight: 900; font-size: 14px;
      text-decoration: none; padding: 14px 24px; border-radius: 12px;
      text-transform: uppercase; letter-spacing: 0.5px;
      box-shadow: 0 6px 20px rgba(0, 230, 118, 0.3); transition: all 0.2s ease;
    }
    .notice { font-size: 12px; color: #64748B; margin-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <img src="https://api.skoutedyouthleague.com/logo.png" alt="Skouted Youth League" class="logo-img" />
    </div>
    <div class="badge">${badge}</div>
    <div class="icon-badge">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>

    ${team ? `
    <div class="details-box">
      <div class="detail-row">
        <span class="detail-label">Club Name</span>
        <span class="detail-value">${team.name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Short Code</span>
        <span class="detail-value" style="color: #00E676; font-family: monospace;">${team.shortCode}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Home Ground</span>
        <span class="detail-value">${team.homeGround || 'Main Pitch'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Manager</span>
        <span class="detail-value">${team.managerName || 'Assigned'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Official Email</span>
        <span class="detail-value" style="color: #38BDF8;">${team.managerEmail || 'N/A'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value" style="color: #00E676;">✓ Verified & Active</span>
      </div>
    </div>
    ` : ''}

    ${managerNotified ? `
    <p style="font-size: 12px; color: #00E676; background: rgba(0, 230, 118, 0.08); border: 1px solid rgba(0, 230, 118, 0.2); border-radius: 10px; padding: 10px; margin-bottom: 20px;">
      ✉️ An automated accreditation email has been dispatched to <strong>${team.managerEmail}</strong>. Player registration is now unlocked for their squad.
    </p>
    ` : ''}

    <a href="${actionUrl}" class="btn">${actionText} &rarr;</a>
    <div class="notice">
      Skouted Youth League Championship • Season 2026/2027<br>
      Automated Competition Accreditation Service
    </div>
  </div>
</body>
</html>`;
}

// 1. Get all teams
router.get('/', async (req, res) => {
  try {
    const teams = await Team.find().populate('squad').sort({ 'stats.points': -1, 'stats.goalDifference': -1 });
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Direct One-Click Email Approval Action
router.get('/action/approve', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(renderActionStatusPage({
        success: false,
        title: 'Missing Approval Token',
        badge: 'SECURITY ERROR',
        message: 'The accreditation approval link is missing a valid token. Please log in to the Admin Portal to approve manually.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Go to Admin Portal'
      }));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send(renderActionStatusPage({
        success: false,
        title: 'Approval Link Expired or Invalid',
        badge: 'TOKEN EXPIRED',
        message: 'This accreditation approval link has expired or is invalid. Please log in to the Admin Command Center to manage team accreditations.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Command Center'
      }));
    }

    if (decoded.action !== 'approve' || !decoded.teamId) {
      return res.status(400).send(renderActionStatusPage({
        success: false,
        title: 'Invalid Action Token',
        badge: 'ACTION REJECTED',
        message: 'The security payload is invalid for team accreditation approval.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Portal'
      }));
    }

    const team = await Team.findById(decoded.teamId);
    if (!team) {
      return res.status(404).send(renderActionStatusPage({
        success: false,
        title: 'Team Not Found',
        badge: 'CLUB MISSING',
        message: 'The requested club registration could not be found in the database. It may have been removed.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Portal'
      }));
    }

    // Check if already approved
    if (team.verificationStatus === 'approved') {
      return res.send(renderActionStatusPage({
        success: true,
        alreadyApproved: true,
        title: 'Club Already Verified & Active',
        badge: 'ALREADY ACCREDITED',
        message: `<strong>${team.name}</strong> (${team.shortCode}) was already verified on ${team.verifiedAt ? new Date(team.verifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'record'}. Player registration is currently active.`,
        team,
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Command Center'
      }));
    }

    // Approve the team
    team.verificationStatus = 'approved';
    team.status = 'Verified';
    team.verifiedAt = new Date();
    team.rejectionReason = '';

    // Find admin user for verifiedBy
    const adminUser = await User.findOne({ email: decoded.email || 'maroophadek@gmail.com' }) || await User.findOne({ role: 'admin' });
    if (adminUser) {
      team.verifiedBy = adminUser._id;
    }
    await team.save();

    // Verify associated manager user(s)
    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }
    await User.updateMany(
      { $or: userQueries },
      {
        $set: {
          isVerified: true,
          verificationOtp: null,
          otpExpiresAt: null,
          team: team._id
        }
      }
    );

    // Notify manager of approval via email
    const managerEmail = team.managerEmail;
    const managerName = team.managerName || 'Team Manager';
    if (managerEmail) {
      EmailService.sendTeamApprovalEmail({
        managerEmail,
        managerName,
        teamName: team.name
      }).catch(e => console.error('[Manager Approval Notice Error]:', e));
    }

    console.log(`[Email Action ✅ Team Approved]: ${team.name} (${team.shortCode}) approved by ${decoded.email || 'admin'}`);

    return res.send(renderActionStatusPage({
      success: true,
      title: 'Club Accredited & Approved!',
      badge: 'VERIFICATION SUCCESSFUL',
      message: `<strong>${team.name}</strong> (${team.shortCode}) is now officially verified for the <strong>Skouted Youth League Championship Season 2026/2027</strong>.`,
      team,
      managerNotified: true,
      actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
      actionText: 'Open Admin Command Center'
    }));
  } catch (err) {
    console.error('[Action Approve Error]:', err);
    res.status(500).send(renderActionStatusPage({
      success: false,
      title: 'Server Processing Error',
      badge: 'SYSTEM ERROR',
      message: `An unexpected error occurred while approving the club: ${err.message}`,
      actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
      actionText: 'Open Admin Portal'
    }));
  }
});

// 3. Direct Email Rejection Action
router.get('/action/reject', async (req, res) => {
  try {
    const { token, confirm, reason } = req.query;
    if (!token) {
      return res.status(400).send(renderActionStatusPage({
        success: false,
        title: 'Missing Token',
        badge: 'SECURITY ERROR',
        message: 'The rejection link is missing a security token.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Go to Admin Portal'
      }));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send(renderActionStatusPage({
        success: false,
        title: 'Link Expired',
        badge: 'EXPIRED',
        message: 'This security link has expired.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Portal'
      }));
    }

    const team = await Team.findById(decoded.teamId);
    if (!team) {
      return res.status(404).send(renderActionStatusPage({
        success: false,
        title: 'Team Not Found',
        badge: 'NOT FOUND',
        message: 'The requested club registration could not be found.',
        actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
        actionText: 'Open Admin Portal'
      }));
    }

    if (confirm !== 'true') {
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Rejection | Skouted Youth League</title>
  <style>
    body { margin:0; padding:20px; background:#07090E; color:#E2E8F0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { max-width:480px; width:100%; background:#121622; border:1px solid #283044; border-radius:24px; padding:32px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.6); }
    .badge { display:inline-block; background:rgba(255,75,75,0.15); border:1px solid #FF4B4B; color:#FF4B4B; font-size:11px; font-weight:800; padding:4px 12px; border-radius:20px; text-transform:uppercase; margin-bottom:16px; letter-spacing:1px; }
    h2 { color:#FFFFFF; margin:0 0 12px 0; font-size:20px; font-weight:900; }
    p { color:#94A3B8; font-size:14px; line-height:1.5; margin-bottom:20px; }
    textarea { width:100%; box-sizing:border-box; background:#181D2A; border:1px solid #2B3346; border-radius:12px; padding:12px; color:#FFFFFF; font-size:13px; margin-bottom:20px; resize:vertical; min-height:80px; font-family:inherit; }
    .btn-reject { display:block; width:100%; background:linear-gradient(135deg, #FF4B4B 0%, #D32F2F 100%); color:#FFFFFF; font-weight:800; font-size:14px; border:none; padding:14px; border-radius:12px; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px; }
    .cancel-link { display:inline-block; margin-top:16px; color:#94A3B8; text-decoration:none; font-size:13px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">CONFIRM REJECTION</div>
    <h2>Reject Application for ${team.name}?</h2>
    <p>Please enter an optional reason explaining why this club registration is being rejected. This explanation will be emailed to the team manager.</p>
    <form method="GET" action="/api/teams/action/reject">
      <input type="hidden" name="token" value="${token}" />
      <input type="hidden" name="confirm" value="true" />
      <textarea name="reason" placeholder="Reason for rejection (e.g. Incomplete documentation, age criteria not verified)..."></textarea>
      <button type="submit" class="btn-reject">Confirm Club Rejection</button>
    </form>
    <a href="https://skoutedyouthleague.vercel.app/admin" class="cancel-link">&larr; Cancel & Return to Admin Portal</a>
  </div>
</body>
</html>`);
    }

    // Execute rejection
    const rejectionReason = reason ? reason.trim() : 'Registration details did not meet tournament accreditation requirements.';
    team.verificationStatus = 'rejected';
    team.status = 'Pending Verification';
    team.rejectionReason = rejectionReason;
    await team.save();

    if (team.managerEmail) {
      EmailService.sendTeamRejectionEmail({
        managerEmail: team.managerEmail,
        managerName: team.managerName || 'Team Manager',
        teamName: team.name,
        rejectionReason
      }).catch(e => console.error('[Manager Rejection Notice Error]:', e));
    }

    return res.send(renderActionStatusPage({
      success: false,
      title: 'Registration Rejected',
      badge: 'APPLICATION REJECTED',
      message: `The application for <strong>${team.name}</strong> has been rejected. The manager (${team.managerEmail}) has been notified.`,
      team,
      actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
      actionText: 'Return to Admin Portal'
    }));
  } catch (err) {
    console.error('[Action Reject Error]:', err);
    res.status(500).send(renderActionStatusPage({
      success: false,
      title: 'Processing Error',
      badge: 'SYSTEM ERROR',
      message: err.message,
      actionUrl: 'https://skoutedyouthleague.vercel.app/admin',
      actionText: 'Open Admin Portal'
    }));
  }
});

// 4. Get single team with squad
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('squad');
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    // Also get upcoming and recent fixtures for this team
    const fixtures = await Fixture.find({
      $or: [{ homeTeam: team._id }, { awayTeam: team._id }]
    }).populate('homeTeam awayTeam').sort({ date: 1, time: 1 });

    res.json({ success: true, data: { team, fixtures } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Register / Create a Team (with optional crest upload)
router.post('/', upload.single('crest'), async (req, res) => {
  try {
    const { name, shortCode, homeGround, managerName, managerEmail, managerPhone, userId } = req.body;

    if (!name || !shortCode) {
      return res.status(400).json({ success: false, error: 'Team name and short code are required' });
    }

    const existingTeam = await Team.findOne({
      $or: [{ name: name.trim() }, { shortCode: shortCode.trim().toUpperCase() }]
    });

    if (existingTeam) {
      return res.status(400).json({ success: false, error: 'A team with this name or short code already exists' });
    }

    const logo = req.file ? req.file.path : (req.body.logo || '');

    const team = new Team({
      name: name.trim(),
      shortCode: shortCode.trim().toUpperCase(),
      homeGround: homeGround || 'Legacy Pitch Arena A',
      manager: userId || null,
      managerName: managerName || '',
      managerEmail: managerEmail || '',
      managerPhone: managerPhone || '',
      verificationStatus: 'pending',
      status: 'Pending Verification',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: '',
      logo
    });

    await team.save();

    // Link team to manager user if provided
    if (userId) {
      await User.findByIdAndUpdate(userId, { team: team._id });
    }

    // Dispatch automated admin notification to maroophadek@gmail.com with one-click direct approval
    try {
      const adminRecipient = process.env.ADMIN_NOTIFICATION_EMAIL || 'maroophadek@gmail.com';
      const tokenPayload = {
        teamId: team._id.toString(),
        teamName: team.name,
        action: 'approve',
        email: adminRecipient
      };
      const approvalToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '60d' });
      const rejectionToken = jwt.sign({ ...tokenPayload, action: 'reject' }, JWT_SECRET, { expiresIn: '60d' });

      const serverBaseUrl = process.env.SERVER_BASE_URL || 'https://api.skoutedyouthleague.com';
      const approveUrl = `${serverBaseUrl}/api/teams/action/approve?token=${encodeURIComponent(approvalToken)}`;
      const rejectUrl = `${serverBaseUrl}/api/teams/action/reject?token=${encodeURIComponent(rejectionToken)}`;
      const adminPortalUrl = 'https://skoutedyouthleague.vercel.app/admin';

      EmailService.sendNewTeamRegistrationAlert({
        recipientEmail: adminRecipient,
        team,
        approveUrl,
        rejectUrl,
        adminPortalUrl
      }).catch(alertErr => {
        console.error('[EmailService Notice - Team Registration Alert Failed]:', alertErr.message);
      });
      console.log(`[Team Registration]: Dispatched accreditation alert for "${team.name}" to ${adminRecipient}`);
    } catch (dispatchErr) {
      console.error('[Team Registration Notification Error]:', dispatchErr.message);
    }

    res.status(201).json({ success: true, message: 'Team registered successfully', data: team });
  } catch (err) {
    console.error('[Create Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Add Player to Team Squad (with optional Cloudinary photo)
router.post('/:id/players', upload.single('photo'), async (req, res) => {
  try {
    const [team, settings] = await Promise.all([
      Team.findById(req.params.id),
      LeagueSettings.getSettings()
    ]);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const isApproved = team.verificationStatus === 'approved' || (team.status === 'Verified' && team.verificationStatus !== 'rejected' && team.verificationStatus !== 'pending');
    if (!isApproved) {
      return res.status(403).json({
        success: false,
        error: 'Your team has not yet been verified by the administrator. Player registration is locked.'
      });
    }

    const maxLimit = settings.maxSquadSize || 35;
    const currentCount = await Player.countDocuments({ team: team._id });
    if (currentCount >= maxLimit) {
      return res.status(400).json({
        success: false,
        error: `Squad capacity reached. Maximum allowed is ${maxLimit} players.`
      });
    }

    if (settings.registrationLocked === true && settings.transferWindowStatus === 'closed') {
      return res.status(403).json({
        success: false,
        error: "Player registration is currently closed. New players cannot be added until the mid-season transfer window opens."
      });
    }

    const eligibility = settings.checkRegistrationEligibility();
    if (!eligibility.allowed) {
      return res.status(403).json({
        success: false,
        error: eligibility.reason
      });
    }

    const { firstName, lastName, jerseyNumber, position, subPosition, preferredFoot, age, dateOfBirth } = req.body;

    if (!firstName || !lastName || !jerseyNumber || !position) {
      return res.status(400).json({ success: false, error: 'First name, last name, jersey number, and position are required' });
    }

    // Check duplicate jersey number in same team
    const duplicateJersey = await Player.findOne({ team: team._id, jerseyNumber: Number(jerseyNumber) });
    if (duplicateJersey) {
      return res.status(400).json({ success: false, error: `Jersey #${jerseyNumber} is already assigned to ${duplicateJersey.firstName} ${duplicateJersey.lastName}` });
    }

    const photo = req.file ? req.file.path : (req.body.photo || '');

    const player = new Player({
      team: team._id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jerseyNumber: Number(jerseyNumber),
      position,
      subPosition: subPosition || '',
      photo,
      preferredFoot: preferredFoot || 'Right',
      age: Number(age) || 17,
      dateOfBirth: dateOfBirth || ''
    });

    await player.save();

    res.status(201).json({ success: true, message: 'Player added to squad', data: player });
  } catch (err) {
    console.error('[Add Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Submit & Lock-in Matchday Lineup
router.post('/lineup/:fixtureId', async (req, res) => {
  try {
    const { fixtureId } = req.params;
    const { teamId, formation, startingXI, bench } = req.body;

    if (!teamId || !startingXI || startingXI.length !== 11) {
      return res.status(400).json({ success: false, error: 'Starting XI must contain exactly 11 players' });
    }

    const fixture = await Fixture.findById(fixtureId);
    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Fixture not found' });
    }

    const isHome = fixture.homeTeam.toString() === teamId.toString();
    const isAway = fixture.awayTeam.toString() === teamId.toString();

    if (!isHome && !isAway) {
      return res.status(400).json({ success: false, error: 'This team is not playing in this fixture' });
    }

    const lineupPayload = {
      formation: formation || '4-3-3',
      startingXI: startingXI.map(slot => ({
        player: slot.player || slot.playerId,
        position: slot.position,
        gridX: slot.gridX || 50,
        gridY: slot.gridY || 50,
        isCaptain: !!slot.isCaptain
      })),
      bench: (bench || []).map(b => ({
        player: b.player || b.playerId,
        position: b.position || 'SUB'
      })),
      isLocked: true,
      submittedAt: new Date()
    };

    if (isHome) {
      fixture.homeLineup = lineupPayload;
    } else {
      fixture.awayLineup = lineupPayload;
    }

    await fixture.save();

    const populated = await Fixture.findById(fixture._id)
      .populate('homeTeam awayTeam')
      .populate('homeLineup.startingXI.player awayLineup.startingXI.player homeLineup.bench.player awayLineup.bench.player');

    broadcastMatchUpdate(populated);

    res.json({
      success: true,
      message: 'Matchday Starting XI submitted and locked!',
      data: populated
    });
  } catch (err) {
    console.error('[Submit Lineup Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. One-tap Follow / Unfollow Team
router.post('/:id/follow', async (req, res) => {
  try {
    const { follow = true } = req.body;
    const increment = follow ? 1 : -1;
    const team = await Team.findByIdAndUpdate(
      req.params.id,
      { $inc: { followersCount: increment } },
      { new: true }
    );
    res.json({ success: true, followersCount: Math.max(0, team.followersCount) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

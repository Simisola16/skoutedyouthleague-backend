const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Player = require('../models/Player');
const Fixture = require('../models/Fixture');
const User = require('../models/User');
const LeagueSettings = require('../models/LeagueSettings');
const MediaItem = require('../models/MediaItem');
const EmailService = require('../services/emailService');
const LeagueService = require('../services/leagueService');
const { broadcastLeagueSettingsUpdate } = require('../services/socketService');
const { requireAdmin } = require('../middleware/authMiddleware');
const { upload, galleryUpload, cloudinary, deleteFromGridFS } = require('../services/cloudinary');

// All routes in this router require role: "admin"
router.use(requireAdmin);

// 1. GET /api/admin/teams
// Directory of all teams with search, group filter, status filter, squad count, and lineup status
router.get('/teams', async (req, res) => {
  try {
    const { search, group, status, verificationStatus } = req.query;
    const filter = {};

    if (group && group !== 'All') {
      filter.group = group;
    }

    if (verificationStatus && verificationStatus !== 'All') {
      filter.verificationStatus = verificationStatus.toLowerCase();
    } else if (status && status !== 'All') {
      if (['pending', 'approved', 'rejected'].includes(status.toLowerCase())) {
        filter.verificationStatus = status.toLowerCase();
      } else {
        filter.status = status;
      }
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { shortCode: { $regex: search, $options: 'i' } }
      ];
    }

    const teams = await Team.find(filter).sort({ name: 1 });

    // Enhance each team with squad count, manager user verification status, and upcoming lineup status
    const teamsWithDetails = await Promise.all(
      teams.map(async (t) => {
        const squadCount = await Player.countDocuments({ team: t._id });
        
        // Find associated manager user account
        let managerUser = null;
        if (t.manager) {
          managerUser = await User.findById(t.manager).select('name email phone isVerified role');
        } else if (t.managerEmail) {
          managerUser = await User.findOne({ email: t.managerEmail.toLowerCase().trim() }).select('name email phone isVerified role');
        } else {
          managerUser = await User.findOne({ team: t._id }).select('name email phone isVerified role');
        }

        const verificationStatusResolved = t.verificationStatus || (t.status === 'Verified' ? 'approved' : 'pending');
        const isVerified = verificationStatusResolved === 'approved' && (managerUser ? managerUser.isVerified : true);

        // Find next upcoming fixture for this team
        const nextFixture = await Fixture.findOne({
          $or: [{ homeTeam: t._id }, { awayTeam: t._id }],
          status: { $in: ['UPCOMING', '1ST HALF', 'HT', '2ND HALF'] }
        }).sort({ date: 1, time: 1 });

        let lineupStatus = 'No Match';
        let pendingFixtureId = null;

        if (nextFixture) {
          const isHome = nextFixture.homeTeam.toString() === t._id.toString();
          const lineup = isHome ? nextFixture.homeLineup : nextFixture.awayLineup;
          
          if (lineup?.isLocked) {
            lineupStatus = 'Lineup Locked';
          } else {
            lineupStatus = 'Pending Lineup';
            pendingFixtureId = nextFixture._id;
          }
        }

        return {
          ...t.toObject(),
          verificationStatus: verificationStatusResolved,
          verifiedAt: t.verifiedAt,
          verifiedBy: t.verifiedBy,
          rejectionReason: t.rejectionReason || '',
          squadCount,
          lineupStatus,
          pendingFixtureId,
          nextFixture,
          managerUser: managerUser ? {
            _id: managerUser._id,
            name: managerUser.name,
            email: managerUser.email,
            phone: managerUser.phone,
            isVerified: managerUser.isVerified,
            role: managerUser.role
          } : null,
          isVerified
        };
      })
    );

    res.json({ success: true, data: teamsWithDetails });
  } catch (err) {
    console.error('[Admin Get Teams Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/admin/teams/:id/players
// Full squad list for specific team
router.get('/teams/:id/players', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const players = await Player.find({ team: team._id }).sort({ jerseyNumber: 1 });

    res.json({
      success: true,
      data: {
        team,
        players
      }
    });
  } catch (err) {
    console.error('[Admin Get Squad Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PATCH /api/admin/players/:id
// Correct player info, upload photo, or toggle eligibility/suspension
router.patch('/players/:id', upload.single('photo'), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      roles,
      role,
      status,
      isEligible,
      suspensionReason,
      age,
      dateOfBirth,
      preferredFoot,
      heightCm,
      weightKg,
      nationality
    } = req.body;

    const player = await Player.findById(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    // Check jersey number collision within same team if changing
    if (jerseyNumber !== undefined && Number(jerseyNumber) !== player.jerseyNumber) {
      const duplicate = await Player.findOne({
        team: player.team,
        jerseyNumber: Number(jerseyNumber),
        _id: { $ne: player._id }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: `Jersey #${jerseyNumber} is already taken by ${duplicate.firstName} ${duplicate.lastName}`
        });
      }
      player.jerseyNumber = Number(jerseyNumber);
    }

    if (firstName) player.firstName = firstName.trim();
    if (lastName) player.lastName = lastName.trim();
    if (position) player.position = position.trim();
    if (subPosition !== undefined) player.subPosition = subPosition.trim();
    if (role) player.role = role;
    if (roles) {
      if (Array.isArray(roles)) player.roles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          player.roles = Array.isArray(parsed) ? parsed : roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          player.roles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    }
    if (status) player.status = status;
    if (isEligible !== undefined) player.isEligible = Boolean(isEligible);
    if (suspensionReason !== undefined) player.suspensionReason = suspensionReason;
    if (age !== undefined) player.age = Number(age);
    if (dateOfBirth) player.dateOfBirth = new Date(dateOfBirth);
    if (preferredFoot) player.preferredFoot = preferredFoot;
    if (heightCm !== undefined) player.heightCm = heightCm ? Number(heightCm) : null;
    if (weightKg !== undefined) player.weightKg = weightKg ? Number(weightKg) : null;
    if (nationality) player.nationality = nationality.trim();

    if (req.file) {
      player.photo = req.file.path;
      player.photoUrl = req.file.path;
    } else if (req.body.photoUrl) {
      player.photo = req.body.photoUrl;
      player.photoUrl = req.body.photoUrl;
    }

    await player.save();

    res.json({
      success: true,
      message: 'Player record updated successfully',
      data: player
    });
  } catch (err) {
    console.error('[Admin Update Player Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3B. POST /api/admin/teams/:teamId/players - Admin Add Player to Team
router.post('/teams/:teamId/players', upload.single('photo'), async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });

    const {
      firstName,
      lastName,
      jerseyNumber,
      position,
      subPosition,
      roles,
      role,
      preferredFoot,
      heightCm,
      weightKg,
      nationality,
      dateOfBirth,
      age
    } = req.body;

    if (!firstName || !lastName || !jerseyNumber || !position) {
      return res.status(400).json({ success: false, error: 'First name, last name, jersey number, and position are required' });
    }

    const parsedNumber = Number(jerseyNumber);
    const duplicate = await Player.findOne({ team: teamId, jerseyNumber: parsedNumber });
    if (duplicate) {
      return res.status(400).json({ success: false, error: `Jersey #${parsedNumber} is already registered on this squad` });
    }

    const photoUrl = req.file ? req.file.path : (req.body.photoUrl || req.body.photo || '');
    let parsedRoles = ['Regular Squad Player'];
    if (roles) {
      if (Array.isArray(roles)) parsedRoles = roles;
      else if (typeof roles === 'string') {
        try {
          const parsed = JSON.parse(roles);
          parsedRoles = Array.isArray(parsed) ? parsed : roles.split(',').map(r => r.trim()).filter(Boolean);
        } catch {
          parsedRoles = roles.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    } else if (role) {
      parsedRoles = [role];
    }

    const newPlayer = new Player({
      team: teamId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jerseyNumber: parsedNumber,
      position: position.trim(),
      subPosition: subPosition ? subPosition.trim() : '',
      preferredFoot: preferredFoot || 'Right',
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      nationality: nationality ? nationality.trim() : 'Nigeria',
      age: Number(age) || 18,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      roles: parsedRoles,
      role: role || (parsedRoles.includes('Captain') ? 'Captain' : parsedRoles[0]),
      photo: photoUrl,
      photoUrl: photoUrl,
      status: 'Eligible',
      isEligible: true
    });

    await newPlayer.save();
    res.status(201).json({ success: true, message: 'Player registered successfully', data: newPlayer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/admin/fixtures/:id/remind-lineup
// Manually dispatch Starting XI urgent reminder email to team manager(s)
router.post('/fixtures/:id/remind-lineup', async (req, res) => {
  try {
    const fixture = await Fixture.findById(req.params.id).populate('homeTeam awayTeam');
    if (!fixture) {
      return res.status(404).json({ success: false, error: 'Fixture not found' });
    }

    const { teamId } = req.body; // optional: target specific team or both

    let sentCount = 0;
    const errors = [];

    // Check Home Team
    if (!teamId || teamId.toString() === fixture.homeTeam?._id.toString()) {
      let homeManagerEmail = fixture.homeTeam?.managerEmail;
      if (!homeManagerEmail && fixture.homeTeam?._id) {
        const mgr = await User.findOne({ team: fixture.homeTeam._id });
        if (mgr) homeManagerEmail = mgr.email;
      }

      if (homeManagerEmail && !fixture.homeLineup?.isLocked) {
        try {
          await EmailService.sendLineupUrgentReminder({
            managerEmail: homeManagerEmail,
            teamName: fixture.homeTeam.name,
            opponentName: fixture.awayTeam?.name,
            date: fixture.date,
            time: fixture.time,
            venue: fixture.venue,
            fixtureId: fixture._id
          });
          sentCount++;
        } catch (e) {
          errors.push(`Home manager email error: ${e.message}`);
        }
      }
    }

    // Check Away Team
    if (!teamId || teamId.toString() === fixture.awayTeam?._id.toString()) {
      let awayManagerEmail = fixture.awayTeam?.managerEmail;
      if (!awayManagerEmail && fixture.awayTeam?._id) {
        const mgr = await User.findOne({ team: fixture.awayTeam._id });
        if (mgr) awayManagerEmail = mgr.email;
      }

      if (awayManagerEmail && !fixture.awayLineup?.isLocked) {
        try {
          await EmailService.sendLineupUrgentReminder({
            managerEmail: awayManagerEmail,
            teamName: fixture.awayTeam.name,
            opponentName: fixture.homeTeam?.name,
            date: fixture.date,
            time: fixture.time,
            venue: fixture.venue,
            fixtureId: fixture._id
          });
          sentCount++;
        } catch (e) {
          errors.push(`Away manager email error: ${e.message}`);
        }
      }
    }

    res.json({
      success: true,
      message: `Lineup reminder email sent to ${sentCount} team manager(s).`,
      sentCount,
      errors
    });
  } catch (err) {
    console.error('[Admin Lineup Reminder Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/admin/teams/:id/approve - Approve Team & Dispatch Resend Email
router.post('/teams/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    team.verificationStatus = 'approved';
    team.status = 'Verified';
    team.verifiedAt = new Date();
    team.verifiedBy = req.user?.id || null;
    team.rejectionReason = '';
    await team.save();

    // Query for manager user(s) associated with this team to verify them
    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }

    const updatedUsers = await User.updateMany(
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

    let managerUser = null;
    if (team.manager) {
      managerUser = await User.findById(team.manager);
    }
    if (!managerUser && userQueries.length > 0) {
      managerUser = await User.findOne({ $or: userQueries });
      if (managerUser) {
        team.manager = managerUser._id;
        await team.save();
      }
    }

    const managerEmail = managerUser?.email || team.managerEmail;
    const managerName = managerUser?.name || team.managerName || 'Team Manager';

    // Dispatch automated approval email via Resend
    let emailResult = { success: false };
    if (managerEmail) {
      emailResult = await EmailService.sendTeamApprovalEmail({
        managerEmail,
        managerName,
        teamName: team.name
      });
    }

    const updatedTeam = await Team.findById(id);

    res.json({
      success: true,
      message: `Team "${team.name}" has been approved! Manager has been notified via email.`,
      data: {
        team: updatedTeam,
        emailSent: emailResult.success
      }
    });
  } catch (err) {
    console.error('[Admin Approve Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/admin/teams/:id/reject - Reject Team with Reason & Dispatch Resend Email
router.post('/teams/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const reason = rejectionReason ? rejectionReason.trim() : 'Registration details did not meet the competition guidelines or required verification criteria.';

    team.verificationStatus = 'rejected';
    team.status = 'Pending Verification';
    team.rejectionReason = reason;
    team.verifiedAt = null;
    team.verifiedBy = null;
    await team.save();

    // Query for manager email
    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }

    const managerUser = await User.findOne({ $or: userQueries });
    const managerEmail = managerUser?.email || team.managerEmail;
    const managerName = managerUser?.name || team.managerName || 'Team Manager';

    let emailResult = { success: false };
    if (managerEmail) {
      emailResult = await EmailService.sendTeamRejectionEmail({
        managerEmail,
        managerName,
        teamName: team.name,
        rejectionReason: reason
      });
    }

    const updatedTeam = await Team.findById(id);

    res.json({
      success: true,
      message: `Team "${team.name}" registration marked as rejected. Notice email dispatched to manager.`,
      data: {
        team: updatedTeam,
        emailSent: emailResult.success
      }
    });
  } catch (err) {
    console.error('[Admin Reject Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. POST /api/admin/teams/:id/revoke - Revoke / Return Team to Pending Verification
router.post('/teams/:id/revoke', async (req, res) => {
  try {
    const { id } = req.params;
    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    team.verificationStatus = 'pending';
    team.status = 'Pending Verification';
    team.verifiedAt = null;
    team.verifiedBy = null;
    team.rejectionReason = '';
    await team.save();

    res.json({
      success: true,
      message: `Team "${team.name}" approval revoked and returned to pending review.`,
      data: { team }
    });
  } catch (err) {
    console.error('[Admin Revoke Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. POST /api/admin/teams/:id/verify (Legacy direct verify compatibility)
router.post('/teams/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { status = 'Verified' } = req.body;

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const isApproved = status === 'Verified' || status === 'approved';
    team.status = isApproved ? 'Verified' : status === 'Suspended' ? 'Suspended' : 'Pending Verification';
    team.verificationStatus = isApproved ? 'approved' : status === 'rejected' ? 'rejected' : 'pending';
    if (isApproved) {
      team.verifiedAt = new Date();
      team.verifiedBy = req.user?.id || null;
      team.rejectionReason = '';
    } else {
      team.verifiedAt = null;
      team.verifiedBy = null;
    }
    await team.save();

    const isVerifiedBool = isApproved;

    // Query for manager user(s) associated with this team
    const userQueries = [];
    if (team.manager) userQueries.push({ _id: team.manager });
    userQueries.push({ team: team._id });
    if (team.managerEmail) {
      userQueries.push({ email: team.managerEmail.toLowerCase().trim() });
    }

    const updatedUsers = await User.updateMany(
      { $or: userQueries },
      {
        $set: {
          isVerified: isVerifiedBool,
          verificationOtp: null,
          otpExpiresAt: null,
          team: team._id
        }
      }
    );

    // If team.manager was not set, link it to the matching user
    if (!team.manager) {
      const foundUser = await User.findOne({ $or: userQueries });
      if (foundUser) {
        team.manager = foundUser._id;
        await team.save();
      }
    }

    const updatedTeam = await Team.findById(id);

    res.json({
      success: true,
      message: isVerifiedBool
        ? `Team "${team.name}" and manager account successfully verified! The manager can now login directly and register squad players.`
        : `Team "${team.name}" status updated to "${status}".`,
      data: {
        team: updatedTeam,
        isVerified: isVerifiedBool,
        usersUpdated: updatedUsers.modifiedCount
      }
    });
  } catch (err) {
    console.error('[Admin Verify Team Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/teams/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, verificationStatus } = req.body;

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    if (verificationStatus) {
      team.verificationStatus = verificationStatus;
      if (verificationStatus === 'approved') {
        team.status = 'Verified';
        team.verifiedAt = new Date();
        team.verifiedBy = req.user?.id || null;
      } else if (verificationStatus === 'rejected') {
        team.status = 'Pending Verification';
        team.verifiedAt = null;
        team.verifiedBy = null;
      } else {
        team.status = 'Pending Verification';
        team.verifiedAt = null;
        team.verifiedBy = null;
      }
    } else if (status) {
      team.status = status;
      if (status === 'Verified') {
        team.verificationStatus = 'approved';
        team.verifiedAt = new Date();
        team.verifiedBy = req.user?.id || null;
      } else {
        team.verificationStatus = 'pending';
        team.verifiedAt = null;
        team.verifiedBy = null;
      }
    }

    await team.save();

    const isVerifiedBool = team.verificationStatus === 'approved';

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
          isVerified: isVerifiedBool,
          verificationOtp: null,
          otpExpiresAt: null,
          team: team._id
        }
      }
    );

    res.json({
      success: true,
      message: `Team "${team.name}" status updated to "${team.verificationStatus}".`,
      data: {
        team,
        isVerified: isVerifiedBool
      }
    });
  } catch (err) {
    console.error('[Admin Update Team Status Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. GET /api/admin/settings - Retrieve Current Competition & Transfer Window Settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await LeagueSettings.getSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. PATCH /api/admin/settings - Update Transfer Window, Registration Lock & League Parameters
router.patch('/settings', async (req, res) => {
  try {
    const {
      transferWindowStatus,
      registrationLocked,
      seasonPhase,
      maxSquadSize,
      transferWindowClosesAt,
      initialRegistrationClosesAt,
      seasonKickoffDate,
      broadcastNotice,
      aboutImageUrl,
      aboutImageCaption
    } = req.body;

    const settings = await LeagueSettings.getSettings();
    const previousStatus = settings.transferWindowStatus;

    if (transferWindowStatus !== undefined) {
      settings.transferWindowStatus = transferWindowStatus;
      if (transferWindowStatus === 'open') {
        settings.registrationLocked = false;
        settings.transferWindowOpenedAt = new Date();
      }
    }

    if (registrationLocked !== undefined) {
      settings.registrationLocked = Boolean(registrationLocked);
    }

    if (seasonPhase !== undefined) {
      settings.seasonPhase = seasonPhase;
    }

    if (maxSquadSize !== undefined && !isNaN(Number(maxSquadSize))) {
      settings.maxSquadSize = Number(maxSquadSize);
    }

    if (transferWindowClosesAt !== undefined) {
      settings.transferWindowClosesAt = transferWindowClosesAt ? new Date(transferWindowClosesAt) : null;
    }

    if (initialRegistrationClosesAt !== undefined) {
      settings.initialRegistrationClosesAt = initialRegistrationClosesAt ? new Date(initialRegistrationClosesAt) : null;
    }

    if (seasonKickoffDate !== undefined) {
      settings.seasonKickoffDate = seasonKickoffDate ? new Date(seasonKickoffDate) : null;
    }

    if (aboutImageUrl !== undefined) {
      settings.aboutImageUrl = aboutImageUrl.trim();
    }

    if (aboutImageCaption !== undefined) {
      settings.aboutImageCaption = aboutImageCaption.trim();
    }

    settings.lastUpdatedBy = req.user?.id || null;
    await settings.save();

    broadcastLeagueSettingsUpdate(settings);

    // If transfer window opened and broadcast was requested (or status changed to open)
    let emailNoticeResult = null;
    if (settings.transferWindowStatus === 'open' && (broadcastNotice || previousStatus !== 'open')) {
      emailNoticeResult = await LeagueService.broadcastTransferWindowAnnouncement(settings);
    }

    res.json({
      success: true,
      message: `League settings updated successfully.${emailNoticeResult ? ` Broadcast email sent to ${emailNoticeResult.count} clubs.` : ''}`,
      data: settings,
      emailNoticeResult
    });
  } catch (err) {
    console.error('[Admin Update Settings Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. POST /api/admin/settings/broadcast-transfer-window - Broadcast Transfer Window Notice
router.post('/settings/broadcast-transfer-window', async (req, res) => {
  try {
    const settings = await LeagueSettings.getSettings();
    const result = await LeagueService.broadcastTransferWindowAnnouncement(settings);
    res.json({
      success: true,
      message: `Transfer window announcement email successfully dispatched to ${result.count || 0} club managers.`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8b. POST /api/admin/about-image - Dedicated Cloudinary Uploader & Updater for About Section Showcase Image
router.post('/about-image', (req, res) => {
  galleryUpload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('[Cloudinary About Image Upload Error]:', uploadErr);
      return res.status(400).json({ success: false, error: uploadErr.message });
    }

    try {
      const { imageUrl, caption } = req.body;
      let finalUrl = '';

      if (req.file) {
        finalUrl = req.file.path || req.file.secure_url;
      } else if (imageUrl) {
        finalUrl = imageUrl.trim();
      }

      if (!finalUrl) {
        return res.status(400).json({ success: false, error: 'No image file or URL provided.' });
      }

      const settings = await LeagueSettings.getSettings();
      settings.aboutImageUrl = finalUrl;
      if (caption !== undefined && caption !== null) {
        settings.aboutImageCaption = caption.trim();
      }
      settings.lastUpdatedBy = req.user?.id || null;
      await settings.save();

      // Emit realtime socket event to update Homepage, About page, and all dashboards instantly
      broadcastLeagueSettingsUpdate(settings);

      return res.json({
        success: true,
        message: 'About section image updated successfully.',
        data: {
          aboutImageUrl: settings.aboutImageUrl,
          aboutImageCaption: settings.aboutImageCaption,
          settings
        }
      });
    } catch (err) {
      console.error('[Admin Update About Image Error]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// ============================================================================
// 9. REAL-TIME STATS OVERVIEW FOR ADMIN DASHBOARD
// GET /api/admin/stats/overview
// ============================================================================
router.get('/stats/overview', async (req, res) => {
  try {
    const [
      totalTeams,
      pendingApprovals,
      approvedTeams,
      totalPlayers,
      totalFixtures,
      activeFixtures,
      totalMedia
    ] = await Promise.all([
      Team.countDocuments(),
      Team.countDocuments({ verificationStatus: 'pending' }),
      Team.countDocuments({ verificationStatus: 'approved' }),
      Player.countDocuments(),
      Fixture.countDocuments(),
      Fixture.countDocuments({ status: { $in: ['1ST HALF', '2ND HALF', 'HT', 'PENS', 'UPCOMING'] } }),
      MediaItem.countDocuments()
    ]);

    res.json({
      success: true,
      data: {
        totalTeams,
        pendingApprovals,
        approvedTeams,
        totalPlayers,
        totalFixtures,
        activeFixtures,
        totalMedia
      }
    });
  } catch (err) {
    console.error('[Admin Stats Overview Error]:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve admin stats overview' });
  }
});

// GET /api/admin/email-quota - View Resend dual-key quota & failover rotation status
router.get('/email-quota', async (req, res) => {
  try {
    const quota = await EmailService.getQuotaStatus();
    res.json({ success: true, quota });
  } catch (err) {
    console.error('[Admin Email Quota Error]:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve email quota status' });
  }
});

// ============================================================================
// 10. CENTRALIZED ADMIN MEDIA & GALLERY MANAGEMENT
// ============================================================================

// GET /api/admin/media - Retrieve all media items with filtering and metrics
router.get('/media', async (req, res) => {
  try {
    const { category, search, status, limit = 50, page = 1 } = req.query;
    const filter = {};

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (status === 'published') {
      filter.isPublished = true;
    } else if (status === 'draft') {
      filter.isPublished = false;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { caption: { $regex: search, $options: 'i' } },
        { matchTag: { $regex: search, $options: 'i' } }
      ];
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [items, total, totalPublished, totalDraft] = await Promise.all([
      MediaItem.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      MediaItem.countDocuments(filter),
      MediaItem.countDocuments({ isPublished: true }),
      MediaItem.countDocuments({ isPublished: false })
    ]);

    res.json({
      success: true,
      data: items,
      summary: {
        total,
        totalPublished,
        totalDraft
      },
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (err) {
    console.error('[Admin Get Media Error]:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch media assets' });
  }
});

// POST /api/admin/media - Multi-file upload or manual entry directly to Cloudinary
router.post('/media', (req, res) => {
  galleryUpload.array('images', 20)(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('[Cloudinary Upload Error]:', uploadErr);
      return res.status(400).json({ success: false, error: uploadErr.message });
    }

    try {
      const {
        title = '',
        caption = '',
        category = 'Matchday Action',
        matchTag = '',
        tags = '',
        isPublished = true,
        directUrl = ''
      } = req.body;

      const parsedTags = typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : Array.isArray(tags) ? tags : [];

      const booleanPublished = String(isPublished) === 'true' || isPublished === true;

      // Case A: Files uploaded through multer-storage-cloudinary
      if (req.files && req.files.length > 0) {
        const createdItems = await Promise.all(
          req.files.map(async (file, idx) => {
            const itemTitle = req.files.length > 1 && title
              ? `${title} (${idx + 1})`
              : (title || file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));

            return await MediaItem.create({
              title: itemTitle,
              caption: caption || '',
              category: category || 'Matchday Action',
              url: file.path || file.secure_url,
              publicId: file.filename || file.publicId || '',
              fileId: file.fileId || (file.id ? file.id : null),
              storageType: file.storage || 'gridfs',
              matchTag: matchTag || '',
              tags: parsedTags,
              isPublished: booleanPublished,
              uploadedBy: req.user?.id || null
            });
          })
        );

        return res.status(201).json({
          success: true,
          message: `Successfully uploaded ${createdItems.length} media item(s).`,
          data: createdItems
        });
      }

      // Case B: Direct URL provided
      if (directUrl || req.body.url) {
        const targetUrl = directUrl || req.body.url;
        const newItem = await MediaItem.create({
          title: title || 'Media Asset',
          caption: caption || '',
          category: category || 'Matchday Action',
          url: targetUrl,
          publicId: req.body.publicId || '',
          matchTag: matchTag || '',
          tags: parsedTags,
          isPublished: booleanPublished,
          uploadedBy: req.user?.id || null
        });

        return res.status(201).json({
          success: true,
          message: 'Media asset registered successfully.',
          data: newItem
        });
      }

      return res.status(400).json({
        success: false,
        error: 'No files or image URL provided.'
      });
    } catch (err) {
      console.error('[Admin Create Media Error]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// PATCH /api/admin/media/:id - Edit media metadata
router.patch('/media/:id', async (req, res) => {
  try {
    const { title, caption, category, matchTag, tags, isPublished } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title.trim();
    if (caption !== undefined) updateData.caption = caption.trim();
    if (category !== undefined) updateData.category = category;
    if (matchTag !== undefined) updateData.matchTag = matchTag.trim();
    if (tags !== undefined) {
      updateData.tags = typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : Array.isArray(tags) ? tags : [];
    }
    if (isPublished !== undefined) {
      updateData.isPublished = Boolean(isPublished);
    }

    const updated = await MediaItem.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Media asset not found' });
    }

    res.json({
      success: true,
      message: 'Media asset updated successfully.',
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/media/:id/toggle-publish - Toggle visibility
router.patch('/media/:id/toggle-publish', async (req, res) => {
  try {
    const item = await MediaItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Media asset not found' });
    }

    item.isPublished = !item.isPublished;
    await item.save();

    res.json({
      success: true,
      message: `Media asset marked as ${item.isPublished ? 'Published' : 'Draft'}.`,
      data: item
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/media/:id - Delete single media item
router.delete('/media/:id', async (req, res) => {
  try {
    const item = await MediaItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Media asset not found' });
    }

    // Attempt GridFS or Cloudinary cleanup
    if (item.fileId || (item.publicId && item.publicId.match(/^[0-9a-fA-F]{24}$/))) {
      await deleteFromGridFS(item.fileId || item.publicId);
    } else if (item.publicId) {
      try {
        await cloudinary.uploader.destroy(item.publicId);
      } catch (cErr) {
        console.warn('[Cloudinary Delete Notice]:', cErr.message);
      }
    }

    await MediaItem.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Media asset deleted successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/media/bulk-delete - Delete multiple media items
router.post('/media/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of item IDs required' });
    }

    const items = await MediaItem.find({ _id: { $in: ids } });
    for (const item of items) {
      if (item.fileId || (item.publicId && item.publicId.match(/^[0-9a-fA-F]{24}$/))) {
        await deleteFromGridFS(item.fileId || item.publicId);
      } else if (item.publicId) {
        try {
          await cloudinary.uploader.destroy(item.publicId);
        } catch (e) {
          // continue
        }
      }
    }

    await MediaItem.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: `Successfully deleted ${items.length} media item(s).`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


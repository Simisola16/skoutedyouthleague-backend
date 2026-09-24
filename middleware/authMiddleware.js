const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'skouted_league_super_secret_jwt_key_2026';

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ success: false, error: 'Forbidden: Admin access clearance required' });
    }
  });
}

function requireOfficialOrAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'official')) {
      next();
    } else {
      res.status(403).json({ success: false, error: 'Forbidden: Official match operator clearance required' });
    }
  });
}

// Ensure user is an authenticated team manager with an assigned team
async function requireTeamManager(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const User = require('../models/User');
      const Team = require('../models/Team');

      const user = await User.findById(req.user.id).populate('team');
      if (!user) {
        return res.status(401).json({ success: false, error: 'User account not found' });
      }

      const isManagerRole = ['manager', 'team', 'team_manager', 'admin'].includes(user.role);
      if (!isManagerRole) {
        return res.status(403).json({ success: false, error: 'Forbidden: Team manager clearance required' });
      }

      let team = user.team;
      if (!team) {
        team = await Team.findOne({ manager: user._id });
      }

      if (!team) {
        return res.status(403).json({
          success: false,
          error: 'No registered football academy or team is currently linked to your manager account.'
        });
      }

      req.team = team;
      req.teamId = team._id;
      req.teamUser = user;
      next();
    } catch (err) {
      console.error('[requireTeamManager Error]:', err);
      res.status(500).json({ success: false, error: 'Authorization error: ' + err.message });
    }
  });
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireOfficialOrAdmin,
  requireTeamManager
};

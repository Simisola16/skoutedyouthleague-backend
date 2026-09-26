const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const { initSocket } = require('./services/socketService');
const { startScheduler } = require('./services/scheduler');

// Route Handlers
const authRoutes = require('./routes/authRoutes');
const teamRoutes = require('./routes/teamRoutes');
const fixtureRoutes = require('./routes/fixtureRoutes');
const playerRoutes = require('./routes/playerRoutes');
const statsRoutes = require('./routes/statsRoutes');
const fanRoutes = require('./routes/fanRoutes');
const adminRoutes = require('./routes/adminRoutes');
const teamManagerRoutes = require('./routes/teamManagerRoutes');
const leagueRoutes = require('./routes/leagueRoutes');
const newsRoutes = require('./routes/newsRoutes');
const podcastRoutes = require('./routes/podcastRoutes');
const sponsorRoutes = require('./routes/sponsorRoutes');
const galleryRoutes = require('./routes/galleryRoutes');
const mediaRoutes = require('./routes/mediaRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});
initSocket(io);

// Middleware
const allowedOrigins = [
  'https://skoutedyouthleague.vercel.app',
  'http://localhost:5055',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/team', teamManagerRoutes);
app.use('/api/fixtures', fixtureRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/fans', fanRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/league', leagueRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/podcasts', podcastRoutes);
app.use('/api/sponsors', sponsorRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/uploads', mediaRoutes);
app.use('/uploads', mediaRoutes);

// Public Settings & Site Content Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const LeagueSettings = require('./models/LeagueSettings');
    const settings = await LeagueSettings.getSettings();
    res.json({
      success: true,
      data: {
        competitionName: settings.competitionName,
        maxSquadSize: settings.maxSquadSize || 35,
        transferWindowStatus: settings.transferWindowStatus || 'closed',
        registrationLocked: settings.registrationLocked || false,
        seasonPhase: settings.seasonPhase || 'pre_season',
        aboutImageUrl: settings.aboutImageUrl || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80',
        aboutImageCaption: settings.aboutImageCaption || 'Youth talent competing in the Skouted Youth League Championship'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/content/about', async (req, res) => {
  try {
    const LeagueSettings = require('./models/LeagueSettings');
    const settings = await LeagueSettings.getSettings();
    res.json({
      success: true,
      data: {
        aboutImageUrl: settings.aboutImageUrl || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80',
        aboutImageCaption: settings.aboutImageCaption || 'Youth talent competing in the Skouted Youth League Championship'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Skouted League Production API',
    time: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Serve frontend static files from client/dist if present
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// SPA catch-all route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  const indexFile = path.join(clientDistPath, 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Skouted League API</title></head>
        <body style="background:#0D0F14;color:#FFF;font-family:sans-serif;text-align:center;padding:50px;">
          <h1>⚡ Skouted League Realtime API Server</h1>
          <p>Server running on port 5055. Client build is compiling.</p>
        </body>
        </html>
      `);
    }
  });
});

const PORT = process.env.PORT || 5055;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required.');
  process.exit(1);
}

// Connect to MongoDB and start listening
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('=================================================');
    console.log('✅ Connected to MongoDB Atlas: skoutedLeague');
    server.listen(PORT, () => {
      console.log(`⚽ SKOUTED LEAGUE SERVER ACTIVE ON PORT ${PORT}`);
      console.log(`🔗 Web Application: http://localhost:${PORT}/`);
      console.log(`🔗 Health Status:   http://localhost:${PORT}/api/health`);
      console.log('=================================================');
      // Start background cron job
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

# Skouted Youth League — Backend API & Real-time Server

Production-ready backend API and live match event broadcasting server for the Skouted Youth League football tournament platform.

## Architecture & Features
- **RESTful API**: Node.js & Express powering fixtures, team rosters, lineups, statistics, and tournament administration.
- **Real-Time Live Engine**: Zero-latency live scores, event ticker, and status sync powered by Socket.io.
- **Database**: MongoDB with Mongoose (indexes for live match day queries, standings, and player statistics).
- **Media Storage**: Cloudinary integration for team crests and official player accreditation photos.
- **Automated Scheduling**: Node-cron background task running every 5 minutes to detect upcoming matches and dispatch automated Starting XI reminders to managers 3 hours before kickoff.
- **Email Service**: Resend SDK transactional email notifications for team verification, match scheduling, and lineup deadlines.

## Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Server listening port (default: `5055`) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret key for JWT authentication |
| `CLOUDINARY_*` | Cloudinary credentials for media upload |
| `RESEND_API_KEY` | Resend API key for email delivery |
| `EMAIL_FROM` | Verified sender address for tournament emails |

## Getting Started

### Installation
```bash
npm install
```

### Run Server
```bash
node index.js
```
Or with development watcher:
```bash
npm run dev
```

### Health Check
```
GET /api/health
```

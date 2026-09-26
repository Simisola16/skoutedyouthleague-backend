const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const EmailService = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'skouted_league_super_secret_jwt_key_2026';

async function main() {
  console.log('Sending test team registration notification to maroophadek@gmail.com...');

  const mockTeam = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Skouted All-Stars FC',
    shortCode: 'SAS',
    homeGround: 'Lekan Salami Stadium, Adamasingba, Ibadan',
    managerName: 'Coach Adeyemi Babatunde',
    managerEmail: 'adeyemi.coach@gmail.com',
    managerPhone: '+234 803 123 4567',
    homeKitColor: '#00E676',
    awayKitColor: '#3B82F6',
    createdAt: new Date(),
    logo: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=400&q=80'
  };

  const tokenPayload = {
    teamId: mockTeam._id.toString(),
    teamName: mockTeam.name,
    action: 'approve',
    email: 'maroophadek@gmail.com'
  };

  const approvalToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '60d' });
  const rejectionToken = jwt.sign({ ...tokenPayload, action: 'reject' }, JWT_SECRET, { expiresIn: '60d' });

  const serverBaseUrl = process.env.SERVER_BASE_URL || 'https://api.skoutedyouthleague.com';
  const approveUrl = `${serverBaseUrl}/api/teams/action/approve?token=${encodeURIComponent(approvalToken)}`;
  const rejectUrl = `${serverBaseUrl}/api/teams/action/reject?token=${encodeURIComponent(rejectionToken)}`;
  const adminPortalUrl = 'https://skoutedyouthleague.vercel.app/admin';

  const res = await EmailService.sendNewTeamRegistrationAlert({
    recipientEmail: 'maroophadek@gmail.com',
    team: mockTeam,
    approveUrl,
    rejectUrl,
    adminPortalUrl
  });

  console.log('\nDispatch Result:', res);
  process.exit(res.success ? 0 : 1);
}

main().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});

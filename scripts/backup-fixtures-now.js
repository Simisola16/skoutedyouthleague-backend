require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Fixture = require('../models/Fixture');

async function backupFixtures() {
  await mongoose.connect(process.env.MONGODB_URI);
  const fixtures = await Fixture.find().lean();
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const filename = path.join(backupDir, `fixtures-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(filename, JSON.stringify(fixtures, null, 2));
  console.log(`Backed up ${fixtures.length} fixtures to ${filename}`);
  await mongoose.disconnect();
}

backupFixtures().catch(console.error);

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in server/.env');
  process.exit(1);
}

async function backup() {
  console.log('🔄 Connecting to MongoDB Atlas...');
  
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000
  });
  console.log('✅ Connected to MongoDB successfully.');

  const db = mongoose.connection.db;
  const backupDir = path.resolve(__dirname, '../backups/backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const collections = await db.listCollections().toArray();
  console.log(`\n📦 Found ${collections.length} collections. Starting export to: ${backupDir}`);

  const manifest = {
    timestamp: new Date().toISOString(),
    collections: {}
  };

  let totalDocs = 0;
  let totalBytes = 0;

  for (const coll of collections) {
    const collName = coll.name;
    // Skip system collections
    if (collName.startsWith('system.')) continue;

    const collection = db.collection(collName);
    const count = await collection.countDocuments();
    const docs = await collection.find({}).toArray();

    const filePath = path.join(backupDir, `${collName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');

    const size = fs.statSync(filePath).size;
    totalDocs += count;
    totalBytes += size;

    manifest.collections[collName] = {
      count,
      file: `${collName}.json`,
      sizeBytes: size
    };

    console.log(`  ✓ ${collName}: ${count} records (${(size / 1024).toFixed(1)} KB)`);
  }

  // Write manifest
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Also create a copy as 'latest' for easy restore
  const latestDir = path.resolve(__dirname, '../backups/latest');
  if (!fs.existsSync(latestDir)) {
    fs.mkdirSync(latestDir, { recursive: true });
  }
  for (const coll of collections) {
    if (coll.name.startsWith('system.')) continue;
    fs.copyFileSync(path.join(backupDir, `${coll.name}.json`), path.join(latestDir, `${coll.name}.json`));
  }
  fs.copyFileSync(path.join(backupDir, 'manifest.json'), path.join(latestDir, 'manifest.json'));

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log('\n======================================================');
  console.log(`🎉 BACKUP COMPLETE!`);
  console.log(`- Total Records: ${totalDocs}`);
  console.log(`- Total Size: ${totalMB} MB`);
  console.log(`- Fits in Free Tier (512MB)? ${parseFloat(totalMB) < 400 ? 'YES! Perfectly.' : 'No'}`);
  console.log(`- Saved at: ${backupDir}`);
  console.log(`- Latest link: ${latestDir}`);
  console.log('======================================================');

  await mongoose.disconnect();
}

backup().catch((err) => {
  console.error('❌ Backup encountered an error:', err.message);
  process.exit(1);
});

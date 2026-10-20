const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Target MongoDB URI to restore into (either from TARGET_MONGODB_URI or current MONGODB_URI)
const TARGET_URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI;

async function restore() {
  const backupDir = path.resolve(__dirname, '../backups/latest');

  if (!fs.existsSync(backupDir)) {
    console.error('❌ No backup found in server/backups/latest. Run backup-database.js first.');
    process.exit(1);
  }

  console.log('🔄 Connecting to target MongoDB to restore data...');
  console.log(`🎯 Target URI: ${TARGET_URI.replace(/:([^@]+)@/, ':****@')}`);

  await mongoose.connect(TARGET_URI, {
    serverSelectionTimeoutMS: 15000
  });
  console.log('✅ Connected to target MongoDB successfully.');

  const db = mongoose.connection.db;
  const manifestPath = path.join(backupDir, 'manifest.json');
  let filesToRestore = [];

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    filesToRestore = Object.keys(manifest.collections).map(name => ({
      collName: name,
      file: path.join(backupDir, manifest.collections[name].file)
    }));
  } else {
    filesToRestore = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.json') && f !== 'manifest.json')
      .map(f => ({
        collName: f.replace('.json', ''),
        file: path.join(backupDir, f)
      }));
  }

  console.log(`\n📦 Restoring ${filesToRestore.length} collections into target database...`);

  for (const item of filesToRestore) {
    if (!fs.existsSync(item.file)) continue;
    const rawData = fs.readFileSync(item.file, 'utf8');
    const docs = JSON.parse(rawData);

    if (docs.length === 0) {
      console.log(`  - ${item.collName}: 0 documents (skipped)`);
      continue;
    }

    const collection = db.collection(item.collName);
    
    // Clear existing documents in the collection
    await collection.deleteMany({});

    // Process BSON types (ObjectIds, Dates, and GridFS Binary Buffers)
    const restoredDocs = docs.map(doc => {
      const parsed = { ...doc };
      
      // Convert _id to ObjectId
      if (parsed._id && typeof parsed._id === 'string' && /^[0-9a-fA-F]{24}$/.test(parsed._id)) {
        parsed._id = new mongoose.Types.ObjectId(parsed._id);
      }

      // Convert GridFS files_id
      if (parsed.files_id && typeof parsed.files_id === 'string' && /^[0-9a-fA-F]{24}$/.test(parsed.files_id)) {
        parsed.files_id = new mongoose.Types.ObjectId(parsed.files_id);
      }

      // Convert GridFS binary data from Base64 string back to Buffer
      if (item.collName.includes('.chunks') && typeof parsed.data === 'string') {
        parsed.data = Buffer.from(parsed.data, 'base64');
      }

      // Convert dates if applicable
      if (parsed.uploadDate && typeof parsed.uploadDate === 'string') {
        parsed.uploadDate = new Date(parsed.uploadDate);
      }
      if (parsed.createdAt && typeof parsed.createdAt === 'string') {
        parsed.createdAt = new Date(parsed.createdAt);
      }
      if (parsed.updatedAt && typeof parsed.updatedAt === 'string') {
        parsed.updatedAt = new Date(parsed.updatedAt);
      }

      return parsed;
    });

    // Insert in batches if large
    const batchSize = 100;
    for (let i = 0; i < restoredDocs.length; i += batchSize) {
      const chunk = restoredDocs.slice(i, i + batchSize);
      await collection.insertMany(chunk);
    }
    console.log(`  ✓ Restored ${docs.length} documents into '${item.collName}'`);
  }

  console.log('\n======================================================');
  console.log('🎉 RESTORE COMPLETE: All records and media images are live in the target database!');
  console.log('======================================================');
  await mongoose.disconnect();
}

restore().catch((err) => {
  console.error('❌ Restore failed:', err);
  process.exit(1);
});

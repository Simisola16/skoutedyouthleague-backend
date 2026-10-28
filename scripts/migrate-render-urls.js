const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const OLD_URL = 'https://skoutedyouthleague-backend-1.onrender.com';
const OLD_URL_HTTP = 'http://skoutedyouthleague-backend-1.onrender.com';
const NEW_URL = 'https://api.skoutedyouthleague.com';

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not found');
    process.exit(1);
  }

  console.log('🔄 Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('✅ Connected.');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  let totalUpdatedDocs = 0;

  for (const collInfo of collections) {
    const collName = collInfo.name;
    if (collName.startsWith('system.')) continue;
    // Don't modify chunks binary
    if (collName.includes('.chunks')) continue;

    const coll = db.collection(collName);
    const cursor = coll.find({});

    let collUpdated = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      let docModified = false;

      // Recursive replace function
      function replaceUrls(obj) {
        if (!obj || typeof obj !== 'object') return;

        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'string') {
            if (obj[key].includes(OLD_URL)) {
              obj[key] = obj[key].replace(new RegExp(OLD_URL, 'g'), NEW_URL);
              docModified = true;
            } else if (obj[key].includes(OLD_URL_HTTP)) {
              obj[key] = obj[key].replace(new RegExp(OLD_URL_HTTP, 'g'), NEW_URL);
              docModified = true;
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            replaceUrls(obj[key]);
          }
        }
      }

      replaceUrls(doc);

      if (docModified) {
        const { _id, ...updateFields } = doc;
        await coll.replaceOne({ _id }, doc);
        collUpdated++;
        totalUpdatedDocs++;
      }
    }

    if (collUpdated > 0) {
      console.log(`  ✓ Updated ${collUpdated} documents in collection '${collName}'`);
    }
  }

  console.log(`\n🎉 MIGRATION COMPLETE! Total documents updated: ${totalUpdatedDocs}`);
  await mongoose.disconnect();
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});

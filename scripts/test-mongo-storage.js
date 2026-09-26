const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { Readable } = require('stream');
const { deleteFromGridFS } = require('../services/mongoStorage');

async function testGridFS() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected successfully!');

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: 'media_images'
  });

  // Test buffer
  const sampleData = Buffer.from('Test MongoDB Image Storage Payload 12345');
  console.log('Uploading test image to GridFS...');

  const uploadStream = bucket.openUploadStream('test_image.jpg', {
    contentType: 'image/jpeg',
    metadata: { test: true }
  });

  await new Promise((resolve, reject) => {
    Readable.from(sampleData).pipe(uploadStream)
      .on('error', reject)
      .on('finish', resolve);
  });

  const fileId = uploadStream.id;
  console.log('Uploaded fileId:', fileId.toString());

  // Test reading back
  console.log('Reading file back from GridFS...');
  const files = await bucket.find({ _id: fileId }).toArray();
  if (files.length === 0) {
    throw new Error('File not found in GridFS!');
  }
  console.log('Found file:', files[0].filename, 'length:', files[0].length, 'contentType:', files[0].contentType);

  // Test deleting
  console.log('Cleaning up test file from GridFS...');
  await deleteFromGridFS(fileId);
  const remaining = await bucket.find({ _id: fileId }).toArray();
  console.log('Remaining files with that ID:', remaining.length);

  await mongoose.disconnect();
  console.log('All MongoDB GridFS tests PASSED successfully!');
}

testGridFS().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});

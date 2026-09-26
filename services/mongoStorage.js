const multer = require('multer');
const mongoose = require('mongoose');

class MongoGridFSStorage {
  constructor(options = {}) {
    this.bucketName = options.bucketName || 'media_images';
  }

  _handleFile(req, file, cb) {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return cb(new Error('MongoDB connection is not ready. Unable to upload image to MongoDB.'));
    }

    try {
      const db = mongoose.connection.db;
      const bucket = new mongoose.mongo.GridFSBucket(db, {
        bucketName: this.bucketName
      });

      const cleanOrigName = (file.originalname || 'image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadStream = bucket.openUploadStream(cleanOrigName, {
        contentType: file.mimetype || 'image/jpeg',
        metadata: {
          originalName: file.originalname,
          mimetype: file.mimetype,
          uploadedAt: new Date(),
          uploadedBy: req.user?.id || req.user?._id || null
        }
      });

      file.stream.pipe(uploadStream)
        .on('error', (err) => {
          console.error('[GridFS Upload Stream Error]:', err);
          cb(err);
        })
        .on('finish', () => {
          const fileId = uploadStream.id;
          const protocol = req.headers['x-forwarded-proto'] || (req.connection && req.connection.encrypted ? 'https' : 'http') || 'http';
          const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5055';
          const baseUrl = process.env.SERVER_BASE_URL || `${protocol}://${host}`;
          const fileUrl = `${baseUrl}/api/media/file/${fileId}`;

          cb(null, {
            id: fileId,
            fileId: fileId,
            filename: fileId.toString(),
            originalname: file.originalname,
            mimetype: file.mimetype,
            path: fileUrl,
            secure_url: fileUrl,
            url: fileUrl,
            publicId: fileId.toString(),
            storage: 'gridfs'
          });
        });
    } catch (err) {
      console.error('[GridFS Storage Exception]:', err);
      cb(err);
    }
  }

  _removeFile(req, file, cb) {
    const fileId = file.fileId || file.id || file.filename;
    if (!fileId) return cb(null);

    try {
      deleteFromGridFS(fileId, this.bucketName)
        .then(() => cb(null))
        .catch(err => cb(err));
    } catch (err) {
      cb(err);
    }
  }
}

/**
 * Delete a file by ObjectId from GridFS
 */
async function deleteFromGridFS(fileId, bucketName = 'media_images') {
  if (!fileId || !mongoose.connection || mongoose.connection.readyState !== 1) return;
  try {
    const id = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
    await bucket.delete(id);
  } catch (err) {
    // Suppress file-not-found errors during cleanup
    if (!err.message.includes('FileNotFound')) {
      console.warn('[GridFS Delete Warning]:', err.message);
    }
  }
}

/**
 * Stream an image file directly to the Express response
 */
async function streamGridFSFile(fileId, req, res, bucketName = 'media_images') {
  try {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).send('Invalid media ID');
    }

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).send('Database connection unavailable');
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
    const _id = new mongoose.Types.ObjectId(fileId);

    const files = await bucket.find({ _id }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).send('Image asset not found in MongoDB');
    }

    const file = files[0];
    const contentType = file.contentType || (file.metadata && file.metadata.mimetype) || 'image/jpeg';

    res.set({
      'Content-Type': contentType,
      'Content-Length': file.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes'
    });

    const downloadStream = bucket.openDownloadStream(_id);
    downloadStream.on('error', (err) => {
      console.error('[GridFS Download Stream Error]:', err);
      if (!res.headersSent) {
        res.status(500).send('Error streaming media file');
      }
    });

    downloadStream.pipe(res);
  } catch (err) {
    console.error('[Stream GridFS Image Error]:', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to serve image');
    }
  }
}

// Multer upload middleware instances for standard and gallery uploads
const upload = multer({
  storage: new MongoGridFSStorage({ bucketName: 'media_images' }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const galleryUpload = multer({
  storage: new MongoGridFSStorage({ bucketName: 'media_images' }),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

module.exports = {
  MongoGridFSStorage,
  upload,
  galleryUpload,
  deleteFromGridFS,
  streamGridFSFile
};

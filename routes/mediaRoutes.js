const express = require('express');
const router = express.Router();
const { streamGridFSFile } = require('../services/mongoStorage');
const MediaItem = require('../models/MediaItem');

/**
 * GET /api/media/file/:id
 * Streams the binary image directly from MongoDB GridFS
 */
router.get('/file/:id', async (req, res) => {
  await streamGridFSFile(req.params.id, req, res);
});

/**
 * GET /api/media/image/:id
 * Alias for /file/:id
 */
router.get('/image/:id', async (req, res) => {
  await streamGridFSFile(req.params.id, req, res);
});

/**
 * GET /api/media/:id
 * Direct endpoint for file streaming by id
 */
router.get('/:id', async (req, res) => {
  // If id is valid ObjectId, stream file directly
  await streamGridFSFile(req.params.id, req, res);
});

module.exports = router;

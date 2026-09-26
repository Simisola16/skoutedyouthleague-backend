const express = require('express');
const router = express.Router();
const PodcastEpisode = require('../models/PodcastEpisode');
const { requireAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinary');

// 1. GET /api/podcasts - Get list of podcasts
router.get('/', async (req, res) => {
  try {
    const { limit } = req.query;
    const query = PodcastEpisode.find({ isPublished: true }).sort({ episodeNumber: -1, publishedAt: -1 });
    if (limit) {
      query.limit(Number(limit));
    }
    const episodes = await query;
    res.json({ success: true, count: episodes.length, data: episodes });
  } catch (err) {
    console.error('[Get Podcasts Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/podcasts/:id - Get single podcast episode
router.get('/:id', async (req, res) => {
  try {
    const episode = await PodcastEpisode.findById(req.params.id);
    if (!episode) {
      return res.status(404).json({ success: false, error: 'Podcast episode not found' });
    }
    res.json({ success: true, data: episode });
  } catch (err) {
    console.error('[Get Podcast Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/podcasts - Create podcast episode (Admin)
router.post('/', requireAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const {
      episodeNumber,
      title,
      description,
      audioUrl,
      youtubeUrl,
      spotifyUrl,
      duration,
      host,
      guest,
      isPublished,
      coverImageUrl
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, error: 'Title and description are required' });
    }

    let finalCoverUrl = coverImageUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1200';
    if (req.file && req.file.path) {
      finalCoverUrl = req.file.path;
    }

    // Determine episode number if not explicitly given
    let num = Number(episodeNumber);
    if (!num) {
      const highest = await PodcastEpisode.findOne().sort({ episodeNumber: -1 });
      num = highest ? highest.episodeNumber + 1 : 1;
    }

    const episode = await PodcastEpisode.create({
      episodeNumber: num,
      title,
      description,
      coverImageUrl: finalCoverUrl,
      audioUrl: audioUrl || '',
      youtubeUrl: youtubeUrl || '',
      spotifyUrl: spotifyUrl || '',
      duration: duration || '30 mins',
      host: host || 'Skouted Youth League Media',
      guest: guest || '',
      isPublished: isPublished !== 'false' && isPublished !== false,
      publishedAt: new Date()
    });

    res.status(201).json({ success: true, data: episode });
  } catch (err) {
    console.error('[Create Podcast Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/podcasts/:id - Update episode (Admin)
router.put('/:id', requireAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file && req.file.path) {
      updateData.coverImageUrl = req.file.path;
    }
    if (updateData.isPublished !== undefined) {
      updateData.isPublished = updateData.isPublished === 'true' || updateData.isPublished === true;
    }

    const episode = await PodcastEpisode.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!episode) {
      return res.status(404).json({ success: false, error: 'Podcast episode not found' });
    }

    res.json({ success: true, data: episode });
  } catch (err) {
    console.error('[Update Podcast Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DELETE /api/podcasts/:id - Delete episode (Admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const episode = await PodcastEpisode.findByIdAndDelete(req.params.id);
    if (!episode) {
      return res.status(404).json({ success: false, error: 'Podcast episode not found' });
    }
    res.json({ success: true, message: 'Podcast episode removed' });
  } catch (err) {
    console.error('[Delete Podcast Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

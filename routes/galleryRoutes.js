const express = require('express');
const router = express.Router();
const MediaItem = require('../models/MediaItem');

// 1. GET /api/gallery
// Public endpoint for Matchday & Tournament Gallery
router.get('/', async (req, res) => {
  try {
    const { category, search, limit = 50, page = 1 } = req.query;

    const filter = { isPublished: true };

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { caption: { $regex: search, $options: 'i' } },
        { matchTag: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [items, total] = await Promise.all([
      MediaItem.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      MediaItem.countDocuments(filter)
    ]);

    // Aggregate category counts for gallery filter tabs
    const categories = ['All', 'Matchday Action', 'Teams', 'Behind The Scenes', 'Awards & Scouts'];
    const countPromises = categories.map(async (cat) => {
      const catFilter = { isPublished: true };
      if (cat !== 'All') catFilter.category = cat;
      const count = await MediaItem.countDocuments(catFilter);
      return { category: cat, count };
    });
    const categoryCounts = await Promise.all(countPromises);
    const countsMap = categoryCounts.reduce((acc, curr) => {
      acc[curr.category] = curr.count;
      return acc;
    }, {});

    res.json({
      success: true,
      data: items,
      counts: countsMap,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (err) {
    console.error('Gallery Fetch Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve gallery items' });
  }
});

// 2. GET /api/gallery/:id
// Get single media item details and increment view count
router.get('/:id', async (req, res) => {
  try {
    const item = await MediaItem.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!item) {
      return res.status(404).json({ success: false, error: 'Media item not found' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to retrieve media item' });
  }
});

// 3. POST /api/gallery/:id/like
// Like an image in the gallery
router.post('/:id/like', async (req, res) => {
  try {
    const item = await MediaItem.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: 1 } },
      { new: true }
    ).select('likes');
    if (!item) {
      return res.status(404).json({ success: false, error: 'Media item not found' });
    }
    res.json({ success: true, likes: item.likes });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to like media item' });
  }
});

module.exports = router;

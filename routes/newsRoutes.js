const express = require('express');
const router = express.Router();
const NewsArticle = require('../models/NewsArticle');
const { requireAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinary');

// Slug generator helper
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// 1. GET /api/news - List news articles
router.get('/', async (req, res) => {
  try {
    const { category, search, limit } = req.query;
    const filter = { isPublished: true };

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    const query = NewsArticle.find(filter).sort({ publishedAt: -1, createdAt: -1 });
    if (limit) {
      query.limit(Number(limit));
    }

    const articles = await query;
    res.json({ success: true, count: articles.length, data: articles });
  } catch (err) {
    console.error('[Get News Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/news/:slug - Get single news article
router.get('/:slug', async (req, res) => {
  try {
    const article = await NewsArticle.findOne({
      $or: [{ slug: req.params.slug }, { _id: req.params.slug.match(/^[0-9a-fA-F]{24}$/) ? req.params.slug : null }]
    });

    if (!article) {
      return res.status(404).json({ success: false, error: 'News article not found' });
    }

    res.json({ success: true, data: article });
  } catch (err) {
    console.error('[Get News Article Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/news - Create news article (Admin)
router.post('/', requireAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const { title, excerpt, content, category, author, readTime, featured, isPublished, coverImageUrl } = req.body;

    if (!title || !excerpt || !content) {
      return res.status(400).json({ success: false, error: 'Title, excerpt, and content are required' });
    }

    let finalCoverUrl = coverImageUrl || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&q=80&w=1200';
    if (req.file && req.file.path) {
      finalCoverUrl = req.file.path;
    }

    let slug = slugify(title);
    const existing = await NewsArticle.findOne({ slug });
    if (existing) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    const article = await NewsArticle.create({
      title,
      slug,
      excerpt,
      content,
      coverImageUrl: finalCoverUrl,
      category: category || 'League Announcement',
      author: author || 'SYL Editorial Team',
      readTime: readTime || '3 min read',
      featured: featured === 'true' || featured === true,
      isPublished: isPublished !== 'false' && isPublished !== false,
      publishedAt: new Date()
    });

    res.status(201).json({ success: true, data: article });
  } catch (err) {
    console.error('[Create News Article Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/news/:id - Update news article (Admin)
router.put('/:id', requireAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file && req.file.path) {
      updateData.coverImageUrl = req.file.path;
    }
    if (updateData.title && !updateData.slug) {
      updateData.slug = slugify(updateData.title);
    }
    if (updateData.featured !== undefined) {
      updateData.featured = updateData.featured === 'true' || updateData.featured === true;
    }
    if (updateData.isPublished !== undefined) {
      updateData.isPublished = updateData.isPublished === 'true' || updateData.isPublished === true;
    }

    const article = await NewsArticle.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }

    res.json({ success: true, data: article });
  } catch (err) {
    console.error('[Update News Article Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DELETE /api/news/:id - Delete news article (Admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const article = await NewsArticle.findByIdAndDelete(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }
    res.json({ success: true, message: 'Article removed successfully' });
  } catch (err) {
    console.error('[Delete News Article Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

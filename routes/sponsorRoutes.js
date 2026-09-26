const express = require('express');
const router = express.Router();
const Sponsor = require('../models/Sponsor');
const { requireAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinary');

// 1. GET /api/sponsors - Public list of active sponsors
router.get('/', async (req, res) => {
  try {
    const sponsors = await Sponsor.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.json({ success: true, count: sponsors.length, data: sponsors });
  } catch (err) {
    console.error('[Get Sponsors Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/sponsors/all - Admin list of all sponsors
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const sponsors = await Sponsor.find().sort({ order: 1, createdAt: 1 });
    res.json({ success: true, count: sponsors.length, data: sponsors });
  } catch (err) {
    console.error('[Get All Sponsors Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/sponsors - Create sponsor (Admin)
router.post('/', requireAdmin, upload.single('logo'), async (req, res) => {
  try {
    const { name, tier, websiteUrl, description, order, isActive, logoUrl } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Sponsor name is required' });
    }

    let finalLogoUrl = logoUrl || 'https://via.placeholder.com/200x80?text=Sponsor';
    if (req.file && req.file.path) {
      finalLogoUrl = req.file.path;
    }

    const sponsor = await Sponsor.create({
      name,
      logoUrl: finalLogoUrl,
      tier: tier || 'Official Partner',
      websiteUrl: websiteUrl || '',
      description: description || '',
      order: Number(order) || 0,
      isActive: isActive !== 'false' && isActive !== false
    });

    res.status(201).json({ success: true, data: sponsor });
  } catch (err) {
    console.error('[Create Sponsor Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/sponsors/:id - Update sponsor (Admin)
router.put('/:id', requireAdmin, upload.single('logo'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file && req.file.path) {
      updateData.logoUrl = req.file.path;
    }
    if (updateData.order !== undefined) {
      updateData.order = Number(updateData.order);
    }
    if (updateData.isActive !== undefined) {
      updateData.isActive = updateData.isActive === 'true' || updateData.isActive === true;
    }

    const sponsor = await Sponsor.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!sponsor) {
      return res.status(404).json({ success: false, error: 'Sponsor not found' });
    }

    res.json({ success: true, data: sponsor });
  } catch (err) {
    console.error('[Update Sponsor Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DELETE /api/sponsors/:id - Delete sponsor (Admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const sponsor = await Sponsor.findByIdAndDelete(req.params.id);
    if (!sponsor) {
      return res.status(404).json({ success: false, error: 'Sponsor not found' });
    }
    res.json({ success: true, message: 'Sponsor removed' });
  } catch (err) {
    console.error('[Delete Sponsor Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

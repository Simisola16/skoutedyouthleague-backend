const express = require('express');
const router = express.Router();
const SocialPost = require('../models/SocialPost');
const SocialSyncService = require('../services/socialSyncService');
const { requireAdmin } = require('../middleware/authMiddleware');

const SOCIAL_SYNC_SECRET = process.env.SOCIAL_SYNC_SECRET || 'skouted_social_sync_secret_2026';

/**
 * 1. GET /api/social/posts
 * Public endpoint to fetch aggregated social media posts & reels
 */
router.get('/posts', async (req, res) => {
  try {
    const { platform, limit = 24, page = 1, refresh } = req.query;
    const filter = {};

    if (platform && platform !== 'all') {
      filter.platform = platform.toLowerCase();
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit) || 24, 1), 100);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * parsedLimit;
    const isYouTubeQuery = !platform || platform === 'all' || platform.toLowerCase() === 'youtube';

    // Explicit refresh waits for a fresh YouTube sync before querying MongoDB
    if (refresh === 'true' && isYouTubeQuery) {
      await SocialSyncService.syncYouTube().catch(() => {});
    }

    let [posts, total] = await Promise.all([
      SocialPost.find(filter)
        .sort({ pinned: -1, publishedAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      SocialPost.countDocuments(filter)
    ]);

    // If DB is empty on first load, sync inline; if stale (> 3 minutes), sync in background
    if (isYouTubeQuery && refresh !== 'true') {
      const lastSyncAt = SocialSyncService.lastSyncAt || 0;
      const isStale = Date.now() - lastSyncAt > 3 * 60 * 1000;
      if (total === 0) {
        await SocialSyncService.syncYouTube().catch(() => {});
        [posts, total] = await Promise.all([
          SocialPost.find(filter)
            .sort({ pinned: -1, publishedAt: -1 })
            .skip(skip)
            .limit(parsedLimit)
            .lean(),
          SocialPost.countDocuments(filter)
        ]);
      } else if (isStale) {
        SocialSyncService.syncYouTube().catch(() => {});
      }
    }

    res.json({
      success: true,
      data: posts,
      total,
      page: parseInt(page) || 1,
      totalPages: Math.ceil(total / parsedLimit) || 1
    });
  } catch (err) {
    console.error('[Social API] Error fetching posts:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. GET /api/social/live
 * Real-time active YouTube Live Stream info & playable embed URL
 */
router.get('/live', async (req, res) => {
  try {
    const liveInfo = await SocialSyncService.detectLiveStream(req.query.refresh === 'true');
    res.json({
      success: true,
      data: liveInfo
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. POST /api/social/live
 * Admin manual broadcast / override for active live stream
 */
router.post('/live', requireAdmin, async (req, res) => {
  try {
    const { videoId, title, isLiveNow, url, mode } = req.body;
    const isAutoMode = mode === 'auto' || videoId === 'auto' || url === 'auto';

    let extractedId = isAutoMode ? 'auto' : videoId;
    if (!isAutoMode && url) {
      const trimmed = url.trim();
      const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/))([a-zA-Z0-9_-]{11})/);
      if (match) extractedId = match[1];
      else if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) extractedId = trimmed;
    }

    const LeagueSettings = require('../models/LeagueSettings');
    let settings = await LeagueSettings.findOne();
    if (!settings) settings = new LeagueSettings();

    if (!settings.socialLinks) settings.socialLinks = {};

    if (isAutoMode) {
      settings.socialLinks.youtubeLiveVideoId = 'auto';
      settings.socialLinks.youtubeLiveTitle = '';
      settings.socialLinks.youtubeLiveEmbedUrl = '';
      settings.socialLinks.isLiveNow = false;
    } else {
      if (extractedId) settings.socialLinks.youtubeLiveVideoId = extractedId;
      if (title) settings.socialLinks.youtubeLiveTitle = title;
      if (typeof isLiveNow === 'boolean') settings.socialLinks.isLiveNow = isLiveNow;
      if (extractedId) {
        settings.socialLinks.youtubeLiveEmbedUrl = `https://www.youtube.com/embed/${extractedId}?autoplay=1&mute=1`;
      }
    }

    await settings.save();

    // Clear cache & fetch updated
    SocialSyncService.liveStreamCache = { data: null, cachedAt: 0 };
    const updatedLive = await SocialSyncService.detectLiveStream(true);

    // Broadcast to all sockets
    try {
      const io = require('../services/socketService').getIO();
      if (io) io.emit('live_stream_updated', updatedLive);
    } catch {}

    res.json({
      success: true,
      message: isAutoMode
        ? 'Switched to YouTube Auto-Detect mode and refreshed active broadcast!'
        : 'Live stream settings updated and broadcasted!',
      data: updatedLive
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. POST /api/social/sync-youtube
 * Trigger an immediate sync of YouTube channel videos & active live stream
 */
router.post('/sync-youtube', async (req, res) => {
  try {
    const [result, liveData] = await Promise.all([
      SocialSyncService.syncYouTube(),
      SocialSyncService.detectLiveStream(true).catch(() => null)
    ]);
    res.json({
      success: true,
      message: `YouTube sync completed successfully. Synced ${result.count} posts.`,
      count: result.count,
      syncedCount: result.count,
      live: liveData
    });
  } catch (err) {
    console.error('[Social API] YouTube sync error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. POST /api/social/webhook
 * Ingest social posts from third-party automation tools (Zapier, Make, RSS.app, Curator.io)
 */
router.post('/webhook', async (req, res) => {
  try {
    const providedSecret = req.headers['x-sync-secret'] || req.query.secret || req.body.secret;
    if (providedSecret !== SOCIAL_SYNC_SECRET && req.headers.authorization !== `Bearer ${SOCIAL_SYNC_SECRET}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid social sync secret' });
    }

    const payload = req.body.posts || req.body.data || req.body;
    const insertedCount = await SocialSyncService.ingestWebhook(payload);

    res.json({
      success: true,
      message: `Webhook processed. Ingested ${insertedCount} posts.`,
      count: insertedCount
    });
  } catch (err) {
    console.error('[Social API] Webhook ingestion error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. POST /api/social/curate
 * Operator Fast-Curation tool for pasting Instagram Reels, Facebook posts, or YouTube links
 */
router.post('/curate', requireAdmin, async (req, res) => {
  try {
    const {
      postUrl: rawPostUrl,
      url: rawUrl,
      platform: userPlatform,
      title: userTitle,
      caption: userCaption,
      thumbnailUrl: userThumb,
      mediaType: userMediaType,
      pinned
    } = req.body;

    const postUrl = (rawPostUrl || rawUrl || '').trim();
    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'Post URL is required' });
    }

    // Auto-detect platform if not provided
    let detectedPlatform = userPlatform ? userPlatform.toLowerCase() : 'instagram';
    if (!userPlatform) {
      if (postUrl.includes('youtube.com') || postUrl.includes('youtu.be')) detectedPlatform = 'youtube';
      else if (postUrl.includes('instagram.com')) detectedPlatform = 'instagram';
      else if (postUrl.includes('facebook.com') || postUrl.includes('fb.watch')) detectedPlatform = 'facebook';
      else if (postUrl.includes('tiktok.com')) detectedPlatform = 'tiktok';
    }

    let title = userTitle || '';
    let caption = userCaption || '';
    let thumbnailUrl = userThumb || '';
    let mediaType = userMediaType || (detectedPlatform === 'youtube' ? 'video' : 'post');
    let externalId = `curated_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let embeddable = true;

    // If YouTube URL, attempt to pull oEmbed metadata
    if (detectedPlatform === 'youtube') {
      const match = postUrl.match(/(?:v=|\/embed\/|youtu\.be\/|\/live\/|\/shorts\/|\/v\/|\/e\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        externalId = match[1];
        if (!thumbnailUrl) {
          thumbnailUrl = `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`;
        }
      }
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(postUrl)}&format=json`);
        if (oembedRes.ok) {
          const oe = await oembedRes.json();
          if (!title) title = oe.title || '';
          if (!thumbnailUrl) thumbnailUrl = oe.thumbnail_url || '';
        } else if (oembedRes.status === 401 || oembedRes.status === 403) {
          embeddable = false;
        }
      } catch {}
    }

    const post = await SocialPost.findOneAndUpdate(
      { externalId },
      {
        $set: {
          platform: detectedPlatform,
          title: title || `${detectedPlatform.toUpperCase()} Spotlight`,
          caption,
          postUrl,
          thumbnailUrl,
          mediaType,
          pinned: Boolean(pinned),
          embeddable,
          publishedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      message: 'Post successfully curated and published to the social hub.',
      data: post
    });
  } catch (err) {
    console.error('[Social API] Fast-curation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. PATCH /api/social/posts/:id/pin
 * Pin or unpin a post to keep featured highlights at the top
 */
router.patch('/posts/:id/pin', requireAdmin, async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    post.pinned = !post.pinned;
    await post.save();

    res.json({ success: true, pinned: post.pinned, data: post });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. DELETE /api/social/posts/:id
 * Delete a social post
 */
router.delete('/posts/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await SocialPost.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    res.json({ success: true, message: 'Social post removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

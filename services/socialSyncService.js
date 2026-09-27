const cron = require('node-cron');
const { XMLParser } = require('fast-xml-parser');
const SocialPost = require('../models/SocialPost');
const { getIO } = require('./socketService');

const YOUTUBE_CHANNEL_ID = 'UCy_dA9AmAWwGcDhh1PQtARA';
const YOUTUBE_CHANNEL_HANDLE = 'Skoutedyouthleague';

class SocialSyncService {
  /**
   * Sync YouTube Videos:
   * 1. Attempts official YouTube XML Feed
   * 2. Falls back to channel videos page & official YouTube oEmbed API
   */
  static async syncYouTube() {
    console.log(`[SocialSync] 🔄 Starting YouTube auto-sync for Channel: ${YOUTUBE_CHANNEL_ID}...`);
    const postsToUpsert = [];

    // --- Method A: Try Official XML Feed ---
    try {
      const xmlFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
      const response = await fetch(xmlFeedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.ok) {
        const xmlText = await response.text();
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_'
        });
        const parsed = parser.parse(xmlText);
        const entries = parsed?.feed?.entry ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry]) : [];

        for (const entry of entries) {
          const videoId = entry['yt:videoId'];
          if (!videoId) continue;

          const title = entry.title || 'Skouted Youth League Match';
          const description = entry['media:group']?.['media:description'] || '';
          const thumbnail = entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          const published = entry.published ? new Date(entry.published) : new Date();

          postsToUpsert.push({
            platform: 'youtube',
            externalId: videoId,
            title,
            caption: description,
            postUrl: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl: thumbnail,
            mediaType: 'video',
            publishedAt: published
          });
        }
        console.log(`[SocialSync] ✅ Found ${postsToUpsert.length} videos from YouTube XML Feed.`);
      }
    } catch (err) {
      console.warn(`[SocialSync] ⚠️ YouTube XML Feed fetch failed or unavailable:`, err.message);
    }

    // --- Method B: Resilient Fallback via Channel Page & oEmbed ---
    if (postsToUpsert.length === 0) {
      try {
        console.log(`[SocialSync] ℹ️ Using channel fallback for @${YOUTUBE_CHANNEL_HANDLE}...`);
        const channelUrl = `https://www.youtube.com/@${YOUTUBE_CHANNEL_HANDLE}/videos`;
        const res = await fetch(channelUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (res.ok) {
          const html = await res.text();
          const videoMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
          const uniqueVideoIds = [...new Set(videoMatches)].slice(0, 15);

          for (const videoId of uniqueVideoIds) {
            let title = 'Skouted Youth League Match Highlight';
            let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

            try {
              const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
              if (oembedRes.ok) {
                const oembed = await oembedRes.json();
                if (oembed.title) title = oembed.title;
                if (oembed.thumbnail_url) thumbnailUrl = oembed.thumbnail_url;
              }
            } catch {
              // use defaults
            }

            postsToUpsert.push({
              platform: 'youtube',
              externalId: videoId,
              title,
              caption: `Official matchday broadcast & video dossier from Skouted Youth League (@${YOUTUBE_CHANNEL_HANDLE}).`,
              postUrl: `https://www.youtube.com/watch?v=${videoId}`,
              thumbnailUrl,
              mediaType: 'video',
              publishedAt: new Date()
            });
          }
          console.log(`[SocialSync] ✅ Extracted ${postsToUpsert.length} videos via Channel fallback.`);
        }
      } catch (fallbackErr) {
        console.error(`[SocialSync] ❌ Fallback channel fetch failed:`, fallbackErr.message);
      }
    }

    // --- Upsert into MongoDB ---
    let upsertedCount = 0;
    for (const post of postsToUpsert) {
      try {
        await SocialPost.findOneAndUpdate(
          { externalId: post.externalId },
          {
            $set: {
              platform: post.platform,
              title: post.title,
              caption: post.caption,
              postUrl: post.postUrl,
              thumbnailUrl: post.thumbnailUrl,
              mediaType: post.mediaType,
              publishedAt: post.publishedAt
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        upsertedCount++;
      } catch (dbErr) {
        console.error(`[SocialSync] Error saving post ${post.externalId}:`, dbErr.message);
      }
    }

    console.log(`[SocialSync] 🏁 Synced ${upsertedCount} YouTube posts to database.`);

    // Broadcast realtime update to connected clients
    try {
      const io = getIO();
      if (io) {
        const latestPosts = await SocialPost.find().sort({ pinned: -1, publishedAt: -1 }).limit(20);
        io.emit('social_posts_updated', latestPosts);
      }
    } catch {
      // socket optional
    }

    return { success: true, count: upsertedCount };
  }

  /**
   * Ingest webhook updates from Zapier / Make / RSS.app / Curator.io
   */
  static async ingestWebhook(postsArray) {
    const list = Array.isArray(postsArray) ? postsArray : [postsArray];
    let inserted = 0;

    for (const item of list) {
      if (!item.postUrl || !item.platform) continue;

      const externalId = item.externalId || item.id || `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await SocialPost.findOneAndUpdate(
        { externalId },
        {
          $set: {
            platform: item.platform.toLowerCase(),
            title: item.title || '',
            caption: item.caption || item.text || '',
            postUrl: item.postUrl,
            thumbnailUrl: item.thumbnailUrl || item.imageUrl || '',
            mediaType: item.mediaType || (item.platform === 'youtube' ? 'video' : 'post'),
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
            pinned: Boolean(item.pinned)
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      inserted++;
    }

    try {
      const io = getIO();
      if (io) {
        const latestPosts = await SocialPost.find().sort({ pinned: -1, publishedAt: -1 }).limit(20);
        io.emit('social_posts_updated', latestPosts);
      }
    } catch {
      // socket optional
    }

    return inserted;
  }

  /**
   * Start scheduled background auto-sync
   */
  static initScheduler() {
    console.log('[SocialSync] ⏰ Initializing Social Media Sync Cron Job (runs every 45 minutes)...');

    // Run on startup after 5 seconds to ensure DB connected
    setTimeout(() => {
      this.syncYouTube().catch(err => console.error('[SocialSync Startup Error]:', err));
    }, 5000);

    // Run every 45 minutes: '*/45 * * * *'
    cron.schedule('*/45 * * * *', async () => {
      try {
        await this.syncYouTube();
      } catch (err) {
        console.error('[SocialSync Cron Error]:', err);
      }
    });
  }
}

module.exports = SocialSyncService;

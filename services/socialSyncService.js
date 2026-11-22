const cron = require('node-cron');
const { XMLParser } = require('fast-xml-parser');
const SocialPost = require('../models/SocialPost');
const { getIO } = require('./socketService');

const YOUTUBE_CHANNEL_ID = 'UCy_dA9AmAWwGcDhh1PQtARA';
const YOUTUBE_CHANNEL_HANDLE = 'Skoutedyouthleague';
const LEGACY_DEFAULT_VIDEO_ID = 'lU5MVdwXWvE';

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractLivePageInfo(html) {
  if (!html) return null;

  const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
  const playerMatch = html.match(/"videoDetails":\{"videoId":"([a-zA-Z0-9_-]{11})","title":"((?:\\.|[^"\\])*)"/);
  const videoId = canonicalMatch?.[1] || playerMatch?.[1] || null;
  if (!videoId) return null;

  const titleFromPlayer = playerMatch?.[2] ? decodeHtmlEntities(playerMatch[2]) : null;
  const titleTagMatch = html.match(/<title>(.*?)<\/title>/);
  const titleFromTag = titleTagMatch?.[1]
    ? decodeHtmlEntities(titleTagMatch[1].replace(/\s*-\s*YouTube\s*$/i, ''))
    : null;
  const title = (titleFromPlayer && titleFromPlayer.length > 2)
    ? titleFromPlayer
    : (titleFromTag && !titleFromTag.includes('@') ? titleFromTag : 'Skouted Youth League Live Match');

  const isLiveNow = html.includes('"isLiveNow":true') ||
    (html.includes('"isLive":true') && !html.includes('"endTimestamp":"'));
  const playableInEmbed = !html.includes('"playableInEmbed":false');
  const uploadDateMatch = html.match(/"uploadDate":"([^"]+)"/) || html.match(/itemprop="uploadDate" content="([^"]+)"/);
  const publishedAt = uploadDateMatch?.[1] ? new Date(uploadDateMatch[1]) : null;

  return {
    videoId,
    title,
    isLiveNow,
    playableInEmbed,
    publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null
  };
}

class SocialSyncService {
  /**
   * Fast check of video embeddability & title via YouTube oEmbed API.
   * HTTP 200 -> embeddable: true; HTTP 401/403 -> embeddable: false (owner disabled embedding).
   */
  static async checkEmbedInfo(videoId) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        headers: YT_HEADERS
      });
      if (res.ok) {
        const data = await res.json();
        return {
          embeddable: true,
          title: data.title || null,
          thumbnailUrl: data.thumbnail_url || null
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { embeddable: false, title: null, thumbnailUrl: null };
      }
    } catch {
      // network hiccup -> leave unknown
    }
    return { embeddable: true, title: null, thumbnailUrl: null };
  }

  /**
   * Fetch exact watch-page metadata for a single video (title, uploadDate, playableInEmbed, isLiveNow)
   */
  static async fetchWatchMetadata(videoId) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: YT_HEADERS });
      if (!res.ok) return null;
      const html = await res.text();
      return extractLivePageInfo(html);
    } catch {
      return null;
    }
  }

  /**
   * Extract latest video IDs from a YouTube channel tab (/videos or /streams)
   */
  static async fetchChannelTabVideoIds(tab = 'videos', maxCount = 10) {
    try {
      const url = `https://www.youtube.com/channel/${YOUTUBE_CHANNEL_ID}/${tab}`;
      const res = await fetch(url, { headers: YT_HEADERS });
      if (!res.ok) return [];
      const html = await res.text();
      const ids = [...new Set([...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]))];
      return ids.slice(0, maxCount);
    } catch (err) {
      console.warn(`[SocialSync] ⚠️ Failed to fetch channel /${tab}:`, err.message);
      return [];
    }
  }

  /**
   * Sync YouTube Videos & Live Streams:
   * 1. Fetches official YouTube XML Feed (exact timestamps & descriptions for latest 15 items)
   * 2. ALSO checks real-time channel /videos and /streams tabs to catch brand-new uploads immediately
   *    before YouTube's 15-minute RSS cache updates, and to keep recent regular uploads visible
   * 3. Records embeddable status so non-embeddable streams degrade cleanly on the frontend
   */
  static async syncYouTube() {
    if (this.syncInProgress) {
      return this.syncInProgress;
    }

    this.syncInProgress = (async () => {
      console.log(`[SocialSync] 🔄 Starting YouTube auto-sync for Channel: ${YOUTUBE_CHANNEL_ID}...`);
      const postsById = new Map();

      // --- Step 1: Official YouTube XML RSS Feed ---
      try {
        const xmlFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}&_t=${Date.now()}`;
        const response = await fetch(xmlFeedUrl, { headers: YT_HEADERS });

        if (response.ok) {
          const xmlText = await response.text();
          const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
          });
          const parsed = parser.parse(xmlText);
          const entries = parsed?.feed?.entry
            ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry])
            : [];

          for (const entry of entries) {
            const videoId = entry['yt:videoId'];
            if (!videoId) continue;

            const title = decodeHtmlEntities(entry.title || 'Skouted Youth League Match');
            const description = decodeHtmlEntities(entry['media:group']?.['media:description'] || '');
            const thumbnail = entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            const published = entry.published ? new Date(entry.published) : new Date();

            postsById.set(videoId, {
              platform: 'youtube',
              externalId: videoId,
              title,
              caption: description,
              postUrl: `https://www.youtube.com/watch?v=${videoId}`,
              thumbnailUrl: thumbnail,
              mediaType: 'video',
              publishedAt: published,
              isLiveStream: /live\s*match/i.test(title)
            });
          }
          console.log(`[SocialSync] ✅ Found ${postsById.size} videos from YouTube XML Feed.`);
        }
      } catch (err) {
        console.warn(`[SocialSync] ⚠️ YouTube XML Feed fetch failed:`, err.message);
      }

      // --- Step 2: Real-time Channel /videos & /streams Tabs (catches brand-new uploads before RSS cache updates) ---
      try {
        const [videoTabIds, streamTabIds] = await Promise.all([
          this.fetchChannelTabVideoIds('videos', 8),
          this.fetchChannelTabVideoIds('streams', 8)
        ]);

        const candidateIds = [
          ...videoTabIds.map(id => ({ id, isStream: false })),
          ...streamTabIds.map(id => ({ id, isStream: true }))
        ];

        // Deduplicate & find IDs not yet in RSS map
        const missingFromRss = [];
        const seen = new Set(postsById.keys());
        for (const item of candidateIds) {
          if (seen.has(item.id)) {
            if (item.isStream && postsById.has(item.id)) {
              postsById.get(item.id).isLiveStream = true;
            }
            continue;
          }
          seen.add(item.id);
          missingFromRss.push(item);
        }

        if (missingFromRss.length > 0) {
          const existingDocs = await SocialPost.find({
            externalId: { $in: missingFromRss.map(m => m.id) }
          }).lean();
          const existingMap = new Map(existingDocs.map(d => [d.externalId, d]));

          // Only fetch full watch metadata for brand-new videos not yet in MongoDB (at most 6 per run)
          const brandNew = missingFromRss.filter(m => !existingMap.has(m.id)).slice(0, 6);
          for (const item of brandNew) {
            const meta = await this.fetchWatchMetadata(item.id);
            const oembed = await this.checkEmbedInfo(item.id);
            const title = meta?.title || oembed.title || 'Skouted Youth League Match Video';
            const publishedAt = meta?.publishedAt || new Date();

            postsById.set(item.id, {
              platform: 'youtube',
              externalId: item.id,
              title,
              caption: `Official matchday broadcast & highlights from Skouted Youth League (@${YOUTUBE_CHANNEL_HANDLE}).`,
              postUrl: `https://www.youtube.com/watch?v=${item.id}`,
              thumbnailUrl: oembed.thumbnailUrl || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
              mediaType: 'video',
              publishedAt,
              embeddable: meta ? meta.playableInEmbed : oembed.embeddable,
              isLiveStream: item.isStream || Boolean(meta?.isLiveNow)
            });
          }
          if (brandNew.length > 0) {
            console.log(`[SocialSync] ⚡ Discovered ${brandNew.length} brand-new videos via channel tabs.`);
          }
        }
      } catch (tabErr) {
        console.warn(`[SocialSync] ⚠️ Channel tab check warning:`, tabErr.message);
      }

      // --- Step 3: Check embeddability for all posts we're upserting ---
      const postsToUpsert = Array.from(postsById.values());
      const BATCH_SIZE = 5;
      for (let i = 0; i < postsToUpsert.length; i += BATCH_SIZE) {
        const batch = postsToUpsert.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (post) => {
            if (typeof post.embeddable !== 'boolean') {
              const info = await this.checkEmbedInfo(post.externalId);
              post.embeddable = info.embeddable;
              if (!post.title && info.title) post.title = info.title;
            }
          })
        );
      }

      // --- Step 4: Upsert into MongoDB ---
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
                publishedAt: post.publishedAt,
                embeddable: post.embeddable !== false,
                isLiveStream: Boolean(post.isLiveStream)
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          upsertedCount++;
        } catch (dbErr) {
          console.error(`[SocialSync] Error saving post ${post.externalId}:`, dbErr.message);
        }
      }

      this.lastSyncAt = Date.now();
      console.log(`[SocialSync] 🏁 Synced ${upsertedCount} YouTube posts to database.`);

      // Broadcast realtime update to connected clients
      try {
        const io = getIO();
        if (io) {
          const latestPosts = await SocialPost.find().sort({ pinned: -1, publishedAt: -1 }).limit(24).lean();
          io.emit('social_posts_updated', latestPosts);
        }
      } catch {
        // socket optional
      }

      return { success: true, count: upsertedCount };
    })().finally(() => {
      this.syncInProgress = null;
    });

    return this.syncInProgress;
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
        const latestPosts = await SocialPost.find().sort({ pinned: -1, publishedAt: -1 }).limit(24).lean();
        io.emit('social_posts_updated', latestPosts);
      }
    } catch {
      // socket optional
    }

    return inserted;
  }

  /**
   * Detect current active YouTube Live Stream (or latest broadcast if offline)
   */
  static async detectLiveStream(forceRefresh = false) {
    const now = Date.now();
    if (!this.liveStreamCache) {
      this.liveStreamCache = { data: null, cachedAt: 0 };
    }
    const prevVideoId = this.liveStreamCache.data?.videoId;
    const prevIsLive = this.liveStreamCache.data?.isLive;

    // Return cached if under 30 seconds unless forced
    if (!forceRefresh && this.liveStreamCache.data && (now - this.liveStreamCache.cachedAt < 30000)) {
      return this.liveStreamCache.data;
    }

    const LeagueSettings = require('../models/LeagueSettings');
    let settings = null;
    try {
      settings = await LeagueSettings.findOne();
      // Auto-migrate stale hardcoded Week 1 default video ID to 'auto' so live auto-detection works
      if (settings?.socialLinks?.youtubeLiveVideoId === LEGACY_DEFAULT_VIDEO_ID) {
        settings.socialLinks.youtubeLiveVideoId = 'auto';
        settings.socialLinks.youtubeLiveTitle = '';
        settings.socialLinks.youtubeLiveEmbedUrl = '';
        await settings.save();
        console.log('[SocialSync] ✅ Migrated legacy hardcoded Week 1 YouTube ID to auto-detect mode.');
      }
    } catch {}

    // Check if admin explicitly configured a manual live stream override (not 'auto')
    const manualVid = settings?.socialLinks?.youtubeLiveVideoId;
    if (manualVid && manualVid !== 'auto' && manualVid !== LEGACY_DEFAULT_VIDEO_ID) {
      const embedInfo = await this.checkEmbedInfo(manualVid);
      const liveData = {
        isLive: settings.socialLinks.isLiveNow !== false,
        videoId: manualVid,
        title: settings.socialLinks.youtubeLiveTitle || embedInfo.title || 'Skouted Youth League Matchday Live',
        embedUrl: `https://www.youtube.com/embed/${manualVid}?autoplay=1&mute=1`,
        thumbnailUrl: `https://i.ytimg.com/vi/${manualVid}/hqdefault.jpg`,
        playableInEmbed: embedInfo.embeddable,
        source: 'settings',
        checkedAt: new Date().toISOString()
      };
      this.liveStreamCache = { data: liveData, cachedAt: now };
      return liveData;
    }

    // Auto-detect directly from YouTube channel
    try {
      const channelId = settings?.socialLinks?.youtubeChannelId || YOUTUBE_CHANNEL_ID;
      let detected = null;

      // 1. Primary: Official /channel/<ID>/live endpoint (always points to active live broadcast if on air)
      try {
        const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
          headers: YT_HEADERS,
          redirect: 'follow'
        });
        if (res.ok) {
          const html = await res.text();
          const info = extractLivePageInfo(html);
          if (info && info.videoId && info.isLiveNow) {
            detected = info;
            console.log(`[SocialSync] 🔴 LIVE stream detected on YouTube: ${info.videoId} (${info.title}) | embeddable=${info.playableInEmbed}`);
          }
        }
      } catch (e) {
        console.warn('[SocialSync] Live page check failed:', e.message);
      }

      // If an active live stream was found, ensure it is also saved in SocialPost immediately
      if (detected) {
        try {
          await SocialPost.findOneAndUpdate(
            { externalId: detected.videoId },
            {
              $set: {
                platform: 'youtube',
                title: detected.title,
                caption: detected.title,
                postUrl: `https://www.youtube.com/watch?v=${detected.videoId}`,
                thumbnailUrl: `https://i.ytimg.com/vi/${detected.videoId}/hqdefault.jpg`,
                mediaType: 'video',
                publishedAt: detected.publishedAt || new Date(),
                embeddable: detected.playableInEmbed,
                isLiveStream: true
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch {}

        const liveData = {
          isLive: true,
          videoId: detected.videoId,
          title: detected.title,
          embedUrl: `https://www.youtube.com/embed/${detected.videoId}?autoplay=1&mute=1`,
          thumbnailUrl: `https://i.ytimg.com/vi/${detected.videoId}/hqdefault.jpg`,
          playableInEmbed: detected.playableInEmbed,
          source: 'auto_detected',
          checkedAt: new Date().toISOString()
        };

        this.liveStreamCache = { data: liveData, cachedAt: now };

        if (prevVideoId !== liveData.videoId || prevIsLive !== liveData.isLive) {
          try {
            const io = getIO();
            if (io) io.emit('live_stream_updated', liveData);
          } catch {}
        }

        return liveData;
      }

      // 2. Offline fallback: Show the latest match video/broadcast from MongoDB or YouTube RSS
      let latestPost = null;
      try {
        latestPost = await SocialPost.findOne({ platform: 'youtube' })
          .sort({ publishedAt: -1 })
          .lean();
      } catch {}

      let vidId = latestPost?.externalId || null;
      let title = latestPost?.title || null;
      let playableInEmbed = typeof latestPost?.embeddable === 'boolean' ? latestPost.embeddable : true;

      if (!vidId) {
        try {
          const rssRes = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: YT_HEADERS });
          if (rssRes.ok) {
            const xml = await rssRes.text();
            const rIdMatch = xml.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);
            const rTitleMatch = xml.match(/<title>(.*?)<\/title>/g);
            if (rIdMatch) vidId = rIdMatch[1];
            if (rTitleMatch && rTitleMatch[1]) {
              title = decodeHtmlEntities(rTitleMatch[1].replace(/<\/?title>/g, ''));
            }
            if (vidId) {
              const info = await this.checkEmbedInfo(vidId);
              playableInEmbed = info.embeddable;
            }
          }
        } catch (e) {
          console.warn('[SocialSync] RSS live fallback failed:', e.message);
        }
      }

      const liveData = {
        isLive: false,
        videoId: vidId || LEGACY_DEFAULT_VIDEO_ID,
        title: title || 'Skouted Youth League Matchday Broadcast',
        embedUrl: `https://www.youtube.com/embed/${vidId || LEGACY_DEFAULT_VIDEO_ID}?autoplay=0&mute=0`,
        thumbnailUrl: `https://i.ytimg.com/vi/${vidId || LEGACY_DEFAULT_VIDEO_ID}/hqdefault.jpg`,
        playableInEmbed,
        source: 'latest_upload',
        checkedAt: new Date().toISOString()
      };

      this.liveStreamCache = { data: liveData, cachedAt: now };

      if (prevVideoId && (prevVideoId !== liveData.videoId || prevIsLive !== liveData.isLive)) {
        try {
          const io = getIO();
          if (io) io.emit('live_stream_updated', liveData);
        } catch {}
      }

      return liveData;
    } catch (err) {
      console.error('[SocialSync] Error detecting live stream:', err.message);
      return {
        isLive: false,
        videoId: prevVideoId || LEGACY_DEFAULT_VIDEO_ID,
        title: this.liveStreamCache.data?.title || 'Skouted Youth League Matchday Broadcast',
        embedUrl: `https://www.youtube.com/embed/${prevVideoId || LEGACY_DEFAULT_VIDEO_ID}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${prevVideoId || LEGACY_DEFAULT_VIDEO_ID}/hqdefault.jpg`,
        playableInEmbed: true,
        source: 'fallback',
        checkedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Start scheduled background auto-sync & live stream watcher
   */
  static initScheduler() {
    console.log('[SocialSync] ⏰ Initializing YouTube Video Sync (every 5m) & Live Stream Watcher (every 2m)...');

    // Run on startup after 3 seconds to ensure DB is connected
    setTimeout(() => {
      this.syncYouTube().catch(err => console.error('[SocialSync Startup Error]:', err));
      this.detectLiveStream(true).catch(err => console.error('[SocialSync Live Startup Error]:', err));
    }, 3000);

    // Sync latest YouTube videos every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.syncYouTube();
      } catch (err) {
        console.error('[SocialSync Cron Error]:', err);
      }
    });

    // Check active YouTube Live stream every 2 minutes and push changes via Socket.IO
    cron.schedule('*/2 * * * *', async () => {
      try {
        await this.detectLiveStream(true);
      } catch (err) {
        console.error('[SocialSync Live Cron Error]:', err);
      }
    });
  }
}

module.exports = SocialSyncService;

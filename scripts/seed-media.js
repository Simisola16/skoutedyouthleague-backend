const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const NewsArticle = require('../models/NewsArticle');
const PodcastEpisode = require('../models/PodcastEpisode');
const Sponsor = require('../models/Sponsor');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/skouted_league';

const articles = [
  {
    title: 'Skouted Youth League Officially Launches Under-19 Championship Season',
    slug: 'skouted-youth-league-officially-launches-under-19-championship',
    excerpt: '12 elite academies and youth clubs across the region converge for a landmark tournament designed to bridge grassroots talent with professional opportunities.',
    content: `### A Historic Milestone for African Youth Football

The Skouted Youth League (SYL) has officially kicked off its inaugural Under-19 Championship, welcoming 12 registered clubs into a fiercely competitive league campaign. 

Built on the conviction that **talent is everywhere, but opportunity isn’t**, the league provides young athletes with a structured, transparent, and high-visibility stage. Matches will be recorded, performance metrics tracked, and full-match footage distributed across partner scouting networks in Africa and Europe.

> *"We are not just organizing weekend football matches; we are establishing a verified pipeline for ambitious players whose abilities deserve international recognition,"* remarked the League Technical Committee.

#### What to Expect This Season
- **35-Player Registered Squads:** Rigorous age verification, medical screenings, and player licensing.
- **Mid-Season Transfer Window:** Automated tactical adjustments after Leg 1 concludes.
- **Dedicated Scouting Delegations:** Scouts from domestic top-flight clubs and European scouting consultancies in attendance every matchday.
- **Live Broadcasting & Highlights:** Comprehensive streaming and analytical breakdowns for every clash.`,
    coverImageUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&q=80&w=1200',
    category: 'League Announcement',
    author: 'SYL Editorial Board',
    readTime: '4 min read',
    featured: true,
    isPublished: true,
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2)
  },
  {
    title: 'Matchday 1 Tactical Breakdown: Fast Transitions and Technical Mastery',
    slug: 'matchday-1-tactical-breakdown-fast-transitions',
    excerpt: 'An in-depth review of opening weekend action, standout defensive blocks, and clinical counter-attacking performances across Group A and Group B.',
    content: `### Opening Weekend Showcases High-Intensity Pressing

The first round of fixtures exceeded expectations with intense tempo, rapid vertical progression, and exceptional individual skill on display.

#### Key Highlights
- **Dominant Midfield Control:** Several teams utilized inverted full-backs to establish numerical superiority in the middle third.
- **Goalkeeping Excellence:** Three clean sheets were preserved thanks to world-class reaction saves and sweeper-keeper command.
- **Tactical Maturity:** Coaches demonstrated remarkable structural discipline, proving that U-19 football in the region is advancing technically at an extraordinary rate.`,
    coverImageUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&q=80&w=1200',
    category: 'Matchday Recap',
    author: 'Coach Marcus Davies, Tactical Analyst',
    readTime: '3 min read',
    featured: false,
    isPublished: true,
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  },
  {
    title: 'Scouting Report: Top 5 Central Playmakers Dominating Leg 1',
    slug: 'scouting-report-top-5-central-playmakers',
    excerpt: 'Our scouting department highlights the most influential deep-lying orchestrators and box-to-box midfielders catching the eyes of international scouts.',
    content: `### Identifying Future Midfield Generals

Modern football demands midfielders who combine physical stamina with split-second decision-making. Through our Wyscout partnership and on-pitch scouting evaluations, five players have separated themselves:

1. **Vision Under Pressure:** Exceptional press-resistance when operating in tight central channels.
2. **Progressive Passing Accuracy:** Above 84% pass completion on balls delivered into the final third.
3. **Defensive Work Rate:** High recovery rates and proactive interception positioning.

Full statistical profiles, heatmaps, and highlight reels are now accessible to accredited scouts via the Skouted Scout Portal.`,
    coverImageUrl: 'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?auto=format&fit=crop&q=80&w=1200',
    category: 'Scouting Report',
    author: 'Skouted Talent Identification Network',
    readTime: '5 min read',
    featured: false,
    isPublished: true,
    publishedAt: new Date()
  },
  {
    title: 'Pathway to Pro: How SYL is Transforming Player Development in Africa',
    slug: 'pathway-to-pro-transforming-player-development',
    excerpt: 'A comprehensive look at our player-first development framework, combining nutrition, mental resilience, and high-performance training standards.',
    content: `### Beyond 90 Minutes: Building Complete Athletes

At Skouted Youth League, we recognize that reaching the highest level requires far more than natural raw talent. 

Our holistic development framework integrates:
- **Football Intelligence:** Video analysis review sessions with licensed UEFA and CAF coaches.
- **Discipline & Professionalism:** Strict time management, media training, and squad accountability.
- **Physical Conditioning:** Injury prevention workshops and sports science monitoring to ensure peak athletic longevity.

Every young player in SYL is treated as a professional in training.`,
    coverImageUrl: 'https://images.unsplash.com/photo-1489944445391-11dd35574549?auto=format&fit=crop&q=80&w=1200',
    category: 'Youth Development',
    author: 'Dr. Samuel Kalu, Head of Performance',
    readTime: '6 min read',
    featured: false,
    isPublished: true,
    publishedAt: new Date()
  }
];

const podcasts = [
  {
    episodeNumber: 1,
    title: 'Episode 1: The SYL Manifesto — Why African Youth Football Needs a Structured Stage',
    description: 'League Founders and Technical Directors discuss why the Skouted Youth League was born, the gaps in grassroots scouting, and how we are building genuine pathways for Under-19 talent.',
    coverImageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&q=80&w=1200',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    spotifyUrl: 'https://open.spotify.com/show/skoutedyouthleague',
    duration: '38 mins',
    host: 'Skouted Media Team',
    guest: 'Director of Youth Development',
    isPublished: true,
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5)
  },
  {
    episodeNumber: 2,
    title: 'Episode 2: What Modern European Scouts Really Look For in U-19 Ballers',
    description: 'We sit down with a certified international talent scout to discuss data analytics, technical fundamentals, body positioning, and the psychological attributes that get players signed.',
    coverImageUrl: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&q=80&w=1200',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    spotifyUrl: 'https://open.spotify.com/show/skoutedyouthleague',
    duration: '45 mins',
    host: 'Skouted Media Team',
    guest: 'Lead European Scout',
    isPublished: true,
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3)
  },
  {
    episodeNumber: 3,
    title: 'Episode 3: Tactical Maturity & Managing Mid-Season Transfer Windows',
    description: 'A deep-dive conversation with two registered team managers about navigating the 35-player roster limit, squad rotation, and preparing mentally for high-stakes derby fixtures.',
    coverImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1200',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    spotifyUrl: 'https://open.spotify.com/show/skoutedyouthleague',
    duration: '32 mins',
    host: 'Skouted Media Team',
    guest: 'Club Managers Forum',
    isPublished: true,
    publishedAt: new Date()
  }
];

const sponsors = [
  {
    name: 'Wyscout / Hudl',
    tier: 'Scouting Partner',
    logoUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://hudl.com',
    description: 'Official video analytics and match scouting performance provider for Skouted Youth League.',
    order: 1,
    isActive: true
  },
  {
    name: 'Puma Football',
    tier: 'Technical Sponsor',
    logoUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://puma.com',
    description: 'Official match ball and athletic equipment partner powering the U-19 Championship.',
    order: 2,
    isActive: true
  },
  {
    name: 'Gatorade Sports Science',
    tier: 'Official Partner',
    logoUrl: 'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://gatorade.com',
    description: 'Hydration and player performance conditioning partner across all tournament venues.',
    order: 3,
    isActive: true
  },
  {
    name: 'African Talent Scouting Hub',
    tier: 'Scouting Partner',
    logoUrl: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://skoutedyouthleague.com',
    description: 'Connecting top African youth footballers directly with international scouting networks.',
    order: 4,
    isActive: true
  },
  {
    name: 'SuperSport Schools Media',
    tier: 'Media Partner',
    logoUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://supersport.com',
    description: 'Official broadcast partner delivering matchday highlights and player profile stories.',
    order: 5,
    isActive: true
  },
  {
    name: 'Apex Sports Performance',
    tier: 'Official Partner',
    logoUrl: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&q=80&w=400',
    websiteUrl: 'https://skoutedyouthleague.com',
    description: 'Providing elite GPS athlete tracking and physiological workload management.',
    order: 6,
    isActive: true
  }
];

async function seedMedia() {
  try {
    console.log('[Media Seeder] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Media Seeder] Connected to database.');

    // Seed News Articles if collection is empty
    const articleCount = await NewsArticle.countDocuments();
    if (articleCount === 0) {
      console.log('[Media Seeder] Seeding news articles...');
      await NewsArticle.insertMany(articles);
      console.log(`[Media Seeder] Inserted ${articles.length} news articles.`);
    } else {
      console.log(`[Media Seeder] News articles already exist (${articleCount} found).`);
    }

    // Seed Podcasts if collection is empty
    const podcastCount = await PodcastEpisode.countDocuments();
    if (podcastCount === 0) {
      console.log('[Media Seeder] Seeding podcasts...');
      await PodcastEpisode.insertMany(podcasts);
      console.log(`[Media Seeder] Inserted ${podcasts.length} podcast episodes.`);
    } else {
      console.log(`[Media Seeder] Podcast episodes already exist (${podcastCount} found).`);
    }

    // Seed Sponsors if collection is empty
    const sponsorCount = await Sponsor.countDocuments();
    if (sponsorCount === 0) {
      console.log('[Media Seeder] Seeding sponsors...');
      await Sponsor.insertMany(sponsors);
      console.log(`[Media Seeder] Inserted ${sponsors.length} sponsors.`);
    } else {
      console.log(`[Media Seeder] Sponsors already exist (${sponsorCount} found).`);
    }

    // Seed Media / Gallery Items if collection is empty
    const MediaItem = require('../models/MediaItem');
    const mediaCount = await MediaItem.countDocuments();
    if (mediaCount === 0) {
      console.log('[Media Seeder] Seeding gallery & media assets...');
      const galleryItems = [
        {
          title: 'Thunderous 90th Minute Equalizer',
          caption: 'Dramatic stoppage-time volley sends the away supporters into raptures in Leg 1 thriller.',
          category: 'Matchday Action',
          url: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Matchday 1: Alamu FC vs Telu Stars',
          tags: ['Volley', 'Goal', 'Stoppage Time', 'Thriller'],
          views: 342,
          likes: 58,
          isPublished: true
        },
        {
          title: 'Midfield Maestro Free Kick Under Floodlights',
          caption: 'Curled masterfully over the four-man wall into the top corner from 25 yards out.',
          category: 'Matchday Action',
          url: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Matchday 1: Winners FC vs Alamu FC',
          tags: ['Free Kick', 'Set Piece', 'Top Bin'],
          views: 489,
          likes: 82,
          isPublished: true
        },
        {
          title: 'Aerial Duel at the Far Post',
          caption: 'Center-backs battle for aerial supremacy in a fiercely contested corner kick battle.',
          category: 'Matchday Action',
          url: 'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Group A Clash',
          tags: ['Defense', 'Heading', 'Corner Kick'],
          views: 215,
          likes: 34,
          isPublished: true
        },
        {
          title: 'Crucial Penalty Save in Stoppage Time',
          caption: 'Full-stretch fingertip save preserves the clean sheet in the 94th minute.',
          category: 'Matchday Action',
          url: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Matchday 2 Opener',
          tags: ['Goalkeeper', 'Penalty', 'Clean Sheet', 'Heroics'],
          views: 512,
          likes: 97,
          isPublished: true
        },
        {
          title: 'Full-Stretch Slide Tackle in the Final Third',
          caption: 'Precision defensive intervention breaking down an incisive counter-attack.',
          category: 'Matchday Action',
          url: 'https://images.unsplash.com/photo-1560272564-c83b66b1ad12?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Group B Fixture',
          tags: ['Tackle', 'Discipline', 'Clean Play'],
          views: 198,
          likes: 29,
          isPublished: true
        },
        {
          title: 'Opening Ceremony Parade & Team Presentation',
          caption: 'All 12 registered youth clubs assembled on pitch for official tournament inauguration.',
          category: 'Teams',
          url: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'SYL Opening Ceremony',
          tags: ['Opening Ceremony', '12 Clubs', 'Inauguration'],
          views: 620,
          likes: 114,
          isPublished: true
        },
        {
          title: 'Pre-Match Focus: Starting XI Lineup Inspection',
          caption: 'Captains leading their squads out through the grand tunnel under official match ball protocol.',
          category: 'Teams',
          url: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Matchday 1 Kickoff',
          tags: ['Lineup', 'Starting XI', 'Focus'],
          views: 310,
          likes: 45,
          isPublished: true
        },
        {
          title: 'Victory Celebrations With the Travelling Fans',
          caption: 'Emotional post-match scenes as the young lions celebrate three hard-fought points.',
          category: 'Teams',
          url: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Post-Match',
          tags: ['Celebration', 'Three Points', 'Fans'],
          views: 425,
          likes: 78,
          isPublished: true
        },
        {
          title: 'Locker Room Strategy & Tactical Chalk Talk',
          caption: 'Head coach laying out second-half transition patterns and high-press triggers.',
          category: 'Behind The Scenes',
          url: 'https://images.unsplash.com/photo-1511886929837-354d827aae26?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Halftime Dressing Room',
          tags: ['Tactics', 'Locker Room', 'Coach', 'Strategy'],
          views: 540,
          likes: 91,
          isPublished: true
        },
        {
          title: 'Pre-Kickoff Hydration & Physio Warmup Drills',
          caption: 'Dynamic stretching, agility ladders, and reaction ball exercises in pre-game prep.',
          category: 'Behind The Scenes',
          url: 'https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Training Ground',
          tags: ['Warmup', 'Physio', 'Fitness', 'Readiness'],
          views: 260,
          likes: 38,
          isPublished: true
        },
        {
          title: 'Tunnel Walkout: The Final Seconds Before Battle',
          caption: 'Intense eye contact and silent focus in the tunnel before stepping onto the pitch.',
          category: 'Behind The Scenes',
          url: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'The Tunnel',
          tags: ['Tunnel', 'Focus', 'Walkout'],
          views: 380,
          likes: 67,
          isPublished: true
        },
        {
          title: 'Man of the Match Official Trophy Presentation',
          caption: 'Star winger awarded the SYL Player of the Match crystal award after a 2-goal display.',
          category: 'Awards & Scouts',
          url: 'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Matchday 1 Awards',
          tags: ['MOTM', 'Trophy', 'Award', 'Standout'],
          views: 740,
          likes: 135,
          isPublished: true
        },
        {
          title: 'International Scouting Delegation Analyzing Talents',
          caption: 'Accredited European and top-flight club scouts taking notes from the VIP executive box.',
          category: 'Awards & Scouts',
          url: 'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Scouting Forum',
          tags: ['Scouting', 'Talent ID', 'Future Stars', 'Europe'],
          views: 690,
          likes: 122,
          isPublished: true
        },
        {
          title: 'Championship Arena Under the Floodlights',
          caption: 'Atmospheric panoramic view of the official Skouted Youth League stadium on game night.',
          category: 'Hero Banner',
          url: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&q=80&w=1800',
          matchTag: 'Stadium Showcase',
          tags: ['Stadium', 'Floodlights', 'Arena', 'Hero'],
          views: 890,
          likes: 160,
          isPublished: true
        },
        {
          title: 'Youth Academy Grassroots Development Clinic',
          caption: 'Technical director guiding under-17 academy prospects through positional rondos.',
          category: 'About Highlight',
          url: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&q=80&w=1600',
          matchTag: 'Academy Clinic',
          tags: ['Academy', 'Grassroots', 'Development', 'Future'],
          views: 430,
          likes: 72,
          isPublished: true
        }
      ];

      await MediaItem.insertMany(galleryItems);
      console.log(`[Media Seeder] Inserted ${galleryItems.length} gallery & media items.`);
    } else {
      console.log(`[Media Seeder] Media items already exist (${mediaCount} found).`);
    }

    console.log('[Media Seeder] Media database seeding complete!');
  } catch (err) {
    console.error('[Media Seeder Error]:', err);
  } finally {
    await mongoose.disconnect();
    console.log('[Media Seeder] Database disconnected.');
  }
}

if (require.main === module) {
  seedMedia();
}

module.exports = { seedMedia };

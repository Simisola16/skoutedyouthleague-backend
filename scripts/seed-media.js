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

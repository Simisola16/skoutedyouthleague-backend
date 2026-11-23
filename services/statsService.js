const Fixture = require('../models/Fixture');
const MatchEvent = require('../models/MatchEvent');
const Player = require('../models/Player');
const { broadcastLeadersUpdate } = require('./socketService');

const PLAYED_OR_LIVE_STATUSES = ['FT', '1ST HALF', 'HT', '2ND HALF', 'PENS', 'LIVE'];

function toIdStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (val._id) return val._id.toString();
  if (typeof val.toString === 'function') return val.toString();
  return null;
}

function isGoalkeeperRole(position = '', subPosition = '') {
  const p = String(position || '').trim().toUpperCase();
  const sp = String(subPosition || '').trim().toUpperCase();
  return p === 'GK' || p.includes('GOAL') || sp === 'GK' || sp.startsWith('GK ') || sp.startsWith('GK-');
}

/**
 * Build the official tournament leaders payload (used by GET /api/stats/leaders & Socket.IO broadcasts)
 */
async function getLeadersPayload(limit = 50) {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const [topScorers, topAssists, topKeepers, totalGoalsAgg, totalAssistsAgg, totalMatches] = await Promise.all([
    Player.find({ 'stats.goals': { $gt: 0 }, isDeleted: { $ne: true } })
      .populate('team', 'name shortCode logo logoUrl stats')
      .sort({ 'stats.goals': -1, 'stats.assists': -1, 'stats.matches': 1 })
      .limit(parsedLimit),

    Player.find({ 'stats.assists': { $gt: 0 }, isDeleted: { $ne: true } })
      .populate('team', 'name shortCode logo logoUrl stats')
      .sort({ 'stats.assists': -1, 'stats.goals': -1, 'stats.matches': 1 })
      .limit(parsedLimit),

    Player.find({
      isDeleted: { $ne: true },
      $or: [
        { position: { $regex: /^(gk|goalkeeper)$/i } },
        { subPosition: { $regex: /^gk(\b|\s|-)/i } }
      ]
    })
      .populate('team', 'name shortCode logo logoUrl stats')
      .sort({ 'stats.cleanSheets': -1, 'stats.matches': -1 })
      .limit(parsedLimit),

    Player.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$stats.goals' } } }
    ]),

    Player.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$stats.assists' } } }
    ]),

    Fixture.countDocuments({ status: 'FT', isDeleted: { $ne: true } })
  ]);

  return {
    topScorers,
    topAssists,
    topKeepers,
    totalGoals: totalGoalsAgg[0]?.total || 0,
    totalAssists: totalAssistsAgg[0]?.total || 0,
    totalMatches
  };
}

let recalcLock = null;

/**
 * Single source of truth: Recalculate EVERY player's official season stats directly from
 * all non-deleted played/live Fixtures (lineups + scores) and MatchEvents (goals, assists, cards, subs).
 * Guarantees zero drift on event edits/deletions and accurate per-player matches, minutes & clean sheets.
 */
async function recalculateAllPlayerStats() {
  if (recalcLock) {
    return recalcLock;
  }

  recalcLock = (async () => {
    try {
      const [players, fixtures] = await Promise.all([
        Player.find({ isDeleted: { $ne: true } })
          .select('_id team position subPosition stats')
          .lean(),
        Fixture.find({
          isDeleted: { $ne: true },
          status: { $in: PLAYED_OR_LIVE_STATUSES }
        })
          .select('_id homeTeam awayTeam status minute homeScore awayScore homeLineup awayLineup')
          .lean()
      ]);

      const fixtureIds = fixtures.map(f => f._id);
      const events = fixtureIds.length > 0
        ? await MatchEvent.find({ fixture: { $in: fixtureIds } })
            .select('fixture minute type team player assistPlayer inPlayer outPlayer')
            .lean()
        : [];

      // Group events by fixture ID
      const eventsByFixture = new Map();
      for (const ev of events) {
        const fId = toIdStr(ev.fixture);
        if (!fId) continue;
        if (!eventsByFixture.has(fId)) eventsByFixture.set(fId, []);
        eventsByFixture.get(fId).push(ev);
      }

      // Initialize clean zeroed stats map + player metadata lookup
      const statsMap = new Map();
      const playerMeta = new Map();
      for (const p of players) {
        const pId = toIdStr(p._id);
        playerMeta.set(pId, {
          teamId: toIdStr(p.team),
          isGk: isGoalkeeperRole(p.position, p.subPosition)
        });
        statsMap.set(pId, {
          matches: 0,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
          cleanSheets: 0,
          minutesPlayed: 0
        });
      }

      // Accumulate stats fixture by fixture
      for (const fixture of fixtures) {
        const fId = toIdStr(fixture._id);
        const fEvents = eventsByFixture.get(fId) || [];
        const isFT = fixture.status === 'FT';
        const matchEndMin = isFT
          ? Math.max(90, Number(fixture.minute) || 90)
          : Math.max(1, Number(fixture.minute) || 1);

        const appeared = new Set();
        const started = new Set();
        const subInMin = new Map();
        const exitMin = new Map(); // subbed off or red carded
        const homeGkPlayed = new Set();
        const awayGkPlayed = new Set();

        const homeTeamId = toIdStr(fixture.homeTeam);
        const awayTeamId = toIdStr(fixture.awayTeam);

        // 1. Starting XIs count as appearances (and identify playing goalkeepers)
        const homeXI = fixture.homeLineup?.startingXI || [];
        for (const slot of homeXI) {
          const pId = toIdStr(slot.player);
          if (!pId || !statsMap.has(pId)) continue;
          appeared.add(pId);
          started.add(pId);
          if (isGoalkeeperRole(slot.position) || playerMeta.get(pId)?.isGk) {
            homeGkPlayed.add(pId);
          }
        }

        const awayXI = fixture.awayLineup?.startingXI || [];
        for (const slot of awayXI) {
          const pId = toIdStr(slot.player);
          if (!pId || !statsMap.has(pId)) continue;
          appeared.add(pId);
          started.add(pId);
          if (isGoalkeeperRole(slot.position) || playerMeta.get(pId)?.isGk) {
            awayGkPlayed.add(pId);
          }
        }

        // 2. Match events: goals, assists, cards, substitutions
        for (const ev of fEvents) {
          const evMin = Math.max(0, Number(ev.minute) || 0);
          const pId = toIdStr(ev.player);
          const assistId = toIdStr(ev.assistPlayer);
          const inId = toIdStr(ev.inPlayer);
          const outId = toIdStr(ev.outPlayer);
          const evTeamId = toIdStr(ev.team);

          if (ev.type === 'GOAL') {
            if (pId && statsMap.has(pId)) {
              statsMap.get(pId).goals += 1;
              appeared.add(pId);
            }
            if (assistId && assistId !== pId && statsMap.has(assistId)) {
              statsMap.get(assistId).assists += 1;
              appeared.add(assistId);
            }
          } else if (ev.type === 'OWN_GOAL' || ev.type === 'PENALTY_MISSED') {
            if (pId && statsMap.has(pId)) {
              appeared.add(pId);
            }
          } else if (ev.type === 'YELLOW_CARD') {
            if (pId && statsMap.has(pId)) {
              statsMap.get(pId).yellowCards += 1;
              appeared.add(pId);
            }
          } else if (ev.type === 'RED_CARD') {
            if (pId && statsMap.has(pId)) {
              statsMap.get(pId).redCards += 1;
              appeared.add(pId);
              if (!exitMin.has(pId) || evMin < exitMin.get(pId)) {
                exitMin.set(pId, evMin);
              }
            }
          } else if (ev.type === 'SUB_IN' || ev.type === 'SUBSTITUTION') {
            const effectiveIn = inId || pId;
            const effectiveOut = outId || assistId;

            if (effectiveIn && statsMap.has(effectiveIn)) {
              appeared.add(effectiveIn);
              if (!started.has(effectiveIn)) {
                subInMin.set(effectiveIn, evMin);
              }
              if (playerMeta.get(effectiveIn)?.isGk) {
                if (evTeamId === homeTeamId || playerMeta.get(effectiveIn)?.teamId === homeTeamId) {
                  homeGkPlayed.add(effectiveIn);
                } else if (evTeamId === awayTeamId || playerMeta.get(effectiveIn)?.teamId === awayTeamId) {
                  awayGkPlayed.add(effectiveIn);
                }
              }
            }

            if (effectiveOut && statsMap.has(effectiveOut)) {
              appeared.add(effectiveOut);
              if (!exitMin.has(effectiveOut) || evMin < exitMin.get(effectiveOut)) {
                exitMin.set(effectiveOut, evMin);
              }
            }
          } else if (ev.type === 'SUB_OUT') {
            const effectiveOut = outId || pId;
            if (effectiveOut && statsMap.has(effectiveOut)) {
              appeared.add(effectiveOut);
              if (!exitMin.has(effectiveOut) || evMin < exitMin.get(effectiveOut)) {
                exitMin.set(effectiveOut, evMin);
              }
            }
          }
        }

        // 3. Credit matches played & minutes played for every distinct player who appeared in this fixture
        for (const pId of appeared) {
          const st = statsMap.get(pId);
          if (!st) continue;
          st.matches += 1;

          const startM = started.has(pId)
            ? 0
            : (subInMin.has(pId) ? subInMin.get(pId) : 0);
          const endM = exitMin.has(pId) ? exitMin.get(pId) : matchEndMin;
          const playedMins = Math.max(1, endM - startM);
          st.minutesPlayed += playedMins;
        }

        // 4. Credit clean sheets on completed FT matches when opponent scored 0
        if (isFT) {
          if ((fixture.awayScore || 0) === 0) {
            for (const gkId of homeGkPlayed) {
              if (statsMap.has(gkId)) statsMap.get(gkId).cleanSheets += 1;
            }
          }
          if ((fixture.homeScore || 0) === 0) {
            for (const gkId of awayGkPlayed) {
              if (statsMap.has(gkId)) statsMap.get(gkId).cleanSheets += 1;
            }
          }
        }
      }

      // 5. Persist all player stats cleanly in one bulkWrite
      const bulkOps = [];
      for (const p of players) {
        const pId = toIdStr(p._id);
        const nextStats = statsMap.get(pId);
        const cur = p.stats || {};
        const changed =
          (cur.matches || 0) !== nextStats.matches ||
          (cur.goals || 0) !== nextStats.goals ||
          (cur.assists || 0) !== nextStats.assists ||
          (cur.yellowCards || 0) !== nextStats.yellowCards ||
          (cur.redCards || 0) !== nextStats.redCards ||
          (cur.cleanSheets || 0) !== nextStats.cleanSheets ||
          (cur.minutesPlayed || 0) !== nextStats.minutesPlayed;

        if (changed) {
          bulkOps.push({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { stats: nextStats } }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        await Player.bulkWrite(bulkOps);
      }

      // 6. Build fresh leaders payload and broadcast real-time update to all connected clients
      const leaders = await getLeadersPayload(50);
      broadcastLeadersUpdate(leaders);

      console.log(
        `[StatsService] ✅ Recalculated stats for ${players.length} players (${bulkOps.length} updated) across ${fixtures.length} matches | Goals: ${leaders.totalGoals}, Assists: ${leaders.totalAssists}`
      );

      return { updatedPlayers: bulkOps.length, leaders };
    } catch (err) {
      console.error('[StatsService] ❌ Recalculate Player Stats Error:', err);
      throw err;
    }
  })().finally(() => {
    recalcLock = null;
  });

  return recalcLock;
}

module.exports = {
  recalculateAllPlayerStats,
  getLeadersPayload
};

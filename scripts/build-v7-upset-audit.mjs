import {
  TEAM_STATS_URL,
  buildV7Result,
  gamePostgameStats,
  loadResearchData,
  parseCsv,
  special2026Reviews,
  writeJson,
} from './v7-intelligence-core.mjs';

const data = await loadResearchData();
// This file is read only after outcomes for postgame explanation. It is never
// offered to buildV7Result, whose feature eligibility is locked to 2021–2025
// same-season prior weeks.
const currentStatsResponse = await fetch(TEAM_STATS_URL(2026));
const currentStats = currentStatsResponse.ok ? parseCsv(await currentStatsResponse.text()) : [];
const postgameData = { ...data, teamStats: new Map(data.teamStats).set(2026, currentStats) };
const { output, oos } = buildV7Result(data);
const marketUpsets = oos
  .filter((row) => Math.max(row.marketProbability, 1 - row.marketProbability) >= 0.7)
  .filter((row) => row.upset.favorite !== (row.y ? row.home : row.away))
  .sort((left, right) => Math.max(right.marketProbability, 1 - right.marketProbability) - Math.max(left.marketProbability, 1 - left.marketProbability))
  .map((row) => ({
    season: row.season, week: row.week, gameId: row.gameId, away: row.away, home: row.home,
    marketHomeProbability: row.marketProbability, footballHomeProbability: row.footballProbability,
    v7ReferenceHomeProbability: row[`final_${String(output.v7Reference.scale).replace('.', '_')}`],
    favorite: row.upset.favorite, upsetRisk: row.upset.level, upsetAdjustment: row.upset.adjustment,
    winner: row.y ? row.home : row.away, postgameScore: { away: row.awayScore, home: row.homeScore },
    pregameFeatureCutoff: `season ${row.season}, week ${row.week - 1} or earlier`,
    pregameReasons: row.reasons,
    postgameEvidence: gamePostgameStats(data.teamStats.get(row.season) ?? [], row.gameId, row.home, row.away),
    playerAbsences: 'UNAVAILABLE: no timestamped historical availability archive.',
    marketMovement: 'UNAVAILABLE: closing-line proxy has no observation history.',
    inGameInjuries: 'UNAVAILABLE: do not infer from the result.',
    matchedControls: 'Research pending: match variables requiring timestamped availability were unavailable.',
  }));
const audit = {
  version: output.version, generatedAt: new Date().toISOString(), status: 'SHADOW_ONLY', productionInfluence: 0,
  guardrails: output.caveats,
  historical: {
    favoriteBuckets: [
      [0.7, 0.75], [0.75, 0.8], [0.8, 0.85], [0.85, 1.001],
    ].map(([lower, upper]) => {
      const rows = oos.filter((row) => {
        const confidence = Math.max(row.marketProbability, 1 - row.marketProbability);
        return confidence >= lower && confidence < upper;
      });
      const losses = rows.filter((row) => row.upset.favorite !== (row.y ? row.home : row.away));
      return {
        bucket: `${Math.round(lower * 100)}–${Math.round((upper - 0.001) * 100)}%`, games: rows.length,
        favoriteLosses: losses.length, flaggedUpsets: losses.filter((row) => row.upset.level !== 'LOW').length,
        falseUpsetFlags: rows.filter((row) => row.upset.level !== 'LOW' && row.upset.favorite === (row.y ? row.home : row.away)).length,
      };
    }),
    favoriteUpsets: marketUpsets,
  },
  special2026Reviews: special2026Reviews(postgameData),
  verdict: 'This is a research audit. It does not treat a surprise result as proof that a pregame signal existed.',
};
await writeJson('outputs/v7-upset-audit.json', audit);
console.log('V7 upset audit completed.');
console.log(`Historical 70%+ favorite upsets: ${marketUpsets.length}`);
console.log(`Flagged before outcome by research rule: ${marketUpsets.filter((row) => row.upsetRisk !== 'LOW').length}`);
console.log('Wrote outputs/v7-upset-audit.json');

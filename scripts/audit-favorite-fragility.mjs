import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = resolve('lib/historical-backtest-data.ts');
const outputPath = resolve('outputs/week1-favorite-fragility-audit.json');

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function clampProbability(value) {
  return Math.min(1 - 1e-12, Math.max(1e-12, value));
}

function marketGame(record) {
  const homeProbability = record.closingMarket?.homeProbability;
  if (
    record.phase !== 'Regular season' ||
    record.winner === 'Tie' ||
    !Number.isFinite(homeProbability) ||
    homeProbability <= 0 ||
    homeProbability >= 1
  )
    return null;
  const favoriteIsHome = homeProbability >= 0.5;
  const favorite = favoriteIsHome ? record.home : record.away;
  const favoriteProbability = Math.max(homeProbability, 1 - homeProbability);
  const favoriteWon = record.winner === favorite;
  const homeWon = record.winner === record.home ? 1 : 0;
  const brier = (homeWon - homeProbability) ** 2;
  const logLoss = -Math.log(
    clampProbability(homeWon ? homeProbability : 1 - homeProbability),
  );
  return {
    gameId: record.gameId,
    season: record.season,
    week: record.week,
    away: record.away,
    home: record.home,
    favorite,
    favoriteProbability,
    favoriteWon,
    expectedLoss: 1 - favoriteProbability,
    brier,
    logLoss,
  };
}

function summarize(label, games) {
  const favoriteWins = games.filter((game) => game.favoriteWon).length;
  const confidence = mean(games.map((game) => game.favoriteProbability));
  const observedWinRate = games.length ? favoriteWins / games.length : null;
  const expectedLosses = games.reduce((sum, game) => sum + game.expectedLoss, 0);
  const actualLosses = games.length - favoriteWins;
  return {
    label,
    games: games.length,
    favoriteWins,
    favoriteLosses: actualLosses,
    favoriteWinRate: observedWinRate,
    averageFavoriteProbability: confidence,
    calibrationGap:
      observedWinRate === null || confidence === null
        ? null
        : observedWinRate - confidence,
    expectedLosses,
    actualLosses,
    excessLosses: actualLosses - expectedLosses,
    brier: mean(games.map((game) => game.brier)),
    logLoss: mean(games.map((game) => game.logLoss)),
  };
}

const source = await readFile(sourcePath, 'utf8');
const start = source.indexOf('HISTORICAL_BACKTEST = ');
const end = source.lastIndexOf(' as const;');
if (start < 0 || end <= start)
  throw new Error('Historical benchmark artifact is malformed.');
const historical = JSON.parse(
  source.slice(start + 'HISTORICAL_BACKTEST = '.length, end),
);
const games = historical.records.map(marketGame).filter(Boolean);

const probabilityBuckets = [
  { label: '50.0%–54.9%', lower: 0.5, upper: 0.55 },
  { label: '55.0%–59.9%', lower: 0.55, upper: 0.6 },
  { label: '60.0%–69.9%', lower: 0.6, upper: 0.7 },
  { label: '70.0%–79.9%', lower: 0.7, upper: 0.8 },
  { label: '80.0%+', lower: 0.8, upper: 1.0000001 },
];
const periodBuckets = [
  { label: 'Weeks 1–4', test: (game) => game.week >= 1 && game.week <= 4 },
  { label: 'Weeks 5–9', test: (game) => game.week >= 5 && game.week <= 9 },
  { label: 'Weeks 10–14', test: (game) => game.week >= 10 && game.week <= 14 },
  { label: 'Weeks 15–18', test: (game) => game.week >= 15 && game.week <= 18 },
];

const output = {
  version: 'WEEK1-FAVORITE-FRAGILITY-AUDIT-1.0',
  generatedAt: new Date().toISOString(),
  scope:
    '2021–2025 regular-season games with a decided result and a closing no-vig market probability.',
  guardrails: [
    'This is a diagnostic only; it does not alter V2 probabilities, V2 weights, specialist weights, or betting recommendations.',
    'Probability buckets and early-season periods are fixed before inspecting the 2026 results.',
    'The historical market inputs are closing-line proxies and are not evidence of a same-time betting edge.',
  ],
  overall: summarize('All regular-season market games', games),
  byFavoriteProbability: probabilityBuckets.map((bucket) =>
    summarize(
      bucket.label,
      games.filter(
        (game) =>
          game.favoriteProbability >= bucket.lower &&
          game.favoriteProbability < bucket.upper,
      ),
    ),
  ),
  bySeason: [...new Set(games.map((game) => game.season))].map((season) =>
    summarize(String(season), games.filter((game) => game.season === season)),
  ),
  earlySeasonByFavoriteProbability: probabilityBuckets.map((bucket) =>
    summarize(
      `Weeks 1–4 · ${bucket.label}`,
      games.filter(
        (game) =>
          game.week <= 4 &&
          game.favoriteProbability >= bucket.lower &&
          game.favoriteProbability < bucket.upper,
      ),
    ),
  ),
  bySeasonPeriod: periodBuckets.map((bucket) =>
    summarize(bucket.label, games.filter(bucket.test)),
  ),
  highestProbabilityLosses: games
    .filter((game) => !game.favoriteWon)
    .sort((left, right) => right.favoriteProbability - left.favoriteProbability)
    .slice(0, 30),
};

await mkdir(resolve('outputs'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log('Week 1 favorite-fragility audit completed.');
console.log(
  `${output.overall.games} regular-season market games; ${output.overall.actualLosses} favorite losses versus ${output.overall.expectedLosses.toFixed(1)} expected.`,
);
for (const row of output.earlySeasonByFavoriteProbability) {
  console.log(
    `${row.label}: n=${row.games}, win=${row.favoriteWinRate === null ? 'n/a' : `${(row.favoriteWinRate * 100).toFixed(1)}%`}, expected losses=${row.expectedLosses.toFixed(1)}, actual losses=${row.actualLosses}.`,
  );
}
console.log(`Wrote ${outputPath}`);

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const OUTPUT_PATH = resolve('lib/historical-backtest-data.ts');
const TEST_SEASONS = [2021, 2022, 2023, 2024, 2025];
const WARMUP_SEASON = 2020;

// These constants mirror the production desk's strength + venue architecture.
// They were fixed before the 2025 holdout replay and are never tuned during it.
const HOME_FIELD_EDGE = 1.1;
const LOGISTIC_SCALE = 4.8;
const OFFSEASON_CARRY = 0.65;
const MAX_MARGIN_UPDATE = 1.4;
const MARGIN_UPDATE_RATE = 0.1;
const MODEL_VERSION = 'HIST-STR-1.0';

function parseCsvRow(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(source) {
  const lines = source.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mean(items) {
  return items.length
    ? items.reduce((total, item) => total + item, 0) / items.length
    : null;
}

function percentile(items, ratio) {
  if (!items.length) return null;
  const ordered = [...items].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))
  ];
}

function wilsonInterval(correct, total) {
  if (!total) return null;
  const z = 1.96;
  const rate = correct / total;
  const denominator = 1 + z ** 2 / total;
  const center = (rate + z ** 2 / (2 * total)) / denominator;
  const radius =
    (z * Math.sqrt((rate * (1 - rate)) / total + z ** 2 / (4 * total ** 2))) /
    denominator;
  return { low: center - radius, high: center + radius };
}

function phaseFor(gameType) {
  return gameType === 'REG' ? 'Regular season' : 'Postseason';
}

function summary(records) {
  const graded = records.filter((record) => record.winner !== 'Tie');
  const correct = graded.filter((record) => record.correct).length;
  const brier = mean(
    graded.map(
      (record) =>
        (record.homeProbability - (record.winner === record.home ? 1 : 0)) ** 2,
    ),
  );
  const logLoss = mean(
    graded.map((record) => {
      const outcome = record.winner === record.home ? 1 : 0;
      const probability = clamp(record.homeProbability, 0.01, 0.99);
      return -(
        outcome * Math.log(probability) +
        (1 - outcome) * Math.log(1 - probability)
      );
    }),
  );
  const marginErrors = graded.map((record) =>
    Math.abs(record.expectedHomeMargin - record.actualHomeMargin),
  );
  return {
    games: graded.length,
    tiesExcluded: records.length - graded.length,
    correct,
    incorrect: graded.length - correct,
    accuracy: graded.length ? correct / graded.length : null,
    accuracyInterval95: wilsonInterval(correct, graded.length),
    brier,
    logLoss,
    marginMae: mean(marginErrors),
    marginMedianAbsoluteError: percentile(marginErrors, 0.5),
  };
}

function calibration(records) {
  const boundaries = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.001];
  return boundaries.slice(0, -1).flatMap((lower, index) => {
    const upper = boundaries[index + 1];
    const bucket = records.filter((record) => {
      if (record.winner === 'Tie') return false;
      const confidence = Math.max(
        record.homeProbability,
        1 - record.homeProbability,
      );
      return confidence >= lower && confidence < upper;
    });
    if (!bucket.length) return [];
    const averageConfidence = mean(
      bucket.map((record) =>
        Math.max(record.homeProbability, 1 - record.homeProbability),
      ),
    );
    const realizedRate =
      bucket.filter((record) => record.correct).length / bucket.length;
    return [
      {
        label: `${Math.round(lower * 100)}–${Math.round((upper - 0.001) * 100)}%`,
        games: bucket.length,
        predicted: averageConfidence,
        actual: realizedRate,
        gap: realizedRate - averageConfidence,
      },
    ];
  });
}

function createHashFor(snapshot) {
  return createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex')
    .slice(0, 16);
}

const response = await fetch(SOURCE_URL, {
  headers: { 'user-agent': 'NFL Forecast Desk historical backtest builder' },
});
if (!response.ok)
  throw new Error(`Historical schedule data returned ${response.status}.`);

const rows = parseCsv(await response.text());
const games = rows
  .filter((row) => {
    const season = Number(row.season);
    return (
      season >= WARMUP_SEASON &&
      season <= TEST_SEASONS.at(-1) &&
      ['REG', 'WC', 'DIV', 'CON', 'SB'].includes(row.game_type) &&
      Number.isFinite(Number(row.home_score)) &&
      Number.isFinite(Number(row.away_score)) &&
      row.gameday
    );
  })
  .map((row) => ({
    id: row.game_id,
    season: Number(row.season),
    week: Number(row.week),
    gameType: row.game_type,
    day: row.gameday,
    away: row.away_team,
    home: row.home_team,
    awayScore: Number(row.away_score),
    homeScore: Number(row.home_score),
    neutral: row.location === 'Neutral',
  }))
  .sort(
    (left, right) =>
      left.season - right.season ||
      left.day.localeCompare(right.day) ||
      left.id.localeCompare(right.id),
  );

const rating = new Map();
let activeSeason = null;
const records = [];

for (let start = 0; start < games.length;) {
  const first = games[start];
  if (first.season !== activeSeason) {
    if (activeSeason !== null) {
      for (const [team, value] of rating)
        rating.set(team, value * OFFSEASON_CARRY);
    }
    activeSeason = first.season;
  }

  let end = start + 1;
  while (
    end < games.length &&
    games[end].season === first.season &&
    games[end].day === first.day
  ) {
    end += 1;
  }

  // Every game on a calendar day receives its frozen prediction before the
  // batch's final scores can affect any subsequent rating state.
  const batch = games.slice(start, end).map((game) => {
    const homeRating = rating.get(game.home) ?? 0;
    const awayRating = rating.get(game.away) ?? 0;
    const expectedHomeMargin =
      homeRating - awayRating + (game.neutral ? 0 : HOME_FIELD_EDGE);
    const homeProbability = clamp(
      logistic(expectedHomeMargin / LOGISTIC_SCALE),
      0.05,
      0.95,
    );
    const prediction = {
      gameId: game.id,
      season: game.season,
      week: game.week,
      phase: phaseFor(game.gameType),
      predictionTimestamp: `${game.day}T00:00:00.000Z`,
      dataCutoff: `Results through ${game.day} 00:00 UTC`,
      modelVersion: MODEL_VERSION,
      home: game.home,
      away: game.away,
      neutral: game.neutral,
      homeRating: Number(homeRating.toFixed(3)),
      awayRating: Number(awayRating.toFixed(3)),
      homeProbability: Number(homeProbability.toFixed(6)),
      expectedHomeMargin: Number(expectedHomeMargin.toFixed(3)),
      predictedWinner: homeProbability >= 0.5 ? game.home : game.away,
    };
    return { game, prediction, predictionHash: createHashFor(prediction) };
  });

  for (const { game, prediction, predictionHash } of batch) {
    if (game.season >= TEST_SEASONS[0]) {
      const actualHomeMargin = game.homeScore - game.awayScore;
      const winner =
        actualHomeMargin === 0
          ? 'Tie'
          : actualHomeMargin > 0
            ? game.home
            : game.away;
      records.push({
        ...prediction,
        predictionHash,
        awayScore: game.awayScore,
        homeScore: game.homeScore,
        actualHomeMargin,
        winner,
        correct:
          winner === 'Tie' ? null : prediction.predictedWinner === winner,
      });
    }
  }

  for (const { game, prediction } of batch) {
    if (game.homeScore === game.awayScore) continue;
    const actualHomeMargin = game.homeScore - game.awayScore;
    const residual = actualHomeMargin - prediction.expectedHomeMargin;
    const adjustment = clamp(
      residual * MARGIN_UPDATE_RATE,
      -MAX_MARGIN_UPDATE,
      MAX_MARGIN_UPDATE,
    );
    rating.set(game.home, (rating.get(game.home) ?? 0) + adjustment);
    rating.set(game.away, (rating.get(game.away) ?? 0) - adjustment);
  }
  start = end;
}

const bySeason = TEST_SEASONS.map((season) => {
  const seasonRecords = records.filter((record) => record.season === season);
  return {
    season,
    overall: summary(seasonRecords),
    regularSeason: summary(
      seasonRecords.filter((record) => record.phase === 'Regular season'),
    ),
    postseason: summary(
      seasonRecords.filter((record) => record.phase === 'Postseason'),
    ),
  };
});
const overall = summary(records);
const regularSeason = summary(
  records.filter((record) => record.phase === 'Regular season'),
);
const postseason = summary(
  records.filter((record) => record.phase === 'Postseason'),
);
const holdout = bySeason.find((season) => season.season === 2025);
const worstMisses = records
  .filter((record) => !record.correct && record.winner !== 'Tie')
  .sort((left, right) => {
    const leftConfidence = Math.max(
      left.homeProbability,
      1 - left.homeProbability,
    );
    const rightConfidence = Math.max(
      right.homeProbability,
      1 - right.homeProbability,
    );
    return rightConfidence - leftConfidence;
  })
  .slice(0, 5)
  .map((record) => ({
    gameId: record.gameId,
    season: record.season,
    phase: record.phase,
    away: record.away,
    home: record.home,
    predictedWinner: record.predictedWinner,
    winner: record.winner,
    pickProbability: Number(
      Math.max(record.homeProbability, 1 - record.homeProbability).toFixed(4),
    ),
    expectedHomeMargin: record.expectedHomeMargin,
    actualHomeMargin: record.actualHomeMargin,
  }));

const output = `// Generated by scripts/build-historical-backtest.mjs. Do not edit by hand.\n\nexport const HISTORICAL_BACKTEST = ${JSON.stringify(
  {
    modelVersion: MODEL_VERSION,
    source: { label: 'nflverse game/schedule data', url: SOURCE_URL },
    seasons: TEST_SEASONS,
    generatedAt: new Date().toISOString(),
    methodology: {
      label: 'Common-feature chronological strength + venue replay',
      homeFieldEdge: HOME_FIELD_EDGE,
      logisticScale: LOGISTIC_SCALE,
      offseasonCarry: OFFSEASON_CARRY,
      updateRule:
        'After every calendar-day prediction batch, apply a capped margin-residual rating update.',
      freezeRule:
        'All games on the same calendar day are predicted before any score from that day updates team ratings.',
      holdoutRule:
        '2025 is reported as an untouched holdout; no constants were changed during its replay.',
    },
    limitations: [
      'This is a common-feature replay. Timestamp-correct historical injury, roster, weather, and odds snapshots were not available in the selected source and were excluded rather than inferred after the fact.',
      'Historical closing lines are not used as pregame inputs. The replay makes no historical ROI, CLV, spread-cover, or market-beating claim.',
      'The model does not assign tie probability; tied games are retained in the audit but excluded from binary winner metrics.',
    ],
    overall,
    regularSeason,
    postseason,
    holdout,
    bySeason,
    calibration: calibration(records),
    worstMisses,
    records,
  },
  null,
  2,
)} as const;\n`;

await writeFile(OUTPUT_PATH, output, 'utf8');
console.log(
  `Wrote ${records.length} locked historical prediction records to ${OUTPUT_PATH}.`,
);

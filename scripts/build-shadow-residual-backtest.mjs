import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const STAT_URL = (season) => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
const OUTPUT_PATH = resolve('outputs/v5-shadow-residual-backtest.json');
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const MIN_TRAINING_GAMES = 200;
const RIDGE = 8;
const LEARNING_RATE = 0.04;
const ITERATIONS = 500;
const RECENCY = 0.88;
const CORRECTION_SCALES = [0, 0.25, 0.5, 0.75, 1];

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      values.push(current);
      current = '';
    } else current += ch;
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function num(row, ...keys) {
  for (const key of keys) {
    const raw = row[key];
    if (raw === '' || raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function logit(p) {
  const q = clamp(p, 0.01, 0.99);
  return Math.log(q / (1 - q));
}

function impliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function noVigHomeProbability(homeMoneyline, awayMoneyline) {
  const home = impliedProbability(homeMoneyline);
  const away = impliedProbability(awayMoneyline);
  if (home === null || away === null || home + away <= 0) return null;
  return home / (home + away);
}

function weightedMean(rows, getter) {
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const value = getter(rows[index]);
    if (value === null) continue;
    const weight = Math.pow(RECENCY, rows.length - 1 - index);
    numerator += value * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function teamSnapshot(rows) {
  const ordered = [...rows].sort((a, b) => (num(a, 'week') ?? 0) - (num(b, 'week') ?? 0));
  const attempts = (row) => num(row, 'attempts', 'passing_attempts');
  return {
    passingEpa: weightedMean(ordered, (row) => num(row, 'passing_epa', 'pass_epa')),
    rushingEpa: weightedMean(ordered, (row) => num(row, 'rushing_epa', 'rush_epa')),
    receivingEpa: weightedMean(ordered, (row) => num(row, 'receiving_epa')),
    completionPct: weightedMean(ordered, (row) => {
      const direct = num(row, 'completion_percentage', 'completion_pct');
      if (direct !== null) return direct;
      const completions = num(row, 'completions');
      const att = attempts(row);
      return completions !== null && att ? completions / att : null;
    }),
    yardsPerAttempt: weightedMean(ordered, (row) => {
      const direct = num(row, 'yards_per_attempt', 'passing_yards_per_attempt');
      if (direct !== null) return direct;
      const yards = num(row, 'passing_yards');
      const att = attempts(row);
      return yards !== null && att ? yards / att : null;
    }),
    sackRate: weightedMean(ordered, (row) => {
      const direct = num(row, 'sack_rate');
      if (direct !== null) return direct;
      const sacks = num(row, 'sacks_suffered', 'sacks');
      const att = attempts(row);
      return sacks !== null && att !== null && sacks + att > 0 ? sacks / (sacks + att) : null;
    }),
    interceptionRate: weightedMean(ordered, (row) => {
      const direct = num(row, 'turnover_rate');
      if (direct !== null) return direct;
      const interceptions = num(row, 'passing_interceptions', 'interceptions');
      const att = attempts(row);
      return interceptions !== null && att ? interceptions / att : null;
    }),
    games: ordered.length,
  };
}

const FEATURE_NAMES = [
  'passingEpaDiff',
  'rushingEpaDiff',
  'receivingEpaDiff',
  'completionPctDiff',
  'yardsPerAttemptDiff',
  'sackRateDiff',
  'interceptionRateDiff',
];

function featureVector(home, away) {
  const pairs = [
    [home.passingEpa, away.passingEpa],
    [home.rushingEpa, away.rushingEpa],
    [home.receivingEpa, away.receivingEpa],
    [home.completionPct, away.completionPct],
    [home.yardsPerAttempt, away.yardsPerAttempt],
    [home.sackRate, away.sackRate],
    [home.interceptionRate, away.interceptionRate],
  ];
  if (pairs.some(([a, b]) => a === null || b === null)) return null;
  return pairs.map(([a, b]) => a - b);
}

function standardizer(rows) {
  const means = FEATURE_NAMES.map((_, j) => rows.reduce((sum, row) => sum + row.x[j], 0) / rows.length);
  const scales = FEATURE_NAMES.map((_, j) => {
    const variance = rows.reduce((sum, row) => sum + (row.x[j] - means[j]) ** 2, 0) / Math.max(1, rows.length - 1);
    const sd = Math.sqrt(variance);
    return sd > 1e-9 ? sd : 1;
  });
  return { means, scales };
}

function transform(x, scaler) {
  return x.map((value, j) => (value - scaler.means[j]) / scaler.scales[j]);
}

function fitOffsetLogistic(rows) {
  const scaler = standardizer(rows);
  const zRows = rows.map((row) => ({ ...row, z: transform(row.x, scaler) }));
  let beta = Array(FEATURE_NAMES.length).fill(0);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const gradient = Array(beta.length).fill(0);
    for (const row of zRows) {
      const residualLogit = beta.reduce((sum, value, j) => sum + value * row.z[j], 0);
      const p = sigmoid(logit(row.marketP) + residualLogit);
      for (let j = 0; j < beta.length; j += 1) gradient[j] += (p - row.y) * row.z[j];
    }
    for (let j = 0; j < beta.length; j += 1) {
      gradient[j] = gradient[j] / rows.length + (RIDGE / rows.length) * beta[j];
      beta[j] -= LEARNING_RATE * gradient[j];
    }
  }
  return { beta, scaler };
}

function correction(model, x) {
  const z = transform(x, model.scaler);
  return model.beta.reduce((sum, value, j) => sum + value * z[j], 0);
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function metrics(rows, probabilityKey) {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null };
  let correct = 0;
  const brier = [];
  const losses = [];
  for (const row of rows) {
    const p = clamp(row[probabilityKey], 0.01, 0.99);
    if ((p >= 0.5 ? 1 : 0) === row.y) correct += 1;
    brier.push((p - row.y) ** 2);
    losses.push(-(row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p)));
  }
  return { games: rows.length, accuracy: correct / rows.length, brier: mean(brier), logLoss: mean(losses) };
}

function calibration(rows, probabilityKey) {
  const bins = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.001];
  return bins.slice(0, -1).flatMap((lower, index) => {
    const upper = bins[index + 1];
    const bucket = rows.filter((row) => {
      const p = row[probabilityKey];
      const confidence = Math.max(p, 1 - p);
      return confidence >= lower && confidence < upper;
    });
    if (!bucket.length) return [];
    return [{
      label: `${Math.round(lower * 100)}-${Math.round((upper - 0.001) * 100)}%`,
      games: bucket.length,
      predicted: mean(bucket.map((row) => Math.max(row[probabilityKey], 1 - row[probabilityKey]))),
      actual: mean(bucket.map((row) => ((row[probabilityKey] >= 0.5 ? 1 : 0) === row.y ? 1 : 0)),
    }];
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const scheduleRows = parseCsv(await fetchText(SCHEDULE_URL));
const statsBySeason = new Map();
for (const season of SEASONS) {
  statsBySeason.set(season, parseCsv(await fetchText(STAT_URL(season))));
}

const games = scheduleRows
  .filter((row) => {
    const season = Number(row.season);
    return SEASONS.includes(season) && row.game_type === 'REG' && Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score));
  })
  .map((row) => ({
    season: Number(row.season),
    week: Number(row.week),
    gameId: row.game_id,
    home: row.home_team,
    away: row.away_team,
    homeScore: Number(row.home_score),
    awayScore: Number(row.away_score),
    marketP: noVigHomeProbability(row.home_moneyline, row.away_moneyline),
  }))
  .filter((game) => game.homeScore !== game.awayScore && game.marketP !== null && Number.isInteger(game.week))
  .sort((a, b) => a.season - b.season || a.week - b.week || a.gameId.localeCompare(b.gameId));

const featureRows = [];
for (const game of games) {
  const seasonStats = statsBySeason.get(game.season) ?? [];
  const prior = seasonStats.filter((row) => row.season_type === 'REG' && Number(row.week) < game.week);
  const homeRows = prior.filter((row) => (row.team || row.recent_team || row.posteam) === game.home);
  const awayRows = prior.filter((row) => (row.team || row.recent_team || row.posteam) === game.away);
  if (!homeRows.length || !awayRows.length) continue;
  const home = teamSnapshot(homeRows);
  const away = teamSnapshot(awayRows);
  const x = featureVector(home, away);
  if (!x) continue;
  featureRows.push({
    ...game,
    y: game.homeScore > game.awayScore ? 1 : 0,
    x,
    homeGamesInSample: home.games,
    awayGamesInSample: away.games,
  });
}

const oos = [];
for (const row of featureRows) {
  const training = featureRows.filter((candidate) => candidate.season < row.season || (candidate.season === row.season && candidate.week < row.week));
  if (training.length < MIN_TRAINING_GAMES) continue;
  const model = fitOffsetLogistic(training);
  const rawCorrection = correction(model, row.x);
  const record = { ...row, rawCorrection, marketProbability: row.marketP };
  for (const scale of CORRECTION_SCALES) {
    record[`p_${String(scale).replace('.', '_')}`] = sigmoid(logit(row.marketP) + scale * rawCorrection);
  }
  oos.push(record);
}

const candidates = CORRECTION_SCALES.map((scale) => {
  const key = `p_${String(scale).replace('.', '_')}`;
  const result = metrics(oos, key);
  const market = metrics(oos, 'marketProbability');
  return {
    scale,
    ...result,
    deltaBrierVsMarket: result.brier === null || market.brier === null ? null : result.brier - market.brier,
    deltaLogLossVsMarket: result.logLoss === null || market.logLoss === null ? null : result.logLoss - market.logLoss,
    deltaAccuracyVsMarket: result.accuracy === null || market.accuracy === null ? null : result.accuracy - market.accuracy,
  };
});

const bestByBrier = [...candidates].filter((item) => item.brier !== null).sort((a, b) => a.brier - b.brier)[0] ?? null;
const fullKey = 'p_1';
const marketMetrics = metrics(oos, 'marketProbability');
const fullMetrics = metrics(oos, fullKey);
const bySeason = SEASONS.map((season) => {
  const rows = oos.filter((row) => row.season === season);
  return {
    season,
    market: metrics(rows, 'marketProbability'),
    fullResidual: metrics(rows, fullKey),
  };
}).filter((item) => item.market.games > 0);

const output = {
  generatedAt: new Date().toISOString(),
  status: 'SHADOW_ONLY',
  productionInfluence: 0,
  model: 'V5 offset-logistic market residual challenger',
  caveat: 'Historical market inputs are nflverse closing moneylines without observation timestamps. This is a conservative diagnostic against a later-information market proxy, not a same-time betting-edge claim.',
  temporalPolicy: 'Every game uses team-stat rows from the same season with week strictly less than the forecast game week. Model coefficients for a test game are fit only on games from earlier seasons or earlier weeks.',
  source: { schedule: SCHEDULE_URL, teamStats: 'nflverse stats_team weekly releases' },
  features: FEATURE_NAMES,
  hyperparameters: { minimumTrainingGames: MIN_TRAINING_GAMES, ridge: RIDGE, learningRate: LEARNING_RATE, iterations: ITERATIONS, recency: RECENCY, correctionScales: CORRECTION_SCALES },
  coverage: { eligibleGames: featureRows.length, outOfSampleGames: oos.length },
  market: marketMetrics,
  candidates,
  bestByBrier,
  fullResidual: { ...fullMetrics, calibration: calibration(oos, fullKey) },
  marketCalibration: calibration(oos, 'marketProbability'),
  bySeason,
  verdict: bestByBrier?.scale === 0
    ? 'Zero football correction wins this shadow test. Do not promote the residual challenger.'
    : 'A nonzero correction is descriptively best in this shadow replay. It remains non-promotion-eligible until stability, bootstrap uncertainty, and prospective same-time validation are demonstrated.',
};

await mkdir(resolve('outputs'), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log('V5 shadow residual backtest generated.');
console.log(`Eligible feature games: ${output.coverage.eligibleGames}`);
console.log(`Chronological OOS games: ${output.coverage.outOfSampleGames}`);
console.log(`Market Brier: ${marketMetrics.brier?.toFixed(4) ?? 'n/a'}`);
console.log(`Market log loss: ${marketMetrics.logLoss?.toFixed(4) ?? 'n/a'}`);
for (const candidate of candidates) {
  console.log(`Scale ${candidate.scale}: Brier=${candidate.brier?.toFixed(4) ?? 'n/a'}, Δ=${candidate.deltaBrierVsMarket?.toFixed(4) ?? 'n/a'}, LogLoss=${candidate.logLoss?.toFixed(4) ?? 'n/a'}, Accuracy=${candidate.accuracy === null ? 'n/a' : `${(candidate.accuracy * 100).toFixed(2)}%`}`);
}
console.log(`Best Brier scale: ${bestByBrier?.scale ?? 'n/a'}`);
console.log(output.verdict);

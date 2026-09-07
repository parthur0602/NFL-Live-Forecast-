import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEDULE_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const statsUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const FEATURE_ORDER = [
  'passingEpa',
  'rushingEpa',
  'receivingEpa',
  'completionPct',
  'yardsPerAttempt',
  'sackRate',
  'interceptionRate',
];
const RIDGE = 8;
const ITERATIONS = 500;
const LEARNING_RATE = 0.04;
const OUTPUT = resolve('lib/v5-prospective-artifact.ts');

function parseLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current);
      current = '';
    } else current += character;
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function number(row, key) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
}

function metrics(row) {
  const attempts = number(row, 'attempts');
  const completions = number(row, 'completions');
  const passingYards = number(row, 'passing_yards');
  const sacks = number(row, 'sacks_suffered');
  const interceptions = number(row, 'passing_interceptions');
  return {
    passingEpa: number(row, 'passing_epa'),
    rushingEpa: number(row, 'rushing_epa'),
    receivingEpa: number(row, 'receiving_epa'),
    completionPct: attempts && completions !== null ? completions / attempts : null,
    yardsPerAttempt: attempts && passingYards !== null ? passingYards / attempts : null,
    sackRate: attempts !== null && sacks !== null && attempts + sacks > 0 ? sacks / (attempts + sacks) : null,
    interceptionRate: attempts && interceptions !== null ? interceptions / attempts : null,
  };
}

function average(rows) {
  if (!rows.length) return null;
  const totals = Object.fromEntries(FEATURE_ORDER.map((feature) => [feature, 0]));
  const counts = Object.fromEntries(FEATURE_ORDER.map((feature) => [feature, 0]));
  for (const row of rows) {
    const values = metrics(row);
    for (const feature of FEATURE_ORDER) {
      if (values[feature] === null) continue;
      totals[feature] += values[feature];
      counts[feature] += 1;
    }
  }
  const values = Object.fromEntries(
    FEATURE_ORDER.map((feature) => [feature, counts[feature] ? totals[feature] / counts[feature] : null]),
  );
  return Object.values(values).some((value) => value === null) ? null : values;
}

function logit(probability) {
  const safe = Math.max(0.01, Math.min(0.99, probability));
  return Math.log(safe / (1 - safe));
}

function sigmoid(value) {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function noVigHome(homeMoneyline, awayMoneyline) {
  const implied = (odds) =>
    odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  const home = Number(homeMoneyline);
  const away = Number(awayMoneyline);
  if (!Number.isFinite(home) || !Number.isFinite(away) || !home || !away) return null;
  const homeP = implied(home);
  const awayP = implied(away);
  return homeP / (homeP + awayP);
}

function standardize(rows) {
  const means = FEATURE_ORDER.map(
    (_, index) => rows.reduce((total, row) => total + row.x[index], 0) / rows.length,
  );
  const scales = FEATURE_ORDER.map((_, index) => {
    const variance = rows.reduce((total, row) => total + (row.x[index] - means[index]) ** 2, 0) / Math.max(1, rows.length - 1);
    return Math.sqrt(variance) || 1;
  });
  return { means, scales };
}

function fit(rows) {
  const standardization = standardize(rows);
  const beta = FEATURE_ORDER.map(() => 0);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const gradient = FEATURE_ORDER.map(() => 0);
    for (const row of rows) {
      const z = row.x.map((value, index) => (value - standardization.means[index]) / standardization.scales[index]);
      const residual = beta.reduce((total, coefficient, index) => total + coefficient * z[index], 0);
      const probability = sigmoid(logit(row.marketP) + residual);
      for (let index = 0; index < beta.length; index += 1)
        gradient[index] += (probability - row.y) * z[index];
    }
    for (let index = 0; index < beta.length; index += 1)
      beta[index] -= LEARNING_RATE * (gradient[index] / rows.length + (RIDGE / rows.length) * beta[index]);
  }
  return { coefficients: beta, standardization };
}

const [scheduleText, ...statsTexts] = await Promise.all([
  fetch(SCHEDULE_URL).then((response) => response.text()),
  ...SEASONS.map(async (season) => {
    const response = await fetch(statsUrl(season));
    if (!response.ok) throw new Error(`stats_team ${season} returned ${response.status}`);
    return response.text();
  }),
]);
const games = parseCsv(scheduleText).filter(
  (game) =>
    SEASONS.includes(Number(game.season)) &&
    game.game_type === 'REG' &&
    Number.isFinite(Number(game.home_score)) &&
    Number.isFinite(Number(game.away_score)) &&
    noVigHome(game.home_moneyline, game.away_moneyline) !== null,
);
const statsBySeason = new Map(
  SEASONS.map((season, index) => [
    season,
    parseCsv(statsTexts[index]).filter(
      (row) => Number(row.season) === season && row.season_type === 'REG' && Number.isFinite(Number(row.week)),
    ),
  ]),
);
const rows = [];
for (const game of games) {
  const season = Number(game.season);
  const week = Number(game.week);
  const seasonStats = statsBySeason.get(season) ?? [];
  const prior = seasonStats.filter((row) => Number(row.week) < week);
  const home = average(prior.filter((row) => row.team === game.home_team));
  const away = average(prior.filter((row) => row.team === game.away_team));
  if (!home || !away) continue;
  rows.push({
    x: FEATURE_ORDER.map((feature) => home[feature] - away[feature]),
    y: Number(game.home_score) > Number(game.away_score) ? 1 : 0,
    marketP: noVigHome(game.home_moneyline, game.away_moneyline),
  });
}
if (rows.length < 500) throw new Error(`Only ${rows.length} historical V5 rows were available.`);
const fitted = fit(rows);
const payload = {
  version: 'V5.0-PROSPECTIVE-SHADOW-FROZEN',
  status: 'SHADOW_ONLY',
  productionInfluence: 0,
  featureOrder: FEATURE_ORDER,
  coefficients: fitted.coefficients,
  standardization: fitted.standardization,
  trainingSeasons: SEASONS,
  trainingGames: rows.length,
  ridge: RIDGE,
  residualScale: 0.5,
  methodology: 'Market-offset logistic residual using all-prior same-season regular-season efficiency, equal weighting, no pseudo-game shrinkage.',
  sources: { schedule: SCHEDULE_URL, teamStats: 'nflverse stats_team weekly releases' },
};
const artifactHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const artifact = { ...payload, generatedAt: new Date().toISOString(), artifactHash };
await writeFile(
  OUTPUT,
  `// Generated by scripts/build-v5-prospective-artifact.mjs. Do not edit by hand.\n\nexport const V5_PROSPECTIVE_ARTIFACT = ${JSON.stringify(artifact, null, 2)} as const;\n`,
  'utf8',
);
console.log(`Wrote frozen V5 artifact (${rows.length} rows): ${artifactHash}`);

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEDULE_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const STAT_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
const OUTPUT_PATH = resolve('outputs/v5-residual-robustness.json');
const RUNTIME_DATA_PATH = resolve('lib/v5-residual-robustness-data.ts');
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const MIN_TRAINING_GAMES = 200;
const LEARNING_RATE = 0.04;
const ITERATIONS = 500;
const BOOTSTRAP_RESAMPLES = 5_000;
const CORRECTION_SCALES = [0, 0.1, 0.25, 0.5, 0.75, 1];
const RIDGE_VALUES = [4, 8, 16, 32];
const SHRINKAGE_VALUES = [0, 2, 4, 6];

const FEATURE_BUNDLES = {
  passing_epa_only: ['passingEpa'],
  rushing_epa_only: ['rushingEpa'],
  passing_sack_interception: ['passingEpa', 'sackRate', 'interceptionRate'],
  all_current_features: [
    'passingEpa',
    'rushingEpa',
    'receivingEpa',
    'completionPct',
    'yardsPerAttempt',
    'sackRate',
    'interceptionRate',
  ],
};

const RECENCY_VARIANTS = {
  decay_088_all_prior: { code: 'decay_088_all_prior', type: 'decay', decay: 0.88 },
  last_4_equal: { code: 'last_4_equal', type: 'last', count: 4 },
  last_6_equal: { code: 'last_6_equal', type: 'last', count: 6 },
  all_prior_equal: { code: 'all_prior_equal', type: 'equal' },
};

const TEAM_DIVISIONS = {
  ARI: 'NFC West', ATL: 'NFC South', BAL: 'AFC North', BUF: 'AFC East',
  CAR: 'NFC South', CHI: 'NFC North', CIN: 'AFC North', CLE: 'AFC North',
  DAL: 'NFC East', DEN: 'AFC West', DET: 'NFC North', GB: 'NFC North',
  HOU: 'AFC South', IND: 'AFC South', JAX: 'AFC South', KC: 'AFC West',
  LAC: 'AFC West', LAR: 'NFC West', LV: 'AFC West', MIA: 'AFC East',
  MIN: 'NFC North', NE: 'AFC East', NO: 'NFC South', NYG: 'NFC East',
  NYJ: 'AFC East', PHI: 'NFC East', PIT: 'AFC North', SEA: 'NFC West',
  SF: 'NFC West', TB: 'NFC South', TEN: 'AFC South', WSH: 'NFC East',
};

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else current += char;
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
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

function numeric(row, ...keys) {
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

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function logit(probability) {
  const safe = clamp(probability, 0.01, 0.99);
  return Math.log(safe / (1 - safe));
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

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const point = (sorted.length - 1) * probability;
  const lower = Math.floor(point);
  const upper = Math.ceil(point);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (point - lower);
}

function metricValues(row) {
  const attempts = numeric(row, 'attempts');
  const completions = numeric(row, 'completions');
  const passingYards = numeric(row, 'passing_yards');
  const sacks = numeric(row, 'sacks_suffered');
  const interceptions = numeric(row, 'passing_interceptions');
  return {
    passingEpa: numeric(row, 'passing_epa'),
    rushingEpa: numeric(row, 'rushing_epa'),
    receivingEpa: numeric(row, 'receiving_epa'),
    completionPct:
      completions !== null && attempts !== null && attempts > 0
        ? completions / attempts
        : null,
    yardsPerAttempt:
      passingYards !== null && attempts !== null && attempts > 0
        ? passingYards / attempts
        : null,
    sackRate:
      sacks !== null && attempts !== null && sacks + attempts > 0
        ? sacks / (sacks + attempts)
        : null,
    interceptionRate:
      interceptions !== null && attempts !== null && attempts > 0
        ? interceptions / attempts
        : null,
  };
}

function selectedRows(rows, variant) {
  const ordered = [...rows].sort(
    (left, right) => (numeric(left, 'week') ?? 0) - (numeric(right, 'week') ?? 0),
  );
  return variant.type === 'last' ? ordered.slice(-variant.count) : ordered;
}

function aggregateMetricRows(rows, variant) {
  const selected = selectedRows(rows, variant);
  const keys = FEATURE_BUNDLES.all_current_features;
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  const weights = Object.fromEntries(keys.map((key) => [key, 0]));
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index];
    const values = row.__metrics ?? metricValues(row);
    const weight =
      variant.type === 'decay'
        ? Math.pow(variant.decay, selected.length - 1 - index)
        : 1;
    for (const key of keys) {
      const value = values[key];
      if (value === null || !Number.isFinite(value)) continue;
      totals[key] += value * weight;
      weights[key] += weight;
    }
  }
  return {
    values: Object.fromEntries(
      keys.map((key) => [key, weights[key] ? totals[key] / weights[key] : null]),
    ),
    games: selected.length,
  };
}

function shrinkToLeague(team, league, pseudoGames) {
  if (!pseudoGames) return team.values;
  const keys = FEATURE_BUNDLES.all_current_features;
  return Object.fromEntries(
    keys.map((key) => {
      const value = team.values[key];
      const leagueValue = league.values[key];
      if (value === null || leagueValue === null) return [key, null];
      return [
        key,
        (value * team.games + leagueValue * pseudoGames) /
          (team.games + pseudoGames),
      ];
    }),
  );
}

function opponentAdjustedMetrics(row, priorRows, variant) {
  const opponent = row.opponent_team;
  const opponentDefenseRows = priorRows.filter(
    (candidate) =>
      candidate.opponent_team === opponent && candidate.game_id !== row.game_id,
  );
  const raw = metricValues(row);
  if (!opponentDefenseRows.length) return raw;
  const allowed = aggregateMetricRows(opponentDefenseRows, variant).values;
  return Object.fromEntries(
    FEATURE_BUNDLES.all_current_features.map((key) => {
      const value = raw[key];
      const defense = allowed[key];
      return [key, value === null || defense === null ? value : value - defense];
    }),
  );
}

function teamSnapshot(team, priorRows, config) {
  const teamRows = priorRows.filter((row) => row.team === team);
  const transformed = config.opponentAdjusted
    ? teamRows.map((row) => ({
        ...row,
        __metrics: opponentAdjustedMetrics(row, priorRows, config.recency),
      }))
    : teamRows;
  const aggregate = aggregateMetricRows(transformed, config.recency);
  const league = aggregateMetricRows(priorRows, config.recency);
  return {
    values: shrinkToLeague(aggregate, league, config.shrinkage),
    games: aggregate.games,
  };
}

function featureVector(home, away, bundle) {
  const vector = bundle.map((key) => {
    const homeValue = home.values[key];
    const awayValue = away.values[key];
    return homeValue === null || awayValue === null ? null : homeValue - awayValue;
  });
  return vector.some((value) => value === null) ? null : vector;
}

function standardizer(rows, width) {
  const means = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + row.x[column], 0) / rows.length,
  );
  const scales = Array.from({ length: width }, (_, column) => {
    const variance =
      rows.reduce(
        (sum, row) => sum + (row.x[column] - means[column]) ** 2,
        0,
      ) / Math.max(1, rows.length - 1);
    const standardDeviation = Math.sqrt(variance);
    return standardDeviation > 1e-9 ? standardDeviation : 1;
  });
  return { means, scales };
}

function fitOffsetLogistic(rows, ridge) {
  const scaler = standardizer(rows, rows[0].x.length);
  const standardized = rows.map((row) => ({
    ...row,
    z: row.x.map((value, index) => (value - scaler.means[index]) / scaler.scales[index]),
  }));
  const beta = Array(rows[0].x.length).fill(0);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const gradient = Array(beta.length).fill(0);
    for (const row of standardized) {
      const residual = beta.reduce(
        (sum, value, index) => sum + value * row.z[index],
        0,
      );
      const probability = sigmoid(logit(row.marketP) + residual);
      for (let index = 0; index < beta.length; index += 1) {
        gradient[index] += (probability - row.y) * row.z[index];
      }
    }
    for (let index = 0; index < beta.length; index += 1) {
      gradient[index] =
        gradient[index] / rows.length + (ridge / rows.length) * beta[index];
      beta[index] -= LEARNING_RATE * gradient[index];
    }
  }
  return { beta, scaler };
}

function correction(model, vector) {
  return model.beta.reduce(
    (sum, value, index) =>
      sum + value * ((vector[index] - model.scaler.means[index]) / model.scaler.scales[index]),
    0,
  );
}

function metricSummary(records, probability) {
  if (!records.length)
    return { games: 0, brier: null, logLoss: null, accuracy: null };
  let correct = 0;
  const brier = [];
  const logLoss = [];
  for (const row of records) {
    const value = clamp(probability(row), 0.01, 0.99);
    if ((value >= 0.5 ? 1 : 0) === row.y) correct += 1;
    brier.push((value - row.y) ** 2);
    logLoss.push(-(row.y * Math.log(value) + (1 - row.y) * Math.log(1 - value)));
  }
  return {
    games: records.length,
    brier: mean(brier),
    logLoss: mean(logLoss),
    accuracy: correct / records.length,
  };
}

function candidateSummary(records, scale) {
  const market = metricSummary(records, (row) => row.marketP);
  const challenger = metricSummary(records, (row) => row.probabilities[scale]);
  return {
    scale,
    ...challenger,
    deltaBrierVsMarket: challenger.brier - market.brier,
    deltaLogLossVsMarket: challenger.logLoss - market.logLoss,
    deltaAccuracyVsMarket: challenger.accuracy - market.accuracy,
  };
}

function preferredCandidate(candidates) {
  return [...candidates].sort(
    (left, right) =>
      left.brier - right.brier ||
      left.logLoss - right.logLoss ||
      left.scale - right.scale,
  )[0];
}

function gameKey(game) {
  return `${game.season}:${game.week}:${game.gameId}`;
}

function makeConfigs() {
  const baseline = {
    recency: RECENCY_VARIANTS.decay_088_all_prior,
    ridge: 8,
    shrinkage: 0,
    bundleCode: 'all_current_features',
    opponentAdjusted: false,
  };
  const entries = [{ code: 'baseline', ...baseline }];
  for (const recency of Object.values(RECENCY_VARIANTS)) {
    if (recency.code !== baseline.recency.code)
      entries.push({ code: `recency_${recency.code}`, ...baseline, recency });
  }
  for (const ridge of RIDGE_VALUES) {
    if (ridge !== baseline.ridge)
      entries.push({ code: `ridge_${ridge}`, ...baseline, ridge });
  }
  for (const shrinkage of SHRINKAGE_VALUES) {
    if (shrinkage !== baseline.shrinkage)
      entries.push({ code: `shrinkage_${shrinkage}`, ...baseline, shrinkage });
  }
  for (const bundleCode of Object.keys(FEATURE_BUNDLES)) {
    if (bundleCode !== baseline.bundleCode)
      entries.push({ code: `bundle_${bundleCode}`, ...baseline, bundleCode });
  }
  entries.push({
    code: 'opponent_adjusted_all_current_features',
    ...baseline,
    opponentAdjusted: true,
  });
  return entries;
}

function buildFeatureRows(games, statsBySeason, config, audit) {
  const bundle = FEATURE_BUNDLES[config.bundleCode];
  const rows = [];
  for (const game of games) {
    const seasonRows = statsBySeason.get(game.season) ?? [];
    const priorRows = seasonRows.filter(
      (row) =>
        Number(row.season) === game.season &&
        row.season_type === 'REG' &&
        Number(row.week) < game.week,
    );
    if (priorRows.some((row) => Number(row.week) >= game.week))
      throw new Error(`Temporal leakage in feature rows for ${gameKey(game)}.`);
    const home = teamSnapshot(game.home, priorRows, config);
    const away = teamSnapshot(game.away, priorRows, config);
    const vector = featureVector(home, away, bundle);
    if (!vector) continue;
    audit.featureGames += 1;
    rows.push({
      ...game,
      y: game.homeScore > game.awayScore ? 1 : 0,
      x: vector,
      homeGamesInSample: home.games,
      awayGamesInSample: away.games,
    });
  }
  return rows;
}

function chronologicalPredictions(featureRows, config, audit) {
  const periods = [...new Set(featureRows.map((row) => `${row.season}:${row.week}`))]
    .map((key) => key.split(':').map(Number))
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const records = [];
  for (const [season, week] of periods) {
    const testing = featureRows.filter(
      (row) => row.season === season && row.week === week,
    );
    const training = featureRows.filter(
      (row) =>
        row.season < season || (row.season === season && row.week < week),
    );
    if (
      training.some(
        (row) => !(row.season < season || (row.season === season && row.week < week)),
      )
    )
      throw new Error(`Temporal leakage in training for ${season} week ${week}.`);
    if (training.length < MIN_TRAINING_GAMES) continue;
    const model = fitOffsetLogistic(training, config.ridge);
    for (const row of testing) {
      const residual = correction(model, row.x);
      records.push({
        ...row,
        rawResidual: residual,
        probabilities: Object.fromEntries(
          CORRECTION_SCALES.map((scale) => [
            scale,
            sigmoid(logit(row.marketP) + scale * residual),
          ]),
        ),
      });
    }
  }
  audit.trainingGames += records.length;
  return records;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pairedBootstrap(records, scale) {
  const random = seededRandom(20260907);
  const brier = [];
  const logLoss = [];
  const accuracy = [];
  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample += 1) {
    let deltaBrier = 0;
    let deltaLogLoss = 0;
    let deltaAccuracy = 0;
    for (let index = 0; index < records.length; index += 1) {
      const row = records[Math.floor(random() * records.length)];
      const challenger = clamp(row.probabilities[scale], 0.01, 0.99);
      const market = clamp(row.marketP, 0.01, 0.99);
      deltaBrier += (challenger - row.y) ** 2 - (market - row.y) ** 2;
      deltaLogLoss +=
        -(row.y * Math.log(challenger) + (1 - row.y) * Math.log(1 - challenger)) -
        -(row.y * Math.log(market) + (1 - row.y) * Math.log(1 - market));
      deltaAccuracy +=
        (challenger >= 0.5 ? 1 : 0) === row.y ? 1 : 0;
      deltaAccuracy -= (market >= 0.5 ? 1 : 0) === row.y ? 1 : 0;
    }
    brier.push(deltaBrier / records.length);
    logLoss.push(deltaLogLoss / records.length);
    accuracy.push(deltaAccuracy / records.length);
  }
  brier.sort((left, right) => left - right);
  logLoss.sort((left, right) => left - right);
  accuracy.sort((left, right) => left - right);
  const summarize = (values, lowerIsBetter) => ({
    confidenceInterval95: [quantile(values, 0.025), quantile(values, 0.975)],
    probabilityBetter:
      values.filter((value) => (lowerIsBetter ? value < 0 : value > 0)).length /
      values.length,
  });
  const point = candidateSummary(records, scale);
  return {
    resamples: BOOTSTRAP_RESAMPLES,
    pointEstimates: {
      deltaBrier: point.deltaBrierVsMarket,
      deltaLogLoss: point.deltaLogLossVsMarket,
      deltaAccuracy: point.deltaAccuracyVsMarket,
    },
    brier: summarize(brier, true),
    logLoss: summarize(logLoss, true),
    accuracy: summarize(accuracy, false),
  };
}

function strictSeasonHoldouts(records) {
  return SEASONS.map((season) => {
    const prior = records.filter((row) => row.season < season);
    const heldOut = records.filter((row) => row.season === season);
    const selection = prior.length
      ? preferredCandidate(CORRECTION_SCALES.map((scale) => candidateSummary(prior, scale)))
      : { scale: 0 };
    const market = metricSummary(heldOut, (row) => row.marketP);
    const challenger = metricSummary(
      heldOut,
      (row) => row.probabilities[selection.scale],
    );
    return {
      season,
      heldOutGames: heldOut.length,
      selectedCorrectionScale: selection.scale,
      market,
      challenger,
      brierImproved:
        challenger.brier !== null && market.brier !== null
          ? challenger.brier < market.brier
          : null,
      logLossImproved:
        challenger.logLoss !== null && market.logLoss !== null
          ? challenger.logLoss < market.logLoss
          : null,
    };
  }).filter((item) => item.heldOutGames > 0);
}

function subgroupDiagnostics(records, scale) {
  const definitions = [
    ['Weeks 1-4', (row) => row.week >= 1 && row.week <= 4],
    ['Weeks 5-9', (row) => row.week >= 5 && row.week <= 9],
    ['Weeks 10-14', (row) => row.week >= 10 && row.week <= 14],
    ['Weeks 15+', (row) => row.week >= 15],
    ['50-55% market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.5 && Math.max(row.marketP, 1 - row.marketP) < 0.55],
    ['55-60% market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.55 && Math.max(row.marketP, 1 - row.marketP) < 0.6],
    ['60-65% market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.6 && Math.max(row.marketP, 1 - row.marketP) < 0.65],
    ['65-70% market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.65 && Math.max(row.marketP, 1 - row.marketP) < 0.7],
    ['70-80% market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.7 && Math.max(row.marketP, 1 - row.marketP) < 0.8],
    ['80%+ market favorite', (row) => Math.max(row.marketP, 1 - row.marketP) >= 0.8],
    ['Home favorite', (row) => row.marketP >= 0.5],
    ['Road favorite', (row) => row.marketP < 0.5],
    ['Division game', (row) => TEAM_DIVISIONS[row.home] === TEAM_DIVISIONS[row.away]],
    ['Non-division game', (row) => TEAM_DIVISIONS[row.home] !== TEAM_DIVISIONS[row.away]],
  ];
  return definitions.map(([label, predicate]) => {
    const rows = records.filter(predicate);
    const market = metricSummary(rows, (row) => row.marketP);
    const challenger = metricSummary(rows, (row) => row.probabilities[scale]);
    return {
      label,
      games: rows.length,
      market,
      challenger,
      deltaBrierVsMarket:
        challenger.brier === null || market.brier === null
          ? null
          : challenger.brier - market.brier,
      deltaLogLossVsMarket:
        challenger.logLoss === null || market.logLoss === null
          ? null
          : challenger.logLoss - market.logLoss,
      deltaAccuracyVsMarket:
        challenger.accuracy === null || market.accuracy === null
          ? null
          : challenger.accuracy - market.accuracy,
    };
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const scheduleRows = parseCsv(await fetchText(SCHEDULE_URL));
const statsBySeason = new Map();
const sourceColumns = {};
for (const season of SEASONS) {
  const rows = parseCsv(await fetchText(STAT_URL(season)));
  statsBySeason.set(season, rows);
  sourceColumns[season] = rows.length ? Object.keys(rows[0]) : [];
}

const requiredSourceColumns = [
  'season', 'week', 'team', 'opponent_team', 'season_type', 'game_id',
  'passing_epa', 'rushing_epa', 'receiving_epa', 'completions', 'attempts',
  'passing_yards', 'sacks_suffered', 'passing_interceptions',
];
for (const season of SEASONS) {
  const columns = sourceColumns[season];
  const missing = requiredSourceColumns.filter((column) => !columns.includes(column));
  if (missing.length)
    throw new Error(`stats_team ${season} is missing required columns: ${missing.join(', ')}`);
}

const games = scheduleRows
  .filter((row) => {
    const season = Number(row.season);
    return (
      SEASONS.includes(season) &&
      row.game_type === 'REG' &&
      Number.isFinite(Number(row.home_score)) &&
      Number.isFinite(Number(row.away_score))
    );
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
  .filter(
    (game) =>
      game.homeScore !== game.awayScore &&
      game.marketP !== null &&
      Number.isInteger(game.week),
  )
  .sort(
    (left, right) =>
      left.season - right.season ||
      left.week - right.week ||
      left.gameId.localeCompare(right.gameId),
  );

const audit = { featureGames: 0, trainingGames: 0 };
const reports = [];
for (const config of makeConfigs()) {
  const featureRows = buildFeatureRows(games, statsBySeason, config, audit);
  const records = chronologicalPredictions(featureRows, config, audit);
  reports.push({
    config: {
      code: config.code,
      recency: config.recency.code,
      ridge: config.ridge,
      shrinkagePseudoGames: config.shrinkage,
      featureBundle: config.bundleCode,
      opponentAdjusted: config.opponentAdjusted,
    },
    eligibleFeatureGames: featureRows.length,
    chronologicalOosGames: records.length,
    records,
  });
}

const coreReports = reports.filter((report) => !report.config.opponentAdjusted);
const commonKeys = coreReports.reduce((keys, report) => {
  const available = new Set(report.records.map(gameKey));
  return new Set([...keys].filter((key) => available.has(key)));
}, new Set(coreReports[0].records.map(gameKey)));
if (!commonKeys.size) throw new Error('No common chronological OOS games across core candidates.');

for (const report of reports) {
  report.comparisonRecords = report.records.filter((row) => commonKeys.has(gameKey(row)));
  report.candidates = CORRECTION_SCALES.map((scale) =>
    candidateSummary(report.comparisonRecords, scale),
  );
  report.best = preferredCandidate(report.candidates);
}

const allCoreCandidates = coreReports.flatMap((report) =>
  report.candidates.map((candidate) => ({ ...candidate, config: report.config })),
);
const bestOverall = preferredCandidate(allCoreCandidates);
const bestNonzero = preferredCandidate(
  allCoreCandidates.filter((candidate) => candidate.scale > 0),
);
const bestOverallReport = coreReports.find(
  (report) => report.config.code === bestOverall.config.code,
);
const bestNonzeroReport = coreReports.find(
  (report) => report.config.code === bestNonzero.config.code,
);
const bestOverallRecords = bestOverallReport.comparisonRecords;
const bestNonzeroRecords = bestNonzeroReport.comparisonRecords;
const bootstrap = pairedBootstrap(bestNonzeroRecords, bestNonzero.scale);
const strictHoldouts = strictSeasonHoldouts(bestOverallRecords);
const subgroupResults = subgroupDiagnostics(bestOverallRecords, bestOverall.scale);
const baselineReport = reports.find((report) => report.config.code === 'baseline');
const opponentReport = reports.find(
  (report) => report.config.code === 'opponent_adjusted_all_current_features',
);
const opponentHelped =
  opponentReport.best.brier < baselineReport.best.brier &&
  opponentReport.best.logLoss < baselineReport.best.logLoss;
const seasonCounts = {
  brierImproved: strictHoldouts.filter((item) => item.brierImproved === true).length,
  brierWorsened: strictHoldouts.filter((item) => item.brierImproved === false).length,
  logLossImproved: strictHoldouts.filter((item) => item.logLossImproved === true).length,
  logLossWorsened: strictHoldouts.filter((item) => item.logLossImproved === false).length,
};

const output = {
  generatedAt: new Date().toISOString(),
  status: 'SHADOW_ONLY',
  productionInfluence: 0,
  selectionPolicy: {
    primary: 'lowest chronological OOS Brier on common games',
    secondary: 'lowest chronological OOS log loss',
    accuracy: 'descriptive only',
  },
  temporalPolicy:
    'Team features use only same-season regular-season stats from weeks strictly before the forecast week. Each weekly forecast model trains only on earlier seasons or earlier weeks. No test-game result appears in its features or training.',
  source: {
    schedule: SCHEDULE_URL,
    teamStats: 'nflverse stats_team weekly releases',
    requiredColumns: requiredSourceColumns,
    columnsBySeason: sourceColumns,
  },
  featureAvailability: {
    populated: FEATURE_BUNDLES.all_current_features,
    dropped: [
      'passingSuccessRate (not supplied by stats_team weekly CSV)',
      'rushingSuccessRate (not supplied by stats_team weekly CSV)',
    ],
  },
  declaredSearchSpace: {
    correctionScales: CORRECTION_SCALES,
    recencyVariants: Object.keys(RECENCY_VARIANTS),
    ridgeValues: RIDGE_VALUES,
    shrinkagePseudoGames: SHRINKAGE_VALUES,
    featureBundles: Object.keys(FEATURE_BUNDLES),
  },
  coverage: {
    totalMarketEligibleGames: games.length,
    commonCoreOosGames: commonKeys.size,
  },
  temporalAudit: {
    featureRowsBuilt: audit.featureGames,
    chronologicalPredictionRows: audit.trainingGames,
    sameSeasonOnly: true,
    regularSeasonOnly: true,
    strictlyPriorWeeksOnly: true,
    earlierChronologyTrainingOnly: true,
    testGameExcluded: true,
  },
  configurations: reports.map((report) => ({
    config: report.config,
    eligibleFeatureGames: report.eligibleFeatureGames,
    chronologicalOosGames: report.chronologicalOosGames,
    comparisonGames: report.comparisonRecords.length,
    candidates: report.candidates,
    best: report.best,
  })),
  bestCandidate: bestOverall,
  bestNonzeroChallenger: bestNonzero,
  exactGameMarket: metricSummary(bestOverallRecords, (row) => row.marketP),
  exactGameBestCandidate: metricSummary(
    bestOverallRecords,
    (row) => row.probabilities[bestOverall.scale],
  ),
  bootstrap,
  strictChronologicalSeasonHoldouts: strictHoldouts,
  seasonStabilityCounts: seasonCounts,
  opponentAdjustment: {
    implemented: true,
    strictPriorWeekOnly: true,
    baselineBest: baselineReport.best,
    opponentAdjustedBest: opponentReport.best,
    helped: opponentHelped,
    note:
      'Opponent adjustment subtracts an opponent defensive baseline built only from regular-season rows before the forecast week; no same-week or future stat is used.',
  },
  subgroupDiagnostics: subgroupResults,
  verdict:
    'Historical closing-market inputs remain later-information proxies. This robustness suite is descriptive research only and cannot promote a football residual into V2 production.',
};

await mkdir(resolve('outputs'), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await writeFile(
  RUNTIME_DATA_PATH,
  `// Generated by pnpm residual:robustness. Research only; production influence remains zero.\nexport const V5_RESIDUAL_ROBUSTNESS = ${JSON.stringify(output, null, 2)} as const;\n`,
  'utf8',
);

console.log('V5 residual robustness suite generated.');
console.log(`Core chronological OOS games: ${output.coverage.commonCoreOosGames}`);
console.log(`Best candidate: ${bestOverall.config.code} @ scale ${bestOverall.scale}`);
console.log(`Best candidate Brier=${bestOverall.brier.toFixed(6)}, LogLoss=${bestOverall.logLoss.toFixed(6)}, Accuracy=${(bestOverall.accuracy * 100).toFixed(2)}%`);
console.log(`Best nonzero challenger: ${bestNonzero.config.code} @ scale ${bestNonzero.scale}`);
console.log(`Bootstrap ΔBrier=${bootstrap.pointEstimates.deltaBrier.toFixed(6)} CI=[${bootstrap.brier.confidenceInterval95.map((value) => value.toFixed(6)).join(', ')}] P(better)=${(bootstrap.brier.probabilityBetter * 100).toFixed(1)}%`);
console.log(`Bootstrap ΔLogLoss=${bootstrap.pointEstimates.deltaLogLoss.toFixed(6)} CI=[${bootstrap.logLoss.confidenceInterval95.map((value) => value.toFixed(6)).join(', ')}] P(better)=${(bootstrap.logLoss.probabilityBetter * 100).toFixed(1)}%`);
console.log(`Season stability: Brier improved ${seasonCounts.brierImproved}, worsened ${seasonCounts.brierWorsened}; LogLoss improved ${seasonCounts.logLossImproved}, worsened ${seasonCounts.logLossWorsened}.`);
console.log(`Opponent adjustment helped: ${opponentHelped ? 'yes' : 'no'}`);
console.log('Production influence: 0 (shadow-only).');

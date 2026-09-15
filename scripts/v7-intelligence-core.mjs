import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const SEASONS = [2021, 2022, 2023, 2024, 2025];
export const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
export const TEAM_STATS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
export const PLAYER_STATS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

// Fixed before the replay. These are research candidates, not production
// tuning knobs, and a zero correction is deliberately retained as a contender.
export const V7_CONFIG = {
  version: 'V7.0-INTELLIGENCE-SHADOW',
  minimumTrainingGames: 200,
  ridge: 16,
  learningRate: 0.035,
  iterations: 450,
  residualScales: [0, 0.25, 0.5, 0.75, 1],
  referenceScale: 0.25,
  upsetThresholds: { moderate: 0.075, high: 0.15, extreme: 0.24 },
};

export const FEATURE_NAMES = [
  'passingEpaDiff',
  'rushingEpaDiff',
  'receivingEpaDiff',
  'completionPctDiff',
  'yardsPerAttemptDiff',
  'sackRateDiff',
  'interceptionRateDiff',
  'defensivePassingEpaDiff',
  'defensiveRushingEpaDiff',
];

export function parseCsvLine(line) {
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

export function parseCsv(source) {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

export function num(row, ...keys) {
  for (const key of keys) {
    const raw = row[key];
    if (raw === '' || raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function clamp(value, low = 0.01, high = 0.99) {
  return Math.max(low, Math.min(high, value));
}

export function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

export function logit(probability) {
  const safe = clamp(probability);
  return Math.log(safe / (1 - safe));
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function impliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function noVigHomeProbability(homeMoneyline, awayMoneyline) {
  const home = impliedProbability(homeMoneyline);
  const away = impliedProbability(awayMoneyline);
  return home === null || away === null || home + away <= 0 ? null : home / (home + away);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

export async function loadResearchData({ includePlayers = false } = {}) {
  const [scheduleSource, ...teamSources] = await Promise.all([
    fetchText(SCHEDULE_URL),
    ...SEASONS.map((season) => fetchText(TEAM_STATS_URL(season))),
  ]);
  const teamStats = new Map(SEASONS.map((season, index) => [season, parseCsv(teamSources[index])]));
  const playerStats = includePlayers
    ? new Map(
      SEASONS.map((season, index) => [season, index]),
    )
    : null;
  if (playerStats) {
    const sources = await Promise.all(SEASONS.map((season) => fetchText(PLAYER_STATS_URL(season))));
    for (let index = 0; index < SEASONS.length; index += 1)
      playerStats.set(SEASONS[index], parseCsv(sources[index]));
  }
  return { schedule: parseCsv(scheduleSource), teamStats, playerStats };
}

function weightedMean(rows, value) {
  if (!rows.length) return null;
  const ordered = [...rows].sort((left, right) => Number(left.week) - Number(right.week));
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const item = value(ordered[index]);
    if (item === null) continue;
    const weight = Math.pow(0.88, ordered.length - index - 1);
    numerator += item * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function offensiveSnapshot(rows) {
  const passingAttempts = (row) => num(row, 'attempts');
  const derived = (getter) => weightedMean(rows, getter);
  return {
    passingEpa: derived((row) => num(row, 'passing_epa')),
    rushingEpa: derived((row) => num(row, 'rushing_epa')),
    receivingEpa: derived((row) => num(row, 'receiving_epa')),
    completionPct: derived((row) => {
      const completions = num(row, 'completions');
      const attempts = passingAttempts(row);
      return completions !== null && attempts !== null && attempts > 0 ? completions / attempts : null;
    }),
    yardsPerAttempt: derived((row) => {
      const yards = num(row, 'passing_yards');
      const attempts = passingAttempts(row);
      return yards !== null && attempts !== null && attempts > 0 ? yards / attempts : null;
    }),
    sackRate: derived((row) => {
      const sacks = num(row, 'sacks_suffered');
      const attempts = passingAttempts(row);
      return sacks !== null && attempts !== null && sacks + attempts > 0 ? sacks / (sacks + attempts) : null;
    }),
    interceptionRate: derived((row) => {
      const interceptions = num(row, 'passing_interceptions');
      const attempts = passingAttempts(row);
      return interceptions !== null && attempts !== null && attempts > 0 ? interceptions / attempts : null;
    }),
    games: rows.length,
    weeks: [...new Set(rows.map((row) => Number(row.week)))].sort((a, b) => a - b),
  };
}

function teamSnapshot(priorRows, team) {
  const offenseRows = priorRows.filter((row) => row.team === team);
  const defensiveRows = priorRows.filter((row) => row.opponent_team === team);
  if (!offenseRows.length || !defensiveRows.length) return null;
  const offense = offensiveSnapshot(offenseRows);
  const defensivePassingEpa = weightedMean(defensiveRows, (row) => num(row, 'passing_epa'));
  const defensiveRushingEpa = weightedMean(defensiveRows, (row) => num(row, 'rushing_epa'));
  if (Object.entries(offense).some(([key, value]) => key !== 'games' && key !== 'weeks' && value === null)
    || defensivePassingEpa === null || defensiveRushingEpa === null) return null;
  return { ...offense, defensivePassingEpa, defensiveRushingEpa };
}

function featureVector(home, away) {
  if (!home || !away) return null;
  const vector = [
    home.passingEpa - away.passingEpa,
    home.rushingEpa - away.rushingEpa,
    home.receivingEpa - away.receivingEpa,
    home.completionPct - away.completionPct,
    home.yardsPerAttempt - away.yardsPerAttempt,
    home.sackRate - away.sackRate,
    home.interceptionRate - away.interceptionRate,
    away.defensivePassingEpa - home.defensivePassingEpa,
    away.defensiveRushingEpa - home.defensiveRushingEpa,
  ];
  return vector.every(Number.isFinite) ? vector : null;
}

function standardizer(rows) {
  const means = FEATURE_NAMES.map((_, column) => mean(rows.map((row) => row.x[column])) ?? 0);
  const scales = FEATURE_NAMES.map((_, column) => {
    const variance = mean(rows.map((row) => (row.x[column] - means[column]) ** 2)) ?? 0;
    return Math.sqrt(variance) > 1e-9 ? Math.sqrt(variance) : 1;
  });
  return { means, scales };
}

function transform(x, scaler) {
  return x.map((value, index) => (value - scaler.means[index]) / scaler.scales[index]);
}

export function fitLogistic(rows, { marketOffset }) {
  const scaler = standardizer(rows);
  const zRows = rows.map((row) => ({ ...row, z: transform(row.x, scaler) }));
  let intercept = 0;
  let beta = Array(FEATURE_NAMES.length).fill(0);
  for (let iteration = 0; iteration < V7_CONFIG.iterations; iteration += 1) {
    let interceptGradient = 0;
    const gradient = Array(FEATURE_NAMES.length).fill(0);
    for (const row of zRows) {
      const linear = intercept + beta.reduce((sum, value, index) => sum + value * row.z[index], 0);
      const probability = sigmoid((marketOffset ? logit(row.marketProbability) : 0) + linear);
      const residual = probability - row.y;
      interceptGradient += residual;
      for (let index = 0; index < beta.length; index += 1) gradient[index] += residual * row.z[index];
    }
    intercept -= V7_CONFIG.learningRate * interceptGradient / rows.length;
    beta = beta.map((value, index) => value - V7_CONFIG.learningRate * (
      gradient[index] / rows.length + (V7_CONFIG.ridge / rows.length) * value
    ));
  }
  return { intercept, beta, scaler, marketOffset };
}

export function score(model, x) {
  const z = transform(x, model.scaler);
  return model.intercept + model.beta.reduce((sum, value, index) => sum + value * z[index], 0);
}

function probabilityFromModel(model, x, marketProbability = null) {
  const offset = model.marketOffset && marketProbability !== null ? logit(marketProbability) : 0;
  return sigmoid(offset + score(model, x));
}

export function metrics(rows, key) {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null, expectedLosses: 0, actualLosses: 0, excessLosses: 0 };
  let correct = 0;
  let expectedLosses = 0;
  let actualLosses = 0;
  const brier = [];
  const logLosses = [];
  for (const row of rows) {
    const probability = clamp(row[key]);
    const pickedHome = probability >= 0.5;
    const isCorrect = (pickedHome ? 1 : 0) === row.y;
    if (isCorrect) correct += 1;
    else actualLosses += 1;
    expectedLosses += 1 - Math.max(probability, 1 - probability);
    brier.push((probability - row.y) ** 2);
    logLosses.push(-(row.y * Math.log(probability) + (1 - row.y) * Math.log(1 - probability)));
  }
  return {
    games: rows.length,
    accuracy: correct / rows.length,
    brier: mean(brier),
    logLoss: mean(logLosses),
    expectedLosses,
    actualLosses,
    excessLosses: actualLosses - expectedLosses,
  };
}

function calibration(rows, key) {
  const edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.001];
  return edges.slice(0, -1).map((lower, index) => {
    const upper = edges[index + 1];
    const bucket = rows.filter((row) => {
      const confidence = Math.max(row[key], 1 - row[key]);
      return confidence >= lower && confidence < upper;
    });
    const correct = bucket.filter((row) => (row[key] >= 0.5 ? 1 : 0) === row.y).length;
    return {
      bucket: `${Math.round(lower * 100)}–${Math.round((upper - 0.001) * 100)}%`,
      games: bucket.length,
      predicted: bucket.length ? mean(bucket.map((row) => Math.max(row[key], 1 - row[key]))) : null,
      actual: bucket.length ? correct / bucket.length : null,
    };
  });
}

function upsetRisk(game) {
  const marketFavoriteHome = game.marketProbability >= 0.5;
  const marketFavoriteProbability = Math.max(game.marketProbability, 1 - game.marketProbability);
  if (marketFavoriteProbability < 0.7) return { level: 'LOW', adjustment: 0, favorite: marketFavoriteHome ? game.home : game.away };
  const footballFavoriteProbability = marketFavoriteHome ? game.footballProbability : 1 - game.footballProbability;
  const gap = marketFavoriteProbability - footballFavoriteProbability;
  const thresholds = V7_CONFIG.upsetThresholds;
  const level = gap >= thresholds.extreme ? 'EXTREME'
    : gap >= thresholds.high ? 'HIGH'
      : gap >= thresholds.moderate ? 'MODERATE' : 'LOW';
  return { level, adjustment: marketFavoriteHome ? -Math.max(0, gap) : Math.max(0, gap), favorite: marketFavoriteHome ? game.home : game.away };
}

function favoriteOutcome(row) {
  const favoriteIsHome = row.marketProbability >= 0.5;
  const favoriteProbability = Math.max(row.marketProbability, 1 - row.marketProbability);
  const footballFavoriteProbability = favoriteIsHome ? row.footballProbability : 1 - row.footballProbability;
  const favoriteWon = (row.y === 1) === favoriteIsHome;
  return { favoriteIsHome, favoriteProbability, footballFavoriteProbability, favoriteWon };
}

function timingBucket(week) {
  if (week <= 4) return 'Weeks 1–4';
  if (week <= 9) return 'Weeks 5–9';
  if (week <= 14) return 'Weeks 10–14';
  return 'Weeks 15–18';
}

function detectorMetrics(rows, predicate) {
  const flagged = rows.filter(predicate);
  const losses = rows.filter((row) => !favoriteOutcome(row).favoriteWon);
  const correctWarnings = flagged.filter((row) => !favoriteOutcome(row).favoriteWon).length;
  const falseWarnings = flagged.length - correctWarnings;
  const comparableWins = rows.length - losses.length;
  return {
    alerts: flagged.length,
    correctWarnings,
    falseWarnings,
    precision: flagged.length ? correctWarnings / flagged.length : null,
    recall: losses.length ? correctWarnings / losses.length : null,
    falsePositiveRate: comparableWins ? falseWarnings / comparableWins : null,
    probabilityImpact: 0,
    brierImpact: 0,
    logLossImpact: 0,
    winnerPickFlips: 0,
    netWinnerAccuracyImpact: 0,
  };
}

export function matchedFavoriteControls(rows, target) {
  const targetFavorite = favoriteOutcome(target);
  return rows.filter((candidate) => {
    const control = favoriteOutcome(candidate);
    return control.favoriteWon
      && control.favoriteIsHome === targetFavorite.favoriteIsHome
      && Math.abs(control.favoriteProbability - targetFavorite.favoriteProbability) < 0.05
      && timingBucket(candidate.week) === timingBucket(target.week)
      && Math.abs(control.footballFavoriteProbability - targetFavorite.footballFavoriteProbability) < 0.1;
  }).slice(0, 30).map((control) => ({
    season: control.season,
    week: control.week,
    gameId: control.gameId,
    favorite: control.upset.favorite,
    marketFavoriteProbability: favoriteOutcome(control).favoriteProbability,
    footballFavoriteProbability: favoriteOutcome(control).footballFavoriteProbability,
  }));
}

function featureReasons(row) {
  const contributions = row.residualModel.beta.map((coefficient, index) => ({
    feature: FEATURE_NAMES[index],
    direction: coefficient * transform(row.x, row.residualModel.scaler)[index],
  })).sort((left, right) => Math.abs(right.direction) - Math.abs(left.direction)).slice(0, 3);
  return contributions.map((entry) => ({
    feature: entry.feature,
    favors: entry.direction >= 0 ? row.home : row.away,
    standardizedLogitContribution: entry.direction,
  }));
}

function regularGames(schedule) {
  return schedule
    .filter((row) => SEASONS.includes(Number(row.season)) && row.game_type === 'REG'
      && Number.isInteger(Number(row.week)) && Number.isFinite(Number(row.home_score))
      && Number.isFinite(Number(row.away_score)))
    .map((row) => ({
      season: Number(row.season), week: Number(row.week), gameId: row.game_id,
      home: row.home_team, away: row.away_team,
      homeScore: Number(row.home_score), awayScore: Number(row.away_score),
      marketProbability: noVigHomeProbability(row.home_moneyline, row.away_moneyline),
      homeMoneyline: num(row, 'home_moneyline'), awayMoneyline: num(row, 'away_moneyline'),
    }))
    .filter((game) => game.homeScore !== game.awayScore && game.marketProbability !== null)
    .sort((left, right) => left.season - right.season || left.week - right.week || left.gameId.localeCompare(right.gameId));
}

export function buildV7Result(data) {
  const featureRows = [];
  for (const game of regularGames(data.schedule)) {
    const seasonRows = data.teamStats.get(game.season) ?? [];
    // Absolute temporal guard: same-week and future game rows cannot enter.
    const priorRows = seasonRows.filter((row) => Number(row.season) === game.season
      && row.season_type === 'REG' && Number(row.week) < game.week);
    const home = teamSnapshot(priorRows, game.home);
    const away = teamSnapshot(priorRows, game.away);
    const x = featureVector(home, away);
    if (!x) continue;
    featureRows.push({
      ...game,
      y: game.homeScore > game.awayScore ? 1 : 0,
      x,
      homeSnapshot: home,
      awaySnapshot: away,
    });
  }

  const oos = [];
  // Every game in a season/week has the same legal training cut-off. Fitting
  // once per weekly slate is mathematically identical to refitting per game,
  // while making repeatable full historical audits feasible.
  const weeklyModels = new Map();
  for (const row of featureRows) {
    const key = `${row.season}-${row.week}`;
    if (!weeklyModels.has(key)) {
      const training = featureRows.filter((candidate) => candidate.season < row.season
        || (candidate.season === row.season && candidate.week < row.week));
      weeklyModels.set(key, training.length < V7_CONFIG.minimumTrainingGames
        ? null
        : {
          footballModel: fitLogistic(training, { marketOffset: false }),
          residualModel: fitLogistic(training, { marketOffset: true }),
        });
    }
    const models = weeklyModels.get(key);
    if (!models) continue;
    const { footballModel, residualModel } = models;
    const footballProbability = probabilityFromModel(footballModel, row.x);
    const rawResidualLogit = score(residualModel, row.x);
    const record = {
      ...row,
      footballModel,
      residualModel,
      footballProbability,
      rawResidualLogit,
      marketProbability: row.marketProbability,
    };
    for (const scale of V7_CONFIG.residualScales)
      record[`final_${String(scale).replace('.', '_')}`] = sigmoid(logit(row.marketProbability) + scale * rawResidualLogit);
    record.upset = upsetRisk(record);
    record.reasons = featureReasons(record);
    oos.push(record);
  }

  const candidates = V7_CONFIG.residualScales.map((scale) => {
    const key = `final_${String(scale).replace('.', '_')}`;
    const result = metrics(oos, key);
    const market = metrics(oos, 'marketProbability');
    return {
      scale, ...result,
      deltaBrierVsMarket: result.brier - market.brier,
      deltaLogLossVsMarket: result.logLoss - market.logLoss,
      deltaAccuracyVsMarket: result.accuracy - market.accuracy,
    };
  });
  const bestByBrier = [...candidates].sort((left, right) => left.brier - right.brier)[0];
  const referenceKey = `final_${String(V7_CONFIG.referenceScale).replace('.', '_')}`;
  const market = metrics(oos, 'marketProbability');
  const v7 = metrics(oos, referenceKey);
  const bigFavorites = oos.filter((row) => Math.max(row.marketProbability, 1 - row.marketProbability) >= 0.7);
  const flagged = bigFavorites.filter((row) => row.upset.level !== 'LOW');
  const upsetLosses = bigFavorites.filter((row) => row.upset.favorite !== (row.y ? row.home : row.away));

  const output = {
    version: V7_CONFIG.version,
    generatedAt: new Date().toISOString(),
    status: 'SHADOW_ONLY',
    productionInfluence: 0,
    champion: { version: 'V2.1-MARKET-ANCHOR-INTEGRITY', unchanged: true, marketBaselineProductionWeight: 1, footballCorrectionWeight: 0 },
    caveats: [
      'Historical moneylines are nflverse closing-line proxies without observation timestamps. Results are diagnostic, not a same-time betting-edge claim.',
      'Weekly player production is postgame data. There is no timestamped 2021–2025 injury, depth-chart, practice, or expected-starter archive in the validated source, so availability has zero V7 influence.',
      'No in-game injury, final weather observation, target-game statistics, or target-game result is used as a pregame feature.',
    ],
    temporalPolicy: {
      features: 'Only same-season regular-season team statistics with week strictly less than the forecast week are eligible.',
      training: 'Each test game trains only on earlier seasons or earlier weeks; no same-week result is eligible.',
      snapshot: 'Prospective V7 rows are capture-before-kickoff only and immutable after capture.',
    },
    sources: { schedule: SCHEDULE_URL, teamStats: 'nflverse stats_team weekly releases', playerStats: 'nflverse stats_player weekly releases (research evidence only)' },
    availability: { historicalTimestampedAvailability: false, modelInfluence: 0, reason: 'No validated timestamped pre-kickoff archive is present.' },
    featureCoverage: {
      populated: FEATURE_NAMES,
      unavailable: ['practice participation', 'expected starter', 'depth chart', 'weather timestamp', 'travel timestamp', 'market movement timestamp', 'OL blocking', 'coverage assignment', 'route participation', 'snap share'],
    },
    hyperparameters: V7_CONFIG,
    coverage: { eligibleFeatureGames: featureRows.length, chronologicalOutOfSampleGames: oos.length },
    market,
    v2MarketEquivalent: market,
    v7Reference: { scale: V7_CONFIG.referenceScale, ...v7, calibration: calibration(oos, referenceKey) },
    marketCalibration: calibration(oos, 'marketProbability'),
    candidates,
    bestByBrier,
    disagreements: {
      games: oos.filter((row) => (row.footballProbability >= 0.5) !== (row.marketProbability >= 0.5)).length,
      largeDisagreements: oos.filter((row) => Math.abs(row.footballProbability - row.marketProbability) >= 0.1).length,
      policy: 'Research-only; a disagreement does not change V2 or a betting recommendation.',
    },
    bigFavorites: {
      market70Plus: metrics(bigFavorites, 'marketProbability'),
      v7Reference: metrics(bigFavorites, referenceKey),
      upsetLosses: upsetLosses.length,
      flaggedUpsets: upsetLosses.filter((row) => row.upset.level !== 'LOW').length,
      falseUpsetFlags: flagged.filter((row) => row.upset.favorite === (row.y ? row.home : row.away)).length,
      flaggedGames: flagged.length,
      strictUnderdogDisagreement: {
        definition: 'Market favorite is at least 70%, while the independently fit football model selects the underdog. This signal never changes a V2/V7 pick.',
        metrics: detectorMetrics(
          bigFavorites,
          (row) => favoriteOutcome(row).footballFavoriteProbability < 0.5,
        ),
        matchedControlPolicy: 'Controls match favorite home/road status, market probability within five points, season timing bucket, and independent football-favorite probability within ten points. QB status, injury count, rest, and market movement are unavailable in this historical source and are not claimed as matches.',
      },
    },
    researchLedger: oos.map((row) => ({
      season: row.season,
      week: row.week,
      gameId: row.gameId,
      away: row.away,
      home: row.home,
      featureDataThroughWeek: row.week - 1,
      probabilities: {
        marketHome: row.marketProbability,
        footballHome: row.footballProbability,
        playerAvailabilityHome: null,
        matchupHome: sigmoid(logit(row.marketProbability) + row.rawResidualLogit),
        upsetRisk: row.upset.level,
        finalHome: row[referenceKey],
      },
      predictedWinner: row[referenceKey] >= 0.5 ? row.home : row.away,
      actualWinner: row.y ? row.home : row.away,
      correct: (row[referenceKey] >= 0.5 ? 1 : 0) === row.y,
      reasons: row.reasons,
      sourceStatus: {
        teamEfficiency: 'AVAILABLE_PRIOR_WEEK_ONLY',
        playerAvailability: 'UNAVAILABLE_NO_TIMESTAMPED_HISTORICAL_SOURCE',
        depthChart: 'UNAVAILABLE_NO_TIMESTAMPED_HISTORICAL_SOURCE',
        weatherRestTravel: 'UNAVAILABLE_NO_TIMESTAMPED_HISTORICAL_SOURCE',
      },
      disagreement: {
        v2MarketVsV7Points: Math.abs(row[referenceKey] - row.marketProbability) * 100,
        winnerFlip: (row[referenceKey] >= 0.5) !== (row.marketProbability >= 0.5),
      },
    })),
    bySeason: SEASONS.map((season) => {
      const rows = oos.filter((row) => row.season === season);
      return { season, market: metrics(rows, 'marketProbability'), v7: metrics(rows, referenceKey) };
    }).filter((row) => row.market.games),
    prospectiveContract: {
      table: 'v7_intelligence_snapshots',
      migration: 'drizzle/0007_v7_intelligence_shadow.sql',
      dedupe: 'season + game_key + hourly capture_bucket',
      postKickoffCapture: 'rejected',
      productionInfluence: 0,
    },
    verdict: bestByBrier.scale === 0
      ? 'The market-only candidate wins this V7 replay. V7 remains shadow-only; no correction is eligible for promotion.'
      : 'A nonzero V7 candidate is descriptively best in this chronological replay. It remains shadow-only pending prospective, timestamp-matched validation and stability testing.',
  };
  return { output, oos, featureRows, referenceKey };
}

/** A frozen research artifact for prospective V7 calculation; never V2. */
export function buildV7ProspectiveArtifact(data) {
  const { featureRows } = buildV7Result(data);
  const football = fitLogistic(featureRows, { marketOffset: false });
  const residual = fitLogistic(featureRows, { marketOffset: true });
  const artifact = {
    version: `${V7_CONFIG.version}-PROSPECTIVE`,
    status: 'SHADOW_ONLY',
    productionInfluence: 0,
    featureOrder: FEATURE_NAMES,
    football: {
      intercept: football.intercept,
      coefficients: football.beta,
      standardization: football.scaler,
    },
    residual: {
      intercept: residual.intercept,
      coefficients: residual.beta,
      standardization: residual.scaler,
      appliedScale: V7_CONFIG.referenceScale,
    },
    trainingSeasons: SEASONS,
    trainingGames: featureRows.length,
    temporalPolicy: 'Current-season regular-season team statistics must be from weeks strictly before the forecast week. Week 1 has no eligible current-season team sample.',
    unavailableInputs: ['timestamped historical player availability', 'depth rank', 'starter confirmation', 'weather observation history', 'market movement history'],
  };
  return {
    ...artifact,
    artifactHash: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
  };
}

export function gamePostgameStats(teamRows, gameId, home, away) {
  const homeRow = teamRows.find((row) => row.game_id === gameId && row.team === home);
  const awayRow = teamRows.find((row) => row.game_id === gameId && row.team === away);
  if (!homeRow || !awayRow) return { available: false, reason: 'No verified team-stat rows were available for this game.' };
  const totals = (row) => ({
    passingEpa: num(row, 'passing_epa'), rushingEpa: num(row, 'rushing_epa'),
    turnovers: (num(row, 'passing_interceptions') ?? 0) + (num(row, 'fumbles_lost_total') ?? 0),
    explosivePlays: (num(row, 'passing_20') ?? 0) + (num(row, 'rushing_20') ?? 0),
    sacksAllowed: num(row, 'sacks_suffered'),
  });
  return { available: true, home: totals(homeRow), away: totals(awayRow) };
}

function postgameMarkers(postgame, winnerIsHome) {
  if (!postgame.available) return [];
  const winner = winnerIsHome ? postgame.home : postgame.away;
  const loser = winnerIsHome ? postgame.away : postgame.home;
  const labels = [];
  if (winner.turnovers < loser.turnovers) labels.push('Winner had fewer recorded turnovers.');
  if (winner.passingEpa !== null && loser.passingEpa !== null && winner.passingEpa > loser.passingEpa)
    labels.push('Winner had higher postgame passing EPA.');
  if (winner.rushingEpa !== null && loser.rushingEpa !== null && winner.rushingEpa > loser.rushingEpa)
    labels.push('Winner had higher postgame rushing EPA.');
  if (winner.explosivePlays > loser.explosivePlays) labels.push('Winner recorded more 20+ yard plays.');
  if (winner.sacksAllowed !== null && loser.sacksAllowed !== null && winner.sacksAllowed < loser.sacksAllowed)
    labels.push('Winner allowed fewer sacks.');
  return labels;
}

export function special2026Reviews(data) {
  const targetPairs = [
    { label: 'Chargers/Cardinals', home: 'LAC', away: 'ARI' },
    { label: 'Titans/Jets', home: 'TEN', away: 'NYJ' },
  ];
  return targetPairs.map((target) => {
    const game = data.schedule.find((row) => Number(row.season) === 2026 && row.game_type === 'REG'
      && row.home_team === target.home && row.away_team === target.away);
    if (!game) return { matchup: target.label, available: false, reason: 'The game was not found in the published schedule source.' };
    const marketHome = noVigHomeProbability(game.home_moneyline, game.away_moneyline);
    const postgame = gamePostgameStats(data.teamStats.get(2026) ?? [], game.game_id, target.home, target.away);
    const winnerIsHome = num(game, 'home_score') > num(game, 'away_score');
    return {
      matchup: target.label,
      available: true,
      season: 2026,
      week: Number(game.week),
      gameId: game.game_id,
      away: target.away,
      home: target.home,
      score: { away: num(game, 'away_score'), home: num(game, 'home_score'), winner: winnerIsHome ? target.home : target.away },
      reconstructedClosingMarketHomeProbability: marketHome,
      knowableBeforeKickoff: [
        'Published schedule and any pre-kickoff market observation captured at the time.',
        'Only time-stamped availability, depth, and football-state records captured before kickoff.',
      ],
      notKnowableBeforeKickoff: ['Postgame EPA, turnover totals, explosives, and injuries occurring during the game.'],
      v7RetrospectiveStatus: 'NO_FROZEN_V7_SNAPSHOT',
      v7WhatItWouldHavePredicted: 'Not reconstructed after the result. Week 1 has no 2026 prior-week team-stat sample, and no immutable V7 pre-kickoff record existed. Treating later data as a V7 prediction would be hindsight.',
      postgameEvidence: postgame,
      postgameMarkers: postgameMarkers(postgame, winnerIsHome),
      predictableClassification: 'UNRESOLVED_WITHOUT_TIMESTAMPED_PREGAME_AVAILABILITY_AND_MARKET_HISTORY',
      irreducibleClassification: 'UNRESOLVED; in-game events are not inferred from a final score.',
    };
  });
}

export function buildPlayerValueOutput(data) {
  const rows = data.playerStats?.get(2025)?.filter((row) => row.season_type === 'REG') ?? [];
  const players = new Map();
  const teamUsage = new Map();
  for (const row of rows) {
    const usage = teamUsage.get(row.team) ?? { targets: 0, carries: 0 };
    usage.targets += num(row, 'targets') ?? 0;
    usage.carries += num(row, 'carries') ?? 0;
    teamUsage.set(row.team, usage);
    const id = row.player_id || `${row.player_display_name}|${row.team}|${row.position}`;
    const current = players.get(id) ?? {
      playerId: row.player_id || null, player: row.player_display_name || row.player_name,
      team: row.team, position: row.position, passingEpa: 0, rushingEpa: 0, receivingEpa: 0,
      targets: 0, sacks: 0, hits: 0, interceptions: 0, passesDefended: 0, fieldGoalsAboveBaseline: 0,
      puntNetYards: 0, carries: 0, attempts: 0, completions: 0, passingInterceptions: 0,
      sacksSuffered: 0, games: 0,
    };
    current.passingEpa += num(row, 'passing_epa') ?? 0;
    current.rushingEpa += num(row, 'rushing_epa') ?? 0;
    current.receivingEpa += num(row, 'receiving_epa') ?? 0;
    current.targets += num(row, 'targets') ?? 0;
    current.carries += num(row, 'carries') ?? 0;
    current.attempts += num(row, 'attempts') ?? 0;
    current.completions += num(row, 'completions') ?? 0;
    current.passingInterceptions += num(row, 'passing_interceptions') ?? 0;
    current.sacksSuffered += num(row, 'sacks_suffered') ?? 0;
    current.sacks += num(row, 'def_sacks') ?? 0;
    current.hits += num(row, 'def_qb_hits') ?? 0;
    current.interceptions += num(row, 'def_interceptions') ?? 0;
    current.passesDefended += num(row, 'def_pass_defended') ?? 0;
    current.fieldGoalsAboveBaseline += (num(row, 'fg_made') ?? 0) - (num(row, 'fg_att') ?? 0) * 0.8;
    current.puntNetYards += num(row, 'pt_net_yards') ?? 0;
    current.games += 1;
    players.set(id, current);
  }
  const signal = (player) => {
    if (player.position === 'QB') return player.passingEpa;
    if (['RB'].includes(player.position)) return player.rushingEpa + player.receivingEpa;
    if (['WR', 'TE'].includes(player.position)) return player.receivingEpa;
    if (['K'].includes(player.position)) return player.fieldGoalsAboveBaseline;
    if (['P'].includes(player.position)) return player.puntNetYards / Math.max(1, player.games);
    if (['DE', 'DL', 'DT', 'NT', 'EDGE', 'LB', 'CB', 'DB', 'S', 'SAF'].includes(player.position))
      return player.sacks * 2 + player.hits * 0.25 + player.interceptions * 3 + player.passesDefended * 0.4;
    // nflverse player statistics contain no blocking/snap/assignment signal
    // sufficient to rank OL (or other unsupported) positions. Leave them
    // unavailable rather than assigning a generic value.
    return null;
  };
  const qualified = [...players.values()].filter((player) => player.games >= 6 && Number.isFinite(signal(player)));
  const grouped = new Map();
  for (const player of qualified) {
    const group = grouped.get(player.position) ?? [];
    group.push(signal(player));
    grouped.set(player.position, group);
  }
  const scored = qualified.map((player) => {
    const group = grouped.get(player.position) ?? [];
    const average = mean(group) ?? 0;
    const sd = Math.sqrt(mean(group.map((value) => (value - average) ** 2)) ?? 0) || 1;
    const positionStandardScore = (signal(player) - average) / sd;
    // Shrink low-game samples back toward a neutral position baseline. This is
    // a research score, not a point estimate of an injury impact.
    const sampleShrinkage = player.games / (player.games + 8);
    const playerValueScore = Math.max(0, Math.min(100, 50 + 12 * positionStandardScore * sampleShrinkage));
    const team = teamUsage.get(player.team) ?? { targets: 0, carries: 0 };
    return {
      ...player,
      productionSignal: signal(player),
      positionStandardScore,
      sampleShrinkage,
      playerValueScore,
      targetShare: player.targets && team.targets ? player.targets / team.targets : null,
      rushShare: player.carries && team.carries ? player.carries / team.carries : null,
      routeParticipation: null,
      redZoneUsage: null,
      thirdDownUsage: null,
      offensiveSnapShare: null,
      defensiveSnapShare: null,
      recentPlayingTimeTrend: null,
      qbMetrics: player.position === 'QB' ? {
        attempts: player.attempts,
        starts: null,
        passingEpaPerDropback: player.attempts ? player.passingEpa / player.attempts : null,
        completionPct: player.attempts ? player.completions / player.attempts : null,
        interceptionRate: player.attempts ? player.passingInterceptions / player.attempts : null,
        sackRate: player.attempts + player.sacksSuffered
          ? player.sacksSuffered / (player.attempts + player.sacksSuffered)
          : null,
        scrambleRate: null,
      } : null,
    };
  });
  const replacementPriors = Object.fromEntries(
    [...new Set(scored.map((player) => player.position))].map((position) => {
      const values = scored.filter((player) => player.position === position)
        .map((player) => player.playerValueScore).sort((left, right) => left - right);
      return [position, values.length ? values[Math.floor(values.length / 2)] : null];
    }),
  );
  const valueRows = scored.map((player) => {
    const replacementValue = replacementPriors[player.position] ?? null;
    return {
      ...player,
      replacementValue,
      replacementGap: replacementValue === null ? null : Math.max(0, player.playerValueScore - replacementValue),
      replacementPlayer: null,
      replacementQuality: 'POSITION_BASELINE_ONLY',
      teamDependency: player.targetShare ?? player.rushShare ?? null,
      sourceSeason: 2025,
      status: 'RESEARCH_ONLY_POSTGAME_PRODUCTION',
    };
  });
  const leaders = [...valueRows].sort((left, right) => right.playerValueScore - left.playerValueScore).slice(0, 50);
  const coverage = ['QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P'].map((position) => ({
    position,
    productionEvidence: position === 'QB' ? ['passing_epa', 'attempts', 'sacks_suffered']
      : ['RB', 'WR', 'TE'].includes(position) ? ['rushing_epa', 'receiving_epa', 'targets']
        : ['K'].includes(position) ? ['fg_made', 'fg_att']
          : ['P'].includes(position) ? ['pt_net_yards']
            : ['EDGE', 'DT', 'LB', 'CB', 'S'].includes(position) ? ['def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended']
              : [],
    replacementValue: null,
    availabilityAdjustment: null,
    status: ['LT', 'LG', 'C', 'RG', 'RT'].includes(position) ? 'UNAVAILABLE_NO_OL_BLOCKING_OR_SNAP_SOURCE' : 'RESEARCH_PRODUCTION_ONLY',
  }));
  return {
    version: V7_CONFIG.version,
    generatedAt: new Date().toISOString(),
    status: 'SHADOW_ONLY', productionInfluence: 0,
    source: { season: 2025, urlPattern: 'nflverse stats_player weekly release', type: 'postgame weekly production' },
    guardrails: [
      'This ranks historical production evidence, not causal player replacement value.',
      'No player score changes a V2, V7 reference, specialist, or betting probability.',
      'No availability probability, snap restriction, depth replacement, or injury effect is fabricated from production data.',
    ],
    top50ProductionLeaders: leaders,
    playerValueRows: valueRows,
    positionCoverage: coverage,
    replacementValues: {
      method: 'Position-median production baseline with sample shrinkage; not a named backup estimate.',
      priors: replacementPriors,
      namedBackups: 'UNAVAILABLE_PENDING_TIMESTAMPED_DEPTH_RANK_AND_STARTER_SOURCE',
    },
  };
}

export function buildPlayerValueArtifact(data) {
  const output = buildPlayerValueOutput(data);
  const artifact = {
    version: `${V7_CONFIG.version}-PLAYER-VALUE-RESEARCH`,
    status: 'SHADOW_ONLY',
    productionInfluence: 0,
    sourceSeason: 2025,
    source: 'nflverse stats_player weekly release; postgame production research only',
    guardrails: output.guardrails,
    replacementValues: output.replacementValues,
    // Keep the deployed research artifact intentionally narrow. The full
    // derivation stays in the generated audit JSON; the Worker only needs
    // these values to match a current roster without inflating its bundle
    // with raw postgame totals it never reads at runtime.
    players: output.playerValueRows.map((player) => ({
      playerId: player.playerId,
      player: player.player,
      position: player.position,
      playerValueScore: player.playerValueScore,
      replacementValue: player.replacementValue,
      replacementGap: player.replacementGap,
      replacementQuality: player.replacementQuality,
      targetShare: player.targetShare,
      rushShare: player.rushShare,
      sourceSeason: player.sourceSeason,
      qbMetrics: player.qbMetrics,
    })),
  };
  return {
    ...artifact,
    artifactHash: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
  };
}

export async function writeJson(path, value) {
  await mkdir(resolve('outputs'), { recursive: true });
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

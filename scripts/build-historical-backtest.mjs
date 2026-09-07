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
const V2_MODEL_VERSION = 'V2.0-MARKET-ANCHOR-SHADOW';
const DEVELOPMENT_SEASONS = [2021, 2022, 2023, 2024];
const MARKET_WEIGHTS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1];

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

function calibration(records, probabilityFor = (record) => record.homeProbability) {
  const boundaries = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.001];
  return boundaries.slice(0, -1).flatMap((lower, index) => {
    const upper = boundaries[index + 1];
    const bucket = records.filter((record) => {
      if (record.winner === 'Tie') return false;
      const confidence = Math.max(
        probabilityFor(record),
        1 - probabilityFor(record),
      );
      return confidence >= lower && confidence < upper;
    });
    if (!bucket.length) return [];
    const averageConfidence = mean(
      bucket.map((record) =>
        Math.max(probabilityFor(record), 1 - probabilityFor(record)),
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

function closingMarketFor(game) {
  const homeMoneyline = Number(game.homeMoneyline);
  const awayMoneyline = Number(game.awayMoneyline);
  const expectedHomeMargin = Number(game.spreadLine);
  const hasMargin = Number.isFinite(expectedHomeMargin);
  return {
    source: 'nflverse schedules closing market fields',
    horizon: 'Closing-line timestamp is not provided by the source',
    homeMoneyline: Number.isFinite(homeMoneyline) ? homeMoneyline : null,
    awayMoneyline: Number.isFinite(awayMoneyline) ? awayMoneyline : null,
    homeProbability: noVigHomeProbability(homeMoneyline, awayMoneyline),
    expectedHomeMargin: hasMargin ? expectedHomeMargin : null,
    homeSpread: hasMargin ? -expectedHomeMargin : null,
    awaySpread: hasMargin ? expectedHomeMargin : null,
    homeSpreadOdds: Number.isFinite(Number(game.homeSpreadOdds))
      ? Number(game.homeSpreadOdds)
      : null,
    awaySpreadOdds: Number.isFinite(Number(game.awaySpreadOdds))
      ? Number(game.awaySpreadOdds)
      : null,
  };
}

function marketRecords(records) {
  return records.filter(
    (record) =>
      record.winner !== 'Tie' && record.closingMarket.homeProbability !== null,
  );
}

function scoredSummary(records, probabilityFor, marginFor, pickFor) {
  const graded = records.filter((record) => record.winner !== 'Tie');
  const correct = graded.filter((record) => {
    const probability = probabilityFor(record);
    const pick = pickFor
      ? pickFor(record, probability)
      : probability >= 0.5
        ? record.home
        : record.away;
    return pick === record.winner;
  }).length;
  const brier = mean(
    graded.map((record) => {
      const outcome = record.winner === record.home ? 1 : 0;
      return (probabilityFor(record) - outcome) ** 2;
    }),
  );
  const logLoss = mean(
    graded.map((record) => {
      const outcome = record.winner === record.home ? 1 : 0;
      const probability = clamp(probabilityFor(record), 0.01, 0.99);
      return -(
        outcome * Math.log(probability) +
        (1 - outcome) * Math.log(1 - probability)
      );
    }),
  );
  const marginErrors = marginFor
    ? graded
        .map((record) => {
          const margin = marginFor(record);
          return margin === null ? null : Math.abs(margin - record.actualHomeMargin);
        })
        .filter((value) => value !== null)
    : [];
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

function marketSummary(records) {
  const paired = marketRecords(records);
  return scoredSummary(
    paired,
    (record) => record.closingMarket.homeProbability,
    (record) => record.closingMarket.expectedHomeMargin,
  );
}

function metricDifference(model, market) {
  return {
    gamesPaired: market.games,
    accuracy: model.accuracy === null || market.accuracy === null ? null : model.accuracy - market.accuracy,
    brier: model.brier === null || market.brier === null ? null : model.brier - market.brier,
    logLoss: model.logLoss === null || market.logLoss === null ? null : model.logLoss - market.logLoss,
    marginMae: model.marginMae === null || market.marginMae === null ? null : model.marginMae - market.marginMae,
  };
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

function pairedBootstrap(records, iterations = 1000) {
  const paired = marketRecords(records);
  if (!paired.length) return null;
  const random = seededRandom(20260907);
  const deltas = { accuracy: [], brier: [], logLoss: [], marginMae: [] };
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let accuracy = 0;
    let brier = 0;
    let logLoss = 0;
    let marginMae = 0;
    for (let index = 0; index < paired.length; index += 1) {
      const record = paired[Math.floor(random() * paired.length)];
      const outcome = record.winner === record.home ? 1 : 0;
      const modelPick = record.homeProbability >= 0.5 ? record.home : record.away;
      const marketPick = record.closingMarket.homeProbability >= 0.5 ? record.home : record.away;
      accuracy += Number(modelPick === record.winner) - Number(marketPick === record.winner);
      brier +=
        (record.homeProbability - outcome) ** 2 -
        (record.closingMarket.homeProbability - outcome) ** 2;
      logLoss +=
        -(outcome * Math.log(clamp(record.homeProbability, 0.01, 0.99)) +
          (1 - outcome) * Math.log(clamp(1 - record.homeProbability, 0.01, 0.99))) +
        (outcome * Math.log(clamp(record.closingMarket.homeProbability, 0.01, 0.99)) +
          (1 - outcome) * Math.log(clamp(1 - record.closingMarket.homeProbability, 0.01, 0.99)));
      marginMae +=
        Math.abs(record.expectedHomeMargin - record.actualHomeMargin) -
        Math.abs(record.closingMarket.expectedHomeMargin - record.actualHomeMargin);
    }
    deltas.accuracy.push(accuracy / paired.length);
    deltas.brier.push(brier / paired.length);
    deltas.logLoss.push(logLoss / paired.length);
    deltas.marginMae.push(marginMae / paired.length);
  }
  return Object.fromEntries(
    Object.entries(deltas).map(([metric, values]) => [
      metric,
      { low: percentile(values, 0.025), high: percentile(values, 0.975) },
    ]),
  );
}

function chooseMarketWeight(records) {
  if (!records.length) return 0;
  return [...MARKET_WEIGHTS].sort((left, right) => {
    const leftBrier = mean(
      records.map((record) => {
        const probability =
          record.closingMarket.homeProbability +
          left * (record.homeProbability - record.closingMarket.homeProbability);
        const outcome = record.winner === record.home ? 1 : 0;
        return (probability - outcome) ** 2;
      }),
    );
    const rightBrier = mean(
      records.map((record) => {
        const probability =
          record.closingMarket.homeProbability +
          right * (record.homeProbability - record.closingMarket.homeProbability);
        const outcome = record.winner === record.home ? 1 : 0;
        return (probability - outcome) ** 2;
      }),
    );
    return leftBrier - rightBrier || left - right;
  })[0];
}

function v2Replay(records) {
  const training = [];
  const enriched = [];
  const selectedWeights = [];
  for (const season of TEST_SEASONS) {
    const seasonRecords = marketRecords(records.filter((record) => record.season === season));
    const weight = chooseMarketWeight(training);
    selectedWeights.push({ season, footballCorrectionWeight: weight, trainingGames: training.length });
    for (const record of seasonRecords) {
      enriched.push({
        ...record,
        v2HomeProbability: Number(
          (record.closingMarket.homeProbability +
            weight * (record.homeProbability - record.closingMarket.homeProbability)).toFixed(6),
        ),
        v2ExpectedHomeMargin: Number(
          (record.closingMarket.expectedHomeMargin +
            weight * (record.expectedHomeMargin - record.closingMarket.expectedHomeMargin)).toFixed(3),
        ),
      });
    }
    if (DEVELOPMENT_SEASONS.includes(season)) training.push(...seasonRecords);
  }
  const development = enriched.filter((record) => DEVELOPMENT_SEASONS.includes(record.season));
  const holdout = enriched.filter((record) => record.season === 2025);
  const summaryFor = (items) =>
    scoredSummary(
      items,
      (record) => record.v2HomeProbability,
      (record) => record.v2ExpectedHomeMargin,
    );
  return {
    modelVersion: V2_MODEL_VERSION,
    status: 'Shadow — not promoted as a proven live edge',
    architecture:
      'Market no-vig prior plus a football correction selected only from prior seasons.',
    selectedWeights,
    development: summaryFor(development),
    holdout: summaryFor(holdout),
    allFiveSeasons: summaryFor(enriched),
    calibration: calibration(enriched, (record) => record.v2HomeProbability),
    currentFootballCorrectionWeight: selectedWeights.at(-1)?.footballCorrectionWeight ?? 0,
    promotion:
      'The chronological grid selected a 0% football correction in every completed fold. V2 therefore defaults to the paired market probability when one is available and does not claim independent football edge.',
  };
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * erf);
}

function americanPayout(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function spreadDiagnostics(records) {
  const candidates = records.filter(
    (record) =>
      record.closingMarket.expectedHomeMargin !== null &&
      record.winner !== 'Tie',
  );
  const residuals = candidates.map(
    (record) => record.actualHomeMargin - record.expectedHomeMargin,
  );
  const residualStdDev = Math.sqrt(
    mean(residuals.map((value) => (value - mean(residuals)) ** 2)),
  );
  const scored = candidates.map((record) => {
    const line = record.closingMarket.expectedHomeMargin;
    const edge = record.expectedHomeMargin - line;
    const homeCoverProbability = clamp(
      normalCdf((edge - 0.5) / residualStdDev),
      0.01,
      0.99,
    );
    const selectHome = homeCoverProbability >= 0.5;
    const coverMargin = record.actualHomeMargin - line;
    const result = coverMargin === 0 ? 'Push' : coverMargin > 0 ? 'Home cover' : 'Away cover';
    const selectedOdds = selectHome
      ? record.closingMarket.homeSpreadOdds
      : record.closingMarket.awaySpreadOdds;
    const selectedProbability = selectHome ? homeCoverProbability : 1 - homeCoverProbability;
    const covered = result === 'Push' ? null : selectHome ? result === 'Home cover' : result === 'Away cover';
    const breakEven = impliedProbability(selectedOdds);
    const payout = americanPayout(selectedOdds);
    return {
      ...record,
      selectedSide: selectHome ? record.home : record.away,
      selectedProbability,
      homeCoverProbability,
      result,
      covered,
      breakEven,
      claimedEdge: breakEven === null ? null : selectedProbability - breakEven,
      profit: covered === null || payout === null ? 0 : covered ? payout : -1,
    };
  });
  const decisions = scored.filter((record) => record.covered !== null);
  const correct = decisions.filter((record) => record.covered).length;
  const pushes = scored.filter((record) => record.covered === null).length;
  const brier = mean(
    decisions.map(
      (record) => (record.homeCoverProbability - Number(record.result === 'Home cover')) ** 2,
    ),
  );
  const logLoss = mean(
    decisions.map((record) => {
      const outcome = Number(record.result === 'Home cover');
      return -(
        outcome * Math.log(record.homeCoverProbability) +
        (1 - outcome) * Math.log(1 - record.homeCoverProbability)
      );
    }),
  );
  const coverCalibration = [0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 1.001].flatMap(
    (lower, index, values) => {
      const upper = values[index + 1];
      if (!upper) return [];
      const bucket = decisions.filter(
        (record) => record.selectedProbability >= lower && record.selectedProbability < upper,
      );
      if (!bucket.length) return [];
      return [{
        label: upper >= 1 ? '60%+' : `${(lower * 100).toFixed(0)}–${(upper * 100 - 0.1).toFixed(1)}%`,
        games: bucket.length,
        predicted: mean(bucket.map((record) => record.selectedProbability)),
        actual: mean(bucket.map((record) => Number(record.covered))),
        brier: mean(bucket.map((record) => (record.selectedProbability - Number(record.covered)) ** 2)),
      }];
    },
  );
  const keyNumbers = [2.5, 3, 3.5, 6.5, 7, 7.5, 10].map((keyNumber) => {
    const bucket = decisions.filter(
      (record) => Math.abs(Math.abs(record.closingMarket.expectedHomeMargin) - keyNumber) < 0.1,
    );
    return {
      keyNumber,
      games: bucket.length,
      accuracy: bucket.length ? mean(bucket.map((record) => Number(record.covered))) : null,
    };
  });
  const edgeBoundaries = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07, 0.1, Infinity];
  const edgeBins = edgeBoundaries.slice(0, -1).flatMap((lower, index) => {
    const upper = edgeBoundaries[index + 1];
    const bucket = decisions.filter(
      (record) =>
        record.claimedEdge !== null &&
        record.claimedEdge >= lower &&
        record.claimedEdge < upper,
    );
    if (!bucket.length) return [];
    return [{
      label: upper === Infinity ? '10%+' : `${(lower * 100).toFixed(0)}–${(upper * 100).toFixed(0)}%`,
      games: bucket.length,
      claimedEdge: mean(bucket.map((record) => record.claimedEdge)),
      accuracy: mean(bucket.map((record) => Number(record.covered))),
      roi: mean(bucket.map((record) => record.profit)),
    }];
  });
  return {
    scope: 'Closing-line exploratory proxy — not timestamp-matched to V1 prediction snapshots.',
    gamesWithClosingSpread: scored.length,
    atsDecisions: decisions.length,
    correct,
    incorrect: decisions.length - correct,
    pushes,
    accuracy: decisions.length ? correct / decisions.length : null,
    coverBrier: brier,
    coverLogLoss: logLoss,
    residualStdDev,
    calibration: coverCalibration,
    keyNumbers,
    edgeBins,
    verdict:
      'Not promotion-eligible. The cover probabilities use a descriptive normal margin-residual distribution and closing lines, not timestamp-matched historical market snapshots.',
  };
}

function disagreementDiagnostics(records) {
  const paired = marketRecords(records);
  const groups = [
    { label: 'Agrees with market favorite', test: (record) => (record.homeProbability >= 0.5) === (record.closingMarket.homeProbability >= 0.5) },
    { label: 'Picks market underdog', test: (record) => (record.homeProbability >= 0.5) !== (record.closingMarket.homeProbability >= 0.5) },
  ].map(({ label, test }) => {
    const items = paired.filter(test);
    const model = scoredSummary(items, (record) => record.homeProbability, (record) => record.expectedHomeMargin);
    const market = marketSummary(items);
    return { label, model, market, difference: metricDifference(model, market) };
  });
  const bins = [0, 0.02, 0.05, 0.08, 0.12, Infinity].flatMap((lower, index, values) => {
    const upper = values[index + 1];
    if (!upper) return [];
    const items = paired.filter((record) => {
      const difference = Math.abs(record.homeProbability - record.closingMarket.homeProbability);
      return difference >= lower && difference < upper;
    });
    if (!items.length) return [];
    return [{
      label: upper === Infinity ? '12%+' : `${(lower * 100).toFixed(0)}–${(upper * 100).toFixed(0)} pts`,
      games: items.length,
      modelAccuracy: scoredSummary(items, (record) => record.homeProbability).accuracy,
      marketAccuracy: marketSummary(items).accuracy,
      modelBrier: scoredSummary(items, (record) => record.homeProbability).brier,
      marketBrier: marketSummary(items).brier,
    }];
  });
  return { groups, magnitudeBins: bins };
}

function errorDiagnostics(records) {
  return records
    .filter((record) => record.winner !== 'Tie')
    .map((record) => {
      const outcome = record.winner === record.home ? 1 : 0;
      const pickProbability = Math.max(record.homeProbability, 1 - record.homeProbability);
      const probabilityError = Math.abs(record.homeProbability - outcome);
      const logLoss = -(
        outcome * Math.log(clamp(record.homeProbability, 0.01, 0.99)) +
        (1 - outcome) * Math.log(clamp(1 - record.homeProbability, 0.01, 0.99))
      );
      return {
        gameId: record.gameId,
        season: record.season,
        phase: record.phase,
        away: record.away,
        home: record.home,
        winnerError: record.correct ? 0 : 1,
        probabilityError,
        squaredProbabilityError: probabilityError ** 2,
        logLoss,
        marginError: Math.abs(record.expectedHomeMargin - record.actualHomeMargin),
        marketDisagreement:
          record.closingMarket.homeProbability === null
            ? null
            : record.homeProbability - record.closingMarket.homeProbability,
        confidence: pickProbability,
        severityScore: Math.min(100, (logLoss / Math.log(100)) * 100),
      };
    })
    .sort((left, right) => right.severityScore - left.severityScore)
    .slice(0, 10);
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
    homeMoneyline: row.home_moneyline,
    awayMoneyline: row.away_moneyline,
    spreadLine: row.spread_line,
    homeSpreadOdds: row.home_spread_odds,
    awaySpreadOdds: row.away_spread_odds,
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
        closingMarket: closingMarketFor(game),
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

const closingMarketBySeason = TEST_SEASONS.map((season) => {
  const seasonRecords = records.filter((record) => record.season === season);
  const pairedModel = summary(marketRecords(seasonRecords));
  const market = marketSummary(seasonRecords);
  return {
    season,
    modelV1: pairedModel,
    closingMarket: market,
    difference: metricDifference(pairedModel, market),
  };
});
const pairedModelV1 = summary(marketRecords(records));
const closingMarket = marketSummary(records);
const marketBenchmark = {
  label: 'Closing-line market benchmark (not timestamp-matched)',
  source: {
    label: 'nflverse schedule closing odds fields',
    url: SOURCE_URL,
  },
  caveat:
    'The source supplies historical odds and spreads but not an observation timestamp. These are closing-line diagnostics, not same-horizon tests against V1\'s frozen daily prediction snapshots.',
  overall: closingMarket,
  bySeason: closingMarketBySeason,
  pairedV1: pairedModelV1,
  difference: metricDifference(pairedModelV1, closingMarket),
  bootstrapDifference95: pairedBootstrap(records),
};
const v2 = v2Replay(records);
const spread = spreadDiagnostics(records);
const marketDisagreement = disagreementDiagnostics(records);
const errorSeverity = errorDiagnostics(records);
const dataCompleteness = TEST_SEASONS.map((season) => {
  const scheduled = rows.filter(
    (row) =>
      Number(row.season) === season &&
      ['REG', 'WC', 'DIV', 'CON', 'SB'].includes(row.game_type),
  );
  const completed = scheduled.filter(
    (row) => Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score)),
  );
  const decided = completed.filter((row) => Number(row.home_score) !== Number(row.away_score));
  const odds = completed.filter(
    (row) => noVigHomeProbability(row.home_moneyline, row.away_moneyline) !== null,
  );
  const spreads = completed.filter((row) => Number.isFinite(Number(row.spread_line)));
  return {
    season,
    scheduledGames: scheduled.length,
    completedGames: completed.length,
    decidedGames: decided.length,
    ties: completed.length - decided.length,
    canceledGames: scheduled.length - completed.length,
    gamesWithMoneyline: odds.length,
    gamesWithClosingSpread: spreads.length,
    gamesWithTimestampMatchedOdds: 0,
    gamesWithHistoricalInjurySnapshots: 0,
    gamesWithFullFeatureCoverage: completed.length,
  };
});

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
      'The historical source includes closing odds fields but does not include an odds-observed timestamp. Closing-market and spread diagnostics are explicitly labeled later-information proxies, not same-horizon comparisons or evidence of a betting edge.',
      'The model does not assign tie probability; tied games are retained in the audit but excluded from binary winner metrics.',
    ],
    overall,
    regularSeason,
    postseason,
    holdout,
    bySeason,
    calibration: calibration(records),
    worstMisses,
    dataCompleteness,
    marketBenchmark,
    v2,
    spread,
    marketDisagreement,
    errorSeverity,
    records,
  },
  null,
  2,
)} as const;\n`;

await writeFile(OUTPUT_PATH, output, 'utf8');
console.log(
  `Wrote ${records.length} locked historical prediction records to ${OUTPUT_PATH}.`,
);

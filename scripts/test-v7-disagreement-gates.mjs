import { loadResearchData, buildV7Result } from './v7-intelligence-core.mjs';

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function clamp(p) {
  return Math.max(0.001, Math.min(0.999, p));
}

function summarize(rows, probabilityFor, label) {
  if (!rows.length) return { label, games: 0 };
  let correct = 0;
  const brier = [];
  const logLoss = [];
  let expectedLosses = 0;
  let actualLosses = 0;

  for (const row of rows) {
    const p = probabilityFor(row);
    const y = row.y;
    const pickHome = p >= 0.5;
    if ((pickHome ? 1 : 0) === y) correct += 1;
    else actualLosses += 1;
    expectedLosses += 1 - Math.max(p, 1 - p);
    brier.push((p - y) ** 2);
    const safe = clamp(p);
    logLoss.push(-(y * Math.log(safe) + (1 - y) * Math.log(1 - safe)));
  }

  return {
    label,
    games: rows.length,
    accuracy: correct / rows.length,
    brier: mean(brier),
    logLoss: mean(logLoss),
    expectedLosses,
    actualLosses,
    excessLosses: actualLosses - expectedLosses,
  };
}

const data = await loadResearchData();
const { oos } = buildV7Result(data);

const rows = oos.filter(
  (row) =>
    Number.isFinite(row.marketProbability) &&
    Number.isFinite(row.footballProbability),
);

const market = summarize(rows, (row) => row.marketProbability, 'MARKET');
const football = summarize(rows, (row) => row.footballProbability, 'FOOTBALL');

const thresholds = [0, 0.025, 0.05, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20];

function gatedProbability(row, threshold) {
  const market = row.marketProbability;
  const football = row.footballProbability;
  const disagree = (market >= 0.5) !== (football >= 0.5);
  const gap = Math.abs(football - market);
  return disagree && gap >= threshold ? football : market;
}

const gates = thresholds.map((threshold) => ({
  threshold,
  ...summarize(
    rows,
    (row) => gatedProbability(row, threshold),
    'DISAGREEMENT_GATE_' + threshold,
  ),
}));

function underdogFlipProbability(row, threshold) {
  const market = row.marketProbability;
  const football = row.footballProbability;
  const favoriteProbability = Math.max(market, 1 - market);
  const disagree = (market >= 0.5) !== (football >= 0.5);
  const gap = Math.abs(football - market);
  if (favoriteProbability >= 0.70 && disagree && gap >= threshold)
    return football;
  return market;
}

const underdogGates = thresholds
  .filter((threshold) => threshold > 0)
  .map((threshold) => ({
    threshold,
    ...summarize(
      rows,
      (row) => underdogFlipProbability(row, threshold),
      'UNDERDOG_FLIP_' + threshold,
    ),
  }));

const largeFavoriteDisagreements = rows.filter((row) => {
  const marketFavorite = Math.max(row.marketProbability, 1 - row.marketProbability);
  const disagree = (row.marketProbability >= 0.5) !== (row.footballProbability >= 0.5);
  return marketFavorite >= 0.70 && disagree;
});

const subgroup = {
  games: largeFavoriteDisagreements.length,
  favoriteLosses: largeFavoriteDisagreements.filter(
    (row) =>
      (row.marketProbability >= 0.5 ? row.home : row.away) !==
      (row.y ? row.home : row.away),
  ).length,
  footballCallsCorrect: largeFavoriteDisagreements.filter(
    (row) =>
      (row.footballProbability >= 0.5 ? row.home : row.away) ===
      (row.y ? row.home : row.away),
  ).length,
};

const bySeason = [...new Set(rows.map((row) => row.season))].map((season) => {
  const seasonRows = rows.filter((row) => row.season === season);
  return {
    season,
    market: summarize(seasonRows, (row) => row.marketProbability, 'MARKET'),
    football: summarize(seasonRows, (row) => row.footballProbability, 'FOOTBALL'),
    gate_10pt: summarize(
      seasonRows,
      (row) => gatedProbability(row, 0.10),
      'GATE_10PT',
    ),
  };
});

console.log(
  JSON.stringify(
    {
      version: 'V7-DISAGREEMENT-GATE-AUDIT-1.0',
      status: 'RESEARCH_ONLY',
      productionInfluence: 0,
      caveat:
        'Historical market probabilities are closing-line proxies without observation timestamps. This is a diagnostic of football-vs-market disagreement, not proof of a live betting edge.',
      coverage: rows.length,
      market,
      football,
      gates,
      underdogGates,
      largeFavoriteDisagreementSubgroup: subgroup,
      bySeason,
    },
    null,
    2,
  ),
);

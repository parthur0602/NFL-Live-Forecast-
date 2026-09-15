import { buildV7Result, loadResearchData, writeJson } from './v7-intelligence-core.mjs';

function favorite(row) {
  const home = row.marketProbability >= 0.5;
  const probability = Math.max(row.marketProbability, 1 - row.marketProbability);
  const footballProbability = home ? row.footballProbability : 1 - row.footballProbability;
  const lost = (row.y === 1) !== home;
  return { home, probability, footballProbability, lost, score: Math.max(0, probability - footballProbability) };
}

function metrics(rows, predicate) {
  const alerts = rows.filter(predicate);
  const losses = rows.filter((row) => favorite(row).lost);
  const correctWarnings = alerts.filter((row) => favorite(row).lost).length;
  const falseWarnings = alerts.length - correctWarnings;
  return {
    alerts: alerts.length,
    correctWarnings,
    falseWarnings,
    precision: alerts.length ? correctWarnings / alerts.length : null,
    recall: losses.length ? correctWarnings / losses.length : null,
    falsePositiveRate: rows.length === losses.length ? null : falseWarnings / (rows.length - losses.length),
  };
}

function prAuc(rows) {
  const scored = [...rows].sort((left, right) => favorite(right).score - favorite(left).score);
  const positives = scored.filter((row) => favorite(row).lost).length;
  if (!positives) return null;
  let truePositives = 0;
  let area = 0;
  for (let index = 0; index < scored.length; index += 1) {
    if (favorite(scored[index]).lost) {
      truePositives += 1;
      area += truePositives / (index + 1);
    }
  }
  return area / positives;
}

const data = await loadResearchData();
const { output, oos } = buildV7Result(data);
const rows = oos.filter((row) => favorite(row).probability >= 0.7);
// This V7.1 evaluation is deliberately not a fitted classifier. It preserves
// the chronological V7 OOS rows, uses the predeclared strict disagreement
// condition, and refuses unavailable historical availability/movement inputs.
const strict = metrics(rows, (row) => favorite(row).footballProbability < 0.5);
const report = {
  version: 'V7.1-UPSET-RESEARCH-SHADOW',
  generatedAt: new Date().toISOString(),
  status: 'NO_CANDIDATE_PROMOTED',
  productionInfluence: 0,
  evaluation: {
    games: rows.length,
    chronologicalOutOfSampleOnly: true,
    baseline: output.bigFavorites.strictUnderdogDisagreement.metrics,
    v71: {
      definition: '70%+ market favorite and independently fit, prior-week football model selects the underdog.',
      ...strict,
      prAuc: prAuc(rows),
      brierImpact: 0,
      logLossImpact: 0,
      accuracyImpact: 0,
      winnerPickFlips: 0,
    },
  },
  candidateInputs: {
    recentEfficiencyDeterioration: 'Already represented by prior-week efficiency rows in the frozen V7 football model.',
    playerReplacementGap: 'UNAVAILABLE_FOR_HISTORICAL_MATCHED_CONTROL: no timestamped historical starter/depth/inactive archive.',
    qbDowngrade: 'UNAVAILABLE_FOR_HISTORICAL_MATCHED_CONTROL: no timestamped historical starter archive.',
    injuryClusters: 'UNAVAILABLE_FOR_HISTORICAL_MATCHED_CONTROL: no timestamped historical injury/depth archive.',
    turnoverRegression: 'NOT_ADDED: would require a separately predeclared prior-week feature and an independent validation sample.',
    explosivePlayVulnerability: 'NOT_ADDED: would require a separately predeclared prior-week feature and an independent validation sample.',
    marketMovement: 'UNAVAILABLE: historical moneylines are closing proxies without observation-time series.',
    restTravel: 'UNAVAILABLE: no validated timestamped historical travel source.',
  },
  verdict: 'No V7.1 alert rule is activated. Available new player inputs are prospective-only and cannot be retrofitted into the historical test.',
};
await writeJson('outputs/v7-upset-v71.json', report);
console.log('V7.1 upset-detector research completed.');
console.log(`70%+ favorite OOS games: ${rows.length}`);
console.log(`Strict precision: ${(strict.precision * 100).toFixed(2)}%`);
console.log(`Strict recall: ${(strict.recall * 100).toFixed(2)}%`);
console.log(`Strict false-positive rate: ${(strict.falsePositiveRate * 100).toFixed(2)}%`);
console.log(`PR-AUC: ${(report.evaluation.v71.prAuc * 100).toFixed(2)}%`);
console.log('No candidate was promoted or allowed to change a probability.');

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [schema, learning, modelV2, historicalSource] = await Promise.all([
  readFile(resolve('db/schema.ts'), 'utf8'),
  readFile(resolve('lib/learning.ts'), 'utf8'),
  readFile(resolve('lib/model-v2.ts'), 'utf8'),
  readFile(resolve('lib/historical-backtest-data.ts'), 'utf8'),
]);

assert(
  schema.includes("'forecast_ledger'") &&
    schema.includes('uq_forecast_ledger_game_bucket'),
  'Prospective forecast ledger is missing from the schema.',
);
assert(
  schema.includes('uq_prediction_snapshots_game'),
  'Canonical one-pick-per-game uniqueness must remain intact.',
);
assert(
  learning.includes('INSERT OR IGNORE INTO forecast_ledger'),
  'Prediction capture is not writing prospective forecast snapshots.',
);
assert(
  learning.includes('expected_losses') && learning.includes('excessLosses'),
  'Expected-vs-actual loss diagnostics are missing.',
);
assert(
  learning.includes('ORDER BY week DESC, id DESC') &&
    !learning.includes('COALESCE(SUM(delta), 0) AS delta'),
  'Calibration state must use the latest target instead of cumulative repeated nudges.',
);
assert(
  modelV2.includes('spreadProbabilities') &&
    modelV2.includes('push: number') &&
    !modelV2.includes('(expectedHomeMargin + homeSpread - 0.5)'),
  'Spread math must preserve explicit push probability rather than the old binary shortcut.',
);

const start = historicalSource.indexOf('HISTORICAL_BACKTEST = ');
const end = historicalSource.lastIndexOf(' as const;');
assert(start >= 0 && end > start, 'Historical benchmark artifact is malformed.');
const historical = JSON.parse(
  historicalSource.slice(start + 'HISTORICAL_BACKTEST = '.length, end),
);
assert(
  Array.isArray(historical.records) && historical.records.length >= 1400,
  'Historical replay unexpectedly contains fewer than 1,400 games.',
);

const decidedWithMarket = historical.records.filter(
  (record) =>
    record.winner !== 'Tie' &&
    record.closingMarket?.homeProbability !== null &&
    record.closingMarket?.homeProbability !== undefined,
);
const expectedLosses = decidedWithMarket.reduce((sum, record) => {
  const p = record.closingMarket.homeProbability;
  return sum + (1 - Math.max(p, 1 - p));
}, 0);
const actualLosses = decidedWithMarket.reduce((sum, record) => {
  const p = record.closingMarket.homeProbability;
  const marketPick = p >= 0.5 ? record.home : record.away;
  return sum + Number(marketPick !== record.winner);
}, 0);
const excessLosses = actualLosses - expectedLosses;

assert(Number.isFinite(expectedLosses), 'Expected-loss diagnostic failed.');
console.log(
  [
    'Model integrity gate passed.',
    `Historical market-graded games: ${decidedWithMarket.length}`,
    `Expected losses from displayed probabilities: ${expectedLosses.toFixed(1)}`,
    `Actual losses: ${actualLosses}`,
    `Excess losses: ${excessLosses >= 0 ? '+' : ''}${excessLosses.toFixed(1)}`,
  ].join('\n'),
);

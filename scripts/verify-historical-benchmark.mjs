import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const benchmarkPath = resolve('lib/historical-backtest-data.ts');
const source = await readFile(benchmarkPath, 'utf8');
const start = source.indexOf('HISTORICAL_BACKTEST = ');
const end = source.lastIndexOf(' as const;');

if (start < 0 || end < 0)
  throw new Error('Historical benchmark artifact is missing or malformed.');

const data = JSON.parse(
  source.slice(start + 'HISTORICAL_BACKTEST = '.length, end),
);

const required = [
  data.currentBenchmark?.modelVersion,
  data.currentBenchmark?.evaluatedAt,
  data.currentBenchmark?.metrics?.accuracy,
  data.currentBenchmark?.metrics?.brier,
  data.currentBenchmark?.metrics?.logLoss,
  data.currentBenchmark?.metrics?.marginMae,
  data.currentBenchmark?.releaseRule,
];

if (required.some((value) => value === null || value === undefined))
  throw new Error('Current model benchmark did not complete.');

if (data.v4?.modelVersion === 'V4.0-ERROR-MEMORY-SHADOW') {
  if (data.v4.replay?.predictionLocks !== data.v4.metrics?.games)
    throw new Error('V4 prequential replay did not lock every graded game.');
  if ((data.v4.experts ?? []).some((expert) => expert.productionWeight !== 0))
    throw new Error('A V4 shadow specialist received production weight.');
  if (data.v4.replay?.championChanged)
    throw new Error('The V4 shadow replay cannot replace the production champion.');
}

// V1 is permanent reference history. It is intentionally not overwritten by
// future challenger experiments or by the current-model display.
if (
  data.overall?.correct !== 903 ||
  data.overall?.incorrect !== 517 ||
  Math.abs((data.holdout?.overall?.accuracy ?? 0) - 0.6232394366) > 0.000001
)
  throw new Error('The V1 permanent benchmark was unexpectedly changed.');

console.log(
  `Historical gate passed: ${data.currentBenchmark.modelVersion} · ${(data.currentBenchmark.metrics.accuracy * 100).toFixed(1)}% · ${data.currentBenchmark.evaluatedAt}`,
);

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const benchmarkPath = resolve('lib/historical-backtest-data.ts');
const outputPath = resolve('outputs/failure-atlas.json');
const runtimeDataPath = resolve('lib/failure-atlas-data.ts');

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function parseBenchmark(source) {
  const start = source.indexOf('HISTORICAL_BACKTEST = ');
  const end = source.lastIndexOf(' as const;');
  if (start < 0 || end < 0)
    throw new Error('Historical benchmark artifact is missing or malformed.');
  return JSON.parse(
    source.slice(start + 'HISTORICAL_BACKTEST = '.length, end),
  );
}

function favoriteProbability(record) {
  const probability = record.closingMarket?.homeProbability;
  return probability === null || probability === undefined
    ? null
    : Math.max(probability, 1 - probability);
}

function marketFavorite(record) {
  const probability = record.closingMarket?.homeProbability;
  if (probability === null || probability === undefined) return null;
  return probability >= 0.5 ? record.home : record.away;
}

function marketLoss(record) {
  const favorite = marketFavorite(record);
  if (!favorite || record.winner === 'Tie') return null;
  return favorite === record.winner ? 0 : 1;
}

function brier(record) {
  const probability = record.closingMarket?.homeProbability;
  if (probability === null || probability === undefined || record.winner === 'Tie')
    return null;
  const outcome = record.winner === record.home ? 1 : 0;
  return (probability - outcome) ** 2;
}

function marginError(record) {
  const marketMargin = record.closingMarket?.expectedHomeMargin;
  if (marketMargin === null || marketMargin === undefined) return null;
  return Math.abs(marketMargin - record.actualHomeMargin);
}

function summarize(label, records, meta = {}) {
  const graded = records.filter(
    (record) => marketLoss(record) !== null && favoriteProbability(record) !== null,
  );
  const expectedLosses = graded.reduce(
    (total, record) => total + (1 - favoriteProbability(record)),
    0,
  );
  const actualLosses = graded.reduce(
    (total, record) => total + marketLoss(record),
    0,
  );
  const variance = graded.reduce((total, record) => {
    const lossProbability = 1 - favoriteProbability(record);
    return total + lossProbability * (1 - lossProbability);
  }, 0);
  const standardDeviation = Math.sqrt(variance);
  const excessLosses = actualLosses - expectedLosses;
  const briers = graded.map(brier).filter((value) => value !== null);
  const marginErrors = graded.map(marginError).filter((value) => value !== null);
  const bySeason = [...new Set(graded.map((record) => record.season))].map((season) => {
    const seasonRecords = graded.filter((record) => record.season === season);
    const expected = seasonRecords.reduce(
      (total, record) => total + (1 - favoriteProbability(record)),
      0,
    );
    const actual = seasonRecords.reduce(
      (total, record) => total + marketLoss(record),
      0,
    );
    return {
      season,
      games: seasonRecords.length,
      expectedLosses: expected,
      actualLosses: actual,
      excessLosses: actual - expected,
    };
  });
  return {
    label,
    ...meta,
    games: graded.length,
    expectedLosses,
    actualLosses,
    excessLosses,
    excessLossZ:
      standardDeviation > 0 ? excessLosses / standardDeviation : null,
    accuracy: graded.length ? 1 - actualLosses / graded.length : null,
    expectedAccuracy: graded.length ? 1 - expectedLosses / graded.length : null,
    brier: mean(briers),
    marginMae: mean(marginErrors),
    positiveExcessSeasons: bySeason.filter((item) => item.excessLosses > 0).length,
    negativeExcessSeasons: bySeason.filter((item) => item.excessLosses < 0).length,
    bySeason,
  };
}

function between(value, lower, upper) {
  return value >= lower && value < upper;
}

function buildQbChangeFlags(records) {
  const previousStarter = new Map();
  const flags = new Map();
  for (const record of [...records].sort((a, b) =>
    a.season - b.season ||
    String(a.predictionTimestamp).localeCompare(String(b.predictionTimestamp)) ||
    String(a.gameId).localeCompare(String(b.gameId)),
  )) {
    for (const side of ['home', 'away']) {
      const team = record[side];
      const quarterback = record[`${side}Quarterback`];
      const key = `${record.season}:${team}`;
      const previous = previousStarter.get(key);
      flags.set(`${record.gameId}:${side}`, Boolean(previous && quarterback && previous !== quarterback));
      if (quarterback) previousStarter.set(key, quarterback);
    }
  }
  return flags;
}

function buildAtlas(records) {
  const eligible = records.filter(
    (record) =>
      record.winner !== 'Tie' &&
      record.closingMarket?.homeProbability !== null &&
      record.closingMarket?.homeProbability !== undefined,
  );
  const qbChange = buildQbChangeFlags(eligible);
  const groups = [];
  const add = (label, test, meta = {}) =>
    groups.push(summarize(label, eligible.filter(test), meta));

  add('All market-graded games', () => true, { family: 'overall' });

  const probabilityBands = [
    [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7],
    [0.7, 0.75], [0.75, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 1.001],
  ];
  for (const [lower, upper] of probabilityBands)
    add(
      `${Math.round(lower * 100)}–${Math.round((upper - 0.001) * 100)}% market favorite`,
      (record) => between(favoriteProbability(record), lower, upper),
      { family: 'favorite_probability' },
    );

  add('Home favorite', (record) => record.closingMarket.homeProbability >= 0.5, { family: 'favorite_location' });
  add('Road favorite', (record) => record.closingMarket.homeProbability < 0.5, { family: 'favorite_location' });
  add('Division game', (record) => Boolean(record.divisionGame), { family: 'division' });
  add('Non-division game', (record) => !record.divisionGame, { family: 'division' });
  add('Regular season', (record) => record.phase === 'Regular season', { family: 'phase' });
  add('Postseason', (record) => record.phase === 'Postseason', { family: 'phase' });

  const spreadBands = [
    [0, 2.5], [2.5, 3.5], [3.5, 6.5], [6.5, 7.5], [7.5, 10], [10, Infinity],
  ];
  for (const [lower, upper] of spreadBands)
    add(
      `Market spread magnitude ${lower}–${upper === Infinity ? 'plus' : upper}`,
      (record) => {
        const margin = Math.abs(record.closingMarket.expectedHomeMargin ?? NaN);
        return Number.isFinite(margin) && margin >= lower && margin < upper;
      },
      { family: 'spread_magnitude' },
    );

  const keyNumbers = [2.5, 3, 3.5, 6.5, 7, 7.5, 10];
  for (const keyNumber of keyNumbers)
    add(
      `Closing spread at ${keyNumber}`,
      (record) =>
        Math.abs(Math.abs(record.closingMarket.expectedHomeMargin ?? NaN) - keyNumber) < 0.1,
      { family: 'key_number' },
    );

  add(
    'Either team on short rest (6 days or less)',
    (record) => Number(record.homeRest) <= 6 || Number(record.awayRest) <= 6,
    { family: 'rest' },
  );
  add(
    'Rest differential 3+ days',
    (record) =>
      Number.isFinite(Number(record.homeRest)) &&
      Number.isFinite(Number(record.awayRest)) &&
      Math.abs(Number(record.homeRest) - Number(record.awayRest)) >= 3,
    { family: 'rest' },
  );
  add(
    'High observed wind (15+ mph; retrospective proxy)',
    (record) => Number.isFinite(Number(record.wind)) && Number(record.wind) >= 15,
    { family: 'weather_proxy', productionEligible: false },
  );
  add(
    'Dome/closed roof',
    (record) => record.roof === 'dome' || record.roof === 'closed',
    { family: 'weather_proxy' },
  );

  for (const season of [...new Set(eligible.map((record) => record.season))])
    add(`Season ${season}`, (record) => record.season === season, { family: 'season' });

  for (const [label, lower, upper] of [
    ['Weeks 1–4', 1, 5],
    ['Weeks 5–9', 5, 10],
    ['Weeks 10–14', 10, 15],
    ['Weeks 15+', 15, Infinity],
  ])
    add(label, (record) => record.week >= lower && record.week < upper, { family: 'season_phase' });

  add(
    'Home QB starter changed from prior team game (retrospective starter proxy)',
    (record) => qbChange.get(`${record.gameId}:home`) === true,
    { family: 'qb_change_proxy', productionEligible: false },
  );
  add(
    'Away QB starter changed from prior team game (retrospective starter proxy)',
    (record) => qbChange.get(`${record.gameId}:away`) === true,
    { family: 'qb_change_proxy', productionEligible: false },
  );
  add(
    'Either QB starter changed from prior team game (retrospective starter proxy)',
    (record) =>
      qbChange.get(`${record.gameId}:home`) === true ||
      qbChange.get(`${record.gameId}:away`) === true,
    { family: 'qb_change_proxy', productionEligible: false },
  );

  const researchCandidates = groups
    .filter((group) => group.games >= 30 && group.family !== 'overall' && group.family !== 'season')
    .sort((left, right) => (right.excessLossZ ?? -Infinity) - (left.excessLossZ ?? -Infinity));

  return {
    generatedAt: new Date().toISOString(),
    scope: '2021–2025 closing-market diagnostic proxy. This atlas discovers where realized favorite losses exceeded or undershot the losses implied by closing no-vig probabilities.',
    guardrails: [
      'This is not a same-timestamp V5 edge claim.',
      'Positive excess losses identify research priorities, not automatic probability corrections.',
      'Weather and QB-change fields are retrospective proxies unless timestamped pregame states are separately available.',
      'Subgroup z-scores are descriptive screening statistics; overlapping groups and multiple hypothesis testing mean they are not standalone significance tests.',
      'Any specialist inspired by this atlas must be created on earlier data and validated only on later unseen games.',
    ],
    overall: summarize('All market-graded games', eligible, { family: 'overall' }),
    groups,
    topPositiveExcessLossGroups: researchCandidates.slice(0, 15),
    topNegativeExcessLossGroups: [...researchCandidates]
      .sort((left, right) => (left.excessLossZ ?? Infinity) - (right.excessLossZ ?? Infinity))
      .slice(0, 15),
  };
}

const benchmark = parseBenchmark(await readFile(benchmarkPath, 'utf8'));
const atlas = buildAtlas(benchmark.records ?? []);
await mkdir(resolve('outputs'), { recursive: true });
await writeFile(outputPath, JSON.stringify(atlas, null, 2), 'utf8');
await writeFile(
  runtimeDataPath,
  `// Generated by pnpm failure:atlas. This is a frozen research diagnostic, not a production input.\nexport const FAILURE_ATLAS = ${JSON.stringify(atlas, null, 2)} as const;\n`,
  'utf8',
);

console.log('Failure atlas generated.');
console.log(`Games: ${atlas.overall.games}`);
console.log(`Expected losses: ${atlas.overall.expectedLosses.toFixed(1)}`);
console.log(`Actual losses: ${atlas.overall.actualLosses}`);
console.log(`Excess losses: ${atlas.overall.excessLosses.toFixed(1)}`);
console.log('Top positive excess-loss research groups:');
for (const group of atlas.topPositiveExcessLossGroups.slice(0, 8)) {
  console.log(
    `- ${group.label}: N=${group.games}, expected=${group.expectedLosses.toFixed(1)}, actual=${group.actualLosses}, excess=${group.excessLosses.toFixed(1)}, z=${group.excessLossZ?.toFixed(2) ?? 'n/a'}`,
  );
}

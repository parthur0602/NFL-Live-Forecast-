import { V7_PROSPECTIVE_ARTIFACT } from '@/lib/v7-prospective-artifact';

const SEASON = 2026;
const STATS_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${SEASON}.csv`;

const TEAM_CODES: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE',
  'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

type CsvRow = Record<string, string>;
type FeatureName = (typeof V7_PROSPECTIVE_ARTIFACT.featureOrder)[number];
type TeamValues = Record<FeatureName, number>;

export type V7EfficiencyRow = {
  season: number;
  week: number;
  team: string;
  opponent: string;
  seasonType: string;
  passingEpa: number | null;
  rushingEpa: number | null;
  receivingEpa: number | null;
  completionPct: number | null;
  yardsPerAttempt: number | null;
  sackRate: number | null;
  interceptionRate: number | null;
};

export type V7ShadowResult = {
  available: boolean;
  reason: string | null;
  footballHomeProbability: number | null;
  matchupHomeProbability: number | null;
  upsetRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' | 'UNAVAILABLE';
  upsetHomeAdjustment: number | null;
  finalHomeProbability: number;
  predictedWinner: 'home' | 'away';
  featureDataThroughWeek: number | null;
  featurePayload: Record<string, unknown>;
};

function parseLine(line: string) {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function parseCsv(source: string): CsvRow[] {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function value(row: CsvRow, key: string) {
  const parsed = Number(row[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowMetrics(row: CsvRow): V7EfficiencyRow | null {
  const attempts = value(row, 'attempts');
  const completions = value(row, 'completions');
  const passingYards = value(row, 'passing_yards');
  const sacks = value(row, 'sacks_suffered');
  const interceptions = value(row, 'passing_interceptions');
  const season = value(row, 'season');
  const week = value(row, 'week');
  if (season === null || week === null || !row.team || !row.opponent_team) return null;
  return {
    season,
    week,
    team: row.team,
    opponent: row.opponent_team,
    seasonType: row.season_type,
    passingEpa: value(row, 'passing_epa'),
    rushingEpa: value(row, 'rushing_epa'),
    receivingEpa: value(row, 'receiving_epa'),
    completionPct: completions !== null && attempts !== null && attempts > 0 ? completions / attempts : null,
    yardsPerAttempt: passingYards !== null && attempts !== null && attempts > 0 ? passingYards / attempts : null,
    sackRate: sacks !== null && attempts !== null && sacks + attempts > 0 ? sacks / (sacks + attempts) : null,
    interceptionRate: interceptions !== null && attempts !== null && attempts > 0 ? interceptions / attempts : null,
  };
}

function weightedMean(rows: V7EfficiencyRow[], accessor: (row: V7EfficiencyRow) => number | null) {
  const ordered = [...rows].sort((left, right) => left.week - right.week);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const item = accessor(ordered[index]!);
    if (item === null) continue;
    const weight = Math.pow(0.88, ordered.length - index - 1);
    numerator += item * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function teamValues(rows: V7EfficiencyRow[], team: string): { values: TeamValues; weeks: number[]; games: number } | null {
  const offense = rows.filter((row) => row.team === team);
  const defense = rows.filter((row) => row.opponent === team);
  if (!offense.length || !defense.length) return null;
  const byFeature: Record<FeatureName, number | null> = {
    passingEpaDiff: weightedMean(offense, (row) => row.passingEpa),
    rushingEpaDiff: weightedMean(offense, (row) => row.rushingEpa),
    receivingEpaDiff: weightedMean(offense, (row) => row.receivingEpa),
    completionPctDiff: weightedMean(offense, (row) => row.completionPct),
    yardsPerAttemptDiff: weightedMean(offense, (row) => row.yardsPerAttempt),
    sackRateDiff: weightedMean(offense, (row) => row.sackRate),
    interceptionRateDiff: weightedMean(offense, (row) => row.interceptionRate),
    defensivePassingEpaDiff: weightedMean(defense, (row) => row.passingEpa),
    defensiveRushingEpaDiff: weightedMean(defense, (row) => row.rushingEpa),
  };
  if (Object.values(byFeature).some((item) => item === null)) return null;
  return {
    values: byFeature as TeamValues,
    weeks: [...new Set(offense.map((row) => row.week))].sort((left, right) => left - right),
    games: offense.length,
  };
}

function sigmoid(input: number) {
  if (input >= 0) return 1 / (1 + Math.exp(-input));
  const exp = Math.exp(input);
  return exp / (1 + exp);
}

function logit(probability: number) {
  const safe = Math.max(0.01, Math.min(0.99, probability));
  return Math.log(safe / (1 - safe));
}

function prediction(intercept: number, coefficients: readonly number[], standardization: { means: readonly number[]; scales: readonly number[] }, vector: number[]) {
  return intercept + coefficients.reduce(
    (sum, coefficient, index) => sum + coefficient * ((vector[index]! - standardization.means[index]!) / standardization.scales[index]!),
    0,
  );
}

export async function loadCurrentV7Efficiency(forecastWeek: number) {
  if (forecastWeek <= 1) return { rows: [] as V7EfficiencyRow[], reason: 'Week 1 has no completed current-season games before the forecast week.' };
  try {
    const response = await fetch(STATS_SOURCE, { cache: 'no-store' });
    if (!response.ok) return { rows: [] as V7EfficiencyRow[], reason: `The current nflverse team-stat source returned ${response.status}.` };
    const rows = parseCsv(await response.text())
      .map(rowMetrics)
      .filter((row): row is V7EfficiencyRow => row !== null)
      .filter((row) => row.season === SEASON && row.seasonType === 'REG' && row.week < forecastWeek);
    return rows.length
      ? { rows, reason: null }
      : { rows, reason: `No completed current-season rows exist before Week ${forecastWeek}.` };
  } catch {
    return { rows: [] as V7EfficiencyRow[], reason: 'The current nflverse team-stat source could not be read.' };
  }
}

export function calculateV7Shadow(input: {
  week: number;
  homeTeam: string;
  awayTeam: string;
  marketHomeProbability: number | null;
  v2HomeProbability: number;
  efficiencyRows: V7EfficiencyRow[];
  unavailableReason?: string | null;
}): V7ShadowResult {
  const fallback = (reason: string) => ({
    available: false,
    reason,
    footballHomeProbability: null,
    matchupHomeProbability: null,
    upsetRisk: 'UNAVAILABLE' as const,
    upsetHomeAdjustment: null,
    finalHomeProbability: input.v2HomeProbability,
    predictedWinner: input.v2HomeProbability >= 0.5 ? 'home' as const : 'away' as const,
    featureDataThroughWeek: null,
    featurePayload: { productionInfluence: 0, unavailableReason: reason, policy: V7_PROSPECTIVE_ARTIFACT.temporalPolicy },
  });
  if (input.marketHomeProbability === null)
    return fallback('A paired two-sided market probability is required for the V7 market-offset shadow.');
  if (input.unavailableReason) return fallback(input.unavailableReason);
  const eligible = input.efficiencyRows.filter((row) => row.week < input.week && row.seasonType === 'REG');
  if (eligible.some((row) => row.week >= input.week))
    throw new Error('V7 temporal guard failed: same-week or future team statistics were offered.');
  const home = teamValues(eligible, TEAM_CODES[input.homeTeam] ?? input.homeTeam);
  const away = teamValues(eligible, TEAM_CODES[input.awayTeam] ?? input.awayTeam);
  if (!home || !away) return fallback('Both teams need complete current-season prior-week feature samples.');
  const vector = V7_PROSPECTIVE_ARTIFACT.featureOrder.map((feature) => {
    if (feature === 'defensivePassingEpaDiff') return away.values[feature] - home.values[feature];
    if (feature === 'defensiveRushingEpaDiff') return away.values[feature] - home.values[feature];
    return home.values[feature] - away.values[feature];
  });
  const footballHomeProbability = sigmoid(prediction(
    V7_PROSPECTIVE_ARTIFACT.football.intercept,
    V7_PROSPECTIVE_ARTIFACT.football.coefficients,
    V7_PROSPECTIVE_ARTIFACT.football.standardization,
    vector,
  ));
  const residual = prediction(
    V7_PROSPECTIVE_ARTIFACT.residual.intercept,
    V7_PROSPECTIVE_ARTIFACT.residual.coefficients,
    V7_PROSPECTIVE_ARTIFACT.residual.standardization,
    vector,
  );
  const matchupHomeProbability = sigmoid(logit(input.marketHomeProbability) + residual);
  const finalHomeProbability = sigmoid(
    logit(input.marketHomeProbability) + V7_PROSPECTIVE_ARTIFACT.residual.appliedScale * residual,
  );
  const marketFavoriteHome = input.marketHomeProbability >= 0.5;
  const marketFavoriteProbability = Math.max(input.marketHomeProbability, 1 - input.marketHomeProbability);
  const footballFavoriteProbability = marketFavoriteHome ? footballHomeProbability : 1 - footballHomeProbability;
  const gap = marketFavoriteProbability - footballFavoriteProbability;
  const upsetRisk = marketFavoriteProbability < 0.7 ? 'LOW'
    : gap >= 0.24 ? 'EXTREME'
      : gap >= 0.15 ? 'HIGH'
        : gap >= 0.075 ? 'MODERATE' : 'LOW';
  return {
    available: true,
    reason: null,
    footballHomeProbability,
    matchupHomeProbability,
    upsetRisk,
    upsetHomeAdjustment: marketFavoriteHome ? -Math.max(0, gap) : Math.max(0, gap),
    finalHomeProbability,
    predictedWinner: finalHomeProbability >= 0.5 ? 'home' : 'away',
    featureDataThroughWeek: Math.max(...home.weeks, ...away.weeks),
    featurePayload: {
      artifactHash: V7_PROSPECTIVE_ARTIFACT.artifactHash,
      productionInfluence: 0,
      featureDataThroughWeek: Math.max(...home.weeks, ...away.weeks),
      home: { team: input.homeTeam, games: home.games, weeks: home.weeks },
      away: { team: input.awayTeam, games: away.games, weeks: away.weeks },
      featureVector: vector,
      rawResidualLogit: residual,
      playerAvailabilityInfluence: 0,
    },
  };
}

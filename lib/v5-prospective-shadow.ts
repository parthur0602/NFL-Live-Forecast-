import { V5_PROSPECTIVE_ARTIFACT } from './v5-prospective-artifact';

const SEASON = 2026;
export const V5_SHADOW_LABEL = 'SHADOW ONLY — does not affect production';
export const V5_STATS_SOURCE =
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
type FeatureName = (typeof V5_PROSPECTIVE_ARTIFACT.featureOrder)[number];
export type V5EfficiencyRow = {
  season: number;
  week: number;
  team: string;
  seasonType: string;
  passingEpa: number | null;
  rushingEpa: number | null;
  receivingEpa: number | null;
  completionPct: number | null;
  yardsPerAttempt: number | null;
  sackRate: number | null;
  interceptionRate: number | null;
};
type TeamFeatureSummary = {
  team: string;
  gamesInSample: number;
  weeks: number[];
  values: Record<FeatureName, number>;
};
export type V5ShadowResult =
  | {
      available: true;
      reason: null;
      homeProbability: number;
      predictedWinner: 'home' | 'away';
      rawResidualLogit: number;
      featureDataThroughWeek: number;
      featurePayload: Record<string, unknown>;
    }
  | {
      available: false;
      reason: string;
      homeProbability: null;
      predictedWinner: null;
      rawResidualLogit: null;
      featureDataThroughWeek: null;
      featurePayload: Record<string, unknown>;
    };

function parseCsvLine(line: string) {
  const values: string[] = [];
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

function parseCsv(source: string): CsvRow[] {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

function numberFrom(row: CsvRow, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function rowMetrics(row: CsvRow): V5EfficiencyRow | null {
  const season = numberFrom(row, 'season');
  const week = numberFrom(row, 'week');
  const attempts = numberFrom(row, 'attempts');
  const completions = numberFrom(row, 'completions');
  const passingYards = numberFrom(row, 'passing_yards');
  const sacks = numberFrom(row, 'sacks_suffered');
  const interceptions = numberFrom(row, 'passing_interceptions');
  const team = row.team ?? row.recent_team ?? '';
  if (season === null || week === null || !team) return null;
  return {
    season,
    week,
    team,
    seasonType: row.season_type ?? '',
    passingEpa: numberFrom(row, 'passing_epa'),
    rushingEpa: numberFrom(row, 'rushing_epa'),
    receivingEpa: numberFrom(row, 'receiving_epa'),
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

function canonicalCode(team: string) {
  return TEAM_CODES[team] ?? team;
}

function clamp(value: number) {
  return Math.max(0.01, Math.min(0.99, value));
}

function logit(probability: number) {
  const safe = clamp(probability);
  return Math.log(safe / (1 - safe));
}

function sigmoid(value: number) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function summarizeTeam(rows: V5EfficiencyRow[], team: string): TeamFeatureSummary | null {
  const ordered = rows
    .filter((row) => row.team === team)
    .sort((left, right) => left.week - right.week);
  if (!ordered.length) return null;
  const values = {} as Record<FeatureName, number>;
  for (const feature of V5_PROSPECTIVE_ARTIFACT.featureOrder) {
    const samples = ordered
      .map((row) => row[feature])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (!samples.length) return null;
    values[feature] = samples.reduce((total, value) => total + value, 0) / samples.length;
  }
  return {
    team,
    gamesInSample: ordered.length,
    weeks: ordered.map((row) => row.week),
    values,
  };
}

export async function loadCurrentV5Efficiency(forecastWeek: number) {
  if (forecastWeek <= 1)
    return {
      rows: [] as V5EfficiencyRow[],
      reason: 'Week 1 has no completed 2026 regular-season games for a prior-week efficiency sample.',
    };
  try {
    const response = await fetch(V5_STATS_SOURCE, { cache: 'no-store' });
    if (response.status === 404)
      return {
        rows: [] as V5EfficiencyRow[],
        reason: 'The 2026 nflverse team-stat file is not published; 2025 statistics were not substituted.',
      };
    if (!response.ok)
      return {
        rows: [] as V5EfficiencyRow[],
        reason: `The 2026 nflverse team-stat source returned ${response.status}; no efficiency values were fabricated.`,
      };
    const rows = parseCsv(await response.text())
      .map(rowMetrics)
      .filter((row): row is V5EfficiencyRow => row !== null)
      .filter(
        (row) =>
          row.season === SEASON &&
          row.seasonType === 'REG' &&
          row.week < forecastWeek,
      );
    return rows.length
      ? { rows, reason: null }
      : {
          rows,
          reason: `No completed 2026 regular-season efficiency rows exist before Week ${forecastWeek}.`,
        };
  } catch {
    return {
      rows: [] as V5EfficiencyRow[],
      reason: 'The 2026 nflverse team-stat source could not be read; V5 remains unavailable rather than using a substitute.',
    };
  }
}

export function calculateV5Shadow(input: {
  week: number;
  homeTeam: string;
  awayTeam: string;
  marketHomeProbability: number | null;
  efficiencyRows: V5EfficiencyRow[];
  unavailableReason?: string | null;
}): V5ShadowResult {
  const basePayload = {
    artifactHash: V5_PROSPECTIVE_ARTIFACT.artifactHash,
    artifactVersion: V5_PROSPECTIVE_ARTIFACT.version,
    productionInfluence: 0,
    featureOrder: V5_PROSPECTIVE_ARTIFACT.featureOrder,
    policy: 'Only 2026 regular-season rows with week strictly less than forecast week are eligible.',
  };
  if (input.marketHomeProbability === null)
    return {
      available: false,
      reason: 'No paired two-sided market probability is available for the market-offset V5 shadow.',
      homeProbability: null,
      predictedWinner: null,
      rawResidualLogit: null,
      featureDataThroughWeek: null,
      featurePayload: basePayload,
    };
  if (input.unavailableReason)
    return {
      available: false,
      reason: input.unavailableReason,
      homeProbability: null,
      predictedWinner: null,
      rawResidualLogit: null,
      featureDataThroughWeek: null,
      featurePayload: basePayload,
    };
  const eligible = input.efficiencyRows.filter(
    (row) =>
      row.season === SEASON &&
      row.seasonType === 'REG' &&
      row.week < input.week,
  );
  if (eligible.some((row) => row.week >= input.week))
    throw new Error('Temporal guard failed: a same-week or future efficiency row was offered to V5.');
  const home = summarizeTeam(eligible, canonicalCode(input.homeTeam));
  const away = summarizeTeam(eligible, canonicalCode(input.awayTeam));
  if (!home || !away)
    return {
      available: false,
      reason: 'Both teams need complete 2026 prior-week efficiency samples; no historical substitute was used.',
      homeProbability: null,
      predictedWinner: null,
      rawResidualLogit: null,
      featureDataThroughWeek: null,
      featurePayload: basePayload,
    };
  const vector = V5_PROSPECTIVE_ARTIFACT.featureOrder.map(
    (feature) => home.values[feature] - away.values[feature],
  );
  const rawResidualLogit = V5_PROSPECTIVE_ARTIFACT.coefficients.reduce(
    (total, coefficient, index) =>
      total +
      coefficient *
        ((vector[index] - V5_PROSPECTIVE_ARTIFACT.standardization.means[index]) /
          V5_PROSPECTIVE_ARTIFACT.standardization.scales[index]),
    0,
  );
  const homeProbability = sigmoid(
    logit(input.marketHomeProbability) +
      V5_PROSPECTIVE_ARTIFACT.residualScale * rawResidualLogit,
  );
  const featureDataThroughWeek = Math.max(...home.weeks, ...away.weeks);
  return {
    available: true,
    reason: null,
    homeProbability,
    predictedWinner: homeProbability >= 0.5 ? 'home' : 'away',
    rawResidualLogit,
    featureDataThroughWeek,
    featurePayload: {
      ...basePayload,
      home,
      away,
      featureVector: vector,
      marketHomeProbability: input.marketHomeProbability,
    },
  };
}

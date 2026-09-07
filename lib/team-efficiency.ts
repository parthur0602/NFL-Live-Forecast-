import { env } from 'cloudflare:workers';

const SEASON = 2026;
const SOURCE_URL = `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${SEASON}.csv`;
type DatabaseEnv = { DB?: D1Database };

type CsvRow = Record<string, string>;

type EfficiencySnapshot = {
  team: string;
  gamesInSample: number;
  passingEpa: number | null;
  rushingEpa: number | null;
  receivingEpa: number | null;
  passingSuccessRate: number | null;
  rushingSuccessRate: number | null;
  completionPercentage: number | null;
  yardsPerAttempt: number | null;
  sackRate: number | null;
  turnoverRate: number | null;
  payload: Record<string, unknown>;
};

function emptyRefresh(
  forecastWeek: number,
  observedAt: string,
  reason: string,
) {
  return {
    season: SEASON,
    forecastWeek,
    observedAt,
    source: SOURCE_URL,
    sourceAvailable: false,
    teams: [] as EfficiencySnapshot[],
    productionInfluence: 0,
    note: reason,
  };
}

function db() {
  const binding = (env as unknown as DatabaseEnv).DB;
  if (!binding) throw new Error('Team-efficiency database binding is unavailable.');
  return binding;
}

function bucket(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid efficiency timestamp.');
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
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
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function numberFrom(row: CsvRow, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function mean(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function weightedMean(rows: CsvRow[], getter: (row: CsvRow) => number | null) {
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const value = getter(rows[index]);
    if (value === null) continue;
    // Recent completed games receive modestly more weight. The value remains
    // shadow-only until prospective testing demonstrates incremental value.
    const weight = Math.pow(0.88, rows.length - 1 - index);
    numerator += value * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function teamName(row: CsvRow) {
  return row.team || row.recent_team || row.posteam || '';
}

function snapshotFor(team: string, rows: CsvRow[]): EfficiencySnapshot {
  const ordered = [...rows].sort((a, b) => (numberFrom(a, 'week') ?? 0) - (numberFrom(b, 'week') ?? 0));
  const passingEpa = weightedMean(ordered, (row) => numberFrom(row, 'passing_epa', 'pass_epa'));
  const rushingEpa = weightedMean(ordered, (row) => numberFrom(row, 'rushing_epa', 'rush_epa'));
  const receivingEpa = weightedMean(ordered, (row) => numberFrom(row, 'receiving_epa'));
  const passingSuccessRate = weightedMean(ordered, (row) => numberFrom(row, 'passing_success_rate', 'pass_success_rate'));
  const rushingSuccessRate = weightedMean(ordered, (row) => numberFrom(row, 'rushing_success_rate', 'rush_success_rate'));
  const completionPercentage = weightedMean(ordered, (row) => {
    const direct = numberFrom(row, 'completion_percentage', 'completion_pct');
    if (direct !== null) return direct;
    const completions = numberFrom(row, 'completions');
    const attempts = numberFrom(row, 'attempts', 'passing_attempts');
    return completions !== null && attempts ? completions / attempts : null;
  });
  const yardsPerAttempt = weightedMean(ordered, (row) => {
    const direct = numberFrom(row, 'yards_per_attempt', 'passing_yards_per_attempt');
    if (direct !== null) return direct;
    const yards = numberFrom(row, 'passing_yards');
    const attempts = numberFrom(row, 'attempts', 'passing_attempts');
    return yards !== null && attempts ? yards / attempts : null;
  });
  const sackRate = weightedMean(ordered, (row) => {
    const direct = numberFrom(row, 'sack_rate');
    if (direct !== null) return direct;
    const sacks = numberFrom(row, 'sacks', 'sacks_suffered');
    const attempts = numberFrom(row, 'attempts', 'passing_attempts');
    return sacks !== null && attempts !== null && attempts + sacks > 0 ? sacks / (attempts + sacks) : null;
  });
  const turnoverRate = weightedMean(ordered, (row) => {
    const direct = numberFrom(row, 'turnover_rate');
    if (direct !== null) return direct;
    const interceptions = numberFrom(row, 'interceptions', 'passing_interceptions');
    const attempts = numberFrom(row, 'attempts', 'passing_attempts');
    return interceptions !== null && attempts ? interceptions / attempts : null;
  });
  return {
    team,
    gamesInSample: ordered.length,
    passingEpa,
    rushingEpa,
    receivingEpa,
    passingSuccessRate,
    rushingSuccessRate,
    completionPercentage,
    yardsPerAttempt,
    sackRate,
    turnoverRate,
    payload: {
      sourceWeeks: ordered.map((row) => numberFrom(row, 'week')).filter((value) => value !== null),
      rawPassingEpaMean: mean(ordered.map((row) => numberFrom(row, 'passing_epa', 'pass_epa'))),
      methodology: 'Exponentially recency-weighted completed-game team statistics; only weeks strictly before the requested forecast week are included.',
      productionInfluence: 0,
    },
  };
}

export async function refreshTeamEfficiency(forecastWeek: number) {
  if (!Number.isInteger(forecastWeek) || forecastWeek < 1 || forecastWeek > 22)
    throw new Error('Invalid forecast week.');
  const observedAt = new Date().toISOString();
  if (forecastWeek === 1) {
    return emptyRefresh(
      forecastWeek,
      observedAt,
      'Week 1 has no completed regular-season games available for a prior-game sample.',
    );
  }
  const response = await fetch(SOURCE_URL, { cache: 'no-store' });
  if (response.status === 404) {
    return emptyRefresh(
      forecastWeek,
      observedAt,
      'The current-season nflverse team-stat file is not published yet; no historical substitute was used.',
    );
  }
  if (!response.ok) throw new Error(`nflverse team stats returned ${response.status}.`);
  const rows = parseCsv(await response.text()).filter((row) => {
    const season = numberFrom(row, 'season');
    const week = numberFrom(row, 'week');
    return (
      season === SEASON &&
      row.season_type === 'REG' &&
      week !== null &&
      week < forecastWeek &&
      teamName(row)
    );
  });
  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const team = teamName(row);
    grouped.set(team, [...(grouped.get(team) ?? []), row]);
  }
  const snapshots = [...grouped.entries()].map(([team, teamRows]) => snapshotFor(team, teamRows));
  const database = db();
  const statements = snapshots.map((snapshot) => database.prepare(
    `INSERT OR IGNORE INTO team_efficiency_snapshots (season, week, team, source, source_url, observed_at, capture_bucket, games_in_sample, passing_epa, rushing_epa, receiving_epa, passing_success_rate, rushing_success_rate, completion_percentage, yards_per_attempt, sack_rate, turnover_rate, payload_json, eligible_for_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).bind(
    SEASON,
    forecastWeek,
    snapshot.team,
    'nflverse team weekly stats',
    SOURCE_URL,
    observedAt,
    bucket(observedAt),
    snapshot.gamesInSample,
    snapshot.passingEpa,
    snapshot.rushingEpa,
    snapshot.receivingEpa,
    snapshot.passingSuccessRate,
    snapshot.rushingSuccessRate,
    snapshot.completionPercentage,
    snapshot.yardsPerAttempt,
    snapshot.sackRate,
    snapshot.turnoverRate,
    JSON.stringify(snapshot.payload),
  ));
  if (statements.length) await database.batch(statements);
  return {
    season: SEASON,
    forecastWeek,
    observedAt,
    source: SOURCE_URL,
    sourceAvailable: true,
    teams: snapshots,
    productionInfluence: 0,
    note: 'These features are timestamp-safe inputs for shadow specialists only. V2 remains unchanged until prospective same-time validation proves incremental value.',
  };
}

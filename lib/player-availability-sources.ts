import type { PlayerAvailabilitySignal } from '@/lib/player-availability';

const SEASON = 2026;
const INJURY_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${SEASON}.csv`;
const ROSTER_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${SEASON}.csv`;
const DEPTH_CHART_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${SEASON}.csv`;

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

// The current depth-chart release is a season file (tens of megabytes). Keep
// its source timestamp and a short in-isolate cache so the 45-second dashboard
// refresh loop does not repeatedly download it. A cached value is explicitly
// labelled with its original retrieval time and expires well before a later
// pre-kickoff capture horizon.
const DEPTH_CHART_CACHE_MS = 2 * 60 * 1000;
const SOURCE_FETCH_TIMEOUT_MS = 12_000;
let depthChartCache: {
  rows: CsvRow[];
  latestSourceTimestamp: string | null;
  retrievedAt: string;
} | null = null;

async function fetchSource(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  values.push(value);
  return values;
}

function parseCsv(source: string): CsvRow[] {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
  });
}

function injuryProbability(status: string) {
  // Only an explicit OUT designation has a defensible point value. Other
  // designations remain null rather than pretending a historical frequency is
  // a player-specific expected-play probability.
  return status.trim().toLowerCase() === 'out' ? 0 : null;
}

function codeFor(team: string) {
  return TEAM_CODES[team] ?? team;
}

export type CurrentAvailabilityResearch = {
  observedAt: string;
  sourceHealth: Record<string, { url: string | null; status: 'AVAILABLE' | 'UNAVAILABLE'; detail: string; retrievedAt: string }>;
  signals: PlayerAvailabilitySignal[];
  playerPayloadByTeam: Record<string, Array<Record<string, unknown>>>;
  depthPayloadByTeam: Record<string, Array<Record<string, unknown>>>;
  limitations: string[];
};

/**
 * Captures the public weekly injury/roster state at retrieval time. The
 * upstream files do not expose a source-publication timestamp, so retrieval
 * time is retained separately and the records are prospective-only.
 */
export async function collectCurrentPlayerAvailability(input: {
  week: number;
  teams: string[];
  observedAt?: string;
}): Promise<CurrentAvailabilityResearch> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const codes = new Set(input.teams.map(codeFor));
  const sourceHealth: CurrentAvailabilityResearch['sourceHealth'] = {
    injury: { url: INJURY_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.', retrievedAt: observedAt },
    roster: { url: ROSTER_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.', retrievedAt: observedAt },
    depthChart: { url: DEPTH_CHART_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.', retrievedAt: observedAt },
    officialInactives: {
      url: null,
      status: 'UNAVAILABLE',
      detail: 'No validated official pre-kickoff inactive-list endpoint is connected. This is never inferred from a final box score.',
      retrievedAt: observedAt,
    },
    transactions: { url: ROSTER_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.', retrievedAt: observedAt },
  };
  let injuryRows: CsvRow[] = [];
  let rosterRows: CsvRow[] = [];
  let depthChartRows: CsvRow[] = [];
  const cachedDepthChart = depthChartCache
    && Date.parse(observedAt) - Date.parse(depthChartCache.retrievedAt) < DEPTH_CHART_CACHE_MS
    ? depthChartCache
    : null;
  const [injury, roster, depthChart] = await Promise.allSettled([
    fetchSource(INJURY_SOURCE),
    fetchSource(ROSTER_SOURCE),
    cachedDepthChart ? Promise.resolve(null) : fetchSource(DEPTH_CHART_SOURCE),
  ]);
  if (injury.status === 'fulfilled' && injury.value.ok) {
    injuryRows = parseCsv(await injury.value.text());
    sourceHealth.injury = { url: INJURY_SOURCE, status: 'AVAILABLE', detail: `${injuryRows.length} published rows retrieved.`, retrievedAt: observedAt };
  } else {
    const detail = injury.status === 'fulfilled' ? `HTTP ${injury.value.status}` : 'Network request failed.';
    sourceHealth.injury.detail = detail;
  }
  if (roster.status === 'fulfilled' && roster.value.ok) {
    rosterRows = parseCsv(await roster.value.text());
    sourceHealth.roster = { url: ROSTER_SOURCE, status: 'AVAILABLE', detail: `${rosterRows.length} published rows retrieved.`, retrievedAt: observedAt };
    sourceHealth.transactions = {
      url: ROSTER_SOURCE,
      status: 'AVAILABLE',
      detail: 'Current roster status retained as IR/PUP/transaction research context; no upstream publication timestamp.',
      retrievedAt: observedAt,
    };
  } else {
    const detail = roster.status === 'fulfilled' ? `HTTP ${roster.value.status}` : 'Network request failed.';
    sourceHealth.roster.detail = detail;
    sourceHealth.transactions.detail = detail;
  }
  if (depthChart.status === 'fulfilled' && depthChart.value?.ok) {
    depthChartRows = parseCsv(await depthChart.value.text());
    const timestamps = depthChartRows
      .map((row) => row.dt)
      .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
      .sort();
    const latest = timestamps.at(-1) ?? null;
    depthChartCache = { rows: depthChartRows, latestSourceTimestamp: latest, retrievedAt: observedAt };
    sourceHealth.depthChart = {
      url: DEPTH_CHART_SOURCE,
      status: 'AVAILABLE',
      detail: `${depthChartRows.length} rows retrieved${latest ? `; latest source timestamp ${latest}` : '; source timestamp unavailable'}.`,
      retrievedAt: observedAt,
    };
  } else if (cachedDepthChart) {
    depthChartRows = cachedDepthChart.rows;
    sourceHealth.depthChart = {
      url: DEPTH_CHART_SOURCE,
      status: 'AVAILABLE',
      detail: `${depthChartRows.length} rows from in-isolate cache; source retrieved at ${cachedDepthChart.retrievedAt}${cachedDepthChart.latestSourceTimestamp ? `; latest source timestamp ${cachedDepthChart.latestSourceTimestamp}` : ''}.`,
      retrievedAt: cachedDepthChart.retrievedAt,
    };
  } else {
    sourceHealth.depthChart.detail = depthChart.status === 'fulfilled'
      ? depthChart.value ? `HTTP ${depthChart.value.status}` : 'Depth-chart response was empty.'
      : 'Network request failed.';
  }

  const injuries = injuryRows.filter((row) =>
    Number(row.season) === SEASON && Number(row.week) === input.week && codes.has(row.team),
  );
  // Roster releases can lag the forecast week. Retain only the latest release
  // no later than this forecast week; unlike an injury designation, this is a
  // durable roster/depth context and is labelled with its source week.
  const rosterCandidates = rosterRows.filter((row) =>
    Number(row.season) === SEASON && Number(row.week) <= input.week && codes.has(row.team),
  );
  const rosterWeek = rosterCandidates.reduce(
    (latest, row) => Math.max(latest, Number(row.week)),
    0,
  );
  const rosters = rosterCandidates.filter((row) => Number(row.week) === rosterWeek);
  // This release carries a source timestamp (`dt`) and explicit position rank.
  // It is a depth-chart observation—not proof of the final game-day starter.
  // Discard any source-dated after this retrieval to preserve prospective use.
  const depthByPlayerId = new Map(
    depthChartRows
      .filter((row) => codes.has(row.team) && Number.isFinite(Date.parse(row.dt)) && Date.parse(row.dt) <= Date.parse(observedAt))
      .sort((left, right) => Date.parse(left.dt) - Date.parse(right.dt))
      .map((row) => [row.gsis_id, row]),
  );
  if (rosterWeek && rosterWeek < input.week) {
    sourceHealth.roster.detail = `${rosters.length} rows from latest available Week ${rosterWeek} roster release; it predates forecast Week ${input.week}.`;
    sourceHealth.transactions.detail = `Roster/transaction context is from Week ${rosterWeek}; it predates forecast Week ${input.week}.`;
  }
  const playerPayloadByTeam: CurrentAvailabilityResearch['playerPayloadByTeam'] = {};
  const depthPayloadByTeam: CurrentAvailabilityResearch['depthPayloadByTeam'] = {};
  for (const row of injuries) {
    const team = row.team;
    const status = row.report_status?.trim() || 'INJURY_REPORT_WITHOUT_GAME_STATUS';
    const item = {
      playerId: row.gsis_id || null,
      player: row.full_name,
      team,
      position: row.position || null,
      depthRank: null,
      starterStatus: 'UNVERIFIED',
      injuryDesignation: status,
      practiceStatus: row.practice_status?.trim() || null,
      expectedPlayProbability: injuryProbability(status),
      expectedSnapShare: null,
      observedAt,
      source: INJURY_SOURCE,
      sourceTimestamp: null,
    };
    (playerPayloadByTeam[team] ??= []).push(item);
  }
  for (const row of rosters) {
    const team = row.team;
    const depth = depthByPlayerId.get(row.gsis_id);
    const rank = depth?.pos_rank ? Number(depth.pos_rank) : null;
    const item = {
      playerId: row.gsis_id || null,
      player: row.full_name,
      position: row.position || null,
      depthChartPosition: depth?.pos_abb || row.depth_chart_position || null,
      depthRank: Number.isFinite(rank) ? rank : null,
      starterStatus: rank === 1 ? 'DEPTH_CHART_FIRST_STRING' : depth ? 'DEPTH_CHART_LISTED' : 'UNVERIFIED',
      rosterStatus: row.status || null,
      rosterStatusDescription: row.status_description_abbr || null,
      transactionStatus: row.status || null,
      sourceWeek: rosterWeek || null,
      observedAt,
      source: depth ? DEPTH_CHART_SOURCE : ROSTER_SOURCE,
      sourceTimestamp: depth?.dt || null,
    };
    (depthPayloadByTeam[team] ??= []).push(item);
  }
  const signals: PlayerAvailabilitySignal[] = injuries.map((row) => {
    const status = row.report_status?.trim() || 'INJURY_REPORT_WITHOUT_GAME_STATUS';
    return {
      week: input.week,
      team: row.team,
      playerId: row.gsis_id || null,
      playerName: row.full_name,
      position: row.position || null,
      depthRole: null,
      status,
      practiceStatus: row.practice_status?.trim() || null,
      availabilityProbability: injuryProbability(status),
      expectedSnapShare: null,
      replacementValue: null,
      source: 'nflverse weekly injury report',
      sourceUrl: INJURY_SOURCE,
      observedAt,
      payload: playerPayloadByTeam[row.team]?.find((item) => item.playerId === (row.gsis_id || null)) ?? {},
      eligibleForModel: false,
    };
  });
  return {
    observedAt,
    sourceHealth,
    signals,
    playerPayloadByTeam,
    depthPayloadByTeam,
    limitations: [
      'The upstream files do not provide source-publication timestamps; observedAt records this system retrieval time.',
      rosterWeek && rosterWeek < input.week
        ? `Roster/depth context is from latest available Week ${rosterWeek} release and is not treated as an injury or starter confirmation for Week ${input.week}.`
        : 'Roster/depth context is from the current forecast-week release when available.',
      'Depth ranks, starter confirmation, game-day inactives, expected snaps, and player-specific replacement values are unavailable and remain null.',
      'Only explicit OUT designations receive a point availability value of 0; all uncertain designations remain null.',
    ],
  };
}

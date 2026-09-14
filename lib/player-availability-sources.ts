import type { PlayerAvailabilitySignal } from '@/lib/player-availability';

const SEASON = 2026;
const INJURY_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${SEASON}.csv`;
const ROSTER_SOURCE =
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${SEASON}.csv`;

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
  sourceHealth: Record<string, { url: string; status: 'AVAILABLE' | 'UNAVAILABLE'; detail: string }>;
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
    injury: { url: INJURY_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.' },
    roster: { url: ROSTER_SOURCE, status: 'UNAVAILABLE', detail: 'Not fetched.' },
  };
  let injuryRows: CsvRow[] = [];
  let rosterRows: CsvRow[] = [];
  const [injury, roster] = await Promise.allSettled([
    fetch(INJURY_SOURCE, { cache: 'no-store' }),
    fetch(ROSTER_SOURCE, { cache: 'no-store' }),
  ]);
  if (injury.status === 'fulfilled' && injury.value.ok) {
    injuryRows = parseCsv(await injury.value.text());
    sourceHealth.injury = { url: INJURY_SOURCE, status: 'AVAILABLE', detail: `${injuryRows.length} published rows retrieved.` };
  } else {
    const detail = injury.status === 'fulfilled' ? `HTTP ${injury.value.status}` : 'Network request failed.';
    sourceHealth.injury.detail = detail;
  }
  if (roster.status === 'fulfilled' && roster.value.ok) {
    rosterRows = parseCsv(await roster.value.text());
    sourceHealth.roster = { url: ROSTER_SOURCE, status: 'AVAILABLE', detail: `${rosterRows.length} published rows retrieved.` };
  } else {
    const detail = roster.status === 'fulfilled' ? `HTTP ${roster.value.status}` : 'Network request failed.';
    sourceHealth.roster.detail = detail;
  }

  const injuries = injuryRows.filter((row) =>
    Number(row.season) === SEASON && Number(row.week) === input.week && codes.has(row.team),
  );
  const rosters = rosterRows.filter((row) =>
    Number(row.season) === SEASON && Number(row.week) === input.week && codes.has(row.team),
  );
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
    const item = {
      playerId: row.gsis_id || null,
      player: row.full_name,
      position: row.position || null,
      depthChartPosition: row.depth_chart_position || null,
      depthRank: null,
      starterStatus: 'UNVERIFIED',
      rosterStatus: row.status || null,
      rosterStatusDescription: row.status_description_abbr || null,
      observedAt,
      source: ROSTER_SOURCE,
      sourceTimestamp: null,
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
      'Depth ranks, starter confirmation, game-day inactives, expected snaps, and player-specific replacement values are unavailable and remain null.',
      'Only explicit OUT designations receive a point availability value of 0; all uncertain designations remain null.',
    ],
  };
}

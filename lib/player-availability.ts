import { env } from 'cloudflare:workers';

const SEASON = 2026;
type DatabaseEnv = { DB?: D1Database };

export type PlayerAvailabilitySignal = {
  week: number;
  team: string;
  playerId?: string | null;
  playerName: string;
  position?: string | null;
  depthRole?: string | null;
  status: string;
  practiceStatus?: string | null;
  availabilityProbability?: number | null;
  expectedSnapShare?: number | null;
  replacementValue?: number | null;
  source: string;
  sourceUrl?: string | null;
  observedAt: string;
  payload: Record<string, unknown>;
  eligibleForModel?: boolean;
};

function db() {
  const binding = (env as unknown as DatabaseEnv).DB;
  if (!binding) throw new Error('Player-availability database binding is unavailable.');
  return binding;
}

function clampNullable(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function bucket(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid player-availability timestamp.');
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export async function savePlayerAvailability(signals: PlayerAvailabilitySignal[]) {
  if (!signals.length) return 0;
  const database = db();
  const statements = signals.slice(0, 200).map((signal) => {
    if (!Number.isInteger(signal.week) || signal.week < 1 || signal.week > 22)
      throw new Error('Invalid player-availability week.');
    if (!signal.team || !signal.playerName || !signal.status || !signal.source)
      throw new Error('Incomplete player-availability signal.');
    return database.prepare(
      `INSERT OR IGNORE INTO player_availability_snapshots (season, week, team, player_id, player_name, position, depth_role, status, practice_status, availability_probability, expected_snap_share, replacement_value, source, source_url, observed_at, capture_bucket, payload_json, eligible_for_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      SEASON,
      signal.week,
      signal.team,
      signal.playerId ?? null,
      signal.playerName,
      signal.position ?? null,
      signal.depthRole ?? null,
      signal.status,
      signal.practiceStatus ?? null,
      clampNullable(signal.availabilityProbability),
      clampNullable(signal.expectedSnapShare),
      signal.replacementValue ?? null,
      signal.source,
      signal.sourceUrl ?? null,
      signal.observedAt,
      bucket(signal.observedAt),
      JSON.stringify(signal.payload),
      signal.eligibleForModel ? 1 : 0,
    );
  });
  await database.batch(statements);
  return statements.length;
}

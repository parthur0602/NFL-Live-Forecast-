import { env } from 'cloudflare:workers';

const SEASON = 2026;
type DatabaseEnv = { DB?: D1Database };

type FootballSignal = {
  team: string;
  stateType: string;
  subject: string;
  status?: string | null;
  source: string;
  sourceUrl?: string | null;
  observedAt: string;
  confidence?: number | null;
  payload: Record<string, unknown>;
  eligibleForModel?: boolean;
};

function db() {
  const binding = (env as unknown as DatabaseEnv).DB;
  if (!binding) throw new Error('Football-state database binding is unavailable.');
  return binding;
}

function captureBucket(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid football-state timestamp.');
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export async function saveFootballSignals(signals: FootballSignal[]) {
  if (!signals.length) return 0;
  const database = db();
  const statements = signals.slice(0, 100).map((signal) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO football_state_snapshots (season, team, state_type, subject, status, source, source_url, observed_at, capture_bucket, confidence, payload_json, eligible_for_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        signal.team,
        signal.stateType,
        signal.subject,
        signal.status ?? null,
        signal.source,
        signal.sourceUrl ?? null,
        signal.observedAt,
        captureBucket(signal.observedAt),
        signal.confidence ?? null,
        JSON.stringify(signal.payload),
        signal.eligibleForModel ? 1 : 0,
      ),
  );
  await database.batch(statements);
  return statements.length;
}

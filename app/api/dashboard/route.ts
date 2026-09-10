import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { MODEL_V2 } from '@/lib/model-v2';
import { V5_PROSPECTIVE_ARTIFACT } from '@/lib/v5-prospective-artifact';

const SEASON = 2026;

function getDatabase() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('Dashboard database binding is unavailable.');
  return binding;
}

async function rows<T>(database: D1Database, sql: string, ...values: unknown[]) {
  return (await database.prepare(sql).bind(...values).all<T>()).results;
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const requestedWeek = Number.parseInt(search.get('week') ?? '1', 10);
  const week = Number.isInteger(requestedWeek)
    ? Math.min(18, Math.max(1, requestedWeek))
    : 1;
  const gameKey = search.get('gameKey');
  const teams = gameKey?.split('__') ?? [];
  const databaseCheckedAt = new Date().toISOString();

  try {
    const database = getDatabase();
    const gamePredicates = gameKey ? ' AND game_key = ?' : '';
    const gameValues = gameKey ? [gameKey] : [];
    const teamPredicates = teams.length === 2 ? ' AND team IN (?, ?)' : '';
    const teamValues = teams.length === 2 ? teams : [];

    const [
      marketHistory,
      prospectiveHistory,
      efficiency,
      footballState,
      playerAvailability,
      specialists,
      learningRuns,
      adjustments,
      summary,
      memory,
    ] = await Promise.all([
      rows(
        database,
        `SELECT * FROM market_snapshots WHERE season = ? AND week = ?${gamePredicates} ORDER BY observed_at DESC LIMIT 160`,
        SEASON,
        week,
        ...gameValues,
      ),
      rows(
        database,
        `SELECT * FROM prospective_model_snapshots WHERE season = ? AND week = ?${gamePredicates} ORDER BY captured_at DESC LIMIT 160`,
        SEASON,
        week,
        ...gameValues,
      ),
      rows(
        database,
        `SELECT * FROM team_efficiency_snapshots WHERE season = ?${teamPredicates} ORDER BY observed_at DESC LIMIT 96`,
        SEASON,
        ...teamValues,
      ),
      rows(
        database,
        `SELECT * FROM football_state_snapshots WHERE season = ?${teamPredicates} ORDER BY observed_at DESC LIMIT 96`,
        SEASON,
        ...teamValues,
      ),
      rows(
        database,
        `SELECT * FROM player_availability_snapshots WHERE season = ?${teamPredicates} ORDER BY observed_at DESC LIMIT 96`,
        SEASON,
        ...teamValues,
      ),
      rows(
        database,
        `SELECT * FROM specialist_registry ORDER BY code ASC`,
      ),
      rows(
        database,
        `SELECT * FROM weekly_learning_runs WHERE season = ? ORDER BY week DESC LIMIT 18`,
        SEASON,
      ),
      rows(
        database,
        `SELECT * FROM model_adjustments WHERE season = ? ORDER BY created_at DESC LIMIT 36`,
        SEASON,
      ),
      rows(
        database,
        `SELECT
          (SELECT COUNT(*) FROM prediction_snapshots WHERE season = ?) AS canonical_predictions,
          (SELECT COUNT(*) FROM forecast_ledger WHERE season = ?) AS forecast_ledger_rows,
          (SELECT COUNT(*) FROM prospective_model_snapshots WHERE season = ?) AS prospective_rows,
          (SELECT COUNT(*) FROM game_postmortems WHERE season = ?) AS postmortems,
          (SELECT COUNT(*) FROM error_memory) AS error_memory,
          (SELECT COUNT(*) FROM success_memory) AS success_memory`,
        SEASON,
        SEASON,
        SEASON,
        SEASON,
      ),
      rows(
        database,
        `SELECT game_key, week, correct, error_severity, created_at FROM game_postmortems WHERE season = ? ORDER BY created_at DESC LIMIT 18`,
        SEASON,
      ),
    ]);

    return NextResponse.json(
      {
        season: SEASON,
        week,
        gameKey,
        databaseCheckedAt,
        marketHistory,
        prospectiveHistory,
        efficiency,
        footballState,
        playerAvailability,
        specialists,
        learningRuns,
        adjustments,
        summary: summary[0] ?? null,
        recentPostmortems: memory,
        production: {
          v2Version: MODEL_V2.version,
          v2FootballCorrectionWeight: MODEL_V2.footballCorrectionWeight,
          marketBaselineProductionWeight: 1,
          v5Version: V5_PROSPECTIVE_ARTIFACT.version,
          v5ArtifactHash: V5_PROSPECTIVE_ARTIFACT.artifactHash,
          v5ProductionInfluence: 0,
          policy:
            'V2 is the production model. V5 is a prospective shadow exam and cannot change production probabilities, specialist weights, or betting behavior.',
        },
      },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Dashboard research state is temporarily unavailable.',
        detail: error instanceof Error ? error.message : 'Unknown database error',
        databaseCheckedAt,
      },
      { status: 503, headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }
}

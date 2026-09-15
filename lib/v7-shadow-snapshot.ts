/**
 * V7 is a research-only challenger. This writer intentionally has no path to
 * prediction_snapshots, V2 weights, specialist weights, or betting output.
 */
type D1Statement = {
  bind(...values: (string | number | null)[]): D1Statement;
  run(): unknown;
  all<T>(): Promise<{ results: T[] }> | { results: T[] };
};

type D1Database = { prepare(sql: string): D1Statement };

export const V7_CAPTURE_TARGETS = ['OPENING', '72H', '24H', '6H', '90M', 'FINAL_PREKICK'] as const;
export type V7CaptureTarget = (typeof V7_CAPTURE_TARGETS)[number] | 'CURRENT_BASELINE';
export type V7HorizonStatus = 'ON_TIME' | 'LATE' | 'BASELINE' | 'LEGACY';

export type V7CapturePlan = {
  target: V7CaptureTarget;
  actualHorizonMinutes: number;
  status: V7HorizonStatus;
};

const TARGET_MINUTES: Record<Exclude<V7CaptureTarget, 'OPENING' | 'CURRENT_BASELINE'>, number> = {
  '72H': 72 * 60,
  '24H': 24 * 60,
  '6H': 6 * 60,
  '90M': 90,
  FINAL_PREKICK: 15,
};

/**
 * Chooses one honest, immutable capture for a dashboard refresh. A missed
 * historical target is never backfilled under its old timestamp; the first
 * available retrieval is stored as CURRENT_BASELINE instead.
 */
export function nextV7CapturePlan(
  scheduledKickoffAt: string,
  now: Date,
  alreadyCaptured: ReadonlySet<string>,
): V7CapturePlan | null {
  const minutes = (new Date(scheduledKickoffAt).getTime() - now.getTime()) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (!alreadyCaptured.has('CURRENT_BASELINE'))
    return { target: 'CURRENT_BASELINE', actualHorizonMinutes: minutes, status: 'BASELINE' };
  for (const target of ['72H', '24H', '6H', '90M', 'FINAL_PREKICK'] as const) {
    const expected = TARGET_MINUTES[target];
    if (alreadyCaptured.has(target) || minutes > expected) continue;
    const toleranceMinutes = target === 'FINAL_PREKICK' ? 5 : Math.max(15, expected * 0.08);
    return {
      target,
      actualHorizonMinutes: minutes,
      status: Math.abs(minutes - expected) <= toleranceMinutes ? 'ON_TIME' : 'LATE',
    };
  }
  return null;
}

type HorizonRow = { game_key: string; capture_horizon: string };

export async function v7CapturedHorizons(
  db: D1Database,
  season: number,
  week: number,
) {
  const result = await db
    .prepare(
      `SELECT game_key, capture_horizon FROM v7_intelligence_snapshots WHERE season = ? AND week = ?`,
    )
    .bind(season, week)
    .all<HorizonRow>();
  const byGame = new Map<string, Set<string>>();
  for (const row of result.results)
    (byGame.get(row.game_key) ?? byGame.set(row.game_key, new Set()).get(row.game_key)!).add(row.capture_horizon);
  return byGame;
}

export type V7SnapshotInput = {
  season: number;
  week: number;
  gameKey: string;
  awayTeam: string;
  homeTeam: string;
  scheduledKickoffAt: string;
  capture: V7CapturePlan;
  featureCutoffAt: string;
  market: {
    observedAt: string | null;
    source: string | null;
    homeProbability: number | null;
    awayMoneyline: number | null;
    homeMoneyline: number | null;
    homeSpread: number | null;
    totalLine: number | null;
  };
  v2: {
    homeProbability: number;
    predictedWinner: string;
    modelVersion: string;
  };
  probabilities: {
    footballHome: number | null;
    playerAvailabilityHome: number | null;
    matchupHome: number | null;
    upsetRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' | 'UNAVAILABLE';
    upsetHomeAdjustment: number | null;
    finalHome: number;
  };
  modelVersion: string;
  modelHash: string;
  teamRatings: unknown;
  playerAvailability: unknown;
  depthChart: unknown;
  weatherRestTravel: unknown;
  teamEfficiency: unknown;
  specialists: unknown;
  sourceStatus: unknown;
  playerIntelligence: unknown;
  whyV7Differs: unknown;
};

function captureBucket(instant: Date) {
  instant.setMinutes(0, 0, 0);
  return instant.toISOString();
}

/** Returns false once kickoff has passed; snapshots are never backfilled. */
export async function saveV7ShadowSnapshot(
  db: D1Database,
  input: V7SnapshotInput,
  now = new Date(),
) {
  if (new Date(input.scheduledKickoffAt).getTime() <= now.getTime())
    return { captured: false, reason: 'KICKOFF_PASSED' as const };

  const capturedAt = now.toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO v7_intelligence_snapshots (
        season, week, game_key, away_team, home_team, scheduled_kickoff_at,
        capture_bucket, capture_horizon, actual_horizon_minutes, horizon_status,
        captured_at, feature_cutoff_at, market_observed_at,
        market_source, market_home_probability, away_moneyline, home_moneyline,
        home_spread, total_line, v2_home_probability, v2_predicted_winner,
        v2_model_version, football_home_probability,
        player_availability_home_probability, matchup_home_probability, upset_risk,
        upset_home_adjustment, final_home_probability, predicted_winner, model_version, model_hash,
        team_ratings_json, player_availability_json, depth_chart_json,
        weather_rest_travel_json, team_efficiency_json, specialist_outputs_json,
        source_status_json, player_intelligence_json, why_v7_differs_json, production_influence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      input.season, input.week, input.gameKey, input.awayTeam, input.homeTeam,
      input.scheduledKickoffAt, captureBucket(new Date(now)), input.capture.target,
      input.capture.actualHorizonMinutes, input.capture.status, capturedAt,
      input.featureCutoffAt, input.market.observedAt, input.market.source,
      input.market.homeProbability, input.market.awayMoneyline,
      input.market.homeMoneyline, input.market.homeSpread, input.market.totalLine,
      input.v2.homeProbability, input.v2.predictedWinner, input.v2.modelVersion,
      input.probabilities.footballHome, input.probabilities.playerAvailabilityHome,
      input.probabilities.matchupHome, input.probabilities.upsetRisk,
      input.probabilities.upsetHomeAdjustment, input.probabilities.finalHome,
      input.probabilities.finalHome >= 0.5 ? input.homeTeam : input.awayTeam,
      input.modelVersion, input.modelHash, JSON.stringify(input.teamRatings),
      JSON.stringify(input.playerAvailability), JSON.stringify(input.depthChart),
      JSON.stringify(input.weatherRestTravel), JSON.stringify(input.teamEfficiency),
      JSON.stringify(input.specialists), JSON.stringify(input.sourceStatus),
      JSON.stringify(input.playerIntelligence), JSON.stringify(input.whyV7Differs),
    )
    .run() as { meta?: { changes?: number } } | undefined;

  const changes = result?.meta?.changes;
  return {
    captured: true,
    inserted: typeof changes === 'number' ? changes > 0 : null,
    reason: null,
  };
}

export type V7SettlementInput = {
  season: number;
  gameKey: string;
  awayScore: number;
  homeScore: number;
  /**
   * This must cite a fact contained in the frozen V7 snapshot. A postgame
   * outcome cannot be passed here as a "predictable" signal.
   */
  validatedPregameFactor?: string | null;
  postKickoffEvents?: string[];
  sourceQuality: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
};

type FrozenSnapshot = {
  id: number;
  away_team: string;
  home_team: string;
  final_home_probability: number;
  market_home_probability: number | null;
  football_home_probability: number | null;
  matchup_home_probability: number | null;
  upset_risk: string | null;
  player_availability_json: string;
  source_status_json: string;
};

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function explicitAvailabilityWarnings(value: string) {
  const payload = parseObject(value);
  const entries = [payload.away, payload.home].flatMap((team) =>
    Array.isArray(team) ? team : [],
  );
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const status = String(record.injuryDesignation ?? '').trim().toUpperCase();
    return status === 'OUT'
      ? [String(record.player ?? 'Unnamed player')]
      : [];
  });
}

/**
 * Settles every immutable V7 capture for a game with one result. This does
 * not write to the canonical pick, learning, market, or specialist tables.
 */
export async function settleV7ShadowSnapshots(
  db: D1Database,
  input: V7SettlementInput,
) {
  const snapshotResult = await db
    .prepare(
      `SELECT id, away_team, home_team, final_home_probability
              , market_home_probability, football_home_probability,
                matchup_home_probability, upset_risk, player_availability_json,
                source_status_json
       FROM v7_intelligence_snapshots
       WHERE season = ? AND game_key = ? AND settled_at IS NULL`,
    )
    .bind(input.season, input.gameKey)
    .all<FrozenSnapshot>();
  const snapshots = snapshotResult.results;
  if (!snapshots.length) return { settled: false, reason: 'NO_UNSETTLED_SNAPSHOT' as const };
  const settledAt = new Date().toISOString();
  const outcomes = [];
  for (const snapshot of snapshots) {
    const winner = input.homeScore > input.awayScore
      ? snapshot.home_team
      : input.awayScore > input.homeScore
        ? snapshot.away_team
        : 'TIE';
    const predictedWinner = snapshot.final_home_probability >= 0.5
      ? snapshot.home_team
      : snapshot.away_team;
    const correct = winner !== 'TIE' && predictedWinner === winner;
    const actualWinnerProbability = winner === 'TIE'
      ? null
      : winner === snapshot.home_team
        ? snapshot.final_home_probability
        : 1 - snapshot.final_home_probability;
    const taxonomy = input.validatedPregameFactor
      ? 'PREDICTABLE_MISS'
      : input.postKickoffEvents?.length
        ? 'IRREDUCIBLE_OR_IN_GAME_VARIANCE'
        : 'CALIBRATION_OR_UNCERTAINTY_MISS';
    const availabilityWarnings = explicitAvailabilityWarnings(snapshot.player_availability_json);
    const postmortem = {
      taxonomy,
      surprise: actualWinnerProbability === null
        ? null
        : -Math.log(Math.max(0.000001, actualWinnerProbability)),
      validatedPregameFactor: input.validatedPregameFactor ?? null,
      postKickoffEvents: input.postKickoffEvents ?? [],
      sourceQuality: input.sourceQuality,
      causalReview: {
        favoriteChoiceWrong: winner === 'TIE' ? 'TIE' : !correct,
        confidenceTooHigh: !correct && Math.max(snapshot.final_home_probability, 1 - snapshot.final_home_probability) >= 0.7
          ? 'POSSIBLE_REQUIRES_CALIBRATION_SAMPLE'
          : 'NOT_ESTABLISHED',
        playerAvailabilityWarning: availabilityWarnings.length
          ? { explicitOutDesignations: availabilityWarnings }
          : 'NONE_CAPTURED_OR_UNAVAILABLE',
        matchupWarning: ['HIGH', 'EXTREME'].includes(snapshot.upset_risk ?? '')
          ? snapshot.upset_risk
          : 'NONE_CAPTURED_OR_UNAVAILABLE',
        meaningfulLineMovement: 'UNAVAILABLE_NO_TIMESTAMPED_MARKET_SERIES',
        randomTurnoverOrExplosiveVariance: 'UNAVAILABLE_NO_VALIDATED_POSTGAME_EVENT_SOURCE',
        majorInGameInjury: input.postKickoffEvents?.length
          ? input.postKickoffEvents
          : 'UNAVAILABLE_NO_VALIDATED_IN_GAME_INJURY_SOURCE',
        validPregameInformationWouldChangeWinner: input.validatedPregameFactor
          ? 'POSSIBLE_RESEARCH_REVIEW_REQUIRED'
          : 'NOT_ESTABLISHED',
        validPregameInformationWouldOnlyLowerConfidence: 'NOT_ESTABLISHED',
        resultIrreducible: input.postKickoffEvents?.length
          ? 'POSSIBLE'
          : 'UNDETERMINED',
        frozenInputs: {
          marketHomeProbability: snapshot.market_home_probability,
          footballHomeProbability: snapshot.football_home_probability,
          matchupHomeProbability: snapshot.matchup_home_probability,
          sourceStatus: parseObject(snapshot.source_status_json),
        },
      },
      learningAction: 'RESEARCH_EVIDENCE_ONLY',
    };
    await db
      .prepare(
        `UPDATE v7_intelligence_snapshots
         SET settled_at = ?, away_score = ?, home_score = ?, winner = ?, correct = ?, postmortem_json = ?
         WHERE id = ? AND settled_at IS NULL`,
      )
      .bind(
        settledAt, input.awayScore, input.homeScore, winner,
        correct ? 1 : 0, JSON.stringify(postmortem), snapshot.id,
      )
      .run();
    outcomes.push({ id: snapshot.id, correct, postmortem });
  }
  return { settled: true, snapshots: outcomes };
}

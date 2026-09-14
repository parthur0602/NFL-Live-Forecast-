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

export type V7SnapshotInput = {
  season: number;
  week: number;
  gameKey: string;
  awayTeam: string;
  homeTeam: string;
  scheduledKickoffAt: string;
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
  probabilities: {
    footballHome: number | null;
    playerAvailabilityHome: number | null;
    matchupHome: number | null;
    upsetRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' | 'UNAVAILABLE';
    upsetHomeAdjustment: number | null;
    finalHome: number;
  };
  modelVersion: string;
  teamRatings: unknown;
  playerAvailability: unknown;
  depthChart: unknown;
  weatherRestTravel: unknown;
  teamEfficiency: unknown;
  specialists: unknown;
  sourceStatus: unknown;
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
  await db
    .prepare(
      `INSERT OR IGNORE INTO v7_intelligence_snapshots (
        season, week, game_key, away_team, home_team, scheduled_kickoff_at,
        capture_bucket, captured_at, feature_cutoff_at, market_observed_at,
        market_source, market_home_probability, away_moneyline, home_moneyline,
        home_spread, total_line, football_home_probability,
        player_availability_home_probability, matchup_home_probability, upset_risk,
        upset_home_adjustment, final_home_probability, predicted_winner, model_version,
        team_ratings_json, player_availability_json, depth_chart_json,
        weather_rest_travel_json, team_efficiency_json, specialist_outputs_json,
        source_status_json, production_influence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      input.season, input.week, input.gameKey, input.awayTeam, input.homeTeam,
      input.scheduledKickoffAt, captureBucket(new Date(now)), capturedAt,
      input.featureCutoffAt, input.market.observedAt, input.market.source,
      input.market.homeProbability, input.market.awayMoneyline,
      input.market.homeMoneyline, input.market.homeSpread, input.market.totalLine,
      input.probabilities.footballHome, input.probabilities.playerAvailabilityHome,
      input.probabilities.matchupHome, input.probabilities.upsetRisk,
      input.probabilities.upsetHomeAdjustment, input.probabilities.finalHome,
      input.probabilities.finalHome >= 0.5 ? input.homeTeam : input.awayTeam,
      input.modelVersion, JSON.stringify(input.teamRatings),
      JSON.stringify(input.playerAvailability), JSON.stringify(input.depthChart),
      JSON.stringify(input.weatherRestTravel), JSON.stringify(input.teamEfficiency),
      JSON.stringify(input.specialists), JSON.stringify(input.sourceStatus),
    )
    .run();

  return { captured: true, reason: null };
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
};

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
    const winner = input.homeScore > input.awayScore ? snapshot.home_team : snapshot.away_team;
    const predictedWinner = snapshot.final_home_probability >= 0.5
      ? snapshot.home_team
      : snapshot.away_team;
    const correct = predictedWinner === winner;
    const actualWinnerProbability = winner === snapshot.home_team
      ? snapshot.final_home_probability
      : 1 - snapshot.final_home_probability;
    const taxonomy = input.validatedPregameFactor
      ? 'PREDICTABLE_MISS'
      : input.postKickoffEvents?.length
        ? 'IRREDUCIBLE_OR_IN_GAME_VARIANCE'
        : 'CALIBRATION_OR_UNCERTAINTY_MISS';
    const postmortem = {
      taxonomy,
      surprise: -Math.log(Math.max(0.000001, actualWinnerProbability)),
      validatedPregameFactor: input.validatedPregameFactor ?? null,
      postKickoffEvents: input.postKickoffEvents ?? [],
      sourceQuality: input.sourceQuality,
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

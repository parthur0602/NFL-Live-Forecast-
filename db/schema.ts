import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const predictionSnapshots = sqliteTable(
  'prediction_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    awayTeam: text('away_team').notNull(),
    homeTeam: text('home_team').notNull(),
    predictedWinner: text('predicted_winner').notNull(),
    homeProbability: real('home_probability').notNull(),
    marketHomeProbability: real('market_home_probability'),
    footballHomeProbability: real('football_home_probability'),
    expectedHomeMargin: real('expected_home_margin'),
    marketExpectedHomeMargin: real('market_expected_home_margin'),
    homeSpread: real('home_spread'),
    homeCoverProbability: real('home_cover_probability'),
    modelVersion: text('model_version'),
    favoriteProbability: real('favorite_probability').notNull(),
    liveDelta: real('live_delta').notNull().default(0),
    capturedAt: text('captured_at').notNull(),
    settledAt: text('settled_at'),
    awayScore: integer('away_score'),
    homeScore: integer('home_score'),
    winner: text('winner'),
    correct: integer('correct', { mode: 'boolean' }),
  },
  (table) => [
    uniqueIndex('uq_prediction_snapshots_game').on(table.season, table.gameKey),
    index('idx_prediction_snapshots_season_week').on(table.season, table.week),
    index('idx_prediction_snapshots_unsettled').on(
      table.season,
      table.settledAt,
    ),
  ],
);

// Time-series ledger for prospective same-timestamp evaluation. Unlike
// predictionSnapshots (the canonical one-pick-per-game learning record), this
// table intentionally permits multiple immutable pre-kickoff forecasts for a
// game. captureBucket prevents browser refreshes from flooding the ledger.
export const forecastLedger = sqliteTable(
  'forecast_ledger',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    awayTeam: text('away_team').notNull(),
    homeTeam: text('home_team').notNull(),
    predictedWinner: text('predicted_winner').notNull(),
    homeProbability: real('home_probability').notNull(),
    marketHomeProbability: real('market_home_probability'),
    footballHomeProbability: real('football_home_probability'),
    expectedHomeMargin: real('expected_home_margin'),
    marketExpectedHomeMargin: real('market_expected_home_margin'),
    homeSpread: real('home_spread'),
    homeCoverProbability: real('home_cover_probability'),
    modelVersion: text('model_version'),
    favoriteProbability: real('favorite_probability').notNull(),
    liveDelta: real('live_delta').notNull().default(0),
    captureBucket: text('capture_bucket').notNull(),
    capturedAt: text('captured_at').notNull(),
    settledAt: text('settled_at'),
    awayScore: integer('away_score'),
    homeScore: integer('home_score'),
    winner: text('winner'),
    correct: integer('correct', { mode: 'boolean' }),
  },
  (table) => [
    uniqueIndex('uq_forecast_ledger_game_bucket').on(
      table.season,
      table.gameKey,
      table.captureBucket,
    ),
    index('idx_forecast_ledger_game_time').on(
      table.season,
      table.gameKey,
      table.capturedAt,
    ),
    index('idx_forecast_ledger_season_week').on(table.season, table.week),
  ],
);

// Immutable, paired V2-versus-V5 exam records. These intentionally live
// outside the canonical prediction and learning ledgers: one row preserves the
// two model outputs produced from one server-computed market observation.
export const prospectiveModelSnapshots = sqliteTable(
  'prospective_model_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    awayTeam: text('away_team').notNull(),
    homeTeam: text('home_team').notNull(),
    scheduledKickoffAt: text('scheduled_kickoff_at'),
    captureBucket: text('capture_bucket').notNull(),
    capturedAt: text('captured_at').notNull(),
    marketObservedAt: text('market_observed_at'),
    marketSource: text('market_source'),
    marketHomeProbability: real('market_home_probability'),
    v2HomeProbability: real('v2_home_probability').notNull(),
    v2PredictedWinner: text('v2_predicted_winner').notNull(),
    v2ModelVersion: text('v2_model_version').notNull(),
    v5HomeProbability: real('v5_home_probability'),
    v5PredictedWinner: text('v5_predicted_winner'),
    v5RawResidualLogit: real('v5_raw_residual_logit'),
    v5AppliedShadowScale: real('v5_applied_shadow_scale'),
    v5ModelVersion: text('v5_model_version'),
    v5FeatureDataThroughWeek: integer('v5_feature_data_through_week'),
    v5FeaturePayloadJson: text('v5_feature_payload_json'),
    v5Available: integer('v5_available', { mode: 'boolean' })
      .notNull()
      .default(false),
    productionInfluence: real('production_influence').notNull().default(0),
    settledAt: text('settled_at'),
    awayScore: integer('away_score'),
    homeScore: integer('home_score'),
    winner: text('winner'),
    v2Correct: integer('v2_correct', { mode: 'boolean' }),
    v5Correct: integer('v5_correct', { mode: 'boolean' }),
  },
  (table) => [
    uniqueIndex('uq_prospective_model_game_bucket').on(
      table.season,
      table.gameKey,
      table.captureBucket,
    ),
    index('idx_prospective_model_season_week').on(table.season, table.week),
    index('idx_prospective_model_game_time').on(
      table.season,
      table.gameKey,
      table.capturedAt,
    ),
    index('idx_prospective_model_unsettled').on(table.season, table.settledAt),
  ],
);

// V7 research records are an immutable, fuller pre-kickoff evidence packet.
// They are deliberately separate from predictionSnapshots and the V2/V5 exam:
// V7 is a shadow challenger and must never affect the canonical pick ledger.
export const v7IntelligenceSnapshots = sqliteTable(
  'v7_intelligence_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    awayTeam: text('away_team').notNull(),
    homeTeam: text('home_team').notNull(),
    scheduledKickoffAt: text('scheduled_kickoff_at').notNull(),
    captureBucket: text('capture_bucket').notNull(),
    captureHorizon: text('capture_horizon').notNull().default('LEGACY_HOURLY'),
    actualHorizonMinutes: real('actual_horizon_minutes'),
    horizonStatus: text('horizon_status').notNull().default('LEGACY'),
    capturedAt: text('captured_at').notNull(),
    featureCutoffAt: text('feature_cutoff_at').notNull(),
    marketObservedAt: text('market_observed_at'),
    marketSource: text('market_source'),
    marketHomeProbability: real('market_home_probability'),
    awayMoneyline: integer('away_moneyline'),
    homeMoneyline: integer('home_moneyline'),
    homeSpread: real('home_spread'),
    totalLine: real('total_line'),
    v2HomeProbability: real('v2_home_probability').notNull(),
    v2PredictedWinner: text('v2_predicted_winner').notNull(),
    v2ModelVersion: text('v2_model_version').notNull(),
    footballHomeProbability: real('football_home_probability'),
    playerAvailabilityHomeProbability: real('player_availability_home_probability'),
    matchupHomeProbability: real('matchup_home_probability'),
    upsetRisk: text('upset_risk'),
    upsetHomeAdjustment: real('upset_home_adjustment'),
    finalHomeProbability: real('final_home_probability').notNull(),
    predictedWinner: text('predicted_winner').notNull(),
    modelVersion: text('model_version').notNull(),
    modelHash: text('model_hash').notNull(),
    teamRatingsJson: text('team_ratings_json').notNull(),
    playerAvailabilityJson: text('player_availability_json').notNull(),
    depthChartJson: text('depth_chart_json').notNull(),
    weatherRestTravelJson: text('weather_rest_travel_json').notNull(),
    teamEfficiencyJson: text('team_efficiency_json').notNull(),
    specialistOutputsJson: text('specialist_outputs_json').notNull(),
    sourceStatusJson: text('source_status_json').notNull(),
    playerIntelligenceJson: text('player_intelligence_json').notNull().default('{}'),
    whyV7DiffersJson: text('why_v7_differs_json').notNull().default('[]'),
    productionInfluence: real('production_influence').notNull().default(0),
    settledAt: text('settled_at'),
    awayScore: integer('away_score'),
    homeScore: integer('home_score'),
    winner: text('winner'),
    correct: integer('correct', { mode: 'boolean' }),
    postmortemJson: text('postmortem_json'),
  },
  (table) => [
    uniqueIndex('uq_v7_intelligence_game_horizon_bucket').on(
      table.season,
      table.gameKey,
      table.captureHorizon,
      table.captureBucket,
    ),
    index('idx_v7_intelligence_season_week').on(table.season, table.week),
    index('idx_v7_intelligence_game_time').on(
      table.season,
      table.gameKey,
      table.capturedAt,
    ),
    index('idx_v7_intelligence_unsettled').on(table.season, table.settledAt),
  ],
);

// Timestamped research evidence only. Unstructured reports are deliberately
// ineligible for production forecasts until a specialist proves incremental
// value in chronological, timestamp-matched evaluation.
export const footballStateSnapshots = sqliteTable(
  'football_state_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    team: text('team').notNull(),
    stateType: text('state_type').notNull(),
    subject: text('subject').notNull(),
    status: text('status'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    observedAt: text('observed_at').notNull(),
    captureBucket: text('capture_bucket').notNull(),
    confidence: real('confidence'),
    payloadJson: text('payload_json').notNull(),
    eligibleForModel: integer('eligible_for_model', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex('uq_football_state_signal_bucket').on(
      table.season,
      table.team,
      table.stateType,
      table.subject,
      table.source,
      table.captureBucket,
    ),
    index('idx_football_state_team_time').on(
      table.season,
      table.team,
      table.observedAt,
    ),
    index('idx_football_state_type_time').on(
      table.season,
      table.stateType,
      table.observedAt,
    ),
  ],
);

// Structured, game-complete team statistics for forward-only specialist
// research. These are not connected to the live V2 probability path.
export const teamEfficiencySnapshots = sqliteTable(
  'team_efficiency_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    team: text('team').notNull(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    observedAt: text('observed_at').notNull(),
    captureBucket: text('capture_bucket').notNull(),
    gamesInSample: integer('games_in_sample').notNull(),
    passingEpa: real('passing_epa'),
    rushingEpa: real('rushing_epa'),
    receivingEpa: real('receiving_epa'),
    passingSuccessRate: real('passing_success_rate'),
    rushingSuccessRate: real('rushing_success_rate'),
    completionPercentage: real('completion_percentage'),
    yardsPerAttempt: real('yards_per_attempt'),
    sackRate: real('sack_rate'),
    turnoverRate: real('turnover_rate'),
    payloadJson: text('payload_json').notNull(),
    eligibleForModel: integer('eligible_for_model', { mode: 'boolean' })
      .notNull()
      .default(true),
  },
  (table) => [
    uniqueIndex('uq_team_efficiency_team_week_bucket').on(
      table.season,
      table.week,
      table.team,
      table.captureBucket,
    ),
    index('idx_team_efficiency_team_time').on(
      table.season,
      table.team,
      table.observedAt,
    ),
    index('idx_team_efficiency_week').on(table.season, table.week),
  ],
);

// Structured availability observations are stored exactly as sourced. They
// remain ineligible for production unless a future, validated source says so.
export const playerAvailabilitySnapshots = sqliteTable(
  'player_availability_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    team: text('team').notNull(),
    playerId: text('player_id'),
    playerName: text('player_name').notNull(),
    position: text('position'),
    depthRole: text('depth_role'),
    status: text('status').notNull(),
    practiceStatus: text('practice_status'),
    availabilityProbability: real('availability_probability'),
    expectedSnapShare: real('expected_snap_share'),
    replacementValue: real('replacement_value'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    observedAt: text('observed_at').notNull(),
    captureBucket: text('capture_bucket').notNull(),
    payloadJson: text('payload_json').notNull(),
    eligibleForModel: integer('eligible_for_model', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex('uq_player_availability_signal_bucket').on(
      table.season,
      table.week,
      table.team,
      table.playerName,
      table.source,
      table.captureBucket,
    ),
    index('idx_player_availability_team_time').on(
      table.season,
      table.team,
      table.observedAt,
    ),
    index('idx_player_availability_position_time').on(
      table.season,
      table.position,
      table.observedAt,
    ),
  ],
);

export const gamePostmortems = sqliteTable(
  'game_postmortems',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    snapshotId: integer('snapshot_id').notNull(),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    modelVersion: text('model_version').notNull(),
    predictedWinner: text('predicted_winner').notNull(),
    actualWinner: text('actual_winner').notNull(),
    homeProbability: real('home_probability').notNull(),
    marketHomeProbability: real('market_home_probability'),
    expectedHomeMargin: real('expected_home_margin'),
    actualHomeMargin: real('actual_home_margin').notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    errorSeverity: real('error_severity').notNull(),
    probabilitySurprise: real('probability_surprise').notNull(),
    taxonomyJson: text('taxonomy_json').notNull(),
    pregameFeaturesJson: text('pregame_features_json').notNull(),
    dataQuality: text('data_quality').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_game_postmortems_snapshot').on(table.snapshotId),
    index('idx_game_postmortems_season_week').on(table.season, table.week),
    index('idx_game_postmortems_severity').on(table.errorSeverity),
  ],
);

export const errorMemory = sqliteTable(
  'error_memory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    snapshotId: integer('snapshot_id').notNull(),
    gameKey: text('game_key').notNull(),
    severity: real('severity').notNull(),
    pregameFeaturesJson: text('pregame_features_json').notNull(),
    lesson: text('lesson').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_error_memory_snapshot').on(table.snapshotId),
    index('idx_error_memory_severity').on(table.severity),
  ],
);

export const successMemory = sqliteTable(
  'success_memory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    snapshotId: integer('snapshot_id').notNull(),
    gameKey: text('game_key').notNull(),
    pregameFeaturesJson: text('pregame_features_json').notNull(),
    lesson: text('lesson').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_success_memory_snapshot').on(table.snapshotId),
    index('idx_success_memory_game').on(table.gameKey),
  ],
);

export const specialistRegistry = sqliteTable(
  'specialist_registry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    status: text('status').notNull(),
    productionWeight: real('production_weight').notNull().default(0),
    evidence: text('evidence').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_specialist_registry_code').on(table.code)],
);

export const marketSnapshots = sqliteTable(
  'market_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gameKey: text('game_key').notNull(),
    source: text('source').notNull(),
    observedAt: text('observed_at').notNull(),
    awayMoneyline: integer('away_moneyline'),
    homeMoneyline: integer('home_moneyline'),
    awaySpread: real('away_spread'),
    homeSpread: real('home_spread'),
    totalLine: real('total_line'),
    awaySpreadOdds: integer('away_spread_odds'),
    homeSpreadOdds: integer('home_spread_odds'),
    overOdds: integer('over_odds'),
    underOdds: integer('under_odds'),
  },
  (table) => [
    uniqueIndex('uq_market_snapshots_source_game_time').on(
      table.source,
      table.gameKey,
      table.observedAt,
    ),
    index('idx_market_snapshots_season_week').on(table.season, table.week),
    index('idx_market_snapshots_game_time').on(table.gameKey, table.observedAt),
  ],
);

export const weeklyLearningRuns = sqliteTable(
  'weekly_learning_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    gradedGames: integer('graded_games').notNull(),
    correctPicks: integer('correct_picks').notNull(),
    brierScore: real('brier_score').notNull(),
    homeResidual: real('home_residual').notNull(),
    favoriteResidual: real('favorite_residual').notNull(),
    insight: text('insight').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_weekly_learning_runs').on(table.season, table.week),
  ],
);

export const modelAdjustments = sqliteTable(
  'model_adjustments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    kind: text('kind').notNull(),
    delta: real('delta').notNull(),
    reason: text('reason').notNull(),
    sampleSize: integer('sample_size').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_model_adjustments_week_kind').on(
      table.season,
      table.week,
      table.kind,
    ),
    index('idx_model_adjustments_season_kind').on(table.season, table.kind),
  ],
);

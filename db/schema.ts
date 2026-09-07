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

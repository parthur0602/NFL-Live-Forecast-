import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const predictionSnapshots = sqliteTable('prediction_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  gameKey: text('game_key').notNull(),
  awayTeam: text('away_team').notNull(),
  homeTeam: text('home_team').notNull(),
  predictedWinner: text('predicted_winner').notNull(),
  homeProbability: real('home_probability').notNull(),
  favoriteProbability: real('favorite_probability').notNull(),
  liveDelta: real('live_delta').notNull().default(0),
  capturedAt: text('captured_at').notNull(),
  settledAt: text('settled_at'),
  awayScore: integer('away_score'),
  homeScore: integer('home_score'),
  winner: text('winner'),
  correct: integer('correct', { mode: 'boolean' }),
}, (table) => [
  uniqueIndex('uq_prediction_snapshots_game').on(table.season, table.gameKey),
  index('idx_prediction_snapshots_season_week').on(table.season, table.week),
  index('idx_prediction_snapshots_unsettled').on(table.season, table.settledAt),
]);

export const weeklyLearningRuns = sqliteTable('weekly_learning_runs', {
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
}, (table) => [
  uniqueIndex('uq_weekly_learning_runs').on(table.season, table.week),
]);

export const modelAdjustments = sqliteTable('model_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  kind: text('kind').notNull(),
  delta: real('delta').notNull(),
  reason: text('reason').notNull(),
  sampleSize: integer('sample_size').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_model_adjustments_week_kind').on(table.season, table.week, table.kind),
  index('idx_model_adjustments_season_kind').on(table.season, table.kind),
]);

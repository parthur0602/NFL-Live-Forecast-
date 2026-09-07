import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

// Minimal D1-compatible adapter for the local Node fallback. Production still
// uses the real Cloudflare D1 binding through cloudflare:workers.
const database = new DatabaseSync(':memory:');

database.exec(`
  CREATE TABLE model_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    kind TEXT NOT NULL,
    delta REAL NOT NULL,
    reason TEXT NOT NULL,
    sample_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_model_adjustments_week_kind
    ON model_adjustments (season, week, kind);
  CREATE INDEX idx_model_adjustments_season_kind
    ON model_adjustments (season, kind);
  CREATE TABLE prediction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    predicted_winner TEXT NOT NULL,
    home_probability REAL NOT NULL,
    favorite_probability REAL NOT NULL,
    live_delta REAL DEFAULT 0 NOT NULL,
    captured_at TEXT NOT NULL,
    settled_at TEXT,
    away_score INTEGER,
    home_score INTEGER,
    winner TEXT,
    correct INTEGER,
    market_home_probability REAL,
    football_home_probability REAL,
    expected_home_margin REAL,
    market_expected_home_margin REAL,
    home_spread REAL,
    home_cover_probability REAL,
    model_version TEXT
  );
  CREATE UNIQUE INDEX uq_prediction_snapshots_game
    ON prediction_snapshots (season, game_key);
  CREATE INDEX idx_prediction_snapshots_season_week
    ON prediction_snapshots (season, week);
  CREATE INDEX idx_prediction_snapshots_unsettled
    ON prediction_snapshots (season, settled_at);
  CREATE TABLE forecast_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    predicted_winner TEXT NOT NULL,
    home_probability REAL NOT NULL,
    market_home_probability REAL,
    football_home_probability REAL,
    expected_home_margin REAL,
    market_expected_home_margin REAL,
    home_spread REAL,
    home_cover_probability REAL,
    model_version TEXT,
    favorite_probability REAL NOT NULL,
    live_delta REAL DEFAULT 0 NOT NULL,
    capture_bucket TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    settled_at TEXT,
    away_score INTEGER,
    home_score INTEGER,
    winner TEXT,
    correct INTEGER
  );
  CREATE UNIQUE INDEX uq_forecast_ledger_game_bucket
    ON forecast_ledger (season, game_key, capture_bucket);
  CREATE INDEX idx_forecast_ledger_game_time
    ON forecast_ledger (season, game_key, captured_at);
  CREATE INDEX idx_forecast_ledger_season_week
    ON forecast_ledger (season, week);
  CREATE TABLE game_postmortems (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    predicted_winner TEXT NOT NULL,
    actual_winner TEXT NOT NULL,
    home_probability REAL NOT NULL,
    market_home_probability REAL,
    expected_home_margin REAL,
    actual_home_margin REAL NOT NULL,
    correct INTEGER NOT NULL,
    error_severity REAL NOT NULL,
    probability_surprise REAL NOT NULL,
    taxonomy_json TEXT NOT NULL,
    pregame_features_json TEXT NOT NULL,
    data_quality TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_game_postmortems_snapshot ON game_postmortems (snapshot_id);
  CREATE INDEX idx_game_postmortems_season_week ON game_postmortems (season, week);
  CREATE INDEX idx_game_postmortems_severity ON game_postmortems (error_severity);
  CREATE TABLE error_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    severity REAL NOT NULL,
    pregame_features_json TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_error_memory_snapshot ON error_memory (snapshot_id);
  CREATE INDEX idx_error_memory_severity ON error_memory (severity);
  CREATE TABLE success_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    pregame_features_json TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_success_memory_snapshot ON success_memory (snapshot_id);
  CREATE INDEX idx_success_memory_game ON success_memory (game_key);
  CREATE TABLE specialist_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    production_weight REAL DEFAULT 0 NOT NULL,
    evidence TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_specialist_registry_code ON specialist_registry (code);
  CREATE TABLE weekly_learning_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    graded_games INTEGER NOT NULL,
    correct_picks INTEGER NOT NULL,
    brier_score REAL NOT NULL,
    home_residual REAL NOT NULL,
    favorite_residual REAL NOT NULL,
    insight TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_weekly_learning_runs
    ON weekly_learning_runs (season, week);
  CREATE TABLE market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    source TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    away_moneyline INTEGER,
    home_moneyline INTEGER,
    away_spread REAL,
    home_spread REAL,
    total_line REAL,
    away_spread_odds INTEGER,
    home_spread_odds INTEGER,
    over_odds INTEGER,
    under_odds INTEGER
  );
  CREATE UNIQUE INDEX uq_market_snapshots_source_game_time
    ON market_snapshots (source, game_key, observed_at);
  CREATE INDEX idx_market_snapshots_season_week
    ON market_snapshots (season, week);
  CREATE INDEX idx_market_snapshots_game_time
    ON market_snapshots (game_key, observed_at);
`);

class LocalStatement {
  constructor(
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]) {
    return new LocalStatement(this.sql, values);
  }

  all<T>() {
    return { results: database.prepare(this.sql).all(...this.values) as T[] };
  }

  first<T>() {
    return database.prepare(this.sql).get(...this.values) as T | undefined;
  }

  run() {
    return database.prepare(this.sql).run(...this.values);
  }
}

class LocalD1 {
  prepare(sql: string) {
    return new LocalStatement(sql);
  }

  batch(statements: LocalStatement[]) {
    return statements.map((statement) => statement.run());
  }
}

export const env = { DB: new LocalD1() };

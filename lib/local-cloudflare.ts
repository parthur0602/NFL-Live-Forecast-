import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

// Minimal D1-compatible adapter for the local Node fallback. Production still
// uses the real Cloudflare D1 binding through cloudflare:workers.
// Set NFL_FORECAST_LOCAL_D1_PATH for a file-backed preview database. The
// default remains ephemeral so ordinary local app runs are unchanged.
const database = new DatabaseSync(process.env.NFL_FORECAST_LOCAL_D1_PATH ?? ':memory:');

database.exec(`
  CREATE TABLE IF NOT EXISTS model_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    kind TEXT NOT NULL,
    delta REAL NOT NULL,
    reason TEXT NOT NULL,
    sample_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_model_adjustments_week_kind
    ON model_adjustments (season, week, kind);
  CREATE INDEX IF NOT EXISTS idx_model_adjustments_season_kind
    ON model_adjustments (season, kind);
  CREATE TABLE IF NOT EXISTS prediction_snapshots (
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
  CREATE UNIQUE INDEX IF NOT EXISTS uq_prediction_snapshots_game
    ON prediction_snapshots (season, game_key);
  CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_season_week
    ON prediction_snapshots (season, week);
  CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_unsettled
    ON prediction_snapshots (season, settled_at);
  CREATE TABLE IF NOT EXISTS forecast_ledger (
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
  CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_ledger_game_bucket
    ON forecast_ledger (season, game_key, capture_bucket);
  CREATE INDEX IF NOT EXISTS idx_forecast_ledger_game_time
    ON forecast_ledger (season, game_key, captured_at);
  CREATE INDEX IF NOT EXISTS idx_forecast_ledger_season_week
    ON forecast_ledger (season, week);
  CREATE TABLE IF NOT EXISTS prospective_model_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    scheduled_kickoff_at TEXT,
    capture_bucket TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    market_observed_at TEXT,
    market_source TEXT,
    market_home_probability REAL,
    v2_home_probability REAL NOT NULL,
    v2_predicted_winner TEXT NOT NULL,
    v2_model_version TEXT NOT NULL,
    v5_home_probability REAL,
    v5_predicted_winner TEXT,
    v5_raw_residual_logit REAL,
    v5_applied_shadow_scale REAL,
    v5_model_version TEXT,
    v5_feature_data_through_week INTEGER,
    v5_feature_payload_json TEXT,
    v5_available INTEGER DEFAULT 0 NOT NULL,
    production_influence REAL DEFAULT 0 NOT NULL,
    settled_at TEXT,
    away_score INTEGER,
    home_score INTEGER,
    winner TEXT,
    v2_correct INTEGER,
    v5_correct INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_prospective_model_game_bucket
    ON prospective_model_snapshots (season, game_key, capture_bucket);
  CREATE INDEX IF NOT EXISTS idx_prospective_model_season_week
    ON prospective_model_snapshots (season, week);
  CREATE INDEX IF NOT EXISTS idx_prospective_model_game_time
    ON prospective_model_snapshots (season, game_key, captured_at);
  CREATE INDEX IF NOT EXISTS idx_prospective_model_unsettled
    ON prospective_model_snapshots (season, settled_at);
  CREATE TABLE IF NOT EXISTS game_postmortems (
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
  CREATE UNIQUE INDEX IF NOT EXISTS uq_game_postmortems_snapshot ON game_postmortems (snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_game_postmortems_season_week ON game_postmortems (season, week);
  CREATE INDEX IF NOT EXISTS idx_game_postmortems_severity ON game_postmortems (error_severity);
  CREATE TABLE IF NOT EXISTS error_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    severity REAL NOT NULL,
    pregame_features_json TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_error_memory_snapshot ON error_memory (snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_error_memory_severity ON error_memory (severity);
  CREATE TABLE IF NOT EXISTS success_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    pregame_features_json TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_success_memory_snapshot ON success_memory (snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_success_memory_game ON success_memory (game_key);
  CREATE TABLE IF NOT EXISTS specialist_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    production_weight REAL DEFAULT 0 NOT NULL,
    evidence TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_specialist_registry_code ON specialist_registry (code);
  CREATE TABLE IF NOT EXISTS weekly_learning_runs (
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
  CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_learning_runs
    ON weekly_learning_runs (season, week);
  CREATE TABLE IF NOT EXISTS market_snapshots (
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
  CREATE UNIQUE INDEX IF NOT EXISTS uq_market_snapshots_source_game_time
    ON market_snapshots (source, game_key, observed_at);
  CREATE INDEX IF NOT EXISTS idx_market_snapshots_season_week
    ON market_snapshots (season, week);
  CREATE INDEX IF NOT EXISTS idx_market_snapshots_game_time
    ON market_snapshots (game_key, observed_at);
  CREATE TABLE IF NOT EXISTS football_state_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    team TEXT NOT NULL,
    state_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT,
    source TEXT NOT NULL,
    source_url TEXT,
    observed_at TEXT NOT NULL,
    capture_bucket TEXT NOT NULL,
    confidence REAL,
    payload_json TEXT NOT NULL,
    eligible_for_model INTEGER DEFAULT 0 NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_football_state_signal_bucket
    ON football_state_snapshots (
      season, team, state_type, subject, source, capture_bucket
    );
  CREATE INDEX IF NOT EXISTS idx_football_state_team_time
    ON football_state_snapshots (season, team, observed_at);
  CREATE INDEX IF NOT EXISTS idx_football_state_type_time
    ON football_state_snapshots (season, state_type, observed_at);
  CREATE TABLE IF NOT EXISTS team_efficiency_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    team TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    observed_at TEXT NOT NULL,
    capture_bucket TEXT NOT NULL,
    games_in_sample INTEGER NOT NULL,
    passing_epa REAL,
    rushing_epa REAL,
    receiving_epa REAL,
    passing_success_rate REAL,
    rushing_success_rate REAL,
    completion_percentage REAL,
    yards_per_attempt REAL,
    sack_rate REAL,
    turnover_rate REAL,
    payload_json TEXT NOT NULL,
    eligible_for_model INTEGER DEFAULT 1 NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_team_efficiency_team_week_bucket
    ON team_efficiency_snapshots (season, week, team, capture_bucket);
  CREATE INDEX IF NOT EXISTS idx_team_efficiency_team_time
    ON team_efficiency_snapshots (season, team, observed_at);
  CREATE INDEX IF NOT EXISTS idx_team_efficiency_week
    ON team_efficiency_snapshots (season, week);
  CREATE TABLE IF NOT EXISTS player_availability_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    team TEXT NOT NULL,
    player_id TEXT,
    player_name TEXT NOT NULL,
    position TEXT,
    depth_role TEXT,
    status TEXT NOT NULL,
    practice_status TEXT,
    availability_probability REAL,
    expected_snap_share REAL,
    replacement_value REAL,
    source TEXT NOT NULL,
    source_url TEXT,
    observed_at TEXT NOT NULL,
    capture_bucket TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    eligible_for_model INTEGER DEFAULT 0 NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_player_availability_signal_bucket
    ON player_availability_snapshots (
      season, week, team, player_name, source, capture_bucket
    );
  CREATE INDEX IF NOT EXISTS idx_player_availability_team_time
    ON player_availability_snapshots (season, team, observed_at);
  CREATE INDEX IF NOT EXISTS idx_player_availability_position_time
    ON player_availability_snapshots (season, position, observed_at);
  CREATE TABLE IF NOT EXISTS v7_intelligence_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    scheduled_kickoff_at TEXT NOT NULL,
    capture_bucket TEXT NOT NULL,
    capture_horizon TEXT NOT NULL DEFAULT 'LEGACY_HOURLY',
    actual_horizon_minutes REAL,
    horizon_status TEXT NOT NULL DEFAULT 'LEGACY',
    captured_at TEXT NOT NULL,
    feature_cutoff_at TEXT NOT NULL,
    market_observed_at TEXT,
    market_source TEXT,
    market_home_probability REAL,
    away_moneyline INTEGER,
    home_moneyline INTEGER,
    home_spread REAL,
    total_line REAL,
    v2_home_probability REAL NOT NULL,
    v2_predicted_winner TEXT NOT NULL,
    v2_model_version TEXT NOT NULL,
    football_home_probability REAL,
    player_availability_home_probability REAL,
    matchup_home_probability REAL,
    upset_risk TEXT,
    upset_home_adjustment REAL,
    final_home_probability REAL NOT NULL,
    predicted_winner TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    team_ratings_json TEXT NOT NULL,
    player_availability_json TEXT NOT NULL,
    depth_chart_json TEXT NOT NULL,
    weather_rest_travel_json TEXT NOT NULL,
    team_efficiency_json TEXT NOT NULL,
    specialist_outputs_json TEXT NOT NULL,
    source_status_json TEXT NOT NULL,
    player_intelligence_json TEXT NOT NULL DEFAULT '{}',
    why_v7_differs_json TEXT NOT NULL DEFAULT '[]',
    production_influence REAL DEFAULT 0 NOT NULL,
    settled_at TEXT,
    away_score INTEGER,
    home_score INTEGER,
    winner TEXT,
    correct INTEGER,
    postmortem_json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_v7_intelligence_game_horizon_bucket
    ON v7_intelligence_snapshots (season, game_key, capture_horizon, capture_bucket);
  CREATE INDEX IF NOT EXISTS idx_v7_intelligence_season_week
    ON v7_intelligence_snapshots (season, week);
  CREATE INDEX IF NOT EXISTS idx_v7_intelligence_game_time
    ON v7_intelligence_snapshots (season, game_key, captured_at);
  CREATE INDEX IF NOT EXISTS idx_v7_intelligence_unsettled
    ON v7_intelligence_snapshots (season, settled_at);
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

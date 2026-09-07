CREATE TABLE `prospective_model_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `game_key` text NOT NULL,
  `away_team` text NOT NULL,
  `home_team` text NOT NULL,
  `scheduled_kickoff_at` text,
  `capture_bucket` text NOT NULL,
  `captured_at` text NOT NULL,
  `market_observed_at` text,
  `market_source` text,
  `market_home_probability` real,
  `v2_home_probability` real NOT NULL,
  `v2_predicted_winner` text NOT NULL,
  `v2_model_version` text NOT NULL,
  `v5_home_probability` real,
  `v5_predicted_winner` text,
  `v5_raw_residual_logit` real,
  `v5_applied_shadow_scale` real,
  `v5_model_version` text,
  `v5_feature_data_through_week` integer,
  `v5_feature_payload_json` text,
  `v5_available` integer NOT NULL DEFAULT 0,
  `production_influence` real NOT NULL DEFAULT 0,
  `settled_at` text,
  `away_score` integer,
  `home_score` integer,
  `winner` text,
  `v2_correct` integer,
  `v5_correct` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prospective_model_game_bucket` ON `prospective_model_snapshots` (`season`,`game_key`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_prospective_model_season_week` ON `prospective_model_snapshots` (`season`,`week`);
--> statement-breakpoint
CREATE INDEX `idx_prospective_model_game_time` ON `prospective_model_snapshots` (`season`,`game_key`,`captured_at`);
--> statement-breakpoint
CREATE INDEX `idx_prospective_model_unsettled` ON `prospective_model_snapshots` (`season`,`settled_at`);

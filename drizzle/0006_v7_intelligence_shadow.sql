CREATE TABLE `v7_intelligence_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_key` text NOT NULL,
	`away_team` text NOT NULL,
	`home_team` text NOT NULL,
	`scheduled_kickoff_at` text NOT NULL,
	`capture_bucket` text NOT NULL,
	`captured_at` text NOT NULL,
	`feature_cutoff_at` text NOT NULL,
	`market_observed_at` text,
	`market_source` text,
	`market_home_probability` real,
	`away_moneyline` integer,
	`home_moneyline` integer,
	`home_spread` real,
	`total_line` real,
	`football_home_probability` real,
	`player_availability_home_probability` real,
	`matchup_home_probability` real,
	`upset_risk` text,
	`upset_home_adjustment` real,
	`final_home_probability` real NOT NULL,
	`predicted_winner` text NOT NULL,
	`model_version` text NOT NULL,
	`team_ratings_json` text NOT NULL,
	`player_availability_json` text NOT NULL,
	`depth_chart_json` text NOT NULL,
	`weather_rest_travel_json` text NOT NULL,
	`team_efficiency_json` text NOT NULL,
	`specialist_outputs_json` text NOT NULL,
	`source_status_json` text NOT NULL,
	`production_influence` real NOT NULL DEFAULT 0,
	`settled_at` text,
	`away_score` integer,
	`home_score` integer,
	`winner` text,
	`correct` integer,
	`postmortem_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v7_intelligence_game_bucket` ON `v7_intelligence_snapshots` (`season`,`game_key`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_v7_intelligence_season_week` ON `v7_intelligence_snapshots` (`season`,`week`);
--> statement-breakpoint
CREATE INDEX `idx_v7_intelligence_game_time` ON `v7_intelligence_snapshots` (`season`,`game_key`,`captured_at`);
--> statement-breakpoint
CREATE INDEX `idx_v7_intelligence_unsettled` ON `v7_intelligence_snapshots` (`season`,`settled_at`);

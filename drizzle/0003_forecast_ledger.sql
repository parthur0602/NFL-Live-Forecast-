CREATE TABLE `forecast_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_key` text NOT NULL,
	`away_team` text NOT NULL,
	`home_team` text NOT NULL,
	`predicted_winner` text NOT NULL,
	`home_probability` real NOT NULL,
	`market_home_probability` real,
	`football_home_probability` real,
	`expected_home_margin` real,
	`market_expected_home_margin` real,
	`home_spread` real,
	`home_cover_probability` real,
	`model_version` text,
	`favorite_probability` real NOT NULL,
	`live_delta` real NOT NULL DEFAULT 0,
	`capture_bucket` text NOT NULL,
	`captured_at` text NOT NULL,
	`settled_at` text,
	`away_score` integer,
	`home_score` integer,
	`winner` text,
	`correct` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_forecast_ledger_game_bucket` ON `forecast_ledger` (`season`,`game_key`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_forecast_ledger_game_time` ON `forecast_ledger` (`season`,`game_key`,`captured_at`);
--> statement-breakpoint
CREATE INDEX `idx_forecast_ledger_season_week` ON `forecast_ledger` (`season`,`week`);

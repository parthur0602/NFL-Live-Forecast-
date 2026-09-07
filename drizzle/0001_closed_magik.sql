CREATE TABLE `market_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_key` text NOT NULL,
	`source` text NOT NULL,
	`observed_at` text NOT NULL,
	`away_moneyline` integer,
	`home_moneyline` integer,
	`away_spread` real,
	`home_spread` real,
	`total_line` real,
	`away_spread_odds` integer,
	`home_spread_odds` integer,
	`over_odds` integer,
	`under_odds` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_market_snapshots_source_game_time` ON `market_snapshots` (`source`,`game_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_season_week` ON `market_snapshots` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_game_time` ON `market_snapshots` (`game_key`,`observed_at`);--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `market_home_probability` real;
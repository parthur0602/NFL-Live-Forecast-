CREATE TABLE `error_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`game_key` text NOT NULL,
	`severity` real NOT NULL,
	`pregame_features_json` text NOT NULL,
	`lesson` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_error_memory_snapshot` ON `error_memory` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_error_memory_severity` ON `error_memory` (`severity`);--> statement-breakpoint
CREATE TABLE `game_postmortems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_key` text NOT NULL,
	`model_version` text NOT NULL,
	`predicted_winner` text NOT NULL,
	`actual_winner` text NOT NULL,
	`home_probability` real NOT NULL,
	`market_home_probability` real,
	`expected_home_margin` real,
	`actual_home_margin` real NOT NULL,
	`correct` integer NOT NULL,
	`error_severity` real NOT NULL,
	`probability_surprise` real NOT NULL,
	`taxonomy_json` text NOT NULL,
	`pregame_features_json` text NOT NULL,
	`data_quality` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_game_postmortems_snapshot` ON `game_postmortems` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_game_postmortems_season_week` ON `game_postmortems` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `idx_game_postmortems_severity` ON `game_postmortems` (`error_severity`);--> statement-breakpoint
CREATE TABLE `specialist_registry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`production_weight` real DEFAULT 0 NOT NULL,
	`evidence` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_specialist_registry_code` ON `specialist_registry` (`code`);--> statement-breakpoint
CREATE TABLE `success_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`game_key` text NOT NULL,
	`pregame_features_json` text NOT NULL,
	`lesson` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_success_memory_snapshot` ON `success_memory` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_success_memory_game` ON `success_memory` (`game_key`);--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `football_home_probability` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `expected_home_margin` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `market_expected_home_margin` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `home_spread` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `home_cover_probability` real;--> statement-breakpoint
ALTER TABLE `prediction_snapshots` ADD `model_version` text;
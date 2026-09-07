CREATE TABLE `model_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`kind` text NOT NULL,
	`delta` real NOT NULL,
	`reason` text NOT NULL,
	`sample_size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_model_adjustments_week_kind` ON `model_adjustments` (`season`,`week`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_model_adjustments_season_kind` ON `model_adjustments` (`season`,`kind`);--> statement-breakpoint
CREATE TABLE `prediction_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_key` text NOT NULL,
	`away_team` text NOT NULL,
	`home_team` text NOT NULL,
	`predicted_winner` text NOT NULL,
	`home_probability` real NOT NULL,
	`favorite_probability` real NOT NULL,
	`live_delta` real DEFAULT 0 NOT NULL,
	`captured_at` text NOT NULL,
	`settled_at` text,
	`away_score` integer,
	`home_score` integer,
	`winner` text,
	`correct` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prediction_snapshots_game` ON `prediction_snapshots` (`season`,`game_key`);--> statement-breakpoint
CREATE INDEX `idx_prediction_snapshots_season_week` ON `prediction_snapshots` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `idx_prediction_snapshots_unsettled` ON `prediction_snapshots` (`season`,`settled_at`);--> statement-breakpoint
CREATE TABLE `weekly_learning_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`graded_games` integer NOT NULL,
	`correct_picks` integer NOT NULL,
	`brier_score` real NOT NULL,
	`home_residual` real NOT NULL,
	`favorite_residual` real NOT NULL,
	`insight` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weekly_learning_runs` ON `weekly_learning_runs` (`season`,`week`);
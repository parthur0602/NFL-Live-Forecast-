CREATE TABLE `team_efficiency_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`team` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`capture_bucket` text NOT NULL,
	`games_in_sample` integer NOT NULL,
	`passing_epa` real,
	`rushing_epa` real,
	`receiving_epa` real,
	`passing_success_rate` real,
	`rushing_success_rate` real,
	`completion_percentage` real,
	`yards_per_attempt` real,
	`sack_rate` real,
	`turnover_rate` real,
	`payload_json` text NOT NULL,
	`eligible_for_model` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_team_efficiency_team_week_bucket` ON `team_efficiency_snapshots` (`season`,`week`,`team`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_team_efficiency_team_time` ON `team_efficiency_snapshots` (`season`,`team`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `idx_team_efficiency_week` ON `team_efficiency_snapshots` (`season`,`week`);
--> statement-breakpoint
CREATE TABLE `player_availability_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`team` text NOT NULL,
	`player_id` text,
	`player_name` text NOT NULL,
	`position` text,
	`depth_role` text,
	`status` text NOT NULL,
	`practice_status` text,
	`availability_probability` real,
	`expected_snap_share` real,
	`replacement_value` real,
	`source` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`capture_bucket` text NOT NULL,
	`payload_json` text NOT NULL,
	`eligible_for_model` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_player_availability_signal_bucket` ON `player_availability_snapshots` (`season`,`week`,`team`,`player_name`,`source`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_player_availability_team_time` ON `player_availability_snapshots` (`season`,`team`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `idx_player_availability_position_time` ON `player_availability_snapshots` (`season`,`position`,`observed_at`);
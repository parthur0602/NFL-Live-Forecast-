CREATE TABLE `football_state_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer NOT NULL,
	`team` text NOT NULL,
	`state_type` text NOT NULL,
	`subject` text NOT NULL,
	`status` text,
	`source` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`capture_bucket` text NOT NULL,
	`confidence` real,
	`payload_json` text NOT NULL,
	`eligible_for_model` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_football_state_signal_bucket` ON `football_state_snapshots` (`season`,`team`,`state_type`,`subject`,`source`,`capture_bucket`);
--> statement-breakpoint
CREATE INDEX `idx_football_state_team_time` ON `football_state_snapshots` (`season`,`team`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `idx_football_state_type_time` ON `football_state_snapshots` (`season`,`state_type`,`observed_at`);

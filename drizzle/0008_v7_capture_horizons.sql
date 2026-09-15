ALTER TABLE `v7_intelligence_snapshots` ADD `capture_horizon` text NOT NULL DEFAULT 'LEGACY_HOURLY';
--> statement-breakpoint
ALTER TABLE `v7_intelligence_snapshots` ADD `actual_horizon_minutes` real;
--> statement-breakpoint
ALTER TABLE `v7_intelligence_snapshots` ADD `horizon_status` text NOT NULL DEFAULT 'LEGACY';
--> statement-breakpoint
ALTER TABLE `v7_intelligence_snapshots` ADD `player_intelligence_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `v7_intelligence_snapshots` ADD `why_v7_differs_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v7_intelligence_game_horizon_bucket`
  ON `v7_intelligence_snapshots` (`season`, `game_key`, `capture_horizon`, `capture_bucket`);

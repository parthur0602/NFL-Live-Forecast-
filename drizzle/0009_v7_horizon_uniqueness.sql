-- V7 now captures named pre-kickoff horizons. The older game/hour uniqueness
-- guard would reject two different legitimate horizons that happen to fall in
-- one clock hour. Preserve every existing row and deduplicate by horizon.
DROP INDEX IF EXISTS `uq_v7_intelligence_game_bucket`;

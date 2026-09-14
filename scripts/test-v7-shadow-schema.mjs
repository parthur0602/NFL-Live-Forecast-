import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const db = new DatabaseSync(':memory:');
const migration = await readFile('drizzle/0006_v7_intelligence_shadow.sql', 'utf8');
for (const statement of migration.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean))
  db.exec(statement);

const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v7_intelligence_snapshots'").get();
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'v7_intelligence_snapshots' ORDER BY name").all();
if (!table) throw new Error('V7 migration did not create v7_intelligence_snapshots.');
for (const name of [
  'uq_v7_intelligence_game_bucket', 'idx_v7_intelligence_season_week',
  'idx_v7_intelligence_game_time', 'idx_v7_intelligence_unsettled',
]) if (!indexes.some((index) => index.name === name)) throw new Error(`Missing V7 index ${name}.`);

const insert = db.prepare(`INSERT INTO v7_intelligence_snapshots (
  season, week, game_key, away_team, home_team, scheduled_kickoff_at,
  capture_bucket, captured_at, feature_cutoff_at, final_home_probability,
  predicted_winner, model_version, team_ratings_json, player_availability_json,
  depth_chart_json, weather_rest_travel_json, team_efficiency_json,
  specialist_outputs_json, source_status_json
) VALUES (2026, 2, 'TEST', 'AWAY', 'HOME', '2026-09-20T17:00:00Z', ?,
  '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z', .55, 'HOME', 'V7',
  '{}', '{}', '{}', '{}', '{}', '{}', '{}')`);
insert.run('2026-09-20T12:00:00Z');
let duplicateRejected = false;
try { insert.run('2026-09-20T12:00:00Z'); } catch { duplicateRejected = true; }
if (!duplicateRejected) throw new Error('Hourly V7 capture dedupe did not reject a duplicate.');
insert.run('2026-09-20T13:00:00Z');
const values = db.prepare('SELECT COUNT(*) AS count, MIN(production_influence) AS influence, MAX(production_influence) AS maxInfluence FROM v7_intelligence_snapshots').get();
if (values.count !== 2 || values.influence !== 0 || values.maxInfluence !== 0)
  throw new Error('V7 migration did not preserve research-only production influence.');
console.log('V7 shadow migration test passed.');
console.log('Immutable hourly dedupe: PASS');
console.log('Multiple pre-kickoff buckets: PASS');
console.log('Production influence remains 0: PASS');

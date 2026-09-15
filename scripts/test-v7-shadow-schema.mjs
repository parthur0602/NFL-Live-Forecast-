import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';

const db = new DatabaseSync(':memory:');
const migrations = (await readdir('drizzle'))
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
const numbers = migrations.map((name) => name.slice(0, 4));
const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);
if (duplicates.length)
  throw new Error(`Duplicate migration numbers: ${[...new Set(duplicates)].join(', ')}`);
if (migrations.includes('0006_v7_intelligence_shadow.sql') || !migrations.includes('0007_v7_intelligence_shadow.sql'))
  throw new Error('V7 migration must be numbered 0007 with no legacy 0006 file.');
for (const filename of ['0007_v7_intelligence_shadow.sql', '0008_v7_capture_horizons.sql', '0009_v7_horizon_uniqueness.sql']) {
  const migration = await readFile(`drizzle/${filename}`, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean))
    db.exec(statement);
}

const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v7_intelligence_snapshots'").get();
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'v7_intelligence_snapshots' ORDER BY name").all();
if (!table) throw new Error('V7 migration did not create v7_intelligence_snapshots.');
for (const name of [
  'idx_v7_intelligence_season_week',
  'idx_v7_intelligence_game_time', 'idx_v7_intelligence_unsettled',
  'uq_v7_intelligence_game_horizon_bucket',
]) if (!indexes.some((index) => index.name === name)) throw new Error(`Missing V7 index ${name}.`);
if (indexes.some((index) => index.name === 'uq_v7_intelligence_game_bucket'))
  throw new Error('Legacy game/hour uniqueness still blocks distinct capture horizons.');
const columns = db.prepare('PRAGMA table_info(v7_intelligence_snapshots)').all().map((column) => column.name);
for (const name of [
  'v2_home_probability', 'v2_predicted_winner', 'v2_model_version', 'model_hash',
  'capture_horizon', 'actual_horizon_minutes', 'horizon_status',
  'team_ratings_json', 'player_availability_json', 'depth_chart_json',
  'weather_rest_travel_json', 'team_efficiency_json', 'specialist_outputs_json',
  'source_status_json',
]) if (!columns.includes(name)) throw new Error(`Missing V7 immutable snapshot field ${name}.`);

const insert = db.prepare(`INSERT INTO v7_intelligence_snapshots (
  season, week, game_key, away_team, home_team, scheduled_kickoff_at,
  capture_bucket, captured_at, feature_cutoff_at, final_home_probability,
  predicted_winner, model_version, model_hash, v2_home_probability,
  v2_predicted_winner, v2_model_version, team_ratings_json, player_availability_json,
  depth_chart_json, weather_rest_travel_json, team_efficiency_json,
  specialist_outputs_json, source_status_json
) VALUES (2026, 2, 'TEST', 'AWAY', 'HOME', '2026-09-20T17:00:00Z', ?,
  '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z', .55, 'HOME', 'V7', 'hash', .55, 'HOME', 'V2',
  '{}', '{}', '{}', '{}', '{}', '{}', '{}')`);
insert.run('2026-09-20T12:00:00Z');
let duplicateRejected = false;
try { insert.run('2026-09-20T12:00:00Z'); } catch { duplicateRejected = true; }
if (!duplicateRejected) throw new Error('Hourly V7 capture dedupe did not reject a duplicate.');
insert.run('2026-09-20T13:00:00Z');
const horizonInsert = db.prepare(`INSERT INTO v7_intelligence_snapshots (
  season, week, game_key, away_team, home_team, scheduled_kickoff_at,
  capture_bucket, capture_horizon, actual_horizon_minutes, horizon_status, captured_at, feature_cutoff_at,
  final_home_probability, predicted_winner, model_version, model_hash, v2_home_probability,
  v2_predicted_winner, v2_model_version, team_ratings_json, player_availability_json,
  depth_chart_json, weather_rest_travel_json, team_efficiency_json,
  specialist_outputs_json, source_status_json
) VALUES (2026, 2, 'TEST', 'AWAY', 'HOME', '2026-09-20T17:00:00Z',
  ?, '24H', 1430, 'LATE', '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z', .55, 'HOME', 'V7', 'hash', .55, 'HOME', 'V2',
  '{}', '{}', '{}', '{}', '{}', '{}', '{}')`);
horizonInsert.run('2026-09-20T14:00:00Z');
let horizonDuplicateRejected = false;
try { horizonInsert.run('2026-09-20T14:00:00Z'); } catch { horizonDuplicateRejected = true; }
if (!horizonDuplicateRejected) throw new Error('Horizon capture dedupe did not reject a duplicate.');
const distinctHorizonInsert = db.prepare(`INSERT INTO v7_intelligence_snapshots (
  season, week, game_key, away_team, home_team, scheduled_kickoff_at,
  capture_bucket, capture_horizon, actual_horizon_minutes, horizon_status, captured_at, feature_cutoff_at,
  final_home_probability, predicted_winner, model_version, model_hash, v2_home_probability,
  v2_predicted_winner, v2_model_version, team_ratings_json, player_availability_json,
  depth_chart_json, weather_rest_travel_json, team_efficiency_json, specialist_outputs_json,
  source_status_json, player_intelligence_json, why_v7_differs_json
) VALUES (2026, 2, 'GAME', 'AWY', 'HME', '2026-09-20T17:00:00Z', ?, '24H', 1440, 'ON_TIME', ?, '2026-09-20T14:00:00Z',
  0.6, 'HME', 'V7-SHADOW', 'hash', 0.6, 'HME', 'V2',
  '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}')`);
distinctHorizonInsert.run('2026-09-20T14:00:00Z', '2026-09-20T14:00:00Z');
const values = db.prepare('SELECT COUNT(*) AS count, MIN(production_influence) AS influence, MAX(production_influence) AS maxInfluence FROM v7_intelligence_snapshots').get();
if (values.count !== 4 || values.influence !== 0 || values.maxInfluence !== 0)
  throw new Error('V7 migration did not preserve research-only production influence.');
console.log('V7 shadow migration test passed.');
console.log('Migration numbering: PASS');
console.log('Immutable hourly dedupe: PASS');
console.log('Multiple pre-kickoff buckets: PASS');
console.log('Horizon/bucket dedupe: PASS');
console.log('Distinct horizons in one bucket: PASS');
console.log('Production influence remains 0: PASS');

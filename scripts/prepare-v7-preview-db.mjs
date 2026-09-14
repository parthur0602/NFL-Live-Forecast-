import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('work');
const databasePath = resolve(directory, 'v7-preview.sqlite');
await mkdir(directory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`CREATE TABLE IF NOT EXISTS _v7_preview_migrations (
  filename TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
)`);
const migrations = (await readdir('drizzle'))
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
for (const filename of migrations) {
  const applied = database.prepare('SELECT filename FROM _v7_preview_migrations WHERE filename = ?').get(filename);
  if (applied) continue;
  const sql = await readFile(resolve('drizzle', filename), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean))
    database.exec(statement);
  database.prepare('INSERT INTO _v7_preview_migrations (filename, applied_at) VALUES (?, ?)')
    .run(filename, new Date().toISOString());
}
const v7 = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v7_intelligence_snapshots'").get();
if (!v7) throw new Error('Preview migration did not create v7_intelligence_snapshots.');
const count = database.prepare('SELECT COUNT(*) AS count FROM v7_intelligence_snapshots').get();
console.log('V7 preview database ready.');
console.log(`Path: ${databasePath}`);
console.log(`Applied migrations: ${migrations.length}`);
console.log(`V7 snapshot rows retained: ${count.count}`);

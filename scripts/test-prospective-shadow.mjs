import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const database = new DatabaseSync(':memory:');
const preservedTables = [
  'prediction_snapshots', 'market_snapshots', 'game_postmortems',
  'error_memory', 'success_memory', 'specialist_registry',
  'weekly_learning_runs', 'model_adjustments',
];
for (const table of preservedTables) {
  database.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);`);
  database.prepare(`INSERT INTO ${table} (id, marker) VALUES (1, ?);`).run(`${table}-seed`);
}
const migration = await readFile('drizzle/0006_prospective_model_exam.sql', 'utf8');
database.exec(migration.replaceAll('--> statement-breakpoint', ''));

class Statement {
  constructor(sql, values = []) {
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new Statement(this.sql, values); }
  all() { return { results: database.prepare(this.sql).all(...this.values) }; }
  first() { return database.prepare(this.sql).get(...this.values); }
  run() { return database.prepare(this.sql).run(...this.values); }
}
class TestD1 {
  prepare(sql) { return new Statement(sql); }
  batch(statements) { return statements.map((statement) => statement.run()); }
}
const d1 = new TestD1();
globalThis.__prospectiveTestEnv = { DB: d1 };
const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  resolve: { alias: { '@': new URL('../', import.meta.url).pathname } },
  plugins: [{
    name: 'prospective-test-cloudflare-binding',
    enforce: 'pre',
    resolveId(id) {
      return id === 'cloudflare:workers' ? '\0prospective-test-cloudflare-binding' : null;
    },
    load(id) {
      return id === '\0prospective-test-cloudflare-binding'
        ? 'export const env = globalThis.__prospectiveTestEnv;'
        : null;
    },
  }, {
    name: 'prospective-test-next-response',
    enforce: 'pre',
    resolveId(id) {
      return id === 'next/server' ? '\0prospective-test-next-server' : null;
    },
    load(id) {
      return id === '\0prospective-test-next-server'
        ? 'export class NextResponse { static json(body, init = {}) { return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers }); } }'
        : null;
    },
  }],
});
const exam = await vite.ssrLoadModule('/lib/prospective-model-exam.ts');
const shadow = await vite.ssrLoadModule('/lib/v5-prospective-shadow.ts');
const localAdapter = await vite.ssrLoadModule('/lib/local-cloudflare.ts');
const localMirror = localAdapter.env.DB.prepare(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prospective_model_snapshots'`,
).all();
assert.equal(localMirror.results.length, 1);

const rows = [
  {
    season: 2026, week: 1, team: 'SEA', seasonType: 'REG',
    passingEpa: 0.31, rushingEpa: 0.12, receivingEpa: 0.19,
    completionPct: 0.68, yardsPerAttempt: 7.7, sackRate: 0.04, interceptionRate: 0.01,
  },
  {
    season: 2026, week: 1, team: 'NE', seasonType: 'REG',
    passingEpa: -0.13, rushingEpa: -0.04, receivingEpa: -0.08,
    completionPct: 0.57, yardsPerAttempt: 5.9, sackRate: 0.09, interceptionRate: 0.03,
  },
  // This same-week row must be excluded from a Week 2 forecast.
  {
    season: 2026, week: 2, team: 'SEA', seasonType: 'REG',
    passingEpa: 99, rushingEpa: 99, receivingEpa: 99,
    completionPct: 0.99, yardsPerAttempt: 99, sackRate: 0, interceptionRate: 0,
  },
];
const available = shadow.calculateV5Shadow({
  week: 2,
  homeTeam: 'Seattle Seahawks',
  awayTeam: 'New England Patriots',
  marketHomeProbability: 0.6,
  efficiencyRows: rows,
});
assert.equal(available.available, true);
assert.equal(available.featureDataThroughWeek, 1);
const unavailable = shadow.calculateV5Shadow({
  week: 1,
  homeTeam: 'Atlanta Falcons',
  awayTeam: 'Arizona Cardinals',
  marketHomeProbability: 0.55,
  efficiencyRows: rows,
});
assert.equal(unavailable.available, false);

const captureTime = '2026-09-09T20:10:00.000Z';
const kickoff = '2026-09-10T00:20:00.000Z';
const availableItem = {
  season: 2026, week: 2, gameKey: 'New England Patriots__Seattle Seahawks',
  awayTeam: 'New England Patriots', homeTeam: 'Seattle Seahawks',
  scheduledKickoffAt: kickoff, marketObservedAt: captureTime, marketSource: 'deterministic-test-market',
  marketHomeProbability: 0.6, v2HomeProbability: 0.6,
  v2PredictedWinner: 'Seattle Seahawks', v2ModelVersion: 'V2.1-MARKET-ANCHOR-INTEGRITY',
  v5HomeProbability: available.homeProbability,
  v5PredictedWinner: available.predictedWinner === 'home' ? 'Seattle Seahawks' : 'New England Patriots',
  v5RawResidualLogit: available.rawResidualLogit, v5AppliedShadowScale: 0.5,
  v5ModelVersion: 'V5.0-PROSPECTIVE-SHADOW-FROZEN',
  v5FeatureDataThroughWeek: available.featureDataThroughWeek,
  v5FeaturePayload: available.featurePayload, v5Available: true,
};
const unavailableItem = {
  season: 2026, week: 1, gameKey: 'Arizona Cardinals__Atlanta Falcons',
  awayTeam: 'Arizona Cardinals', homeTeam: 'Atlanta Falcons',
  scheduledKickoffAt: '2026-09-11T00:20:00.000Z', marketObservedAt: captureTime,
  marketSource: 'deterministic-test-market', marketHomeProbability: 0.55, v2HomeProbability: 0.55,
  v2PredictedWinner: 'Atlanta Falcons', v2ModelVersion: 'V2.1-MARKET-ANCHOR-INTEGRITY',
  v5HomeProbability: null, v5PredictedWinner: null, v5RawResidualLogit: null,
  v5AppliedShadowScale: null, v5ModelVersion: 'V5.0-PROSPECTIVE-SHADOW-FROZEN',
  v5FeatureDataThroughWeek: null,
  v5FeaturePayload: { ...unavailable.featurePayload, unavailableReason: unavailable.reason },
  v5Available: false,
};
const first = await exam.captureProspectiveRows(d1, [availableItem, unavailableItem], captureTime);
assert.equal(first.inserted, 2);
const sameHour = await exam.captureProspectiveRows(
  d1,
  [availableItem, unavailableItem],
  '2026-09-09T20:50:00.000Z',
);
assert.equal(sameHour.inserted, 0);
const nextHour = await exam.captureProspectiveRows(
  d1,
  [availableItem],
  '2026-09-09T21:10:00.000Z',
);
assert.equal(nextHour.inserted, 1);
const afterKickoff = await exam.captureProspectiveRows(
  d1,
  [{ ...availableItem, gameKey: 'Late__Started', awayTeam: 'Late', homeTeam: 'Started', scheduledKickoffAt: '2026-09-09T19:00:00.000Z' }],
  captureTime,
);
assert.equal(afterKickoff.inserted, 0);
assert.equal(afterKickoff.skippedAfterKickoff, 1);

const sameMarket = database.prepare(
  `SELECT market_home_probability, v2_home_probability FROM prospective_model_snapshots WHERE game_key = ? LIMIT 1`,
).get(availableItem.gameKey);
assert.equal(sameMarket.market_home_probability, sameMarket.v2_home_probability);
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM prediction_snapshots`).get().count, 1);

await exam.settleProspectiveRows(d1, 2026, 2, [
  { away: 'New England Patriots', home: 'Seattle Seahawks', awayScore: 17, homeScore: 24 },
]);
await exam.settleProspectiveRows(d1, 2026, 1, [
  { away: 'Arizona Cardinals', home: 'Atlanta Falcons', awayScore: 13, homeScore: 20 },
]);
const settled = database.prepare(
  `SELECT COUNT(*) AS count FROM prospective_model_snapshots WHERE winner IS NOT NULL`,
).get();
assert.equal(settled.count, 3);
const report = await exam.prospectiveSeasonExam(d1, 2026);
assert.equal(report.v2.games, 3);
assert.equal(report.v5.games, 2);
assert.equal(report.v5AvailabilityRate, 2 / 3);
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM prediction_snapshots`).get().count, 1);

const indexes = database.prepare(
  `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'prospective_model_snapshots' ORDER BY name`,
).all().map((row) => row.name);
assert.deepEqual(indexes, [
  'idx_prospective_model_game_time',
  'idx_prospective_model_season_week',
  'idx_prospective_model_unsettled',
  'uq_prospective_model_game_bucket',
]);
for (const table of preservedTables)
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);

const savedFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('site.api.espn.com'))
    return new Response(JSON.stringify({
      events: [{
        id: 'deterministic-server-game', date: '2099-09-17T00:20:00.000Z',
        season: { year: 2026, type: 2 }, week: { number: 2 },
        competitions: [{ date: '2099-09-17T00:20:00.000Z', competitors: [
          { homeAway: 'home', team: { displayName: 'Seattle Seahawks' } },
          { homeAway: 'away', team: { displayName: 'New England Patriots' } },
        ] }],
      }],
    }), { status: 200 });
  if (url.includes('fantasydata.com')) {
    const cells = [
      'New England Patriots', 'Seattle Seahawks', '2', '', '', '', '', '', '', '', '+120', '-140', '44.5', '-110', '-110',
    ];
    return new Response(`<table><tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr></table>`, { status: 200 });
  }
  if (url.includes('stats_team_week_2026.csv')) return new Response('', { status: 404 });
  throw new Error(`Unexpected test fetch: ${url}`);
};
const route = await vite.ssrLoadModule('/app/api/prospective-exam/route.ts');
const routeResponse = await route.GET(new Request('http://localhost/api/prospective-exam?week=2'));
const routeBody = await routeResponse.json();
globalThis.fetch = savedFetch;
assert.equal(routeResponse.status, 200);
assert.equal(routeBody.games.length, 1);
assert.equal(routeBody.games[0].v2OfficialProbability, routeBody.games[0].marketHomeProbability);
assert.equal(routeBody.games[0].v5Available, false);
assert.equal(routeBody.capture.inserted, 1);

console.log(JSON.stringify({
  migration: 'PASS',
  pairedRowsCreated: 3,
  sameMarket: 'PASS',
  preKickoffGuard: 'PASS',
  hourlyDedupe: 'PASS',
  temporalFeatureBoundary: 'PASS',
  v5Unavailable: 'PASS',
  settlement: 'PASS',
  seasonExam: report,
  canonicalRecordInflation: 'PASS',
  serverComputedEndpoint: 'PASS',
  exampleAvailableRow: database.prepare(`SELECT * FROM prospective_model_snapshots WHERE v5_available = 1 ORDER BY id LIMIT 1`).get(),
  exampleUnavailableRow: database.prepare(`SELECT * FROM prospective_model_snapshots WHERE v5_available = 0 ORDER BY id LIMIT 1`).get(),
}, null, 2));
await vite.close();

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  resolve: { alias: { '@': new URL('../', import.meta.url).pathname } },
  plugins: [{
    name: 'dashboard-test-cloudflare-binding',
    enforce: 'pre',
    resolveId(id) {
      return id === 'cloudflare:workers' ? '\0dashboard-test-cloudflare-binding' : null;
    },
    load(id) {
      return id === '\0dashboard-test-cloudflare-binding'
        ? 'export const env = globalThis.__dashboardTestEnv;'
        : null;
    },
  }, {
    name: 'dashboard-test-next-response',
    enforce: 'pre',
    resolveId(id) {
      return id === 'next/server' ? '\0dashboard-test-next-server' : null;
    },
    load(id) {
      return id === '\0dashboard-test-next-server'
        ? 'export class NextResponse { static json(body, init = {}) { return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers }); } }'
        : null;
    },
  }],
});

const localAdapter = await vite.ssrLoadModule('/lib/local-cloudflare.ts');
globalThis.__dashboardTestEnv = localAdapter.env;
const database = localAdapter.env.DB;
const before = database.prepare(`SELECT COUNT(*) AS count FROM market_snapshots`).first().count;
const dashboardRoute = await vite.ssrLoadModule('/app/api/dashboard/route.ts');
const dashboardResponse = await dashboardRoute.GET(
  new Request('http://localhost/api/dashboard?week=1'),
);
const dashboard = await dashboardResponse.json();
assert.equal(dashboardResponse.status, 200);
assert.equal(dashboard.production.v2FootballCorrectionWeight, 0);
assert.equal(dashboard.production.marketBaselineProductionWeight, 1);
assert.equal(dashboard.production.v5ProductionInfluence, 0);
assert.equal(Array.isArray(dashboard.marketHistory), true);
assert.equal(Array.isArray(dashboard.specialists), true);
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM market_snapshots`).first().count, before);

const researchRoute = await vite.ssrLoadModule('/app/api/research/route.ts');
const researchResponse = await researchRoute.GET();
const research = await researchResponse.json();
assert.equal(researchResponse.status, 200);
assert.equal(research.failureAtlas.scope.includes('closing-market diagnostic'), true);
assert.equal(research.shadowResidual.productionInfluence, 0);
assert.equal(research.robustness.productionInfluence, 0);

console.log(JSON.stringify({
  dashboardRoute: 'PASS',
  researchRoute: 'PASS',
  readOnlyDashboardQuery: 'PASS',
  v2ProductionWeight: dashboard.production.v2FootballCorrectionWeight,
  marketBaselineProductionWeight: dashboard.production.marketBaselineProductionWeight,
  v5ProductionInfluence: dashboard.production.v5ProductionInfluence,
}, null, 2));
await vite.close();

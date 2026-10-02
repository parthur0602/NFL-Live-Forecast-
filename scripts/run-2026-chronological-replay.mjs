import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolated replay: never changes the frozen V7 core. The temporary module adds
// 2026 only for chronological OOS scoring. For each 2026 game, features remain
// restricted to earlier 2026 weeks and training to earlier games/weeks.
const source = await readFile(resolve('scripts/v7-intelligence-core.mjs'), 'utf8');
const replaySource = source.replace(
  'export const SEASONS = [2021, 2022, 2023, 2024, 2025];',
  'export const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];',
);
const temp = resolve('scripts/.tmp-v7-2026-replay-core.mjs');
await writeFile(temp, replaySource, 'utf8');
const core = await import(pathToFileURL(temp).href + '?v=' + Date.now());
const data = await core.loadResearchData();
const { output, oos, referenceKey } = core.buildV7Result(data);
const rows = oos.filter(r => r.season === 2026 && r.week <= 4);
const market = core.metrics(rows, 'marketProbability');
const model = core.metrics(rows, referenceKey);
const ledger = rows.map(r => ({
  week:r.week, gameId:r.gameId, away:r.away, home:r.home,
  marketHomeProbability:r.marketProbability,
  footballHomeProbability:r.footballProbability,
  modelHomeProbability:r[referenceKey],
  predictedWinner:r[referenceKey] >= .5 ? r.home : r.away,
  actualWinner:r.y ? r.home : r.away,
  correct:(r[referenceKey] >= .5 ? 1:0) === r.y,
  disagreementPoints:Math.abs(r[referenceKey]-r.marketProbability)*100,
  upsetRisk:r.upset.level,
  reasons:r.reasons,
}));
const misses = ledger.filter(x=>!x.correct);
const result={
  version:'2026-V7-CHRONOLOGICAL-REPLAY-1',
  status:'RETROSPECTIVE_RESEARCH_ONLY', productionInfluence:0,
  generatedAt:new Date().toISOString(),
  scope:'2026 regular-season games through Week 4 that have prior-week team efficiency available. Week 1 is intentionally unscored because no 2026 prior-week stats exist.',
  leakageGuard:'Target-game and same-week team statistics are excluded from features. Training is chronological. Market values are nflverse closing proxies and are benchmark inputs to the V7 reference probability, not timestamp-matched pregame captures.',
  games:rows.length, market, model,
  ledger, misses,
};
await mkdir(resolve('outputs'),{recursive:true});
await writeFile(resolve('outputs/2026-v7-chronological-replay.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({games:rows.length,market,model,misses:misses.map(x=>({week:x.week,away:x.away,home:x.home,pick:x.predictedWinner,winner:x.actualWinner,p:x.modelHomeProbability}))},null,2));

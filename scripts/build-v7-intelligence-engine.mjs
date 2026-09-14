import { buildV7Result, loadResearchData, writeJson } from './v7-intelligence-core.mjs';

const data = await loadResearchData();
const { output } = buildV7Result(data);
await writeJson('outputs/v7-intelligence-engine.json', output);

console.log('V7 intelligence shadow replay completed.');
console.log(`Eligible feature games: ${output.coverage.eligibleFeatureGames}`);
console.log(`Chronological OOS games: ${output.coverage.chronologicalOutOfSampleGames}`);
console.log(`Market / V2 Brier: ${output.market.brier.toFixed(4)}`);
console.log(`V7 reference (${output.v7Reference.scale}) Brier: ${output.v7Reference.brier.toFixed(4)}`);
console.log(`Best Brier correction scale: ${output.bestByBrier.scale}`);
console.log(output.verdict);
console.log('Wrote outputs/v7-intelligence-engine.json');

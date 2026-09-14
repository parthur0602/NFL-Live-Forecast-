import { buildPlayerValueOutput, loadResearchData, writeJson } from './v7-intelligence-core.mjs';

const data = await loadResearchData({ includePlayers: true });
const output = buildPlayerValueOutput(data);
await writeJson('outputs/v7-player-value.json', output);
console.log('V7 player-value research artifact completed.');
console.log(`Qualified production leaders: ${output.top50ProductionLeaders.length}`);
console.log('Availability adjustments: 0 (no timestamped pre-kickoff source).');
console.log('Wrote outputs/v7-player-value.json');

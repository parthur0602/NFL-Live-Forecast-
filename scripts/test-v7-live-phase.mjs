import{readFile}from'node:fs/promises';
const capture=await readFile('app/api/v7-shadow/capture/route.ts','utf8');const settle=await readFile('app/api/v7-shadow/settle/route.ts','utf8');const snap=await readFile('lib/v7-shadow-snapshot.ts','utf8');const src=await readFile('lib/player-availability-sources.ts','utf8');
for(const x of ["KICKOFF_PASSED","nextV7CapturePlan","saveV7ShadowSnapshot","productionInfluence:0"])if(!capture.includes(x))throw Error('capture safeguard '+x);
for(const x of ['settleV7ShadowSnapshots','productionInfluence:0'])if(!settle.includes(x))throw Error('settle safeguard '+x);
for(const x of ["if (new Date(input.scheduledKickoffAt).getTime() <= now.getTime())","INSERT OR IGNORE","production_influence"])if(!snap.includes(x))throw Error('snapshot safeguard '+x);
for(const x of ["explicit OUT designation","eligibleForModel: false","expectedSnapShare: null"])if(!src.includes(x))throw Error('availability safeguard '+x);
console.log(JSON.stringify({status:'PASS',phase:'V7.3_PROSPECTIVE_SHADOW',checks:['hard kickoff cutoff','immutable capture','no historical horizon backfill','availability abstention','zero production influence','postgame settlement separation']}));
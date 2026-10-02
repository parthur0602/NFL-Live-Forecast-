import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { collectCurrentPlayerAvailability } from '@/lib/player-availability-sources';
import { savePlayerAvailability } from '@/lib/player-availability';
import { loadCurrentV7Efficiency, calculateV7Shadow } from '@/lib/v7-prospective-shadow';
import { nextV7CapturePlan, saveV7ShadowSnapshot, v7CapturedHorizons } from '@/lib/v7-shadow-snapshot';

const SEASON=2026;
function db(){const x=(env as unknown as {DB?:D1Database}).DB;if(!x)throw new Error('Research DB unavailable.');return x}
type Game={gameKey:string;week:number;awayTeam:string;homeTeam:string;scheduledKickoffAt:string;marketHomeProbability:number|null;marketObservedAt:string|null;marketSource:string|null;awayMoneyline:number|null;homeMoneyline:number|null;homeSpread:number|null;totalLine:number|null;v2HomeProbability:number;v2PredictedWinner:string;v2ModelVersion:string};
export async function POST(request:Request){
 const body=await request.json() as {week:number;games:Game[]};
 const now=new Date(); if(!Number.isInteger(body.week)||body.week<1||body.week>18||!Array.isArray(body.games))return NextResponse.json({error:'Invalid prospective capture payload.'},{status:400});
 const database=db(); const captured=await v7CapturedHorizons(database,SEASON,body.week); const efficiency=await loadCurrentV7Efficiency(body.week); const out=[];
 for(const game of body.games){
  if(game.week!==body.week)continue; const kickoff=new Date(game.scheduledKickoffAt); if(!Number.isFinite(kickoff.getTime())||kickoff<=now){out.push({gameKey:game.gameKey,captured:false,reason:'KICKOFF_PASSED'});continue}
  const plan=nextV7CapturePlan(game.scheduledKickoffAt,now,captured.get(game.gameKey)??new Set()); if(!plan){out.push({gameKey:game.gameKey,captured:false,reason:'NO_CAPTURE_DUE'});continue}
  const availability=await collectCurrentPlayerAvailability({week:body.week,teams:[game.awayTeam,game.homeTeam],observedAt:now.toISOString()});
  await savePlayerAvailability(availability.signals);
  const shadow=calculateV7Shadow({week:body.week,homeTeam:game.homeTeam,awayTeam:game.awayTeam,marketHomeProbability:game.marketHomeProbability,v2HomeProbability:game.v2HomeProbability,efficiencyRows:efficiency.rows,unavailableReason:efficiency.reason});
  const result=await saveV7ShadowSnapshot(database,{season:SEASON,week:body.week,gameKey:game.gameKey,awayTeam:game.awayTeam,homeTeam:game.homeTeam,scheduledKickoffAt:game.scheduledKickoffAt,capture:plan,featureCutoffAt:now.toISOString(),market:{observedAt:game.marketObservedAt,source:game.marketSource,homeProbability:game.marketHomeProbability,awayMoneyline:game.awayMoneyline,homeMoneyline:game.homeMoneyline,homeSpread:game.homeSpread,totalLine:game.totalLine},v2:{homeProbability:game.v2HomeProbability,predictedWinner:game.v2PredictedWinner,modelVersion:game.v2ModelVersion},probabilities:{footballHome:shadow.footballHomeProbability,playerAvailabilityHome:null,matchupHome:shadow.matchupHomeProbability,upsetRisk:shadow.upsetRisk,upsetHomeAdjustment:shadow.upsetHomeAdjustment,finalHome:shadow.finalHomeProbability},modelVersion:'V7.3-PROSPECTIVE-SHADOW',modelHash:'research-v7.3',teamRatings:{},playerAvailability:availability.playerPayloadByTeam,depthChart:availability.depthPayloadByTeam,weatherRestTravel:{status:'UNSCORED_RESEARCH',productionInfluence:0},teamEfficiency:shadow.featurePayload,specialists:{productionInfluence:0},sourceStatus:availability.sourceHealth,playerIntelligence:{limitations:availability.limitations,productionInfluence:0},whyV7Differs:{boundaryPolicy:'1PT_HISTORICALLY_VALIDATED; weak crossing requires future multi-mechanism validation',productionInfluence:0}},now);
  out.push({gameKey:game.gameKey,...result,capture:plan,shadow:{finalHomeProbability:shadow.finalHomeProbability,predictedWinner:shadow.predictedWinner,upsetRisk:shadow.upsetRisk}});
 }
 return NextResponse.json({season:SEASON,week:body.week,capturedAt:now.toISOString(),productionInfluence:0,results:out},{headers:{'cache-control':'no-store'}});
}

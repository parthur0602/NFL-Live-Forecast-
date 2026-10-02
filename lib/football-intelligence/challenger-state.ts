/**
 * Research-only football-state aggregation.
 * Converts already timestamp-valid observations into independent mechanisms.
 * It never invents unavailable data and never changes production forecasts.
 */
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export type Mechanism={family:string;side:'HOME'|'AWAY';strength:number;reliability:number;evidenceIds:string[]};
export function availabilityImpact(x:{quality:number;roleDependency:number;replacementGap:number;positionImportance:number;matchupRelevance:number;reliability:number}){
 return clamp(x.quality*x.roleDependency*x.replacementGap*x.positionImportance*x.matchupRelevance)*clamp(x.reliability);
}
export function independentMechanisms(items:Mechanism[]){
 const best=new Map<string,Mechanism>();
 for(const m of items){const key=m.family+':'+m.side,old=best.get(key);if(!old||m.strength*m.reliability>old.strength*old.reliability)best.set(key,m)}
 return [...best.values()];
}
export function mechanismConsensus(items:Mechanism[]){
 const xs=independentMechanisms(items);let home=0,away=0;
 for(const m of xs){const v=clamp(m.strength)*clamp(m.reliability);m.side==='HOME'?home+=v:away+=v}
 const independentFamilies=new Set(xs.filter(x=>x.strength*x.reliability>=.35).map(x=>x.family)).size;
 return {home,away,net:home-away,independentFamilies,flipEligible:independentFamilies>=2&&Math.abs(home-away)>=.8};
}
export function boundaryCandidate(input:{marketHome:number;residualHome:number;mechanisms:Mechanism[]}){
 const crosses=(input.marketHome>=.5)!=(input.residualHome>=.5);
 const distance=Math.abs(input.residualHome-.5);
 const consensus=mechanismConsensus(input.mechanisms);
 if(!crosses)return{probability:input.residualHome,reason:'NO_PICK_CROSSING',consensus};
 if(distance>=.01)return{probability:input.residualHome,reason:'HISTORICALLY_VALIDATED_BOUNDARY',consensus};
 if(consensus.flipEligible)return{probability:input.residualHome,reason:'MULTI_MECHANISM_EXCEPTION_RESEARCH_ONLY',consensus};
 return{probability:input.marketHome>=.5?.5001:.4999,reason:'WEAK_CROSSING_SUPPRESSED',consensus};
}

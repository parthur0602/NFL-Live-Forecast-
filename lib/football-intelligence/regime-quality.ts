const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export type EvidenceQuality={sourceAuthority:number;timestampQuality:number;roleCertainty:number;sampleAdequacy:number;independence:number};
export function evidenceQuality(q:EvidenceQuality){return clamp(.30*q.sourceAuthority+.25*q.timestampQuality+.20*q.roleCertainty+.15*q.sampleAdequacy+.10*q.independence)}
export function regimeState(x:{qbChanged:boolean;playCallerChanged:boolean;headCoachChanged:boolean;majorOlTurnover:boolean;skillRoleTurnover:boolean;gamesInCurrentRegime:number;evidenceReliability:number}){
 const change=[x.qbChanged,x.playCallerChanged,x.headCoachChanged,x.majorOlTurnover,x.skillRoleTurnover].filter(Boolean).length;
 const severity=clamp(change/3);const maturity=clamp(x.gamesInCurrentRegime/6);const reliability=clamp(x.evidenceReliability);
 return{type:'TEAM_REGIME_STATE',severity,maturity,priorShrinkageNeed:severity*(1-maturity)*reliability,productionInfluence:0,status:'ACTIVE_RESEARCH'};
}
export function usableMechanism(strength:number,q:EvidenceQuality){const quality=evidenceQuality(q);return{raw:clamp(strength),quality,effective:clamp(strength)*quality,eligible:quality>=.65,productionInfluence:0}}

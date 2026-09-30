/**
 * Research-only contracts for the NFL Football Intelligence Engine.
 *
 * These types intentionally do not import model-v2 or production forecast code.
 * Keep production influence at zero until a future validation gate explicitly
 * promotes a specialist.
 */

export type FactorStatus =
  | 'ACTIVE_RESEARCH'
  | 'READY_FOR_SHADOW'
  | 'SHADOW_ONLY'
  | 'PRODUCTION_ELIGIBLE'
  | 'REJECTED'
  | 'POSTGAME_ONLY'
  | 'UNAVAILABLE';

export type EvidenceGrade =
  | 'VERY_HIGH'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'UNAVAILABLE';

export type StabilityClass = 'fast' | 'medium' | 'slow';

export type EvidenceLabel =
  | 'MODEL_FACT'
  | 'MODEL_INTERPRETATION'
  | 'RESEARCH_FINDING'
  | 'UNVALIDATED_HYPOTHESIS'
  | 'POSTGAME_ONLY';

export type CaptureHorizon =
  | 'OPENING'
  | '72H'
  | '24H'
  | '6H'
  | '90M'
  | 'FINAL_PREKICK'
  | 'LEGACY_HOURLY'
  | 'POSTKICK_REJECTED';

export type FactorDefinition = {
  id: string;
  category: string;
  name: string;
  meaning: string;
  sourcePriority: string;
  stability: StabilityClass;
  mechanism: string;
  status: FactorStatus;
  productionInfluence: 0;
  pregameAllowed: boolean;
  postgameOnly: boolean;
  requiresTimestamp: true;
  requiresProvenance: true;
};

export type EvidenceObservation = {
  factorId: string;
  entityId: string;
  season: number;
  week: number | null;
  gameKey: string | null;
  source: string;
  sourceUrl: string | null;
  sourceType: string;
  observedAt: string;
  availableAt: string | null;
  capturedAt: string;
  featureCutoffAt: string;
  confidence: number | null;
  reliability: EvidenceGrade;
  sampleSize: number | null;
  stability: StabilityClass;
  provenance: string;
  derivation: string | null;
  pregameAllowed: boolean;
  postgameOnly: boolean;
  horizon: CaptureHorizon;
  value: unknown;
};

export type SeasonTransitionState = {
  team: string;
  season: number;
  priorEraId: string | null;
  currentEraId: string;
  teamContinuity: number | null;
  qbContinuity: number | null;
  hcContinuity: number | null;
  ocContinuity: number | null;
  dcContinuity: number | null;
  olContinuity: number | null;
  skillContinuity: number | null;
  defensiveContinuity: number | null;
  schemeContinuity: number | null;
  qbChanged: boolean;
  coordinatorChanged: boolean;
  headCoachChanged: boolean;
  identityEpoch: string;
  evidence: string[];
};

export type PlayerRoleState = {
  playerId: string;
  player: string;
  team: string;
  position: string;
  role: string;
  depthRank: number | null;
  expectedSnapShare: number | null;
  recentSnapShare: number | null;
  routeParticipation: number | null;
  targetShare: number | null;
  rushShare: number | null;
  thirdDownRole: string | null;
  redZoneRole: string | null;
  passProtectionRole: string | null;
  defensiveRole: string | null;
  specialTeamsRole: string | null;
  roleStability: number | null;
  healthStatus: string | null;
  replacementGap: number | null;
  schemeFit: number | null;
  matchupFit: number | null;
  evidenceIds: string[];
};

export type CoachState = {
  coachId: string;
  coach: string;
  team: string | null;
  role: 'HC' | 'OC' | 'DC' | 'STC' | 'OTHER';
  schemeFamily: string | null;
  playCaller: boolean;
  neutralRunRate: number | null;
  neutralPassRate: number | null;
  motionRate: number | null;
  tempo: number | null;
  fourthDownAggression: number | null;
  redZoneTendency: string | null;
  scriptedDriveProfile: string | null;
  adjustmentProfile: string | null;
  backupQbAdaptation: number | null;
  injuryAdaptation: number | null;
  opponentSpecificAdaptation: number | null;
  evidenceIds: string[];
};

export type SchemeState = {
  team: string;
  side: 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS';
  schemeFamily: string | null;
  formations: Record<string, number>;
  personnel: Record<string, number>;
  concepts: Record<string, number>;
  motionRate: number | null;
  protectionMix: Record<string, number>;
  coverageMix: Record<string, number>;
  shellMix: Record<string, number>;
  frontMix: Record<string, number>;
  pressureMix: Record<string, number>;
  sampleSize: number;
  evidenceIds: string[];
};

export type MatchupMechanism = {
  id: string;
  gameKey: string;
  mechanism: string;
  attackingSide: string;
  vulnerableSide: string;
  direction: 'HOME' | 'AWAY' | 'NEUTRAL';
  expectedMagnitude: number | null;
  confidence: number | null;
  stability: StabilityClass;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
};

export type UnderdogMechanism = {
  gameKey: string;
  underdog: string;
  mechanism: string;
  gameScript: string;
  varianceSource: string | null;
  supportingEvidenceIds: string[];
  confidence: number | null;
  active: boolean;
};

export type FavoriteFragility = {
  gameKey: string;
  favorite: string;
  mechanism: string;
  breakCondition: string;
  supportingEvidenceIds: string[];
  confidence: number | null;
  active: boolean;
};

export type LeagueTrend = {
  metric: string;
  asOf: string;
  season: number;
  leagueValue: number | null;
  priorSeasonValue: number | null;
  recentValue: number | null;
  direction: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  confidence: number | null;
  evidenceIds: string[];
};

export type ForecastEvidencePacket = {
  season: number;
  week: number;
  gameKey: string;
  scheduledKickoffAt: string;
  featureCutoffAt: string;
  captureHorizon: CaptureHorizon;

  footballEvidence: EvidenceObservation[];
  seasonTransitions: SeasonTransitionState[];
  players: PlayerRoleState[];
  coaches: CoachState[];
  schemes: SchemeState[];
  matchups: MatchupMechanism[];
  underdogMechanisms: UnderdogMechanism[];
  favoriteFragility: FavoriteFragility[];
  leagueTrends: LeagueTrend[];

  footballProbability: number | null;
  marketProbability: number | null;
  marketGap: number | null;
  disagreementReason: string | null;

  evidenceLabels: EvidenceLabel[];
  productionInfluence: 0;
};

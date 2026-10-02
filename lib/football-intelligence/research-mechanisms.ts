/**
 * Research-only mechanism builders learned from prospective 2026 postmortems.
 * They create structured evidence; they DO NOT change a forecast probability.
 * productionInfluence must remain 0 until chronological OOS + prospective shadow validation.
 */

export const RESEARCH_ONLY = Object.freeze({ status: 'ACTIVE_RESEARCH', productionInfluence: 0 });

const clamp01 = (value) => value == null ? null : Math.max(0, Math.min(1, value));

export function buildRoleAcceleration(state) {
  const recent = state.recentSnapShare ?? state.routeParticipation ?? null;
  const prior = state.priorSnapShare ?? null;
  const usageDelta = recent != null && prior != null ? recent - prior : null;
  const concentration = state.targetShare ?? state.rushShare ?? null;
  const stability = state.roleStability ?? null;
  const acceleration = usageDelta == null ? null : clamp01(
    0.55 * Math.max(0, usageDelta) +
    0.30 * Math.max(0, concentration ?? 0) +
    0.15 * (stability ?? 0)
  );
  return {
    type: 'ROLE_ACCELERATION',
    playerId: state.playerId,
    team: state.team,
    acceleration,
    usageDelta,
    concentration,
    evidenceIds: state.evidenceIds ?? [],
    ...RESEARCH_ONLY,
  };
}

export function buildCountermeasureMechanism(input) {
  // Separates the initial mismatch from the opponent's ability to mitigate it.
  const initialMismatch = clamp01(input.initialMismatch);
  const tacticAvailability = clamp01(input.tacticAvailability);
  const qbFit = clamp01(input.qbFit);
  const playCallerAdaptation = clamp01(input.playCallerAdaptation);
  const evidenceReliability = clamp01(input.evidenceReliability);
  const mitigation = [tacticAvailability, qbFit, playCallerAdaptation].every(v => v != null)
    ? clamp01((tacticAvailability + qbFit + playCallerAdaptation) / 3)
    : null;
  const adjustedMismatch = initialMismatch != null && mitigation != null
    ? clamp01(initialMismatch * (1 - mitigation))
    : initialMismatch;
  return {
    type: 'COUNTERMEASURE_ADAPTATION',
    gameKey: input.gameKey,
    attackingSide: input.attackingSide,
    vulnerableSide: input.vulnerableSide,
    initialMismatch,
    mitigation,
    adjustedMismatch,
    evidenceReliability,
    evidenceIds: input.evidenceIds ?? [],
    ...RESEARCH_ONLY,
  };
}

export function buildPersonnelExplosiveMatchup(input) {
  // Replaces the rejected generic explosive-pass matchup with a personnel-specific mechanism.
  const values = [
    input.receiverExplosiveness,
    input.currentRole,
    input.coverageVulnerability,
    input.cornerReplacementGap,
    input.protectionFeasibility,
  ].map(clamp01);
  const score = values.every(v => v != null)
    ? clamp01(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  return {
    type: 'PERSONNEL_EXPLOSIVE_MATCHUP',
    gameKey: input.gameKey,
    receiverId: input.receiverId,
    defenderId: input.defenderId ?? null,
    score,
    expectedCoverage: input.expectedCoverage ?? null,
    evidenceIds: input.evidenceIds ?? [],
    ...RESEARCH_ONLY,
  };
}

export function buildHomeEnvironment(input) {
  // Modern HFA is contextual, not a fixed +3. This captures components without assigning forecast weight.
  return {
    type: 'HOME_ENVIRONMENT',
    gameKey: input.gameKey,
    homeTeam: input.homeTeam,
    neutralSite: Boolean(input.neutralSite),
    crowdNoise: clamp01(input.crowdNoise),
    travelBurden: clamp01(input.travelBurden),
    timeZoneShift: input.timeZoneShift ?? 0,
    restDifferential: input.restDifferential ?? 0,
    venueFamiliarity: clamp01(input.venueFamiliarity),
    weatherFamiliarity: clamp01(input.weatherFamiliarity),
    altitudeEffect: clamp01(input.altitudeEffect),
    divisionalFamiliarity: clamp01(input.divisionalFamiliarity),
    evidenceIds: input.evidenceIds ?? [],
    ...RESEARCH_ONLY,
  };
}

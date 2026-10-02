/**
 * Research-only 2026 chronological replay ledger utilities.
 * The caller must supply evidence that has already passed the pre-kickoff cutoff.
 */

export const REPLAY_STATUS = 'RETROSPECTIVE_2026_REPLAY';
export const PRODUCTION_INFLUENCE = 0;

export function assertPregameEvidence(evidence, kickoffAt) {
  const kickoff = Date.parse(kickoffAt);
  if (!Number.isFinite(kickoff)) throw new Error('Invalid kickoffAt');
  for (const item of evidence) {
    const available = Date.parse(item.availableAt);
    if (!Number.isFinite(available)) throw new Error(`Evidence ${item.id} missing valid availableAt`);
    if (available >= kickoff) throw new Error(`POSTKICK_EVIDENCE_REJECTED: ${item.id}`);
  }
}

export function freezeReplayForecast(input) {
  assertPregameEvidence(input.evidence ?? [], input.kickoffAt);
  if (!(input.homeWinProbability > 0 && input.homeWinProbability < 1))
    throw new Error('homeWinProbability must be between 0 and 1');
  return Object.freeze({
    replayStatus: REPLAY_STATUS,
    productionInfluence: PRODUCTION_INFLUENCE,
    gameKey: input.gameKey,
    week: input.week,
    kickoffAt: input.kickoffAt,
    featureCutoffAt: input.featureCutoffAt,
    away: input.away,
    home: input.home,
    homeWinProbability: input.homeWinProbability,
    footballOnlyHomeProbability: input.footballOnlyHomeProbability ?? null,
    marketHomeProbability: input.marketHomeProbability ?? null,
    projectedAwayScore: input.projectedAwayScore ?? null,
    projectedHomeScore: input.projectedHomeScore ?? null,
    confidence: input.confidence ?? null,
    thesis: input.thesis ?? [],
    mechanisms: input.mechanisms ?? [],
    evidenceIds: (input.evidence ?? []).map(x => x.id),
    frozenAt: input.frozenAt,
  });
}

export function gradeReplayForecast(forecast, result, diagnostic) {
  const predictedHome = forecast.homeWinProbability >= 0.5;
  const homeWon = result.homeScore > result.awayScore;
  const correct = predictedHome === homeWon;
  const p = homeWon ? forecast.homeWinProbability : 1 - forecast.homeWinProbability;
  const brier = (forecast.homeWinProbability - (homeWon ? 1 : 0)) ** 2;
  const logLoss = -Math.log(Math.max(1e-12, p));
  const projectedMargin = forecast.projectedHomeScore == null || forecast.projectedAwayScore == null
    ? null : forecast.projectedHomeScore - forecast.projectedAwayScore;
  const actualMargin = result.homeScore - result.awayScore;
  return {
    ...forecast,
    postgame: {
      awayScore: result.awayScore,
      homeScore: result.homeScore,
      correct,
      brier,
      logLoss,
      actualMargin,
      marginError: projectedMargin == null ? null : Math.abs(projectedMargin - actualMargin),
      classification: diagnostic.classification,
      decisiveMechanisms: diagnostic.decisiveMechanisms ?? [],
      missedMechanisms: diagnostic.missedMechanisms ?? [],
      falseMechanisms: diagnostic.falseMechanisms ?? [],
      varianceEvents: diagnostic.varianceEvents ?? [],
      tags: diagnostic.tags ?? [],
    },
  };
}

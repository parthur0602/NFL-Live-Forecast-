// Model V2 is deliberately market-first. The frozen 2021–2025 diagnostic
// found no repeatable football-only correction to a paired closing market.
// A live market snapshot is therefore the prior whenever both moneylines are
// present; football remains the transparent fallback and audit layer.

export const MODEL_V2 = {
  version: 'V2.1-MARKET-ANCHOR-INTEGRITY',
  footballCorrectionWeight: 0,
  marginResidualStdDev: 13.14,
  decisionRule:
    'No price-facing recommendation without a positive edge over the displayed break-even probability.',
} as const;

export function v2HomeProbability(
  footballHomeProbability: number,
  marketHomeProbability: number | null,
) {
  if (marketHomeProbability === null) return footballHomeProbability;
  return (
    marketHomeProbability +
    MODEL_V2.footballCorrectionWeight *
      (footballHomeProbability - marketHomeProbability)
  );
}

export function v2ExpectedHomeMargin(
  footballExpectedHomeMargin: number,
  homeSpread: number | null,
) {
  // A home -3.5 market spread represents a +3.5 expected home margin.
  if (homeSpread === null) return footballExpectedHomeMargin;
  const marketExpectedHomeMargin = -homeSpread;
  return (
    marketExpectedHomeMargin +
    MODEL_V2.footballCorrectionWeight *
      (footballExpectedHomeMargin - marketExpectedHomeMargin)
  );
}

export function impliedProbability(americanOdds: number | null) {
  if (americanOdds === null || !Number.isFinite(americanOdds) || americanOdds === 0)
    return null;
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return 0.5 * (1 + sign * erf);
}

function normalIntegerMass(
  integerMargin: number,
  expectedMargin: number,
  standardDeviation: number,
) {
  const upper = (integerMargin + 0.5 - expectedMargin) / standardDeviation;
  const lower = (integerMargin - 0.5 - expectedMargin) / standardDeviation;
  return Math.max(0, normalCdf(upper) - normalCdf(lower));
}

export type SpreadProbabilities = {
  homeCover: number;
  push: number;
  awayCover: number;
};

/**
 * A conservative discrete-margin baseline.
 *
 * V2 still assumes a normal latent margin because no timestamp-matched
 * empirical margin model has earned promotion yet, but it projects that latent
 * distribution onto integer NFL final margins. This makes integer-spread push
 * probability explicit and prevents the old binary half-point shortcut from
 * pretending pushes do not exist.
 */
export function spreadProbabilities(
  expectedHomeMargin: number,
  homeSpread: number | null,
): SpreadProbabilities | null {
  if (homeSpread === null) return null;

  let homeCover = 0;
  let push = 0;
  let awayCover = 0;
  const settlementThreshold = -homeSpread;

  for (let margin = -80; margin <= 80; margin += 1) {
    const mass = normalIntegerMass(
      margin,
      expectedHomeMargin,
      MODEL_V2.marginResidualStdDev,
    );
    if (margin > settlementThreshold) homeCover += mass;
    else if (margin < settlementThreshold) awayCover += mass;
    else push += mass;
  }

  // Capture negligible tails outside the explicit integer grid, then normalize
  // so the public probabilities always sum to one.
  const total = homeCover + push + awayCover;
  if (total <= 0) return null;
  return {
    homeCover: homeCover / total,
    push: push / total,
    awayCover: awayCover / total,
  };
}

export function homeCoverProbability(
  expectedHomeMargin: number,
  homeSpread: number | null,
) {
  const probabilities = spreadProbabilities(expectedHomeMargin, homeSpread);
  if (!probabilities) return null;
  // Keep the existing call-site contract: this is unconditional P(home cover),
  // not a re-normalized two-way probability with pushes discarded.
  return Math.max(0.001, Math.min(0.999, probabilities.homeCover));
}

export function americanFairOdds(probability: number) {
  const probabilitySafe = Math.max(0.01, Math.min(0.99, probability));
  const odds =
    probabilitySafe >= 0.5
      ? -100 * probabilitySafe / (1 - probabilitySafe)
      : 100 * (1 - probabilitySafe) / probabilitySafe;
  return Math.round(odds);
}

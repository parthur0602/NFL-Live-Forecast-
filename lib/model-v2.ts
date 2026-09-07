// Model V2 is deliberately market-first. The frozen 2021–2025 diagnostic
// found no repeatable football-only correction to a paired closing market.
// A live market snapshot is therefore the prior whenever both moneylines are
// present; football remains the transparent fallback and audit layer.

export const MODEL_V2 = {
  version: 'V2.0-MARKET-ANCHOR-SHADOW',
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

export function homeCoverProbability(
  expectedHomeMargin: number,
  homeSpread: number | null,
) {
  if (homeSpread === null) return null;
  // Half a point keeps the discrete push mass out of a binary cover estimate.
  return Math.max(
    0.01,
    Math.min(
      0.99,
      normalCdf(
        (expectedHomeMargin + homeSpread - 0.5) / MODEL_V2.marginResidualStdDev,
      ),
    ),
  );
}

export function americanFairOdds(probability: number) {
  const probabilitySafe = Math.max(0.01, Math.min(0.99, probability));
  const odds =
    probabilitySafe >= 0.5
      ? -100 * probabilitySafe / (1 - probabilitySafe)
      : 100 * (1 - probabilitySafe) / probabilitySafe;
  return Math.round(odds);
}

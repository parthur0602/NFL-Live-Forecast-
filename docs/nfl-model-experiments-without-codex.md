# NFL Model Experiments While Codex Is Unavailable

## Objective

Continue improving the football model without changing production V2 and without needing Codex.

The work should favor small, independently testable experiments over large unvalidated rewrites.

## Experiment 1 — Football-vs-market disagreement gates

Implemented in:
`scripts/test-v7-disagreement-gates.mjs`

Run:

`pnpm football:gate:audit`

Tests:
- market-only
- independent V7 football probability
- disagreement gates at 0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5 and 20 percentage points
- targeted underdog overrides when the market favorite is at least 70%
- season-by-season stability

Promotion requirement:
A gate must improve Brier/log loss and maintain or improve accuracy across multiple chronological seasons. One aggregate improvement is insufficient.

## Experiment 2 — Probability calibration

Goal:
Determine whether the market/V2 probability scale is calibrated.

Test:
- raw probability
- one-parameter temperature scaling
- two-parameter logistic calibration
- development seasons only
- untouched holdout season

This changes confidence, not the underlying pick, so it is safe to evaluate separately.

## Experiment 3 — Season-transition prior

Goal:
Determine whether carrying forward prior-season team information improves Week 1–3 predictions.

Variants:
- no prior carry
- fixed prior carry
- QB-continuity carry
- coaching-continuity carry
- roster-continuity carry
- combined continuity state

Each variant must be frozen before the holdout is evaluated.

## Experiment 4 — Early-season specialization

The first few weeks are structurally different from later weeks.

Test separate early-season handling for:
- Week 1
- Weeks 2–3
- Weeks 4–6
- established season

Do not simply use a larger global recency multiplier.

## Experiment 5 — Player availability specialist

Build a research-only replacement model based on:

player quality
× expected role
× replacement quality
× team dependency
× scheme fit
× matchup relevance

No generic QB-out or star-player penalty.

## Experiment 6 — Matchup mechanism specialist

Test whether mechanism-specific interactions outperform raw team-strength differences:

- QB vs pressure
- OL vs edge
- run scheme vs defensive front
- receiver vs coverage
- QB vs coverage
- red-zone offense vs defense

Only use signals with adequate chronological sample size.

## Experiment 7 — Underdog mechanism gate

Do not train the model to "pick more underdogs."

Instead require an explicit football mechanism.

A candidate upset must have:
- supported mechanism
- matchup evidence
- reasonable sample
- current-season relevance
- no major contradicting evidence

Then compare:
- market
- football
- gated upset strategy

## Experiment 8 — PoolHost simulator

Keep three layers separate:

1. Football probability
2. Market probability
3. PoolHost selection strategy

Simulate:
- probability-only picks
- consensus picks
- selective disagreement picks
- underdog mechanism picks
- user's Raiders override

Measure:
- season points
- weekly wins
- playoff qualification
- first-place outcomes
- last-place outcomes
- tail risk

Do not promote a PoolHost strategy merely because it performs well on one historical sample.

## Experiment 9 — Postgame forensic learning

Every completed game receives:
- right/wrong result
- right/wrong thesis
- model deficiency/variance
- failed mechanism
- missing information
- incorrect weighting
- coaching adaptation
- player/role surprise
- environment surprise

A proposed lesson must survive historical comparable testing before affecting a future model.

## Experiment 10 — Selective confidence

Instead of forcing a maximum-confidence winner for every game, evaluate whether the model can identify:
- high-confidence games
- fragile favorites
- true coin flips
- disagreement games
- underdog-viable games

This can improve decisions by improving confidence quality even if raw accuracy changes only modestly.

## Non-negotiable promotion rule

Nothing changes production until:
- chronological OOS testing passes,
- holdout passes,
- calibration is acceptable,
- subgroup behavior is stable,
- leakage audit passes,
- and prospective shadow evidence confirms the effect.

V2 remains the champion while those tests are running.

# V5 Residual Robustness Plan

Status: shadow-only. Production influence must remain 0.

## Goal
Determine whether the small historical improvement from the 25% football residual is stable enough to justify further development, without overfitting 2021–2025.

## Required robustness tests

1. Paired bootstrap on chronological OOS games (minimum 5,000 resamples) for:
   - delta Brier vs market
   - delta log loss vs market
   - delta accuracy vs market
   Report 95% confidence intervals and probability each delta is better than 0.

2. Leave-one-season-out stability for 2021–2025:
   - fit/tune only on the other seasons / earlier chronology as appropriate
   - report the selected correction scale and held-out metrics
   - count seasons improved/worsened vs market on Brier and log loss.

3. Predeclared correction scales only:
   - 0, 0.10, 0.25, 0.50, 0.75, 1.00
   Do not search arbitrary scales after seeing results.

4. Predeclared recency variants only:
   - all prior games with decay 0.88
   - last 4 completed games, equal weight
   - last 6 completed games, equal weight
   - all prior games, equal weight

5. Predeclared ridge strengths only:
   - 4, 8, 16, 32

6. Opponent adjustment research variant:
   - create opponent-adjusted versions only from information available before the forecast week
   - no same-week/future results
   - if a defensible opponent-adjustment cannot be implemented without leakage, skip it and report why.

7. Early-season shrinkage:
   - test shrinking team efficiency toward league mean based on games in sample
   - predeclare pseudo-game strengths 2, 4, and 6
   - no tuning on 2025 alone.

8. Feature ablation:
   - passing EPA only
   - rushing EPA only
   - passing EPA + sack rate + interception rate
   - all currently available features
   Report whether any improvement depends on one unstable feature bundle.

9. Calibration and subgroup checks:
   - probability bands
   - weeks 1-4, 5-9, 10-14, 15+
   - market favorite strength buckets
   - home vs road favorite
   - division vs non-division if schedule data supports it

10. Model-selection policy:
   - primary: lowest chronological OOS Brier
   - secondary: log loss
   - accuracy is descriptive only
   - reject a nonzero correction if improvement is not stable across seasons / bootstrap uncertainty is too wide.

## Promotion gate
No production promotion from historical replay alone.
A candidate may advance only to prospective 2026 shadow testing when:
- overall OOS Brier and log loss beat the market baseline,
- bootstrap intervals are directionally supportive,
- performance is not concentrated in a single season,
- no leakage is detected,
- all new specialists remain at 0 production weight.

Historical closing moneylines remain later-information proxies and cannot establish a same-time betting edge.

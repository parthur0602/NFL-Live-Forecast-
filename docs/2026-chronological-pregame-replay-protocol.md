# 2026 Chronological Pregame Replay Protocol

Status: ACTIVE_RESEARCH
Production influence: 0

## Purpose
Replay every completed 2026 NFL game using only evidence legitimately available before that game's kickoff. Freeze the forecast before postgame evidence is opened, then grade both result and football thesis.

## Two ledgers
1. LIVE_RECORD — only forecasts actually frozen prospectively at the time. Never rewritten.
2. RETROSPECTIVE_2026_REPLAY — today's research architecture simulated at historical pre-kickoff cutoffs. Never presented as the live record.

## Evidence cutoff
For each game define kickoffAt and featureCutoffAt < kickoffAt. Every observation must have availableAt <= featureCutoffAt. Reject post-kickoff reports, live odds, live injury news, play-by-play, final score, postgame analysis and any statistic containing the target game's plays.

## Replay order
Process chronologically, not week in bulk. Later games may use earlier completed 2026 games; simultaneous games cannot use one another.

## Pregame packet
- team efficiency through prior completed games only
- current-season identity with early-season shrinkage
- expected/confirmed starters and final inactives when timestamp-valid
- player role/usage trajectory
- OL continuity and replacement gaps
- coaching/playcaller/scheme state
- matchup mechanisms
- countermeasure/adaptation capability
- personnel-specific explosive matchup
- rest/travel/home environment
- weather at cutoff
- market probability stored separately as benchmark
- football-only probability
- final research probability
- projected score/total
- confidence and explicit win/upset thesis
- evidence IDs and timestamps

## Postgame grading
Only after forecast freeze:
- RIGHT_RESULT_RIGHT_THESIS
- RIGHT_RESULT_WEAK_THESIS
- WRONG_RESULT_THESIS_MOSTLY_RIGHT_VARIANCE
- WRONG_RESULT_MODEL_DEFICIENCY

Record margin error, total error, Brier/log loss, calibration bucket, decisive mechanisms, missed mechanisms, false mechanisms, variance events, and diagnostic tags.

## Failure families
Audit at minimum:
- EARLY_SEASON_IDENTITY_LAG
- QB_OR_REGIME_CHANGE
- PLAYER_ROLE_ACCELERATION
- AVAILABILITY_REPLACEMENT_GAP
- OL_CONTINUITY
- COACHING_COUNTERMEASURE
- PERSONNEL_EXPLOSIVE_MATCHUP
- HOME_ENVIRONMENT
- REST_TRAVEL
- DIVISION_FAMILIARITY
- FAVORITE_FRAGILITY
- UNDERDOG_MECHANISM
- DOUBLE_COUNTED_EVIDENCE
- OVERCONFIDENCE
- UNDERCONFIDENCE
- SCORE_DISTRIBUTION_MISS
- PURE_VARIANCE

## Anti-overfit rule
A postgame miss creates a hypothesis, not a weight change. Candidate fixes require historical comparables, chronological OOS validation, then prospective shadow evidence. Never optimize directly on the 2026 replay and call the resulting replay an unbiased test.

## Outputs
- outputs/2026-pregame-replay-ledger.json
- outputs/2026-failure-atlas.json
- outputs/2026-calibration-audit.json
- outputs/2026-mechanism-audit.json

## Current cutoff
Begin with all completed games through PIT at CLE, Week 4 Thursday, October 1, 2026. Later Week 4 games remain unseen until they are completed and separately replayed.

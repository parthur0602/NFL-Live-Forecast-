# V7.3 Football Intelligence Challenger

Status: ACTIVE_RESEARCH. Production influence: 0.

## Accepted change
A residual-only winner crossing must reach at least 1 percentage point beyond 50%. This boundary was selected on the 1,069-game chronological OOS audit: 67.82% accuracy, .208699 Brier, .604346 log loss versus unrestricted V7 67.73%, .208711, .604369. It is not promoted to production.

## Football-state exception
A weaker crossing may only be tested when at least two independent, timestamp-valid football mechanism families agree. Correlated facts are collapsed into one family before consensus. This exception remains prospective shadow-only until validated.

## Mechanism families
1. Availability/replacement gap: quality × role dependency × replacement gap × positional importance × matchup relevance × reliability.
2. Role acceleration: recent snaps/routes/touches/targets versus prior role; unavailable fields stay null.
3. Countermeasure/adaptation: initial mismatch reduced by tactic availability, QB fit and playcaller adaptation.
4. Personnel matchup: receiver/rusher/pass-rusher versus likely replacement/coverage/blocking personnel.
5. Home environment: decomposed travel/rest/time-zone/venue/weather/altitude; no generic +3 and no duplicate generic home bonus.
6. OL continuity and secondary replacement clusters.
7. QB/regime transition.

## Anti-double-counting
Only the strongest observation within a mechanism family/side contributes to consensus. OL injuries + sack rate + pass rusher are not three votes when they describe the same protection mechanism.

## Missing-data rule
No neutral-value imputation for unavailable game-day starter, inactive, snap, route, coverage or playcaller fields. Missing evidence cannot create a mechanism or a flip.

## Validation
Champion remains frozen. Challenger must pass historical chronological OOS where the required data exists, 2026 strict pregame replay, calibration/Brier/log loss, and prospective shadow. Postgame discoveries create hypotheses only.

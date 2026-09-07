# V5 2026 Prospective Shadow Plan

## Purpose
Run V2 production and V5 shadow forecasts side by side for every 2026 NFL game using the same market timestamp and the same pre-kickoff information boundary. V2 remains production. V5 receives zero production influence until prospective evidence is strong enough to justify a later promotion decision.

## Historical challenger frozen for prospective use
Use the best *predeclared robustness-suite* configuration only as a shadow challenger:
- market-offset logistic residual model
- all-prior same-season regular-season team efficiency, equal weight
- ridge = 8
- no early-season pseudo-game shrinkage
- all currently available efficiency features
- applied shadow residual scale = 0.50
- production influence = 0

Do not re-tune this configuration on 2026 outcomes. If the historical training artifact must be regenerated for reproducibility, train it only from the frozen 2021–2025 historical source set and record a model/artifact hash.

## Runtime feature boundary
For a 2026 forecast in Week N:
- only 2026 regular-season team-stat rows with week < N are eligible;
- no same-week or future-week data;
- no postgame information from the target game;
- player/QB availability remains excluded unless a timestamped structured source exists and a separately validated specialist is explicitly introduced;
- if current-season efficiency data are unavailable, V5 must report unavailable and fall back to a shadow value equal to V2 for grading clarity rather than inventing inputs.

## Same-timestamp market rule
V2 and V5 must use the same no-vig market probability from the same captured market snapshot. Persist market source and market observed timestamp alongside both model outputs. Never compare a live V5 forecast against a later closing line and call it same-time edge.

## Server-computed capture
Prospective exam rows must be computed on the server. Do not trust browser-submitted probability fields for the prospective comparison. Browser requests may trigger a refresh/capture, but the server must independently obtain/recompute the market baseline and V5 shadow value before inserting the immutable row.

## Capture horizons
Preserve the existing hourly dedupe infrastructure, and additionally classify rows into useful horizon labels when kickoff time is known:
- OPENING / earliest available
- 72H
- 24H
- 6H
- 90M
- FINAL_PREKICK

A single row may retain the hourly bucket plus a derived horizon label. Never capture after kickoff.

## New ledger
Use `prospective_model_snapshots` for paired V2/V5 records. One row contains both probabilities so they cannot drift to different timestamps. Unique key: season + game_key + capture_bucket.

Required fields include:
- market probability/source/observed time
- V2 probability/pick/version
- V5 probability/pick/raw residual/scale/version
- feature data-through week and feature payload
- V5 available flag
- production influence (always 0 for V5)
- settlement results and correctness for both models

## Season exam
Add a server-side exam/report that grades settled paired rows on the exact same games and capture horizons.

Report for V2 and V5:
- games graded
- accuracy
- Brier score
- log loss
- calibration buckets
- expected losses from displayed favorite probabilities
- actual losses
- excess losses
- pick disagreements and disagreement win rate

Report paired V5 minus V2 deltas:
- Brier
- log loss
- accuracy

Where sample size permits, include paired bootstrap intervals. Never declare promotion from a tiny sample.

## Promotion guardrail
This PR must not alter:
- `MODEL_V2.footballCorrectionWeight`
- V2 production probability logic
- specialist production weights
- betting recommendations

V5 remains `SHADOW_ONLY` and `productionInfluence = 0`.

## UI / API expectation
Expose enough information to rerun the current NFL slate and show, per game:
- V2 official probability and pick
- V5 shadow probability and pick (or unavailable reason)
- market probability used
- V5 minus V2 probability delta
- disagreement flag
- feature sample through-week
- explicit `SHADOW ONLY — does not affect production` label

## Validation
Codex must test:
1. migration and local D1 mirror;
2. server-computed paired capture;
3. no capture after kickoff;
4. hourly dedupe;
5. same market timestamp for V2 and V5;
6. Week N uses efficiency data only through Week N-1;
7. unavailable 2026 team stats produce truthful V5-unavailable behavior;
8. settlement grades every paired row without inflating canonical V2 learning records;
9. season exam uses paired rows only;
10. V2/specialist/betting production behavior is unchanged.

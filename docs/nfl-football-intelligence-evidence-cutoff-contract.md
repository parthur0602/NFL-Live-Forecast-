# NFL Football Intelligence — Evidence and Cutoff Contract

## Goal

Make it impossible to accidentally use information in a forecast that was unavailable before the forecast cutoff.

## Required timestamps

Every evidence record must retain:

- `observedAt`: when the underlying event/condition occurred
- `availableAt`: when the information became publicly/operationally available to the forecasting system
- `capturedAt`: when our system recorded it
- `scheduledKickoffAt`: target game kickoff
- `featureCutoffAt`: hard eligibility boundary for the forecast

## Eligibility

A signal is pregame eligible only when:

`availableAt <= featureCutoffAt < scheduledKickoffAt`

If `availableAt` is unknown for a signal whose timing can affect leakage, mark it `TIMING_UNVERIFIED` and exclude it from predictive evaluation.

## Horizon labels

When kickoff is known, derive:

- OPENING
- 72H
- 24H
- 6H
- 90M
- FINAL_PREKICK
- POSTKICK_REJECTED

The system may preserve all pregame observations, but evaluation must never mix different horizons without labeling them.

## Postgame guard

Anything first available after kickoff is:

`POSTGAME_ONLY`

and must never reach a pregame forecast.

Anything sourced from a final box score, postgame article, final injury report, postgame tracking result, or game outcome is postgame-only unless an independent timestamp proves the relevant fact was available pregame.

## Derived statistics

A derived statistic inherits the strictest availability boundary of any input used to calculate it.

Example:

- player participation from prior games: eligible
- current-game snap count: postgame-only
- season-to-date snap share before the target game: eligible
- full-season snap share including target game: postgame-only

## Season boundary

For Week N:

- prior seasons may inform priors according to validated continuity logic
- current-season games through Week N-1 are eligible
- same-week postgame statistics are ineligible
- target-game stats are ineligible
- future games are ineligible

## Current-season rule

Do not apply one global recency factor.

Every factor has a stability class:

FAST
- injuries
- availability
- role
- snap share
- play calling
- formations
- pressure usage
- coverage usage

MEDIUM
- player efficiency
- team efficiency
- situational tendencies
- matchup tendencies

SLOW
- talent baseline
- coaching identity
- scheme family
- roster quality

## Market rule

Market snapshots are separate evidence.

Never call closing odds a same-horizon benchmark unless the odds observation timestamp is available.

## Audit requirement

For every final forecast, retain a machine-readable list of all source observations used and their cutoff validation status.

A forecast should be reproducible from the evidence packet without retrieving future information.

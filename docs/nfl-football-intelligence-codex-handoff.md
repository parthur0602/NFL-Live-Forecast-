# NFL Football Intelligence — Codex Handoff

Codex usage is currently unavailable. This document is the exact implementation order to resume when capacity returns.

## Do not restart from the original giant prompt

Use this foundation branch and these files first:

- `docs/nfl-football-intelligence-engine-foundation.md`
- `docs/nfl-football-intelligence-factor-registry.json`
- `docs/nfl-football-intelligence-evidence-cutoff-contract.md`

## Phase A — Inspect, do not modify production

1. Inspect `chatgpt/v7-intelligence-engine` and this foundation branch.
2. Compare current schema and existing V7 intelligence tables.
3. Identify reusable components.
4. Confirm V2 production path and frozen artifacts are unchanged.
5. Do not touch prediction weights.

## Phase B — Machine-readable contracts

Implement typed contracts for:

- FactorDefinition
- EvidenceObservation
- EntityState
- SeasonTransitionState
- PlayerRoleState
- CoachState
- SchemeState
- MatchupMechanism
- UnderdogMechanism
- FavoriteFragility
- LeagueTrend
- ForecastEvidencePacket

All contracts must carry timestamps and provenance where applicable.

## Phase C — Registry validation

Create a validator that checks:

- unique factor IDs
- valid categories
- valid status values
- explicit mechanism
- pregame/postgame flags
- source class
- timestamp requirement
- production weight = 0 for research factors

## Phase D — State graph

Build read-only state resolvers:

`getTeamState(team, timestamp)`
`getPlayerState(player, timestamp)`
`getCoachState(coach, timestamp)`
`getSchemeState(team, timestamp)`
`getSeasonTransitionState(team, timestamp)`
`getMatchupState(game, timestamp)`

They must operate only on evidence available at the requested timestamp.

## Phase E — Mechanism engine

Build matchup mechanisms rather than raw feature weights.

The engine should return:

- mechanism
- supporting evidence
- contradicting evidence
- confidence
- expected direction
- expected magnitude
- sample size
- stability
- timestamp provenance

## Phase F — Underdog/favorite analysis

For every game expose:

`underdogPaths`
`favoriteFragility`
`marketDisagreement`

Never force an upset.

## Phase G — Prospective shadow

Connect the football-intelligence packet to the existing V7 shadow ledger only.

Production influence remains exactly 0.

## Phase H — Validation

Before any future production integration:

- chronological historical replay
- untouched holdout
- subgroup calibration
- leakage audit
- prospective shadow
- paired V2 comparison
- repeated-sample confirmation

## Phase I — Promotion

Promotion requires explicit evidence and an updated specialist registry entry. No implicit influence.

## Final rule

The system should eventually be capable of explaining a game in football terms before it produces a probability.

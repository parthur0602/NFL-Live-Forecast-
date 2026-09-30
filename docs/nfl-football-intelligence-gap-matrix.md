# NFL Football Intelligence — Current Gap Matrix

This is a baseline assessment of the `chatgpt/v7-intelligence-engine` branch as inspected while creating the foundation.

## Already present

### Prospective integrity
- V2 production ledger exists.
- Forecast ledger exists.
- Paired V2/V5 shadow ledger exists.
- V7 intelligence snapshot structure exists.
- Production influence is explicitly modeled as zero for shadow systems.
- Timestamped football state snapshots exist.
- Team-efficiency snapshots exist.
- Player-availability snapshots exist.
- Market snapshots exist.
- Postmortem/error-memory infrastructure exists.

### Current football intelligence
- Current-season team efficiency ingestion exists.
- Player-value research artifact exists.
- V7 player-intelligence aggregation exists.
- Depth-chart information is represented.
- Availability/injury research signals are represented.
- V7 prospective shadow infrastructure exists.

## Highest-priority gaps

### P0 — Evidence timing / availability
Need reliable, timestamped:
- official game-day inactives
- confirmed starting QB
- confirmed starting OL
- final active roster
- replacement player identity
- player role at forecast time
- source availability time

The current player-intelligence layer explicitly acknowledges that game-day starter confirmation, game-day inactive lists, snap shares, route usage, red-zone usage and named replacement players may be unavailable.

### P0 — Player role state
Current player intelligence is still much more "player value + depth rank" than true role intelligence.

Need:
- expected snaps
- recent snap trend
- offensive/defensive/ST role
- route participation
- target/carry role
- third-down role
- red-zone role
- pass-protection role
- coverage role
- pressure role
- alignment

### P0 — Offensive line intelligence
Need a first-class OL state:
- five-man continuity
- position-specific starters
- replacement quality
- pass-block pressure
- sack responsibility
- run-block performance
- opponent rusher matchups
- communication/continuity proxies

### P1 — Coaching state
Need structured HC/OC/DC/ST-coordinator state:
- scheme family
- play caller
- tendencies
- game-state behavior
- fourth-down choices
- red-zone behavior
- halftime adjustments
- backup-QB adaptation
- injury adaptation
- opponent-specific changes

### P1 — Tactical play classification
Need play-level state beyond basic efficiency:
- formation
- personnel
- motion
- shift
- protection
- route concept
- run concept
- coverage family
- shell
- pressure
- blitz
- front
- stunt
- run-fit

### P1 — Matchup mechanisms
Need explicit interaction records rather than only independent team ratings.

Examples:
- QB vs pressure
- OL vs edge
- run concept vs front
- WR vs coverage
- TE vs LB/DB
- mobility vs contain
- play action vs second level
- red zone offense vs defense

### P1 — Current-season identity epochs
Need change-point detection for:
- QB change
- HC/OC/DC change
- scheme change
- OL change
- role hierarchy change
- defensive structure change

A team's identity should be allowed to change during a season.

### P2 — Tracking / advanced data
The architecture should be able to consume Next Gen Stats-class evidence when access is available.

Tracking-derived data should not be approximated as "film" unless real video or tracking has actually been processed.

### P2 — Film observation layer
Need a structured store for actual video observations when accessible.

### P2 — League trend layer
Need league-wide evolving baselines for:
- scoring
- pass rate
- motion
- coverage shells
- pressure
- blitz
- explosives
- fourth-down aggression
- red zone

### P2 — Historical comparable engine
Need pregame-only retrieval of structurally similar games:
- QB situation
- coaching
- scheme
- personnel
- injuries
- environment
- matchup
- favorite/underdog state

## Architecture decision

Do not immediately add all of these fields to the final forecast formula.

Instead:

1. capture evidence,
2. normalize it,
3. derive state,
4. identify mechanisms,
5. store confidence,
6. run shadow research,
7. validate chronologically,
8. only then allow predictive influence.

## Recommended next implementation sequence

1. Evidence contract / timing guards
2. Player role state
3. QB + OL availability state
4. Coaching state
5. Tactical play classification
6. Matchup mechanisms
7. Current-season identity epochs
8. Underdog / favorite mechanism engine
9. League trend state
10. Historical comparables
11. Prospective shadow packet
12. Predictive validation

# NFL Football Intelligence — Source Map

This document defines the intended evidence hierarchy. It is a research contract, not a claim that every source is currently connected.

## Tier A — primary / structural

### NFL Next Gen Stats
Use when accessible for:
- player tracking
- location
- speed
- acceleration
- distance traveled
- formations
- coverage
- route detection
- completion probability
- expected rushing yards
- win probability

The NFL states that its venue tracking system captures player data at 10 Hz and creates more than 200 new data points on every play. Treat raw tracking as the highest-value tactical evidence when a timestamp-valid feed is available.

### Official NFL / official team sources
Use for:
- official schedule
- injuries
- practice reports
- inactives
- transactions
- roster moves
- depth charts
- coaching announcements
- official game status

Official sources get priority for availability facts when timestamped.

## Tier B — structured football analytics

### nflverse / nflfastR
Use for:
- historical play-by-play
- EPA
- success rate
- drive data
- situation
- play types
- team/player aggregates
- chronological historical replay

Historical play-by-play is a primary backbone for longitudinal football research.

### Pro Football Reference
Use for:
- historical player/team records
- snap counts
- participation
- advanced passing
- air yards
- ADOT
- YAC
- pressure
- blitzed
- hurried
- hits
- RPO
- play action
- defensive targets
- missed tackles
- weather history
- historical spreads

PFR coverage varies by metric and season. Every factor must carry its actual coverage window.

## Tier C — supporting / secondary

Use responsibly for:
- injury aggregators
- depth chart aggregators
- transaction feeds
- roster databases
- coaching histories
- public weather archives
- venue information

Tier C sources should not override a more authoritative contemporaneous source without an explicit reason.

## Tier D — film / qualitative evidence

When an actually accessible video source is available, capture structured observations rather than prose opinions:

- formation
- personnel
- motion
- protection
- route concept
- coverage
- front
- stunt
- pressure
- run concept
- leverage
- defensive rotation
- QB decision
- coaching adjustment

If actual video is not available, the system must say so and use play/tracking proxies instead.

## Data coverage rules

A factor is only as strong as its coverage.

For each source/factor pair store:

- seasons available
- weeks available
- game participation coverage
- timestamp availability
- missingness
- update cadence
- definition/version
- source reliability

Never silently mix:
- postgame and pregame values
- current-season and prior-season definitions
- unofficial and official availability
- different metric definitions

## Source conflict rule

When sources disagree:

1. compare timestamps;
2. compare source authority;
3. compare definition;
4. preserve both observations;
5. choose a forecast-eligible value only if the conflict can be resolved;
6. otherwise mark the factor uncertain/unavailable.

## No-data rule

Missing evidence is not a negative football signal.

If a current-season feature is unavailable:
- record unavailable,
- expose missingness,
- do not substitute a future observation,
- do not silently substitute the closing market,
- do not invent a replacement value.

## Research priority

Highest implementation value:

1. timestamped official availability
2. current-season play-by-play
3. player participation/snap evidence
4. OL continuity
5. QB role/availability
6. coach/play-caller continuity
7. play-level tactical classification
8. tracking-derived matchup data
9. weather/environment
10. special teams
11. historical comparable retrieval

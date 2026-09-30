# NFL Football Intelligence Engine — Foundation Specification

Status: RESEARCH FOUNDATION ONLY
Branch: `chatgpt/football-intelligence-foundation`
Production influence: 0
V2 baseline: frozen
V8/V8.4 artifacts: frozen

## Purpose

Build an independent football-intelligence layer before allowing new football evidence to alter winner probabilities.

The engine must understand a game as a changing system of:

- players and roles
- teams and units
- coaches and play callers
- schemes and tendencies
- opponent-specific matchups
- availability and replacement value
- current-season evolution
- game environment
- situational football
- special teams
- historical comparables
- league-wide structural trends

The model is allowed to disagree with the betting market. It is not allowed to follow or fade the market by rule. Market probability and football probability are separate evidence streams.

An 80%+ season-long winner rate is a stretch target, not an assumed capability. The system must earn higher-confidence probabilities through chronological out-of-sample validation and calibration.

## Core invariant

`raw evidence -> timestamped fact -> interpreted football state -> mechanism -> forecast evidence -> calibrated probability`

Never:

`raw statistic -> arbitrary weight -> pick`

## Operating principles

1. Current-season state is first class.
2. Team identity is time varying.
3. Player value is role dependent.
4. Injuries are replacement problems, not fixed penalties.
5. Matchups are mechanism based.
6. Coaching is part of the football system.
7. Underdog analysis is explicit but not forced.
8. Favorite fragility is explicit but not forced.
9. Small factors are catalogued before they are trusted.
10. Every signal has provenance and availability time.
11. No postgame leakage.
12. No learning from one result.
13. No promotion from small samples.
14. Market disagreement is an observable condition, not a decision rule.
15. V2 remains the production reference until a challenger earns influence.

## Football state hierarchy

### Level 0 — Game identity

- season
- week
- game
- kickoff
- venue
- home/away
- neutral site
- rest
- travel
- time zone
- field
- weather
- officiating crew
- market observation timestamp

### Level 1 — Organization

- franchise
- current roster
- coaching staff
- front office changes
- season/era
- organizational continuity

### Level 2 — Team units

- QB room
- RB room
- WR room
- TE room
- OL
- DL
- EDGE
- LB
- CB
- S
- kicking
- punting
- return/coverage units

### Level 3 — People

For every meaningful player and coach:

- identity
- current team
- historical teams
- role
- role stability
- health
- workload
- skill profile
- scheme fit
- matchup fit
- current form
- historical baseline
- replacement relationship
- evidence quality

### Level 4 — Tactics

- formations
- personnel
- motion
- shifts
- play families
- protections
- route concepts
- coverage
- fronts
- pressure
- run fits
- option/RPO behavior
- tempo
- substitution patterns
- fourth-down decisions

### Level 5 — Outcomes

- EPA
- success rate
- explosive rate
- scoring
- drive efficiency
- field position
- turnover creation/prevention
- situational results

Outcome statistics are downstream evidence. They should not erase the tactical mechanism that produced them.

## Current-season engine

Every team receives a state object containing:

`priorEra`, `transitionState`, `currentSeasonState`, `recentState`, `gameSpecificState`

Continuity is tracked separately for:

- HC
- OC
- DC
- QB
- OL
- skill players
- defensive front
- secondary
- scheme

Historical carry-forward must depend on continuity, not only elapsed time.

Fast-changing signals:

- availability
- expected role
- QB role
- OL availability
- coverage usage
- pressure usage
- snap distribution
- play-calling
- depth chart

Slow-changing signals:

- player talent baseline
- coaching philosophy
- scheme family
- team personnel quality

The engine must estimate stability for every signal rather than applying one global recency decay.

## Player model

Player state =:

`talentBaseline + currentForm + currentRole + roleStability + health + expectedUsage + schemeFit + matchupFit + replacementGap`

Player evaluation must be position specific.

Quarterbacks require separate views for:

- clean pocket
- pressure
- blitz
- coverage family
- depth of target
- play action
- under center
- shotgun
- RPO
- scramble
- designed rush
- red zone
- third down
- late game
- turnover pressure

Skill players require:

- alignment
- route/rush concept
- usage
- target/carry share
- explosive rate
- efficiency
- blocking/protection
- coverage matchup
- role concentration

OL requires:

- position
- starter continuity
- pressure responsibility
- sack responsibility when available
- run blocking context
- penalties
- opposing rusher matchup
- replacement quality
- communication/continuity proxies

Defenders require:

- alignment
- assignment
- front
- pressure
- coverage
- run fit
- tackling
- matchup
- role stability

## Team model

Every team has independent offense, defense and special-teams states.

Offense must cover:

- EPA/pass
- EPA/rush
- success rate
- explosives
- points/drive
- yards/drive
- early down
- neutral script
- third down
- fourth down
- red zone
- goal line
- pass rate
- motion
- play action
- RPO
- formation
- personnel
- pace
- no-huddle
- protection
- route/run concept mix

Defense must cover:

- EPA/pass allowed
- EPA/rush allowed
- success rate allowed
- explosives allowed
- pressure
- sacks
- hits/hurries
- blitz
- simulated pressure
- fronts
- stunts
- man/zone
- shells
- press
- run fits
- missed tackles
- red zone
- third down
- takeaways

Special teams must cover:

- kicking
- punting
- kickoff
- returns
- coverage
- field position
- blocks
- penalties
- weather sensitivity

## Coaching model

Coaches are modeled independently of team record.

Track:

- scheme
- play-calling
- scripted drives
- formation tendencies
- personnel usage
- neutral-down tendencies
- third/fourth down
- red-zone calls
- pace
- aggression
- protection choices
- pressure choices
- coverage choices
- backup-QB adaptation
- injury adaptation
- opponent-specific adjustment
- halftime/second-half adjustment
- game-state response

Coach state must distinguish:

`process`, `scheme`, `adaptability`, `gameManagement`, `personnelUsage`

## Matchup engine

A matchup object must explicitly connect strength to weakness.

Examples:

- pass protection vs pass rush
- specific OL vs specific rusher
- QB pressure sensitivity vs opponent pressure
- route separation vs coverage style
- receiver alignment vs DB role
- run concept vs front/run fit
- QB mobility vs edge containment
- play action vs linebacker reaction
- RPO vs defensive discipline
- explosive passing vs shell structure
- red-zone offense vs red-zone defense
- short-yardage offense vs short-yardage defense
- fourth-down offense vs fourth-down defense

Each mechanism stores:

- evidence
- direction
- expected magnitude
- confidence
- stability
- opponent specificity
- sample size
- source timestamp

## Underdog engine

The engine asks:

`What concrete football path allows the underdog to win?`

Potential mechanisms:

- pressure advantage
- run-game advantage
- explosive mismatch
- QB style/coverage mismatch
- OL mismatch
- turnover mechanism
- red-zone mismatch
- special-teams edge
- weather effect
- rest/travel advantage
- replacement-player advantage
- coaching adaptation
- opponent dependency
- favorite fragility

No underdog is selected merely because it is an underdog.

## Favorite fragility engine

The engine asks:

`What specifically could break the favorite?`

Potential failure points:

- QB pressure sensitivity
- weak OL continuity
- weak rush defense
- explosive-play allowance
- turnover dependence
- poor red zone
- poor short yardage
- injury concentration
- backup drop-off
- scheme rigidity
- coaching mismatch
- special teams
- weather
- travel/rest
- opponent familiarity

## Market separation

Persist both:

- football probability
- market probability

Also:

- probability gap
- disagreement reason
- evidence confidence
- market confidence

Never use the closing market as a proxy for same-horizon evidence.

## Evidence contract

Every observation must carry:

- signalId
- entityId
- season
- week
- gameKey when applicable
- source
- sourceUrl
- sourceType
- observedAt
- availableAt
- capturedAt
- confidence
- reliability
- sampleSize
- stability
- provenance
- derivation
- pregameAllowed
- postgameOnly
- notes

## Evidence labels

Every interpretation must be labeled:

- MODEL_FACT
- MODEL_INTERPRETATION
- RESEARCH_FINDING
- UNVALIDATED_HYPOTHESIS
- POSTGAME_ONLY

Every evidence source receives:

- VERY_HIGH
- HIGH
- MEDIUM
- LOW
- UNAVAILABLE

## Factor registry

Every proposed football factor is represented in the machine-readable registry.

A factor may be:

- ACTIVE_RESEARCH
- READY_FOR_SHADOW
- SHADOW_ONLY
- PRODUCTION_ELIGIBLE
- REJECTED
- POSTGAME_ONLY
- UNAVAILABLE

Rejection must record a reason.

## Validation ladder

No factor becomes production predictive influence without:

1. historical specification freeze
2. chronological backtest
3. untouched holdout
4. subgroup diagnostics
5. calibration check
6. leakage audit
7. prospective shadow
8. repeated-sample confirmation
9. paired V2 comparison
10. explicit promotion record

## Success metrics

Primary:

- winner accuracy
- Brier score
- log loss
- calibration

Secondary:

- favorite accuracy
- underdog accuracy
- market disagreement accuracy
- QB-change games
- OL-change games
- coaching-change games
- early season
- weather games
- divisional games
- close games
- large favorites
- small favorites

Never optimize only for accuracy.

## Film rule

The system may analyze play-level and tracking data deeply.

It must never claim that actual film was watched unless actual video was available and processed.

Where video is unavailable, use explicit play/tracking proxies.

## Research-only integration

The football intelligence layer must remain detached from the V2 production path.

Required query surfaces:

- team state by timestamp
- player state by timestamp
- coach state by timestamp
- scheme state by timestamp
- matchup state by timestamp
- underdog mechanisms
- favorite fragility
- season-transition state
- league-trend state

Production influence remains 0 until earned.

## Immediate build order

1. Factor registry
2. Evidence/data contract
3. Season transition state
4. Player role state
5. Coach/scheme state
6. Team identity state
7. Matchup mechanism state
8. Underdog/favorite mechanism state
9. League trend state
10. Query layer
11. Leakage tests
12. Prospective shadow adapter
13. Predictive validation

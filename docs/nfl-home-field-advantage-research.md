# Home-Field Advantage Research Contract

Status: ACTIVE_RESEARCH
Production influence: 0

Home-field advantage is treated as a real but time-varying football mechanism, not a fixed +3 points.

## Baseline prior
Historical research through 2025 supports a modern league-average home edge materially below the old +3 rule. The research engine should test recent rolling priors around 1.5–2.25 points rather than hard-code a value.

## Components
Capture separately:
- neutral-site status
- crowd/noise and communication burden
- away travel distance
- time-zone/body-clock shift
- rest differential / short week
- venue familiarity
- surface familiarity
- weather/climate familiarity
- altitude
- divisional familiarity (possible attenuation because opponents know venue/routine)
- team-specific home residual only after shrinkage and adequate sample

## Anti-double-counting
Do not add a generic home bonus on top of travel, rest, altitude, weather and crowd effects if those components already explain the same edge. Use a hierarchical decomposition or residual home term.

## Validation
1. Fit only prior games at each forecast date.
2. Use rolling/era-aware league baseline.
3. Shrink team/stadium effects heavily toward league mean.
4. Compare no-HFA vs generic-HFA vs decomposed-HFA.
5. Grade accuracy, Brier, log loss and calibration chronologically.
6. Test regular season separately from playoffs and neutral/international sites.
7. Production influence remains zero until prospective shadow confirms value.

## Interpretation
Raw home win percentage is not a causal estimate because home teams and away teams are not randomly assigned strength. Spread-adjusted or model-residual approaches are preferred for estimating incremental venue value.

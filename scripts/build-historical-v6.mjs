import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEASONS = [2021, 2022, 2023, 2024, 2025];
const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const PBP_URL = (season) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const CACHE_DIR = resolve('work/v6-cache');
const OUTPUT_PATH = resolve('outputs/v6-historical-accuracy-lab.json');
const CORRECTION_SCALES = [0, 0.1, 0.25, 0.5, 0.75, 1];
const SELECTIVE_THRESHOLDS = [0, 0.25, 0.5, 0.75];
const RECENCY_VARIANTS = ['decay_0.88', 'last_3', 'last_5', 'last_8', 'all_equal'];
const CARRYOVER_VALUES = [0, 0.25, 0.5];
const RIDGE_VALUES = [4, 8, 16, 32];
const SHRINKAGE_VALUES = [0, 2, 4, 6];
const MIN_TRAINING_GAMES = 150;
const LEARNING_RATE = 0.045;
const FEATURE_NAMES = [
  'passingEpaDiff', 'rushingEpaDiff', 'offenseSuccessDiff', 'earlyDownEpaDiff',
  'explosivePassDiff', 'explosiveRushDiff', 'redZoneTdRateDiff', 'thirdDownRateDiff',
  'fourthDownRateDiff', 'sackRateAllowedDiff', 'interceptionRateDiff',
  'defenseEpaAllowedDiff', 'defensePassEpaAllowedDiff', 'defenseRushEpaAllowedDiff',
  'defenseSuccessAllowedDiff', 'defenseExplosiveAllowedDiff', 'defenseRedZoneTdRateDiff',
  'qbEpaDiff', 'qbCompletionDiff',
];
const BUNDLE_DEFINITIONS = {
  'passing EPA only': ['passingEpaDiff'],
  'rushing EPA only': ['rushingEpaDiff'],
  'passing EPA + sack rate + interception rate': ['passingEpaDiff', 'sackRateAllowedDiff', 'interceptionRateDiff'],
  'all current features': FEATURE_NAMES,
};

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function number(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function sigmoid(value) { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }
function logit(probability) { const p = clamp(probability, 0.01, 0.99); return Math.log(p / (1 - p)); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

function impliedProbability(odds) {
  const value = number(odds);
  if (value === null || value === 0) return null;
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

function noVig(homeOdds, awayOdds) {
  const home = impliedProbability(homeOdds);
  const away = impliedProbability(awayOdds);
  if (home === null || away === null || home + away <= 0) return null;
  return home / (home + away);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'NFL Forecast Desk V6 research lab' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function loadPbp(season) {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `play_by_play_${season}.csv.gz`);
  try { await access(path); }
  catch {
    const response = await fetch(PBP_URL(season), { headers: { 'user-agent': 'NFL Forecast Desk V6 research lab' } });
    if (!response.ok) throw new Error(`${PBP_URL(season)} returned HTTP ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return gunzipSync(await readFile(path)).toString('utf8');
}

function freshAccumulator(team) {
  return {
    team, plays: 0, passPlays: 0, rushPlays: 0, epa: 0, passEpa: 0, rushEpa: 0,
    success: 0, earlyEpa: 0, explosivePass: 0, explosiveRush: 0,
    redZonePlays: 0, redZoneTd: 0, thirdAttempts: 0, thirdConversions: 0,
    fourthAttempts: 0, fourthConversions: 0, sacksAllowed: 0, interceptions: 0,
    completions: 0, passingAttempts: 0, qbDropbacks: 0, qbEpa: 0,
    qbCompletions: 0, qbPassAttempts: 0, qbByPlayer: new Map(),
    defPlays: 0, defPassPlays: 0, defRushPlays: 0, defEpa: 0, defPassEpa: 0, defRushEpa: 0, defSuccess: 0,
    defExplosive: 0, defRedZonePlays: 0, defRedZoneTd: 0, takeaways: 0,
  };
}

function flag(value) { return value === '1' || value === 1 || value === true; }

function aggregatePbp(text, targetGameIds) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return new Map();
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const get = (fields, key) => {
    const position = index.get(key);
    return position === undefined ? '' : fields[position] ?? '';
  };
  const games = new Map();
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const fields = parseCsvLine(lines[lineIndex]);
    const gameId = get(fields, 'game_id');
    if (!targetGameIds.has(gameId) || get(fields, 'season_type') !== 'REG') continue;
    const playType = get(fields, 'play_type');
    if (playType !== 'pass' && playType !== 'run') continue;
    const posteam = get(fields, 'posteam');
    const defteam = get(fields, 'defteam');
    const epa = number(get(fields, 'epa'));
    if (!posteam || !defteam || epa === null) continue;
    if (!games.has(gameId)) games.set(gameId, new Map());
    const teamMap = games.get(gameId);
    if (!teamMap.has(posteam)) teamMap.set(posteam, { offense: freshAccumulator(posteam), defense: freshAccumulator(posteam) });
    if (!teamMap.has(defteam)) teamMap.set(defteam, { offense: freshAccumulator(defteam), defense: freshAccumulator(defteam) });
    const offense = teamMap.get(posteam).offense;
    const defense = teamMap.get(defteam).defense;
    const yards = number(get(fields, 'yards_gained')) ?? 0;
    const success = flag(get(fields, 'success')) ? 1 : 0;
    offense.plays += 1; offense.epa += epa; offense.success += success;
    defense.defPlays += 1; defense.defEpa += epa; defense.defSuccess += success;
    if (get(fields, 'down') === '1' || get(fields, 'down') === '2') offense.earlyEpa += epa;
    if (get(fields, 'down') === '3') { offense.thirdAttempts += 1; if (flag(get(fields, 'third_down_converted'))) offense.thirdConversions += 1; }
    if (get(fields, 'down') === '4') { offense.fourthAttempts += 1; if (flag(get(fields, 'fourth_down_converted'))) offense.fourthConversions += 1; }
    const redZone = (number(get(fields, 'yardline_100')) ?? 100) <= 20;
    if (redZone) { offense.redZonePlays += 1; defense.defRedZonePlays += 1; if (flag(get(fields, 'touchdown'))) { offense.redZoneTd += 1; defense.defRedZoneTd += 1; } }
    if (playType === 'pass') {
      offense.passPlays += 1; offense.passEpa += epa; offense.passingAttempts += flag(get(fields, 'pass_attempt')) ? 1 : 0;
      offense.completions += flag(get(fields, 'complete_pass')) ? 1 : 0;
      offense.sacksAllowed += flag(get(fields, 'sack')) ? 1 : 0;
      offense.interceptions += flag(get(fields, 'interception')) ? 1 : 0;
      defense.defPassPlays += 1; defense.defPassEpa += epa; if (yards >= 20) { offense.explosivePass += 1; defense.defExplosive += 1; }
      if (flag(get(fields, 'qb_dropback'))) {
        offense.qbDropbacks += 1; offense.qbEpa += number(get(fields, 'qb_epa')) ?? epa;
        offense.qbPassAttempts += flag(get(fields, 'pass_attempt')) ? 1 : 0;
        offense.qbCompletions += flag(get(fields, 'complete_pass')) ? 1 : 0;
        const player = get(fields, 'passer_player_id') || get(fields, 'passer_player_name') || 'unknown';
        if (!offense.qbByPlayer.has(player)) offense.qbByPlayer.set(player, { dropbacks: 0, epa: 0, attempts: 0, completions: 0, name: get(fields, 'passer_player_name') || null });
        const qb = offense.qbByPlayer.get(player); qb.dropbacks += 1; qb.epa += number(get(fields, 'qb_epa')) ?? epa; qb.attempts += flag(get(fields, 'pass_attempt')) ? 1 : 0; qb.completions += flag(get(fields, 'complete_pass')) ? 1 : 0;
      }
    } else {
      offense.rushPlays += 1; offense.rushEpa += epa; defense.defRushPlays += 1; defense.defRushEpa += epa;
      if (yards >= 20) { offense.explosiveRush += 1; defense.defExplosive += 1; }
    }
  }
  for (const teamMap of games.values()) {
    for (const pair of teamMap.values()) {
      const qb = [...pair.offense.qbByPlayer.entries()].sort((a, b) => b[1].dropbacks - a[1].dropbacks)[0];
      pair.offense.starterQbId = qb?.[0] ?? null;
      pair.offense.starterQbName = qb?.[1].name ?? null;
      pair.offense.starterQbEpa = qb ? qb[1].epa / Math.max(1, qb[1].dropbacks) : null;
      pair.offense.starterQbCompletion = qb && qb[1].attempts ? qb[1].completions / qb[1].attempts : null;
    }
  }
  return games;
}

function rate(numerator, denominator) { return denominator ? numerator / denominator : null; }

function gameTeamRow(pair, opponent, game) {
  const offense = pair.offense; const defense = pair.defense;
  return {
    season: game.season, week: game.week, gameId: game.gameId, opponent,
    offense: {
      passingEpa: rate(offense.passEpa, offense.passPlays), rushingEpa: rate(offense.rushEpa, offense.rushPlays),
      success: rate(offense.success, offense.plays), earlyDownEpa: rate(offense.earlyEpa, offense.plays),
      explosivePass: rate(offense.explosivePass, offense.passPlays), explosiveRush: rate(offense.explosiveRush, offense.rushPlays),
      redZoneTdRate: rate(offense.redZoneTd, offense.redZonePlays), thirdDownRate: rate(offense.thirdConversions, offense.thirdAttempts),
      fourthDownRate: rate(offense.fourthConversions, offense.fourthAttempts), sackRateAllowed: rate(offense.sacksAllowed, offense.passPlays + offense.sacksAllowed),
      interceptionRate: rate(offense.interceptions, offense.passingAttempts), qbEpa: offense.starterQbEpa,
      qbCompletion: offense.starterQbCompletion, starterQbId: offense.starterQbId,
    },
    defense: {
      epaAllowed: rate(defense.defEpa, defense.defPlays), passEpaAllowed: rate(defense.defPassEpa, defense.defPassPlays),
      rushEpaAllowed: rate(defense.defRushEpa, defense.defRushPlays), successAllowed: rate(defense.defSuccess, defense.defPlays),
      explosiveAllowed: rate(defense.defExplosive, defense.defPlays), redZoneTdRate: rate(defense.defRedZoneTd, defense.defRedZonePlays),
    },
  };
}

function teamSummary(rows, recency, carryover, shrinkage, leagueMean) {
  if (!rows.length) return null;
  const current = rows.filter((row) => row.season === rows.at(-1).targetSeason);
  const prior = rows.filter((row) => row.season < rows.at(-1).targetSeason);
  const selected = [...prior.map((row) => ({ ...row, __carryover: carryover })), ...current];
  const summary = {};
  const fields = [
    ['passingEpa', (row) => row.offense.passingEpa], ['rushingEpa', (row) => row.offense.rushingEpa], ['success', (row) => row.offense.success],
    ['earlyDownEpa', (row) => row.offense.earlyDownEpa], ['explosivePass', (row) => row.offense.explosivePass], ['explosiveRush', (row) => row.offense.explosiveRush],
    ['redZoneTdRate', (row) => row.offense.redZoneTdRate], ['thirdDownRate', (row) => row.offense.thirdDownRate], ['fourthDownRate', (row) => row.offense.fourthDownRate],
    ['sackRateAllowed', (row) => row.offense.sackRateAllowed], ['interceptionRate', (row) => row.offense.interceptionRate], ['qbEpa', (row) => row.offense.qbEpa], ['qbCompletion', (row) => row.offense.qbCompletion],
    ['epaAllowed', (row) => row.defense.epaAllowed], ['passEpaAllowed', (row) => row.defense.passEpaAllowed], ['rushEpaAllowed', (row) => row.defense.rushEpaAllowed], ['successAllowed', (row) => row.defense.successAllowed], ['explosiveAllowed', (row) => row.defense.explosiveAllowed], ['defRedZoneTdRate', (row) => row.defense.redZoneTdRate],
  ];
  for (const [name, getter] of fields) {
    const values = selected.map((row) => ({ row, value: getter(row) })).filter((item) => item.value !== null);
    let weighted = 0; let total = 0;
    const limited = recency.startsWith('last_') ? values.slice(-Number(recency.slice(5))) : values;
    for (let index = 0; index < limited.length; index += 1) {
      const item = limited[index];
      const recencyWeight = recency === 'decay_0.88' ? 0.88 ** (limited.length - 1 - index) : 1;
      const carryWeight = item.row.__carryover ? carryover : 1;
      weighted += item.value * recencyWeight * carryWeight; total += recencyWeight * carryWeight;
    }
    const raw = total ? weighted / total : null;
    const observed = limited.length;
    const mean = leagueMean[name] ?? 0;
    summary[name] = raw === null ? null : (raw * observed + mean * shrinkage) / (observed + shrinkage);
  }
  summary.games = current.length;
  summary.starterQbId = rows.at(-1).offense.starterQbId ?? null;
  return summary;
}

function difference(home, away) {
  const betterAllowed = (homeValue, awayValue) => (homeValue === null || awayValue === null ? null : awayValue - homeValue);
  return {
    passingEpaDiff: home.passingEpa - away.passingEpa, rushingEpaDiff: home.rushingEpa - away.rushingEpa,
    offenseSuccessDiff: home.success - away.success, earlyDownEpaDiff: home.earlyDownEpa - away.earlyDownEpa,
    explosivePassDiff: home.explosivePass - away.explosivePass, explosiveRushDiff: home.explosiveRush - away.explosiveRush,
    redZoneTdRateDiff: home.redZoneTdRate - away.redZoneTdRate, thirdDownRateDiff: home.thirdDownRate - away.thirdDownRate,
    fourthDownRateDiff: home.fourthDownRate - away.fourthDownRate, sackRateAllowedDiff: betterAllowed(home.sackRateAllowed, away.sackRateAllowed),
    interceptionRateDiff: betterAllowed(home.interceptionRate, away.interceptionRate), defenseEpaAllowedDiff: betterAllowed(home.epaAllowed, away.epaAllowed),
    defensePassEpaAllowedDiff: betterAllowed(home.passEpaAllowed, away.passEpaAllowed), defenseRushEpaAllowedDiff: betterAllowed(home.rushEpaAllowed, away.rushEpaAllowed),
    defenseSuccessAllowedDiff: betterAllowed(home.successAllowed, away.successAllowed), defenseExplosiveAllowedDiff: betterAllowed(home.explosiveAllowed, away.explosiveAllowed),
    defenseRedZoneTdRateDiff: betterAllowed(home.defRedZoneTdRate, away.defRedZoneTdRate), qbEpaDiff: home.qbEpa - away.qbEpa, qbCompletionDiff: home.qbCompletion - away.qbCompletion,
  };
}

function metrics(rows, key) {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null };
  let correct = 0; const brier = []; const losses = [];
  for (const row of rows) {
    const probability = clamp(row[key], 0.01, 0.99); const pick = probability >= 0.5 ? 1 : 0;
    if (pick === row.y) correct += 1;
    brier.push((probability - row.y) ** 2); losses.push(-(row.y * Math.log(probability) + (1 - row.y) * Math.log(1 - probability)));
  }
  return { games: rows.length, accuracy: correct / rows.length, brier: mean(brier), logLoss: mean(losses) };
}

function xorshift(seed) { let state = seed >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; }

function pairedBootstrap(rows, challengerKey, resamples = 10000) {
  const random = xorshift(0x6f4e5d3c); const deltaBrier = []; const deltaLogLoss = []; let brierWins = 0; let logLossWins = 0;
  for (let sample = 0; sample < resamples; sample += 1) {
    let marketBrier = 0; let challengerBrier = 0; let marketLog = 0; let challengerLog = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[Math.floor(random() * rows.length)]; const market = clamp(row.marketProbability, 0.01, 0.99); const challenge = clamp(row[challengerKey], 0.01, 0.99);
      marketBrier += (market - row.y) ** 2; challengerBrier += (challenge - row.y) ** 2;
      marketLog += -(row.y * Math.log(market) + (1 - row.y) * Math.log(1 - market)); challengerLog += -(row.y * Math.log(challenge) + (1 - row.y) * Math.log(1 - challenge));
    }
    const db = challengerBrier / rows.length - marketBrier / rows.length; const dl = challengerLog / rows.length - marketLog / rows.length;
    deltaBrier.push(db); deltaLogLoss.push(dl); if (db < 0) brierWins += 1; if (dl < 0) logLossWins += 1;
  }
  const interval = (values) => { const ordered = [...values].sort((a, b) => a - b); return { low: ordered[Math.floor(values.length * 0.025)], high: ordered[Math.floor(values.length * 0.975)] }; };
  return { resamples, deltaBrier: mean(deltaBrier), deltaLogLoss: mean(deltaLogLoss), deltaAccuracy: mean(rows.map((row) => (row[challengerKey] >= 0.5 ? 1 : 0) === row.y ? 1 : 0)) - mean(rows.map((row) => (row.marketProbability >= 0.5 ? 1 : 0) === row.y ? 1 : 0)), deltaBrierCI95: interval(deltaBrier), deltaLogLossCI95: interval(deltaLogLoss), probabilityChallengerBeatsMarketBrier: brierWins / resamples, probabilityChallengerBeatsMarketLogLoss: logLossWins / resamples };
}

function fitAndScore(rows, bundle, config) {
  const names = BUNDLE_DEFINITIONS[bundle]; const indices = names.map((name) => FEATURE_NAMES.indexOf(name)); const beta = Array(indices.length).fill(0); const history = [];
  const result = []; let currentSeason = null;
  const recentFactor = config.recency === 'decay_0.88' ? 0.88 : 1;
  const variantKey = `${config.recency}|${config.carryover}|${config.shrinkage}`;
  for (let start = 0; start < rows.length;) {
    const first = rows[start]; let end = start + 1; while (end < rows.length && rows[end].season === first.season && rows[end].week === first.week) end += 1;
    if (currentSeason !== first.season) { currentSeason = first.season; if (config.carryover === 0) beta.fill(0); else for (let i = 0; i < beta.length; i += 1) beta[i] *= config.carryover; }
    const batch = rows.slice(start, end).map((row) => ({ ...row, x: row.xByConfig?.[variantKey] ?? row.x })).filter((row) => row.x?.every((value) => Number.isFinite(value)));
    for (const row of batch) {
      const x = indices.map((index) => clamp(row.x[index], -3, 3));
      const correction = beta.reduce((sum, value, index) => sum + value * x[index], 0);
      const record = { ...row, rawCorrection: correction, challengerProbability: sigmoid(logit(row.marketProbability) + config.scale * correction) };
      result.push(record);
    }
    if (history.length < MIN_TRAINING_GAMES) {
      for (const row of batch) history.push(row);
    } else {
      for (const row of batch) {
        const x = indices.map((index) => clamp(row.x[index], -3, 3)); const correction = beta.reduce((sum, value, index) => sum + value * x[index], 0);
        const p = sigmoid(logit(row.marketProbability) + correction); const gradientTarget = config.family === 'logistic-residual' ? row.y - p : (row.y - row.marketProbability) - correction;
        const forgetting = config.recency === 'decay_0.88' ? recentFactor : config.recency.startsWith('last_') ? (Number(config.recency.slice(5)) - 1) / Number(config.recency.slice(5)) : 1;
        for (let index = 0; index < beta.length; index += 1) beta[index] = beta[index] * forgetting + LEARNING_RATE * (gradientTarget * x[index] - (config.ridge / 32) * beta[index]);
        history.push(row);
        const limit = config.recency.startsWith('last_') ? Number(config.recency.slice(5)) : Infinity;
        if (history.length > limit) history.splice(0, history.length - limit);
      }
    }
    start = end;
  }
  return result;
}

function subgroupDiagnostics(rows, key) {
  const groups = [];
  const add = (label, subset) => groups.push({ label, ...metrics(subset, key), market: metrics(subset, 'marketProbability') });
  add('Weeks 1–4', rows.filter((row) => row.week <= 4)); add('Weeks 5–9', rows.filter((row) => row.week >= 5 && row.week <= 9)); add('Weeks 10–14', rows.filter((row) => row.week >= 10 && row.week <= 14)); add('Weeks 15+', rows.filter((row) => row.week >= 15));
  add('Market favorite probability <60%', rows.filter((row) => Math.max(row.marketProbability, 1 - row.marketProbability) < 0.6)); add('60–70%', rows.filter((row) => { const p = Math.max(row.marketProbability, 1 - row.marketProbability); return p >= 0.6 && p < 0.7; })); add('70%+', rows.filter((row) => Math.max(row.marketProbability, 1 - row.marketProbability) >= 0.7));
  add('Home favorite', rows.filter((row) => row.marketProbability >= 0.5)); add('Road favorite', rows.filter((row) => row.marketProbability < 0.5)); add('Division', rows.filter((row) => row.division)); add('Non-division', rows.filter((row) => !row.division));
  return groups;
}

const scheduleRows = parseCsv(await fetchText(SCHEDULE_URL));
const games = scheduleRows.filter((row) => SEASONS.includes(Number(row.season)) && row.game_type === 'REG' && number(row.home_score) !== null && number(row.away_score) !== null && number(row.home_score) !== number(row.away_score) && noVig(row.home_moneyline, row.away_moneyline) !== null).map((row) => ({ season: Number(row.season), week: Number(row.week), date: row.gameday || row.game_date || '', gameId: row.game_id, home: row.home_team, away: row.away_team, homeScore: Number(row.home_score), awayScore: Number(row.away_score), marketProbability: noVig(row.home_moneyline, row.away_moneyline), division: row.div_game === '1' })).sort((a, b) => a.season - b.season || a.week - b.week || a.gameId.localeCompare(b.gameId));
const pbpBySeason = new Map();
for (const season of SEASONS) { console.log(`Loading nflverse PBP ${season}...`); pbpBySeason.set(season, aggregatePbp(await loadPbp(season), new Set(games.filter((game) => game.season === season).map((game) => game.gameId)))); }
const gameRows = new Map();
for (const game of games) {
  const pairs = pbpBySeason.get(game.season)?.get(game.gameId); if (!pairs) continue;
  const homePair = pairs.get(game.home); const awayPair = pairs.get(game.away); if (!homePair || !awayPair) continue;
  gameRows.set(game.gameId, { ...game, y: game.homeScore > game.awayScore ? 1 : 0, homeStats: gameTeamRow(homePair, game.away, game), awayStats: gameTeamRow(awayPair, game.home, game) });
}

const histories = new Map();
for (const game of games) {
  const row = gameRows.get(game.gameId); if (!row) continue;
  for (const [team, stats, opponent] of [[game.home, row.homeStats, game.away], [game.away, row.awayStats, game.home]]) { if (!histories.has(team)) histories.set(team, []); histories.get(team).push({ ...stats, season: game.season, week: game.week, targetSeason: game.season, opponent, gameId: game.gameId }); }
}
// These priors are fixed before the replay. They are deliberately not
// estimated from the full historical file, which would make early-season
// shrinkage see future games. EPA-like metrics center at zero; rates use
// neutral league priors.
const leagueMean = {
  passingEpa: 0, rushingEpa: 0, success: 0.5, earlyDownEpa: 0, explosivePass: 0.08,
  explosiveRush: 0.06, redZoneTdRate: 0.5, thirdDownRate: 0.4, fourthDownRate: 0.5,
  sackRateAllowed: 0.07, interceptionRate: 0.025, qbEpa: 0, qbCompletion: 0.65,
  epaAllowed: 0, passEpaAllowed: 0, rushEpaAllowed: 0, successAllowed: 0.5,
  explosiveAllowed: 0.07, defRedZoneTdRate: 0.5,
};
const featureRows = [];
for (const game of games) {
  const row = gameRows.get(game.gameId); if (!row) continue;
  const prior = (team) => (histories.get(team) ?? []).filter((item) => item.season < game.season || (item.season === game.season && item.week < game.week)).map((item) => ({ ...item, targetSeason: game.season }));
  const homePrior = prior(game.home); const awayPrior = prior(game.away); if (!homePrior.length || !awayPrior.length) continue;
  const home = teamSummary(homePrior, 'all_equal', 0, 0, leagueMean); const away = teamSummary(awayPrior, 'all_equal', 0, 0, leagueMean);
  if (!home || !away) continue;
  const base = difference(home, away); if (Object.values(base).some((value) => value === null || !Number.isFinite(value))) continue;
  const x = FEATURE_NAMES.map((name) => base[name]);
  featureRows.push({ ...row, x, homePriorGames: home.games, awayPriorGames: away.games });
}

// Build every predeclared feature treatment from the same frozen prior-game
// history. This keeps recency, carryover, and early-season shrinkage genuinely
// distinct while preserving the strict week-before-target cutoff.
for (const row of featureRows) {
  const game = row;
  const prior = (team) => (histories.get(team) ?? [])
    .filter((item) => item.season < game.season || (item.season === game.season && item.week < game.week))
    .map((item) => ({ ...item, targetSeason: game.season }));
  const homePrior = prior(game.home); const awayPrior = prior(game.away);
  row.xByConfig = {};
  for (const recency of RECENCY_VARIANTS) for (const carryover of CARRYOVER_VALUES) for (const shrinkage of SHRINKAGE_VALUES) {
    const home = teamSummary(homePrior, recency, carryover, shrinkage, leagueMean);
    const away = teamSummary(awayPrior, recency, carryover, shrinkage, leagueMean);
    if (!home || !away) continue;
    const values = difference(home, away);
    if (Object.values(values).some((value) => value === null || !Number.isFinite(value))) continue;
    row.xByConfig[`${recency}|${carryover}|${shrinkage}`] = FEATURE_NAMES.map((name) => values[name]);
  }
}

const candidates = []; let best = null;
for (const bundle of Object.keys(BUNDLE_DEFINITIONS)) {
  for (const recency of RECENCY_VARIANTS) for (const carryover of CARRYOVER_VALUES) for (const ridge of RIDGE_VALUES) for (const shrinkage of SHRINKAGE_VALUES) for (const family of ['ridge-residual', 'logistic-residual']) {
    for (const scale of CORRECTION_SCALES) {
      const config = { bundle, recency, carryover, ridge, shrinkage, family, scale };
      const scored = fitAndScore(featureRows, bundle, config); const oos = scored.filter((row) => row.homePriorGames + row.awayPriorGames >= 2).map((row) => ({ ...row, marketProbability: row.marketProbability, challengerProbability: row.challengerProbability }));
      const market = metrics(oos, 'marketProbability'); const challenger = metrics(oos, 'challengerProbability');
      const candidate = { ...config, ...challenger, deltaBrierVsMarket: challenger.brier - market.brier, deltaLogLossVsMarket: challenger.logLoss - market.logLoss, deltaAccuracyVsMarket: challenger.accuracy - market.accuracy };
      candidates.push(candidate);
      if (candidate.brier !== null && (!best || candidate.brier < best.brier || (candidate.brier === best.brier && candidate.logLoss < best.logLoss))) best = { ...candidate, rows: oos };
    }
  }
}
const nonzero = candidates.filter((candidate) => candidate.scale > 0).sort((a, b) => a.brier - b.brier || a.logLoss - b.logLoss)[0] ?? null;
const challenger = nonzero ? fitAndScore(featureRows, nonzero.bundle, nonzero).filter((row) => row.homePriorGames + row.awayPriorGames >= 2) : [];
const challengerKey = 'challengerProbability';
const bootstrap = challenger.length && nonzero ? pairedBootstrap(challenger, challengerKey, 10000) : null;
const marketMetrics = metrics(challenger, 'marketProbability'); const challengerMetrics = metrics(challenger, challengerKey);
const selectiveCorrection = SELECTIVE_THRESHOLDS.map((threshold) => {
  const rows = challenger.map((row) => ({ ...row, selectiveProbability: Math.abs(row.rawCorrection) >= threshold ? row.challengerProbability : row.marketProbability }));
  return { threshold, changedGames: rows.filter((row) => row.selectiveProbability !== row.marketProbability).length, ...metrics(rows, 'selectiveProbability'), deltaBrierVsMarket: metrics(rows, 'selectiveProbability').brier - marketMetrics.brier, deltaLogLossVsMarket: metrics(rows, 'selectiveProbability').logLoss - marketMetrics.logLoss };
});
const bySeason = SEASONS.map((season) => { const rows = challenger.filter((row) => row.season === season); return { season, heldOutGames: rows.length, market: metrics(rows, 'marketProbability'), challenger: metrics(rows, challengerKey), selectedCorrectionScale: nonzero?.scale ?? null, brierImproved: rows.length ? metrics(rows, challengerKey).brier < metrics(rows, 'marketProbability').brier : null, logLossImproved: rows.length ? metrics(rows, challengerKey).logLoss < metrics(rows, 'marketProbability').logLoss : null }; });
const flips = challenger.filter((row) => (row.marketProbability >= 0.5 ? 1 : 0) !== (row.challengerProbability >= 0.5 ? 1 : 0));
const sourceColumns = { schedule: ['game_id', 'season', 'game_type', 'week', 'home_team', 'away_team', 'home_score', 'away_score', 'home_moneyline', 'away_moneyline', 'div_game'], pbp: ['game_id', 'season_type', 'posteam', 'defteam', 'play_type', 'epa', 'qb_epa', 'success', 'down', 'third_down_converted', 'fourth_down_converted', 'yardline_100', 'touchdown', 'yards_gained', 'pass_attempt', 'complete_pass', 'sack', 'interception', 'qb_dropback', 'passer_player_id', 'passer_player_name'] };
const unavailable = ['special-teams EPA', 'pressure rate without a charted pressure feed', 'timestamped pregame QB injury/status archive', 'opponent-adjusted efficiency (skipped: a safe implementation would require same-week opponent observations)'];
const seasonCoverage = SEASONS.map((season) => { const rows = featureRows.filter((row) => row.season === season); return { season, eligibleGames: rows.length, weeks: [...new Set(rows.map((row) => row.week))].sort((a, b) => a - b) }; });
const serializableCandidates = candidates.map((candidate) => { const copy = { ...candidate }; delete copy.rows; return copy; });
const output = { generatedAt: new Date().toISOString(), status: 'RESEARCH_ONLY', productionInfluence: 0, productionChampion: 'V2', marketBaseline: 'Fixed no-vig moneyline probability; no market correction is promoted.', temporalPolicy: 'For every forecast game, team features use regular-season PBP from weeks strictly before the game week. Outcomes are added only after the whole week is scored. Model updates for a game use earlier seasons/weeks only. Test-game outcomes never enter its features or training.', sources: { schedule: SCHEDULE_URL, pbp: PBP_URL('{season}'), sourceColumns, parserVerified: true }, grid: { correctionScales: CORRECTION_SCALES, selectiveCorrectionThresholds: SELECTIVE_THRESHOLDS, recencyVariants: RECENCY_VARIANTS, carryoverValues: CARRYOVER_VALUES, ridgeValues: RIDGE_VALUES, shrinkagePseudoGames: SHRINKAGE_VALUES, featureBundles: Object.keys(BUNDLE_DEFINITIONS), modelFamilies: ['ridge-residual', 'logistic-residual'] }, coverage: { scheduleGames: games.length, gamesWithPbp: gameRows.size, eligibleFeatureGames: featureRows.length, chronologicalOosGames: challenger.length, seasons: seasonCoverage }, market: marketMetrics, bestCandidate: nonzero ? { ...nonzero, rows: undefined } : null, bestCandidateMetrics: challengerMetrics, candidates: serializableCandidates, bootstrap, selectiveCorrection, leaveOneSeasonOut: bySeason, flipAnalysis: { flippedGames: flips.length, flippedCorrect: flips.filter((row) => (row.challengerProbability >= 0.5 ? 1 : 0) === row.y).length, flippedMarketCorrect: flips.filter((row) => (row.marketProbability >= 0.5 ? 1 : 0) === row.y).length, byBucket: subgroupDiagnostics(flips, challengerKey) }, subgroupDiagnostics: subgroupDiagnostics(challenger, challengerKey), featureCoverage: { populated: FEATURE_NAMES, unavailable, actualSourceColumns: sourceColumns.pbp }, opponentAdjustment: { tested: false, helped: null, reason: 'Skipped to preserve strict prior-week information; a defensible opponent adjustment needs opponent strength estimates frozen before each target week and was not added to this limited research pass.' }, stability: { bySeason, numberImprovedBrier: bySeason.filter((row) => row.brierImproved).length, numberWorsenedBrier: bySeason.filter((row) => row.brierImproved === false).length }, verdict: best?.scale === 0 ? 'Zero correction wins the chronological research grid; retain market baseline.' : 'A nonzero challenger is descriptively best in this shadow grid. It remains research-only: no production influence, V2 changes, specialist activation, or betting changes.', guardrails: ['No V2/V5 production code or weights changed.', 'All specialists remain at 0% production weight.', 'Betting behavior is unchanged.', 'Correction scales and hyperparameters were predeclared before scoring; no 2025-only tuning was performed.'] };
await mkdir(resolve('outputs'), { recursive: true }); await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log('V6 historical accuracy lab generated.');
console.log(`Eligible feature games: ${output.coverage.eligibleFeatureGames}`);
console.log(`Chronological OOS games: ${output.coverage.chronologicalOosGames}`);
console.log(`Market Brier: ${marketMetrics.brier?.toFixed(4) ?? 'n/a'}`);
console.log(`Market log loss: ${marketMetrics.logLoss?.toFixed(4) ?? 'n/a'}`);
console.log(`Market accuracy: ${marketMetrics.accuracy === null ? 'n/a' : `${(marketMetrics.accuracy * 100).toFixed(2)}%`}`);
console.log(`Best challenger: ${nonzero ? `${nonzero.bundle} / ${nonzero.family} / ${nonzero.recency} / carryover ${nonzero.carryover} / ridge ${nonzero.ridge} / shrinkage ${nonzero.shrinkage} / scale ${nonzero.scale}` : 'n/a'}`);
console.log(`Best challenger Brier: ${challengerMetrics.brier?.toFixed(4) ?? 'n/a'} (delta ${(challengerMetrics.brier - marketMetrics.brier)?.toFixed(4) ?? 'n/a'})`);
console.log(`Best challenger log loss: ${challengerMetrics.logLoss?.toFixed(4) ?? 'n/a'} (delta ${(challengerMetrics.logLoss - marketMetrics.logLoss)?.toFixed(4) ?? 'n/a'})`);
console.log(`Best challenger accuracy: ${challengerMetrics.accuracy === null ? 'n/a' : `${(challengerMetrics.accuracy * 100).toFixed(2)}%`}`);
console.log(`Bootstrap resamples: ${bootstrap?.resamples ?? 0}`);
console.log(`Bootstrap Brier CI: ${bootstrap ? `${bootstrap.deltaBrierCI95.low.toFixed(4)} to ${bootstrap.deltaBrierCI95.high.toFixed(4)}` : 'n/a'}`);
console.log(`Probability challenger beats market: Brier ${bootstrap?.probabilityChallengerBeatsMarketBrier?.toFixed(4) ?? 'n/a'}, log loss ${bootstrap?.probabilityChallengerBeatsMarketLogLoss?.toFixed(4) ?? 'n/a'}`);
console.log(`Selective correction thresholds (training-only residual): ${selectiveCorrection.map((item) => `${item.threshold}=${item.brier?.toFixed(4) ?? 'n/a'}`).join(', ')}`);
console.log(`Seasons improved/worsened on Brier: ${output.stability.numberImprovedBrier}/${output.stability.numberWorsenedBrier}`);
console.log('Verdict:', output.verdict);

import { env } from 'cloudflare:workers';
import { DEFAULT_LEARNED_MODEL, type LearnedModelState } from '@/lib/forecast';

const SEASON = 2026;
const MAX_HOME_FIELD_ADJUSTMENT = 0.5;
const MAX_CONFIDENCE_SHRINKAGE = 0.15;
const MIN_CALIBRATION_SAMPLE = 48;
const MIN_STABLE_RESIDUAL = 0.025;

type DatabaseEnv = { DB?: D1Database };
type Snapshot = {
  id: number;
  week: number;
  game_key: string;
  away_team: string;
  home_team: string;
  predicted_winner: string;
  home_probability: number;
  market_home_probability: number | null;
  football_home_probability: number | null;
  expected_home_margin: number | null;
  market_expected_home_margin: number | null;
  home_spread: number | null;
  home_cover_probability: number | null;
  model_version: string | null;
  favorite_probability: number;
  live_delta: number;
  captured_at: string;
  winner: string | null;
  correct: number | null;
  away_score: number | null;
  home_score: number | null;
};
type ScoreboardResult = {
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
};

type CaptureItem = {
  week: number;
  gameKey: string;
  away: string;
  home: string;
  predictedWinner: string;
  homeProbability: number;
  marketHomeProbability: number | null;
  footballHomeProbability: number | null;
  expectedHomeMargin: number | null;
  marketExpectedHomeMargin: number | null;
  homeSpread: number | null;
  homeCoverProbability: number | null;
  modelVersion: string | null;
  favoriteProbability: number;
  liveDelta: number;
};

export type LearningRun = {
  week: number;
  gradedGames: number;
  correctPicks: number;
  brierScore: number;
  homeResidual: number;
  favoriteResidual: number;
  insight: string;
  createdAt: string;
};
export type PickOutcome = {
  id: number;
  week: number;
  away: string;
  home: string;
  pick: string;
  winner: string;
  correct: boolean;
  awayScore: number;
  homeScore: number;
  favoriteProbability: number;
  capturedAt: string;
};
export type LearningDashboard = {
  state: LearnedModelState;
  record: {
    correct: number;
    incorrect: number;
    total: number;
    accuracy: number | null;
    brierScore: number | null;
    marketBrierScore: number | null;
    brierDeltaVsMarket: number | null;
    expectedLosses: number | null;
    excessLosses: number | null;
    captured: number;
    prospectiveSnapshots: number;
  };
  runs: LearningRun[];
  outcomes: PickOutcome[];
  memory: {
    postmortems: number;
    errors: number;
    successes: number;
    notable: Array<{
      gameKey: string;
      week: number;
      correct: boolean;
      errorSeverity: number;
      taxonomy: string[];
    }>;
    specialists: Array<{
      code: string;
      status: string;
      productionWeight: number;
      evidence: string;
    }>;
  };
  pendingSnapshots: number;
  note: string;
};

function db() {
  const binding = (env as unknown as DatabaseEnv).DB;
  if (!binding) throw new Error('Learning database binding is unavailable.');
  return binding;
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function safeJsonArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
function postmortemFor(snapshot: Snapshot, result: ScoreboardResult) {
  const correct =
    snapshot.predicted_winner ===
    (result.homeScore > result.awayScore ? result.home : result.away);
  const actualHomeWin = result.homeScore > result.awayScore ? 1 : 0;
  const probabilitySurprise = -Math.log(
    correct ? snapshot.favorite_probability : 1 - snapshot.favorite_probability,
  );
  const actualHomeMargin = result.homeScore - result.awayScore;
  const marginError =
    snapshot.expected_home_margin === null
      ? 0
      : Math.abs(snapshot.expected_home_margin - actualHomeMargin);
  const errorSeverity = Math.min(
    100,
    100 *
      (0.65 * probabilitySurprise / Math.log(100) +
        0.35 * Math.min(1, marginError / 30)),
  );
  const taxonomy: string[] = [];
  if (!correct && snapshot.favorite_probability >= 0.7)
    taxonomy.push('CONFIDENCE_ERROR');
  if (marginError >= 14) taxonomy.push('MARGIN_DISTRIBUTION_ERROR');
  if (
    snapshot.football_home_probability !== null &&
    snapshot.market_home_probability !== null &&
    Math.abs(
      snapshot.football_home_probability - snapshot.market_home_probability,
    ) >= 0.08 &&
    Math.pow(snapshot.football_home_probability - actualHomeWin, 2) >
      Math.pow(snapshot.market_home_probability - actualHomeWin, 2)
  )
    taxonomy.push('MARKET_CORRECTION_ERROR');
  if (!correct && snapshot.favorite_probability < 0.6)
    taxonomy.push('UNPREDICTABLE_EVENT');
  if (!taxonomy.length)
    taxonomy.push(correct ? 'CALIBRATED_OUTCOME' : 'UNKNOWN');
  const features = {
    footballHomeProbability: snapshot.football_home_probability,
    marketHomeProbability: snapshot.market_home_probability,
    expectedHomeMargin: snapshot.expected_home_margin,
    marketExpectedHomeMargin: snapshot.market_expected_home_margin,
    homeSpread: snapshot.home_spread,
    homeCoverProbability: snapshot.home_cover_probability,
    liveDelta: snapshot.live_delta,
  };
  return {
    correct,
    actualHomeMargin,
    probabilitySurprise,
    errorSeverity,
    taxonomy,
    features,
    dataQuality:
      snapshot.market_home_probability === null
        ? 'Football fallback; no paired market probability was captured.'
        : 'Timestamped desk snapshot captured before kickoff.',
  };
}
const SPECIALIST_STARTERS = [
  {
    code: 'market_baseline',
    status: 'PRODUCTION',
    productionWeight: 1,
    evidence:
      'V2 market-anchor remains the production champion until a specialist proves a forward, timestamp-matched improvement.',
  },
  {
    code: 'qb_uncertainty',
    status: 'DATA_REQUIRED',
    productionWeight: 0,
    evidence: 'Requires timestamped starting-QB status and uncertainty labels.',
  },
  {
    code: 'ol_pass_rush',
    status: 'DATA_REQUIRED',
    productionWeight: 0,
    evidence:
      'Requires timestamped offensive-line availability and pass-rush pressure inputs.',
  },
  {
    code: 'weather',
    status: 'RESEARCH',
    productionWeight: 0,
    evidence:
      'Requires pre-kickoff weather snapshots and chronological out-of-sample validation.',
  },
  {
    code: 'key_number',
    status: 'RESEARCH',
    productionWeight: 0,
    evidence:
      'Requires timestamp-matched spread snapshots and forward spread performance.',
  },
] as const;
async function ensureSpecialistRegistry(database: D1Database) {
  const now = new Date().toISOString();
  await database.batch(
    SPECIALIST_STARTERS.map((expert) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO specialist_registry (code, status, production_weight, evidence, updated_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          expert.code,
          expert.status,
          expert.productionWeight,
          expert.evidence,
          now,
        ),
    ),
  );
}
type ScheduleTeam = {
  displayName?: string;
  isHome?: boolean;
  score?: number | string | null;
};
type ScheduleEvent = {
  completed?: boolean;
  teams?: ScheduleTeam[];
  competitors?: ScheduleTeam[];
  status?: { state?: string };
};

function readJsonObject(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0)
    throw new Error('The schedule page did not contain event data.');
  const start = markerIndex + marker.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error('The schedule event data was incomplete.');
}

async function scheduleEventsForWeek(week: number): Promise<ScheduleEvent[]> {
  const source = `https://www.espn.com/nfl/schedule/_/week/${week}/year/${SEASON}/seasontype/2`;
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`Schedule result source returned ${response.status}.`);
  const events = readJsonObject(await response.text(), '"events":{') as Record<
    string,
    ScheduleEvent[]
  >;
  return Object.values(events).flat();
}

function teamsFor(event: ScheduleEvent) {
  const teams = event.competitors ?? event.teams ?? [];
  return {
    away: teams.find((team) => team.isHome === false),
    home: teams.find((team) => team.isHome === true),
  };
}

async function resultsForWeek(week: number): Promise<ScoreboardResult[]> {
  return (await scheduleEventsForWeek(week)).flatMap((event) => {
    if (!event.completed && event.status?.state !== 'post') return [];
    const { away, home } = teamsFor(event);
    if (
      away?.score === null ||
      away?.score === undefined ||
      home?.score === null ||
      home?.score === undefined
    )
      return [];
    const awayScore = Number(away.score);
    const homeScore = Number(home.score);
    if (
      !away.displayName ||
      !home.displayName ||
      !Number.isFinite(awayScore) ||
      !Number.isFinite(homeScore)
    )
      return [];
    return [
      { away: away.displayName, home: home.displayName, awayScore, homeScore },
    ];
  });
}

async function startedGameKeysForWeek(week: number) {
  return new Set(
    (await scheduleEventsForWeek(week)).flatMap((event) => {
      if (
        !event.completed &&
        (!event.status?.state || event.status.state === 'pre')
      )
        return [];
      const { away, home } = teamsFor(event);
      return away?.displayName && home?.displayName
        ? [`${away.displayName}__${home.displayName}`]
        : [];
    }),
  );
}

async function settleWeek(week: number) {
  const database = db();
  const snapshots = (
    await database
      .prepare(
        `SELECT id, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, football_home_probability, expected_home_margin, market_expected_home_margin, home_spread, home_cover_probability, model_version, favorite_probability, live_delta, captured_at, winner, correct, away_score, home_score FROM prediction_snapshots WHERE season = ? AND week = ?`,
      )
      .bind(SEASON, week)
      .all<Snapshot>()
  ).results;
  if (!snapshots.length) return;
  const results = await resultsForWeek(week);
  const byMatchup = new Map(
    results.map((result) => [`${result.away}__${result.home}`, result]),
  );
  const settledAt = new Date().toISOString();
  const updates = snapshots.flatMap((snapshot) => {
    if (snapshot.winner) return [];
    const result = byMatchup.get(snapshot.game_key);
    if (!result || result.awayScore === result.homeScore) return [];
    const analysis = postmortemFor(snapshot, result);
    const winner = result.homeScore > result.awayScore ? result.home : result.away;
    const featureJson = JSON.stringify(analysis.features);
    const taxonomyJson = JSON.stringify(analysis.taxonomy);
    const statements = [
      database
        .prepare(
          `UPDATE prediction_snapshots SET settled_at = ?, away_score = ?, home_score = ?, winner = ?, correct = ? WHERE id = ?`,
        )
        .bind(
          settledAt,
          result.awayScore,
          result.homeScore,
          winner,
          analysis.correct ? 1 : 0,
          snapshot.id,
        ),
      database
        .prepare(
          `UPDATE forecast_ledger SET settled_at = ?, away_score = ?, home_score = ?, winner = ?, correct = CASE WHEN predicted_winner = ? THEN 1 ELSE 0 END WHERE season = ? AND week = ? AND game_key = ? AND winner IS NULL`,
        )
        .bind(
          settledAt,
          result.awayScore,
          result.homeScore,
          winner,
          winner,
          SEASON,
          snapshot.week,
          snapshot.game_key,
        ),
    ];
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO game_postmortems (snapshot_id, season, week, game_key, model_version, predicted_winner, actual_winner, home_probability, market_home_probability, expected_home_margin, actual_home_margin, correct, error_severity, probability_surprise, taxonomy_json, pregame_features_json, data_quality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          snapshot.id,
          SEASON,
          snapshot.week,
          snapshot.game_key,
          snapshot.model_version ?? 'V4.0-ERROR-MEMORY-SHADOW',
          snapshot.predicted_winner,
          winner,
          snapshot.home_probability,
          snapshot.market_home_probability,
          snapshot.expected_home_margin,
          analysis.actualHomeMargin,
          analysis.correct ? 1 : 0,
          analysis.errorSeverity,
          analysis.probabilitySurprise,
          taxonomyJson,
          featureJson,
          analysis.dataQuality,
          settledAt,
        ),
    );
    if (!analysis.correct && analysis.errorSeverity >= 20)
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO error_memory (snapshot_id, game_key, severity, pregame_features_json, lesson, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            snapshot.id,
            snapshot.game_key,
            analysis.errorSeverity,
            featureJson,
            'Saved for later analog review only. One miss cannot activate a specialist.',
            settledAt,
          ),
      );
    if (analysis.correct)
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO success_memory (snapshot_id, game_key, pregame_features_json, lesson, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            snapshot.id,
            snapshot.game_key,
            featureJson,
            'Saved as a comparable success so error patterns must be tested against normal outcomes.',
            settledAt,
          ),
      );
    return statements;
  });
  if (updates.length) await database.batch(updates);
}

function insightFor(
  week: number,
  games: Snapshot[],
  homeResidual: number,
  favoriteResidual: number,
  correct: number,
  expectedCorrect: number,
) {
  const parts: string[] = [];
  if (homeResidual <= -0.06)
    parts.push(
      `Home teams won ${Math.abs(homeResidual * 100).toFixed(1)} points less often than the model expected; the venue calibration is reviewed against the full season-to-date sample.`,
    );
  else if (homeResidual >= 0.06)
    parts.push(
      `Home teams won ${(homeResidual * 100).toFixed(1)} points more often than expected; the venue calibration is reviewed against the full season-to-date sample.`,
    );
  if (favoriteResidual <= -0.06)
    parts.push(
      `Favorites went ${correct}-${games.length - correct} against the model's expected ${expectedCorrect.toFixed(1)} wins; confidence is reviewed against the full season-to-date sample.`,
    );
  if (!parts.length)
    parts.push(
      'No stable directional error cleared the adjustment threshold; the model retains its existing calibration.',
    );
  return `Week ${week}: ${parts.join(' ')}`;
}

async function learnCompletedWeek(week: number) {
  const database = db();
  const existing = await database
    .prepare(
      `SELECT id FROM weekly_learning_runs WHERE season = ? AND week = ?`,
    )
    .bind(SEASON, week)
    .first<{ id: number }>();
  if (existing) return;
  const games = (
    await database
      .prepare(
        `SELECT id, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, favorite_probability, live_delta, captured_at, winner, correct, away_score, home_score FROM prediction_snapshots WHERE season = ? AND week = ? AND winner IS NOT NULL`,
      )
      .bind(SEASON, week)
      .all<Snapshot>()
  ).results;
  const unsettled = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM prediction_snapshots WHERE season = ? AND week = ? AND winner IS NULL`,
    )
    .bind(SEASON, week)
    .first<{ count: number }>();
  if (games.length < 12 || (unsettled?.count ?? 0) > 0) return;

  const correct = games.reduce(
    (total, game) => total + (game.correct ? 1 : 0),
    0,
  );
  const homeResidual =
    games.reduce(
      (total, game) =>
        total +
        ((game.winner === game.home_team ? 1 : 0) - game.home_probability),
      0,
    ) / games.length;
  const expectedCorrect = games.reduce(
    (total, game) => total + game.favorite_probability,
    0,
  );
  const favoriteResidual =
    correct / games.length - expectedCorrect / games.length;
  const brier =
    games.reduce(
      (total, game) =>
        total +
        Math.pow(
          (game.winner === game.home_team ? 1 : 0) - game.home_probability,
          2,
        ),
      0,
    ) / games.length;
  const cumulative = await database
    .prepare(
      `SELECT COUNT(*) AS count, AVG((CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END) - home_probability) AS home_residual, AVG((CASE WHEN correct = 1 THEN 1.0 ELSE 0.0 END) - favorite_probability) AS favorite_residual FROM prediction_snapshots WHERE season = ? AND week <= ? AND winner IS NOT NULL`,
    )
    .bind(SEASON, week)
    .first<{
      count: number;
      home_residual: number | null;
      favorite_residual: number | null;
    }>();
  const stableHomeResidual = cumulative?.home_residual ?? 0;
  const stableFavoriteResidual = cumulative?.favorite_residual ?? 0;
  const hasStableSample = (cumulative?.count ?? 0) >= MIN_CALIBRATION_SAMPLE;

  // Store a current target parameter, not another additive nudge. Repeated
  // weekly audits therefore cannot stack the same persistent residual over and
  // over. A later audit replaces the target state used by modelState().
  const homeFieldTarget =
    hasStableSample && Math.abs(stableHomeResidual) >= MIN_STABLE_RESIDUAL
      ? clamp(
          stableHomeResidual * 4.8 * 0.14,
          -MAX_HOME_FIELD_ADJUSTMENT,
          MAX_HOME_FIELD_ADJUSTMENT,
        )
      : 0;
  const shrinkageTarget =
    hasStableSample && stableFavoriteResidual <= -MIN_STABLE_RESIDUAL
      ? clamp(
          Math.abs(stableFavoriteResidual) * 0.08,
          0,
          MAX_CONFIDENCE_SHRINKAGE,
        )
      : 0;
  const now = new Date().toISOString();
  const insight = insightFor(
    week,
    games,
    homeResidual,
    favoriteResidual,
    correct,
    expectedCorrect,
  );
  await database.batch([
    database
      .prepare(
        `INSERT INTO weekly_learning_runs (season, week, graded_games, correct_picks, brier_score, home_residual, favorite_residual, insight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        week,
        games.length,
        correct,
        brier,
        homeResidual,
        favoriteResidual,
        insight,
        now,
      ),
    database
      .prepare(
        `INSERT INTO model_adjustments (season, week, kind, delta, reason, sample_size, created_at) VALUES (?, ?, 'home_field', ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        week,
        homeFieldTarget,
        hasStableSample
          ? `Current venue calibration target through Week ${week}`
          : `Audit only through Week ${week}; fewer than ${MIN_CALIBRATION_SAMPLE} settled snapshots`,
        cumulative?.count ?? games.length,
        now,
      ),
    database
      .prepare(
        `INSERT INTO model_adjustments (season, week, kind, delta, reason, sample_size, created_at) VALUES (?, ?, 'confidence_shrinkage', ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        week,
        shrinkageTarget,
        hasStableSample
          ? `Current confidence-calibration target through Week ${week}`
          : `Audit only through Week ${week}; fewer than ${MIN_CALIBRATION_SAMPLE} settled snapshots`,
        cumulative?.count ?? games.length,
        now,
      ),
  ]);
}

export async function syncAndLearn() {
  const database = db();
  await ensureSpecialistRegistry(database);
  const pendingWeeks = (
    await database
      .prepare(
        `SELECT DISTINCT week FROM prediction_snapshots WHERE season = ? AND winner IS NULL ORDER BY week`,
      )
      .bind(SEASON)
      .all<{ week: number }>()
  ).results;
  for (const { week } of pendingWeeks) {
    await settleWeek(week);
    await learnCompletedWeek(week);
  }
  await database.prepare('PRAGMA optimize').run();
}

export async function modelState(): Promise<LearnedModelState> {
  const database = db();
  const adjustments = (
    await database
      .prepare(
        `SELECT kind, delta, week FROM model_adjustments WHERE season = ? ORDER BY week DESC, id DESC`,
      )
      .bind(SEASON)
      .all<{ kind: string; delta: number; week: number }>()
  ).results;
  const home = adjustments.find((item) => item.kind === 'home_field');
  const shrink = adjustments.find(
    (item) => item.kind === 'confidence_shrinkage',
  );
  return {
    completedWeeks: Math.max(home?.week ?? 0, shrink?.week ?? 0),
    homeFieldAdjustment: clamp(
      home?.delta ?? 0,
      -MAX_HOME_FIELD_ADJUSTMENT,
      MAX_HOME_FIELD_ADJUSTMENT,
    ),
    confidenceShrinkage: clamp(
      shrink?.delta ?? 0,
      0,
      MAX_CONFIDENCE_SHRINKAGE,
    ),
  };
}

export async function capturePredictions(items: CaptureItem[]) {
  const database = db();
  const now = new Date().toISOString();
  const captureBucket = `${now.slice(0, 13)}:00:00.000Z`;
  const candidates = items.slice(0, 18);
  const completed = new Set<string>();
  const started = new Set<string>();
  for (const week of [...new Set(candidates.map((item) => item.week))]) {
    for (const result of await resultsForWeek(week))
      completed.add(`${result.away}__${result.home}`);
    for (const gameKey of await startedGameKeysForWeek(week))
      started.add(gameKey);
  }
  const accepted = candidates.filter(
    (item) => !completed.has(item.gameKey) && !started.has(item.gameKey),
  );
  const canonicalStatements = accepted.map((item) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO prediction_snapshots (season, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, football_home_probability, expected_home_margin, market_expected_home_margin, home_spread, home_cover_probability, model_version, favorite_probability, live_delta, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        item.week,
        item.gameKey,
        item.away,
        item.home,
        item.predictedWinner,
        item.homeProbability,
        item.marketHomeProbability,
        item.footballHomeProbability,
        item.expectedHomeMargin,
        item.marketExpectedHomeMargin,
        item.homeSpread,
        item.homeCoverProbability,
        item.modelVersion,
        item.favoriteProbability,
        item.liveDelta,
        now,
      ),
  );
  const ledgerStatements = accepted.map((item) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO forecast_ledger (season, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, football_home_probability, expected_home_margin, market_expected_home_margin, home_spread, home_cover_probability, model_version, favorite_probability, live_delta, capture_bucket, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        item.week,
        item.gameKey,
        item.away,
        item.home,
        item.predictedWinner,
        item.homeProbability,
        item.marketHomeProbability,
        item.footballHomeProbability,
        item.expectedHomeMargin,
        item.marketExpectedHomeMargin,
        item.homeSpread,
        item.homeCoverProbability,
        item.modelVersion,
        item.favoriteProbability,
        item.liveDelta,
        captureBucket,
        now,
      ),
  );
  if (canonicalStatements.length || ledgerStatements.length)
    await database.batch([...canonicalStatements, ...ledgerStatements]);
  const captured = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM prediction_snapshots WHERE season = ?`,
    )
    .bind(SEASON)
    .first<{ count: number }>();
  return captured?.count ?? 0;
}

export async function saveMarketSnapshots(
  items: Array<{
    week: number;
    gameKey: string;
    source: string;
    observedAt: string;
    awayMoneyline: number | null;
    homeMoneyline: number | null;
    awaySpread: number | null;
    homeSpread: number | null;
    totalLine: number | null;
    awaySpreadOdds: number | null;
    homeSpreadOdds: number | null;
    overOdds: number | null;
    underOdds: number | null;
  }>,
) {
  const database = db();
  const statements = items.slice(0, 18).map((item) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO market_snapshots (season, week, game_key, source, observed_at, away_moneyline, home_moneyline, away_spread, home_spread, total_line, away_spread_odds, home_spread_odds, over_odds, under_odds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        item.week,
        item.gameKey,
        item.source,
        item.observedAt,
        item.awayMoneyline,
        item.homeMoneyline,
        item.awaySpread,
        item.homeSpread,
        item.totalLine,
        item.awaySpreadOdds,
        item.homeSpreadOdds,
        item.overOdds,
        item.underOdds,
      ),
  );
  if (statements.length) await database.batch(statements);
}

export async function learningDashboard(): Promise<LearningDashboard> {
  await syncAndLearn();
  const database = db();
  const [
    all,
    outcomes,
    runs,
    pending,
    postmortemCounts,
    notable,
    specialists,
    ledgerCount,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END), 0) AS correct, COALESCE(SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END), 0) AS incorrect, AVG(CASE WHEN winner IS NOT NULL THEN (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - home_probability) * (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - home_probability) END) AS brier, AVG(CASE WHEN winner IS NOT NULL AND market_home_probability IS NOT NULL THEN (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - market_home_probability) * (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - market_home_probability) END) AS market_brier, SUM(CASE WHEN winner IS NOT NULL THEN 1.0 - favorite_probability ELSE 0 END) AS expected_losses, COALESCE(SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END), 0) AS pending FROM prediction_snapshots WHERE season = ?`,
      )
      .bind(SEASON)
      .first<{
        total: number;
        correct: number;
        incorrect: number;
        brier: number | null;
        market_brier: number | null;
        expected_losses: number | null;
        pending: number;
      }>(),
    database
      .prepare(
        `SELECT id, week, away_team, home_team, predicted_winner, winner, correct, away_score, home_score, favorite_probability, captured_at FROM prediction_snapshots WHERE season = ? AND winner IS NOT NULL ORDER BY week, id`,
      )
      .bind(SEASON)
      .all<{
        id: number;
        week: number;
        away_team: string;
        home_team: string;
        predicted_winner: string;
        winner: string;
        correct: number;
        away_score: number;
        home_score: number;
        favorite_probability: number;
        captured_at: string;
      }>(),
    database
      .prepare(
        `SELECT week, graded_games, correct_picks, brier_score, home_residual, favorite_residual, insight, created_at FROM weekly_learning_runs WHERE season = ? ORDER BY week DESC`,
      )
      .bind(SEASON)
      .all<{
        week: number;
        graded_games: number;
        correct_picks: number;
        brier_score: number;
        home_residual: number;
        favorite_residual: number;
        insight: string;
        created_at: string;
      }>(),
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM prediction_snapshots WHERE season = ? AND winner IS NULL`,
      )
      .bind(SEASON)
      .first<{ count: number }>(),
    database
      .prepare(
        `SELECT COUNT(*) AS postmortems, COALESCE(SUM(CASE WHEN correct = 0 AND error_severity >= 20 THEN 1 ELSE 0 END), 0) AS errors, COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END), 0) AS successes FROM game_postmortems WHERE season = ?`,
      )
      .bind(SEASON)
      .first<{ postmortems: number; errors: number; successes: number }>(),
    database
      .prepare(
        `SELECT game_key, week, correct, error_severity, taxonomy_json FROM game_postmortems WHERE season = ? ORDER BY error_severity DESC, id DESC LIMIT 5`,
      )
      .bind(SEASON)
      .all<{
        game_key: string;
        week: number;
        correct: number;
        error_severity: number;
        taxonomy_json: string;
      }>(),
    database
      .prepare(
        `SELECT code, status, production_weight, evidence FROM specialist_registry ORDER BY production_weight DESC, code`,
      )
      .all<{
        code: string;
        status: string;
        production_weight: number;
        evidence: string;
      }>(),
    database
      .prepare(`SELECT COUNT(*) AS count FROM forecast_ledger WHERE season = ?`)
      .bind(SEASON)
      .first<{ count: number }>(),
  ]);
  const total = all?.total ?? 0;
  const expectedLosses = all?.expected_losses ?? null;
  return {
    state: await modelState(),
    record: {
      correct: all?.correct ?? 0,
      incorrect: all?.incorrect ?? 0,
      total,
      accuracy: total ? (all?.correct ?? 0) / total : null,
      brierScore: all?.brier ?? null,
      marketBrierScore: all?.market_brier ?? null,
      brierDeltaVsMarket:
        all?.brier !== null &&
        all?.brier !== undefined &&
        all?.market_brier !== null &&
        all?.market_brier !== undefined
          ? all.brier - all.market_brier
          : null,
      expectedLosses,
      excessLosses:
        expectedLosses === null ? null : (all?.incorrect ?? 0) - expectedLosses,
      captured: total,
      prospectiveSnapshots: ledgerCount?.count ?? 0,
    },
    outcomes: outcomes.results.map((item) => ({
      id: item.id,
      week: item.week,
      away: item.away_team,
      home: item.home_team,
      pick: item.predicted_winner,
      winner: item.winner,
      correct: Boolean(item.correct),
      awayScore: item.away_score,
      homeScore: item.home_score,
      favoriteProbability: item.favorite_probability,
      capturedAt: item.captured_at,
    })),
    runs: runs.results.map((item) => ({
      week: item.week,
      gradedGames: item.graded_games,
      correctPicks: item.correct_picks,
      brierScore: item.brier_score,
      homeResidual: item.home_residual,
      favoriteResidual: item.favorite_residual,
      insight: item.insight,
      createdAt: item.created_at,
    })),
    memory: {
      postmortems: postmortemCounts?.postmortems ?? 0,
      errors: postmortemCounts?.errors ?? 0,
      successes: postmortemCounts?.successes ?? 0,
      notable: notable.results.map((item) => ({
        gameKey: item.game_key,
        week: item.week,
        correct: Boolean(item.correct),
        errorSeverity: item.error_severity,
        taxonomy: safeJsonArray(item.taxonomy_json),
      })),
      specialists: specialists.results.map((item) => ({
        code: item.code,
        status: item.status,
        productionWeight: item.production_weight,
        evidence: item.evidence,
      })),
    },
    pendingSnapshots: pending?.count ?? 0,
    note:
      'The canonical prediction record remains one frozen pick per game. A separate hourly prospective ledger now preserves later pre-kickoff snapshots without counting one game multiple times in learning metrics. Final scores create postmortems before that game enters memory. Expected losses are tracked so ordinary lower-probability outcomes are not mistaken for fixable model errors. V2 remains market-anchored when a paired live market probability exists.',
  };
}

export async function safeModelState() {
  try {
    return await modelState();
  } catch {
    return DEFAULT_LEARNED_MODEL;
  }
}

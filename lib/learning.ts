import { env } from 'cloudflare:workers';
import { DEFAULT_LEARNED_MODEL, type LearnedModelState } from '@/lib/forecast';

const SEASON = 2026;
const MAX_HOME_EDGE_STEP = 0.15;
const MAX_SHRINK_STEP = 0.04;

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
    captured: number;
  };
  runs: LearningRun[];
  outcomes: PickOutcome[];
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
function isoDay(day: Date) {
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

function weekDates(week: number) {
  const start = new Date(Date.UTC(2026, 8, 9 + (week - 1) * 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${isoDay(start)}-${isoDay(end)}`;
}

async function resultsForWeek(week: number): Promise<ScoreboardResult[]> {
  const source = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${weekDates(week)}&limit=100`;
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`Results feed returned ${response.status}.`);
  const body = (await response.json()) as {
    events?: Array<{
      status?: { type?: { completed?: boolean } };
      competitions?: Array<{
        competitors?: Array<{
          homeAway?: string;
          team?: { displayName?: string };
          score?: string;
        }>;
      }>;
    }>;
  };
  return (body.events ?? []).flatMap((event) => {
    if (!event.status?.type?.completed) return [];
    const competitors = event.competitions?.[0]?.competitors ?? [];
    const away = competitors.find((team) => team.homeAway === 'away');
    const home = competitors.find((team) => team.homeAway === 'home');
    const awayScore = Number(away?.score);
    const homeScore = Number(home?.score);
    if (
      !away?.team?.displayName ||
      !home?.team?.displayName ||
      !Number.isFinite(awayScore) ||
      !Number.isFinite(homeScore)
    )
      return [];
    return [
      {
        away: away.team.displayName,
        home: home.team.displayName,
        awayScore,
        homeScore,
      },
    ];
  });
}

async function startedGameKeysForWeek(week: number) {
  const source = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${weekDates(week)}&limit=100`;
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`Kickoff-status feed returned ${response.status}.`);
  const body = (await response.json()) as {
    events?: Array<{
      status?: { type?: { state?: string } };
      competitions?: Array<{
        competitors?: Array<{
          homeAway?: string;
          team?: { displayName?: string };
        }>;
      }>;
    }>;
  };
  return new Set(
    (body.events ?? []).flatMap((event) => {
      if (event.status?.type?.state === 'pre') return [];
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const away = competitors.find((team) => team.homeAway === 'away')?.team
        ?.displayName;
      const home = competitors.find((team) => team.homeAway === 'home')?.team
        ?.displayName;
      return away && home ? [`${away}__${home}`] : [];
    }),
  );
}

async function settleWeek(week: number) {
  const database = db();
  const snapshots = (
    await database
      .prepare(
        `SELECT id, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, favorite_probability, live_delta, captured_at, winner, correct, away_score, home_score FROM prediction_snapshots WHERE season = ? AND week = ?`,
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
    const winner =
      result.homeScore > result.awayScore ? result.home : result.away;
    return [
      database
        .prepare(
          `UPDATE prediction_snapshots SET settled_at = ?, away_score = ?, home_score = ?, winner = ?, correct = ? WHERE id = ?`,
        )
        .bind(
          settledAt,
          result.awayScore,
          result.homeScore,
          winner,
          snapshot.predicted_winner === winner ? 1 : 0,
          snapshot.id,
        ),
    ];
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
      `Home teams won ${Math.abs(homeResidual * 100).toFixed(1)} points less often than the model expected, so the venue edge is trimmed.`,
    );
  else if (homeResidual >= 0.06)
    parts.push(
      `Home teams won ${(homeResidual * 100).toFixed(1)} points more often than expected, so the venue edge is nudged upward.`,
    );
  if (favoriteResidual <= -0.06)
    parts.push(
      `Favorites went ${correct}-${games.length - correct} against the model's expected ${expectedCorrect.toFixed(1)} wins, so confidence is pulled closer to 50%.`,
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
  const homeEdgeDelta = clamp(
    homeResidual * 4.8 * 0.32,
    -MAX_HOME_EDGE_STEP,
    MAX_HOME_EDGE_STEP,
  );
  const shrinkageDelta = clamp(
    Math.max(0, -favoriteResidual) * 0.18,
    0,
    MAX_SHRINK_STEP,
  );
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
        homeEdgeDelta,
        `Venue residual after Week ${week}`,
        games.length,
        now,
      ),
    database
      .prepare(
        `INSERT INTO model_adjustments (season, week, kind, delta, reason, sample_size, created_at) VALUES (?, ?, 'confidence_shrinkage', ?, ?, ?, ?)`,
      )
      .bind(
        SEASON,
        week,
        shrinkageDelta,
        `Favorite calibration after Week ${week}`,
        games.length,
        now,
      ),
  ]);
}

export async function syncAndLearn() {
  const database = db();
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
        `SELECT kind, COALESCE(SUM(delta), 0) AS delta, COUNT(*) AS count FROM model_adjustments WHERE season = ? GROUP BY kind`,
      )
      .bind(SEASON)
      .all<{ kind: string; delta: number; count: number }>()
  ).results;
  const home = adjustments.find((item) => item.kind === 'home_field');
  const shrink = adjustments.find(
    (item) => item.kind === 'confidence_shrinkage',
  );
  return {
    completedWeeks: Math.max(home?.count ?? 0, shrink?.count ?? 0),
    homeFieldAdjustment: clamp(home?.delta ?? 0, -0.5, 0.5),
    confidenceShrinkage: clamp(shrink?.delta ?? 0, 0, 0.15),
  };
}

export async function capturePredictions(
  items: Array<{
    week: number;
    gameKey: string;
    away: string;
    home: string;
    predictedWinner: string;
    homeProbability: number;
    marketHomeProbability: number | null;
    favoriteProbability: number;
    liveDelta: number;
  }>,
) {
  const database = db();
  const now = new Date().toISOString();
  const candidates = items.slice(0, 18);
  const completed = new Set<string>();
  const started = new Set<string>();
  for (const week of [...new Set(candidates.map((item) => item.week))]) {
    for (const result of await resultsForWeek(week))
      completed.add(`${result.away}__${result.home}`);
    for (const gameKey of await startedGameKeysForWeek(week))
      started.add(gameKey);
  }
  const statements = candidates
    .filter(
      (item) => !completed.has(item.gameKey) && !started.has(item.gameKey),
    )
    .map((item) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO prediction_snapshots (season, week, game_key, away_team, home_team, predicted_winner, home_probability, market_home_probability, favorite_probability, live_delta, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.favoriteProbability,
          item.liveDelta,
          now,
        ),
    );
  if (statements.length) await database.batch(statements);
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
  const statements = items
    .slice(0, 18)
    .map((item) =>
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
  const [all, outcomes, runs, pending] = await Promise.all([
    database
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END), 0) AS correct, COALESCE(SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END), 0) AS incorrect, AVG(CASE WHEN winner IS NOT NULL THEN (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - home_probability) * (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - home_probability) END) AS brier, AVG(CASE WHEN winner IS NOT NULL AND market_home_probability IS NOT NULL THEN (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - market_home_probability) * (CASE WHEN winner = home_team THEN 1.0 ELSE 0.0 END - market_home_probability) END) AS market_brier, COALESCE(SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END), 0) AS pending FROM prediction_snapshots WHERE season = ?`,
      )
      .bind(SEASON)
      .first<{
        total: number;
        correct: number;
        incorrect: number;
        brier: number | null;
        market_brier: number | null;
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
  ]);
  const total = all?.total ?? 0;
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
      captured: total,
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
    pendingSnapshots: pending?.count ?? 0,
    note: 'Predictions are frozen the first time the desk captures a matchup before its result is recorded. Weekly learning runs only after at least 12 captured games in a week are final, then makes capped calibration changes for later games.',
  };
}

export async function safeModelState() {
  try {
    return await modelState();
  } catch {
    return DEFAULT_LEARNED_MODEL;
  }
}

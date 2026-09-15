import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { learnedProbability } from '@/lib/forecast';
import {
  captureVerifiedPredictions,
  safeModelState,
  saveMarketSnapshots,
} from '@/lib/learning';
import {
  fetchMarketLines,
  MARKET_SOURCE_LABEL,
} from '@/lib/market';
import {
  impliedProbability,
  MODEL_V2,
  spreadProbabilities,
  v2ExpectedHomeMargin,
  v2HomeProbability,
} from '@/lib/model-v2';
import {
  captureHorizon,
  captureProspectiveRows,
  prospectiveSeasonExam,
  PROSPECTIVE_SHADOW_LABEL,
} from '@/lib/prospective-model-exam';
import {
  calculateV5Shadow,
  loadCurrentV5Efficiency,
  V5_SHADOW_LABEL,
} from '@/lib/v5-prospective-shadow';
import { V5_PROSPECTIVE_ARTIFACT } from '@/lib/v5-prospective-artifact';
import { V7_PROSPECTIVE_ARTIFACT } from '@/lib/v7-prospective-artifact';
import {
  calculateV7Shadow,
  loadCurrentV7Efficiency,
} from '@/lib/v7-prospective-shadow';
import { collectCurrentPlayerAvailability } from '@/lib/player-availability-sources';
import { savePlayerAvailability } from '@/lib/player-availability';
import {
  nextV7CapturePlan,
  saveV7ShadowSnapshot,
  v7CapturedHorizons,
} from '@/lib/v7-shadow-snapshot';
import { v7ProspectiveScoreboard } from '@/lib/v7-prospective-scoreboard';
import {
  buildV7PlayerIntelligence,
  v7DifferenceExplanation,
} from '@/lib/v7-player-intelligence';

const SEASON = 2026;
const SCHEDULE_SOURCE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=20260901-20270215';
const SCHEDULE_FALLBACK_SOURCE =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

// nflverse uses stable team abbreviations in its released schedule file. This
// map is only a schedule-reader fallback; it has no effect on V2 ratings,
// probabilities, or the production model's market-first policy.
const NFLVERSE_TEAM_NAMES: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers',
  LA: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
  NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};
const TEAM_CODES = Object.fromEntries(
  Object.entries(NFLVERSE_TEAM_NAMES).map(([code, team]) => [team, code]),
) as Record<string, string>;

type ScheduleEvent = {
  id?: string;
  date?: string;
  season?: { year?: number; type?: number };
  week?: { number?: number };
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      shortDetail?: string;
    };
  };
  competitions?: Array<{
    date?: string;
    competitors?: Array<{
      homeAway?: 'home' | 'away';
      team?: { displayName?: string };
    }>;
  }>;
};
type CurrentGame = {
  week: number;
  gameKey: string;
  awayTeam: string;
  homeTeam: string;
  scheduledKickoffAt: string | null;
  gameState: 'scheduled' | 'in_progress' | 'final';
  statusDetail: string | null;
};

type ScheduleFetchResult = {
  games: CurrentGame[];
  source: string;
  warning: string | null;
};

type CanonicalSnapshot = {
  game_key: string;
  predicted_winner: string;
  home_probability: number;
  market_home_probability: number | null;
  model_version: string;
};

function sortGames(games: CurrentGame[]) {
  return [...new Map(games.map((game) => [game.gameKey, game])).values()]
    .sort((left, right) => {
      const leftTime = new Date(left.scheduledKickoffAt ?? '').getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = new Date(right.scheduledKickoffAt ?? '').getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.gameKey.localeCompare(right.gameKey);
    });
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (character === '\n' && !quoted) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  const [header, ...records] = rows;
  if (!header) return [] as Array<Record<string, string>>;
  return records.map((record) =>
    Object.fromEntries(header.map((name, index) => [name, record[index] ?? ''])),
  );
}

function fallbackKickoff(gameday: string, gametime: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameday) || !/^\d{1,2}:\d{2}$/.test(gametime))
    return null;
  // The public schedule supplies local eastern kickoff times. NFL regular-season
  // dates use EDT from March through October and EST otherwise.
  const month = Number(gameday.slice(5, 7));
  const offset = month >= 3 && month <= 10 ? '-04:00' : '-05:00';
  const timestamp = new Date(`${gameday}T${gametime}:00${offset}`);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

async function nflverseScheduleForWeek(week: number): Promise<CurrentGame[]> {
  const response = await fetch(SCHEDULE_FALLBACK_SOURCE, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Schedule fallback returned ${response.status}.`);
  const now = Date.now();
  const games = parseCsv(await response.text()).flatMap((record) => {
    if (
      Number(record.season) !== SEASON ||
      record.game_type !== 'REG' ||
      Number(record.week) !== week
    ) return [];
    const awayTeam = NFLVERSE_TEAM_NAMES[record.away_team];
    const homeTeam = NFLVERSE_TEAM_NAMES[record.home_team];
    if (!awayTeam || !homeTeam) return [];
    const scheduledKickoffAt = fallbackKickoff(record.gameday, record.gametime);
    const awayScore = Number(record.away_score);
    const homeScore = Number(record.home_score);
    const hasFinalScore =
      record.away_score.trim() !== '' &&
      record.home_score.trim() !== '' &&
      Number.isFinite(awayScore) &&
      Number.isFinite(homeScore);
    const kickoffPassed = scheduledKickoffAt !== null && Date.parse(scheduledKickoffAt) <= now;
    return [{
      week,
      gameKey: `${awayTeam}__${homeTeam}`,
      awayTeam,
      homeTeam,
      scheduledKickoffAt,
      gameState: hasFinalScore ? 'final' : kickoffPassed ? 'in_progress' : 'scheduled',
      statusDetail: hasFinalScore
        ? 'Final'
        : kickoffPassed
          ? 'Kickoff passed — live status unavailable'
          : 'Scheduled',
    } satisfies CurrentGame];
  });
  return sortGames(games);
}

function isPreKickoffCaptureEligible(game: CurrentGame, capturedAt: string) {
  // A provider's event status is authoritative for this safety check. The
  // timestamp is a second, independent guard for a stale `scheduled` status.
  // When either fact is absent or contradictory, preserve the integrity of the
  // prospective ledger by not writing a snapshot.
  if (game.gameState !== 'scheduled') return false;
  const kickoff = Date.parse(game.scheduledKickoffAt ?? '');
  const captured = Date.parse(capturedAt);
  return Number.isFinite(kickoff) && Number.isFinite(captured) && captured < kickoff;
}

function scheduleGameState(event: ScheduleEvent): CurrentGame['gameState'] {
  const state = event.status?.type?.state?.toLowerCase();
  if (event.status?.type?.completed || state === 'post') return 'final';
  if (state === 'in') return 'in_progress';
  return 'scheduled';
}

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('Prospective-exam database binding is unavailable.');
  return binding;
}

async function scheduleForWeek(week: number): Promise<ScheduleFetchResult> {
  let primaryFailure: string | null = null;
  try {
    const response = await fetch(SCHEDULE_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Schedule source returned ${response.status}.`);
    const body = (await response.json()) as { events?: ScheduleEvent[] };
    const games = (body.events ?? []).flatMap((event) => {
      if (event.season?.year !== SEASON || event.season?.type !== 2 || event.week?.number !== week)
        return [];
      const competition = event.competitions?.[0];
      const home = competition?.competitors?.find((team) => team.homeAway === 'home')?.team?.displayName;
      const away = competition?.competitors?.find((team) => team.homeAway === 'away')?.team?.displayName;
      if (!home || !away) return [];
      return [{
        week,
        gameKey: `${away}__${home}`,
        awayTeam: away,
        homeTeam: home,
        scheduledKickoffAt: competition?.date ?? event.date ?? null,
        gameState: scheduleGameState(event),
        statusDetail: event.status?.type?.shortDetail ?? null,
      }];
    });
    if (games.length) return { games: sortGames(games), source: 'ESPN scoreboard', warning: null };
    primaryFailure = `The live schedule source returned no Week ${week} games.`;
  } catch (error) {
    primaryFailure = error instanceof Error ? error.message : 'The live schedule source could not be read.';
  }

  const fallbackGames = await nflverseScheduleForWeek(week);
  if (!fallbackGames.length)
    throw new Error(`${primaryFailure ?? 'Live schedule unavailable.'} The published schedule fallback also returned no Week ${week} games.`);
  return {
    games: fallbackGames,
    source: 'nflverse published schedule fallback',
    warning: primaryFailure,
  };
}

async function marketLinesForSlate() {
  try {
    return { lines: await fetchMarketLines(), warning: null };
  } catch (error) {
    return {
      lines: [],
      warning: error instanceof Error ? error.message : 'The market source could not be read.',
    };
  }
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const requested = Number.parseInt(query.get('week') ?? '1', 10);
  const week = Number.isInteger(requested) ? Math.max(1, Math.min(18, requested)) : 1;
  try {
    const db = database();
    if (query.get('report') === '1')
      return NextResponse.json(await prospectiveSeasonExam(db, SEASON), {
        headers: { 'cache-control': 'no-store, max-age=0' },
      });
    if (query.get('v7Report') === '1')
      return NextResponse.json(await v7ProspectiveScoreboard(db, SEASON), {
        headers: { 'cache-control': 'no-store, max-age=0' },
      });

    // This endpoint accepts no probabilities from the browser. It obtains its
    // own schedule, market observation, V2 result, and frozen V5 calculation.
    const [schedule, marketResult, learned, v5Efficiency, v7Efficiency] = await Promise.all([
      scheduleForWeek(week),
      marketLinesForSlate(),
      safeModelState(),
      loadCurrentV5Efficiency(week),
      loadCurrentV7Efficiency(week),
    ]);
    let canonicalRows: CanonicalSnapshot[] = [];
    try {
      canonicalRows = (
        await db
          .prepare(
            `SELECT game_key, predicted_winner, home_probability, market_home_probability, model_version FROM prediction_snapshots WHERE season = ? AND week = ?`,
          )
          .bind(SEASON, week)
          .all<CanonicalSnapshot>()
      ).results;
    } catch {
      // The weekly display remains usable during a local/schema recovery. In a
      // normal deployed D1 this lookup preserves the immutable official pick.
      canonicalRows = [];
    }
    const games = schedule.games;
    const lines = marketResult.lines;
    const capturedAt = new Date().toISOString();
    const byGame = new Map(lines.map((line) => [line.gameKey, line]));
    const canonicalByGame = new Map(
      canonicalRows.map((snapshot) => [snapshot.game_key, snapshot]),
    );
    const footballProbabilityByGame = new Map<string, number>();
    const preKickoffGames = games.filter((game) =>
      isPreKickoffCaptureEligible(game, capturedAt),
    );
    const availability = await collectCurrentPlayerAvailability({
      week,
      teams: preKickoffGames.flatMap((game) => [game.awayTeam, game.homeTeam]),
      observedAt: capturedAt,
    });
    const marketForSlate = preKickoffGames.flatMap((game) => {
      const line = byGame.get(game.gameKey);
      return line
        ? [{ ...line, source: MARKET_SOURCE_LABEL, observedAt: capturedAt }]
        : [];
    });
    // A market feed outage must not hide the official weekly schedule and V2
    // picks. When no paired line is available, V2 retains its documented
    // football fallback and the response explicitly marks market data absent.
    const pairs = games.map((game) => {
      const market = byGame.get(game.gameKey) ?? null;
      const canonical = canonicalByGame.get(game.gameKey);
      const marketHomeProbability = canonical
        ? canonical.market_home_probability
        : market?.homeImpliedProbability ?? null;
      const footballHomeProbability = learnedProbability(
        game.homeTeam,
        game.awayTeam,
        false,
        {},
        learned,
      );
      footballProbabilityByGame.set(game.gameKey, footballHomeProbability);
      const calculatedV2 = v2HomeProbability(footballHomeProbability, marketHomeProbability);
      // Once a game has its canonical pre-kickoff record, its official V2
      // probability and pick are immutable. A later refresh may add research
      // rows but cannot rewrite what the dashboard calls the official pick.
      const v2 = canonical?.home_probability ?? calculatedV2;
      const v5 = calculateV5Shadow({
        week,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        marketHomeProbability,
        efficiencyRows: v5Efficiency.rows,
        unavailableReason: v5Efficiency.reason,
      });
      const v7 = calculateV7Shadow({
        week,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        marketHomeProbability,
        v2HomeProbability: v2,
        efficiencyRows: v7Efficiency.rows,
        unavailableReason: v7Efficiency.reason,
      });
      const v7PlayerIntelligence = buildV7PlayerIntelligence({
        sourceHealth: availability.sourceHealth,
        away: {
          team: game.awayTeam,
          availability: availability.playerPayloadByTeam[TEAM_CODES[game.awayTeam] ?? game.awayTeam] ?? [],
          depth: availability.depthPayloadByTeam[TEAM_CODES[game.awayTeam] ?? game.awayTeam] ?? [],
        },
        home: {
          team: game.homeTeam,
          availability: availability.playerPayloadByTeam[TEAM_CODES[game.homeTeam] ?? game.homeTeam] ?? [],
          depth: availability.depthPayloadByTeam[TEAM_CODES[game.homeTeam] ?? game.homeTeam] ?? [],
        },
      });
      const whyV7Differs = v7DifferenceExplanation({
        v2HomeProbability: v2,
        v7HomeProbability: v7.finalHomeProbability,
        v7Available: v7.available,
        rawResidualLogit: v7.featurePayload.rawResidualLogit,
        playerIntelligence: v7PlayerIntelligence,
      });
      return {
        season: SEASON,
        ...game,
        marketObservedAt: market ? capturedAt : null,
        marketSource: canonical
          ? canonical.market_home_probability === null
            ? null
            : 'Canonical pre-kickoff market snapshot'
          : market
            ? MARKET_SOURCE_LABEL
            : null,
        marketHomeProbability,
        v2HomeProbability: v2,
        v2PredictedWinner:
          canonical?.predicted_winner ?? (v2 >= 0.5 ? game.homeTeam : game.awayTeam),
        v2ModelVersion: canonical?.model_version ?? MODEL_V2.version,
        v5HomeProbability: v5.homeProbability,
        v5PredictedWinner:
          v5.predictedWinner === null
            ? null
            : v5.predictedWinner === 'home'
              ? game.homeTeam
              : game.awayTeam,
        v5RawResidualLogit: v5.rawResidualLogit,
        v5AppliedShadowScale: v5.available
          ? V5_PROSPECTIVE_ARTIFACT.residualScale
          : null,
        v5ModelVersion: V5_PROSPECTIVE_ARTIFACT.version,
        v5FeatureDataThroughWeek: v5.featureDataThroughWeek,
        v5FeaturePayload: {
          ...v5.featurePayload,
          unavailableReason: v5.reason,
          source: v5Efficiency.reason ? null : '2026 nflverse stats_team weekly CSV',
        },
        v5Available: v5.available,
        v7,
        v7PlayerIntelligence,
        whyV7Differs,
      };
    });
    // Keep displaying the full slate, but only preserve a market or paired
    // forecast row while the game is independently confirmed as pre-kickoff.
    // This prevents postgame odds/source responses from entering either ledger.
    let canonicalCapture = { canonicalInserted: 0, ledgerInserted: 0, canonicalTotal: 0 };
    let capture = {
      attempted: 0,
      accepted: 0,
      skippedAfterKickoff: 0,
      inserted: 0,
      duplicateOrExisting: 0,
      captureBucket: '',
    };
    let captureWarning: string | null = null;
    let v7Capture = {
      attempted: 0,
      accepted: 0,
      skippedAfterKickoff: 0,
      inserted: 0,
      duplicateOrExisting: 0,
      horizonsCaptured: [] as Array<{ gameKey: string; target: string; status: string; actualHorizonMinutes: number }> ,
      horizonsWaiting: [] as Array<{ gameKey: string; reason: string }> ,
    };
    try {
      if (marketForSlate.length) await saveMarketSnapshots(marketForSlate);
      canonicalCapture = await captureVerifiedPredictions(
        preKickoffGames.flatMap((game) => {
          const pair = pairs.find((candidate) => candidate.gameKey === game.gameKey);
          if (!pair) return [];
          const market = byGame.get(game.gameKey);
          const marketExpectedHomeMargin =
            market?.homeSpread === null || market?.homeSpread === undefined
              ? null
              : -market.homeSpread;
          const expectedHomeMargin =
            marketExpectedHomeMargin === null
              ? null
              : v2ExpectedHomeMargin(0, -marketExpectedHomeMargin);
          const cover =
            expectedHomeMargin === null
              ? null
              : spreadProbabilities(expectedHomeMargin, market?.homeSpread ?? null);
          return [{
            week: game.week,
            gameKey: game.gameKey,
            away: game.awayTeam,
            home: game.homeTeam,
            predictedWinner: pair.v2PredictedWinner,
            homeProbability: pair.v2HomeProbability,
            marketHomeProbability: pair.marketHomeProbability,
            footballHomeProbability: footballProbabilityByGame.get(game.gameKey) ?? null,
            expectedHomeMargin,
            marketExpectedHomeMargin,
            homeSpread: market?.homeSpread ?? null,
            homeCoverProbability: cover?.homeCover ?? null,
            modelVersion: pair.v2ModelVersion,
            favoriteProbability: Math.max(pair.v2HomeProbability, 1 - pair.v2HomeProbability),
            liveDelta: 0,
          }];
        }),
        capturedAt,
      );
      capture = await captureProspectiveRows(
        db,
        pairs.filter((pair, index) =>
          isPreKickoffCaptureEligible(games[index]!, capturedAt),
        ),
        capturedAt,
      );
      if (availability.signals.length) await savePlayerAvailability(availability.signals);
      const v7Pairs = pairs.filter((pair, index) =>
        isPreKickoffCaptureEligible(games[index]!, capturedAt),
      );
      v7Capture = {
        attempted: pairs.length,
        accepted: 0,
        skippedAfterKickoff: pairs.length - v7Pairs.length,
        inserted: 0,
        duplicateOrExisting: 0,
        horizonsCaptured: [],
        horizonsWaiting: [],
      };
      const existingHorizons = await v7CapturedHorizons(db, SEASON, week);
      for (const pair of v7Pairs) {
        const horizons = existingHorizons.get(pair.gameKey) ?? new Set<string>();
        const plan = nextV7CapturePlan(pair.scheduledKickoffAt!, new Date(capturedAt), horizons);
        if (!plan) {
          v7Capture.horizonsWaiting.push({ gameKey: pair.gameKey, reason: 'All currently due V7 capture targets were already stored.' });
          continue;
        }
        const saved = await saveV7ShadowSnapshot(db, {
          season: SEASON,
          week: pair.week,
          gameKey: pair.gameKey,
          awayTeam: pair.awayTeam,
          homeTeam: pair.homeTeam,
          scheduledKickoffAt: pair.scheduledKickoffAt!,
          capture: plan,
          featureCutoffAt: capturedAt,
          market: {
            observedAt: pair.marketObservedAt,
            source: pair.marketSource,
            homeProbability: pair.marketHomeProbability,
            awayMoneyline: byGame.get(pair.gameKey)?.awayMoneyline ?? null,
            homeMoneyline: byGame.get(pair.gameKey)?.homeMoneyline ?? null,
            homeSpread: byGame.get(pair.gameKey)?.homeSpread ?? null,
            totalLine: byGame.get(pair.gameKey)?.totalLine ?? null,
          },
          v2: {
            homeProbability: pair.v2HomeProbability,
            predictedWinner: pair.v2PredictedWinner,
            modelVersion: pair.v2ModelVersion,
          },
          probabilities: {
            footballHome: pair.v7.footballHomeProbability,
            playerAvailabilityHome: null,
            matchupHome: pair.v7.matchupHomeProbability,
            upsetRisk: pair.v7.upsetRisk,
            upsetHomeAdjustment: pair.v7.upsetHomeAdjustment,
            finalHome: pair.v7.finalHomeProbability,
          },
          modelVersion: V7_PROSPECTIVE_ARTIFACT.version,
          modelHash: V7_PROSPECTIVE_ARTIFACT.artifactHash,
          teamRatings: { v2FootballHomeProbability: footballProbabilityByGame.get(pair.gameKey) ?? null },
          playerAvailability: {
            away: availability.playerPayloadByTeam[TEAM_CODES[pair.awayTeam] ?? pair.awayTeam] ?? [],
            home: availability.playerPayloadByTeam[TEAM_CODES[pair.homeTeam] ?? pair.homeTeam] ?? [],
            limitations: availability.limitations,
          },
          depthChart: {
            away: availability.depthPayloadByTeam[TEAM_CODES[pair.awayTeam] ?? pair.awayTeam] ?? [],
            home: availability.depthPayloadByTeam[TEAM_CODES[pair.homeTeam] ?? pair.homeTeam] ?? [],
          },
          weatherRestTravel: {
            status: 'UNAVAILABLE',
            reason: 'No timestamped weather, rest, or travel source is connected to V7 yet.',
          },
          teamEfficiency: pair.v7.featurePayload,
          specialists: {
            productionInfluence: 0,
            statuses: ['QB', 'skill-position availability', 'OL', 'pass rush', 'secondary', 'TE matchup', 'weather', 'rest/travel', 'turnover regression', 'explosive-play matchup', 'red zone', 'coaching/scheme', 'market movement'].map((code) => ({ code, productionWeight: 0 })),
          },
          sourceStatus: {
            market: pair.marketSource ? 'AVAILABLE' : 'UNAVAILABLE',
            teamEfficiency: v7Efficiency.reason ? 'UNAVAILABLE' : 'AVAILABLE',
            playerAvailability: availability.sourceHealth,
          },
          playerIntelligence: pair.v7PlayerIntelligence,
          whyV7Differs: pair.whyV7Differs,
        }, new Date(capturedAt));
        if (saved.captured) {
          v7Capture.accepted += 1;
          if (saved.inserted === true) {
            horizons.add(plan.target);
            existingHorizons.set(pair.gameKey, horizons);
            v7Capture.horizonsCaptured.push({
              gameKey: pair.gameKey,
              target: plan.target,
              status: plan.status,
              actualHorizonMinutes: plan.actualHorizonMinutes,
            });
          }
          if (saved.inserted === true) v7Capture.inserted += 1;
          else if (saved.inserted === false) v7Capture.duplicateOrExisting += 1;
        }
      }
    } catch (error) {
      captureWarning = error instanceof Error
        ? error.message
        : 'The pre-kickoff ledger could not be refreshed.';
    }
    return NextResponse.json(
      {
        season: SEASON,
        week,
        retrievedAt: capturedAt,
        scheduleSource: schedule.source,
        scheduleWarning: schedule.warning,
        marketWarning: marketResult.warning,
        captureWarning,
        label: PROSPECTIVE_SHADOW_LABEL,
        v5Artifact: {
          version: V5_PROSPECTIVE_ARTIFACT.version,
          hash: V5_PROSPECTIVE_ARTIFACT.artifactHash,
          productionInfluence: 0,
        },
        v7Artifact: {
          version: V7_PROSPECTIVE_ARTIFACT.version,
          hash: V7_PROSPECTIVE_ARTIFACT.artifactHash,
          productionInfluence: 0,
        },
        capture,
        v7Capture,
        canonicalCapture,
        skippedAfterKickoff: games.length - preKickoffGames.length,
        // `pairs` is created from `games` above in the same order. Keep every
        // schedule event in the response, including in-progress and completed
        // games; the capture layer separately prevents post-kickoff snapshots.
        games: pairs.map((pair, index) => ({
          gameState: games[index]?.gameState ?? 'scheduled',
          statusDetail: games[index]?.statusDetail ?? null,
          gameKey: pair.gameKey,
          away: pair.awayTeam,
          home: pair.homeTeam,
          scheduledKickoffAt: pair.scheduledKickoffAt,
          captureHorizon: captureHorizon(pair.scheduledKickoffAt, capturedAt),
          marketHomeProbability: pair.marketHomeProbability,
          marketSource: pair.marketSource,
          marketObservedAt: pair.marketObservedAt,
          v2OfficialProbability: pair.v2HomeProbability,
          v2OfficialPick: pair.v2PredictedWinner,
          v5ShadowProbability: pair.v5HomeProbability,
          v5ShadowPick: pair.v5PredictedWinner,
          v5MinusV2ProbabilityDelta:
            pair.v5HomeProbability === null
              ? null
              : pair.v5HomeProbability - pair.v2HomeProbability,
          disagreement:
            pair.v5PredictedWinner === null
              ? false
              : pair.v5PredictedWinner !== pair.v2PredictedWinner,
          featureDataThroughWeek: pair.v5FeatureDataThroughWeek,
          v5Available: pair.v5Available,
          v5UnavailableReason: pair.v5Available
            ? null
            : (pair.v5FeaturePayload.unavailableReason ?? null),
          v7ShadowProbability: pair.v7.finalHomeProbability,
          v7ShadowPick: pair.v7.predictedWinner === 'home' ? pair.homeTeam : pair.awayTeam,
          v7FootballProbability: pair.v7.footballHomeProbability,
          v7MatchupProbability: pair.v7.matchupHomeProbability,
          v7UpsetRisk: pair.v7.upsetRisk,
          v7UpsetHomeAdjustment: pair.v7.upsetHomeAdjustment,
          v7Available: pair.v7.available,
          v7UnavailableReason: pair.v7.reason,
          v7FeatureDataThroughWeek: pair.v7.featureDataThroughWeek,
          v7MinusV2ProbabilityDelta: pair.v7.finalHomeProbability - pair.v2HomeProbability,
          whyV7Differs: pair.whyV7Differs,
          playerAvailability: pair.v7PlayerIntelligence,
          dataLastUpdated: capturedAt,
          market: (() => {
            const line = byGame.get(pair.gameKey);
            if (!line) return null;
            // Without a listed spread there is no authoritative market-margin
            // estimate to display. Do not substitute a made-up zero margin.
            const expectedHomeMargin =
              line.homeSpread === null
                ? null
                : v2ExpectedHomeMargin(0, line.homeSpread);
            const cover =
              expectedHomeMargin === null
                ? null
                : spreadProbabilities(expectedHomeMargin, line.homeSpread);
            const homePrice = impliedProbability(line.homeSpreadOdds);
            const awayPrice = impliedProbability(line.awaySpreadOdds);
            const homeEdge =
              cover === null || homePrice === null ? null : cover.homeCover - homePrice;
            const awayEdge =
              cover === null || awayPrice === null ? null : cover.awayCover - awayPrice;
            const selection =
              homeEdge !== null && awayEdge !== null && Math.max(homeEdge, awayEdge) > 0
                ? homeEdge >= awayEdge
                  ? `${pair.homeTeam} ${line.homeSpread ?? ''}`.trim()
                  : `${pair.awayTeam} ${line.awaySpread ?? ''}`.trim()
                : 'Pass — no price edge';
            return {
              awayMoneyline: line.awayMoneyline,
              homeMoneyline: line.homeMoneyline,
              awaySpread: line.awaySpread,
              homeSpread: line.homeSpread,
              totalLine: line.totalLine,
              awaySpreadOdds: line.awaySpreadOdds,
              homeSpreadOdds: line.homeSpreadOdds,
              awayImpliedProbability: line.awayImpliedProbability,
              homeImpliedProbability: line.homeImpliedProbability,
              expectedHomeMargin,
              spreadProbabilities: cover,
              betting: {
                selection,
                homeEdge,
                awayEdge,
                policy: MODEL_V2.decisionRule,
              },
            };
          })(),
          label: V5_SHADOW_LABEL,
        })),
      },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'The prospective V2-versus-V5 shadow exam could not refresh.',
        detail: error instanceof Error ? error.message : 'Unknown error',
        label: PROSPECTIVE_SHADOW_LABEL,
      },
      { status: 503, headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }
}

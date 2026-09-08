import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { learnedProbability } from '@/lib/forecast';
import { safeModelState, saveMarketSnapshots } from '@/lib/learning';
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
  type ProspectiveCaptureInput,
} from '@/lib/prospective-model-exam';
import {
  calculateV5Shadow,
  loadCurrentV5Efficiency,
  V5_SHADOW_LABEL,
} from '@/lib/v5-prospective-shadow';
import { V5_PROSPECTIVE_ARTIFACT } from '@/lib/v5-prospective-artifact';

const SEASON = 2026;
const SCHEDULE_SOURCE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=20260901-20270215';

type ScheduleEvent = {
  id?: string;
  date?: string;
  season?: { year?: number; type?: number };
  week?: { number?: number };
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
};

function database() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('Prospective-exam database binding is unavailable.');
  return binding;
}

async function scheduleForWeek(week: number): Promise<CurrentGame[]> {
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
    }];
  });
  return [...new Map(games.map((game) => [game.gameKey, game])).values()];
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

    // This endpoint accepts no probabilities from the browser. It obtains its
    // own schedule, market observation, V2 result, and frozen V5 calculation.
    const [games, lines, learned, v5Efficiency] = await Promise.all([
      scheduleForWeek(week),
      fetchMarketLines(),
      safeModelState(),
      loadCurrentV5Efficiency(week),
    ]);
    const capturedAt = new Date().toISOString();
    const byGame = new Map(lines.map((line) => [line.gameKey, line]));
    const marketForSlate = games.flatMap((game) => {
      const line = byGame.get(game.gameKey);
      return line
        ? [{ ...line, source: MARKET_SOURCE_LABEL, observedAt: capturedAt }]
        : [];
    });
    await saveMarketSnapshots(marketForSlate);
    const pairs: ProspectiveCaptureInput[] = games.map((game) => {
      const market = byGame.get(game.gameKey) ?? null;
      const marketHomeProbability = market?.homeImpliedProbability ?? null;
      const footballHomeProbability = learnedProbability(
        game.homeTeam,
        game.awayTeam,
        false,
        {},
        learned,
      );
      const v2 = v2HomeProbability(footballHomeProbability, marketHomeProbability);
      const v5 = calculateV5Shadow({
        week,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        marketHomeProbability,
        efficiencyRows: v5Efficiency.rows,
        unavailableReason: v5Efficiency.reason,
      });
      return {
        season: SEASON,
        ...game,
        marketObservedAt: market ? capturedAt : null,
        marketSource: market ? MARKET_SOURCE_LABEL : null,
        marketHomeProbability,
        v2HomeProbability: v2,
        v2PredictedWinner: v2 >= 0.5 ? game.homeTeam : game.awayTeam,
        v2ModelVersion: MODEL_V2.version,
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
      };
    });
    const capture = await captureProspectiveRows(db, pairs, capturedAt);
    return NextResponse.json(
      {
        season: SEASON,
        week,
        retrievedAt: capturedAt,
        label: PROSPECTIVE_SHADOW_LABEL,
        v5Artifact: {
          version: V5_PROSPECTIVE_ARTIFACT.version,
          hash: V5_PROSPECTIVE_ARTIFACT.artifactHash,
          productionInfluence: 0,
        },
        capture,
        games: pairs.map((pair) => ({
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
          market: (() => {
            const line = byGame.get(pair.gameKey);
            if (!line) return null;
            const expectedHomeMargin = v2ExpectedHomeMargin(0, line.homeSpread);
            const cover = spreadProbabilities(expectedHomeMargin, line.homeSpread);
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

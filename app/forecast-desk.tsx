'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  RefreshCw,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Game = {
  id: string;
  week: number;
  away: string;
  home: string;
  date: string;
  neutral: boolean;
  homeProbability: number;
  source: string;
};
type LearningState = {
  completedWeeks: number;
  homeFieldAdjustment: number;
  confidenceShrinkage: number;
};
type Learning = {
  state: LearningState;
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
  runs: Array<{
    week: number;
    gradedGames: number;
    correctPicks: number;
    brierScore: number;
    homeResidual: number;
    favoriteResidual: number;
    insight: string;
    createdAt: string;
  }>;
  outcomes: Array<{
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
  }>;
  pendingSnapshots: number;
  note: string;
};
type Forecast = {
  week: number;
  games: Game[];
  retrievedAt: string;
  source: string;
  model: {
    label: string;
    ratings: Record<string, number>;
    learning: LearningState;
    notes: string;
  };
};
type Update = {
  headline: string;
  description?: string;
  published?: string;
  link?: string;
  team: string;
  impact: number;
  status: 'Applied' | 'Monitor only';
};
type Live = {
  retrievedAt: string;
  adjustments: Record<string, number>;
  updates: Update[];
  feedStatus: string;
  policy: string;
  sources: Array<{ label: string; url: string }>;
};
type MarketLine = {
  week: number;
  away: string;
  home: string;
  gameKey: string;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  awaySpread: number | null;
  homeSpread: number | null;
  totalLine: number | null;
  awaySpreadOdds: number | null;
  homeSpreadOdds: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeImpliedProbability: number | null;
  awayImpliedProbability: number | null;
};
type Market = {
  week: number;
  observedAt: string;
  source: { label: string; url: string };
  lines: MarketLine[];
  note: string;
};
type BacktestMetric = {
  games: number;
  tiesExcluded: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  accuracyInterval95: { low: number; high: number } | null;
  brier: number | null;
  logLoss: number | null;
  marginMae: number | null;
  marginMedianAbsoluteError: number | null;
};
type HistoricalBacktest = {
  modelVersion: string;
  source: { label: string; url: string };
  seasons: number[];
  generatedAt: string;
  methodology: {
    label: string;
    homeFieldEdge: number;
    logisticScale: number;
    offseasonCarry: number;
    updateRule: string;
    freezeRule: string;
    holdoutRule: string;
  };
  limitations: string[];
  overall: BacktestMetric;
  regularSeason: BacktestMetric;
  postseason: BacktestMetric;
  holdout: {
    season: number;
    overall: BacktestMetric;
    regularSeason: BacktestMetric;
    postseason: BacktestMetric;
  } | null;
  bySeason: Array<{
    season: number;
    overall: BacktestMetric;
    regularSeason: BacktestMetric;
    postseason: BacktestMetric;
  }>;
  calibration: Array<{
    label: string;
    games: number;
    predicted: number;
    actual: number;
    gap: number;
  }>;
  worstMisses: Array<{
    gameId: string;
    season: number;
    phase: string;
    away: string;
    home: string;
    predictedWinner: string;
    winner: string;
    pickProbability: number;
    expectedHomeMargin: number;
    actualHomeMargin: number;
  }>;
};
type RenderedGame = Game & {
  adjustedHome: number;
  delta: number;
  expectedMargin: number;
  market: MarketLine | null;
};
type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function asDate(value?: string) {
  if (!value) return 'Waiting for first refresh';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
    timeZoneName: 'short',
  }).format(new Date(value));
}
function signed(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}
function formatSigned(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
function formatLine(value: number | null) {
  return value === null ? '—' : value.toFixed(1);
}
function formatOdds(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value}`;
}
function formatPrice(line: number | null, odds: number | null) {
  if (line === null) return '—';
  return `${formatSigned(line)} (${formatOdds(odds)})`;
}
function formatPercent(value: number | null, fractionDigits = 1) {
  return value === null ? '—' : `${(value * 100).toFixed(fractionDigits)}%`;
}
function formatMetric(value: number | null, fractionDigits = 3) {
  return value === null ? '—' : value.toFixed(fractionDigits);
}
function probabilityFor(
  game: Game,
  ratings: Record<string, number>,
  adjustments: Record<string, number>,
  learning: LearningState,
) {
  const home = (ratings[game.home] ?? 0) + (adjustments[game.home] ?? 0);
  const away = (ratings[game.away] ?? 0) + (adjustments[game.away] ?? 0);
  const raw =
    1 /
    (1 +
      Math.exp(
        -(
          home -
          away +
          (game.neutral ? 0 : 1.1 + learning.homeFieldAdjustment)
        ) / 4.8,
      ));
  return 0.5 + (raw - 0.5) * (1 - learning.confidenceShrinkage);
}
function expectedMarginFor(
  game: Game,
  ratings: Record<string, number>,
  adjustments: Record<string, number>,
  learning: LearningState,
) {
  const home = (ratings[game.home] ?? 0) + (adjustments[game.home] ?? 0);
  const away = (ratings[game.away] ?? 0) + (adjustments[game.away] ?? 0);
  return home - away + (game.neutral ? 0 : 1.1 + learning.homeFieldAdjustment);
}
function spreadSelectionFor(game: RenderedGame) {
  const line = game.market;
  if (!line || line.homeSpread === null || line.homeSpread === undefined) {
    return 'No spread line';
  }
  const spreadEdge = game.expectedMargin + line.homeSpread;
  if (spreadEdge >= 0.25) {
    return `${game.home} ${formatPrice(line.homeSpread, line.homeSpreadOdds)}`;
  }
  if (spreadEdge <= -0.25) {
    return `${game.away} ${formatPrice(line.awaySpread, line.awaySpreadOdds)}`;
  }
  return 'Pass — no clear spread edge';
}

export function ForecastDesk() {
  const [week, setWeek] = useState(1);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [historical, setHistorical] = useState<HistoricalBacktest | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [historicalError, setHistoricalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef({ week, forecast, live });
  useEffect(() => {
    stateRef.current = { week, forecast, live };
  }, [week, forecast, live]);

  const loadForecast = useCallback(async (requestedWeek: number) => {
    setForecastError(null);
    const response = await fetch(`/api/forecast?week=${requestedWeek}`, {
      cache: 'no-store',
    });
    const body = (await response.json()) as Forecast & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? 'Could not refresh the schedule.');
    setForecast(body);
  }, []);
  const refreshLive = useCallback(async () => {
    setLiveError(null);
    const response = await fetch('/api/live', { cache: 'no-store' });
    const body = (await response.json()) as Live & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? 'Could not refresh live inputs.');
    setLive(body);
    return body;
  }, []);
  const refreshLearning = useCallback(async () => {
    setLearningError(null);
    const response = await fetch('/api/learning', { cache: 'no-store' });
    const body = (await response.json()) as Learning & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? 'Could not refresh the learning record.');
    setLearning(body);
    return body;
  }, []);
  const refreshMarket = useCallback(async (requestedWeek: number) => {
    setMarketError(null);
    const response = await fetch(`/api/market?week=${requestedWeek}`, {
      cache: 'no-store',
    });
    const body = (await response.json()) as Market & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? 'Could not refresh the market reference.');
    setMarket(body);
    return body;
  }, []);
  const refreshHistorical = useCallback(async () => {
    setHistoricalError(null);
    const response = await fetch('/api/historical', { cache: 'no-store' });
    const body = (await response.json()) as HistoricalBacktest & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(body.error ?? 'Could not load the historical replay.');
    setHistorical(body);
    return body;
  }, []);
  const refreshAll = useCallback(
    async (requestedWeek: number) => {
      setBusy(true);
      try {
        try {
          await refreshLearning();
        } catch (error) {
          setLearningError(
            error instanceof Error
              ? error.message
              : 'Could not refresh the learning record.',
          );
        }
        const results = await Promise.allSettled([
          loadForecast(requestedWeek),
          refreshLive(),
          refreshMarket(requestedWeek),
        ]);
        if (results[0].status === 'rejected')
          setForecastError(
            results[0].reason instanceof Error
              ? results[0].reason.message
              : 'Could not refresh the forecast.',
          );
        if (results[1].status === 'rejected')
          setLiveError(
            results[1].reason instanceof Error
              ? results[1].reason.message
              : 'Could not refresh live inputs.',
          );
        if (results[2].status === 'rejected')
          setMarketError(
            results[2].reason instanceof Error
              ? results[2].reason.message
              : 'Could not refresh the market reference.',
          );
      } finally {
        setBusy(false);
      }
    },
    [loadForecast, refreshLearning, refreshLive, refreshMarket],
  );
  const changeWeek = useCallback(
    async (nextWeek: number) => {
      if (nextWeek < 1 || nextWeek > 18)
        throw new Error('Week must be from 1 through 18.');
      setWeek(nextWeek);
      setBusy(true);
      try {
        try {
          await refreshLearning();
        } catch (error) {
          setLearningError(
            error instanceof Error
              ? error.message
              : 'Could not refresh the learning record.',
          );
        }
        const results = await Promise.allSettled([
          loadForecast(nextWeek),
          refreshMarket(nextWeek),
        ]);
        if (results[0].status === 'rejected') throw results[0].reason;
        if (results[1].status === 'rejected')
          setMarketError(
            results[1].reason instanceof Error
              ? results[1].reason.message
              : 'Could not refresh the market reference.',
          );
      } catch (error) {
        setForecastError(
          error instanceof Error
            ? error.message
            : 'Could not refresh the forecast.',
        );
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [loadForecast, refreshLearning, refreshMarket],
  );
  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshAll(1);
    }, 0);
    return () => window.clearTimeout(initialRefresh);
  }, [refreshAll]);
  useEffect(() => {
    void refreshHistorical().catch((error) => {
      setHistoricalError(
        error instanceof Error
          ? error.message
          : 'Could not load the historical replay.',
      );
    });
  }, [refreshHistorical]);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        void refreshAll(stateRef.current.week);
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [refreshAll]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext['registerTool']>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        /* host does not support WebMCP */
      }
    };
    register({
      name: 'set_nfl_forecast_week',
      title: 'Set NFL forecast week',
      description:
        'Show the official 2026 schedule and game forecasts for one requested week.',
      inputSchema: {
        type: 'object',
        properties: { week: { type: 'integer', minimum: 1, maximum: 18 } },
        required: ['week'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const requested =
          typeof input === 'object' && input !== null
            ? (input as { week?: unknown }).week
            : undefined;
        if (
          !Number.isInteger(requested) ||
          (requested as number) < 1 ||
          (requested as number) > 18
        )
          throw new Error('week must be an integer from 1 through 18.');
        await changeWeek(requested as number);
        return {
          week: requested,
          games: stateRef.current.forecast?.games.length ?? 0,
        };
      },
    });
    register({
      name: 'refresh_nfl_live_inputs',
      title: 'Refresh live NFL inputs',
      description:
        'Refresh the live news and injury-input layer used for displayed game probabilities.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          throw new Error('Expected an empty object.');
        const result = await refreshLive();
        return {
          retrievedAt: result.retrievedAt,
          appliedUpdates: result.updates.filter(
            (update) => update.status === 'Applied',
          ).length,
        };
      },
    });
    register({
      name: 'get_nfl_forecast_state',
      title: 'Get NFL forecast state',
      description:
        'Read the selected week, schedule freshness, and currently applied team adjustments.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          throw new Error('Expected an empty object.');
        const state = stateRef.current;
        return {
          week: state.week,
          games: state.forecast?.games.length ?? 0,
          refreshedAt: state.live?.retrievedAt ?? null,
          adjustments: state.live?.adjustments ?? {},
        };
      },
    });
    register({
      name: 'get_nfl_historical_backtest',
      title: 'Get NFL historical backtest',
      description:
        'Read the frozen 2021–2025 historical accuracy summary, including the 2025 holdout result.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          throw new Error('Expected an empty object.');
        const result = await refreshHistorical();
        return {
          modelVersion: result.modelVersion,
          seasons: result.seasons,
          accuracy: result.overall.accuracy,
          correct: result.overall.correct,
          incorrect: result.overall.incorrect,
          holdout2025Accuracy: result.holdout?.overall.accuracy ?? null,
        };
      },
    });
    return () => lifecycle.abort();
  }, [changeWeek, refreshHistorical, refreshLive]);

  const renderedGames = useMemo(
    () =>
      (forecast?.games ?? []).map((game) => {
        const adjustedHome = probabilityFor(
          game,
          forecast?.model.ratings ?? {},
          live?.adjustments ?? {},
          forecast?.model.learning ?? {
            completedWeeks: 0,
            homeFieldAdjustment: 0,
            confidenceShrinkage: 0,
          },
        );
        return {
          ...game,
          adjustedHome,
          delta: adjustedHome - game.homeProbability,
          expectedMargin: expectedMarginFor(
            game,
            forecast?.model.ratings ?? {},
            live?.adjustments ?? {},
            forecast?.model.learning ?? {
              completedWeeks: 0,
              homeFieldAdjustment: 0,
              confidenceShrinkage: 0,
            },
          ),
          market:
            market?.lines.find(
              (line) => line.gameKey === `${game.away}__${game.home}`,
            ) ?? null,
        };
      }),
    [forecast, live, market],
  );
  const appliedCount =
    live?.updates.filter((update) => update.status === 'Applied').length ?? 0;

  useEffect(() => {
    if (
      !forecast ||
      !live ||
      !market ||
      market.week !== forecast.week ||
      !renderedGames.length
    )
      return;
    const snapshot = window.setTimeout(() => {
      void fetch('/api/predictions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          games: renderedGames.map((game) => {
            const homeFavorite = game.adjustedHome >= 0.5;
            return {
              week: game.week,
              gameKey: `${game.away}__${game.home}`,
              away: game.away,
              home: game.home,
              predictedWinner: homeFavorite ? game.home : game.away,
              homeProbability: game.adjustedHome,
              marketHomeProbability:
                game.market?.homeImpliedProbability ?? null,
              favoriteProbability: homeFavorite
                ? game.adjustedHome
                : 1 - game.adjustedHome,
              liveDelta: game.delta,
            };
          }),
        }),
      })
        .then(() => undefined)
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(snapshot);
  }, [forecast, live, market, renderedGames]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#071622] text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(86,174,214,.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(86,174,214,.06)_1px,transparent_1px)] [background-size:80px_80px]" />
      <header className="relative border-b border-sky-100/10 bg-[#081b29]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#e9b949] text-[#06131e] shadow-[0_0_24px_rgba(233,185,73,.24)]">
              <Activity className="size-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#e9b949]">
                2026–27 season
              </p>
              <h1 className="text-lg font-bold tracking-tight text-white">
                NFL Forecast Desk
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100/10 bg-sky-100/5 px-3 py-1.5">
              <Radio className="size-3 text-sky-300" /> Live input scan
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100/10 bg-sky-100/5 px-3 py-1.5">
              <Clock3 className="size-3 text-sky-300" />{' '}
              {asDate(live?.retrievedAt)}
            </span>
          </div>
        </div>
      </header>
      <section className="relative mx-auto max-w-7xl px-5 pb-14 pt-8 lg:px-8">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div>
            <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-sky-100/10 bg-[#0c2333]/90 p-5 shadow-2xl shadow-black/20 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Game by game forecast
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">
                  Every matchup. One clear call.
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-300">
                  Win probability starts with a transparent team-strength and
                  venue model, then shifts only when a live report passes the
                  update rule.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(week)}
                  onValueChange={(value) => {
                    void changeWeek(Number(value));
                  }}
                >
                  <SelectTrigger className="h-10 min-w-32 border-sky-100/15 bg-[#071a28] px-3 text-slate-100 hover:bg-[#102c3e]">
                    <CalendarDays className="mr-2 size-4 text-[#e9b949]" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-sky-100/10 bg-[#0d2637] text-slate-100">
                    <SelectGroup>
                      {Array.from({ length: 18 }, (_, index) => (
                        <SelectItem
                          key={index + 1}
                          value={String(index + 1)}
                          className="focus:bg-sky-100/10 focus:text-white"
                        >
                          Week {index + 1}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => void refreshAll(week)}
                  disabled={busy}
                  variant="outline"
                  className="h-10 border-sky-100/15 bg-[#071a28] px-3 text-slate-100 hover:bg-[#102c3e] hover:text-white"
                  aria-label="Refresh schedule and live inputs"
                >
                  <RefreshCw
                    className={`size-4 ${busy ? 'animate-spin' : ''}`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-sky-100/10 bg-[#0b2030] md:grid-cols-5">
              <Metric label="Selected" value={`Week ${week}`} />
              <Metric
                label="On deck"
                value={forecast ? `${forecast.games.length} games` : 'Loading'}
              />
              <Metric
                label="Record"
                value={
                  learning
                    ? `${learning.record.correct}–${learning.record.incorrect}`
                    : 'Pending'
                }
              />
              <Metric
                label="Applied"
                value={`${appliedCount} update${appliedCount === 1 ? '' : 's'}`}
              />
              <Metric
                label="Historical"
                value={
                  historical
                    ? formatPercent(historical.overall.accuracy)
                    : 'Loading'
                }
              />
            </div>
            {historical && <HistoricalPerformance historical={historical} />}
            {historicalError && <Notice tone="warn" text={historicalError} />}
            {learning && <LearningPanel learning={learning} />}
            {forecast && <BettingBoard games={renderedGames} market={market} />}
            {forecastError && <Notice tone="error" text={forecastError} />}
            {liveError && (
              <Notice
                tone="warn"
                text={`${liveError} Baseline forecasts remain visible.`}
              />
            )}
            {learningError && <Notice tone="warn" text={learningError} />}
            {marketError && (
              <Notice
                tone="warn"
                text={`${marketError} The football-only forecast remains separate.`}
              />
            )}
            {!forecast && !forecastError && <LoadingCards />}
            <div className="space-y-3">
              {renderedGames.map((game) => {
                const homeFavorite = game.adjustedHome >= 0.5;
                const favorite = homeFavorite ? game.home : game.away;
                const favoriteProbability = homeFavorite
                  ? game.adjustedHome
                  : 1 - game.adjustedHome;
                const newsMove = Math.abs(game.delta) >= 0.002;
                return (
                  <article
                    key={game.id}
                    className="group overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2435]/95 transition hover:border-sky-300/25 hover:bg-[#0f2a3d]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/8 bg-[#071b29]/60 px-4 py-2.5 text-xs">
                      <span className="font-medium text-sky-200">
                        {game.date}
                        {game.neutral ? ' · Neutral site' : ''}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-400">
                          <ShieldCheck className="size-3.5 text-sky-300" />{' '}
                          Official schedule
                        </span>
                        {game.market && (
                          <>
                            <span className="text-slate-400">
                              Market:{' '}
                              {game.market.homeSpread === null
                                ? 'ML only'
                                : `${game.home} ${formatSigned(game.market.homeSpread)}`}{' '}
                              · O/U {formatLine(game.market.totalLine)}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e9b949]/35 bg-[#e9b949]/10 px-2.5 py-1 font-semibold text-[#f6d787]">
                              <Radio className="size-3 text-[#e9b949]" />
                              Live spread:{' '}
                              {formatPrice(
                                game.market.homeSpread,
                                game.market.homeSpreadOdds,
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_175px] sm:items-center">
                      <div className="space-y-3">
                        <TeamRow
                          team={game.away}
                          probability={1 - game.adjustedHome}
                          favored={!homeFavorite}
                        />
                        <TeamRow
                          team={game.home}
                          probability={game.adjustedHome}
                          favored={homeFavorite}
                          home
                        />
                      </div>
                      <div className="rounded-xl border border-[#e9b949]/25 bg-[#e9b949]/8 p-3.5 sm:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#e9b949]">
                          Model pick
                        </p>
                        <p className="mt-1 text-base font-bold text-white">
                          {favorite}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-[#f6d787]">
                          {(favoriteProbability * 100).toFixed(1)}% win
                        </p>
                        {game.market && (
                          <div className="mt-3 border-t border-[#e9b949]/20 pt-2 text-left sm:text-right">
                            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#e9b949]">
                              Live spread
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-white">
                              {formatPrice(
                                game.market.homeSpread,
                                game.market.homeSpreadOdds,
                              )}{' '}
                              <span className="font-normal text-slate-400">
                                home
                              </span>
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-[#f6d787]">
                              Selection: {spreadSelectionFor(game)}
                            </p>
                          </div>
                        )}
                        <p className="mt-2 text-[11px] leading-4 text-slate-400">
                          {newsMove
                            ? `Live inputs moved home win ${game.delta > 0 ? 'up' : 'down'} ${Math.abs(game.delta * 100).toFixed(1)} pts`
                            : 'No applied live adjustment'}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {forecast && (
              <div className="mt-5 rounded-xl border border-sky-100/10 bg-[#0b2030]/75 p-4 text-xs leading-5 text-slate-400">
                <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
                  <span>
                    <strong className="text-slate-200">Baseline:</strong>{' '}
                    {forecast.model.label}
                  </span>
                  <a
                    className="inline-flex items-center gap-1 text-sky-300 hover:text-white"
                    href={forecast.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View official schedule <ArrowUpRight className="size-3" />
                  </a>
                </div>
                <p className="mt-2">
                  {forecast.model.notes} Schedule refreshed{' '}
                  {asDate(forecast.retrievedAt)}.
                </p>
              </div>
            )}
            {learning && <PickHistory outcomes={learning.outcomes} />}
          </div>
          <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
            <section className="overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2333]/95">
              <div className="border-b border-sky-100/10 px-5 py-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-[#e9b949]" />
                  <h2 className="font-bold text-white">
                    Live adjustment ledger
                  </h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Refreshes every 5 minutes while this page is open.
                </p>
              </div>
              <div className="space-y-3 p-4">
                {!live && (
                  <p className="text-sm text-slate-400">
                    Checking league inputs…
                  </p>
                )}
                {live?.updates.length === 0 && (
                  <p className="text-sm leading-6 text-slate-400">
                    {live.feedStatus}
                  </p>
                )}
                {live?.updates.slice(0, 6).map((update, index) => (
                  <div
                    key={`${update.headline}-${index}`}
                    className="rounded-xl border border-sky-100/8 bg-[#071a28]/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${update.status === 'Applied' ? 'bg-emerald-300/12 text-emerald-200' : 'bg-slate-300/8 text-slate-400'}`}
                      >
                        {update.status}
                      </span>
                      {update.impact !== 0 && (
                        <span
                          className={
                            update.impact > 0
                              ? 'text-xs font-semibold text-emerald-200'
                              : 'text-xs font-semibold text-rose-200'
                          }
                        >
                          {signed(update.impact)} rating
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-semibold leading-5 text-slate-200">
                      {update.team}
                    </p>
                    <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-slate-400">
                      {update.headline}
                    </p>
                    {update.link && (
                      <a
                        href={update.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-white"
                      >
                        Source <ChevronRight className="size-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-sky-100/10 bg-[#0b2030]/80 p-5">
              <div className="flex gap-2">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-sky-300" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    How a live update changes a game
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Only a clear team + availability/transaction signal changes
                    a rating. The effect is capped at ±1.50. Vague reports stay
                    in the ledger but do not change a pick.
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-sky-100/10 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
                  Sources
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {live?.sources.map((source) => (
                    <a
                      key={source.url}
                      className="text-xs text-sky-300 hover:text-white"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.label}
                    </a>
                  ))}
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e9b949]/20 bg-[#e9b949]/[.06] p-5">
              <div className="flex gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#e9b949]" />
                <p className="text-xs leading-5 text-slate-300">
                  A probability is not a promise. This desk does not publish
                  fabricated score projections or claim to catch every report.
                  Its job is to make each input, refresh time, and adjustment
                  inspectable.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-sky-100/10 px-4 py-3 last:border-r-0">
      <p className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-white">{value}</p>
    </div>
  );
}
function BettingBoard({
  games,
  market,
}: {
  games: RenderedGame[];
  market: Market | null;
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-[#e9b949]/25 bg-[#102638]/95">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sky-100/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#e9b949]">
            Betting-market comparison
          </p>
          <h3 className="mt-0.5 font-bold text-white">
            Lines, probabilities, and a clean separation from the model.
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            The football forecast remains independent. The board is a
            timestamped research comparison, not an automated betting
            recommendation.
          </p>
        </div>
        {market && (
          <a
            href={market.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-white"
          >
            {market.source.label} <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
      {!market ? (
        <p className="px-5 py-6 text-sm text-slate-400">
          Refreshing the market reference. No prior odds are shown as current.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100/10 bg-[#071a28]/60 px-5 py-2.5 text-xs text-slate-400">
            <span>
              Observed {asDate(market.observedAt)} · Week {market.week}
            </span>
            <span>{market.lines.length} market matchups</span>
          </div>
          <div className="divide-y divide-sky-100/8">
            {games.map((game) => {
              const line = game.market;
              const marketHome = line?.homeImpliedProbability ?? null;
              const difference =
                marketHome === null ? null : game.adjustedHome - marketHome;
              const label =
                difference === null
                  ? 'No paired moneyline'
                  : Math.abs(difference) < 0.03
                    ? 'No material separation'
                    : 'Review disagreement';
              const spreadEdge =
                line?.homeSpread === null || line?.homeSpread === undefined
                  ? null
                  : game.expectedMargin + line.homeSpread;
              const spreadSelection =
                spreadEdge === null
                  ? 'No spread line'
                  : spreadEdge >= 0.25
                    ? `${game.home} ${formatPrice(line.homeSpread, line.homeSpreadOdds)}`
                    : spreadEdge <= -0.25
                      ? `${game.away} ${formatPrice(line.awaySpread, line.awaySpreadOdds)}`
                      : 'Pass — no clear spread edge';
              const moneylineSelection =
                game.adjustedHome >= 0.5
                  ? `${game.home} ${formatOdds(line?.homeMoneyline ?? null)}`
                  : `${game.away} ${formatOdds(line?.awayMoneyline ?? null)}`;
              return (
                <div key={`market-${game.id}`} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">
                        {game.away} at {game.home}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Moneyline: {formatOdds(line?.awayMoneyline ?? null)} /{' '}
                        {formatOdds(line?.homeMoneyline ?? null)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#e9b949]/30 bg-[#e9b949]/10 px-3 py-2 text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#e9b949]">
                        Model selections
                      </p>
                      <p className="mt-1 text-xs font-semibold text-white">
                        ML: {moneylineSelection}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-[#f6d787]">
                        Spread: {spreadSelection}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 text-xs md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_170px]">
                    <div className="rounded-lg border border-sky-100/10 bg-[#071a28]/60 px-3 py-2.5">
                      <p className="font-bold uppercase tracking-[.1em] text-slate-500">
                        Full current board
                      </p>
                      <p className="mt-1.5 text-slate-300">
                        Spread:{' '}
                        {formatPrice(
                          line?.awaySpread ?? null,
                          line?.awaySpreadOdds ?? null,
                        )}{' '}
                        away ·{' '}
                        {formatPrice(
                          line?.homeSpread ?? null,
                          line?.homeSpreadOdds ?? null,
                        )}{' '}
                        home
                      </p>
                      <p className="mt-1 text-slate-300">
                        Total: {formatLine(line?.totalLine ?? null)} · Over{' '}
                        {formatOdds(line?.overOdds ?? null)} / Under{' '}
                        {formatOdds(line?.underOdds ?? null)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-sky-100/10 bg-[#071a28]/60 px-3 py-2.5">
                      <div>
                        <p className="text-slate-500">Football model</p>
                        <p className="mt-0.5 font-semibold text-white">
                          {(game.adjustedHome * 100).toFixed(1)}% {game.home}
                        </p>
                        <p className="mt-1 text-slate-400">
                          Margin proxy {formatSigned(game.expectedMargin)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Vig-free market</p>
                        <p className="mt-0.5 font-semibold text-white">
                          {marketHome === null
                            ? '—'
                            : `${(marketHome * 100).toFixed(1)}% ${game.home}`}
                        </p>
                        <p className="mt-1 text-slate-400">
                          {market?.source.label}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-sky-100/10 bg-[#071a28]/70 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">
                        Market status
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#f6d787]">
                        {label}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        ML{' '}
                        {difference === null
                          ? 'track only'
                          : `${difference > 0 ? '+' : ''}${(difference * 100).toFixed(1)} pts to home`}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Spread edge{' '}
                        {spreadEdge === null
                          ? '—'
                          : `${spreadEdge > 0 ? '+' : ''}${spreadEdge.toFixed(1)} pts`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-sky-100/10 px-5 py-3 text-xs leading-5 text-slate-400">
            {market.note} Every refresh is retained as an immutable market
            snapshot. The spread selection is a transparent strength-margin
            proxy; it is not presented as a validated cover probability. Totals
            remain informational until a separate, out-of-sample-tested total
            model is available.
          </div>
        </>
      )}
    </section>
  );
}
function HistoricalPerformance({
  historical,
}: {
  historical: HistoricalBacktest;
}) {
  const widestCalibrationGap = [...historical.calibration].sort(
    (left, right) => left.gap - right.gap,
  )[0];
  const accuracyInterval = historical.overall.accuracyInterval95;
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-[#e9b949]/30 bg-[#102638]/95 shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sky-100/10 px-5 py-4">
        <div className="flex gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[#e9b949]/15 text-[#f6d787]">
            <Target className="size-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#e9b949]">
              Historical accuracy
            </p>
            <h3 className="mt-0.5 font-bold text-white">
              {formatPercent(historical.overall.accuracy)} winner accuracy in a
              frozen five-season replay
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              {historical.overall.correct} correct picks and{' '}
              {historical.overall.incorrect} incorrect picks across{' '}
              {historical.overall.games.toLocaleString()} graded games from{' '}
              {historical.seasons[0]}–{historical.seasons.at(-1)}.
              {accuracyInterval && (
                <>
                  {' '}
                  The 95% accuracy interval is{' '}
                  {formatPercent(accuracyInterval.low)}–
                  {formatPercent(accuracyInterval.high)}.
                </>
              )}
            </p>
          </div>
        </div>
        <a
          href={historical.source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-white"
        >
          {historical.source.label} <ArrowUpRight className="size-3" />
        </a>
      </div>

      <div className="grid divide-y divide-sky-100/10 border-b border-sky-100/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <HistoricalMetric
          label="Regular season"
          value={formatPercent(historical.regularSeason.accuracy)}
          detail={`${historical.regularSeason.correct}–${historical.regularSeason.incorrect}`}
        />
        <HistoricalMetric
          label="Postseason"
          value={formatPercent(historical.postseason.accuracy)}
          detail={`${historical.postseason.correct}–${historical.postseason.incorrect}`}
        />
        <HistoricalMetric
          label="2025 locked holdout"
          value={formatPercent(historical.holdout?.overall.accuracy ?? null)}
          detail={
            historical.holdout
              ? `${historical.holdout.overall.correct}–${historical.holdout.overall.incorrect}`
              : 'Unavailable'
          }
        />
        <HistoricalMetric
          label="Probability quality"
          value={formatMetric(historical.overall.brier)}
          detail="Brier score · lower is better"
        />
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(250px,0.65fr)]">
        <div className="overflow-x-auto rounded-xl border border-sky-100/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="border-b border-sky-100/10 bg-[#071a28]/65 px-4 py-3 text-left text-xs font-bold uppercase tracking-[.13em] text-slate-400">
              Year-by-year locked results
            </caption>
            <thead className="bg-[#071a28]/40 text-xs uppercase tracking-[.1em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Season</th>
                <th className="px-4 py-3 font-semibold">Overall</th>
                <th className="px-4 py-3 font-semibold">Regular</th>
                <th className="px-4 py-3 font-semibold">Postseason</th>
                <th className="px-4 py-3 font-semibold">Brier</th>
                <th className="px-4 py-3 font-semibold">Margin MAE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/8 text-slate-200">
              {historical.bySeason.map((season) => (
                <tr key={season.season} className="bg-[#0b2030]/50">
                  <td className="px-4 py-3 font-semibold text-white">
                    {season.season}{' '}
                    {season.season === 2025 && (
                      <span className="ml-1 rounded-full bg-[#e9b949]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f6d787]">
                        Holdout
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {formatPercent(season.overall.accuracy)}{' '}
                    <span className="text-xs text-slate-500">
                      {season.overall.correct}–{season.overall.incorrect}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {formatPercent(season.regularSeason.accuracy)}
                  </td>
                  <td className="px-4 py-3">
                    {formatPercent(season.postseason.accuracy)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMetric(season.overall.brier)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMetric(season.overall.marginMae, 1)} pts
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-sky-100/10 bg-[#071a28]/65 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
              Calibration signal
            </p>
            {widestCalibrationGap ? (
              <p className="mt-2 text-sm leading-6 text-slate-200">
                In the {widestCalibrationGap.label} confidence bucket, the model
                predicted {formatPercent(widestCalibrationGap.predicted)} but
                picks won {formatPercent(widestCalibrationGap.actual)}. This is
                a calibration warning, not a reason to rewrite past predictions.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                Calibration groups are still loading.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-sky-100/10 bg-[#071a28]/65 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
              Replay rules
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {historical.methodology.freezeRule}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {historical.methodology.holdoutRule}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-sky-100/10 bg-[#071a28]/35 px-5 py-4 lg:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
            Highest-confidence misses to review
          </p>
          <div className="mt-2 space-y-2">
            {historical.worstMisses.slice(0, 3).map((miss) => (
              <div
                key={miss.gameId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-sky-100/8 bg-[#0b2030]/70 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-slate-200">
                  {miss.season} · {miss.away} at {miss.home}
                </span>
                <span className="text-slate-400">
                  Called {miss.predictedWinner} at{' '}
                  {formatPercent(miss.pickProbability)} · won by {miss.winner}
                </span>
              </div>
            ))}
          </div>
        </div>
        <details className="rounded-xl border border-[#e9b949]/20 bg-[#e9b949]/[.05] px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-[#f6d787]">
            Method and data limits
          </summary>
          <ul className="mt-3 space-y-2 pl-5 text-xs leading-5 text-slate-300">
            {historical.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
function HistoricalMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
function LearningPanel({ learning }: { learning: Learning }) {
  const latest = learning.runs[0];
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-sky-300/15 bg-[#0a2638]/95">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sky-100/10 px-5 py-4">
        <div className="flex gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-sky-300/10 text-sky-300">
            <BrainCircuit className="size-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-sky-300">
              Weekly learning loop
            </p>
            <h3 className="mt-0.5 font-bold text-white">
              Results become calibration, not a rewrite.
            </h3>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-slate-400">Season accuracy</p>
          <p className="mt-0.5 text-lg font-bold text-white">
            {learning.record.accuracy === null
              ? '—'
              : `${(learning.record.accuracy * 100).toFixed(1)}%`}
          </p>
        </div>
      </div>
      <div className="grid gap-px bg-sky-100/10 sm:grid-cols-4">
        <LearningMetric
          label="Correct picks"
          value={String(learning.record.correct)}
          detail={`${learning.record.incorrect} incorrect`}
        />
        <LearningMetric
          label="Model Brier"
          value={
            learning.record.brierScore === null
              ? '—'
              : learning.record.brierScore.toFixed(3)
          }
          detail="Lower is better"
        />
        <LearningMetric
          label="Market Brier"
          value={
            learning.record.marketBrierScore === null
              ? '—'
              : learning.record.marketBrierScore.toFixed(3)
          }
          detail={
            learning.record.brierDeltaVsMarket === null
              ? 'Paired odds pending'
              : `${learning.record.brierDeltaVsMarket <= 0 ? 'Model ahead' : 'Market ahead'} ${Math.abs(learning.record.brierDeltaVsMarket).toFixed(3)}`
          }
        />
        <LearningMetric
          label="Frozen forecasts"
          value={String(learning.record.captured)}
          detail={`${learning.pendingSnapshots} awaiting result`}
        />
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div className="flex items-center gap-2">
            <Target className="size-4 text-[#e9b949]" />
            <h4 className="text-sm font-bold text-white">Latest model audit</h4>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {latest?.insight ??
              'No completed week with a full captured slate yet. Forecast snapshots are being collected for the first audit.'}
          </p>
          {latest && (
            <p className="mt-2 text-xs text-slate-500">
              Week {latest.week}: {latest.correctPicks}/{latest.gradedGames}{' '}
              picks correct · Brier {latest.brierScore.toFixed(3)}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-sky-100/10 bg-[#071a28]/80 p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
            Active next-week guardrails
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-100">
            Venue edge {signed(learning.state.homeFieldAdjustment)} pts
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            Confidence pull{' '}
            {(learning.state.confidenceShrinkage * 100).toFixed(1)}%
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {learning.state.completedWeeks} completed weekly audit
            {learning.state.completedWeeks === 1 ? '' : 's'}; every adjustment
            is capped.
          </p>
        </div>
      </div>
      <p className="border-t border-sky-100/10 px-5 py-3 text-xs leading-5 text-slate-400">
        {learning.note}
      </p>
    </section>
  );
}
function LearningMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-[#0b2030] px-5 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
function PickHistory({ outcomes }: { outcomes: Learning['outcomes'] }) {
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2333]/95">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-sky-300">
            Overall pick record
          </p>
          <h3 className="mt-0.5 font-bold text-white">
            Every settled forecast
          </h3>
        </div>
        <span className="rounded-full border border-sky-100/10 bg-[#071a28] px-3 py-1 text-xs text-slate-300">
          {outcomes.length} graded game{outcomes.length === 1 ? '' : 's'}
        </span>
      </div>
      {outcomes.length === 0 ? (
        <p className="px-5 py-6 text-sm leading-6 text-slate-400">
          Results will appear here after a captured game is final. Each row
          retains the frozen pick and final score.
        </p>
      ) : (
        <div className="divide-y divide-sky-100/8">
          {outcomes.map((outcome) => (
            <div
              key={outcome.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3"
            >
              <span
                className={`grid size-7 place-items-center rounded-full text-xs font-bold ${outcome.correct ? 'bg-emerald-300/12 text-emerald-200' : 'bg-rose-300/12 text-rose-200'}`}
              >
                {outcome.correct ? '✓' : '×'}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">
                  W{outcome.week} · {outcome.away} {outcome.awayScore} at{' '}
                  {outcome.home} {outcome.homeScore}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Pick: {outcome.pick} · Winner: {outcome.winner} ·{' '}
                  {(outcome.favoriteProbability * 100).toFixed(1)}% confidence
                </p>
              </div>
              <span
                className={`text-xs font-semibold ${outcome.correct ? 'text-emerald-200' : 'text-rose-200'}`}
              >
                {outcome.correct ? 'Correct' : 'Incorrect'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function TeamRow({
  team,
  probability,
  favored,
  home = false,
}: {
  team: string;
  probability: number;
  favored: boolean;
  home?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${favored ? 'bg-[#e9b949] shadow-[0_0_10px_rgba(233,185,73,.7)]' : 'bg-slate-600'}`}
          />
          <p
            className={`truncate text-sm ${favored ? 'font-bold text-white' : 'font-medium text-slate-300'}`}
          >
            {team}
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">
              {home ? 'home' : 'away'}
            </span>
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700/70">
          <div
            className={`h-full rounded-full ${favored ? 'bg-[#e9b949]' : 'bg-sky-400/70'}`}
            style={{ width: `${Math.max(3, probability * 100)}%` }}
          />
        </div>
      </div>
      <p
        className={`text-right text-sm ${favored ? 'font-bold text-white' : 'text-slate-300'}`}
      >
        {(probability * 100).toFixed(1)}%
      </p>
    </div>
  );
}
function Notice({ tone, text }: { tone: 'error' | 'warn'; text: string }) {
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-rose-300/25 bg-rose-300/8 text-rose-100' : 'border-[#e9b949]/25 bg-[#e9b949]/8 text-[#f6d787]'}`}
    >
      {text}
    </div>
  );
}
function LoadingCards() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((key) => (
        <div
          key={key}
          className="h-36 animate-pulse rounded-2xl border border-sky-100/8 bg-[#0c2333]"
        />
      ))}
    </div>
  );
}

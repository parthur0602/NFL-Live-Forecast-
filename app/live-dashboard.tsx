'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Database,
  Eye,
  Gauge,
  Info,
  LoaderCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type SpreadProbabilities = {
  homeCover: number;
  push: number;
  awayCover: number;
};
type Market = {
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  awaySpread: number | null;
  homeSpread: number | null;
  totalLine: number | null;
  awaySpreadOdds: number | null;
  homeSpreadOdds: number | null;
  awayImpliedProbability: number | null;
  homeImpliedProbability: number | null;
  expectedHomeMargin: number | null;
  spreadProbabilities: SpreadProbabilities | null;
  betting: {
    selection: string;
    homeEdge: number | null;
    awayEdge: number | null;
    policy: string;
  };
};
type SlateGame = {
  gameKey: string;
  away: string;
  home: string;
  scheduledKickoffAt: string | null;
  captureHorizon: string;
  marketHomeProbability: number | null;
  marketSource: string | null;
  marketObservedAt: string | null;
  v2OfficialProbability: number;
  v2OfficialPick: string;
  v5ShadowProbability: number | null;
  v5ShadowPick: string | null;
  v5MinusV2ProbabilityDelta: number | null;
  disagreement: boolean;
  featureDataThroughWeek: number | null;
  v5Available: boolean;
  v5UnavailableReason: string | null;
  market: Market | null;
};
type Slate = {
  season: number;
  week: number;
  retrievedAt: string;
  label: string;
  capture: {
    attempted: number;
    accepted: number;
    skippedAfterKickoff: number;
    inserted: number;
    duplicateOrExisting: number;
    captureBucket: string;
  };
  games: SlateGame[];
  v5Artifact: { version: string; hash: string; productionInfluence: number };
  error?: string;
  detail?: string;
};
type ApiEnvelope<T> = T & { error?: string; detail?: string };
type DashboardData = {
  databaseCheckedAt: string;
  marketHistory: Array<Record<string, unknown>>;
  prospectiveHistory: Array<Record<string, unknown>>;
  efficiency: Array<Record<string, unknown>>;
  footballState: Array<Record<string, unknown>>;
  playerAvailability: Array<Record<string, unknown>>;
  specialists: Array<Record<string, unknown>>;
  learningRuns: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
  summary: Record<string, unknown> | null;
  recentPostmortems: Array<Record<string, unknown>>;
  production: {
    v2Version: string;
    v2FootballCorrectionWeight: number;
    marketBaselineProductionWeight: number;
    v5Version: string;
    v5ArtifactHash: string;
    v5ProductionInfluence: number;
    policy: string;
  };
  error?: string;
  detail?: string;
};
type Learning = {
  record?: {
    correct: number;
    incorrect: number;
    total: number;
    accuracy: number | null;
    brierScore: number | null;
    marketBrierScore: number | null;
    expectedLosses: number | null;
    excessLosses: number | null;
    captured: number;
    prospectiveSnapshots: number;
  };
  memory?: {
    postmortems: number;
    errors: number;
    successes: number;
    specialists: Array<Record<string, unknown>>;
    notable: Array<Record<string, unknown>>;
  };
  runs?: Array<Record<string, unknown>>;
  note?: string;
  error?: string;
  detail?: string;
};

const AUTO_REFRESH_MS = 45_000;
const RESEARCH_REFRESH_MS = 5 * 60_000;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
function pct(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Unavailable'
    : `${(value * 100).toFixed(digits)}%`;
}
function number(value: number | null | undefined, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}
function price(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}`;
}
function spread(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}`;
}
function time(value: string | null | undefined) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
}
function relative(value: string | null | undefined) {
  if (!value) return 'No capture yet';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return value;
  const minutes = Math.round(Math.abs(delta) / 60_000);
  return delta < 0 ? `in ${minutes}m` : minutes < 2 ? 'just now' : `${minutes}m ago`;
}
function statusForKickoff(kickoff: string | null) {
  if (!kickoff) return 'Scheduled';
  const ms = new Date(kickoff).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'Scheduled';
  if (ms <= 0) return 'Kickoff passed';
  if (ms < 2 * 60 * 60_000) return 'Near kickoff';
  return 'Upcoming';
}
function confidence(probability: number) {
  const favorite = Math.max(probability, 1 - probability);
  if (favorite >= 0.7) return 'High';
  if (favorite >= 0.6) return 'Medium';
  return 'Low';
}
function parseJson(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
    const body = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok) throw new Error(body.error ?? 'Refresh failed.');
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The live data source took too long to respond. Press Refresh to try again.');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' | 'neutral' }) {
  const classes = {
    green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
    red: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
    blue: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
    neutral: 'border-white/10 bg-white/5 text-slate-300',
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase ${classes[tone]}`}>{children}</span>;
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1927]/85 p-4 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold tracking-[0.13em] text-slate-400 uppercase">
        <span>{label}</span>{icon}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
      {detail && <p className="mt-1 min-h-5 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100"><CircleAlert className="mr-2 inline size-4" />{message}</div>;
}

function LoadingSlate() {
  return <div className="grid gap-3 lg:grid-cols-2">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-64 rounded-2xl bg-slate-800" />)}</div>;
}

export function LiveDashboard({ onOpenLegacy }: { onOpenLegacy: () => void }) {
  const [week, setWeek] = useState(1);
  const [slate, setSlate] = useState<Slate | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [historical, setHistorical] = useState<Record<string, unknown> | null>(null);
  const [research, setResearch] = useState<Record<string, unknown> | null>(null);
  const [exam, setExam] = useState<Record<string, unknown> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [slateError, setSlateError] = useState<string | null>(null);
  const [slowError, setSlowError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<SlateGame | null>(null);
  const [detail, setDetail] = useState<DashboardData | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [atlasSort, setAtlasSort] = useState<'positive' | 'negative' | 'sample' | 'z'>('positive');
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const slateRequestRef = useRef<{ week: number; request: Promise<Slate> } | null>(null);
  const slateRequestIdRef = useRef(0);

  const refreshSlate = useCallback(async (requestedWeek: number, manual = false) => {
    if (manual) setRefreshing(true);
    const existing = slateRequestRef.current;
    if (existing?.week === requestedWeek) {
      try {
        setSlate(existing ? await existing.request : null);
      } catch (error) {
        setSlateError(error instanceof Error ? error.message : 'Current slate could not refresh.');
      } finally {
        if (manual) setRefreshing(false);
      }
      return;
    }
    const requestId = ++slateRequestIdRef.current;
    const request = getJson<Slate>(`/api/prospective-exam?week=${requestedWeek}&refresh=${Date.now()}`);
    slateRequestRef.current = { week: requestedWeek, request };
    try {
      setSlateError(null);
      const value = await request;
      if (requestId === slateRequestIdRef.current) setSlate(value);
    } catch (error) {
      if (requestId === slateRequestIdRef.current) setSlateError(error instanceof Error ? error.message : 'Current slate could not refresh.');
    } finally {
      if (slateRequestRef.current?.request === request) slateRequestRef.current = null;
      if (manual) setRefreshing(false);
    }
  }, []);

  const refreshSlow = useCallback(async (requestedWeek: number) => {
    try {
      setSlowError(null);
      const [state, learn, history, study, report, news] = await Promise.all([
        getJson<DashboardData>(`/api/dashboard?week=${requestedWeek}`),
        getJson<Learning>('/api/learning'),
        getJson<Record<string, unknown>>('/api/historical'),
        getJson<Record<string, unknown>>('/api/research'),
        getJson<Record<string, unknown>>('/api/prospective-exam?report=1'),
        getJson<Record<string, unknown>>('/api/live'),
      ]);
      setDashboard(state);
      setLearning(learn);
      setHistorical(history);
      setResearch(study);
      setExam(report);
      setLive(news);
    } catch (error) {
      setSlowError(error instanceof Error ? error.message : 'Research state could not refresh.');
    }
  }, []);

  useEffect(() => {
    void refreshSlate(week);
    void refreshSlow(week);
  }, [week, refreshSlate, refreshSlow]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshSlate(week), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [week, refreshSlate]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshSlow(week), RESEARCH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [week, refreshSlow]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetail(null);
    setDetailError(null);
    void getJson<DashboardData>(`/api/dashboard?week=${week}&gameKey=${encodeURIComponent(selected.gameKey)}`)
      .then((value) => { if (active) setDetail(value); })
      .catch((error: unknown) => { if (active) setDetailError(error instanceof Error ? error.message : 'Game research state could not load.'); });
    return () => { active = false; };
  }, [selected, week]);

  const currentGames = slate?.games ?? [];
  const liveGames = currentGames.filter((game) => statusForKickoff(game.scheduledKickoffAt) !== 'Kickoff passed');
  const nextGame = [...liveGames].sort((left, right) => (new Date(left.scheduledKickoffAt ?? '').getTime() || Number.MAX_SAFE_INTEGER) - (new Date(right.scheduledKickoffAt ?? '').getTime() || Number.MAX_SAFE_INTEGER))[0] ?? currentGames[0] ?? null;
  const slateV5Available = currentGames.filter((game) => game.v5Available).length;
  const canonical = learning?.record;
  const systems = useMemo(() => {
    const v5Reason = currentGames.find((game) => !game.v5Available)?.v5UnavailableReason;
    return [
      { label: 'NFL schedule', state: slateError ? 'Error' : currentGames.length ? 'Healthy' : 'Unavailable', detail: slate?.retrievedAt ?? slateError ?? 'Awaiting schedule refresh' },
      { label: 'Market source', state: currentGames.some((game) => game.market) ? 'Healthy' : 'Unavailable', detail: currentGames.find((game) => game.market)?.marketSource ?? 'No usable current market line' },
      { label: '2026 team efficiency', state: slateV5Available ? 'Healthy' : 'Unavailable', detail: slateV5Available ? 'Prior-week data available' : v5Reason ?? 'No prior-week team data' },
      { label: 'News feed', state: live ? 'Healthy' : 'Unavailable', detail: asText(live?.feedStatus) ?? 'Not refreshed' },
      { label: 'D1 database', state: dashboard?.error ? 'Error' : dashboard ? 'Healthy' : 'Unavailable', detail: dashboard?.databaseCheckedAt ?? dashboard?.detail ?? 'Not refreshed' },
      { label: 'Prospective exam', state: slate?.capture ? 'Healthy' : 'Unavailable', detail: slate?.capture ? `${slate.capture.inserted} inserted; ${slate.capture.duplicateOrExisting} hourly deduplicated` : 'Not refreshed' },
      { label: 'V5 artifact', state: slate?.v5Artifact.productionInfluence === 0 ? 'Healthy' : 'Error', detail: slate?.v5Artifact ? `${slate.v5Artifact.version}; shadow influence 0` : 'Not refreshed' },
      { label: 'Learning settlement', state: learning?.error ? 'Error' : learning ? 'Healthy' : 'Unavailable', detail: learning?.note ?? learning?.detail ?? 'Not refreshed' },
    ];
  }, [currentGames, dashboard, learning, live, slate, slateError, slateV5Available]);

  const benchmark = (historical?.currentBenchmark as Record<string, unknown> | undefined)?.metrics as Record<string, unknown> | undefined;
  const benchmarkAccuracy = asNumber(benchmark?.accuracy) ?? 0.6633802816901408;
  const benchmarkCorrect = asNumber(benchmark?.correct) ?? 942;
  const benchmarkIncorrect = asNumber(benchmark?.incorrect) ?? 478;
  const benchmarkBrier = asNumber(benchmark?.brier) ?? 0.21149351343943848;
  const benchmarkLogLoss = asNumber(benchmark?.logLoss) ?? 0.6102688000087197;
  const memory = learning?.memory;
  const replay = (historical?.v4 as Record<string, unknown> | undefined)?.replay as Record<string, unknown> | undefined;
  const labPostmortems = asNumber(replay?.gamesStudied) ?? asNumber(memory?.postmortems) ?? 1420;
  const labErrors = asNumber(replay?.errorMemory) ?? asNumber(memory?.errors) ?? 387;
  const labSuccesses = asNumber(replay?.successMemory) ?? asNumber(memory?.successes) ?? 942;
  const labPromoted = asNumber(replay?.specialistsPromoted) ?? 0;
  const promotedSpecialists = (memory?.specialists ?? []).filter((row) => (asNumber(row.production_weight) ?? 0) > 0 && String(row.code) !== 'market_baseline').length;
  const healthySystems = systems.filter((system) => system.state === 'Healthy').length;

  return (
    <main className="min-h-screen bg-[#06111d] text-slate-100 selection:bg-sky-400/30">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(14,116,144,.18),transparent_35%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,.15),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-5 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2"><Pill tone="green">OFFICIAL · V2 PRODUCTION</Pill><Pill tone="blue">2026–27</Pill><Pill tone="amber">SHADOW · V5 / V6 RESEARCH</Pill></div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">NFL Live Forecast</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">Server-computed market-first forecasts, a strictly prospective V5 exam, and research evidence kept separate from production.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-400">Week <select aria-label="Forecast week" value={week} onChange={(event) => setWeek(Number(event.target.value))} className="ml-1 bg-transparent font-bold text-white outline-none">{Array.from({ length: 18 }, (_, index) => <option className="bg-slate-900" key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
            <Button variant="outline" size="sm" onClick={() => void refreshSlate(week, true)} className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"><RefreshCw className={`mr-1 size-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
            <Button variant="outline" size="sm" onClick={onOpenLegacy} className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10">Full analysis desk <ChevronRight className="ml-1 size-3.5" /></Button>
          </div>
        </header>

        <NextGame game={nextGame} retrievedAt={slate?.retrievedAt ?? null} marketHistory={dashboard?.marketHistory ?? []} prospectiveHistory={dashboard?.prospectiveHistory ?? []} />

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Upcoming games" value={slate ? String(liveGames.length) : '—'} detail={slate ? `Week ${slate.week} · ${currentGames.length} scheduled` : 'Loading schedule'} icon={<CalendarClock className="size-4 text-sky-300" />} />
          <MetricCard label="Current season record" value={canonical?.total ? `${canonical.correct}–${canonical.incorrect}` : 'No graded games'} detail={canonical?.total ? `${pct(canonical.accuracy)} accuracy · canonical picks` : 'Canonical record only'} icon={<Trophy className="size-4 text-amber-300" />} />
          <MetricCard label="System health" value={systems.length ? `${healthySystems}/${systems.length}` : '—'} detail={live ? 'Schedule, market, feed and D1 checks' : 'Checking live systems'} icon={<Gauge className="size-4 text-emerald-300" />} />
          <MetricCard label="Last slate refresh" value={slate ? relative(slate.retrievedAt) : '—'} detail={slate ? `Auto-refresh ≤45 sec · ${slate.capture.captureBucket}` : 'Waiting for server'} icon={<Radio className="size-4 text-emerald-300" />} />
        </section>

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[.10] to-[#0b1927] p-5 shadow-lg shadow-black/10">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[0.18em] text-emerald-300 uppercase">CURRENT MODEL BENCHMARK</p><h2 className="mt-1 text-xl font-black text-white">Historical benchmark</h2></div><Pill tone="green">V2 STATUS: PRODUCTION CHAMPION</Pill></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5"><MetricInline label="Accuracy" value={pct(benchmarkAccuracy)} /><MetricInline label="Correct" value={number(benchmarkCorrect, 0)} /><MetricInline label="Incorrect" value={number(benchmarkIncorrect, 0)} /><MetricInline label="Brier" value={number(benchmarkBrier, 3)} /><MetricInline label="Log loss" value={number(benchmarkLogLoss, 3)} /></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-400">2021–2025 decided games · frozen market-anchored benchmark</p><Button size="sm" variant="outline" onClick={() => setBenchmarkOpen(true)} className="border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20">View Historical Lab <ChevronRight className="ml-1 size-3.5" /></Button></div>
          </div>
          <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-400/[.10] to-[#0b1927] p-5 shadow-lg shadow-black/10">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.18em] text-violet-300 uppercase">V4 SELF-LEARNING LAB</p><h2 className="mt-1 text-xl font-black text-white">Research memory</h2></div><BrainCircuit className="size-5 text-violet-300" /></div>
            <div className="mt-4 grid grid-cols-2 gap-3"><MetricInline label="Postmortems" value={number(labPostmortems, 0)} /><MetricInline label="Error memories" value={number(labErrors, 0)} /><MetricInline label="Success memories" value={number(labSuccesses, 0)} /><MetricInline label="Specialists promoted" value={number(Math.max(labPromoted, promotedSpecialists), 0)} /></div>
            <p className="mt-4 text-xs leading-relaxed text-slate-400">The model reviews completed games, records meaningful mistakes and successful patterns, and tests specialists on future games before allowing them to influence predictions.</p>
            <Button size="sm" variant="outline" onClick={() => setResearchOpen(true)} className="mt-4 border-violet-300/30 bg-violet-300/10 text-violet-100 hover:bg-violet-300/20">View research lab <ChevronRight className="ml-1 size-3.5" /></Button>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-[#0b1927]/90 p-4 shadow-lg shadow-black/10"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.18em] text-sky-300 uppercase">SYSTEM & FEED HEALTH</p><p className="mt-1 text-sm text-slate-300">Production decisions stay on V2. Research signals stay separate until they prove themselves prospectively.</p></div><div className="flex flex-wrap gap-2">{systems.map((system) => <Pill key={system.label} tone={system.state === 'Healthy' ? 'green' : system.state === 'Error' ? 'red' : system.state === 'Stale' ? 'amber' : 'neutral'}>{system.label}: {system.state}</Pill>)}</div></div></section>

        {slateError && <div className="mb-5"><ErrorBox message={slateError} /></div>}
        {slowError && <div className="mb-5"><ErrorBox message={`Background research: ${slowError}`} /></div>}

        <CurrentSlate games={currentGames} loading={!slate && !slateError} onSelect={setSelected} marketHistory={dashboard?.marketHistory ?? []} prospectiveHistory={dashboard?.prospectiveHistory ?? []} />
      </div>
      <BenchmarkDialog open={benchmarkOpen} onOpenChange={setBenchmarkOpen} historical={historical} research={research} />
      <ResearchLabDialog open={researchOpen} onOpenChange={setResearchOpen} exam={exam} slate={slate} historical={historical} research={research} dashboard={dashboard} live={live} learning={learning} systems={systems} atlasSort={atlasSort} setAtlasSort={setAtlasSort} />
      <GameDetail game={selected} onClose={() => setSelected(null)} detail={detail} detailError={detailError} />
    </main>
  );
}

function NextGame({ game, retrievedAt, marketHistory, prospectiveHistory }: { game: SlateGame | null; retrievedAt: string | null; marketHistory: Array<Record<string, unknown>>; prospectiveHistory: Array<Record<string, unknown>> }) {
  if (!game) return null;
  const market = game.market;
  const movement = currentMovement(marketHistory.filter((row) => row.game_key === game.gameKey), prospectiveHistory.filter((row) => row.game_key === game.gameKey));
  const v2FavoriteProbability = game.v2OfficialPick === game.home ? game.v2OfficialProbability : 1 - game.v2OfficialProbability;
  return <section className="mb-6 overflow-hidden rounded-2xl border border-sky-300/25 bg-gradient-to-r from-sky-400/[.12] via-[#0b1927] to-violet-400/[.08] p-5 shadow-lg shadow-black/10"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[0.18em] text-sky-200 uppercase">Next game</p><h2 className="mt-1 text-2xl font-black text-white">{game.away} <span className="text-slate-500">at</span> {game.home}</h2><p className="mt-1 text-sm text-slate-300">{time(game.scheduledKickoffAt)} · {statusForKickoff(game.scheduledKickoffAt)}</p></div><div className="text-right text-xs text-slate-400"><p>Data updated {relative(retrievedAt)}</p><p className="mt-1">{movement ?? 'No prior captured market change.'}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3"><Pill tone="green">Official · V2 production</Pill><p className="mt-2 text-lg font-black text-white">{game.v2OfficialPick}</p><p className="text-sm text-emerald-100">Win probability {pct(v2FavoriteProbability)}</p></div><div className="rounded-xl border border-violet-300/25 bg-violet-400/10 p-3"><Pill tone="blue">Shadow · V5 / V6 research</Pill><p className="mt-2 text-sm font-bold text-white">{game.v5Available ? `${game.v5ShadowPick} · ${pct(game.v5ShadowProbability)}` : 'V5 unavailable'}</p><p className="mt-1 text-xs leading-relaxed text-violet-100">V6 shadow is unavailable until the historical lab is reviewed and connected. It cannot alter the official pick.</p></div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3"><p className="text-[10px] font-bold tracking-[0.14em] text-slate-400 uppercase">Market odds</p><p className="mt-2 font-bold text-white">ML {price(market?.awayMoneyline)} / {price(market?.homeMoneyline)}</p><p className="mt-1 text-sm text-slate-300">Spread {spread(market?.awaySpread)} / {spread(market?.homeSpread)}</p></div><div className="rounded-xl border border-white/10 bg-white/[.04] p-3"><p className="text-[10px] font-bold tracking-[0.14em] text-slate-400 uppercase">Decision status</p><p className="mt-2 font-bold text-white">{game.disagreement ? 'Official and shadow disagree' : 'No shadow disagreement'}</p><p className="mt-1 text-sm text-slate-300">{game.marketSource ?? 'Market source unavailable'}</p></div></div></section>;
}

function CurrentSlate({ games, loading, onSelect, marketHistory, prospectiveHistory }: { games: SlateGame[]; loading: boolean; onSelect: (game: SlateGame) => void; marketHistory: Array<Record<string, unknown>>; prospectiveHistory: Array<Record<string, unknown>> }) {
  if (loading) return <LoadingSlate />;
  if (!games.length) return <div className="rounded-2xl border border-white/10 bg-[#0b1927] p-8 text-center text-slate-400"><CloudOff className="mx-auto mb-3 size-8" />No current schedule games were returned by the NFL schedule source for this week.</div>;
  return <section><SectionHeading eyebrow="TODAY / CURRENT WEEK" title="Official V2 selections and shadow research status" detail="Click a game for its captured market history, research state, probabilities, and betting view." />
    <div className="grid gap-4 2xl:grid-cols-2">{games.map((game) => <GameCard game={game} key={game.gameKey} onClick={() => onSelect(game)} marketHistory={marketHistory} prospectiveHistory={prospectiveHistory} />)}</div>
  </section>;
}

function GameCard({ game, onClick, marketHistory, prospectiveHistory }: { game: SlateGame; onClick: () => void; marketHistory: Array<Record<string, unknown>>; prospectiveHistory: Array<Record<string, unknown>> }) {
  const market = game.market;
  const v2Away = 1 - game.v2OfficialProbability;
  const marketRows = marketHistory.filter((row) => row.game_key === game.gameKey);
  const modelRows = prospectiveHistory.filter((row) => row.game_key === game.gameKey);
  const movement = currentMovement(marketRows, modelRows);
  return <button type="button" onClick={onClick} className="group w-full rounded-2xl border border-white/10 bg-gradient-to-br from-[#0d2133] to-[#081725] p-4 text-left shadow-lg shadow-black/10 transition hover:border-sky-300/35 hover:from-[#10283d] focus:outline-none focus:ring-2 focus:ring-sky-300/50">
    <div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap items-center gap-2"><Pill tone={statusForKickoff(game.scheduledKickoffAt) === 'Near kickoff' ? 'amber' : 'blue'}>{statusForKickoff(game.scheduledKickoffAt)}</Pill><Pill tone="green">V2 OFFICIAL</Pill>{game.disagreement && <Pill tone="red">DISAGREEMENT</Pill>}</div><p className="text-xs text-slate-400">{time(game.scheduledKickoffAt)}</p></div><ChevronRight className="mt-2 size-5 text-slate-500 transition group-hover:text-sky-300" /></div>
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3"><div><p className="truncate text-lg font-black text-white">{game.away}</p><p className="mt-1 text-[10px] tracking-[0.13em] text-slate-500 uppercase">Away · {pct(v2Away)}</p></div><span className="pb-1 text-xs font-bold text-slate-600">at</span><div className="text-right"><p className="truncate text-lg font-black text-white">{game.home}</p><p className="mt-1 text-[10px] tracking-[0.13em] text-slate-500 uppercase">Home · {pct(game.v2OfficialProbability)}</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-white/8 py-3 text-xs sm:grid-cols-4"><DataCell label="V2 pick" value={game.v2OfficialPick} /><DataCell label="Market home" value={pct(game.marketHomeProbability)} /><DataCell label="Spread" value={market ? `${spread(market.awaySpread)} / ${spread(market.homeSpread)}` : 'Unavailable'} /><DataCell label="Moneyline" value={`${price(market?.awayMoneyline)} / ${price(market?.homeMoneyline)}`} /></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2"><Pill tone={game.v5Available ? 'blue' : 'neutral'}>Shadow · V5</Pill><span className="text-slate-400">{game.v5Available ? `${game.v5ShadowPick} · ${pct(game.v5ShadowProbability)}` : 'Unavailable until prior-week features exist'} · V6 lab pending review</span></div>{movement && <span className="flex items-center gap-1 text-sky-200"><Activity className="size-3.5" />{movement.replace('Observed change: ', '')}</span>}</div>
  </button>;
}

function TeamProbability({ team, probability, pick, side }: { team: string; probability: number; pick: boolean; side: string }) {
  return <div><p className="truncate text-base font-bold text-white">{team} {pick && <span className="ml-1 text-[10px] tracking-widest text-emerald-300">PICK</span>}</p><p className="mt-1 text-[10px] tracking-[0.13em] text-slate-500">{side}</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${pick ? 'bg-emerald-400' : 'bg-sky-400/70'}`} style={{ width: `${Math.max(2, probability * 100)}%` }} /></div><p className="mt-1.5 text-lg font-black text-white">{pct(probability)}</p></div>;
}
function currentMovement(marketRows: Array<Record<string, unknown>>, modelRows: Array<Record<string, unknown>>) {
  const parts: string[] = [];
  if (marketRows.length >= 2) {
    const latest = marketRows[0];
    const prior = marketRows[marketRows.length - 1];
    const moneyline = (asNumber(latest.home_moneyline) ?? 0) - (asNumber(prior.home_moneyline) ?? 0);
    const line = (asNumber(latest.home_spread) ?? 0) - (asNumber(prior.home_spread) ?? 0);
    if (moneyline) parts.push(`ML ${moneyline > 0 ? '+' : ''}${moneyline}`);
    if (line) parts.push(`spread ${line > 0 ? '+' : ''}${line.toFixed(1)}`);
  }
  if (modelRows.length >= 2) {
    const latest = modelRows[0];
    const prior = modelRows[modelRows.length - 1];
    const v2 = ((asNumber(latest.v2_home_probability) ?? 0) - (asNumber(prior.v2_home_probability) ?? 0)) * 100;
    const v5Latest = asNumber(latest.v5_home_probability);
    const v5Prior = asNumber(prior.v5_home_probability);
    if (v2) parts.push(`V2 ${v2 > 0 ? '+' : ''}${v2.toFixed(1)} pts`);
    if (v5Latest !== null && v5Prior !== null && v5Latest !== v5Prior) {
      const v5 = (v5Latest - v5Prior) * 100;
      parts.push(`V5 ${v5 > 0 ? '+' : ''}${v5.toFixed(1)} pts`);
    }
  }
  return parts.length ? `Observed change: ${parts.join(' · ')}. No cause is inferred.` : null;
}
function DataCell({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] tracking-[0.11em] text-slate-500 uppercase">{label}</p><p className="mt-1 truncate font-semibold text-slate-200">{value}</p></div>; }
function MetricInline({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2"><p className="text-[10px] font-semibold tracking-[0.11em] text-slate-500 uppercase">{label}</p><p className="mt-1 text-lg font-black text-white">{value}</p></div>; }
function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) { return <div className="mb-4"><p className="text-[10px] font-bold tracking-[0.18em] text-sky-300 uppercase">{eyebrow}</p><h2 className="mt-1 text-2xl font-black tracking-tight text-white">{title}</h2>{detail && <p className="mt-1 text-sm text-slate-400">{detail}</p>}</div>; }

function BenchmarkDialog({ open, onOpenChange, historical, research }: { open: boolean; onOpenChange: (open: boolean) => void; historical: Record<string, unknown> | null; research: Record<string, unknown> | null }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-[calc(100%-1rem)] overflow-y-auto border border-white/15 bg-[#091725] text-slate-100 sm:max-w-6xl"><DialogHeader><DialogTitle className="text-2xl font-black text-white">Full historical analysis</DialogTitle><DialogDescription className="text-slate-400">Detailed benchmark methodology, calibration, yearly results, caveats, and research comparisons.</DialogDescription></DialogHeader><div className="mt-4"><HistoryPanel historical={historical} research={research} /></div></DialogContent></Dialog>;
}

function ResearchLabDialog({ open, onOpenChange, exam, slate, historical, research, dashboard, live, learning, systems, atlasSort, setAtlasSort }: { open: boolean; onOpenChange: (open: boolean) => void; exam: Record<string, unknown> | null; slate: Slate | null; historical: Record<string, unknown> | null; research: Record<string, unknown> | null; dashboard: DashboardData | null; live: Record<string, unknown> | null; learning: Learning | null; systems: Array<{ label: string; state: string; detail: string }>; atlasSort: 'positive' | 'negative' | 'sample' | 'z'; setAtlasSort: (sort: 'positive' | 'negative' | 'sample' | 'z') => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-[calc(100%-1rem)] overflow-y-auto border border-white/15 bg-[#091725] p-0 text-slate-100 sm:max-w-7xl"><div className="p-5 sm:p-6"><DialogHeader><DialogTitle className="text-2xl font-black text-white">Research / Model Lab</DialogTitle><DialogDescription className="text-slate-400">Historical replay, V5 shadow evidence, failure analysis, football-state research, and learning memory. Nothing here changes production picks.</DialogDescription></DialogHeader><Tabs defaultValue="exam" className="mt-5 gap-5"><div className="overflow-x-auto border-y border-white/10 bg-[#081522] py-2"><TabsList variant="line" className="h-auto min-w-max gap-1 p-0"><TabsTrigger value="exam" className="px-3 py-2 text-xs">V2 vs V5</TabsTrigger><TabsTrigger value="history" className="px-3 py-2 text-xs">Historical</TabsTrigger><TabsTrigger value="atlas" className="px-3 py-2 text-xs">Failure atlas</TabsTrigger><TabsTrigger value="research" className="px-3 py-2 text-xs">Football state</TabsTrigger><TabsTrigger value="learning" className="px-3 py-2 text-xs">Self-learning</TabsTrigger></TabsList></div><TabsContent value="exam"><ExamPanel exam={exam} slate={slate} /></TabsContent><TabsContent value="history"><HistoryPanel historical={historical} research={research} /></TabsContent><TabsContent value="atlas"><FailureAtlas research={research} sort={atlasSort} setSort={setAtlasSort} /></TabsContent><TabsContent value="research"><ResearchPanel dashboard={dashboard} live={live} /></TabsContent><TabsContent value="learning"><LearningPanel learning={learning} dashboard={dashboard} systems={systems} /></TabsContent></Tabs></div></DialogContent></Dialog>;
}

function ExamPanel({ exam, slate }: { exam: Record<string, unknown> | null; slate: Slate | null }) {
  const v2 = exam?.v2 as Record<string, unknown> | undefined;
  const v5 = exam?.v5 as Record<string, unknown> | undefined;
  const deltas = exam?.pairedDeltas as Record<string, unknown> | null | undefined;
  const disagreements = exam?.disagreements as Record<string, unknown> | undefined;
  const leader = !v5 || asNumber(v5.games) === 0 ? 'No 2026 shadow result is graded yet' : asNumber(deltas?.brier) !== null && (asNumber(deltas?.brier) ?? 0) < 0 ? 'V5 is descriptively ahead on paired Brier — still SHADOW ONLY' : 'V2 is current paired leader';
  return <section><SectionHeading eyebrow="2026 PROSPECTIVE EXAM" title="V2 vs V5 at the same captured market time" detail="This is a prospective, paired ledger. It never changes V2 production or betting behavior." />
    <div className="mb-4 rounded-2xl border border-violet-400/25 bg-violet-400/8 p-4 text-sm text-violet-100"><ShieldCheck className="mr-2 inline size-4" /><strong>{leader}</strong><span className="ml-2 text-violet-200/80">V5 production influence: {slate?.v5Artifact.productionInfluence ?? 0}. No automatic promotion.</span></div>
    <div className="grid gap-4 xl:grid-cols-3"><ExamMetrics title="V2 · OFFICIAL / PRODUCTION" data={v2} tone="emerald" /><ExamMetrics title="V5 · SHADOW ONLY" data={v5} tone="violet" /><div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><p className="text-sm font-bold text-white">Head-to-head</p><div className="mt-4 grid grid-cols-2 gap-3"><DataCell label="Paired games" value={number(asNumber(exam?.pairedRowsSettled), 0)} /><DataCell label="V5 availability" value={pct(asNumber(exam?.v5AvailabilityRate))} /><DataCell label="Δ Brier" value={number(asNumber(deltas?.brier), 5)} /><DataCell label="Δ log loss" value={number(asNumber(deltas?.logLoss), 5)} /><DataCell label="Δ accuracy" value={pct(asNumber(deltas?.accuracy))} /><DataCell label="Pick disagreements" value={number(asNumber(disagreements?.rows), 0)} /></div><p className="mt-4 text-xs text-slate-400">Disagreement wins: V2 {number(asNumber(disagreements?.v2Wins), 0)} · V5 {number(asNumber(disagreements?.v5Wins), 0)}. Bootstrap intervals appear only once there are at least 30 paired, graded V5 games.</p></div></div>
  </section>;
}
function ExamMetrics({ title, data, tone }: { title: string; data: Record<string, unknown> | undefined; tone: 'emerald' | 'violet' }) { const good = tone === 'emerald' ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-violet-400/25 bg-violet-400/5'; return <div className={`rounded-2xl border p-4 ${good}`}><Pill tone={tone === 'emerald' ? 'green' : 'blue'}>{title}</Pill><div className="mt-4 grid grid-cols-2 gap-3"><DataCell label="Games graded" value={number(asNumber(data?.games), 0)} /><DataCell label="Accuracy" value={pct(asNumber(data?.accuracy))} /><DataCell label="Correct" value={data ? `${number(asNumber(data.games) !== null && asNumber(data.accuracy) !== null ? Math.round((asNumber(data.games) ?? 0) * (asNumber(data.accuracy) ?? 0)) : null, 0)}` : '—'} /><DataCell label="Brier" value={number(asNumber(data?.brier), 4)} /><DataCell label="Log loss" value={number(asNumber(data?.logLoss), 4)} /><DataCell label="Expected losses" value={number(asNumber(data?.expectedLosses), 1)} /><DataCell label="Actual losses" value={number(asNumber(data?.actualLosses), 0)} /><DataCell label="Excess losses" value={number(asNumber(data?.excessLosses), 1)} /></div></div>; }

function HistoryPanel({ historical, research }: { historical: Record<string, unknown> | null; research: Record<string, unknown> | null }) {
  const overall = historical?.overall as Record<string, unknown> | undefined;
  const bySeason = (historical?.bySeason as Array<Record<string, unknown>> | undefined) ?? [];
  const shadow = research?.shadowResidual as Record<string, unknown> | undefined;
  const robust = research?.robustness as Record<string, unknown> | undefined;
  const market = shadow?.market as Record<string, unknown> | undefined;
  const best = robust?.bestCandidate as Record<string, unknown> | undefined;
  return <section><SectionHeading eyebrow="FROZEN REPLAY · 2021–2025" title="Historical performance is a diagnostic, not a live-time simulation" detail="Closing market inputs are explicitly later-information proxies when their observation timestamps did not exist. The 2026 exam is the same-time prospective test." />
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="V1 replay accuracy" value={pct(asNumber(overall?.accuracy))} detail={`${number(asNumber(overall?.games), 0)} games · margin MAE ${number(asNumber(overall?.marginMae), 2)}`} /><MetricCard label="V1 Brier / log loss" value={`${number(asNumber(overall?.brier), 4)} / ${number(asNumber(overall?.logLoss), 4)}`} detail="Common-feature chronological replay" /><MetricCard label="Closing-market diagnostic" value={pct(asNumber(market?.accuracy))} detail={`Brier ${number(asNumber(market?.brier), 4)} · ${number(asNumber(market?.games), 0)} common games`} /><MetricCard label="V5 robustness" value={asText(robust?.status) ?? 'Unavailable'} detail="Shadow research only · influence 0" /></div>
    <div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><p className="mb-3 font-bold text-white">V1 yearly replay</p><Table><TableHeader><TableRow><TableHead>Season</TableHead><TableHead>Games</TableHead><TableHead>Accuracy</TableHead><TableHead>Brier</TableHead><TableHead>Log loss</TableHead><TableHead>Margin MAE</TableHead></TableRow></TableHeader><TableBody>{bySeason.map((row) => { const totals = row.overall as Record<string, unknown> | undefined; return <TableRow key={String(row.season)}><TableCell>{String(row.season)}</TableCell><TableCell>{number(asNumber(totals?.games), 0)}</TableCell><TableCell>{pct(asNumber(totals?.accuracy))}</TableCell><TableCell>{number(asNumber(totals?.brier), 4)}</TableCell><TableCell>{number(asNumber(totals?.logLoss), 4)}</TableCell><TableCell>{number(asNumber(totals?.marginMae), 2)}</TableCell></TableRow>; })}</TableBody></Table></div>
    {best && <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4 text-sm text-slate-300"><strong className="text-violet-200">Robustness selection:</strong> {asText(best.code) ?? 'See generated research artifact'}. It remains research-only even where a nonzero residual was descriptively best.</div>}
  </section>;
}

function FailureAtlas({ research, sort, setSort }: { research: Record<string, unknown> | null; sort: 'positive' | 'negative' | 'sample' | 'z'; setSort: (sort: 'positive' | 'negative' | 'sample' | 'z') => void }) {
  const atlas = research?.failureAtlas as Record<string, unknown> | undefined;
  const groups = [...((atlas?.groups as Array<Record<string, unknown>> | undefined) ?? [])].sort((left, right) => { const a = asNumber(left.excessLosses) ?? 0; const b = asNumber(right.excessLosses) ?? 0; if (sort === 'positive') return b - a; if (sort === 'negative') return a - b; if (sort === 'sample') return (asNumber(right.games) ?? 0) - (asNumber(left.games) ?? 0); return (asNumber(right.excessLossZ) ?? -Infinity) - (asNumber(left.excessLossZ) ?? -Infinity); });
  return <section><SectionHeading eyebrow="RESEARCH DIAGNOSTIC" title="Failure atlas" detail="These groups identify questions for future timestamp-matched validation. They do not trigger automatic corrections." /><div className="mb-4 flex flex-wrap gap-2">{(['positive', 'negative', 'sample', 'z'] as const).map((value) => <Button key={value} size="sm" variant="outline" onClick={() => setSort(value)} className={sort === value ? 'border-sky-300 bg-sky-300/15 text-sky-100' : 'border-white/15 bg-white/5 text-slate-300'}>Sort: {value === 'z' ? 'z-score' : value === 'sample' ? 'sample size' : `${value} excess`}</Button>)}</div><div className="rounded-2xl border border-white/10 bg-[#0b1927] p-3"><Table><TableHeader><TableRow><TableHead>Subgroup</TableHead><TableHead>N</TableHead><TableHead>Expected losses</TableHead><TableHead>Actual losses</TableHead><TableHead>Excess</TableHead><TableHead>z</TableHead><TableHead>Brier</TableHead><TableHead>Margin MAE</TableHead></TableRow></TableHeader><TableBody>{groups.slice(0, 80).map((group, index) => <TableRow key={`${String(group.label)}-${index}`}><TableCell className="font-medium text-white">{String(group.label ?? 'Unnamed group')}</TableCell><TableCell>{number(asNumber(group.games), 0)}</TableCell><TableCell>{number(asNumber(group.expectedLosses), 1)}</TableCell><TableCell>{number(asNumber(group.actualLosses), 0)}</TableCell><TableCell className={(asNumber(group.excessLosses) ?? 0) > 0 ? 'text-rose-300' : 'text-emerald-300'}>{number(asNumber(group.excessLosses), 1)}</TableCell><TableCell>{number(asNumber(group.excessLossZ), 2)}</TableCell><TableCell>{number(asNumber(group.brier), 4)}</TableCell><TableCell>{number(asNumber(group.marginMae), 2)}</TableCell></TableRow>)}</TableBody></Table></div></section>;
}

function ResearchPanel({ dashboard, live }: { dashboard: DashboardData | null; live: Record<string, unknown> | null }) {
  const efficiency = dashboard?.efficiency ?? [];
  const news = (live?.updates as Array<Record<string, unknown>> | undefined) ?? [];
  return <section><SectionHeading eyebrow="FOOTBALL RESEARCH STATE" title="Structured data is visible; eligibility is explicit" detail="Research snapshots never modify V2, V5 production influence, specialists, or betting until separately validated." />
    <div className="grid gap-4 xl:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><div className="flex items-center justify-between"><p className="font-bold text-white">Team efficiency snapshots</p><Pill tone="amber">Research only</Pill></div><p className="mt-1 text-xs text-slate-400">Only completed regular-season data strictly before a forecast week are eligible for V5 feature research.</p><div className="mt-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Team</TableHead><TableHead>Sample</TableHead><TableHead>Pass EPA</TableHead><TableHead>Rush EPA</TableHead><TableHead>Comp%</TableHead><TableHead>Y/A</TableHead><TableHead>Sack</TableHead><TableHead>INT</TableHead><TableHead>Through</TableHead></TableRow></TableHeader><TableBody>{efficiency.slice(0, 24).map((row, index) => <TableRow key={`${String(row.team)}-${index}`}><TableCell>{String(row.team)}</TableCell><TableCell>{number(asNumber(row.games_in_sample), 0)}</TableCell><TableCell>{number(asNumber(row.passing_epa), 3)}</TableCell><TableCell>{number(asNumber(row.rushing_epa), 3)}</TableCell><TableCell>{pct(asNumber(row.completion_percentage))}</TableCell><TableCell>{number(asNumber(row.yards_per_attempt), 2)}</TableCell><TableCell>{pct(asNumber(row.sack_rate))}</TableCell><TableCell>{pct(asNumber(row.turnover_rate))}</TableCell><TableCell>W{String(row.week)}</TableCell></TableRow>)}{!efficiency.length && <EmptyRow colSpan={9} text="No 2026 team-efficiency rows are stored yet." />}</TableBody></Table></div></div>
      <div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><div className="flex items-center justify-between"><p className="font-bold text-white">News & player availability</p><Pill tone="amber">Research only</Pill></div><p className="mt-1 text-xs text-slate-400">Unstructured news has eligible_for_model = 0 and is never a direct probability input.</p><div className="mt-4 space-y-2">{news.slice(0, 8).map((item, index) => <div key={`${String(item.headline)}-${index}`} className="rounded-xl border border-white/8 bg-white/[.03] p-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-slate-200">{String(item.team ?? 'League-wide')}</p><Pill tone="amber">Monitor only</Pill></div><p className="mt-1 text-xs leading-relaxed text-slate-400">{String(item.headline ?? '')}</p><p className="mt-1 text-[11px] text-slate-500">{time(asText(item.published))} · {String(item.stateType ?? 'news')}</p></div>)}{!news.length && <p className="py-8 text-center text-sm text-slate-500">No news feed rows are available on this refresh.</p>}</div></div></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><ResearchRows title="Stored football-state signals" rows={dashboard?.footballState ?? []} empty="No team-attributable football-state records are stored." /><ResearchRows title="Stored player availability" rows={dashboard?.playerAvailability ?? []} empty="No player-availability records are stored." /></div>
    <MarketMonitor rows={dashboard?.marketHistory ?? []} />
  </section>;
}
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) { return <TableRow><TableCell colSpan={colSpan} className="py-8 text-center text-slate-500">{text}</TableCell></TableRow>; }
function ResearchRows({ title, rows, empty }: { title: string; rows: Array<Record<string, unknown>>; empty: string }) { return <div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><p className="font-bold text-white">{title}</p><div className="mt-3 max-h-80 overflow-auto space-y-2">{rows.slice(0, 30).map((row, index) => <div key={`${String(row.id)}-${index}`} className="rounded-xl border border-white/8 bg-white/[.03] p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-slate-200">{String(row.team ?? 'League')}</span><Pill tone={row.eligible_for_model === 1 ? 'green' : 'amber'}>{row.eligible_for_model === 1 ? 'MODEL ELIGIBLE' : 'RESEARCH ONLY'}</Pill></div><p className="mt-1 text-slate-400">{String(row.subject ?? row.player_name ?? row.state_type ?? 'No label')}</p><p className="mt-1 text-[11px] text-slate-500">{time(asText(row.observed_at))} · {String(row.source ?? 'Unknown source')}</p></div>)}{!rows.length && <p className="py-8 text-center text-sm text-slate-500">{empty}</p>}</div></div>; }
function MarketMonitor({ rows }: { rows: Array<Record<string, unknown>> }) { return <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b1927] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-white">Market monitor</p><Pill tone="blue">Observed snapshots only</Pill></div><p className="mt-1 text-xs text-slate-400">Movement is highlighted only when there are at least two stored observations for a game; no causation is inferred.</p><div className="mt-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Game</TableHead><TableHead>Observed</TableHead><TableHead>Moneyline (A/H)</TableHead><TableHead>Spread (A/H)</TableHead><TableHead>Total</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 60).map((row, index) => <TableRow key={`${String(row.id)}-${index}`}><TableCell>{String(row.game_key)}</TableCell><TableCell>{time(asText(row.observed_at))}</TableCell><TableCell>{price(asNumber(row.away_moneyline))} / {price(asNumber(row.home_moneyline))}</TableCell><TableCell>{spread(asNumber(row.away_spread))} / {spread(asNumber(row.home_spread))}</TableCell><TableCell>{number(asNumber(row.total_line), 1)}</TableCell><TableCell>{String(row.source)}</TableCell></TableRow>)}{!rows.length && <EmptyRow colSpan={6} text="No captured market observations are stored for this selected week yet." />}</TableBody></Table></div></div>; }

function LearningPanel({ learning, dashboard, systems }: { learning: Learning | null; dashboard: DashboardData | null; systems: Array<{ label: string; state: string; detail: string }> }) {
  const record = learning?.record;
  const knownCodes = ['market_baseline', 'qb_uncertainty', 'ol_pass_rush', 'weather', 'key_number'];
  const stored = new Map((dashboard?.specialists ?? []).map((row) => [String(row.code), row]));
  const specialistCodes = [...new Set([...knownCodes, ...stored.keys()])];
  return <section><SectionHeading eyebrow="INTEGRITY & LEARNING" title="Canonical learning is kept separate from prospective shadow rows" detail="Prediction snapshots are one canonical pick per game. Forecast and prospective ledgers are time-series research records and cannot inflate the win/loss record." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Canonical record" value={record?.total ? `${record.correct}–${record.incorrect}` : 'No graded games'} detail={`${number(record?.total, 0)} canonical picks`} /><MetricCard label="Accuracy / Brier" value={`${pct(record?.accuracy)} / ${number(record?.brierScore, 4)}`} detail={`Market Brier ${number(record?.marketBrierScore, 4)}`} /><MetricCard label="Expected / excess losses" value={`${number(record?.expectedLosses, 1)} / ${number(record?.excessLosses, 1)}`} detail="Canonical record only" /><MetricCard label="Prospective ledger" value={number(asNumber(dashboard?.summary?.prospective_rows), 0)} detail="Separate paired V2/V5 snapshots" /></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><div className="flex items-center justify-between"><p className="font-bold text-white">Specialist status</p><Pill tone="green">Production controlled</Pill></div><div className="mt-4 space-y-2">{specialistCodes.map((code) => { const item = stored.get(code); const weight = code === 'market_baseline' ? 1 : asNumber(item?.production_weight) ?? 0; return <div className="rounded-xl border border-white/8 bg-white/[.03] p-3" key={code}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-100">{code}</p><div className="flex gap-2"><Pill tone={weight > 0 ? 'green' : 'amber'}>{pct(weight, 0)} production</Pill><Pill tone={weight > 0 ? 'green' : 'neutral'}>{weight > 0 ? 'Production eligible' : 'Not eligible'}</Pill></div></div><p className="mt-1 text-xs text-slate-400">{asText(item?.evidence) ?? (code === 'market_baseline' ? 'Fixed production baseline while unproven football specialists remain at zero.' : 'No validated production evidence stored.')}</p></div>; })}</div></div><div className="rounded-2xl border border-white/10 bg-[#0b1927] p-4"><p className="font-bold text-white">Systems health</p><div className="mt-3 space-y-2">{systems.map((system) => <div key={system.label} className="rounded-xl border border-white/8 bg-white/[.03] p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium text-slate-200">{system.label}</p><SystemBadge state={system.state} /></div><p className="mt-1 text-xs text-slate-500">{system.detail}</p></div>)}</div></div></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><ResearchRows title="Recent postmortems" rows={dashboard?.recentPostmortems ?? []} empty="No completed 2026 canonical games are available for postmortem yet." /><ResearchRows title="Weekly learning runs" rows={dashboard?.learningRuns ?? []} empty="No weekly learning run is available yet." /></div>
  </section>;
}
function SystemBadge({ state }: { state: string }) { const tone = state === 'Healthy' ? 'green' : state === 'Error' ? 'red' : state === 'Stale' ? 'amber' : 'neutral'; return <Pill tone={tone}>{state}</Pill>; }

function GameDetail({ game, onClose, detail, detailError }: { game: SlateGame | null; onClose: () => void; detail: DashboardData | null; detailError: string | null }) {
  const market = game?.market;
  const marketHistory = [...(detail?.marketHistory ?? [])].reverse();
  const prospective = [...(detail?.prospectiveHistory ?? [])].reverse();
  const chart = prospective.map((row) => ({ at: time(asText(row.captured_at)), v2: asNumber(row.v2_home_probability) ? (asNumber(row.v2_home_probability) ?? 0) * 100 : null, v5: asNumber(row.v5_home_probability) === null ? null : (asNumber(row.v5_home_probability) ?? 0) * 100 }));
  const marketChart = marketHistory.map((row) => ({ at: time(asText(row.observed_at)), home: asNumber(row.home_moneyline), spread: asNumber(row.home_spread) }));
  const movement = marketHistory.length >= 2 ? marketMovement(marketHistory) : null;
  return <Dialog open={Boolean(game)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[92vh] max-w-[calc(100%-1rem)] overflow-y-auto border border-white/15 bg-[#091725] p-0 text-slate-100 sm:max-w-5xl"><div className="p-5 sm:p-6">{game && <><DialogHeader><DialogTitle className="pr-8 text-2xl font-black text-white">{game.away} <span className="text-slate-500">at</span> {game.home}</DialogTitle><DialogDescription className="text-slate-400">{time(game.scheduledKickoffAt)} · {game.captureHorizon} capture horizon · {game.gameKey}</DialogDescription></DialogHeader><div className="mt-4 flex flex-wrap gap-2"><Pill tone="green">V2 OFFICIAL / PRODUCTION</Pill><Pill tone="blue">V5 SHADOW ONLY</Pill><Pill tone="neutral">V5 artifact {detail?.production.v5ArtifactHash ?? 'loading'}</Pill></div>
      {detailError && <div className="mt-4"><ErrorBox message={detailError} /></div>}
      <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4"><p className="font-bold text-emerald-200">V2 official forecast</p><p className="mt-2 text-2xl font-black text-white">{game.v2OfficialPick}</p><p className="mt-1 text-sm text-slate-300">Home win {pct(game.v2OfficialProbability)} · confidence {confidence(game.v2OfficialProbability)}</p><p className="mt-2 text-xs text-slate-500">Version: {detail?.production.v2Version ?? 'Loading'}</p></div><div className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4"><p className="font-bold text-violet-200">V5 shadow forecast</p>{game.v5Available ? <><p className="mt-2 text-2xl font-black text-white">{game.v5ShadowPick}</p><p className="mt-1 text-sm text-slate-300">Home win {pct(game.v5ShadowProbability)} · Δ {pct(game.v5MinusV2ProbabilityDelta)}</p></> : <p className="mt-2 text-sm leading-relaxed text-slate-300">Unavailable: {game.v5UnavailableReason}</p>}<p className="mt-2 text-xs text-slate-500">Production influence 0 · data through Week {game.featureDataThroughWeek ?? '—'}</p></div><div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4"><p className="font-bold text-sky-200">Market & betting view</p><p className="mt-2 text-lg font-black text-white">{price(market?.awayMoneyline)} / {price(market?.homeMoneyline)}</p><p className="mt-1 text-sm text-slate-300">Spread {spread(market?.awaySpread)} / {spread(market?.homeSpread)} · total {number(market?.totalLine, 1)}</p><p className="mt-2 text-xs text-slate-500">{market?.betting.selection ?? 'No market line'} · {market?.betting.policy ?? ''}</p></div></div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2"><ChartCard title="V2 / V5 captured probability history" description="Only server-captured paired snapshots are shown." empty={chart.length < 2 ? 'One or fewer capture records: no movement is inferred.' : null}><ResponsiveContainer width="100%" height={220}><LineChart data={chart}><CartesianGrid stroke="#ffffff12" vertical={false} /><XAxis dataKey="at" hide /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke="#94a3b8" width={42} /><Tooltip contentStyle={{ background: '#0b1927', border: '1px solid #ffffff22', borderRadius: 12 }} formatter={(value) => typeof value === 'number' ? `${value.toFixed(1)}%` : String(value ?? '—')} /><Line type="monotone" dataKey="v2" stroke="#34d399" strokeWidth={2.5} dot={false} name="V2" /><Line type="monotone" dataKey="v5" stroke="#a78bfa" strokeWidth={2.5} dot={false} name="V5" /></LineChart></ResponsiveContainer></ChartCard><ChartCard title="Captured moneyline / spread history" description={movement ?? 'Only stored market observations are shown.'} empty={marketChart.length < 2 ? 'One or fewer market observations: no movement is shown.' : null}><ResponsiveContainer width="100%" height={220}><LineChart data={marketChart}><CartesianGrid stroke="#ffffff12" vertical={false} /><XAxis dataKey="at" hide /><YAxis yAxisId="money" stroke="#94a3b8" width={45} /><YAxis yAxisId="spread" orientation="right" stroke="#94a3b8" width={35} /><Tooltip contentStyle={{ background: '#0b1927', border: '1px solid #ffffff22', borderRadius: 12 }} /><Line yAxisId="money" type="monotone" dataKey="home" stroke="#38bdf8" strokeWidth={2.5} dot={false} name="Home ML" /><Line yAxisId="spread" type="monotone" dataKey="spread" stroke="#fbbf24" strokeWidth={2.5} dot={false} name="Home spread" /></LineChart></ResponsiveContainer></ChartCard></div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="font-bold text-white">Margin, cover, and displayed edge</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><DataCell label="Expected home margin" value={number(market?.expectedHomeMargin, 1)} /><DataCell label="Home cover" value={pct(market?.spreadProbabilities?.homeCover)} /><DataCell label="Push" value={pct(market?.spreadProbabilities?.push)} /><DataCell label="Away cover" value={pct(market?.spreadProbabilities?.awayCover)} /><DataCell label="Home edge" value={pct(market?.betting.homeEdge)} /><DataCell label="Away edge" value={pct(market?.betting.awayEdge)} /><DataCell label="Home price" value={price(market?.homeSpreadOdds)} /><DataCell label="Away price" value={price(market?.awaySpreadOdds)} /></div><p className="mt-4 text-xs text-slate-500">{market?.betting.selection ?? 'No selection because a market line is unavailable.'} Push probability is explicit; it is not silently reallocated to either side.</p></div><div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="font-bold text-white">Capture timestamps & disagreement</p><div className="mt-4 grid grid-cols-2 gap-3"><DataCell label="Market observed" value={time(game.marketObservedAt)} /><DataCell label="Model captured" value={detail?.prospectiveHistory[0] ? time(asText(detail.prospectiveHistory[0].captured_at)) : 'No stored capture'} /><DataCell label="V2/V5" value={game.disagreement ? 'Pick disagreement' : 'Same pick / V5 unavailable'} /><DataCell label="V5 data through" value={game.featureDataThroughWeek === null ? 'Unavailable' : `Week ${game.featureDataThroughWeek}`} /></div></div></div>
      <div className="mt-5 grid gap-4 xl:grid-cols-3"><ResearchRows title="Team efficiency state" rows={detail?.efficiency ?? []} empty="No stored team-efficiency state." /><ResearchRows title="Football-state signals" rows={detail?.footballState ?? []} empty="No stored football-state signals." /><ResearchRows title="Player availability state" rows={detail?.playerAvailability ?? []} empty="No stored player availability." /></div>
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="font-bold text-white">Capture ledger</p><div className="mt-3 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Captured</TableHead><TableHead>Market observed</TableHead><TableHead>V2 home</TableHead><TableHead>V5 home</TableHead><TableHead>V5 status</TableHead><TableHead>Feature through</TableHead></TableRow></TableHeader><TableBody>{prospective.slice(-36).reverse().map((row, index) => <TableRow key={`${String(row.id)}-${index}`}><TableCell>{time(asText(row.captured_at))}</TableCell><TableCell>{time(asText(row.market_observed_at))}</TableCell><TableCell>{pct(asNumber(row.v2_home_probability))}</TableCell><TableCell>{pct(asNumber(row.v5_home_probability))}</TableCell><TableCell>{row.v5_available === 1 ? 'Available' : asText(parseJson(row.v5_feature_payload_json)?.v5UnavailableReason) ?? 'Unavailable'}</TableCell><TableCell>{number(asNumber(row.v5_feature_data_through_week), 0)}</TableCell></TableRow>)}{!prospective.length && <EmptyRow colSpan={6} text="No prospective capture has been stored for this game yet." />}</TableBody></Table></div></div>
    </>}</div></DialogContent></Dialog>;
}
function ChartCard({ title, description, empty, children }: { title: string; description: string; empty: string | null; children: React.ReactNode }) { return <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="font-bold text-white">{title}</p><p className="mt-1 text-xs text-slate-400">{description}</p><div className="mt-3">{empty ? <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-white/10 px-6 text-center text-sm text-slate-500">{empty}</div> : children}</div></div>; }
function marketMovement(rows: Array<Record<string, unknown>>) { const first = rows[0]; const last = rows[rows.length - 1]; const moneyline = (asNumber(last.home_moneyline) ?? 0) - (asNumber(first.home_moneyline) ?? 0); const line = (asNumber(last.home_spread) ?? 0) - (asNumber(first.home_spread) ?? 0); const parts: string[] = []; if (moneyline) parts.push(`Home moneyline ${moneyline > 0 ? '+' : ''}${moneyline}`); if (line) parts.push(`home spread ${line > 0 ? '+' : ''}${line.toFixed(1)}`); return parts.length ? `${parts.join('; ')} across ${rows.length} captured observations. Movement alone does not establish a cause.` : `No price change across ${rows.length} captured observations.`; }

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BrainCircuit, CalendarDays, ChevronRight, CircleAlert, CircleCheck, Clock3, RefreshCw, Radio, ShieldCheck, SlidersHorizontal, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Game = { id: string; week: number; away: string; home: string; date: string; neutral: boolean; homeProbability: number; source: string };
type LearningState = { completedWeeks: number; homeFieldAdjustment: number; confidenceShrinkage: number };
type Learning = {
  state: LearningState;
  record: { correct: number; incorrect: number; total: number; accuracy: number | null; brierScore: number | null; captured: number };
  runs: Array<{ week: number; gradedGames: number; correctPicks: number; brierScore: number; homeResidual: number; favoriteResidual: number; insight: string; createdAt: string }>;
  outcomes: Array<{ id: number; week: number; away: string; home: string; pick: string; winner: string; correct: boolean; awayScore: number; homeScore: number; favoriteProbability: number; capturedAt: string }>;
  pendingSnapshots: number; note: string;
};
type Forecast = { week: number; games: Game[]; retrievedAt: string; source: string; model: { label: string; ratings: Record<string, number>; learning: LearningState; notes: string } };
type Update = { headline: string; description?: string; published?: string; link?: string; team: string; impact: number; status: 'Applied' | 'Monitor only' };
type Live = { retrievedAt: string; adjustments: Record<string, number>; updates: Update[]; feedStatus: string; policy: string; sources: Array<{ label: string; url: string }> };
type ModelContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute: (input: unknown) => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> };

function asDate(value?: string) {
  if (!value) return 'Waiting for first refresh';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', timeZoneName: 'short' }).format(new Date(value));
}
function signed(value: number) { return `${value > 0 ? '+' : ''}${value.toFixed(2)}`; }
function probabilityFor(game: Game, ratings: Record<string, number>, adjustments: Record<string, number>, learning: LearningState) {
  const home = (ratings[game.home] ?? 0) + (adjustments[game.home] ?? 0);
  const away = (ratings[game.away] ?? 0) + (adjustments[game.away] ?? 0);
  const raw = 1 / (1 + Math.exp(-(home - away + (game.neutral ? 0 : 1.1 + learning.homeFieldAdjustment)) / 4.8));
  return 0.5 + (raw - 0.5) * (1 - learning.confidenceShrinkage);
}

export function ForecastDesk() {
  const [week, setWeek] = useState(1);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef({ week, forecast, live });
  useEffect(() => { stateRef.current = { week, forecast, live }; }, [week, forecast, live]);

  const loadForecast = useCallback(async (requestedWeek: number) => {
    setForecastError(null);
    const response = await fetch(`/api/forecast?week=${requestedWeek}`, { cache: 'no-store' });
    const body = await response.json() as Forecast & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Could not refresh the schedule.');
    setForecast(body);
  }, []);
  const refreshLive = useCallback(async () => {
    setLiveError(null);
    const response = await fetch('/api/live', { cache: 'no-store' });
    const body = await response.json() as Live & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Could not refresh live inputs.');
    setLive(body); return body;
  }, []);
  const refreshLearning = useCallback(async () => {
    setLearningError(null);
    const response = await fetch('/api/learning', { cache: 'no-store' });
    const body = await response.json() as Learning & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Could not refresh the learning record.');
    setLearning(body); return body;
  }, []);
  const refreshAll = useCallback(async (requestedWeek: number) => {
    setBusy(true);
    try {
      try { await refreshLearning(); } catch (error) { setLearningError(error instanceof Error ? error.message : 'Could not refresh the learning record.'); }
      const results = await Promise.allSettled([loadForecast(requestedWeek), refreshLive()]);
      if (results[0].status === 'rejected') setForecastError(results[0].reason instanceof Error ? results[0].reason.message : 'Could not refresh the forecast.');
      if (results[1].status === 'rejected') setLiveError(results[1].reason instanceof Error ? results[1].reason.message : 'Could not refresh live inputs.');
    } finally { setBusy(false); }
  }, [loadForecast, refreshLearning, refreshLive]);
  const changeWeek = useCallback(async (nextWeek: number) => {
    if (nextWeek < 1 || nextWeek > 18) throw new Error('Week must be from 1 through 18.');
    setWeek(nextWeek); setBusy(true);
    try { try { await refreshLearning(); } catch (error) { setLearningError(error instanceof Error ? error.message : 'Could not refresh the learning record.'); } await loadForecast(nextWeek); } catch (error) { setForecastError(error instanceof Error ? error.message : 'Could not refresh the forecast.'); throw error; } finally { setBusy(false); }
  }, [loadForecast, refreshLearning]);
  useEffect(() => { const initialRefresh = window.setTimeout(() => { void refreshAll(1); }, 0); return () => window.clearTimeout(initialRefresh); }, [refreshAll]);
  useEffect(() => { const timer = window.setInterval(() => { void refreshAll(stateRef.current.week); }, 5 * 60 * 1000); return () => window.clearInterval(timer); }, [refreshAll]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext['registerTool']>[0]) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* host does not support WebMCP */ } };
    register({ name: 'set_nfl_forecast_week', title: 'Set NFL forecast week', description: 'Show the official 2026 schedule and game forecasts for one requested week.', inputSchema: { type: 'object', properties: { week: { type: 'integer', minimum: 1, maximum: 18 } }, required: ['week'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, async execute(input) {
      const requested = typeof input === 'object' && input !== null ? (input as { week?: unknown }).week : undefined;
      if (!Number.isInteger(requested) || (requested as number) < 1 || (requested as number) > 18) throw new Error('week must be an integer from 1 through 18.');
      await changeWeek(requested as number); return { week: requested, games: stateRef.current.forecast?.games.length ?? 0 };
    }});
    register({ name: 'refresh_nfl_live_inputs', title: 'Refresh live NFL inputs', description: 'Refresh the live news and injury-input layer used for displayed game probabilities.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, async execute(input) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected an empty object.');
      const result = await refreshLive(); return { retrievedAt: result.retrievedAt, appliedUpdates: result.updates.filter((update) => update.status === 'Applied').length };
    }});
    register({ name: 'get_nfl_forecast_state', title: 'Get NFL forecast state', description: 'Read the selected week, schedule freshness, and currently applied team adjustments.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected an empty object.');
      const state = stateRef.current; return { week: state.week, games: state.forecast?.games.length ?? 0, refreshedAt: state.live?.retrievedAt ?? null, adjustments: state.live?.adjustments ?? {} };
    }});
    return () => lifecycle.abort();
  }, [changeWeek, refreshLive]);

  const renderedGames = useMemo(() => (forecast?.games ?? []).map((game) => {
    const adjustedHome = probabilityFor(game, forecast?.model.ratings ?? {}, live?.adjustments ?? {}, forecast?.model.learning ?? { completedWeeks: 0, homeFieldAdjustment: 0, confidenceShrinkage: 0 });
    return { ...game, adjustedHome, delta: adjustedHome - game.homeProbability };
  }), [forecast, live]);
  const appliedCount = live?.updates.filter((update) => update.status === 'Applied').length ?? 0;

  useEffect(() => {
    if (!forecast || !live || !renderedGames.length) return;
    const snapshot = window.setTimeout(() => {
      void fetch('/api/predictions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ games: renderedGames.map((game) => {
          const homeFavorite = game.adjustedHome >= 0.5;
          return { week: game.week, gameKey: `${game.away}__${game.home}`, away: game.away, home: game.home, predictedWinner: homeFavorite ? game.home : game.away, homeProbability: game.adjustedHome, favoriteProbability: homeFavorite ? game.adjustedHome : 1 - game.adjustedHome, liveDelta: game.delta };
        }) }),
      }).then(() => undefined).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(snapshot);
  }, [forecast, live, renderedGames]);

  return <main className="min-h-screen overflow-x-hidden bg-[#071622] text-slate-100">
    <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(86,174,214,.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(86,174,214,.06)_1px,transparent_1px)] [background-size:80px_80px]" />
    <header className="relative border-b border-sky-100/10 bg-[#081b29]/90 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#e9b949] text-[#06131e] shadow-[0_0_24px_rgba(233,185,73,.24)]"><Activity className="size-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#e9b949]">2026–27 season</p><h1 className="text-lg font-bold tracking-tight text-white">NFL Forecast Desk</h1></div></div><div className="flex flex-wrap items-center gap-2 text-xs text-slate-300"><span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100/10 bg-sky-100/5 px-3 py-1.5"><Radio className="size-3 text-sky-300" /> Live input scan</span><span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100/10 bg-sky-100/5 px-3 py-1.5"><Clock3 className="size-3 text-sky-300" /> {asDate(live?.retrievedAt)}</span></div></div></header>
    <section className="relative mx-auto max-w-7xl px-5 pb-14 pt-8 lg:px-8"><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]"><div>
      <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-sky-100/10 bg-[#0c2333]/90 p-5 shadow-2xl shadow-black/20 md:flex-row md:items-center"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Game by game forecast</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-white">Every matchup. One clear call.</h2><p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-300">Win probability starts with a transparent team-strength and venue model, then shifts only when a live report passes the update rule.</p></div><div className="flex items-center gap-2"><Select value={String(week)} onValueChange={(value) => { void changeWeek(Number(value)); }}><SelectTrigger className="h-10 min-w-32 border-sky-100/15 bg-[#071a28] px-3 text-slate-100 hover:bg-[#102c3e]"><CalendarDays className="mr-2 size-4 text-[#e9b949]" /><SelectValue /></SelectTrigger><SelectContent className="border-sky-100/10 bg-[#0d2637] text-slate-100"><SelectGroup>{Array.from({ length: 18 }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)} className="focus:bg-sky-100/10 focus:text-white">Week {index + 1}</SelectItem>)}</SelectGroup></SelectContent></Select><Button onClick={() => void refreshAll(week)} disabled={busy} variant="outline" className="h-10 border-sky-100/15 bg-[#071a28] px-3 text-slate-100 hover:bg-[#102c3e] hover:text-white" aria-label="Refresh schedule and live inputs"><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span></Button></div></div>
      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-sky-100/10 bg-[#0b2030] sm:grid-cols-4"><Metric label="Selected" value={`Week ${week}`} /><Metric label="On deck" value={forecast ? `${forecast.games.length} games` : 'Loading'} /><Metric label="Record" value={learning ? `${learning.record.correct}–${learning.record.incorrect}` : 'Pending'} /><Metric label="Applied" value={`${appliedCount} update${appliedCount === 1 ? '' : 's'}`} /></div>
      {learning && <LearningPanel learning={learning} />}
      {forecastError && <Notice tone="error" text={forecastError} />}{liveError && <Notice tone="warn" text={`${liveError} Baseline forecasts remain visible.`} />}{learningError && <Notice tone="warn" text={learningError} />}{!forecast && !forecastError && <LoadingCards />}
      <div className="space-y-3">{renderedGames.map((game) => { const homeFavorite = game.adjustedHome >= 0.5; const favorite = homeFavorite ? game.home : game.away; const favoriteProbability = homeFavorite ? game.adjustedHome : 1 - game.adjustedHome; const newsMove = Math.abs(game.delta) >= 0.002; return <article key={game.id} className="group overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2435]/95 transition hover:border-sky-300/25 hover:bg-[#0f2a3d]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/8 bg-[#071b29]/60 px-4 py-2.5 text-xs"><span className="font-medium text-sky-200">{game.date}{game.neutral ? ' · Neutral site' : ''}</span><span className="inline-flex items-center gap-1.5 text-slate-400"><ShieldCheck className="size-3.5 text-sky-300" /> Official schedule</span></div><div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_175px] sm:items-center"><div className="space-y-3"><TeamRow team={game.away} probability={1 - game.adjustedHome} favored={!homeFavorite} /><TeamRow team={game.home} probability={game.adjustedHome} favored={homeFavorite} home /></div><div className="rounded-xl border border-[#e9b949]/25 bg-[#e9b949]/8 p-3.5 sm:text-right"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#e9b949]">Model pick</p><p className="mt-1 text-base font-bold text-white">{favorite}</p><p className="mt-0.5 text-sm font-medium text-[#f6d787]">{(favoriteProbability * 100).toFixed(1)}% win</p><p className="mt-2 text-[11px] leading-4 text-slate-400">{newsMove ? `Live inputs moved home win ${game.delta > 0 ? 'up' : 'down'} ${Math.abs(game.delta * 100).toFixed(1)} pts` : 'No applied live adjustment'}</p></div></div></article>; })}</div>
      {forecast && <div className="mt-5 rounded-xl border border-sky-100/10 bg-[#0b2030]/75 p-4 text-xs leading-5 text-slate-400"><div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1"><span><strong className="text-slate-200">Baseline:</strong> {forecast.model.label}</span><a className="inline-flex items-center gap-1 text-sky-300 hover:text-white" href={forecast.source} target="_blank" rel="noreferrer">View official schedule <ArrowUpRight className="size-3" /></a></div><p className="mt-2">{forecast.model.notes} Schedule refreshed {asDate(forecast.retrievedAt)}.</p></div>}
      {learning && <PickHistory outcomes={learning.outcomes} />}
    </div>
    <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start"><section className="overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2333]/95"><div className="border-b border-sky-100/10 px-5 py-4"><div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-[#e9b949]" /><h2 className="font-bold text-white">Live adjustment ledger</h2></div><p className="mt-1 text-xs leading-5 text-slate-400">Refreshes every 5 minutes while this page is open.</p></div><div className="space-y-3 p-4">{!live && <p className="text-sm text-slate-400">Checking league inputs…</p>}{live?.updates.length === 0 && <p className="text-sm leading-6 text-slate-400">{live.feedStatus}</p>}{live?.updates.slice(0, 6).map((update, index) => <div key={`${update.headline}-${index}`} className="rounded-xl border border-sky-100/8 bg-[#071a28]/80 p-3"><div className="flex items-start justify-between gap-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${update.status === 'Applied' ? 'bg-emerald-300/12 text-emerald-200' : 'bg-slate-300/8 text-slate-400'}`}>{update.status}</span>{update.impact !== 0 && <span className={update.impact > 0 ? 'text-xs font-semibold text-emerald-200' : 'text-xs font-semibold text-rose-200'}>{signed(update.impact)} rating</span>}</div><p className="mt-2 text-xs font-semibold leading-5 text-slate-200">{update.team}</p><p className="mt-0.5 line-clamp-3 text-xs leading-5 text-slate-400">{update.headline}</p>{update.link && <a href={update.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-white">Source <ChevronRight className="size-3" /></a>}</div>)}</div></section><section className="rounded-2xl border border-sky-100/10 bg-[#0b2030]/80 p-5"><div className="flex gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-sky-300" /><div><h2 className="text-sm font-bold text-white">How a live update changes a game</h2><p className="mt-2 text-xs leading-5 text-slate-400">Only a clear team + availability/transaction signal changes a rating. The effect is capped at ±1.50. Vague reports stay in the ledger but do not change a pick.</p></div></div><div className="mt-4 border-t border-sky-100/10 pt-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Sources</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{live?.sources.map((source) => <a key={source.url} className="text-xs text-sky-300 hover:text-white" href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div></div></section><section className="rounded-2xl border border-[#e9b949]/20 bg-[#e9b949]/[.06] p-5"><div className="flex gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-[#e9b949]" /><p className="text-xs leading-5 text-slate-300">A probability is not a promise. This desk does not publish fabricated score projections or claim to catch every report. Its job is to make each input, refresh time, and adjustment inspectable.</p></div></section></aside>
    </div></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-r border-sky-100/10 px-4 py-3 last:border-r-0"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-white">{value}</p></div>; }
function LearningPanel({ learning }: { learning: Learning }) {
  const latest = learning.runs[0];
  return <section className="mb-5 overflow-hidden rounded-2xl border border-sky-300/15 bg-[#0a2638]/95"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-sky-100/10 px-5 py-4"><div className="flex gap-3"><div className="grid size-9 place-items-center rounded-xl bg-sky-300/10 text-sky-300"><BrainCircuit className="size-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-sky-300">Weekly learning loop</p><h3 className="mt-0.5 font-bold text-white">Results become calibration, not a rewrite.</h3></div></div><div className="text-left sm:text-right"><p className="text-xs text-slate-400">Season accuracy</p><p className="mt-0.5 text-lg font-bold text-white">{learning.record.accuracy === null ? '—' : `${(learning.record.accuracy * 100).toFixed(1)}%`}</p></div></div><div className="grid gap-px bg-sky-100/10 sm:grid-cols-3"><LearningMetric label="Correct picks" value={String(learning.record.correct)} detail={`${learning.record.incorrect} incorrect`} /><LearningMetric label="Brier score" value={learning.record.brierScore === null ? '—' : learning.record.brierScore.toFixed(3)} detail="Lower is better" /><LearningMetric label="Frozen forecasts" value={String(learning.record.captured)} detail={`${learning.pendingSnapshots} awaiting result`} /></div><div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]"><div><div className="flex items-center gap-2"><Target className="size-4 text-[#e9b949]" /><h4 className="text-sm font-bold text-white">Latest model audit</h4></div><p className="mt-2 text-sm leading-6 text-slate-300">{latest?.insight ?? 'No completed week with a full captured slate yet. Forecast snapshots are being collected for the first audit.'}</p>{latest && <p className="mt-2 text-xs text-slate-500">Week {latest.week}: {latest.correctPicks}/{latest.gradedGames} picks correct · Brier {latest.brierScore.toFixed(3)}</p>}</div><div className="rounded-xl border border-sky-100/10 bg-[#071a28]/80 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Active next-week guardrails</p><p className="mt-2 text-sm font-semibold text-slate-100">Venue edge {signed(learning.state.homeFieldAdjustment)} pts</p><p className="mt-1 text-sm font-semibold text-slate-100">Confidence pull {(learning.state.confidenceShrinkage * 100).toFixed(1)}%</p><p className="mt-2 text-xs leading-5 text-slate-400">{learning.state.completedWeeks} completed weekly audit{learning.state.completedWeeks === 1 ? '' : 's'}; every adjustment is capped.</p></div></div><p className="border-t border-sky-100/10 px-5 py-3 text-xs leading-5 text-slate-400">{learning.note}</p></section>;
}
function LearningMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="bg-[#0b2030] px-5 py-3.5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-white">{value}</p><p className="mt-0.5 text-xs text-slate-400">{detail}</p></div>; }
function PickHistory({ outcomes }: { outcomes: Learning['outcomes'] }) { return <section className="mt-5 overflow-hidden rounded-2xl border border-sky-100/10 bg-[#0c2333]/95"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/10 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-sky-300">Overall pick record</p><h3 className="mt-0.5 font-bold text-white">Every settled forecast</h3></div><span className="rounded-full border border-sky-100/10 bg-[#071a28] px-3 py-1 text-xs text-slate-300">{outcomes.length} graded game{outcomes.length === 1 ? '' : 's'}</span></div>{outcomes.length === 0 ? <p className="px-5 py-6 text-sm leading-6 text-slate-400">Results will appear here after a captured game is final. Each row retains the frozen pick and final score.</p> : <div className="divide-y divide-sky-100/8">{outcomes.map((outcome) => <div key={outcome.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3"><span className={`grid size-7 place-items-center rounded-full text-xs font-bold ${outcome.correct ? 'bg-emerald-300/12 text-emerald-200' : 'bg-rose-300/12 text-rose-200'}`}>{outcome.correct ? '✓' : '×'}</span><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-100">W{outcome.week} · {outcome.away} {outcome.awayScore} at {outcome.home} {outcome.homeScore}</p><p className="mt-0.5 text-xs text-slate-400">Pick: {outcome.pick} · Winner: {outcome.winner} · {(outcome.favoriteProbability * 100).toFixed(1)}% confidence</p></div><span className={`text-xs font-semibold ${outcome.correct ? 'text-emerald-200' : 'text-rose-200'}`}>{outcome.correct ? 'Correct' : 'Incorrect'}</span></div>)}</div>}</section>; }
function TeamRow({ team, probability, favored, home = false }: { team: string; probability: number; favored: boolean; home?: boolean }) { return <div className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-3"><div><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${favored ? 'bg-[#e9b949] shadow-[0_0_10px_rgba(233,185,73,.7)]' : 'bg-slate-600'}`} /><p className={`truncate text-sm ${favored ? 'font-bold text-white' : 'font-medium text-slate-300'}`}>{team}<span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">{home ? 'home' : 'away'}</span></p></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700/70"><div className={`h-full rounded-full ${favored ? 'bg-[#e9b949]' : 'bg-sky-400/70'}`} style={{ width: `${Math.max(3, probability * 100)}%` }} /></div></div><p className={`text-right text-sm ${favored ? 'font-bold text-white' : 'text-slate-300'}`}>{(probability * 100).toFixed(1)}%</p></div>; }
function Notice({ tone, text }: { tone: 'error' | 'warn'; text: string }) { return <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-rose-300/25 bg-rose-300/8 text-rose-100' : 'border-[#e9b949]/25 bg-[#e9b949]/8 text-[#f6d787]'}`}>{text}</div>; }
function LoadingCards() { return <div className="space-y-3">{[1, 2, 3, 4].map((key) => <div key={key} className="h-36 animate-pulse rounded-2xl border border-sky-100/8 bg-[#0c2333]" />)}</div>; }

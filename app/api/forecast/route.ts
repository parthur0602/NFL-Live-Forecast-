import { NextResponse } from 'next/server';
import { decodeAttribute, probability, SCHEDULE_BASE_URL, TEAM_ALIASES, TEAM_RATINGS, toDisplayDate } from '@/lib/forecast';

type ScheduleGame = {
  id: string;
  week: number;
  away: string;
  home: string;
  date: string;
  neutral: boolean;
  homeProbability: number;
  source: string;
};

function parseWeek(html: string, week: number, source: string): ScheduleGame[] {
  const unique = new Map<string, ScheduleGame>();
  for (const match of html.matchAll(/data-analytics="([^"]+)"/g)) {
    try {
      const item = JSON.parse(decodeAttribute(match[1]));
      if (!item.gameId || !item.linkName?.includes(' at ')) continue;
      const matchup = item.linkName.match(/^(.*?) at (.*?)(?:,|$)/);
      if (!matchup) continue;
      const away = TEAM_ALIASES[matchup[1]];
      const home = TEAM_ALIASES[matchup[2]];
      if (!away || !home) continue;
      const neutral = week === 1 && away === 'San Francisco 49ers' && home === 'Los Angeles Rams';
      const game = {
        id: String(item.gameId), week, away, home, neutral,
        date: toDisplayDate(item.linkName),
        homeProbability: probability(home, away, neutral), source,
      };
      unique.set(`${away}:${home}`, game);
    } catch {
      // Non-game analytics are intentionally ignored.
    }
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.away.localeCompare(b.away));
}

export async function GET(request: Request) {
  const rawWeek = new URL(request.url).searchParams.get('week');
  const requested = Number.parseInt(rawWeek ?? '1', 10);
  const week = Number.isFinite(requested) ? Math.min(18, Math.max(1, requested)) : 1;
  const source = `${SCHEDULE_BASE_URL}/week-${week}`;

  try {
    const response = await fetch(source, {
      headers: { 'user-agent': 'NFL Forecast Desk / schedule reader' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`NFL schedule returned ${response.status}`);
    const games = parseWeek(await response.text(), week, source);
    if (!games.length) throw new Error('No game cards were found on the official schedule page.');

    return NextResponse.json({
      week, games, retrievedAt: new Date().toISOString(), source,
      model: {
        label: 'Market-strength baseline + venue edge',
        ratings: TEAM_RATINGS,
        notes: 'Baseline strength is a preseason prior derived from published 2026 win totals. The live layer is applied in the browser after verified updates arrive.',
      },
    }, { headers: { 'cache-control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({
      error: 'The official NFL schedule could not be refreshed right now. No stale schedule is substituted.',
      detail: error instanceof Error ? error.message : 'Unknown schedule error',
      source,
    }, { status: 502, headers: { 'cache-control': 'no-store, max-age=0' } });
  }
}

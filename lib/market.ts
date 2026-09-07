import { TEAM_ALIASES } from '@/lib/forecast';

export const MARKET_SOURCE_URL = 'https://fantasydata.com/nfl/odds';
export const MARKET_SOURCE_LABEL = 'FantasyData consensus odds';

export type MarketLine = {
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

function clean(value: string) {
  return value
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function asNumber(value: string) {
  const match = value.match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalTeam(value: string) {
  const text = clean(value);
  const candidates = Object.entries(TEAM_ALIASES).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [alias, team] of candidates) {
    if (new RegExp(`(^|\\s)${escapeRegExp(alias)}(?=\\s|$)`, 'i').test(text))
      return team;
  }
  return null;
}

export function impliedProbability(americanOdds: number | null) {
  if (!americanOdds || !Number.isFinite(americanOdds)) return null;
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

export function noVigPair(
  awayMoneyline: number | null,
  homeMoneyline: number | null,
) {
  const away = impliedProbability(awayMoneyline);
  const home = impliedProbability(homeMoneyline);
  if (away === null || home === null || away + home <= 0)
    return { away: null, home: null };
  const total = away + home;
  return { away: away / total, home: home / total };
}

export function parseMarketHtml(html: string): MarketLine[] {
  const lines = new Map<string, MarketLine>();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => clean(cell[1]),
    );
    if (cells.length < 15) continue;
    const week = Number.parseInt(cells[2], 10);
    const away = canonicalTeam(cells[0]);
    const home = canonicalTeam(cells[1]);
    if (!Number.isInteger(week) || !away || !home) continue;
    const awayMoneyline = asNumber(cells[10]);
    const homeMoneyline = asNumber(cells[11]);
    const noVig = noVigPair(awayMoneyline, homeMoneyline);
    const line: MarketLine = {
      week,
      away,
      home,
      gameKey: `${away}__${home}`,
      awaySpread: asNumber(cells[6]),
      awaySpreadOdds: asNumber(cells[7]),
      homeSpread: asNumber(cells[8]),
      homeSpreadOdds: asNumber(cells[9]),
      awayMoneyline,
      homeMoneyline,
      totalLine: asNumber(cells[12]),
      overOdds: asNumber(cells[13]),
      underOdds: asNumber(cells[14]),
      awayImpliedProbability: noVig.away,
      homeImpliedProbability: noVig.home,
    };
    lines.set(line.gameKey, line);
  }
  return [...lines.values()];
}

export async function fetchMarketLines() {
  const response = await fetch(MARKET_SOURCE_URL, {
    headers: {
      'user-agent': 'NFL Forecast Desk / public market reference reader',
    },
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`Market reference returned ${response.status}.`);
  const lines = parseMarketHtml(await response.text());
  if (!lines.length)
    throw new Error(
      'No usable market lines were found in the public reference.',
    );
  return lines;
}

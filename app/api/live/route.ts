import { NextResponse } from 'next/server';
import { TEAM_NAMES } from '@/lib/forecast';

type FeedItem = { headline: string; description?: string; published?: string; link?: string };
type NewsResponse = {
  articles?: Array<{
    headline?: string;
    description?: string;
    published?: string;
    links?: { web?: { href?: string } };
  }>;
};

function teamMention(text: string) {
  const lowered = text.toLowerCase();
  return TEAM_NAMES.find((team) => lowered.includes(team.toLowerCase()) || lowered.includes(team.split(' ').at(-1)!.toLowerCase()));
}

function scoreUpdate(text: string) {
  const lowered = text.toLowerCase();
  if (/\b(out|injured reserve|reserve\/injured|surgery|torn|suspended)\b/.test(lowered)) return -1;
  if (/\b(doubtful|limited|misses practice)\b/.test(lowered)) return -0.5;
  if (/\b(questionable)\b/.test(lowered)) return -0.2;
  if (/\b(activated|cleared|returns?|practices fully)\b/.test(lowered)) return 0.35;
  if (/\b(acquired|traded for|signed)\b/.test(lowered)) return 0.15;
  return 0;
}

export async function GET() {
  const injurySource = 'https://www.nfl.com/injuries/';
  const officialNewsSource = 'https://www.nfl.com/news/';
  const feedSource = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30';
  let feedItems: FeedItem[] = [];
  let feedStatus = 'No structured news items were available on this refresh.';

  try {
    const response = await fetch(feedSource, { cache: 'no-store' });
    if (response.ok) {
      const body = await response.json() as NewsResponse;
      feedItems = (body.articles ?? []).flatMap((article) => article.headline ? [{
        headline: article.headline, description: article.description, published: article.published, link: article.links?.web?.href,
      }] : []);
      feedStatus = 'Structured league-news feed retrieved.';
    }
  } catch {
    feedStatus = 'Structured league-news feed was unavailable; official source links remain available.';
  }

  const adjustments: Record<string, number> = {};
  const updates = feedItems.slice(0, 12).map((item) => {
    const text = `${item.headline} ${item.description ?? ''}`;
    const team = teamMention(text);
    const impact = team ? scoreUpdate(text) : 0;
    if (team && impact !== 0) adjustments[team] = Math.max(-1.5, Math.min(1.5, (adjustments[team] ?? 0) + impact));
    return {
      ...item, team: team ?? 'League-wide', impact,
      status: team && impact !== 0 ? 'Applied' : 'Monitor only',
    };
  });

  return NextResponse.json({
    retrievedAt: new Date().toISOString(), adjustments, updates, feedStatus,
    sources: [
      { label: 'NFL injury report', url: injurySource },
      { label: 'NFL news', url: officialNewsSource },
      { label: 'Structured league-news feed', url: feedSource },
    ],
    policy: 'Only clearly team-attributable availability or transaction signals move the model. Unclear reports remain visible but do not alter a probability. Adjustment sizes are capped and are not a substitute for official game status.',
  }, { headers: { 'cache-control': 'no-store, max-age=0' } });
}

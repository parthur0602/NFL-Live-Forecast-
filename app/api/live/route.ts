import { NextResponse } from 'next/server';
import { TEAM_NAMES } from '@/lib/forecast';
import { saveFootballSignals } from '@/lib/football-state';

type FeedItem = {
  headline: string;
  description?: string;
  published?: string;
  link?: string;
};
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
  return TEAM_NAMES.find(
    (team) =>
      lowered.includes(team.toLowerCase()) ||
      lowered.includes(team.split(' ').at(-1)!.toLowerCase()),
  );
}

function classifySignal(text: string) {
  const lowered = text.toLowerCase();
  if (/\b(out|injured reserve|reserve\/injured|surgery|torn|suspended)\b/.test(lowered))
    return { stateType: 'availability_news', status: 'negative' };
  if (/\b(doubtful|limited|misses practice|questionable)\b/.test(lowered))
    return { stateType: 'availability_news', status: 'uncertain' };
  if (/\b(activated|cleared|returns?|practices fully)\b/.test(lowered))
    return { stateType: 'availability_news', status: 'positive' };
  if (/\b(acquired|traded for|signed|released|waived)\b/.test(lowered))
    return { stateType: 'transaction_news', status: 'reported' };
  return { stateType: 'general_news', status: 'reported' };
}

export async function GET() {
  const injurySource = 'https://www.nfl.com/injuries/';
  const officialNewsSource = 'https://www.nfl.com/news/';
  const feedSource =
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30';
  let feedItems: FeedItem[] = [];
  let feedStatus = 'No structured news items were available on this refresh.';

  try {
    const response = await fetch(feedSource, { cache: 'no-store' });
    if (response.ok) {
      const body = (await response.json()) as NewsResponse;
      feedItems = (body.articles ?? []).flatMap((article) =>
        article.headline
          ? [
              {
                headline: article.headline,
                description: article.description,
                published: article.published,
                link: article.links?.web?.href,
              },
            ]
          : [],
      );
      feedStatus = 'Structured league-news feed retrieved.';
    }
  } catch {
    feedStatus =
      'Structured league-news feed was unavailable; official source links remain available.';
  }

  const retrievedAt = new Date().toISOString();
  const updates = feedItems.slice(0, 20).map((item) => {
    const text = `${item.headline} ${item.description ?? ''}`;
    const team = teamMention(text);
    const classification = classifySignal(text);
    return {
      ...item,
      team: team ?? 'League-wide',
      impact: 0,
      status: 'Monitor only' as const,
      stateType: classification.stateType,
      signalStatus: classification.status,
    };
  });

  // Archive team-attributable news for later prospective specialist research.
  // These unstructured headline signals are intentionally NOT eligible to move
  // production probabilities. A specialist must first prove incremental value
  // against timestamp-matched market forecasts.
  const storable = updates.flatMap((item) => {
    if (item.team === 'League-wide') return [];
    return [
      {
        team: item.team,
        stateType: item.stateType,
        subject: item.headline.slice(0, 180),
        status: item.signalStatus,
        source: 'ESPN structured league-news feed',
        sourceUrl: item.link ?? feedSource,
        observedAt: item.published ?? retrievedAt,
        confidence: 0.35,
        payload: {
          headline: item.headline,
          description: item.description ?? null,
          retrievedAt,
        },
        eligibleForModel: false,
      },
    ];
  });
  try {
    await saveFootballSignals(storable);
  } catch {
    // The news display remains available even if the research ledger is not yet
    // migrated in a local/development environment.
  }

  return NextResponse.json(
    {
      retrievedAt,
      adjustments: {},
      updates,
      feedStatus,
      sources: [
        { label: 'NFL injury report', url: injurySource },
        { label: 'NFL news', url: officialNewsSource },
        { label: 'Structured league-news feed', url: feedSource },
      ],
      policy:
        'Unstructured news is archived as timestamped research evidence but has zero production influence. V2 remains market-anchored until a football specialist demonstrates chronological, timestamp-matched improvement.',
    },
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  );
}

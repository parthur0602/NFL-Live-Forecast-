import { NextResponse } from 'next/server';
import {
  fetchMarketLines,
  MARKET_SOURCE_LABEL,
  MARKET_SOURCE_URL,
} from '@/lib/market';
import { saveMarketSnapshots } from '@/lib/learning';

export async function GET(request: Request) {
  const parsed = Number.parseInt(
    new URL(request.url).searchParams.get('week') ?? '1',
    10,
  );
  const week = Number.isInteger(parsed) ? Math.max(1, Math.min(18, parsed)) : 1;
  const observedAt = new Date().toISOString();
  try {
    const lines = (await fetchMarketLines()).filter(
      (line) => line.week === week,
    );
    if (!lines.length)
      throw new Error(
        `No Week ${week} lines are currently available from the reference.`,
      );
    await saveMarketSnapshots(
      lines.map((line) => ({
        ...line,
        source: MARKET_SOURCE_LABEL,
        observedAt,
      })),
    );
    return NextResponse.json(
      {
        week,
        observedAt,
        source: { label: MARKET_SOURCE_LABEL, url: MARKET_SOURCE_URL },
        lines,
        note: 'Moneyline probabilities are calculated from the two displayed moneylines after removing their combined hold. Lines are a timestamped market reference, not an instruction to bet.',
      },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          'The market reference could not be refreshed. No old odds are substituted.',
        detail: error instanceof Error ? error.message : 'Unknown market error',
        source: { label: MARKET_SOURCE_LABEL, url: MARKET_SOURCE_URL },
      },
      { status: 502, headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }
}

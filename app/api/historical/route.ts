import { NextResponse } from 'next/server';
import { HISTORICAL_BACKTEST } from '@/lib/historical-backtest-data';

export async function GET() {
  const { records: _records, ...dashboard } = HISTORICAL_BACKTEST;
  return NextResponse.json(dashboard, {
    headers: {
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

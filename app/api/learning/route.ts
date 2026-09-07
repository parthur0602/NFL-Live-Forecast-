import { NextResponse } from 'next/server';
import { learningDashboard } from '@/lib/learning';

export async function GET() {
  try {
    return NextResponse.json(await learningDashboard(), { headers: { 'cache-control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({
      error: 'The learning history is temporarily unavailable.',
      detail: error instanceof Error ? error.message : 'Unknown learning error',
    }, { status: 503, headers: { 'cache-control': 'no-store, max-age=0' } });
  }
}

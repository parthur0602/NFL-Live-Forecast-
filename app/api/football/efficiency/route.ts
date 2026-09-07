import { NextResponse } from 'next/server';
import { refreshTeamEfficiency } from '@/lib/team-efficiency';

export async function GET(request: Request) {
  const rawWeek = new URL(request.url).searchParams.get('week');
  const week = Number.parseInt(rawWeek ?? '1', 10);
  if (!Number.isInteger(week) || week < 1 || week > 22)
    return NextResponse.json({ error: 'Invalid week.' }, { status: 400 });
  try {
    const result = await refreshTeamEfficiency(week);
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Team-efficiency refresh failed.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502, headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }
}

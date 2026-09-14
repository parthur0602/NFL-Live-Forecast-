import { NextResponse } from 'next/server';

// Canonical forecasts are assembled from the server's schedule, market, and
// V2 calculation in /api/prospective-exam. Accepting a browser payload here
// would let a refresh (or modified client) contaminate learning/postmortems.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Browser-submitted prediction snapshots are disabled. Canonical forecasts are captured server-side before kickoff.',
    },
    {
      status: 405,
      headers: { 'cache-control': 'no-store, max-age=0' },
    },
  );
}

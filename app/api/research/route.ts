import { NextResponse } from 'next/server';
import { FAILURE_ATLAS } from '@/lib/failure-atlas-data';
import { V5_RESIDUAL_ROBUSTNESS } from '@/lib/v5-residual-robustness-data';
import { V5_SHADOW_RESIDUAL } from '@/lib/v5-shadow-residual-data';

// These generated artifacts are read-only research outputs. Keeping them on
// the server makes the dashboard's historical evidence inspectable without
// making any client-side calculation authoritative for V2 or V5.
export async function GET() {
  return NextResponse.json(
    {
      failureAtlas: FAILURE_ATLAS,
      shadowResidual: V5_SHADOW_RESIDUAL,
      robustness: V5_RESIDUAL_ROBUSTNESS,
    },
    { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' } },
  );
}

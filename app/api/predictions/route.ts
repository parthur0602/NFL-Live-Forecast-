import { NextResponse } from 'next/server';
import { capturePredictions } from '@/lib/learning';

type ClientPick = {
  week?: unknown;
  gameKey?: unknown;
  away?: unknown;
  home?: unknown;
  predictedWinner?: unknown;
  homeProbability?: unknown;
  marketHomeProbability?: unknown;
  footballHomeProbability?: unknown;
  expectedHomeMargin?: unknown;
  marketExpectedHomeMargin?: unknown;
  homeSpread?: unknown;
  homeCoverProbability?: unknown;
  modelVersion?: unknown;
  favoriteProbability?: unknown;
  liveDelta?: unknown;
};

function validPick(value: ClientPick) {
  const number = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input);
  const nullableNumber = (input: unknown, min: number, max: number) =>
    input === null ||
    input === undefined ||
    (number(input) && (input as number) >= min && (input as number) <= max);
  return (
    Number.isInteger(value.week) &&
    (value.week as number) >= 1 &&
    (value.week as number) <= 18 &&
    typeof value.gameKey === 'string' &&
    value.gameKey.length <= 150 &&
    typeof value.away === 'string' &&
    typeof value.home === 'string' &&
    typeof value.predictedWinner === 'string' &&
    number(value.homeProbability) &&
    (value.homeProbability as number) >= 0.01 &&
    (value.homeProbability as number) <= 0.99 &&
    nullableNumber(value.marketHomeProbability, 0.01, 0.99) &&
    nullableNumber(value.footballHomeProbability, 0.01, 0.99) &&
    nullableNumber(value.expectedHomeMargin, -60, 60) &&
    nullableNumber(value.marketExpectedHomeMargin, -60, 60) &&
    nullableNumber(value.homeSpread, -40, 40) &&
    nullableNumber(value.homeCoverProbability, 0.01, 0.99) &&
    (value.modelVersion === null ||
      value.modelVersion === undefined ||
      (typeof value.modelVersion === 'string' && value.modelVersion.length <= 96)) &&
    number(value.favoriteProbability) &&
    (value.favoriteProbability as number) >= 0.5 &&
    (value.favoriteProbability as number) <= 0.99 &&
    number(value.liveDelta) &&
    Math.abs(value.liveDelta as number) <= 0.25
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { games?: ClientPick[] };
    if (
      !Array.isArray(body.games) ||
      body.games.length > 18 ||
      !body.games.every(validPick)
    ) {
      return NextResponse.json(
        { error: 'Invalid prediction snapshot.' },
        { status: 400 },
      );
    }
    const captured = await capturePredictions(
      body.games as Array<{
        week: number;
        gameKey: string;
        away: string;
        home: string;
        predictedWinner: string;
        homeProbability: number;
        marketHomeProbability: number | null;
        footballHomeProbability: number | null;
        expectedHomeMargin: number | null;
        marketExpectedHomeMargin: number | null;
        homeSpread: number | null;
        homeCoverProbability: number | null;
        modelVersion: string | null;
        favoriteProbability: number;
        liveDelta: number;
      }>,
    );
    return NextResponse.json(
      { captured },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'The prediction snapshot could not be stored.',
        detail:
          error instanceof Error ? error.message : 'Unknown snapshot error',
      },
      { status: 503 },
    );
  }
}

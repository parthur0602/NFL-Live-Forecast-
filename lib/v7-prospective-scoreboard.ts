type V7Row = {
  game_key: string;
  week: number;
  away_team: string;
  home_team: string;
  captured_at: string;
  v2_home_probability: number;
  v2_predicted_winner: string;
  final_home_probability: number;
  predicted_winner: string;
  upset_risk: string | null;
  winner: string;
};

function clamp(value: number) {
  return Math.max(0.01, Math.min(0.99, value));
}

function score(rows: V7Row[], key: 'v2_home_probability' | 'final_home_probability') {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const probability = clamp(row[key]);
    const homeWon = row.winner === row.home_team ? 1 : 0;
    if ((probability >= 0.5 ? 1 : 0) === homeWon) correct += 1;
    brier += (probability - homeWon) ** 2;
    logLoss += -(homeWon * Math.log(probability) + (1 - homeWon) * Math.log(1 - probability));
  }
  return { games: rows.length, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length };
}

function disagreementBucket(delta: number) {
  if (delta < 2) return '0–2 pp';
  if (delta < 5) return '2–5 pp';
  if (delta < 8) return '5–8 pp';
  if (delta < 12) return '8–12 pp';
  return '12+ pp';
}

function confidenceBucket(probability: number) {
  const confidence = Math.max(probability, 1 - probability);
  if (confidence < 0.75) return '70–75%';
  if (confidence < 0.8) return '75–80%';
  if (confidence < 0.85) return '80–85%';
  return '85%+';
}

export async function v7ProspectiveScoreboard(database: D1Database, season = 2026) {
  const result = await database
    .prepare(
      `SELECT game_key, week, away_team, home_team, captured_at,
        v2_home_probability, v2_predicted_winner, final_home_probability,
        predicted_winner, upset_risk, winner
       FROM v7_intelligence_snapshots
       WHERE season = ? AND winner IS NOT NULL AND winner != 'TIE'
       ORDER BY captured_at ASC, id ASC`,
    )
    .bind(season)
    .all<V7Row>();
  // A game can have several pre-kickoff records; score it once using its first
  // frozen capture so refresh frequency can never change the scoreboard.
  const rows = [...new Map(result.results.map((row) => [row.game_key, row])).values()];
  const disagreementBuckets = new Map<string, { games: number; v2Wins: number; v7Wins: number; flips: number }>();
  const calibration = new Map<string, { games: number; v2Expected: number; v2Wins: number; v7Expected: number; v7Wins: number }>();
  let v2DisagreementWins = 0;
  let v7DisagreementWins = 0;
  let correctWarnings = 0;
  let falseWarnings = 0;
  for (const row of rows) {
    const homeWon = row.winner === row.home_team;
    const v2Correct = row.v2_predicted_winner === row.winner;
    const v7Correct = row.predicted_winner === row.winner;
    const delta = Math.abs(row.final_home_probability - row.v2_home_probability) * 100;
    const label = disagreementBucket(delta);
    const disagreement = disagreementBuckets.get(label) ?? { games: 0, v2Wins: 0, v7Wins: 0, flips: 0 };
    disagreement.games += 1;
    disagreement.v2Wins += Number(v2Correct);
    disagreement.v7Wins += Number(v7Correct);
    disagreement.flips += Number((row.v2_home_probability >= 0.5) !== (row.final_home_probability >= 0.5));
    disagreementBuckets.set(label, disagreement);
    if (row.v2_predicted_winner !== row.predicted_winner) {
      v2DisagreementWins += Number(v2Correct);
      v7DisagreementWins += Number(v7Correct);
    }
    const favoriteHome = row.v2_home_probability >= 0.5;
    const v2FavoriteProbability = Math.max(row.v2_home_probability, 1 - row.v2_home_probability);
    if (v2FavoriteProbability >= 0.7) {
      const bucket = confidenceBucket(row.v2_home_probability);
      const item = calibration.get(bucket) ?? { games: 0, v2Expected: 0, v2Wins: 0, v7Expected: 0, v7Wins: 0 };
      item.games += 1;
      item.v2Expected += v2FavoriteProbability;
      item.v2Wins += Number(favoriteHome === homeWon);
      const v7FavoriteHome = row.final_home_probability >= 0.5;
      item.v7Expected += Math.max(row.final_home_probability, 1 - row.final_home_probability);
      item.v7Wins += Number(v7FavoriteHome === homeWon);
      calibration.set(bucket, item);
      if (row.upset_risk === 'HIGH' || row.upset_risk === 'EXTREME') {
        if (favoriteHome !== homeWon) correctWarnings += 1;
        else falseWarnings += 1;
      }
    }
  }
  return {
    season,
    status: 'SHADOW_ONLY',
    productionInfluence: 0,
    games: rows.length,
    v2: score(rows, 'v2_home_probability'),
    v7: score(rows, 'final_home_probability'),
    headToHead: {
      probabilityDisagreements: rows.filter((row) => row.final_home_probability !== row.v2_home_probability).length,
      winnerDisagreements: rows.filter((row) => row.predicted_winner !== row.v2_predicted_winner).length,
      v2DisagreementWins,
      v7DisagreementWins,
    },
    disagreementBuckets: ['0–2 pp', '2–5 pp', '5–8 pp', '8–12 pp', '12+ pp'].map((label) => ({ label, ...(disagreementBuckets.get(label) ?? { games: 0, v2Wins: 0, v7Wins: 0, flips: 0 }) })),
    bigFavoriteCalibration: ['70–75%', '75–80%', '80–85%', '85%+'].map((label) => {
      const item = calibration.get(label);
      return {
        bucket: label,
        games: item?.games ?? 0,
        v2PredictedWinRate: item ? item.v2Expected / item.games : null,
        v2ActualWinRate: item ? item.v2Wins / item.games : null,
        v7PredictedWinRate: item ? item.v7Expected / item.games : null,
        v7ActualWinRate: item ? item.v7Wins / item.games : null,
      };
    }),
    upsetWarnings: { correctWarnings, falseWarnings },
    promotionGate: 'Not eligible: prospective settled-game sample is not yet meaningful.',
  };
}

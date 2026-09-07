export const PROSPECTIVE_SHADOW_LABEL =
  'SHADOW ONLY — does not affect production';

export type ProspectiveCaptureInput = {
  season: number;
  week: number;
  gameKey: string;
  awayTeam: string;
  homeTeam: string;
  scheduledKickoffAt: string | null;
  marketObservedAt: string | null;
  marketSource: string | null;
  marketHomeProbability: number | null;
  v2HomeProbability: number;
  v2PredictedWinner: string;
  v2ModelVersion: string;
  v5HomeProbability: number | null;
  v5PredictedWinner: string | null;
  v5RawResidualLogit: number | null;
  v5AppliedShadowScale: number | null;
  v5ModelVersion: string | null;
  v5FeatureDataThroughWeek: number | null;
  v5FeaturePayload: Record<string, unknown>;
  v5Available: boolean;
};

type SettledResult = {
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
};
type SnapshotRow = {
  week: number;
  game_key: string;
  away_team: string;
  home_team: string;
  market_home_probability: number | null;
  v2_home_probability: number;
  v2_predicted_winner: string;
  v5_home_probability: number | null;
  v5_predicted_winner: string | null;
  v5_available: number;
  v5_feature_payload_json: string | null;
  winner: string;
};

function clampProbability(value: number) {
  return Math.max(0.01, Math.min(0.99, value));
}

function captureBucket(timestamp: string) {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid capture timestamp.');
  parsed.setUTCMinutes(0, 0, 0);
  return parsed.toISOString();
}

export function captureHorizon(
  scheduledKickoffAt: string | null,
  capturedAt: string,
) {
  if (!scheduledKickoffAt) return 'OPENING';
  const kickoff = new Date(scheduledKickoffAt).getTime();
  const captured = new Date(capturedAt).getTime();
  if (!Number.isFinite(kickoff) || !Number.isFinite(captured)) return 'OPENING';
  const hours = (kickoff - captured) / 3_600_000;
  if (hours > 72) return 'OPENING';
  if (hours > 24) return '72H';
  if (hours > 6) return '24H';
  if (hours > 1.5) return '6H';
  if (hours > 0.5) return '90M';
  return 'FINAL_PREKICK';
}

function beforeKickoff(scheduledKickoffAt: string | null, capturedAt: string) {
  if (!scheduledKickoffAt) return true;
  const kickoff = new Date(scheduledKickoffAt).getTime();
  const captured = new Date(capturedAt).getTime();
  return !Number.isFinite(kickoff) || !Number.isFinite(captured) || captured < kickoff;
}

export async function captureProspectiveRows(
  database: D1Database,
  items: ProspectiveCaptureInput[],
  capturedAt = new Date().toISOString(),
) {
  const accepted = items.filter((item) => {
    if (!beforeKickoff(item.scheduledKickoffAt, capturedAt)) return false;
    if (item.v5Available && item.marketHomeProbability === null)
      throw new Error('A V5 paired record requires the same market probability used by V2.');
    if (item.v5Available && item.v5HomeProbability === null)
      throw new Error('A V5-available paired record requires a V5 probability.');
    return true;
  });
  const skippedAfterKickoff = items.length - accepted.length;
  const bucket = captureBucket(capturedAt);
  const before = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM prospective_model_snapshots WHERE season = ?`,
    )
    .bind(accepted[0]?.season ?? 2026)
    .first<{ count: number }>();
  const statements = accepted.map((item) => {
    const horizon = captureHorizon(item.scheduledKickoffAt, capturedAt);
    return database
      .prepare(
        `INSERT OR IGNORE INTO prospective_model_snapshots (season, week, game_key, away_team, home_team, scheduled_kickoff_at, capture_bucket, captured_at, market_observed_at, market_source, market_home_probability, v2_home_probability, v2_predicted_winner, v2_model_version, v5_home_probability, v5_predicted_winner, v5_raw_residual_logit, v5_applied_shadow_scale, v5_model_version, v5_feature_data_through_week, v5_feature_payload_json, v5_available, production_influence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(
        item.season,
        item.week,
        item.gameKey,
        item.awayTeam,
        item.homeTeam,
        item.scheduledKickoffAt,
        bucket,
        capturedAt,
        item.marketObservedAt,
        item.marketSource,
        item.marketHomeProbability,
        item.v2HomeProbability,
        item.v2PredictedWinner,
        item.v2ModelVersion,
        item.v5HomeProbability,
        item.v5PredictedWinner,
        item.v5RawResidualLogit,
        item.v5AppliedShadowScale,
        item.v5ModelVersion,
        item.v5FeatureDataThroughWeek,
        JSON.stringify({
          ...item.v5FeaturePayload,
          captureHorizon: horizon,
          v5UnavailableReason: item.v5Available
            ? null
            : item.v5FeaturePayload.unavailableReason ?? 'V5 is unavailable.',
        }),
        item.v5Available ? 1 : 0,
      );
  });
  if (statements.length) await database.batch(statements);
  const after = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM prospective_model_snapshots WHERE season = ?`,
    )
    .bind(accepted[0]?.season ?? 2026)
    .first<{ count: number }>();
  return {
    attempted: items.length,
    accepted: accepted.length,
    skippedAfterKickoff,
    inserted: Math.max(0, (after?.count ?? 0) - (before?.count ?? 0)),
    duplicateOrExisting: Math.max(0, accepted.length - Math.max(0, (after?.count ?? 0) - (before?.count ?? 0))),
    captureBucket: bucket,
  };
}

export async function settleProspectiveRows(
  database: D1Database,
  season: number,
  week: number,
  results: SettledResult[],
  settledAt = new Date().toISOString(),
) {
  const statements = results.map((result) => {
    const winner =
      result.homeScore > result.awayScore
        ? result.home
        : result.awayScore > result.homeScore
          ? result.away
          : 'TIE';
    return database
      .prepare(
        `UPDATE prospective_model_snapshots SET settled_at = ?, away_score = ?, home_score = ?, winner = ?, v2_correct = CASE WHEN v2_predicted_winner = ? THEN 1 ELSE 0 END, v5_correct = CASE WHEN v5_available = 1 THEN CASE WHEN v5_predicted_winner = ? THEN 1 ELSE 0 END ELSE NULL END WHERE season = ? AND week = ? AND game_key = ? AND winner IS NULL`,
      )
      .bind(
        settledAt,
        result.awayScore,
        result.homeScore,
        winner,
        winner,
        winner,
        season,
        week,
        `${result.away}__${result.home}`,
      );
  });
  if (statements.length) await database.batch(statements);
  return statements.length;
}

function safePayload(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function metrics(rows: SnapshotRow[], probability: (row: SnapshotRow) => number) {
  if (!rows.length)
    return {
      games: 0,
      accuracy: null,
      brier: null,
      logLoss: null,
      expectedLosses: null,
      actualLosses: null,
      excessLosses: null,
      calibration: [],
    };
  const buckets = Array.from({ length: 5 }, (_, index) => ({
    label: `${index * 20}-${(index + 1) * 20}%`,
    count: 0,
    probability: 0,
    actual: 0,
  }));
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let expectedLosses = 0;
  for (const row of rows) {
    const p = clampProbability(probability(row));
    const actual = row.winner === row.home_team ? 1 : 0;
    const pick = p >= 0.5 ? row.home_team : row.away_team;
    if (pick === row.winner) correct += 1;
    brier += (p - actual) ** 2;
    logLoss += -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
    expectedLosses += 1 - Math.max(p, 1 - p);
    const bucket = buckets[Math.min(4, Math.floor(p * 5))];
    bucket.count += 1;
    bucket.probability += p;
    bucket.actual += actual;
  }
  const actualLosses = rows.length - correct;
  return {
    games: rows.length,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    expectedLosses,
    actualLosses,
    excessLosses: actualLosses - expectedLosses,
    calibration: buckets
      .filter((bucket) => bucket.count)
      .map((bucket) => ({
        label: bucket.label,
        games: bucket.count,
        averageProbability: bucket.probability / bucket.count,
        actualHomeWinRate: bucket.actual / bucket.count,
      })),
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pairedBootstrap(rows: SnapshotRow[]) {
  if (rows.length < 30) return null;
  const random = seededRandom(20260907);
  const brier: number[] = [];
  const logLoss: number[] = [];
  const accuracy: number[] = [];
  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    let brierDelta = 0;
    let logLossDelta = 0;
    let accuracyDelta = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[Math.floor(random() * rows.length)];
      const actual = row.winner === row.home_team ? 1 : 0;
      const v2 = clampProbability(row.v2_home_probability);
      const v5 = clampProbability(row.v5_home_probability!);
      brierDelta += (v5 - actual) ** 2 - (v2 - actual) ** 2;
      logLossDelta +=
        -(actual * Math.log(v5) + (1 - actual) * Math.log(1 - v5)) -
        -(actual * Math.log(v2) + (1 - actual) * Math.log(1 - v2));
      accuracyDelta += (v5 >= 0.5 ? 1 : 0) === actual ? 1 : 0;
      accuracyDelta -= (v2 >= 0.5 ? 1 : 0) === actual ? 1 : 0;
    }
    brier.push(brierDelta / rows.length);
    logLoss.push(logLossDelta / rows.length);
    accuracy.push(accuracyDelta / rows.length);
  }
  const interval = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return [
      sorted[Math.floor((sorted.length - 1) * 0.025)],
      sorted[Math.floor((sorted.length - 1) * 0.975)],
    ];
  };
  return {
    resamples: 5_000,
    deltaBrier95: interval(brier),
    deltaLogLoss95: interval(logLoss),
    deltaAccuracy95: interval(accuracy),
  };
}

export async function prospectiveSeasonExam(
  database: D1Database,
  season = 2026,
) {
  const settled = (
    await database
      .prepare(
        `SELECT week, game_key, away_team, home_team, market_home_probability, v2_home_probability, v2_predicted_winner, v5_home_probability, v5_predicted_winner, v5_available, v5_feature_payload_json, winner FROM prospective_model_snapshots WHERE season = ? AND winner IS NOT NULL ORDER BY week, captured_at, id`,
      )
      .bind(season)
      .all<SnapshotRow>()
  ).results;
  const v5Rows = settled.filter(
    (row) => row.v5_available === 1 && row.v5_home_probability !== null,
  );
  const v2 = metrics(settled, (row) => row.v2_home_probability);
  const v2Paired = metrics(v5Rows, (row) => row.v2_home_probability);
  const v5 = metrics(v5Rows, (row) => row.v5_home_probability!);
  const disagreements = v5Rows.filter(
    (row) => row.v2_predicted_winner !== row.v5_predicted_winner,
  );
  const v2DisagreementWins = disagreements.filter(
    (row) => row.v2_predicted_winner === row.winner,
  ).length;
  const v5DisagreementWins = disagreements.filter(
    (row) => row.v5_predicted_winner === row.winner,
  ).length;
  const horizons = new Map<string, number>();
  for (const row of settled) {
    const horizon = safePayload(row.v5_feature_payload_json).captureHorizon;
    const label = typeof horizon === 'string' ? horizon : 'OPENING';
    horizons.set(label, (horizons.get(label) ?? 0) + 1);
  }
  return {
    season,
    label: PROSPECTIVE_SHADOW_LABEL,
    pairedRowsSettled: settled.length,
    v2,
    v5,
    pairedDeltas:
      v5.games && v2Paired.games
        ? {
            brier: v5.brier! - v2Paired.brier!,
            logLoss: v5.logLoss! - v2Paired.logLoss!,
            accuracy: v5.accuracy! - v2Paired.accuracy!,
          }
        : null,
    disagreements: {
      rows: disagreements.length,
      v2Wins: v2DisagreementWins,
      v5Wins: v5DisagreementWins,
      winner:
        v2DisagreementWins === v5DisagreementWins
          ? 'TIED'
          : v2DisagreementWins > v5DisagreementWins
            ? 'V2'
            : 'V5',
    },
    v5AvailabilityRate: settled.length ? v5Rows.length / settled.length : null,
    captureHorizons: Object.fromEntries(horizons),
    pairedBootstrap: pairedBootstrap(v5Rows),
  };
}

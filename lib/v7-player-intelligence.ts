import { V7_PLAYER_VALUE_ARTIFACT } from '@/lib/v7-player-value-artifact';

type PlayerRecord = Record<string, unknown>;
type PlayerValueRecord = {
  playerId: string | null;
  player: string;
  position: string;
  playerValueScore: number;
  replacementValue: number | null;
  replacementGap: number | null;
  replacementQuality: string;
  targetShare: number | null;
  rushShare: number | null;
  sourceSeason: number;
  qbMetrics: {
    attempts: number;
    starts: null;
    passingEpaPerDropback: number | null;
    completionPct: number | null;
    interceptionRate: number | null;
    sackRate: number | null;
    scrambleRate: null;
  } | null;
};

type TeamIntelligenceInput = {
  team: string;
  availability: PlayerRecord[];
  depth: PlayerRecord[];
};

function text(record: PlayerRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function activeRoster(record: PlayerRecord) {
  return text(record, 'rosterStatus') === 'ACT';
}

function positionGroup(position: string | null) {
  if (!position) return 'UNKNOWN';
  if (['T', 'OT', 'OL'].includes(position)) return 'OL';
  if (['G', 'C', 'OG', 'LG', 'RG', 'LT', 'RT'].includes(position)) return 'OL';
  if (['CB', 'DB', 'S', 'SAF'].includes(position)) return 'SECONDARY';
  if (['DE', 'DL', 'DT', 'NT', 'EDGE', 'LB'].includes(position)) return 'FRONT_SEVEN';
  return position;
}

const artifactPlayers = V7_PLAYER_VALUE_ARTIFACT.players as unknown as readonly PlayerValueRecord[];
const valuesById = new Map<string, PlayerValueRecord>(
  artifactPlayers
    .filter((player) => player.playerId)
    .map((player) => [player.playerId!, player]),
);

function valueFor(record: PlayerRecord) {
  const playerId = text(record, 'playerId');
  return playerId ? valuesById.get(playerId) ?? null : null;
}

function positionCoverage(depth: PlayerRecord[]) {
  const active = depth.filter(activeRoster);
  return {
    rosterPlayers: depth.length,
    activeRosterPlayers: active.length,
    positionOnlyRows: active.filter((record) => text(record, 'depthChartPosition')).length,
    exactDepthRankRows: active.filter((record) => typeof record.depthRank === 'number').length,
    depthChartFirstStringRows: active.filter((record) => text(record, 'starterStatus') === 'DEPTH_CHART_FIRST_STRING').length,
    starterConfirmedRows: 0,
    status: 'DEPTH_CHART_RANK_AVAILABLE_NO_GAME_DAY_STARTER_CONFIRMATION',
  };
}

function teamIntelligence(input: TeamIntelligenceInput) {
  const active = input.depth.filter(activeRoster);
  const valued = active.flatMap((record) => {
    const value = valueFor(record);
    if (!value) return [];
    return [{
      playerId: value.playerId,
      player: text(record, 'player') ?? value.player,
      position: text(record, 'position') ?? value.position,
      depthRank: typeof record.depthRank === 'number' ? record.depthRank : null,
      starterStatus: text(record, 'starterStatus'),
      playerValueScore: value.playerValueScore,
      replacementValue: value.replacementValue,
      replacementGap: value.replacementGap,
      replacementPlayer: null,
      replacementQuality: value.replacementQuality,
      targetShare: value.targetShare,
      rushShare: value.rushShare,
      routeParticipation: null,
      redZoneUsage: null,
      thirdDownUsage: null,
      offensiveSnapShare: null,
      defensiveSnapShare: null,
      recentPlayingTimeTrend: null,
      sourceSeason: value.sourceSeason,
    }];
  }).sort((left, right) => right.playerValueScore - left.playerValueScore);
  const availabilityById = new Map(input.availability.map((record) => [text(record, 'playerId'), record]));
  const explicitOut = valued.flatMap((player) => {
    const availability = availabilityById.get(player.playerId);
    return text(availability ?? {}, 'injuryDesignation')?.toUpperCase() === 'OUT'
      ? [{ ...player, status: 'OUT', practiceStatus: text(availability ?? {}, 'practiceStatus') }]
      : [];
  });
  const clusters = ['OL', 'SECONDARY', 'WR', 'FRONT_SEVEN'].flatMap((group) => {
    const unavailable = explicitOut.filter((player) => positionGroup(player.position) === group);
    return unavailable.length >= 2
      ? [{ group, unavailablePlayers: unavailable, status: 'RESEARCH_CLUSTER_NO_PRODUCTION_IMPACT' }]
      : [];
  });
  const qbs = valued.filter((player) => player.position === 'QB').map((player) => {
    const availability = availabilityById.get(player.playerId);
    const qbMetrics = valuesById.get(player.playerId ?? '')?.qbMetrics ?? null;
    return {
      ...player,
      starterIdentity: player.starterStatus === 'DEPTH_CHART_FIRST_STRING' ? 'DEPTH_CHART_FIRST_STRING' : 'UNCONFIRMED',
      starterProbability: null,
      injuryStatus: text(availability ?? {}, 'injuryDesignation'),
      practiceStatus: text(availability ?? {}, 'practiceStatus'),
      qbMetrics,
      availabilityAdjustment: 0,
      confidence: player.starterStatus === 'DEPTH_CHART_FIRST_STRING'
        ? 'DEPTH_CHART_RANK_AVAILABLE_NO_GAME_DAY_CONFIRMATION'
        : 'UNAVAILABLE_NO_TIMESTAMPED_STARTER_OR_DEPTH_RANK',
      reason: 'Historical production is retained for research; no V2 or V7 probability uses it.',
    };
  });
  return {
    team: input.team,
    productionInfluence: 0,
    starterStatusCoverage: {
      confirmedStarters: 0,
      status: 'UNAVAILABLE_NO_VALIDATED_PREGAME_STARTER_SOURCE',
    },
    depthCoverage: positionCoverage(input.depth),
    inactiveCoverage: {
      officialInactiveList: 'UNAVAILABLE_NO_CONNECTED_OFFICIAL_PREKICK_SOURCE',
      explicitOutInjuryReports: explicitOut.length,
    },
    playerValueCoverage: {
      activeRosterPlayersMatchedToResearchArtifact: valued.length,
      activeRosterPlayersUnmatched: Math.max(0, active.length - valued.length),
      sourceSeason: 2025,
      status: 'RESEARCH_ONLY_POSTGAME_PRODUCTION',
    },
    topPlayers: valued.slice(0, 25),
    importantUnavailable: explicitOut,
    injuryClusters: clusters,
    qbSpecialist: qbs,
  };
}

export function buildV7PlayerIntelligence(input: {
  away: TeamIntelligenceInput;
  home: TeamIntelligenceInput;
  sourceHealth?: Record<string, unknown>;
}) {
  const away = teamIntelligence(input.away);
  const home = teamIntelligence(input.home);
  return {
    version: V7_PLAYER_VALUE_ARTIFACT.version,
    artifactHash: V7_PLAYER_VALUE_ARTIFACT.artifactHash,
    productionInfluence: 0,
    sourceHealth: input.sourceHealth ?? {},
    away,
    home,
    limitations: [
      'Current sources expose roster position, timestamped depth-chart rank, and injury/practice rows, but not validated game-day starter identity, game-day inactive lists, snap shares, routes, red-zone use, or named replacement players.',
      'Replacement values are shrinkage-based position baselines from 2025 postgame production—not player-specific absence estimates.',
      'Player, QB, and injury-cluster outputs are research-only and never change V2, V7 probability, specialist weights, or betting behavior.',
    ],
  };
}

export function v7DifferenceExplanation(input: {
  v2HomeProbability: number;
  v7HomeProbability: number;
  v7Available: boolean;
  rawResidualLogit: unknown;
  playerIntelligence: ReturnType<typeof buildV7PlayerIntelligence>;
}) {
  const deltaPoints = (input.v7HomeProbability - input.v2HomeProbability) * 100;
  const reasons: Array<Record<string, unknown>> = [];
  if (input.v7Available && Math.abs(deltaPoints) >= 3) {
    reasons.push({
      code: 'PRIOR_WEEK_TEAM_EFFICIENCY_RESIDUAL',
      effectPoints: deltaPoints,
      detail: 'Frozen V7 residual from current-season team statistics strictly before this forecast week.',
      rawResidualLogit: input.rawResidualLogit ?? null,
    });
  }
  return {
    thresholdPoints: 3,
    deltaPoints,
    displayed: Math.abs(deltaPoints) >= 3,
    reasons,
    nonCausalContext: {
      playerAvailability: 'Captured for shadow research only; it has zero probability influence.',
      injuryClusters: [
        ...input.playerIntelligence.away.injuryClusters,
        ...input.playerIntelligence.home.injuryClusters,
      ],
    },
  };
}

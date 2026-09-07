export const MARKET_AS_OF = 'September 1, 2026';
export const SCHEDULE_BASE_URL = 'https://www.nfl.com/schedules/2026/by-week';
export const HOME_FIELD_EDGE = 1.1;
export const LOGISTIC_SCALE = 4.8;

const marketWins: Array<[string, number]> = [
  ['Arizona Cardinals', 3.5], ['Atlanta Falcons', 7.5],
  ['Baltimore Ravens', 11.5], ['Buffalo Bills', 10.5],
  ['Carolina Panthers', 7.5], ['Chicago Bears', 9.5],
  ['Cincinnati Bengals', 9.5], ['Cleveland Browns', 5.5],
  ['Dallas Cowboys', 9.5], ['Denver Broncos', 9.5],
  ['Detroit Lions', 10.5], ['Green Bay Packers', 9.5],
  ['Houston Texans', 9.5], ['Indianapolis Colts', 7.5],
  ['Jacksonville Jaguars', 9.5], ['Kansas City Chiefs', 10.5],
  ['Las Vegas Raiders', 5.5], ['Los Angeles Chargers', 10.5],
  ['Los Angeles Rams', 11.5], ['Miami Dolphins', 4.5],
  ['Minnesota Vikings', 8.5], ['New England Patriots', 10.5],
  ['New Orleans Saints', 7.5], ['New York Giants', 7.5],
  ['New York Jets', 5.5], ['Philadelphia Eagles', 10.5],
  ['Pittsburgh Steelers', 8.5], ['San Francisco 49ers', 10.5],
  ['Seattle Seahawks', 10.5], ['Tampa Bay Buccaneers', 8.5],
  ['Tennessee Titans', 6.5], ['Washington Commanders', 7.5],
];

export const TEAM_RATINGS = Object.fromEntries(
  marketWins.map(([team, wins]) => [team, Number(((wins - 8.5) * 1.48).toFixed(2))]),
);

export const TEAM_ALIASES: Record<string, string> = {
  '49ers': 'San Francisco 49ers', Bears: 'Chicago Bears', Bengals: 'Cincinnati Bengals',
  Bills: 'Buffalo Bills', Broncos: 'Denver Broncos', Browns: 'Cleveland Browns',
  Buccaneers: 'Tampa Bay Buccaneers', Cardinals: 'Arizona Cardinals',
  Chargers: 'Los Angeles Chargers', Chiefs: 'Kansas City Chiefs', Colts: 'Indianapolis Colts',
  Commanders: 'Washington Commanders', Cowboys: 'Dallas Cowboys', Dolphins: 'Miami Dolphins',
  Eagles: 'Philadelphia Eagles', Falcons: 'Atlanta Falcons', Giants: 'New York Giants',
  Jaguars: 'Jacksonville Jaguars', Jets: 'New York Jets', Lions: 'Detroit Lions',
  Packers: 'Green Bay Packers', Panthers: 'Carolina Panthers', Patriots: 'New England Patriots',
  Raiders: 'Las Vegas Raiders', Rams: 'Los Angeles Rams', Ravens: 'Baltimore Ravens',
  Saints: 'New Orleans Saints', Seahawks: 'Seattle Seahawks', Steelers: 'Pittsburgh Steelers',
  Texans: 'Houston Texans', Titans: 'Tennessee Titans', Vikings: 'Minnesota Vikings',
};

export const TEAM_NAMES = Object.keys(TEAM_RATINGS);

export function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

export function probability(home: string, away: string, neutral = false, adjustments: Record<string, number> = {}) {
  const homeRating = (TEAM_RATINGS[home] ?? 0) + (adjustments[home] ?? 0);
  const awayRating = (TEAM_RATINGS[away] ?? 0) + (adjustments[away] ?? 0);
  return logistic((homeRating - awayRating + (neutral ? 0 : HOME_FIELD_EDGE)) / LOGISTIC_SCALE);
}

export type LearnedModelState = {
  completedWeeks: number;
  homeFieldAdjustment: number;
  confidenceShrinkage: number;
};

export const DEFAULT_LEARNED_MODEL: LearnedModelState = {
  completedWeeks: 0,
  homeFieldAdjustment: 0,
  confidenceShrinkage: 0,
};

export function learnedProbability(
  home: string,
  away: string,
  neutral = false,
  adjustments: Record<string, number> = {},
  learned: LearnedModelState = DEFAULT_LEARNED_MODEL,
) {
  const homeRating = (TEAM_RATINGS[home] ?? 0) + (adjustments[home] ?? 0);
  const awayRating = (TEAM_RATINGS[away] ?? 0) + (adjustments[away] ?? 0);
  const venue = neutral ? 0 : HOME_FIELD_EDGE + learned.homeFieldAdjustment;
  const raw = logistic((homeRating - awayRating + venue) / LOGISTIC_SCALE);
  return 0.5 + (raw - 0.5) * (1 - learned.confidenceShrinkage);
}

export function decodeAttribute(value: string) {
  return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
}

export function toDisplayDate(linkName: string) {
  const match = linkName.match(/, [^,]+, ([A-Za-z]+) (\d+)(?:st|nd|rd|th),/);
  if (!match) return 'Kickoff time to be announced';
  const year = match[1] === 'January' ? 2027 : 2026;
  return `${match[1]} ${match[2]}, ${year}`;
}

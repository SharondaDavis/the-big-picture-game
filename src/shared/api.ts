export type ZoneHint = 'TL' | 'TR' | 'BL' | 'BR';

export type Piece = {
  id: number;
  zone: ZoneHint;
};

export type PuzzleConfig = {
  date: string;
  title: string;
  imageUrl: string;
  gridSize: number;
};

export type LeaderboardEntry = {
  username: string;
  score: number;
};

export type GameStateResponse = {
  type: 'gameState';
  puzzle: PuzzleConfig;
  canvas: Record<string, true>;
  hand: Piece[];
  triesLeft: number;
  score: number;
  streak: number;
  locked: boolean;
  leaderboard: LeaderboardEntry[];
  completed: boolean;
  username: string;
  /** True once any placement today was made with hints on — kills the 2x bonus for the day. */
  usedHints: boolean;
  /** True only on the dev playtest subreddit; enables dev-only UI like the day reset. */
  playtest: boolean;
};

export type PlaceRequest = {
  pieceId: number;
  cellIndex: number;
  /** Whether zone hints were visible when this placement was made. */
  hintsOn: boolean;
};

export type PlaceResponse = {
  type: 'place';
  correct: boolean;
  alreadyFilled: boolean;
  triesLeft: number;
  score: number;
  newPiece: Piece | null;
  hand: Piece[];
  canvas: Record<string, true>;
  completed: boolean;
  /** Points awarded for this placement: 0 wrong, 1 correct, 2 correct in a no-hints day. */
  pointsEarned: number;
  usedHints: boolean;
};

export type RealtimeCanvasMessage = {
  type: 'canvas';
  cellIndex: number;
  completed: boolean;
  filledCount: number;
};

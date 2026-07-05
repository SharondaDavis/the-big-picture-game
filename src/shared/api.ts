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
};

export type RealtimeCanvasMessage = {
  type: 'canvas';
  cellIndex: number;
  completed: boolean;
  filledCount: number;
};

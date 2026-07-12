import { context, redis } from '@devvit/web/server';
import type { ZoneHint, Piece } from '../../shared/api';

// devvit.json's `dev.subreddit` — the only subreddit `devvit playtest` runs
// against, so this never matches in production.
const PLAYTEST_SUBREDDIT = 'bigpicture_game_dev';

export function isPlaytest(): boolean {
  return context.subredditName === PLAYTEST_SUBREDDIT;
}

export type PuzzleDefinition = {
  date: string;
  title: string;
  imageUrl: string;
  gridSize: number;
};

// Date-pinned puzzles override the rotation — use these to tie a specific
// day's art to a real-world moment.
export const PUZZLES: PuzzleDefinition[] = [
  // World Cup final week — the moment everyone saw.
  { date: '2026-07-14', title: 'Cup Fever', imageUrl: '/puzzle-004.svg', gridSize: 5 },
  { date: '2026-07-15', title: 'Cup Fever', imageUrl: '/puzzle-004.svg', gridSize: 5 },
];

// Days without a pinned puzzle rotate deterministically through this pool,
// so every player worldwide sees the same picture on the same UTC date.
// Grid scales with the art's intricacy: bolder pictures get fewer, larger
// tiles; detailed scenes get more pieces so more players can hold a full
// hand. Keep gridSize ≤ 5 until the crowd is big enough to finish more.
//
// Rotation favours mature, zeitgeist scenes — the moments Reddit is talking
// about (eclipse chasing, aurora season, the World Cup). The earlier playful
// art (puzzle-001..003) stays in public/ for themed days via PUZZLES pins.
export const PUZZLE_POOL: Omit<PuzzleDefinition, 'date'>[] = [
  { title: 'Totality', imageUrl: '/puzzle-005.svg', gridSize: 5 },
  { title: 'Aurora Watch', imageUrl: '/puzzle-006.svg', gridSize: 5 },
  { title: 'Cup Fever', imageUrl: '/puzzle-004.svg', gridSize: 5 },
];

export function getPuzzleForDate(date: string): PuzzleDefinition {
  const pinned = PUZZLES.find((p) => p.date === date);
  if (pinned) return pinned;
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const index = ((dayNumber % PUZZLE_POOL.length) + PUZZLE_POOL.length) % PUZZLE_POOL.length;
  return { ...PUZZLE_POOL[index]!, date };
}

export function todayDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

export const K = {
  canvas: (d: string) => `tbp:${d}:canvas`,
  hand: (d: string, u: string) => `tbp:${d}:hand:${u}`,
  tries: (d: string, u: string) => `tbp:${d}:tries:${u}`,
  score: (d: string, u: string) => `tbp:${d}:score:${u}`,
  lb: (d: string) => `tbp:${d}:lb`,
  complete: (d: string) => `tbp:${d}:complete`,
  streak: (u: string) => `tbp:streak:${u}`,
  // Set to '1' the first time a user places with hints visible; gates the
  // no-hints 2x scoring bonus for the rest of the day.
  usedHints: (d: string, u: string) => `tbp:${d}:usedhints:${u}`,
  // Community picture ideas, scored by submission timestamp.
  suggestions: () => 'tbp:suggestions',
  // Lifetime points across all days — the all-time leaderboard.
  lbAll: () => 'tbp:lb:alltime',
};

export function getZone(cellIndex: number, gridSize: number): ZoneHint {
  const row = Math.floor(cellIndex / gridSize);
  const col = cellIndex % gridSize;
  const half = Math.ceil(gridSize / 2);
  if (row < half && col < half) return 'TL';
  if (row < half) return 'TR';
  if (col < half) return 'BL';
  return 'BR';
}

export async function getCanvas(date: string): Promise<Record<string, true>> {
  const raw = await redis.hGetAll(K.canvas(date));
  const result: Record<string, true> = {};
  for (const k of Object.keys(raw)) result[k] = true;
  return result;
}

export async function dealPieces(date: string, gridSize: number, count: number): Promise<number[]> {
  const totalCells = gridSize * gridSize;
  const raw = await redis.hGetAll(K.canvas(date));
  const filled = new Set(Object.keys(raw).map(Number));
  const available: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (!filled.has(i)) available.push(i);
  }
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = available[i]!; available[i] = available[j]!; available[j] = tmp;
  }
  return available.slice(0, Math.min(count, available.length));
}

export async function initUserIfNeeded(
  date: string,
  username: string,
  gridSize: number
): Promise<void> {
  const existing = await redis.get(K.hand(date, username));
  if (existing !== undefined) return;
  const pieces = await dealPieces(date, gridSize, 5);
  await redis.set(K.hand(date, username), JSON.stringify(pieces));
  await redis.set(K.tries(date, username), '3');
  await redis.set(K.score(date, username), '0');
}

// Hands are dealt independently, so two players can hold the same cell.
// When someone else fills a cell you're holding, that piece is dead — swap
// it for a fresh unfilled cell so the day's five pieces stay playable.
// Replacements never grow the hand, so the five-a-day cap holds.
export async function reconcileHand(
  date: string,
  username: string,
  gridSize: number
): Promise<void> {
  const handStr = await redis.get(K.hand(date, username));
  if (!handStr) return;
  const ids: number[] = JSON.parse(handStr);
  if (ids.length === 0) return;
  const raw = await redis.hGetAll(K.canvas(date));
  const filled = new Set(Object.keys(raw).map(Number));
  const alive = ids.filter((id) => !filled.has(id));
  const deadCount = ids.length - alive.length;
  if (deadCount === 0) return;
  const aliveSet = new Set(alive);
  const replacements = (await dealPieces(date, gridSize, deadCount + alive.length)).filter(
    (id) => !aliveSet.has(id)
  );
  const next = [...alive, ...replacements.slice(0, deadCount)];
  await redis.set(K.hand(date, username), JSON.stringify(next));
}

export async function getUserHand(
  date: string,
  username: string,
  gridSize: number
): Promise<Piece[]> {
  const handStr = await redis.get(K.hand(date, username));
  const ids: number[] = handStr ? JSON.parse(handStr) : [];
  return ids.map((id) => ({ id, zone: getZone(id, gridSize) }));
}

export async function getLeaderboard(
  date: string
): Promise<Array<{ username: string; score: number }>> {
  return topOfBoard(K.lb(date));
}

export async function getAllTimeLeaderboard(): Promise<Array<{ username: string; score: number }>> {
  return topOfBoard(K.lbAll());
}

async function topOfBoard(key: string): Promise<Array<{ username: string; score: number }>> {
  try {
    const entries = await redis.zRange(key, '+inf', '-inf', {
      by: 'score',
      reverse: true,
      limit: { offset: 0, count: 10 },
    });
    return entries.map((e) => ({ username: e.member, score: e.score }));
  } catch {
    return [];
  }
}

export async function updateStreak(username: string, today: string): Promise<number> {
  const streakStr = await redis.get(K.streak(username));
  const streak: { count: number; lastDate: string } = streakStr
    ? JSON.parse(streakStr)
    : { count: 0, lastDate: '' };

  if (streak.lastDate === today) return streak.count;

  const d = new Date(today + 'T12:00:00Z');
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().split('T')[0];

  const newCount = streak.lastDate === yesterday ? streak.count + 1 : 1;
  await redis.set(K.streak(username), JSON.stringify({ count: newCount, lastDate: today }));
  return newCount;
}

export async function seedCanvas(
  date: string,
  gridSize: number,
  count: number = 3
): Promise<void> {
  const already = await redis.hGetAll(K.canvas(date));
  if (Object.keys(already).length > 0) return;

  const totalCells = gridSize * gridSize;
  const indices: number[] = Array.from({ length: totalCells }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = indices[i]!; indices[i] = indices[j]!; indices[j] = tmp;
  }
  const fields: Record<string, string> = {};
  for (const idx of indices.slice(0, count)) fields[String(idx)] = '1';
  await redis.hSet(K.canvas(date), fields);
}

import { redis } from '@devvit/web/server';
import type { ZoneHint, Piece } from '../../shared/api';

export type PuzzleDefinition = {
  date: string;
  title: string;
  imageUrl: string;
  gridSize: number;
};

// Hand-pick daily puzzles here. Swap imageUrl before launch.
export const PUZZLES: PuzzleDefinition[] = [
  {
    date: '2026-06-27',
    title: "Rocket's Return",
    imageUrl: '/puzzle-001.svg',
    gridSize: 4,
  },
  {
    date: '2026-06-28',
    title: "Rocket's Return",
    imageUrl: '/puzzle-001.svg',
    gridSize: 4,
  },
  {
    date: '2026-06-29',
    title: "Rocket's Return",
    imageUrl: '/puzzle-001.svg',
    gridSize: 4,
  },
];

export function getPuzzleForDate(date: string): PuzzleDefinition {
  return PUZZLES.find((p) => p.date === date) ?? PUZZLES[PUZZLES.length - 1]!;
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
  try {
    const entries = await redis.zRange(K.lb(date), '+inf', '-inf', {
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

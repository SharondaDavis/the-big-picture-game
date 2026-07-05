import { Hono } from 'hono';
import { context, redis, reddit, realtime } from '@devvit/web/server';
import type {
  GameStateResponse,
  PlaceRequest,
  PlaceResponse,
  RealtimeCanvasMessage,
} from '../../shared/api';
import {
  getPuzzleForDate,
  todayDate,
  K,
  getCanvas,
  getZone,
  getUserHand,
  initUserIfNeeded,
  dealPieces,
  getLeaderboard,
  updateStreak,
  seedCanvas,
  isPlaytest,
} from '../core/puzzles';

// In playtest, tries are reported as always-full and never decremented so
// testers aren't locked out mid-session. Never true in production — see
// `isPlaytest`.
const PLAYTEST_TRIES = 3;

type ErrorResponse = { status: 'error'; message: string };

export const api = new Hono();

api.get('/game-state', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'No postId' }, 400);

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const today = todayDate();
  const puzzle = getPuzzleForDate(today);

  await seedCanvas(today, puzzle.gridSize, 3);
  await initUserIfNeeded(today, username, puzzle.gridSize);

  const [canvas, hand, triesStr, scoreStr, streakStr, leaderboard, completeStr, usedHintsStr] =
    await Promise.all([
      getCanvas(today),
      getUserHand(today, username, puzzle.gridSize),
      redis.get(K.tries(today, username)),
      redis.get(K.score(today, username)),
      redis.get(K.streak(username)),
      getLeaderboard(today),
      redis.get(K.complete(today)),
      redis.get(K.usedHints(today, username)),
    ]);

  const rawTriesLeft = triesStr !== undefined ? parseInt(triesStr) : 3;
  const triesLeft = isPlaytest() ? PLAYTEST_TRIES : rawTriesLeft;
  const score = scoreStr !== undefined ? parseInt(scoreStr) : 0;
  const streakData: { count: number; lastDate: string } = streakStr
    ? JSON.parse(streakStr)
    : { count: 0, lastDate: '' };

  return c.json<GameStateResponse>({
    type: 'gameState',
    puzzle: {
      date: puzzle.date,
      title: puzzle.title,
      imageUrl: puzzle.imageUrl,
      gridSize: puzzle.gridSize,
    },
    canvas,
    hand,
    triesLeft,
    score,
    streak: streakData.count,
    locked: triesLeft <= 0,
    leaderboard,
    completed: !!completeStr,
    username,
    usedHints: usedHintsStr === '1',
    playtest: isPlaytest(),
  });
});

// Dev-only: wipe today's shared canvas and the caller's per-day state so the
// full loop (fresh hand, tries, no-hints bonus) can be retested without
// waiting for the next daily. Refuses outside the playtest subreddit.
api.post('/debug/reset-day', async (c) => {
  if (!isPlaytest()) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Playtest only' }, 403);
  }
  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const today = todayDate();
  const puzzle = getPuzzleForDate(today);

  const keys = [
    K.canvas(today),
    K.complete(today),
    K.lb(today),
    K.hand(today, username),
    K.tries(today, username),
    K.score(today, username),
    K.usedHints(today, username),
  ];
  for (const key of keys) await redis.del(key);

  await seedCanvas(today, puzzle.gridSize, 3);
  await initUserIfNeeded(today, username, puzzle.gridSize);
  return c.json({ type: 'reset', ok: true });
});

api.post('/place', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'No postId' }, 400);

  const body = await c.req.json<PlaceRequest>();
  const { pieceId, cellIndex } = body;
  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const today = todayDate();
  const puzzle = getPuzzleForDate(today);
  const { gridSize } = puzzle;
  const totalCells = gridSize * gridSize;

  if (
    !Number.isInteger(pieceId) ||
    !Number.isInteger(cellIndex) ||
    pieceId < 0 ||
    pieceId >= totalCells ||
    cellIndex < 0 ||
    cellIndex >= totalCells
  ) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Invalid piece or cell' }, 400);
  }

  const triesStr = await redis.get(K.tries(today, username));
  const rawTriesLeft = triesStr !== undefined ? parseInt(triesStr) : 3;
  const triesLeft = isPlaytest() ? PLAYTEST_TRIES : rawTriesLeft;
  if (triesLeft <= 0) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Locked out for today' }, 403);
  }

  const handStr = await redis.get(K.hand(today, username));
  if (!handStr) return c.json<ErrorResponse>({ status: 'error', message: 'No hand dealt' }, 400);
  const handIds: number[] = JSON.parse(handStr);

  if (!handIds.includes(pieceId)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Piece not in hand' }, 400);
  }

  // Any placement made with hints visible forfeits the no-hints bonus for the
  // rest of the day — otherwise toggling hints off just for the drop would be
  // free double points.
  const placedWithHints = body.hintsOn === true;
  if (placedWithHints) await redis.set(K.usedHints(today, username), '1');
  const usedHints =
    placedWithHints || (await redis.get(K.usedHints(today, username))) === '1';

  const cellFilled = await redis.hGet(K.canvas(today), String(cellIndex));
  if (cellFilled) {
    const scoreStr = await redis.get(K.score(today, username));
    const canvas = await getCanvas(today);
    return c.json<PlaceResponse>({
      type: 'place',
      correct: false,
      alreadyFilled: true,
      triesLeft,
      score: scoreStr !== undefined ? parseInt(scoreStr) : 0,
      newPiece: null,
      hand: handIds.map((id) => ({ id, zone: getZone(id, gridSize) })),
      canvas,
      completed: !!(await redis.get(K.complete(today))),
      pointsEarned: 0,
      usedHints,
    });
  }

  const correct = pieceId === cellIndex;

  if (correct) {
    await redis.hSet(K.canvas(today), { [String(cellIndex)]: '1' });

    const newHandIds = handIds.filter((id) => id !== pieceId);
    const newPieces = await dealPieces(today, gridSize, 1);
    const updatedHandIds = [...newHandIds, ...newPieces];
    await redis.set(K.hand(today, username), JSON.stringify(updatedHandIds));

    const pointsEarned = usedHints ? 1 : 2;
    const newScore = await redis.incrBy(K.score(today, username), pointsEarned);
    await redis.zAdd(K.lb(today), { score: newScore, member: username });
    await updateStreak(username, today);

    const filledCount = await redis.hLen(K.canvas(today));
    const completed = filledCount >= totalCells;
    if (completed) await redis.set(K.complete(today), '1');

    const canvas = await getCanvas(today);
    const newPiece =
      newPieces.length > 0 && newPieces[0] !== undefined
        ? { id: newPieces[0], zone: getZone(newPieces[0], gridSize) }
        : null;

    const realtimeMsg: RealtimeCanvasMessage = {
      type: 'canvas',
      cellIndex,
      completed,
      filledCount,
    };
    await realtime.send(postId, realtimeMsg);

    return c.json<PlaceResponse>({
      type: 'place',
      correct: true,
      alreadyFilled: false,
      triesLeft,
      score: newScore,
      newPiece,
      hand: updatedHandIds.map((id) => ({ id, zone: getZone(id, gridSize) })),
      canvas,
      completed,
      pointsEarned,
      usedHints,
    });
  } else {
    const newTries = isPlaytest()
      ? PLAYTEST_TRIES
      : Math.max(0, await redis.incrBy(K.tries(today, username), -1));
    const scoreStr = await redis.get(K.score(today, username));
    const canvas = await getCanvas(today);

    return c.json<PlaceResponse>({
      type: 'place',
      correct: false,
      alreadyFilled: false,
      triesLeft: newTries,
      score: scoreStr !== undefined ? parseInt(scoreStr) : 0,
      newPiece: null,
      hand: handIds.map((id) => ({ id, zone: getZone(id, gridSize) })),
      canvas,
      completed: !!(await redis.get(K.complete(today))),
      pointsEarned: 0,
      usedHints,
    });
  }
});

api.get('/canvas', async (c) => {
  const today = todayDate();
  const puzzle = getPuzzleForDate(today);
  const [canvas, completeStr, leaderboard] = await Promise.all([
    getCanvas(today),
    redis.get(K.complete(today)),
    getLeaderboard(today),
  ]);
  return c.json({
    type: 'canvas',
    canvas,
    completed: !!completeStr,
    leaderboard,
    filledCount: Object.keys(canvas).length,
    totalCells: puzzle.gridSize * puzzle.gridSize,
  });
});

import { reddit } from '@devvit/web/server';
import { getPuzzleForDate, todayDate, seedCanvas } from './puzzles';

export const createPost = async () => {
  const date = todayDate();
  const puzzle = getPuzzleForDate(date);
  await seedCanvas(date, puzzle.gridSize, 3);
  // Never put the puzzle title in the post title — it's the hidden answer
  // the community races to guess in the comments.
  return await reddit.submitCustomPost({
    title: `The Big Picture — ${date} · what are we building today?`,
  });
};

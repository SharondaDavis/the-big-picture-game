import { reddit } from '@devvit/web/server';
import { getPuzzleForDate, todayDate, seedCanvas } from './puzzles';

export const createPost = async () => {
  const date = todayDate();
  const puzzle = getPuzzleForDate(date);
  await seedCanvas(date, puzzle.gridSize, 3);
  return await reddit.submitCustomPost({
    title: `The Big Picture: ${puzzle.title}`,
  });
};

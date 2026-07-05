import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';

const Splash = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f0f23] text-white px-4 gap-4">
      <div className="text-center">
        <h1 className="text-3xl font-black tracking-tight text-orange-400 uppercase">
          The Big Picture
        </h1>
        <p className="text-white/60 text-sm mt-1">A daily communal puzzle for this community</p>
      </div>

      <div className="flex flex-col items-center gap-2 text-sm text-white/70 max-w-xs text-center">
        <p>One image. Everyone together. Three wrong guesses.</p>
        <p>Place your pieces. Watch the canvas fill in real time.</p>
      </div>

      <button
        className="mt-2 bg-orange-500 hover:bg-orange-400 text-white font-bold px-8 py-3 rounded-full text-base transition-colors active:scale-95"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
      >
        Play Today's Puzzle
      </button>

      <p className="text-white/30 text-xs">
        Hey {context.username ?? 'there'} — your pieces are waiting
      </p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);

import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';

const Splash = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen app-bg text-white px-6 gap-4">
      <img
        src="/splash-hero.svg"
        alt="A puzzle piece snapping into the community canvas"
        className="w-32 h-32 rounded-3xl shadow-[0_0_44px_rgba(251,146,60,0.22)]"
      />
      <div className="text-center">
        <p className="text-[9px] text-white/30 uppercase tracking-[0.35em] mb-2">Daily communal puzzle</p>
        <h1 className="text-3xl font-black tracking-tight uppercase bg-gradient-to-r from-orange-400 via-amber-300 to-orange-400 bg-clip-text text-transparent">
          The Big Picture
        </h1>
      </div>

      <p className="text-sm text-white/50 max-w-[260px] text-center leading-relaxed">
        One image. Everyone together. Three wrong guesses. The canvas fills in real time — and
        nobody can finish it alone.
      </p>

      <button
        className="mt-1 bg-gradient-to-r from-orange-500 to-amber-400 text-black font-bold px-8 py-3 rounded-full text-sm tracking-wide transition-transform active:scale-95 shadow-[0_8px_24px_rgba(251,146,60,0.25)]"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
      >
        PLAY TODAY'S PUZZLE
      </button>

      <p className="text-white/25 text-[11px]">
        {context.username ? `u/${context.username} — your pieces are waiting` : 'Your pieces are waiting'}
      </p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);

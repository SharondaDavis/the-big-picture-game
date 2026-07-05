import './index.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connectRealtime, context } from '@devvit/web/client';
import type {
  GameStateResponse,
  PlaceResponse,
  RealtimeCanvasMessage,
  ZoneHint,
} from '../shared/api';

const ZONE_LABEL: Record<ZoneHint, string> = {
  TL: 'Top-Left',
  TR: 'Top-Right',
  BL: 'Bottom-Left',
  BR: 'Bottom-Right',
};

function pieceStyle(
  pieceId: number,
  gridSize: number,
  imageUrl: string,
  size: number
): React.CSSProperties {
  const row = Math.floor(pieceId / gridSize);
  const col = pieceId % gridSize;
  const bgSize = size * gridSize;
  return {
    backgroundImage: `url('${imageUrl}')`,
    backgroundSize: `${bgSize}px ${bgSize}px`,
    backgroundPosition: `-${col * size}px -${row * size}px`,
    backgroundRepeat: 'no-repeat',
    width: size,
    height: size,
    flexShrink: 0,
  };
}

type FlashState = { cell: number; kind: 'correct' | 'wrong' | 'taken' } | null;
type NotifState = { text: string; kind: 'success' | 'error' | 'info' } | null;

const App = () => {
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [flash, setFlash] = useState<FlashState>(null);
  const [notif, setNotif] = useState<NotifState>(null);
  const [showLb, setShowLb] = useState(false);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (text: string, kind: 'success' | 'error' | 'info') => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotif({ text, kind });
    notifTimer.current = setTimeout(() => setNotif(null), 3000);
  };

  useEffect(() => {
    fetch('/api/game-state')
      .then((r) => r.json())
      .then((data: GameStateResponse) => {
        setState(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Real-time canvas updates from other players
  useEffect(() => {
    if (!state || !context.postId) return;
    const conn = connectRealtime<RealtimeCanvasMessage>({
      channel: context.postId,
      onMessage(msg) {
        if (msg.type !== 'canvas') return;
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            canvas: { ...prev.canvas, [String(msg.cellIndex)]: true },
            completed: msg.completed,
          };
        });
      },
    });
    return () => {
      conn.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.puzzle.date]);

  const handleCellTap = useCallback(
    async (cellIndex: number) => {
      if (selectedId === null || placing || !state || state.locked) return;
      if (state.canvas[String(cellIndex)]) {
        notify("Someone's already there!", 'info');
        return;
      }
      setPlacing(true);
      try {
        const res = await fetch('/api/place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: selectedId, cellIndex }),
        });
        const data: PlaceResponse = await res.json();
        setSelectedId(null);

        const flashKind = data.correct ? 'correct' : data.alreadyFilled ? 'taken' : 'wrong';
        setFlash({ cell: cellIndex, kind: flashKind });
        setTimeout(() => setFlash(null), 700);

        if (data.correct) {
          notify('✓ Correct! Keep going.', 'success');
        } else if (data.alreadyFilled) {
          notify('Someone got there first!', 'info');
        } else {
          const t = data.triesLeft;
          notify(
            t === 0
              ? '✗ No tries left — see you tomorrow!'
              : `✗ Not quite — ${t} ${t === 1 ? 'try' : 'tries'} left`,
            'error'
          );
        }

        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            canvas: data.canvas,
            hand: data.hand,
            triesLeft: data.triesLeft,
            score: data.score,
            locked: data.triesLeft <= 0,
            completed: data.completed,
          };
        });
      } finally {
        setPlacing(false);
      }
    },
    [selectedId, placing, state]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f0f23] text-white/60 text-sm">
        Loading today's puzzle…
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f0f23] text-white/60 text-sm">
        Couldn't load the puzzle. Try refreshing.
      </div>
    );
  }

  const { puzzle, canvas, hand, triesLeft, score, streak, locked, completed, leaderboard } = state;
  const { gridSize, imageUrl, title } = puzzle;
  const totalCells = gridSize * gridSize;
  const filledCount = Object.keys(canvas).length;
  const pct = Math.round((filledCount / totalCells) * 100);
  const selectedPiece = hand.find((p) => p.id === selectedId) ?? null;

  // Responsive cell size: ~(vw - padding) / gridSize, clamped
  const CELL_SIZE = Math.min(Math.floor((180 - 8) / gridSize), 52);
  const IMG_SIZE = CELL_SIZE * gridSize;

  return (
    <div className="flex flex-col min-h-screen bg-[#0f0f23] text-white select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#0f0f23]/90 sticky top-0 z-10">
        <div>
          <span className="text-orange-400 font-black text-base uppercase tracking-tight">
            The Big Picture
          </span>
          <span className="text-white/40 text-xs ml-2">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">
            ✦ {score}
          </span>
          <span className="text-xs font-medium">
            {triesLeft >= 3 ? '❤️❤️❤️' : triesLeft === 2 ? '❤️❤️🖤' : triesLeft === 1 ? '❤️🖤🖤' : '🖤🖤🖤'}
          </span>
          <button
            onClick={() => setShowLb((v) => !v)}
            className="text-white/50 hover:text-white text-xs transition-colors"
          >
            🏆
          </button>
        </div>
      </header>

      {/* Notification bar */}
      {notif && (
        <div
          className={`text-center text-sm py-2 px-4 font-medium transition-all ${
            notif?.kind === 'success'
              ? 'bg-green-600/90 text-white'
              : notif?.kind === 'error'
                ? 'bg-red-600/90 text-white'
                : 'bg-white/10 text-white/80'
          }`}
        >
          {notif.text}
        </div>
      )}

      {/* Completion banner */}
      {completed && (
        <div className="bg-gradient-to-r from-orange-500 to-yellow-400 text-black font-bold text-center py-2 text-sm">
          🎉 The community assembled it! Bonus unlocked for all contributors.
        </div>
      )}

      {/* Locked banner */}
      {locked && !completed && (
        <div className="bg-white/5 text-white/60 text-center py-2 text-sm border-b border-white/10">
          🔒 No tries left today — come back tomorrow
        </div>
      )}

      {/* Main: two panels side-by-side */}
      <div className="flex gap-3 px-3 pt-3 justify-center">
        {/* Target image */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/40 text-[10px] uppercase tracking-widest">Target</span>
          <div
            className="rounded-lg overflow-hidden border border-white/10"
            style={{ width: IMG_SIZE, height: IMG_SIZE }}
          >
            <img
              src={imageUrl}
              alt="Target puzzle"
              style={{ width: IMG_SIZE, height: IMG_SIZE, display: 'block' }}
            />
          </div>
        </div>

        {/* Shared canvas */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/40 text-[10px] uppercase tracking-widest">Canvas</span>
          <div
            className="grid rounded-lg overflow-hidden border border-white/10"
            style={{
              gridTemplateColumns: `repeat(${gridSize}, ${CELL_SIZE}px)`,
              gridTemplateRows: `repeat(${gridSize}, ${CELL_SIZE}px)`,
              gap: 1,
              background: 'rgba(255,255,255,0.05)',
            }}
          >
            {Array.from({ length: totalCells }, (_, i) => {
              const filled = !!canvas[String(i)];
              const isFlashing = flash?.cell === i;
              const canTap = !filled && selectedId !== null && !locked;

              if (filled) {
                return (
                  <div
                    key={i}
                    className={`transition-all duration-300 ${isFlashing && flash?.kind === 'correct' ? 'brightness-150' : ''}`}
                    style={pieceStyle(i, gridSize, imageUrl, CELL_SIZE)}
                  />
                );
              }

              return (
                <div
                  key={i}
                  onClick={() => handleCellTap(i)}
                  className={`transition-all duration-150 ${
                    isFlashing
                      ? flash?.kind === 'wrong'
                        ? 'bg-red-500/50'
                        : 'bg-gray-400/40'
                      : canTap
                        ? 'bg-orange-400/10 hover:bg-orange-400/25 cursor-pointer ring-1 ring-orange-400/40'
                        : 'bg-white/5'
                  }`}
                  style={{ width: CELL_SIZE, height: CELL_SIZE }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 pt-3">
        <div className="flex items-center justify-between text-xs text-white/40 mb-1">
          <span>Community: {filledCount}/{totalCells} cells filled</span>
          <span>{streak > 0 ? `🔥 ${streak}d streak` : `Score: ${score}`}</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Hand */}
      <div className="px-3 pt-4">
        <div className="text-xs text-white/40 uppercase tracking-widest mb-2">
          Your pieces {locked ? '(locked)' : `— tap to select`}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {hand.length === 0 && !locked && (
            <span className="text-white/30 text-sm">Canvas is full — great work!</span>
          )}
          {hand.map((piece) => {
            const isSelected = piece.id === selectedId;
            return (
              <button
                key={piece.id}
                disabled={locked}
                onClick={() => setSelectedId((prev) => (prev === piece.id ? null : piece.id))}
                className={`relative rounded-lg border-2 transition-all duration-150 overflow-hidden ${
                  isSelected
                    ? 'border-orange-400 ring-2 ring-orange-400/50 scale-105'
                    : 'border-white/20 hover:border-white/50 active:scale-95'
                } ${locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                style={pieceStyle(piece.id, gridSize, imageUrl, 68)}
              >
                <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/70 text-white/90 px-1 rounded leading-tight">
                  {piece.zone}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Zone hint / instruction */}
      <div className="px-3 pt-3 pb-4 min-h-[36px]">
        {selectedPiece ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="bg-orange-400/20 text-orange-300 px-2 py-0.5 rounded text-xs font-semibold">
              ZONE: {ZONE_LABEL[selectedPiece.zone]}
            </span>
            <span className="text-white/50">→ tap a cell on the canvas</span>
          </div>
        ) : locked ? null : (
          <p className="text-white/30 text-xs">
            Compare pieces to the target image, then tap a piece and tap where it belongs.
          </p>
        )}
      </div>

      {/* Leaderboard drawer */}
      {showLb && (
        <div
          className="fixed inset-0 bg-black/70 z-20 flex items-end"
          onClick={() => setShowLb(false)}
        >
          <div
            className="w-full bg-[#1a1a3e] rounded-t-2xl p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-orange-400 text-sm uppercase tracking-wide">
                Today's Leaders
              </span>
              <button onClick={() => setShowLb(false)} className="text-white/40 text-lg leading-none">
                ×
              </button>
            </div>
            {leaderboard.length === 0 && (
              <p className="text-white/40 text-sm text-center py-4">No placements yet — be first!</p>
            )}
            {leaderboard.map((entry, i) => (
              <div
                key={entry.username}
                className={`flex items-center justify-between py-2 border-b border-white/5 ${
                  entry.username === state.username ? 'text-orange-300' : 'text-white/80'
                }`}
              >
                <span className="text-sm">
                  <span className="text-white/30 mr-2 text-xs">{i + 1}.</span>
                  {entry.username}
                  {entry.username === state.username && (
                    <span className="text-white/30 text-xs ml-1">(you)</span>
                  )}
                </span>
                <span className="text-sm font-mono">
                  {entry.score} {entry.score === 1 ? 'piece' : 'pieces'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

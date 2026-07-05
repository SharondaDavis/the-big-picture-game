import './index.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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

const ZONE_ARROW: Record<ZoneHint, string> = {
  TL: '↖',
  TR: '↗',
  BL: '↙',
  BR: '↘',
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

// Resolves the grid cell under a screen point during a drag, via the
// data-cell-index attribute each cell carries. Pointer events (not native
// HTML5 drag-and-drop) so this works reliably on touch webviews.
function cellIndexAtPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const cellEl = el instanceof Element ? el.closest<HTMLElement>('[data-cell-index]') : null;
  if (!cellEl) return null;
  const idx = Number(cellEl.dataset.cellIndex);
  return Number.isNaN(idx) ? null : idx;
}

type FlashState = { cell: number; kind: 'correct' | 'wrong' | 'taken' } | null;
type NotifState = { text: string; kind: 'success' | 'error' | 'info' } | null;
type DragPos = { x: number; y: number };
type PendingPlacement = { cell: number; pieceId: number } | null;

const App = () => {
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [flash, setFlash] = useState<FlashState>(null);
  const [notif, setNotif] = useState<NotifState>(null);
  const [showLb, setShowLb] = useState(false);
  const [dragPieceId, setDragPieceId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<DragPos | null>(null);
  const [dragOverCell, setDragOverCell] = useState<number | null>(null);
  const [returning, setReturning] = useState(false);
  const [pending, setPending] = useState<PendingPlacement>(null);
  const [returnedPieceId, setReturnedPieceId] = useState<number | null>(null);
  const [hintsOn, setHintsOn] = useState(true);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragOriginRef = useRef<DragPos | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnedPieceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      if (returnedPieceTimerRef.current) clearTimeout(returnedPieceTimerRef.current);
    };
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

  const commitPlacement = useCallback(
    async (pieceId: number, cellIndex: number) => {
      if (placing || !state || state.locked) return;
      if (state.canvas[String(cellIndex)]) {
        notify("Someone's already there!", 'info');
        return;
      }
      setPlacing(true);
      // Show the piece sitting in the cell immediately so the drop feels
      // committed while the server validates it.
      setPending({ cell: cellIndex, pieceId });
      try {
        const res = await fetch('/api/place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId, cellIndex, hintsOn }),
        });
        const data: PlaceResponse = await res.json();

        const flashKind = data.correct ? 'correct' : data.alreadyFilled ? 'taken' : 'wrong';
        setFlash({ cell: cellIndex, kind: flashKind });
        setTimeout(() => setFlash(null), 700);

        if (data.correct) {
          notify(
            data.pointsEarned >= 2
              ? '✓ It sticks! +2 pts — no-hints bonus!'
              : '✓ It sticks! +1 pt. Keep going.',
            'success'
          );
        } else if (data.alreadyFilled) {
          notify('Someone got there first!', 'info');
        } else {
          // Pulse the piece back in the tray so it's obvious it returned.
          setReturnedPieceId(pieceId);
          if (returnedPieceTimerRef.current) clearTimeout(returnedPieceTimerRef.current);
          returnedPieceTimerRef.current = setTimeout(() => setReturnedPieceId(null), 1200);
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
            usedHints: data.usedHints,
          };
        });
      } finally {
        setPending(null);
        setPlacing(false);
      }
    },
    [placing, state, hintsOn]
  );

  // Animates the dragged piece back to its tray slot instead of just
  // vanishing, so a miss reads as "dropped outside," not a glitch.
  const snapBack = useCallback(() => {
    setDragOverCell(null);
    setReturning(true);
    const origin = dragOriginRef.current;
    if (origin) setDragPos(origin);
    returnTimerRef.current = setTimeout(() => {
      setDragPieceId(null);
      setDragPos(null);
      setReturning(false);
    }, 200);
  }, []);

  const handlePieceDragStart = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, pieceId: number) => {
      if (placing || !state || state.locked) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      dragOriginRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      setReturning(false);
      setDragPieceId(pieceId);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    [placing, state]
  );

  const handlePieceDragMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (dragPieceId === null) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      setDragOverCell(cellIndexAtPoint(e.clientX, e.clientY));
    },
    [dragPieceId]
  );

  const handlePieceDragEnd = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (dragPieceId === null) return;
      const pieceId = dragPieceId;
      const cellIndex = cellIndexAtPoint(e.clientX, e.clientY);
      const validDrop =
        cellIndex !== null && !!state && !state.canvas[String(cellIndex)] && !state.locked;

      if (validDrop && cellIndex !== null) {
        setDragOverCell(null);
        setDragPieceId(null);
        setDragPos(null);
        void commitPlacement(pieceId, cellIndex);
      } else {
        snapBack();
      }
    },
    [dragPieceId, state, commitPlacement, snapBack]
  );

  const handlePieceDragCancel = useCallback(() => {
    if (dragPieceId === null) return;
    snapBack();
  }, [dragPieceId, snapBack]);

  // Dev-only (playtest subreddit): wipe and re-seed today's puzzle state.
  const resetDay = useCallback(async () => {
    if (placing) return;
    setPending(null);
    setDragPieceId(null);
    setDragPos(null);
    setFlash(null);
    await fetch('/api/debug/reset-day', { method: 'POST' });
    const res = await fetch('/api/game-state');
    const data: GameStateResponse = await res.json();
    setState(data);
    notify('Day reset — fresh hand dealt (dev)', 'info');
  }, [placing]);

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

  const { puzzle, canvas, hand, triesLeft, score, streak, locked, completed, leaderboard, usedHints } =
    state;
  // 2x scoring is live while hints are off and no hinted placement was made today.
  const bonusLive = !hintsOn && !usedHints;
  const { gridSize, imageUrl, title } = puzzle;
  const totalCells = gridSize * gridSize;
  const filledCount = Object.keys(canvas).length;
  const pct = Math.round((filledCount / totalCells) * 100);
  const draggedPiece = dragPieceId !== null ? (hand.find((p) => p.id === dragPieceId) ?? null) : null;

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
            onClick={() => setHintsOn((v) => !v)}
            className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
              hintsOn
                ? 'border-orange-400/60 text-orange-300 bg-orange-400/10'
                : 'border-white/20 text-white/40'
            }`}
            title="Zone hints show which corner of the picture each piece belongs in. Play all day without them for double points."
          >
            💡 {hintsOn ? 'Hints on' : bonusLive ? 'Hints off · 2×' : 'Hints off'}
          </button>
          <button
            onClick={() => setShowLb((v) => !v)}
            className="text-white/50 hover:text-white text-xs transition-colors"
          >
            🏆
          </button>
          {state.playtest && (
            <button
              onClick={() => void resetDay()}
              className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/20 text-white/40 hover:text-white/80 transition-colors"
              title="Dev only: reset today's puzzle and deal a fresh hand"
            >
              ↺ dev
            </button>
          )}
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
              gap: 2,
              background: 'rgba(0,0,0,0.35)',
            }}
          >
            {Array.from({ length: totalCells }, (_, i) => {
              const filled = !!canvas[String(i)];
              const isFlashing = flash?.cell === i;
              const isDragTarget = !filled && !locked && dragPieceId !== null && dragOverCell === i;

              // Double-tone inset ring so the grid line reads against both
              // light and dark regions of the target image.
              const CELL_EDGE = 'inset 0 0 0 1.5px rgba(255,255,255,0.5), inset 0 0 0 3px rgba(0,0,0,0.4)';
              const CELL_EDGE_ACTIVE =
                'inset 0 0 0 2px rgba(253,186,116,0.95), inset 0 0 0 4px rgba(154,52,18,0.55), 0 0 10px rgba(251,146,60,0.65)';

              if (filled) {
                return (
                  <div
                    key={i}
                    data-cell-index={i}
                    className={isFlashing && flash?.kind === 'correct' ? 'piece-lock' : ''}
                    style={{
                      ...pieceStyle(i, gridSize, imageUrl, CELL_SIZE),
                      boxShadow: CELL_EDGE,
                    }}
                  />
                );
              }

              // The just-dropped piece sits in the cell while the server
              // decides whether it sticks.
              if (pending?.cell === i) {
                return (
                  <div
                    key={i}
                    data-cell-index={i}
                    className="animate-pulse"
                    style={{
                      ...pieceStyle(pending.pieceId, gridSize, imageUrl, CELL_SIZE),
                      boxShadow: CELL_EDGE_ACTIVE,
                      opacity: 0.9,
                    }}
                  />
                );
              }

              return (
                <div
                  key={i}
                  data-cell-index={i}
                  className={`transition-all duration-150 relative ${
                    isFlashing
                      ? flash?.kind === 'wrong'
                        ? 'bg-red-500/50 cell-shake'
                        : 'bg-gray-400/40'
                      : isDragTarget
                        ? 'bg-orange-400/50'
                        : dragPieceId !== null && !locked
                          ? 'bg-orange-400/10'
                          : 'bg-white/5'
                  }`}
                  style={{
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    boxShadow: isDragTarget ? CELL_EDGE_ACTIVE : CELL_EDGE,
                    zIndex: isDragTarget ? 5 : 1,
                  }}
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
          Your pieces {locked ? '(locked)' : '— drag onto the canvas'}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {hand.length === 0 && !locked && (
            <span className="text-white/30 text-sm">Canvas is full — great work!</span>
          )}
          {hand.map((piece) => {
            const isDragging = piece.id === dragPieceId;
            const isPending = piece.id === pending?.pieceId;
            const justReturned = piece.id === returnedPieceId;
            return (
              <button
                key={piece.id}
                disabled={locked}
                onPointerDown={(e) => handlePieceDragStart(e, piece.id)}
                onPointerMove={handlePieceDragMove}
                onPointerUp={handlePieceDragEnd}
                onPointerCancel={handlePieceDragCancel}
                className={`relative rounded-lg border-2 transition-all duration-150 overflow-hidden touch-none ${
                  isDragging || isPending
                    ? 'border-orange-400/40 opacity-30'
                    : justReturned
                      ? 'border-red-400 piece-returned'
                      : 'border-white/20 hover:border-white/50 active:scale-95'
                } ${locked ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                style={pieceStyle(piece.id, gridSize, imageUrl, 68)}
              >
                {hintsOn && (
                  <span className="absolute bottom-0.5 right-0.5 text-[11px] bg-black/70 text-orange-300 px-1 rounded leading-tight font-bold">
                    {ZONE_ARROW[piece.zone]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Zone hint / instruction */}
      <div className="px-3 pt-3 pb-4 min-h-[36px]">
        {draggedPiece ? (
          <div className="flex items-center gap-2 text-sm">
            {hintsOn && (
              <span className="bg-orange-400/20 text-orange-300 px-2 py-0.5 rounded text-xs font-semibold">
                {ZONE_ARROW[draggedPiece.zone]} {ZONE_LABEL[draggedPiece.zone]}
              </span>
            )}
            <span className="text-white/50">
              {hintsOn ? '→ drop it in that corner of the canvas' : 'Drop it where it belongs'}
            </span>
          </div>
        ) : locked ? null : (
          <p className="text-white/30 text-xs">
            Compare pieces to the target image, then drag a piece onto the cell where it belongs.
            {hintsOn && ' The arrow on each piece points to its corner of the picture.'}
            {bonusLive && (
              <span className="text-orange-300/80">
                {' '}
                Hard mode: correct pieces are worth 2 points.
              </span>
            )}
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
                  {entry.score} {entry.score === 1 ? 'pt' : 'pts'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drag ghost: the piece lifted off the tray, following the pointer */}
      {dragPieceId !== null && dragPos && (
        <div
          className={`fixed rounded-lg border-2 border-orange-400 overflow-hidden pointer-events-none z-50 shadow-[0_10px_28px_rgba(0,0,0,0.65)] ${
            returning ? 'transition-all duration-200 ease-out' : ''
          }`}
          style={{
            ...pieceStyle(dragPieceId, gridSize, imageUrl, 68),
            left: dragPos.x,
            top: dragPos.y,
            transform: `translate(-50%, -50%) scale(${returning ? 1 : 1.15})`,
          }}
        >
          {draggedPiece && hintsOn && (
            <span className="absolute bottom-0.5 right-0.5 text-[11px] bg-black/70 text-orange-300 px-1 rounded leading-tight font-bold">
              {ZONE_ARROW[draggedPiece.zone]}
            </span>
          )}
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

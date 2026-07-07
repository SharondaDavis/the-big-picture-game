import './index.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
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
): CSSProperties {
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

// On touch, lift the dragged piece above the finger so it doesn't hide the
// drop cell; hit-testing happens where the piece is, not where the finger is.
const TOUCH_LIFT_PX = 56;

// A press that moves less than this is a tap (select the piece); more is a
// drag. Both input styles work — tap-then-tap or drag-and-drop. Generous
// because thumbs wobble: a tap that silently becomes a 9px drag feels broken.
const TAP_SLOP_PX = 14;

function ghostTransform(x: number, y: number, scale: number): string {
  return `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
}

// Puzzles roll over at UTC midnight (the server keys days by UTC date).
function msUntilNextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MEDAL_COLORS = ['bg-amber-300', 'bg-slate-300', 'bg-amber-600'];

const COMPLETION_MESSAGES = [
  'We built it together.',
  'Every piece was one of you.',
  'The whole picture, from all of us.',
  'Another day, another picture — done.',
];

const CONFETTI_COLORS = ['#fb923c', '#fcd34d', '#7fd4c1', '#e86ba7', '#8fa8ff', '#f6e3a8'];

type ConfettiPiece = {
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
};

function makeConfetti(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    size: 6 + Math.random() * 6,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    delay: Math.random() * 0.8,
    duration: 2.4 + Math.random() * 1.8,
  }));
}

const App = () => {
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [flash, setFlash] = useState<FlashState>(null);
  const [notif, setNotif] = useState<NotifState>(null);
  const [showLb, setShowLb] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragPieceId, setDragPieceId] = useState<number | null>(null);
  const [dragOverCell, setDragOverCell] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingPlacement>(null);
  const [returnedPieceId, setReturnedPieceId] = useState<number | null>(null);
  const [hintsOn, setHintsOn] = useState(true);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [celebration, setCelebration] = useState<ConfettiPiece[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const prevCompletedRef = useRef<boolean | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragOriginRef = useRef<DragPos | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnedPieceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The ghost moves via direct style mutation on pointermove — never through
  // React state — so dragging stays smooth on low-end phones. React would
  // otherwise re-render the whole app 60+ times a second.
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragMetaRef = useRef<{ startX: number; startY: number; liftY: number } | null>(null);
  const lastHoverRef = useRef<number | null>(null);
  // Tracks a press from pointerdown until it resolves into a tap or a drag.
  const pressRef = useRef<{
    pieceId: number;
    startX: number;
    startY: number;
    liftY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);

  const notify = (text: string, kind: 'success' | 'error' | 'info') => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotif({ text, kind });
    notifTimer.current = setTimeout(() => setNotif(null), 3000);
  };

  useEffect(() => {
    void fetch('/api/game-state')
      .then((r) => r.json())
      .then((data: GameStateResponse) => {
        setState(data);
        setLoading(false);
        // First visit: a five-second how-to before the board.
        try {
          if (!localStorage.getItem('tbp_tutorial_v1')) setShowTutorial(true);
        } catch {
          // Storage unavailable in some webviews — skip the auto-tutorial.
        }
      })
      .catch(() => setLoading(false));
  }, []);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      localStorage.setItem('tbp_tutorial_v1', '1');
    } catch {
      // Best effort only.
    }
  }, []);

  useEffect(() => {
    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      if (returnedPieceTimerRef.current) clearTimeout(returnedPieceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Tick the next-puzzle countdown, but only while the day-summary card is
  // showing (out of tries or out of pieces) — no idle timers during play.
  const dayDoneNow = state
    ? state.locked || state.hand.length === 0 || state.completed
    : false;
  useEffect(() => {
    if (!dayDoneNow) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [dayDoneNow]);

  const shareRun = useCallback(async () => {
    if (sharing || shareDone) return;
    setSharing(true);
    try {
      const res = await fetch('/api/share', { method: 'POST' });
      if (res.ok) {
        setShareDone(true);
        notify('Shared to the comments!', 'success');
      } else {
        notify("Couldn't share — try again", 'error');
      }
    } catch {
      notify("Couldn't share — try again", 'error');
    } finally {
      setSharing(false);
    }
  }, [sharing, shareDone]);

  const submitSuggestion = useCallback(async () => {
    const idea = suggestText.trim();
    if (!idea || suggestBusy) return;
    setSuggestBusy(true);
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea }),
      });
      if (res.ok) {
        setShowSuggest(false);
        setSuggestText('');
        notify("Thanks — it's in the pile for a future puzzle", 'success');
      } else {
        notify("Couldn't submit — try again", 'error');
      }
    } catch {
      notify("Couldn't submit — try again", 'error');
    } finally {
      setSuggestBusy(false);
    }
  }, [suggestText, suggestBusy]);

  // Fire the celebration only when completion happens live (false -> true
  // while watching), not when opening an already-finished puzzle.
  const isCompleted = state?.completed ?? null;
  useEffect(() => {
    if (isCompleted === null) return;
    if (prevCompletedRef.current === false && isCompleted) {
      setCelebration(makeConfetti(28));
    }
    prevCompletedRef.current = isCompleted;
  }, [isCompleted]);

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
      void conn.disconnect();
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
  // vanishing, so a miss reads as "dropped outside," not a glitch. Driven by
  // direct style mutation (not state) so the transition starts immediately.
  const snapBack = useCallback(() => {
    setDragOverCell(null);
    lastHoverRef.current = null;
    const origin = dragOriginRef.current;
    const ghost = ghostRef.current;
    if (ghost && origin) {
      ghost.style.transition = 'transform 200ms ease-out';
      ghost.style.transform = ghostTransform(origin.x, origin.y, 1);
    }
    returnTimerRef.current = setTimeout(() => {
      setDragPieceId(null);
    }, 220);
  }, []);

  const handlePiecePress = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, pieceId: number) => {
      if (placing || !state || state.locked) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      pressRef.current = {
        pieceId,
        startX: e.clientX,
        startY: e.clientY,
        liftY: e.pointerType === 'touch' ? -TOUCH_LIFT_PX : 0,
        originX: rect.left + rect.width / 2,
        originY: rect.top + rect.height / 2,
        dragging: false,
      };
    },
    [placing, state]
  );

  const handlePieceMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press) return;

    if (!press.dragging) {
      const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
      if (moved < TAP_SLOP_PX) return;
      // The press became a drag: lift the piece and clear any tap-selection.
      press.dragging = true;
      dragOriginRef.current = { x: press.originX, y: press.originY };
      dragMetaRef.current = {
        startX: e.clientX,
        startY: e.clientY + press.liftY,
        liftY: press.liftY,
      };
      lastHoverRef.current = null;
      setSelectedId(null);
      setDragPieceId(press.pieceId);
      return;
    }

    const x = e.clientX;
    const y = e.clientY + press.liftY;
    const ghost = ghostRef.current;
    if (ghost) ghost.style.transform = ghostTransform(x, y, 1.15);
    // Only touch React state when the hovered cell actually changes.
    const idx = cellIndexAtPoint(x, y);
    if (idx !== lastHoverRef.current) {
      lastHoverRef.current = idx;
      setDragOverCell(idx);
    }
  }, []);

  const handlePieceRelease = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press) return;

      if (!press.dragging) {
        // A tap: toggle selection, then place by tapping a cell.
        setSelectedId((prev) => (prev === press.pieceId ? null : press.pieceId));
        return;
      }

      const cellIndex = cellIndexAtPoint(e.clientX, e.clientY + press.liftY);
      const validDrop =
        cellIndex !== null && !!state && !state.canvas[String(cellIndex)] && !state.locked;

      if (validDrop && cellIndex !== null) {
        setDragOverCell(null);
        lastHoverRef.current = null;
        setDragPieceId(null);
        void commitPlacement(press.pieceId, cellIndex);
      } else {
        snapBack();
      }
    },
    [state, commitPlacement, snapBack]
  );

  const handlePieceCancel = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press?.dragging) snapBack();
  }, [snapBack]);

  // Tap-to-place: with a piece selected, tapping an empty cell attempts the
  // placement there.
  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (selectedId === null || placing || !state || state.locked) return;
      if (state.canvas[String(cellIndex)]) {
        notify("Someone's already there!", 'info');
        return;
      }
      const pieceId = selectedId;
      setSelectedId(null);
      void commitPlacement(pieceId, cellIndex);
    },
    [selectedId, placing, state, commitPlacement]
  );

  // Dev-only (playtest subreddit): wipe and re-seed today's puzzle state.
  const resetDay = useCallback(async () => {
    if (placing) return;
    setPending(null);
    setSelectedId(null);
    setDragPieceId(null);
    setDragOverCell(null);
    setFlash(null);
    await fetch('/api/debug/reset-day', { method: 'POST' });
    const res = await fetch('/api/game-state');
    const data: GameStateResponse = await res.json();
    setState(data);
    notify('Day reset — fresh hand dealt (dev)', 'info');
  }, [placing]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen app-bg text-white/60 text-sm">
        Loading today's puzzle…
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen app-bg text-white/60 text-sm">
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
  const selectedPiece = selectedId !== null ? (hand.find((p) => p.id === selectedId) ?? null) : null;
  const activePiece = draggedPiece ?? selectedPiece;
  const myRank = leaderboard.findIndex((e) => e.username === state.username);
  const dayDone = locked || hand.length === 0 || completed;
  const dayNumber = Math.floor(Date.parse(`${puzzle.date}T00:00:00Z`) / 86_400_000);
  const completionMessage = COMPLETION_MESSAGES[dayNumber % COMPLETION_MESSAGES.length]!;

  // The canvas is the hero (bigger drop targets); the target image is a
  // smaller reference beside it. Derived subtractively from the real frame
  // width — image first, then cells get exactly what's left — so the row
  // can never overflow the viewport.
  const frameW = Math.min(viewportW, 448) - 32; /* px-4 both sides */
  const IMG_SIZE = Math.min(Math.floor(frameW * 0.34), 150);
  const CELL_SIZE = Math.min(
    Math.floor((frameW - IMG_SIZE - 12 /* gap */ - (gridSize - 1) * 2 - 2) / gridSize),
    64
  );
  // Completed state drops the target panel, so the canvas gets full width.
  const HERO_CELL = Math.min(Math.floor((frameW - (gridSize - 1) * 2 - 2) / gridSize), 76);

  return (
    <div className="flex flex-col min-h-screen app-bg text-white select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 sticky top-0 z-10 bg-[#0b0b18]/80 backdrop-blur-md border-b border-white/[0.06]">
        <div className="leading-tight">
          <div className="font-black text-sm tracking-tight bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent uppercase">
            The Big Picture
          </div>
          <div className="text-[10px] text-white/35 tracking-wide">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHintsOn((v) => !v)}
            className={`text-[10px] font-medium tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
              hintsOn
                ? 'border-orange-400/40 text-orange-300 bg-orange-400/[0.08]'
                : 'border-white/[0.12] text-white/45'
            }`}
            title="Zone hints show which corner of the picture each piece belongs in. Play all day without them for double points."
          >
            {hintsOn ? 'HINTS ON' : bonusLive ? 'HINTS OFF · 2×' : 'HINTS OFF'}
          </button>
          <button
            onClick={() => setShowTutorial(true)}
            className="w-[26px] h-[26px] rounded-full border border-white/[0.12] text-white/50 hover:text-white hover:border-white/30 transition-colors text-[11px] font-bold"
            title="How to play"
          >
            ?
          </button>
          <button
            onClick={() => setShowLb((v) => !v)}
            className="p-1.5 rounded-full border border-white/[0.12] text-white/50 hover:text-white hover:border-white/30 transition-colors"
            title="Today's leaderboard"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="6" width="3" height="7" rx="0.5" />
              <rect x="5.5" y="1" width="3" height="12" rx="0.5" />
              <rect x="10" y="8.5" width="3" height="4.5" rx="0.5" />
            </svg>
          </button>
          {state.playtest && (
            <button
              onClick={() => void resetDay()}
              className="text-[10px] px-2 py-1 rounded-full border border-white/[0.12] text-white/40 hover:text-white/80 transition-colors"
              title="Dev only: reset today's puzzle and deal a fresh hand"
            >
              ↺
            </button>
          )}
        </div>
      </header>

      {/* Floating toast */}
      {notif && (
        <div
          className={`toast-in fixed top-14 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full text-xs font-medium border backdrop-blur-md whitespace-nowrap ${
            notif.kind === 'success'
              ? 'border-emerald-400/30 bg-emerald-500/[0.12] text-emerald-300'
              : notif.kind === 'error'
                ? 'border-red-400/30 bg-red-500/[0.12] text-red-300'
                : 'border-white/[0.12] bg-white/[0.06] text-white/70'
          }`}
        >
          {notif.text}
        </div>
      )}

      {/* Tier 1 when complete: the finished picture is the star */}
      {completed && (
        <div className="flex flex-col items-center px-4 pt-5">
          <div className="text-[10px] uppercase tracking-[0.35em] bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent font-bold">
            Picture complete
          </div>
          <div className="text-white/45 text-xs mt-1">
            {state.contributors > 1
              ? `${state.contributors} Redditors built today's picture — +3 to every contributor`
              : 'Bonus unlocked for every contributor'}
          </div>
          <div
            className="grid rounded-2xl overflow-hidden border border-amber-300/25 shadow-[0_0_44px_rgba(251,146,60,0.16)] mt-3"
            style={{
              gridTemplateColumns: `repeat(${gridSize}, ${HERO_CELL}px)`,
              gridTemplateRows: `repeat(${gridSize}, ${HERO_CELL}px)`,
              gap: 2,
              background: 'rgba(0,0,0,0.35)',
            }}
          >
            {Array.from({ length: totalCells }, (_, i) => (
              <div key={i} style={pieceStyle(i, gridSize, imageUrl, HERO_CELL)} />
            ))}
          </div>
        </div>
      )}

      {/* Tier 2 when complete: one quiet supporting strip */}
      {completed && (
        <div className="mx-4 mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-white/45 tabular-nums">
            <span className="text-orange-300 font-medium">{score} pts</span>
            {myRank >= 0 && <span>rank #{myRank + 1}</span>}
            {streak > 0 && <span>{streak}d streak</span>}
            <span>next picture in {formatCountdown(msUntilNextUtcMidnight(nowMs))}</span>
          </div>
          <div className="flex justify-center gap-2 mt-2.5">
            <button
              onClick={() => void shareRun()}
              disabled={sharing || shareDone}
              className="text-[11px] font-bold bg-gradient-to-r from-orange-500 to-amber-400 text-black px-4 py-1.5 rounded-full transition-transform active:scale-95 disabled:opacity-50"
            >
              {shareDone ? 'Shared ✓' : 'Share my run'}
            </button>
            <button
              onClick={() => setShowSuggest(true)}
              className="text-[11px] text-white/60 border border-white/[0.12] px-4 py-1.5 rounded-full hover:text-white/90 transition-colors"
            >
              Suggest a picture
            </button>
          </div>
        </div>
      )}

      {/* Day summary card (out of tries or out of pieces, picture unfinished) */}
      {dayDone && !completed && (
        <div className="mx-4 mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-center">
          <div className="text-[9px] uppercase tracking-[0.25em] text-white/35 mb-1">
            Today's run
          </div>
          <div className="text-sm font-bold text-white/85 mb-3">
            {locked ? 'Out of tries' : 'Your part is done'}
          </div>
          <div className="flex justify-center gap-6 mb-3 tabular-nums">
            <div>
              <div className="text-lg font-bold text-orange-300">{score}</div>
              <div className="text-[9px] uppercase tracking-widest text-white/30">pts</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white/85">
                {myRank >= 0 ? `#${myRank + 1}` : '—'}
              </div>
              <div className="text-[9px] uppercase tracking-widest text-white/30">rank</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white/85">{streak}</div>
              <div className="text-[9px] uppercase tracking-widest text-white/30">day streak</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white/85">{pct}%</div>
              <div className="text-[9px] uppercase tracking-widest text-white/30">canvas</div>
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-wider bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
            {formatCountdown(msUntilNextUtcMidnight(nowMs))}
          </div>
          <div className="text-[10px] text-white/35 mt-1">until the next picture drops</div>
          <div className="text-[11px] text-white/50 mt-2.5">
            {streak > 0
              ? `Come back tomorrow to keep your ${streak}-day streak alive`
              : 'Play tomorrow to start a streak'}
          </div>
          <div className="flex justify-center gap-2 mt-3.5">
            <button
              onClick={() => void shareRun()}
              disabled={sharing || shareDone}
              className="text-[11px] font-bold bg-gradient-to-r from-orange-500 to-amber-400 text-black px-4 py-2 rounded-full transition-transform active:scale-95 disabled:opacity-50"
            >
              {shareDone ? 'Shared ✓' : 'Share my run'}
            </button>
            <button
              onClick={() => setShowSuggest(true)}
              className="text-[11px] text-white/60 border border-white/[0.12] px-4 py-2 rounded-full hover:text-white/90 transition-colors"
            >
              Suggest a picture
            </button>
          </div>
        </div>
      )}

      {/* Main: reference image + hero canvas (hidden once complete — the
          Tier-1 block above owns the finished picture) */}
      {!completed && (
      <div className="flex gap-3 px-4 pt-4 justify-center items-start">
        {/* Target image */}
        <div className="flex flex-col gap-1.5">
          <span className="text-white/30 text-[9px] uppercase tracking-[0.2em]">Target</span>
          <div
            className="rounded-xl overflow-hidden border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
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
        <div className="flex flex-col gap-1.5">
          <span className="text-white/30 text-[9px] uppercase tracking-[0.2em]">Community canvas</span>
          <div
            className="grid rounded-xl overflow-hidden border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
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
              const canTap = !filled && !locked && selectedId !== null;

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
                  onClick={() => handleCellTap(i)}
                  className={`transition-all duration-150 relative ${
                    isFlashing
                      ? flash?.kind === 'wrong'
                        ? 'bg-red-500/50 cell-shake'
                        : 'bg-gray-400/40'
                      : isDragTarget
                        ? 'bg-orange-400/50'
                        : canTap
                          ? 'bg-orange-400/15 hover:bg-orange-400/40 cursor-pointer'
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
      )}

      {/* Stats + progress */}
      {!completed && (
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-white/40 tabular-nums">
            {filledCount}<span className="text-white/25">/{totalCells} placed</span>
          </span>
          <span className="flex items-center gap-3 tabular-nums">
            <span className="text-orange-300/90 font-medium">{score} pts</span>
            {streak > 0 && <span className="text-white/40">{streak}d streak</span>}
          </span>
        </div>
        <div className="h-1 bg-white/[0.07] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-amber-300 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      )}

      {/* Always-visible top 3 — tap for the full board */}
      {leaderboard.length > 0 && (
        <button
          onClick={() => setShowLb(true)}
          className="mx-4 mt-3 flex items-center gap-3 text-[11px] rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.05] transition-colors text-left"
        >
          {leaderboard.slice(0, 3).map((entry, i) => (
            <span key={entry.username} className="flex items-center gap-1.5 min-w-0">
              <span className={`h-2 w-2 rounded-full shrink-0 ${MEDAL_COLORS[i]}`} />
              <span
                className={`truncate max-w-[76px] ${
                  entry.username === state.username ? 'text-orange-300' : 'text-white/60'
                }`}
              >
                {entry.username}
              </span>
              <span className="text-white/30 tabular-nums shrink-0">{entry.score}</span>
            </span>
          ))}
          <span className="ml-auto shrink-0 text-white/35">
            {myRank > 2 ? (
              <span className="text-orange-300/90">you #{myRank + 1}</span>
            ) : (
              '›'
            )}
          </span>
        </button>
      )}

      {/* Hand */}
      {!completed && (
      <div className="mx-4 mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[9px] text-white/35 uppercase tracking-[0.2em]">
            Your pieces{locked ? ' · locked' : ''}
          </span>
          <span className="flex items-center gap-1" title={`${triesLeft} tries left today`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1 w-5 rounded-full transition-colors ${
                  i < triesLeft ? 'bg-gradient-to-r from-orange-400 to-amber-300' : 'bg-white/10'
                }`}
              />
            ))}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {hand.length === 0 && !locked && (
            <span className="text-white/30 text-sm">
              {filledCount >= totalCells
                ? 'Canvas complete — great work!'
                : 'All pieces placed — your part of today’s picture is done.'}
            </span>
          )}
          {hand.map((piece) => {
            const isDragging = piece.id === dragPieceId;
            const isPending = piece.id === pending?.pieceId;
            const isSelected = piece.id === selectedId;
            const justReturned = piece.id === returnedPieceId;
            return (
              <button
                key={piece.id}
                disabled={locked}
                onPointerDown={(e) => handlePiecePress(e, piece.id)}
                onPointerMove={handlePieceMove}
                onPointerUp={handlePieceRelease}
                onPointerCancel={handlePieceCancel}
                className={`relative rounded-lg border-2 transition-all duration-150 overflow-hidden touch-none ${
                  isDragging || isPending
                    ? 'border-orange-400/40 opacity-30'
                    : isSelected
                      ? 'border-orange-400 ring-2 ring-orange-400/50 scale-105'
                      : justReturned
                        ? 'border-red-400 piece-returned'
                        : 'border-white/20 hover:border-white/50 active:scale-95'
                } ${locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
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
      )}

      {/* Zone hint / instruction */}
      {!completed && (
      <div className="px-4 pt-3 pb-5 min-h-[36px]">
        {activePiece ? (
          <div className="flex items-center gap-2 text-xs">
            {hintsOn && (
              <span className="border border-orange-400/30 bg-orange-400/[0.08] text-orange-300 px-2 py-0.5 rounded-full font-medium">
                {ZONE_ARROW[activePiece.zone]} {ZONE_LABEL[activePiece.zone]}
              </span>
            )}
            <span className="text-white/45">
              {draggedPiece
                ? hintsOn
                  ? 'drop it in that corner of the canvas'
                  : 'drop it where it belongs'
                : hintsOn
                  ? 'tap the cell in that corner of the canvas'
                  : 'tap the cell where it belongs'}
            </span>
          </div>
        ) : dayDone ? null : (
          <p className="text-white/30 text-[11px] leading-relaxed">
            Compare pieces to the target image, then tap a piece and tap the cell where it belongs.
            {hintsOn && ' The arrow on each piece points to its corner of the picture.'}
            {bonusLive && (
              <span className="text-orange-300/70">
                {' '}
                Hard mode: correct pieces are worth 2 points.
              </span>
            )}
          </p>
        )}
        {!dayDone && pct >= 10 && pct < 60 && (
          <p className="text-orange-300/50 text-[11px] mt-1.5">
            Think you know what it is? Call it in the comments.
          </p>
        )}
      </div>
      )}

      {/* Leaderboard drawer */}
      {showLb && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 flex items-end"
          onClick={() => setShowLb(false)}
        >
          <div
            className="w-full bg-[#10101e]/95 border-t border-white/[0.08] rounded-t-2xl p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-medium">
                Today's leaders
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

      {/* Drag ghost: the piece lifted off the tray, following the pointer.
          Its transform is set imperatively (mount + pointermove), never via
          JSX, so React re-renders can't reset its position mid-drag. */}
      {dragPieceId !== null && (
        <div
          ref={(el) => {
            ghostRef.current = el;
            if (el && dragMetaRef.current && !el.dataset.positioned) {
              el.dataset.positioned = '1';
              el.style.transform = ghostTransform(
                dragMetaRef.current.startX,
                dragMetaRef.current.startY,
                1.15
              );
            }
          }}
          className="fixed left-0 top-0 rounded-lg border-2 border-orange-400 overflow-hidden pointer-events-none z-50 shadow-[0_10px_28px_rgba(0,0,0,0.65)]"
          style={{
            ...pieceStyle(dragPieceId, gridSize, imageUrl, 68),
            willChange: 'transform',
          }}
        >
          {draggedPiece && hintsOn && (
            <span className="absolute bottom-0.5 right-0.5 text-[11px] bg-black/70 text-orange-300 px-1 rounded leading-tight font-bold">
              {ZONE_ARROW[draggedPiece.zone]}
            </span>
          )}
        </div>
      )}

      {/* Completion celebration: the finished picture, confetti, and a
          positive send-off. Fires only when completion happens live. */}
      {celebration && (
        <div
          className="celebrate-overlay fixed inset-0 z-40 bg-[#06060f]/92 backdrop-blur-sm flex flex-col items-center justify-center px-8 overflow-hidden"
          onClick={() => setCelebration(null)}
        >
          {celebration.map((c, i) => (
            <span
              key={i}
              className="confetti"
              style={{
                left: `${c.left}%`,
                width: c.size,
                height: c.size * 0.55,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
              }}
            />
          ))}
          <div className="celebrate-text text-[9px] uppercase tracking-[0.35em] text-amber-300/80 mb-4">
            Puzzle complete
          </div>
          <div className="celebrate-image rounded-2xl overflow-hidden border border-amber-300/30 shadow-[0_0_60px_rgba(251,146,60,0.25)]">
            <img
              src={imageUrl}
              alt="The completed picture"
              style={{
                width: Math.min(viewportW - 96, 280),
                height: Math.min(viewportW - 96, 280),
                display: 'block',
              }}
            />
          </div>
          <div className="celebrate-text text-center mt-5">
            <div className="text-lg font-bold bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
              {completionMessage}
            </div>
            <div className="text-amber-300/80 text-xs mt-1.5">
              +3 bonus points to every contributor
            </div>
            <div className="text-white/40 text-xs mt-2">
              A new picture drops at midnight — tap to continue
            </div>
          </div>
        </div>
      )}

      {/* First-time tutorial */}
      {showTutorial && (
        <div className="fixed inset-0 z-40 bg-[#06060f]/95 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#10101e] p-5">
            <div className="text-center mb-5">
              <div className="text-[9px] uppercase tracking-[0.3em] text-white/35 mb-1">
                How to play
              </div>
              <div className="text-lg font-black uppercase tracking-tight bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
                The Big Picture
              </div>
            </div>

            <div className="flex flex-col gap-4 text-[13px] text-white/70 leading-snug">
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-orange-400/15 border border-orange-400/40 text-orange-300 text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                <span>
                  One picture a day, built by the whole community. The target image shows what
                  you're all making.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-orange-400/15 border border-orange-400/40 text-orange-300 text-[11px] font-bold flex items-center justify-center">
                  2
                </span>
                <span className="flex items-center gap-2 flex-wrap">
                  <span>Tap a piece,</span>
                  <span className="inline-block w-5 h-5 rounded border-2 border-orange-400 bg-orange-400/30 align-middle" />
                  <span>then tap its cell.</span>
                  <span className="inline-block w-5 h-5 rounded border border-dashed border-white/40 align-middle" />
                  <span>Right = it sticks for everyone.</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-orange-400/15 border border-orange-400/40 text-orange-300 text-[11px] font-bold flex items-center justify-center">
                  3
                </span>
                <span>
                  Wrong spot costs a try — you get 3 a day and 5 pieces. Nobody can finish
                  alone, so every piece counts.
                </span>
              </div>
            </div>

            <button
              onClick={dismissTutorial}
              className="w-full mt-5 bg-gradient-to-r from-orange-500 to-amber-400 text-black font-bold text-sm py-2.5 rounded-full transition-transform active:scale-95"
            >
              Let's play
            </button>
          </div>
        </div>
      )}

      {/* Suggest-a-picture modal */}
      {showSuggest && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 flex items-center justify-center px-6"
          onClick={() => setShowSuggest(false)}
        >
          <div
            className="w-full max-w-sm bg-[#10101e]/95 border border-white/[0.08] rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-medium mb-1">
              Suggest a picture
            </div>
            <p className="text-white/45 text-xs mb-3 leading-relaxed">
              What should the community build together? Ideas can become a future daily puzzle.
            </p>
            <textarea
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="e.g. the eclipse everyone watched this week"
              className="w-full rounded-xl bg-white/[0.05] border border-white/[0.1] text-sm text-white/85 p-3 outline-none focus:border-orange-400/50 resize-none placeholder:text-white/25"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setShowSuggest(false)}
                className="text-xs text-white/40 px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitSuggestion()}
                disabled={suggestBusy || !suggestText.trim()}
                className="text-xs font-bold bg-gradient-to-r from-orange-500 to-amber-400 text-black px-4 py-2 rounded-full disabled:opacity-40"
              >
                Submit
              </button>
            </div>
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

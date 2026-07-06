# THE BIG PICTURE — MVP Spec

A daily communal puzzle for Reddit. One picture, the whole subreddit, three tries each. Built on Devvit Web for Reddit's Games with a Hook hackathon.

---

## The one-line pitch

Every day the subreddit gets one picture to assemble together. You're dealt a few pieces, you have three tries, and the image, tied to something big in the news that week, resolves in real time as the whole community fills it in.

---

## Why this wins

The judging criteria are Delightful UX, Polish, Reddit-y, and Hook. This design was built backward from those, and from what actually makes a person return.

- **Hook (the $15k lane):** three layers of return reason. The daily picture is the heartbeat. Three-tries-a-day scarcity creates within-day tension ("one try left"). Streaks pull across days.
- **Reddit-y (core criterion):** the canvas is communal and cannot be played alone. The comments become a live guessing game as people race to call what the image is. The game literally brings the community together, which is the exact language of the criterion.
- **User Contributions ($3k lane):** every correct placement is user-generated content filling the shared canvas. Structural, not bolted on.
- **Retention ($3k lane):** streaks, a daily leaderboard, and a completion bonus. The rules name these mechanics directly.
- **Polish & self-explanatory:** the full image is visible from the start, so the goal is obvious in one glance. No rule confusion.

---

## Core loop

1. A new communal puzzle posts daily: one target image, shown in full, plus an empty grid beside or over it.
2. The player is dealt 5 puzzle pieces (private to them).
3. Looking at the visible target image, the player taps a piece, then taps the grid cell where they think it belongs.
4. **Correct placement:** the piece locks into the shared canvas for everyone, and the player earns another piece. A good read keeps the run going.
5. **Wrong placement:** burns one of the day's three tries.
6. Run out of tries and the player is done until tomorrow.
7. The canvas fills in real time from everyone's placements. The image resolves over the day.
8. Score = pieces you placed correctly. Community goal = finish the picture before the day ends. Completion triggers a bonus for all contributors.

---

## The piece economy (the heart of it)

This is the single most important tuning decision.

- **Three WRONG placements per day, not three placements total.** This is deliberate. Three total would mean most people place once and leave, and the canvas barely moves. Three *mistakes* means a sharp player on a hot streak can place a long run in one sitting, which is the momentum that feels great and actually fills the canvas.
- Place right → earn another piece → keep going.
- Place wrong → lose a try.
- Out of tries → locked out until the next daily.

This creates both the satisfying within-session run and the scarcity that drives daily return.

---

## The daily image (the second hook)

Each day's puzzle is an **original stylized illustration** riffing on a big, light, widely-known moment from that day or week.

Rules for the image, non-negotiable:

- **Original art only.** Never use news photos. They're copyrighted, and the hackathon requires you own/license everything submitted. Original illustration sidesteps rights entirely.
- **Bold shapes and clear landmarks.** Illustrations make better puzzles than photos because they have strong visual structure. This also solves the "uniform blue sky is unsolvable" problem.
- **Light and broadly known.** Sports, space, pop culture, a viral moment, a milestone, a good-news story. A hard NO on tragedy, war, death, or disaster. A cheerful puzzle resolving into a grim photo is a brand-killer.
- **Recognizable to a general audience.** "The thing everyone saw this week," not niche.

The news tie adds a free guessing layer: because the image resolves slowly, players race to *call it first* in the comments. More reason to show up early, more to argue about.

**Scope note:** a fully automated "pull the news, generate art daily" pipeline is its own project. For the submission, hand-pick 1–2 weeks of news-themed illustrations so the demo is reliable and great. Design the game so swapping in a fresh daily image is a simple operation to keep doing after launch. Build the game first, automate content later.

---

## Difficulty tuning (the hard problem)

"Find where your piece goes by looking at the image" is satisfying with landmarks, miserable without. Three levers:

1. **Pick high-structure images** — faces, maps, bold illustrations. Never gradients.
2. **Give each piece a rough zone hint** so the player reasons within a region, not across a thousand cells.
3. **Size the grid to the crowd** — small grid for a small sub, so the canvas actually completes.

---

## Cold-start protection

A communal canvas can't sit empty or be too big to finish.

- Grid scales to expected player count.
- Seed each day with a few pieces pre-placed so it never opens as a blank void.
- Must be satisfying with a modest crowd (think ~8–20 players), not require hundreds.

---

## MVP scope (build these, nothing more)

| Feature | Why it's in |
|---|---|
| Daily communal puzzle (one shared canvas) | The whole game |
| Visible target image + grid | Makes the goal self-explanatory |
| Deal 5 pieces, tap-piece-then-tap-cell placement | The core mechanic, mobile-first |
| Correct → lock to shared canvas + earn piece | The momentum loop |
| Three wrong tries → lockout | The scarcity hook |
| Real-time shared fill | The "my creation out in the world" payoff |
| Per-piece zone hint | Difficulty control |
| Seeded starting pieces | Cold-start fix |
| Personal score + community completion goal | Dual competitive/collaborative pull |
| Streak counter + daily leaderboard | Named retention mechanics |
| Completion bonus for contributors | Closes the day, rewards the crowd |

## Explicitly out of scope (resist these)

- **Piece rotation** — pieces snap to a grid cell, no fiddly rotating.
- **User-uploaded images at launch** — curate the daily image so quality and solvability are guaranteed.
- Drag-and-drop (tap-tap is easier to build well and better on mobile), accounts beyond Reddit identity, chat/DMs, cosmetics.

Both rotation and user-uploads are tempting and both would blow the deadline. Note them as "later."

---

## Placement interaction

**Tap-the-piece, then tap-the-cell.** Chosen over drag-and-drop because it's dramatically easier to build well, harder to mess up, and better on mobile — and most Reddit traffic is mobile. Selected piece highlights; tapping a cell attempts placement; correct locks with a small satisfying animation, wrong shows a miss and decrements tries.

---

## Identity direction

- **Name:** The Big Picture. The pun is load-bearing — you assemble the big picture, and "the big picture" is what the news *is*. Name and game say the same thing.
- **Handle risk:** "the big picture" is a common phrase, so use a distinct handle (e.g. r/TheBigPictureGame) and a stylized wordmark to make it ownable. Check subreddit/app-name availability at setup.
- **Feel:** clean, current, alive. Strong type, bold color, a sense of "today." Not Reddit-themed — human-first.
- **Voice:** short, confident, a little playful. Reveal/recognition copy with personality ("Someone called it: it's the eclipse.").

---

## Tech notes

- **Platform:** Devvit Web. React for UI. Real-time shared state is the key technical piece — all players see the same canvas update as pieces lock.
- **State per daily puzzle:** puzzle id/date, target image + solution grid, each cell's filled/empty status (shared), per-user dealt pieces, per-user tries remaining, per-user correct-placement count, streaks, leaderboard, completion status.
- **The whole game = shared canvas state + the deal/place/earn loop.** Everything else is polish.

---

## Build order (so it's always shippable)

1. Data model: daily puzzle, solution grid, shared cell state, per-user pieces/tries.
2. Render the target image + empty grid.
3. Tap-piece → tap-cell placement, with correct/wrong resolution.
4. Earn-a-piece-on-correct + three-wrong-tries lockout.
5. Shared real-time fill (placements from anyone show for everyone).
6. Zone hints + seeded starting pieces (difficulty + cold start).
7. Personal score, streak, leaderboard, completion bonus.
8. Identity: name, color, wordmark, voice, mobile polish.

Stop adding features once 1–8 are clean. Polish the loop instead. A small finished game beats an ambitious broken one.

---

## Submission checklist (from the rules)

- [ ] App listing link (developers.reddit.com/apps/{app-name})
- [ ] Public demo post in a subreddit under 200 members, running a real daily puzzle
- [ ] README.md in root: what it is, how to play
- [ ] Optional: <1 min demo video showing the canvas filling in
- [ ] Optional: public repo link
- [ ] Optional: developer feedback survey (Best Feedback prize lane)
- [ ] Significantly built/updated during the submission window (June 17 – July 15, 6pm Pacific)

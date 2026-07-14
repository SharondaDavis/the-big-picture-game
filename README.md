# The Big Picture

**One picture. The whole community. Three wrong tries a day.**

A daily communal jigsaw puzzle for Reddit, built for [Reddit's Games with a Hook hackathon](https://redditgameswithhook.devpost.com/) on [Devvit Web](https://developers.reddit.com/).

No single player can finish the picture alone. Everyone in the subreddit shares one canvas, and it only resolves when the community pools its pieces together.

## What it is

Every day, one image drops for the whole subreddit: a target picture shown in full, next to an empty grid. Each player is dealt five puzzle pieces, private to them, and gets three wrong tries before they're locked out until tomorrow.

Placements aren't private — every correct piece locks into a canvas that **everyone watching the post sees fill in live**. The picture completes only when the community contributes enough correct placements, and finishing before the day ends unlocks a bonus for everyone who played.

## How to play

1. Look at the full target image shown next to the canvas.
2. Drag one of your five pieces onto the grid cell where you think it belongs. The cell under your finger highlights before you let go.
3. **Correct** → the piece locks into the shared canvas for everyone (it sticks!).
4. **Wrong** → the piece bounces back to your tray and you burn one of your three tries for the day.
5. Five pieces is your whole hand for the day — no refills — so no single player can finish the picture alone. When your pieces are placed (or your tries are gone), you're done until the next daily. Finishing the canvas pays **+3 bonus points to every contributor**, and you can share your run to the comments or suggest a picture for a future puzzle while you wait.

**Hints and scoring:** the game starts hint-free at full score. Need help? Toggle hints on in the header for a corner arrow (↖ ↗ ↙ ↘) showing which quadrant each piece belongs in — but correct placements are worth **1 point with hints versus 2 without**, and making any placement with hints visible forfeits the double rate for the rest of that day.

## Play it

The daily puzzle runs live in **[r/BigPictureGame](https://www.reddit.com/r/BigPictureGame/)** — open the latest "The Big Picture" post and your five pieces are waiting.

## How it works

- **Shared canvas, not a personal board.** The grid's fill state lives server-side in Redis, keyed per puzzle date, and is shared by every player who opens that day's post.
- **Real-time sync.** When a piece locks in, the server broadcasts the placement over Devvit's real-time channel so every open client updates the canvas immediately, without a refresh.
- **Cold-start protection.** Each day seeds a handful of cells pre-filled so the canvas never opens as an empty void, and the grid size is tuned to the size of the crowd expected to play.
- **Per-user state.** Dealt hand, tries remaining, score, and streak are tracked per player per day; the leaderboard and completion bonus are computed from everyone's contributions.

## Tech stack

| Layer | Tech |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/) |
| Frontend | React 19, Tailwind CSS 4, Vite |
| Backend | Node.js (Devvit serverless), [Hono](https://hono.dev/) |
| Real-time | Devvit realtime channels |
| Persistence | Redis (via `@devvit/web/server`) |
| Language | TypeScript throughout (client, server, and shared types) |

## Project structure

```
src/
  client/
    splash.tsx     # Inline feed view — the "Play Today's Puzzle" card
    game.tsx        # Expanded view — the full puzzle: target image, canvas, hand, leaderboard
  server/
    core/puzzles.ts # Puzzle definitions, Redis keys, dealing/scoring/streak logic
    routes/api.ts   # game-state, place, and canvas endpoints
  shared/
    api.ts          # Types shared between client and server
public/
  puzzle-001.svg    # Daily puzzle artwork
```

## Local development

Requires Node 22+ and a Reddit developer account connected via `devvit login`.

```bash
npm install
npm run login    # one-time: authenticate the Devvit CLI
npm run dev       # starts a live playtest build on your dev subreddit
```

Other scripts:

| Command | Does |
|---|---|
| `npm run build` | Builds the client and server bundles |
| `npm run type-check` | Type-checks the whole project |
| `npm run lint` | Lints `src/` |
| `npm run deploy` | Type-checks, lints, and uploads a new app version |
| `npm run launch` | Deploys, then publishes the app for review |

The dev subreddit and post entrypoints are configured in [`devvit.json`](devvit.json).

## Puzzle content

Daily puzzles are original, hand-picked stylized illustrations defined in [`src/server/core/puzzles.ts`](src/server/core/puzzles.ts) — never news photos, to keep the art fully owned and rights-clear. Bold, high-landmark illustrations make for a fair puzzle; a uniform image (a flat sky, say) would be unsolvable without more zone hints than we want to lean on.

## Roadmap

- Automate a fresh daily image pulled from current events instead of hand-picking art
- Community-submitted puzzles — including AI-generated art the community votes into the daily slot
- Jigsaw-look piece shapes (knobs/notches via SVG masks) for intricate puzzles, keeping the square grid underneath
- Larger grids (6×6+) as communities grow, so every player always gets a full hand
- Seasonal/event pictures the whole platform assembles together

## License

BSD-3-Clause — see [LICENSE](LICENSE).

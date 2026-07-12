# The Big Picture

**One picture. The whole community. Three wrong tries a day.**

The Big Picture is a daily jigsaw where nobody can finish alone. Every day, one image drops for the whole subreddit — and its title stays hidden. You're dealt five pieces, private to you. Look at the picture, figure out where yours fit, and lock them into a canvas everyone shares. Five pieces is your whole hand: when they're placed, your part is done. Miss three times and you're done until tomorrow.

The twist: no single player *can* complete the picture — the math forbids it. Each puzzle has more open cells than any one hand can cover, so the image only comes together when the community pools its pieces, resolving in real time as people play.

## Inspiration

I kept coming back to one question while brainstorming: what actually pulls someone back to a game day after day? Not points. Not badges. The feeling of building something that's bigger than you, out in the world, with other people. Reddit is one of the only places with the crowd density to make a truly collective puzzle work, where thousands of strangers can each hold a piece of the same thing. I wanted a game where the community isn't the audience. The community is the mechanic.

## What it does

Each day the subreddit gets a shared image and an empty grid. Every player is dealt five puzzle pieces. The game starts hint-free at full score; opt into corner-arrow hints and it warns you that hinted placements score half. Tap a piece, then tap the cell you think it goes in (drag works too). Correct placements lock into a canvas that everyone sees fill in live. Wrong ones cost one of your three daily tries — though a miss in the right corner tells you so: "almost doesn't count."

Because the day's title is hidden until the canvas completes, the comment section becomes a second game: as the image resolves, players race to call what it is. When the last piece locks, the picture takes over the screen with the title reveal, a contributor count, and +3 bonus points paid to everyone who placed a piece.

The comeback loop is layered: streaks become your community flair from day three ("🧩 5-day streak" on every comment you write), a live top-3 strip plus daily and all-time leaderboards reward the sharpest solvers, placing all five pieces without a miss earns a Perfect Day, and running out of pieces flips the screen to a summary with a countdown to the next picture. One tap shares your run to the comments. And because the pictures riff on what's happening in the world — an eclipse, aurora season, the World Cup final — finishing the day's puzzle feels like watching the week develop one tile at a time.

## How I built it

The game runs entirely on Reddit's Devvit Web platform. The front end is built with the Devvit React template. The back end handles the piece-dealing logic, placement validation, streak and flair tracking, the no-hints bonus, and the leaderboard, with Redis for persistence. The core technical challenge was the shared canvas: every player has to see the same picture fill in as pieces lock, so the app uses Devvit's real-time messaging to broadcast each correct placement to everyone viewing the post.

To avoid a cold-start problem, each daily puzzle seeds a few pieces pre-placed so the canvas is never a blank void, and the grid scales with the art — bolder pictures get fewer, larger tiles; intricate scenes get more pieces so more players hold a full hand. If someone else fills a cell you were holding, your dead piece silently swaps for a live one.

## Challenges I ran into

The hardest design problem was making piece placement feel like a satisfying read rather than a hopeless pixel hunt. A uniform image (think a field of blue sky) is unsolvable. The fix was bold, high-landmark illustrations with a distinct feature in every grid cell, plus the zone hint so you're reasoning within a region.

The second challenge was keeping the game honestly communal. My first economy dealt a fresh piece for every correct placement — and in playtesting, one sharp player could run the entire board alone, which contradicted the whole pitch. I replaced it with a hard cap: five pieces a day, no refills. That one change made "nobody can finish alone" mechanically true instead of aspirational, and it turned a solo speedrun into a relay.

The third was input feel on phones. Drag-and-drop through a mobile webview taught me more about pointer events, GPU compositing, and tap-versus-drag thresholds than I expected — the fix that mattered most was moving the dragged piece with direct transforms outside React's render loop, and letting taps be forgiving.

## What I learned

That the best hook isn't a mechanic you bolt on. It's structural. Once the game genuinely required a community to finish, the retention, the comments, and the daily ritual all fell out of that one decision instead of being features I had to force.

## What's next

The suggest-a-picture box already collects community ideas in-game. Next: a weekly voting thread where the community picks from those ideas, AI-generated art for the winners credited to their submitters at the reveal, automated daily images tied to current events, and seasonal pictures the whole platform assembles together.

# Line Rider

A browser remake of the classic Flash game **Line Rider**. Draw a track, press play, and watch Bosh sled down it.

**Play it:** https://dec3ptor.github.io/Line-Rider/

It runs entirely in the browser with no build step, and works with a mouse or on a phone or tablet.

## Endless ride

Tap the compass button (or **Menu → Endless ride & maps**) and pick **Endless ride**. The world builds itself ahead of Bosh forever, through eight themed areas (Frosty Peaks, Whispering Woods, Canyon Run, Neon City, Star Lanes, Lava Falls, Sunny Bay and Sugar Rush).

How the track is made: the generator follows Bosh frame by frame and keeps **nudging** him. Each nudge is a small piece of track dropped right where he's about to be: a ramp, a little tap under the nose or tail, a curve, a booster or a brake, mild or extreme. It tries a dozen of them, test-rides each one with the real physics, and keeps the most exciting one that he survives: flips, reverses, dead stops, riding upside down, near misses. After a burst of nudges he's caught on a ramp laid along his flight path, and every so often there's a smooth section (a loop, a flip kicker, a gap jump) to catch his breath. New track is never allowed to change anything he has already ridden, and if it paints itself into a corner it backs up and takes another route.

Every solid line is then built into the scenery: rock ledges, brick rooftops, planks, girders, posts and candy rails grow out of the track's underside, carved so they never get in Bosh's way.

Trick call-outs pop up as they happen (Backflip!, Reverse!, Dead stop!, Upside down!, Huge air!). Old track behind the rider is cleared away, so memory use stays flat however long you ride.

`N` makes a new world. **Copy share link** shares the world you're in (`#endless=<seed>`); the same seed always builds the same world.

## Built-in maps

Nine maps, from easy warm-ups to the two-minute **Grand Tour** through every area: First Tracks, Sunny Bay, Alpine Descent, Canyon Run, Sugar Rush, Neon Rooftops, Lava Falls, Orbit and Grand Tour. Each is a run of the endless generator with a fixed seed, area and wildness, ending at a FINISH gate. They're built ahead of time into `maps/*.json` (`npm run build-maps`), so they load instantly. Maps load as normal tracks, so you can edit them too. Share one with `#map=<id>`, e.g. `#map=grand-tour`.

## How to play

| Tool | Key | What it does |
| --- | --- | --- |
| Pencil | `Q` | Draw freehand |
| Line | `W` | Straight lines that snap to line ends |
| Eraser | `E` | Rub out lines |
| Pan | `R` | Move the view, or drag Bosh to move the start point |

| Line | Key | Behaviour |
| --- | --- | --- |
| Blue | `1` | Normal, solid track |
| Red | `2` | Boost: speeds Bosh up in the direction you drew it |
| Green | `3` | Scenery: decoration only, not solid |

Lines are solid on **one side only**, just like the original. The shaded edge is the ground side, so draw left to right to ride on top. Hold `Shift` or turn on **Flip** (`F`) to swap sides.

**Playback:** `Space` play/pause · `U` stop · `Y` restart · `I` set a flag (checkpoint) · `←`/`→` step frames when paused · drag the timeline to scrub.

**View:** scroll or pinch to zoom · right-drag or two fingers to pan · `C` finds the rider.

**Show path** (`P`, or the dotted button on the right): while you edit, a dotted line shows where Bosh will go, updating as you draw. Dots mark each second, and a red × marks where he'd crash.

**Editing:** `Ctrl+Z` undo · `Ctrl+Shift+Z` redo · hold `Ctrl` while drawing to turn off snapping.

## Saving and sharing

- Your track saves in your browser automatically.
- **Menu → Save file** downloads a `.json` track in the linerider.com format, so it also opens in other Line Rider editors. **Open file…** loads those files too.
- **Menu → Copy share link** puts the whole track into a link that anyone can open.

## Physics

The simulation follows the classic Line Rider 6.2 engine: 40 frames per second, a 17-point rider (10 contact points plus a scarf), 6 constraint passes per frame, one-sided lines with a 10-unit collision zone, and breakable joints that make Bosh fall off his sled on hard landings. Constants come from [lr-core](https://github.com/conundrumer/lr-core) (MIT).

## Running locally

ES modules need a web server, so opening `index.html` straight from disk won't work:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Tests: `npm test` (Node 18+). It checks the physics, test-rides the smooth-section generator, re-rides every built-in map file from START to FINISH, and rides two endless worlds for a couple of minutes the way the app does (building ahead, clearing behind).

`tools/` has the experiments used to tune the generators (curve limits, loop shapes, flip kickers, landings), `tools/chaos-batch.mjs <seconds> <seeds>` for long runs with trick counts, and `tools/viz.mjs` to draw a generated stretch of track to an HTML page.

## Publishing with GitHub Pages

Every push to `main` runs the tests and deploys the site with the **Deploy to GitHub Pages** workflow (`.github/workflows/pages.yml`). In **Settings → Pages**, **Source** must be set to **GitHub Actions**. The site lives at https://dec3ptor.github.io/Line-Rider/.

## Credits

Line Rider was created by Boštjan Čadež in 2006. This is a fan remake for fun.

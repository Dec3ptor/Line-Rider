# Line Rider

A browser remake of the classic Flash game **Line Rider**. Draw a track, press play, and watch Bosh sled down it.

**Play it:** https://dec3ptor.github.io/Line-Rider/

It runs entirely in the browser with no build step, and works with a mouse or on a phone or tablet.

## Endless ride

Tap the compass button (or **Menu → Endless ride & maps**) and pick **Endless ride**. The world builds itself ahead of Bosh forever: slopes, rollers, kickers, cliff drops, flips, gap jumps, steps, loop-the-loops, boosters and brakes, through eight themed areas (Frosty Peaks, Whispering Woods, Canyon Run, Neon City, Star Lanes, Lava Falls, Sunny Bay and Sugar Rush), each with its own scenery.

Every piece of track is test-ridden with the real physics before it's kept. If Bosh would crash, fall off or get stuck, that piece is thrown away and another is tried. Jump landings are laid along his actual flight path, so they're smooth. Old track behind the rider is cleared away, so memory use stays flat however long you ride.

`N` makes a new world. **Copy share link** shares the world you're in (`#endless=<seed>`); the same seed always builds the same world.

## Built-in maps

Nine maps, from easy warm-ups to the 80-second **Grand Tour** through every area: First Tracks, Alpine Descent, Canyon Run, Neon Rooftops, Orbit, Lava Falls, Sunny Bay, Sugar Rush and Grand Tour. They're built by the same generator from fixed scripts and seeds, so each one is rideable from START to FINISH. Maps load as normal tracks, so you can edit them too. Share one with `#map=<id>`, e.g. `#map=grand-tour`.

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

Tests: `npm test` (Node 18+). It checks the physics, generates three endless worlds and re-rides them from scratch, and builds and re-rides every built-in map.

`tools/` has the experiments used to tune the generator (curve limits, loop shapes, flip kickers, landings) and `tools/gen-soak.mjs <seed> <pieces>` for long generator runs.

## Publishing with GitHub Pages

The site is plain static files at the repo root. To publish it, go to **Settings → Pages**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, and save. It goes live at `https://<user>.github.io/Line-Rider/` a minute or two later.

## Credits

Line Rider was created by Boštjan Čadež in 2006. This is a fan remake for fun.

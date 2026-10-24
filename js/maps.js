// Built-in maps. Each one is a run of the endless-mode generator with a fixed
// seed, area and wildness, ending at a FINISH gate. They're built ahead of
// time by tools/build-maps.mjs into maps/<id>.json, so they load instantly and
// ride exactly the same in every browser.

import { Track, Line, Simulator, LineType, FPS } from './physics.js';
import { ChaosGenerator } from './gen/chaos.js';
import { BIOME_BY_ID } from './gen/biomes.js';
import { serialize, parseTrack } from './storage.js';

export const MAPS = [
  {
    id: 'first-tracks', name: 'First Tracks', biome: 'forest', seed: 1101, level: 'Easy', wild: 0.25, secs: 40,
    desc: 'A gentle warm-up through the woods: bumps, small jumps and the odd surprise.',
  },
  {
    id: 'bay', name: 'Sunny Bay', biome: 'beach', seed: 7707, level: 'Easy', wild: 0.35, secs: 45,
    desc: 'A breezy boardwalk ride past palm trees and sailboats.',
  },
  {
    id: 'alpine', name: 'Alpine Descent', biome: 'alpine', seed: 2202, level: 'Medium', wild: 0.55, secs: 50,
    desc: 'Big air between snowy peaks, with flips and switchbacks on the way down.',
  },
  {
    id: 'canyon', name: 'Canyon Run', biome: 'desert', seed: 3303, level: 'Medium', wild: 0.6, secs: 50,
    desc: 'Ricochet between the mesas, bounce off ledges and drop into the canyon.',
  },
  {
    id: 'sugar', name: 'Sugar Rush', biome: 'candy', seed: 8808, level: 'Medium', wild: 0.65, secs: 50,
    desc: 'Loops, lollipops and candy-cane rails, with plenty of reverses.',
  },
  {
    id: 'neon', name: 'Neon Rooftops', biome: 'city', seed: 4404, level: 'Hard', wild: 0.85, secs: 60,
    desc: 'Bounce between skyscrapers: flips, dead stops and back-and-forth chaos.',
  },
  {
    id: 'lava', name: 'Lava Falls', biome: 'volcano', seed: 6606, level: 'Hard', wild: 0.85, secs: 60,
    desc: 'Drop after drop past erupting volcanoes. Mind the flips.',
  },
  {
    id: 'orbit', name: 'Orbit', biome: 'space', seed: 5505, level: 'Hard', wild: 1, secs: 60,
    desc: 'The wildest one: flips, reverses and huge jumps among the planets.',
  },
  {
    id: 'grand-tour', name: 'Grand Tour', biome: 'forest', seed: 9909, level: 'Epic', wild: null, secs: 110,
    tour: ['forest', 'beach', 'alpine', 'desert', 'candy', 'city', 'volcano', 'space'],
    desc: 'The long one: a ride through all eight areas with every kind of trick.',
  },
];

export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

// Builds a map from scratch (tools/build-maps.mjs; yields so it can run in slices).
// Result: { def, start, lines: Line[], frames, counts }
export function* buildMap(def) {
  const track = new Track();
  const sim = new Simulator(track);
  const opts = { seed: def.seed, map: true, level: def.wild };
  if (def.tour) {
    opts.biomeOrder = def.tour.map((id) => BIOME_BY_ID[id]);
    opts.biomeEvery = [Math.round((def.secs * FPS) / def.tour.length) - 40, Math.round((def.secs * FPS) / def.tour.length) + 40];
  } else {
    opts.biome = BIOME_BY_ID[def.biome];
  }
  const gen = new ChaosGenerator(track, sim, opts);
  while (gen.F < def.secs * FPS) {
    if (!(yield* gen.next())) throw new Error(`stuck at ${(gen.F / FPS).toFixed(1)}s`);
  }
  // then catch Bosh and bring him in to the finish
  gen.flowKind = 'finish';
  gen.minUndoFrame = gen.F - 300;   // keep the length: no backing up far
  const done = () => gen.chunks.some((c) => c.kind === 'flow:finish');
  for (let i = 0; i < 200 && !done(); i++) {
    gen.nextFlow = gen.F;
    if (!(yield* gen.next())) throw new Error('could not finish');
  }
  if (!done()) throw new Error('could not finish');
  gen.dressSettled(true);
  const counts = { loops: 0, flips: 0, jumps: 0, reverses: 0, stops: 0 };
  for (const e of gen.events) {
    if (e.type === 'loop') counts.loops += e.count || 1;
    if (e.type === 'flip') counts.flips += e.count || 1;
    if (e.type === 'air') counts.jumps++;
    if (e.type === 'reverse') counts.reverses++;
    if (e.type === 'stop') counts.stops++;
  }
  // fresh copies with ids in the same order, so the ride is identical in the editor
  const sorted = [...track.lines.values()].sort((a, b) => a.id - b.id);
  const lines = sorted.map((l, i) => {
    const c = new Line(i + 1, l.type, l.x1, l.y1, l.x2, l.y2, l.flipped, l.leftExt, l.rightExt);
    if (l.style) c.style = l.style;
    return c;
  });
  return { def, start: { ...track.start }, lines, frames: gen.F, counts };
}

// The file format for a built map: a normal saved track plus a little info.
export function mapToJSON(built) {
  const track = new Track();
  track.start = built.start;
  for (const l of built.lines) track.add(l);
  return { ...serialize(track, built.def.name), frames: built.frames, counts: built.counts };
}

export function mapFromJSON(def, data) {
  const t = parseTrack(data);
  return { def, start: t.start, lines: t.lines, frames: data.frames, counts: data.counts || {} };
}

// Fetch a prebuilt map (browser).
export async function loadMap(def) {
  const res = await fetch(`maps/${def.id}.json`);
  if (!res.ok) throw new Error(`couldn't load (${res.status})`);
  return mapFromJSON(def, await res.json());
}

// Run a builder in small time slices.
export function runSliced(it, sliceMs = 12) {
  return new Promise((resolve, reject) => {
    const step = () => {
      const t = performance.now();
      try {
        while (performance.now() - t < sliceMs) {
          const r = it.next();
          if (r.done) { resolve(r.value); return; }
        }
      } catch (err) {
        reject(err);
        return;
      }
      setTimeout(step, 0);
    };
    step();
  });
}

// Small picture of a map for its card.
export function drawThumb(canvas, built, tint) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 220, h = canvas.clientHeight || 110;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = tint || '#f6f7f9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of built.lines) {
    if (!l.collidable) continue;
    x0 = Math.min(x0, l.minX); y0 = Math.min(y0, l.minY);
    x1 = Math.max(x1, l.maxX); y1 = Math.max(y1, l.maxY);
  }
  x1 = Math.min(x1, x0 + Math.max(2000, (x1 - x0) * 0.82)); // skip most of the cool-down
  const pad = 10;
  const s = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
  const ox = pad + (w - pad * 2 - (x1 - x0) * s) / 2, oy = pad + (h - pad * 2 - (y1 - y0) * s) / 2;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (ox - x0 * s), dpr * (oy - y0 * s));
  ctx.lineCap = 'round';
  const groups = new Map();
  for (const l of built.lines) {
    if (l.minX > x1) continue;
    const key = l.style ? l.style.color : l.type === LineType.ACCEL ? '#e0261b' : '#1d2330';
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = { lines: [], width: l.style ? 0.8 : 1.6, back: !!l.style }));
    arr.lines.push(l);
  }
  const order = [...groups.entries()].sort((a, b) => b[1].back - a[1].back);
  for (const [color, g] of order) {
    ctx.beginPath();
    for (const l of g.lines) { ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); }
    ctx.strokeStyle = color;
    ctx.globalAlpha = g.back ? 0.55 : 1;
    ctx.lineWidth = g.width / s;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

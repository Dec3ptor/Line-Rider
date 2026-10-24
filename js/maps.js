// Built-in maps. Each one is a script of track pieces in a themed area, built
// by the same test-riding generator as endless mode, so every map is rideable
// from START to FINISH. The same seed always builds the same map.

import { Track, Line, Simulator, LineType } from './physics.js';
import { Generator } from './gen/generator.js';
import { BIOME_BY_ID, decoratePiece } from './gen/biomes.js';

export const MAPS = [
  {
    id: 'first-tracks', name: 'First Tracks', biome: 'forest', seed: 1101, level: 'Easy',
    desc: 'A gentle warm-up through the woods: rolling hills, small jumps and a boost.',
    script: ['cruise', 'rollers', 'kicker', 'cruise', 'gaps', 'booster', 'kicker', 'rollers', 'drop', 'cruise', 'kicker', 'rollers', 'gaps', 'kicker', 'finish'],
  },
  {
    id: 'alpine', name: 'Alpine Descent', biome: 'alpine', seed: 2202, level: 'Medium',
    desc: 'Big air between snowy peaks, with loops and flips on the way down.',
    script: ['kicker', 'drop', 'rollers', 'kicker', 'loop', 'drop', 'steps', 'flip', 'kicker', 'drop', 'rollers', 'kicker', 'flip', 'drop', 'loop', 'kicker', 'finish'],
  },
  {
    id: 'canyon', name: 'Canyon Run', biome: 'desert', seed: 3303, level: 'Medium',
    desc: 'Cliff drops and broken bridges across the mesas.',
    script: ['drop', 'steps', 'gaps', 'drop', 'cruise', 'kicker', 'drop', 'steps', 'gaps', 'drop', 'kicker', 'steps', 'flip', 'gaps', 'drop', 'finish'],
  },
  {
    id: 'neon', name: 'Neon Rooftops', biome: 'city', seed: 4404, level: 'Hard',
    desc: 'Hop the gaps between skyscrapers, then loop the loop over the city.',
    script: ['gaps', 'steps', 'booster', 'loop', 'gaps', 'steps', 'kicker', 'loop', 'gaps', 'drop', 'loop', 'steps', 'flip', 'gaps', 'loop', 'finish'],
  },
  {
    id: 'orbit', name: 'Orbit', biome: 'space', seed: 5505, level: 'Hard',
    desc: 'Loops, flips and huge jumps among the planets.',
    script: ['kicker', 'loop', 'flip', 'drop', 'booster', 'loop', 'kicker', 'flip', 'loop', 'drop', 'flip', 'kicker', 'loop', 'flip', 'finish'],
  },
  {
    id: 'lava', name: 'Lava Falls', biome: 'volcano', seed: 6606, level: 'Hard',
    desc: 'Drop after drop past erupting volcanoes. Mind the flips.',
    script: ['drop', 'flip', 'drop', 'kicker', 'steps', 'drop', 'flip', 'gaps', 'drop', 'kicker', 'flip', 'steps', 'drop', 'finish'],
  },
  {
    id: 'bay', name: 'Sunny Bay', biome: 'beach', seed: 7707, level: 'Easy',
    desc: 'A breezy boardwalk ride past palm trees and sailboats.',
    script: ['rollers', 'cruise', 'kicker', 'rollers', 'loop', 'rollers', 'kicker', 'cruise', 'kicker', 'rollers', 'gaps', 'rollers', 'kicker', 'finish'],
  },
  {
    id: 'sugar', name: 'Sugar Rush', biome: 'candy', seed: 8808, level: 'Medium',
    desc: 'Loops, lollipops and candy-cane rails.',
    script: ['rollers', 'loop', 'gaps', 'loop', 'rollers', 'flip', 'loop', 'kicker', 'rollers', 'loop', 'gaps', 'flip', 'loop', 'finish'],
  },
  {
    id: 'grand-tour', name: 'Grand Tour', biome: 'forest', seed: 9909, level: 'Epic',
    desc: 'The long one: a ride through all eight areas with every kind of trick.',
    script: [
      'rollers', 'kicker', 'gaps', { biome: 'alpine' }, 'drop', 'kicker', 'loop', 'flip', { biome: 'desert' }, 'steps', 'gaps', 'drop', 'kicker',
      { biome: 'city' }, 'gaps', 'loop', 'steps', 'loop', { biome: 'space' }, 'flip', 'loop', 'kicker', 'flip', { biome: 'volcano' }, 'drop', 'flip', 'steps',
      { biome: 'beach' }, 'rollers', 'kicker', 'loop', { biome: 'candy' }, 'loop', 'rollers', 'flip', 'loop', 'finish',
    ],
  },
];

export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

// Builds a map step by step (yields so the page stays responsive).
// Result: { def, start, lines: Line[], frames, counts }
export function* buildMap(def) {
  const track = new Track();
  const sim = new Simulator(track);
  const gen = new Generator(track, sim, {
    seed: def.seed, map: true, biome: BIOME_BY_ID[def.biome], decorate: decoratePiece,
  });
  const first = yield* gen.next();
  if (!first) throw new Error('could not start the map');
  for (const step of def.script) {
    if (typeof step === 'object') {
      if (step.biome) gen.setBiome(BIOME_BY_ID[step.biome]);
      continue;
    }
    // loops and flips need some speed: add a boost first if Bosh is slow
    if ((step === 'loop' || step === 'flip') && gen.anchor.speed < 9) yield* gen.next('booster');
    let piece = yield* gen.next(step, step === 'flip' || step === 'loop' ? 12 : 6);
    if (!piece && step === 'finish') piece = yield* gen.next('finish');
    if (!piece) throw new Error(`could not build "${step}"`);
  }
  const counts = { loops: 0, flips: 0, jumps: 0 };
  for (const e of gen.events) {
    if (e.type === 'loop') counts.loops += e.count || 1;
    if (e.type === 'flip') counts.flips++;
    if (e.type === 'air') counts.jumps++;
  }
  // fresh copies with ids in the same order, so the ride is identical in the editor
  const sorted = [...track.lines.values()].sort((a, b) => a.id - b.id);
  const lines = sorted.map((l, i) => {
    const c = new Line(i + 1, l.type, l.x1, l.y1, l.x2, l.y2, l.flipped, l.leftExt, l.rightExt);
    if (l.style) c.style = l.style;
    return c;
  });
  return { def, start: { ...track.start }, lines, frames: gen.anchor.frame, counts };
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

// Generate many pieces, then re-ride the whole track from scratch to prove it is crash-free.
import { Track, Simulator } from '../js/physics.js';
import { Generator, runSync, sledInfo, speedOf } from '../js/gen/generator.js';

const seed = +(process.argv[2] || 1), count = +(process.argv[3] || 80);
const track = new Track();
const sim = new Simulator(track);
const gen = new Generator(track, sim, { seed });
const t0 = performance.now();
const kinds = {};
let worst = 0;
for (let i = 0; i < count; i++) {
  const t = performance.now();
  const piece = runSync(gen.next());
  const dt = performance.now() - t;
  worst = Math.max(worst, dt);
  if (!piece) { console.log('FAILED at piece', i, 'speed', gen.anchor.speed.toFixed(1)); break; }
  kinds[piece.kind] = (kinds[piece.kind] || 0) + 1;
}
const ms = performance.now() - t0;
const end = gen.anchor.frame;
console.log(`seed ${seed}: ${gen.pieces.length} pieces, ${track.size} lines, ${end} frames (${(end / 40 / 60).toFixed(1)} min ride), ${ms.toFixed(0)} ms total, worst piece ${worst.toFixed(0)} ms`);
console.log(JSON.stringify(kinds));
// fresh re-ride
const fresh = new Simulator(track);
let crash = -1;
for (let f = 0; f <= end; f++) { if (!fresh.frame(f).mounted) { crash = f; break; } }
const a = fresh.frame(end).center(), b = sim.frame(end).center();
console.log(crash < 0 ? 'fresh re-ride: clean' : `fresh re-ride: CRASH at frame ${crash}`, '| matches generator:', a.x === b.x && a.y === b.y);
if (process.argv[4]) for (const [k, v] of Object.entries(gen.stats)) console.log(k.padEnd(8), 'ok', v.ok, JSON.stringify(v.fail));
console.log('events:', gen.events.filter(e => e.type !== 'air').map(e => e.label || e.type).join(', '));

// Generated tracks must be rideable start to finish, and the same seed must
// always build the same world.
import { Track, Simulator } from '../js/physics.js';
import { Generator, runSync } from '../js/gen/generator.js';
import { BIOMES, decoratePiece } from '../js/gen/biomes.js';

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  if (!cond) failed++;
}

function build(seed, pieces) {
  const track = new Track();
  const sim = new Simulator(track);
  const gen = new Generator(track, sim, { seed, biomes: BIOMES, decorate: decoratePiece });
  for (let i = 0; i < pieces; i++) if (!runSync(gen.next())) return { gen, track, ok: false };
  return { gen, track, ok: true };
}

for (const seed of [11, 22, 33]) {
  const { gen, track, ok } = build(seed, 30);
  check(`seed ${seed}: 30 pieces generated`, ok, `(${gen.pieces.map((p) => p.kind).join(' ')})`);
  const end = gen.anchor.frame;
  const fresh = new Simulator(track);
  let crash = -1;
  for (let f = 0; f <= end; f++) if (!fresh.frame(f).mounted) { crash = f; break; }
  check(`seed ${seed}: fresh ride of ${end} frames is crash-free`, crash < 0, crash >= 0 ? `crashed at ${crash}` : '');
  const scenery = [...track.lines.values()].filter((l) => l.style).length;
  check(`seed ${seed}: scenery was drawn`, scenery > 200, `${scenery} scenery lines`);
}

const a = build(5, 12), b = build(5, 12);
const sig = (t) => [...t.track.lines.values()].map((l) => `${l.x1},${l.y1},${l.x2},${l.y2}`).join(';');
check('same seed builds the same world', sig(a) === sig(b));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

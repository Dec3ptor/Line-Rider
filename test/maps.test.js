// Every built-in map must build and be crash-free from START to FINISH.
import { Track, Simulator } from '../js/physics.js';
import { MAPS, buildMap } from '../js/maps.js';
import { runSync } from '../js/gen/generator.js';

let failed = 0;
for (const def of MAPS) {
  const t0 = performance.now();
  let built;
  try { built = runSync(buildMap(def)); } catch (err) { console.log(`FAIL ${def.name}: ${err.message}`); failed++; continue; }
  const ms = performance.now() - t0;
  const track = new Track();
  track.start = built.start;
  for (const l of built.lines) track.add(l);
  const sim = new Simulator(track);
  let crash = -1;
  for (let f = 0; f <= built.frames + 200; f++) if (!sim.frame(f).mounted) { crash = f; break; }
  const ok = crash < 0;
  if (!ok) failed++;
  const c = built.counts;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${def.name.padEnd(15)} ${String(built.lines.length).padStart(5)} lines  ${(built.frames / 40).toFixed(0).padStart(3)}s ride  ${c.jumps} jumps ${c.loops} loops ${c.flips} flips  built in ${ms.toFixed(0)} ms${ok ? '' : `  CRASH at frame ${crash}`}`);
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

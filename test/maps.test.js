// Every built-in map file must ride crash-free from START to FINISH, exactly
// as the app loads it. (Rebuild them with: node tools/build-maps.mjs)
import { readFileSync } from 'node:fs';
import { Track, Simulator } from '../js/physics.js';
import { MAPS, mapFromJSON } from '../js/maps.js';

let failed = 0;
for (const def of MAPS) {
  let built;
  try {
    built = mapFromJSON(def, JSON.parse(readFileSync(new URL(`../maps/${def.id}.json`, import.meta.url), 'utf8')));
  } catch (err) { console.log(`FAIL ${def.name}: ${err.message}`); failed++; continue; }
  const track = new Track();
  track.start = built.start;
  for (const l of built.lines) track.add(l);
  const sim = new Simulator(track);
  let crash = -1;
  for (let f = 0; f <= built.frames + 200; f++) if (!sim.frame(f).mounted) { crash = f; break; }
  // and he should be past the finish gate, still riding
  const end = sim.frame(built.frames + 200).center();
  const ok = crash < 0 && end.x > built.lines.find((l) => l.collidable).x1;
  if (!ok) failed++;
  const c = built.counts;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${def.name.padEnd(15)} ${String(built.lines.length).padStart(5)} lines  ${(built.frames / 40).toFixed(0).padStart(3)}s ride  ${c.flips} flips ${c.reverses} reverses ${c.stops} stops ${c.loops} loops${crash < 0 ? '' : `  CRASH at frame ${crash}`}`);
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

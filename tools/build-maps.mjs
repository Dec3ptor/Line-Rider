// Build the built-in maps into maps/<id>.json and check each one rides clean.
// usage: node tools/build-maps.mjs [id ...]
import { writeFileSync } from 'node:fs';
import { Track, Simulator } from '../js/physics.js';
import { MAPS, MAP_BY_ID, buildMap, mapToJSON, mapFromJSON } from '../js/maps.js';
import { runSync } from '../js/gen/generator.js';

const ids = process.argv.slice(2);
const defs = ids.length ? ids.map((id) => MAP_BY_ID[id]).filter(Boolean) : MAPS;
let failed = 0;
for (const def of defs) {
  const t0 = performance.now();
  let built;
  try { built = runSync(buildMap(def)); } catch (err) { console.log(`FAIL ${def.id}: ${err.message}`); failed++; continue; }
  const json = mapToJSON(built);
  const text = JSON.stringify(json);
  // re-ride what was saved, exactly as the app will load it
  const back = mapFromJSON(def, JSON.parse(text));
  const track = new Track();
  track.start = back.start;
  for (const l of back.lines) track.add(l);
  const sim = new Simulator(track);
  let crash = -1;
  for (let f = 0; f <= back.frames + 200; f++) if (!sim.frame(f).mounted) { crash = f; break; }
  if (crash >= 0) { console.log(`FAIL ${def.id}: saved map crashes at frame ${crash}`); failed++; continue; }
  writeFileSync(new URL(`../maps/${def.id}.json`, import.meta.url), text);
  const c = built.counts;
  console.log(`ok   ${def.id.padEnd(13)} ${(built.frames / 40).toFixed(0).padStart(4)}s ${String(built.lines.length).padStart(5)} lines ${(text.length / 1024).toFixed(0).padStart(4)} KB  ${c.flips} flips ${c.reverses} reverses ${c.stops} stops ${c.loops} loops  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}
if (failed) process.exit(1);

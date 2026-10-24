// Run the nudge generator on several seeds and summarise.
import { Track, Simulator } from '../js/physics.js';
import { ChaosGenerator } from '../js/gen/chaos.js';
import { runSync } from '../js/gen/generator.js';
import { BIOMES } from '../js/gen/biomes.js';

const secs = +(process.argv[2] || 60);
const seeds = (process.argv[3] || '1,2,3,4,5,6').split(',').map(Number);
for (const seed of seeds) {
  const track = new Track(); const sim = new Simulator(track);
  const gen = new ChaosGenerator(track, sim, { seed, biomes: BIOMES });
  const t0 = performance.now();
  let stucks = 0, worst = 0;
  while (gen.F < secs * 40) {
    const t = performance.now();
    const ok = runSync(gen.next());
    worst = Math.max(worst, performance.now() - t);
    if (!ok) { stucks++; break; }
  }
  const ms = performance.now() - t0;
  const tally = {};
  for (const e of gen.events) if (e.label) tally[e.label.replace(/^\d+× /, 'multi ')] = (tally[e.label.replace(/^\d+× /, 'multi ')] || 0) + 1;
  const c = sim.frame(gen.F).center();
  console.log(`seed ${seed}: reached ${(gen.F / 40).toFixed(0)}s ${stucks ? 'STUCK' : 'ok   '} ${(ms / (gen.F / 40)).toFixed(0)}ms/s worst ${worst.toFixed(0)}ms  x=${c.x.toFixed(0)} drift=${gen.drift(c.x, c.y).toFixed(0)} flows=${gen.stats.flows} undos=${gen.stats.undos}  ${JSON.stringify(tally)}`);
}

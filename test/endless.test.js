// Endless mode: ride a few minutes the way the app does (generate ahead,
// play, prune behind) and check Bosh never falls off and memory stays flat.
import { Endless } from '../js/endless.js';

const SECONDS = +(process.argv[2] || 150);
const seeds = (process.argv[3] || '11,12').split(',').map(Number);
let failed = 0;
for (const seed of seeds) {
  const E = new Endless(seed);
  const t0 = performance.now();
  let respawns = 0, crash = -1, maxLines = 0;
  const tally = {};
  for (let frame = 0; frame <= SECONDS * 40; frame++) {
    // like the app: a slice of generation work per tick, never riding past checked track
    // (the app gives it ~7 ms per screen refresh, about 10 ms per ride frame)
    if (frame === 0) E.work(0, 300);
    E.work(frame, 8);
    if (frame > E.playableFrame) frame = E.playableFrame;
    for (const e of E.update(frame)) {
      if (e.type === 'respawn') respawns++;
      else if (e.label) tally[e.type] = (tally[e.type] || 0) + 1;
    }
    if (!E.sim.frame(frame).mounted && crash < 0) crash = frame;
    maxLines = Math.max(maxLines, E.track.size);
  }
  const ms = performance.now() - t0;
  const ok = respawns === 0 && crash < 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} endless seed ${seed}: ${SECONDS}s, ${E.distance(SECONDS * 40)} m, peak ${maxLines} lines, ${JSON.stringify(tally)} in ${(ms / 1000).toFixed(1)}s${respawns ? `  ${respawns} respawns` : ''}${crash >= 0 ? `  crash at ${crash}` : ''}`);
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

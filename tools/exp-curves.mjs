// Experiment: crash limits on valley (concave) and crest (convex) curves.
import { Track, Line, Simulator, makeRider, P } from '../js/physics.js';
import { Path, pathLines } from '../js/gen/path.js';

function build(path) {
  const t = new Track();
  for (const d of pathLines(path)) { const l = t.add(new Line(null, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped)); t.linkEndpoints(l); }
  return t;
}
function run(track, v, frames) {
  const sim = new Simulator(track);
  sim.frames[0] = makeRider({ x: 0, y: 0 }, { x: v, y: 0 });
  sim.frames[0].computeBounds();
  for (let f = 1; f <= frames; f++) { const s = sim.frame(f); if (!s.mounted) return f; }
  return 0;
}
console.log('VALLEY: turn up 50deg. rows=speed, cols=radius; X=crash');
const radii = [20, 30, 45, 60, 80, 110, 150, 200, 300];
console.log('v\\r  ' + radii.map((r) => String(r).padStart(4)).join(''));
for (const v of [4, 6, 8, 10, 12, 14, 16, 20]) {
  let row = String(v).padStart(3) + '  ';
  for (const r of radii) {
    const p = new Path(-40, 5, 0); p.line(40 + v * 6, 10); p.arc(r, -50 * Math.PI / 180); p.line(300);
    row += (run(build(p), v, 80) ? '   X' : '   .');
  }
  console.log(row, ' a=v^2/r limit?');
}
console.log('\nCREST: turn down 40deg then straight. X=crash');
console.log('v\\r  ' + radii.map((r) => String(r).padStart(4)).join(''));
for (const v of [4, 6, 8, 10, 12, 14, 16]) {
  let row = String(v).padStart(3) + '  ';
  for (const r of radii) {
    const p = new Path(-40, 5, 0); p.line(40 + v * 6, 10); p.arc(r, 40 * Math.PI / 180); p.line(2000);
    row += (run(build(p), v, 200) ? '   X' : '   .');
  }
  console.log(row);
}

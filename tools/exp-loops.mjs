// Experiment: loop-the-loop geometry that works with one-sided lines.
import { Track, Line, Simulator, makeRider, P } from '../js/physics.js';
import { Path, pathLines } from '../js/gen/path.js';

const G = 0.175;
function build(paths) {
  const t = new Track();
  for (const p of paths) for (const d of pathLines(p)) { const l = t.add(new Line(null, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped)); t.linkEndpoints(l); }
  return t;
}
export function loopPaths(x0, y0, v, R, opts = {}) {
  const c = opts.c ?? 10, gapExtra = opts.gapExtra ?? 0;
  const lland = Math.max(0, R - (opts.landClear ?? 40));
  const entry = new Path(x0 - 150, y0, 0); entry.line(150, 12);
  const gap = R + c - lland + gapExtra;
  const t = gap / v;
  const drop = 0.5 * G * t * t + (opts.extraDrop ?? 1.5);
  const th = Math.atan2(G * t, v);
  const bx = x0 + gap + lland, by = y0 + drop + Math.tan(th) * lland;
  const loop = new Path(x0 + gap, y0 + drop, th);
  loop.line(lland, 10);
  loop.arc(R, -(1.5 * Math.PI + loop.a), opts.seg ?? 8);
  const r2 = opts.r2 ?? Math.max(30, R * 0.8);
  const H = R + (opts.margin ?? 45) - r2;
  loop.line(H, 12);
  loop.arc(r2, -Math.PI / 2, 8);
  loop.line(600, 14);
  return { entry, loop, exitY: loop.y, bx, by };
}
function run(v, R, opts) {
  const { entry, loop, exitY } = loopPaths(0, 5, v, R, opts);
  const track = build([entry, loop]);
  const sim = new Simulator(track);
  sim.frames[0] = makeRider({ x: -120, y: 0 }, { x: v, y: 0 });
  sim.frames[0].computeBounds();
  for (let f = 1; f <= 400; f++) {
    const s = sim.frame(f);
    if (!s.mounted) return 'X';
    const c = s.center();
    if (c.x > loop.x - 300 && Math.abs(c.y - (exitY - 8)) < 20) return '.';
    if (c.y > exitY + 200) return 'F'; // fell
  }
  return '?';
}
const radii = [30, 40, 50, 60, 70, 80, 100];
console.log('v\\R ' + radii.map((r) => String(r).padStart(4)).join(''), '  (. ok, X crash, F fell, ? stuck)');
for (const v of [5, 6, 7, 8, 9, 10, 11, 12, 14, 16]) {
  let row = String(v).padStart(3) + ' ';
  for (const R of radii) row += '   ' + run(v, R);
  console.log(row);
}

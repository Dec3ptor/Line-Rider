// Experiment: sharp "pop" lips that make the rider spin.
import { Track, Line, Simulator, makeRider } from '../js/physics.js';
import { Path, pathLines, angleDiff } from '../js/gen/path.js';
import { sledInfo } from '../js/gen/generator.js';

function test(v, app, kinkDeg, kinkLen, pre) {
  const t = new Track();
  const p = new Path(-60, 5, 0); p.line(40, 10); p.turnTo(app, 200); p.line(60 + v * 3, 10);
  if (pre) p.turnTo(app - pre, Math.max(40, v * v / 2), 8);
  p.a = p.a - kinkDeg * Math.PI / 180; p.line(kinkLen, kinkLen);
  for (const d of pathLines(p)) { const l = t.add(new Line(null, d.type, d.x1, d.y1, d.x2, d.y2)); t.linkEndpoints(l); }
  const sim = new Simulator(t);
  sim.frames[0] = makeRider({ x: -40, y: 0 }, { x: v, y: 0 }); sim.frames[0].computeBounds();
  let t0 = -1;
  for (let f = 1; f < 300; f++) { const s = sim.frame(f); if (!s.mounted) return 'crash-lip'; const m = sledInfo(s); if ((m.mx - p.x) * Math.cos(p.a) + (m.my - p.y) * Math.sin(p.a) > 8) { t0 = f; break; } }
  if (t0 < 0) return 'no-takeoff';
  let rot = 0, prev = null, prevM = null, landable = [], vel0 = null;
  for (let f = t0; f < t0 + 160; f++) {
    const s = sim.frame(f); if (!s.mounted) return 'crash-air';
    const m = sledInfo(s);
    if (prev != null) rot += angleDiff(m.ang, prev); prev = m.ang;
    if (prevM) {
      const vy = m.my - prevM.my, vel = Math.atan2(vy, m.mx - prevM.mx);
      if (vel0 == null) vel0 = vel;
      const rel = rot - (vel - vel0);
      if (Math.abs(rel) > 5.3 && vy > 0.3 && vel < 1.35 && Math.abs(angleDiff(m.ang, vel)) < 0.6 && Math.abs(m.lean) < 0.9) landable.push(f - t0);
    }
    prevM = m;
  }
  return `rate ${(rot / 160 * 57.3).toFixed(1)}°/f, ${landable.length ? 'LAND @' + landable[0] + '..' + landable[landable.length - 1] : '-'}`;
}
for (const v of [8, 11, 14]) for (const app of [0.15, 0.4]) for (const kink of [25, 45, 65]) for (const len of [5, 10]) for (const pre of [0, 0.6]) {
  console.log(`v${v} app${app} kink${kink} len${len} pre${pre}:`.padEnd(38), test(v, app, kink, len, pre));
}

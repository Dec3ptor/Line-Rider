// Experiment: kickers that make the rider flip, and landings that catch him.
import { Track, Line, Simulator, makeRider, P } from '../js/physics.js';
import { Path, pathLines, angleDiff } from '../js/gen/path.js';

const STRIDE = 6;
const X = (s, i) => s.p[i * STRIDE], Y = (s, i) => s.p[i * STRIDE + 1];
function addPath(t, p) { for (const d of pathLines(p)) { const l = t.add(new Line(null, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped)); t.linkEndpoints(l); } }
function sledInfo(s) {
  const mx = (X(s, P.TAIL) + X(s, P.NOSE)) / 2, my = (Y(s, P.TAIL) + Y(s, P.NOSE)) / 2;
  const ang = Math.atan2(Y(s, P.NOSE) - Y(s, P.TAIL), X(s, P.NOSE) - X(s, P.TAIL));
  // body lean relative to the sled's "up"
  const upx = X(s, P.PEG) - X(s, P.TAIL), upy = Y(s, P.PEG) - Y(s, P.TAIL);
  const bx = X(s, P.SHOULDER) - X(s, P.BUTT), by = Y(s, P.SHOULDER) - Y(s, P.BUTT);
  const lean = Math.abs(angleDiff(Math.atan2(by, bx), Math.atan2(upy, upx)));
  return { mx, my, ang, lean };
}

function tryKicker(v, rk, lipDeg, wantFlip) {
  const track = new Track();
  const k = new Path(-60, 5, 0); k.line(60 + v * 4, 10); k.arc(rk, (lipDeg * Math.PI) / 180, 8);
  if (!wantFlip) k.line(24, 8);
  addPath(track, k);
  const sim = new Simulator(track);
  sim.frames[0] = makeRider({ x: -40, y: 0 }, { x: v, y: 0 }); sim.frames[0].computeBounds();
  // find takeoff: sled mid passes lip end
  let f0 = -1;
  for (let f = 1; f < 300; f++) {
    const s = sim.frame(f); if (!s.mounted) return { fail: 'crash-on-kicker' };
    const m = sledInfo(s);
    if ((m.mx - k.x) * Math.cos(k.a) + (m.my - k.y) * Math.sin(k.a) > 8) { f0 = f; break; }
  }
  if (f0 < 0) return { fail: 'no-takeoff' };
  let unwrapped = sledInfo(sim.frame(f0)).ang, prevAng = unwrapped, start = unwrapped;
  const cands = [];
  let prev = sledInfo(sim.frame(f0));
  for (let f = f0 + 1; f < f0 + 160; f++) {
    const s = sim.frame(f); if (!s.mounted) break;
    const m = sledInfo(s);
    unwrapped += angleDiff(m.ang, prevAng); prevAng = m.ang;
    const vx = m.mx - prev.mx, vy = m.my - prev.my; prev = m;
    const vel = Math.atan2(vy, vx);
    const rot = unwrapped - start;
    const aligned = Math.abs(angleDiff(m.ang, vel));
    if (vy > 0 && vel > 0.25 && vel < 1.25 && aligned < 0.18 && m.lean < 0.8 && f - f0 > 10) {
      if (!wantFlip || Math.abs(rot) > 5.6) cands.push({ f, rot: +(rot * 180 / Math.PI).toFixed(0), vel: +(vel * 180 / Math.PI).toFixed(0), sp: +Math.hypot(vx, vy).toFixed(1) });
    }
  }
  return { f0, cands };
}
for (const wantFlip of [false, true]) {
  console.log(wantFlip ? '\nFLIP kickers (no straight lip):' : 'NORMAL kickers (straight lip):');
  for (const v of [8, 10, 12, 14]) for (const rk of [40, 60, 90, 130]) for (const lip of [-30, -45, -60, -75]) {
    const r = tryKicker(v, rk, lip, wantFlip);
    const c = r.cands || [];
    if (wantFlip && !c.length) continue;
    console.log(`v=${v} rk=${rk} lip=${lip}`.padEnd(26), r.fail || `${c.length} landing frames`, c.length ? JSON.stringify(c[Math.floor(c.length / 2)]) : '');
  }
}

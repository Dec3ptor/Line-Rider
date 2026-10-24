// Experiment: which flight frames can be landed on if we build a ramp along the trajectory?
import { Track, Line, Simulator, makeRider, P } from '../js/physics.js';
import { Path, pathLines, angleDiff } from '../js/gen/path.js';

const STRIDE = 6;
const X = (s, i) => s.p[i * STRIDE], Y = (s, i) => s.p[i * STRIDE + 1];
function addPath(t, p) { const out = []; for (const d of pathLines(p)) { const l = t.add(new Line(null, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped)); t.linkEndpoints(l); out.push(l); } return out; }
export function sledInfo(s) {
  const mx = (X(s, P.TAIL) + X(s, P.NOSE)) / 2, my = (Y(s, P.TAIL) + Y(s, P.NOSE)) / 2;
  const ang = Math.atan2(Y(s, P.NOSE) - Y(s, P.TAIL), X(s, P.NOSE) - X(s, P.TAIL));
  const upx = X(s, P.PEG) - X(s, P.TAIL), upy = Y(s, P.PEG) - Y(s, P.TAIL);
  const bx = X(s, P.SHOULDER) - X(s, P.BUTT), by = Y(s, P.SHOULDER) - Y(s, P.BUTT);
  const lean = angleDiff(Math.atan2(by, bx), Math.atan2(upy, upx));
  return { mx, my, ang, lean };
}

function scenario(v, rk, lip, lipLen, landFrameFilter) {
  const track = new Track();
  const k = new Path(-60, 5, 0); k.line(60 + v * 4, 10); k.arc(rk, lip * Math.PI / 180, 8); k.line(lipLen, 8);
  addPath(track, k);
  const sim = new Simulator(track);
  sim.frames[0] = makeRider({ x: -40, y: 0 }, { x: v, y: 0 }); sim.frames[0].computeBounds();
  let f0 = -1;
  for (let f = 1; f < 300; f++) {
    const m = sledInfo(sim.frame(f));
    if ((m.mx - k.x) * Math.cos(k.a) + (m.my - k.y) * Math.sin(k.a) > 10) { f0 = f; break; }
  }
  const flight = [];
  for (let f = f0; f < f0 + 140; f++) flight.push({ f, s: sim.frame(f).clone(), ...sledInfo(sim.frame(f)) });
  const rows = [];
  for (let i = 12; i < flight.length - 1; i += 4) {
    const a = flight[i - 1], b = flight[i];
    const vx = b.mx - a.mx, vy = b.my - a.my;
    if (vy <= 0) continue;
    const vel = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
    if (vel < 0.2 || vel > 1.3) continue;
    // build landing ramp
    const pts = [];
    for (let j = Math.max(1, i - 8); j <= i; j++) {
      const p = flight[j], q = flight[j - 1];
      const dx = p.mx - q.mx, dy = p.my - q.my, l = Math.hypot(dx, dy) || 1;
      pts.push([p.mx - dy / l * 1.0, p.my + dx / l * 1.0]);
    }
    const land = new Path(pts[0][0], pts[0][1], vel);
    land.through(pts.slice(1), vel);
    const r = Math.max(60, sp * sp / 2);
    land.turnTo(0.3, r);
    land.line(1500, 14);
    const added = addPath(track, land);
    let ok = true;
    for (let f = b.f; f < b.f + 70; f++) { if (!sim.frame(f).mounted) { ok = false; break; } }
    const after = sim.frame(b.f + 70).center();
    if (after.y > land.y + 200) ok = false;
    rows.push(`${ok ? 'OK ' : 'crash'} t=${String(i).padStart(3)} vel=${(vel * 57.3).toFixed(0).padStart(3)} sled=${(b.ang * 57.3).toFixed(0).padStart(4)} misalign=${(angleDiff(b.ang, vel) * 57.3).toFixed(0).padStart(4)} lean=${(b.lean * 57.3).toFixed(0).padStart(4)} speed=${sp.toFixed(1)}`);
    for (const l of added) track.remove(l);
  }
  return rows;
}
if (process.argv[1].endsWith("exp-landing.mjs")) for (const [v, rk, lip, lipLen] of [[10, 90, -30, 24], [12, 120, -25, 30], [8, 60, -20, 20], [14, 150, -35, 30]]) {
  console.log(`\nkicker v=${v} rk=${rk} lip=${lip} lipLen=${lipLen}`);
  for (const r of scenario(v, rk, lip, lipLen)) console.log(' ', r);
}

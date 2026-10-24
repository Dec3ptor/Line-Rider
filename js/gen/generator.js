// Procedural track generator.
//
// Track is built one "piece" at a time (a slope, a jump, a loop...). Every piece
// is test-ridden with the real physics before it is kept: if Bosh would crash,
// fall off or get stuck, the piece is thrown away and a different one is tried.
// Jump landings are laid along Bosh's actual flight path, which makes them smooth.
//
// The work is written as generator functions that yield now and then, so the
// app can spread generation over several animation frames without stutter.

import { Line, LineType, P } from '../physics.js';
import { Path, pathLines, angleDiff, makeRng } from './path.js';

const G = 0.175;
const STRIDE = 6;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function sledInfo(s) {
  const p = s.p;
  const tx = p[P.TAIL * STRIDE], ty = p[P.TAIL * STRIDE + 1];
  const nx = p[P.NOSE * STRIDE], ny = p[P.NOSE * STRIDE + 1];
  const upx = p[P.PEG * STRIDE] - tx, upy = p[P.PEG * STRIDE + 1] - ty;
  const bx = p[P.SHOULDER * STRIDE] - p[P.BUTT * STRIDE], by = p[P.SHOULDER * STRIDE + 1] - p[P.BUTT * STRIDE + 1];
  return {
    mx: (tx + nx) / 2,
    my: (ty + ny) / 2,
    ang: Math.atan2(ny - ty, nx - tx),
    lean: angleDiff(Math.atan2(by, bx), Math.atan2(upy, upx)),
  };
}

export function speedOf(s) {
  const v = s.velocity();
  return Math.hypot(v.x, v.y);
}

function alongFrom(s, pt) {
  const m = sledInfo(s);
  return (m.mx - pt.x) * Math.cos(pt.a) + (m.my - pt.y) * Math.sin(pt.a);
}

export const PIECE_KINDS = ['cruise', 'rollers', 'kicker', 'drop', 'flip', 'gaps', 'steps', 'loop', 'booster', 'brake'];

export class Generator {
  constructor(track, sim, opts = {}) {
    this.track = track;
    this.sim = sim;
    this.seed = opts.seed ?? 1;
    this.rng = makeRng(this.seed);
    this.biomes = opts.biomes || [];
    this.decorate = opts.decorate || null;
    this.fixedBiome = opts.biome || null;
    this.pending = [];
    this.pieces = [];
    this.events = [];
    this.anchor = null;
    this.biome = null;
    this.biomeLeft = 0;
    this.lastKinds = [];
    this.distanceSign = 0;
    this.stats = {};
    this.isMap = !!opts.map;
    if (opts.biome) this.setBiome(opts.biome);
  }

  // Switch to a given area (used by scripted maps).
  setBiome(biome) {
    this.biome = biome;
    this.biomeLeft = Infinity;
    this.biomeStartPending = true;
  }

  // ---------------------------------------------------------------- lines

  addLineData(d) {
    const l = new Line(null, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped);
    if (d.style) l.style = d.style;
    this.track.add(l);
    if (l.collidable) this.track.linkEndpoints(l);
    this.pending.push(l);
    return l;
  }

  addPath(path) {
    if (path.added) return;
    path.added = true;
    for (const d of pathLines(path)) this.addLineData(d);
  }

  rollbackTo(n) {
    while (this.pending.length > n) this.track.remove(this.pending.pop());
  }

  pendingMaxY() {
    let y = -Infinity;
    for (const l of this.pending) if (l.maxY > y) y = l.maxY;
    return y;
  }

  // ---------------------------------------------------------------- riding

  // Simulate from frame `from` until the sled passes `exit` (a point on the
  // track plus heading). Succeeds only if Bosh arrives mounted, on the line,
  // upright, steady and at a sensible speed.
  *ride(from, exit, opts = {}) {
    const sim = this.sim;
    const maxFrames = opts.maxFrames ?? 900;
    const dx = Math.cos(exit.a), dy = Math.sin(exit.a);
    const fallY = this.pendingMaxY() + 400;
    let best = -Infinity, bestF = from;
    for (let f = from + 1; f <= from + maxFrames; f++) {
      if ((f - from) % 30 === 0) yield;
      const s = sim.frame(f);
      if (!s.mounted) return { ok: false, why: 'crash', frame: f };
      const m = sledInfo(s);
      const ox = m.mx - exit.x, oy = m.my - exit.y;
      const along = ox * dx + oy * dy;
      if (along >= 0) {
        const perp = -ox * dy + oy * dx;
        const v = speedOf(s);
        if (perp < -8 || perp > 4) return { ok: false, why: 'off line', frame: f };
        if (v < (opts.minSpeed ?? 2.5) || v > (opts.maxSpeed ?? 20)) return { ok: false, why: 'speed', frame: f, speed: v };
        // Bosh should be upright and settled, not still swinging from a landing.
        // If not yet, give him the rest of the run-out to calm down.
        let why = null;
        if (Math.abs(angleDiff(m.ang, exit.a)) > 0.35) why = 'tilted';
        else if (Math.abs(m.lean) > 0.75) why = 'leaning';
        else if (Math.abs(angleDiff(m.ang, sledInfo(sim.frame(f - 3)).ang)) > 0.12) why = 'wobbly';
        else {
          for (let k = 1; k <= 8; k++) {
            if (Math.abs(sledInfo(sim.frame(f - k)).lean) > 0.5) { why = 'unsettled'; break; }
          }
        }
        if (!why) return { ok: true, frame: f, speed: v };
        if (along > (exit.slack ?? 0)) return { ok: false, why, frame: f };
        continue;
      }
      if (along > best + 2) { best = along; bestF = f; }
      if (f - bestF > 150) return { ok: false, why: 'stuck', frame: f };
      if (m.my > fallY) return { ok: false, why: 'fell', frame: f };
    }
    return { ok: false, why: 'timeout' };
  }

  *until(from, pred, maxFrames = 600) {
    for (let f = from + 1; f <= from + maxFrames; f++) {
      if ((f - from) % 30 === 0) yield;
      const s = this.sim.frame(f);
      if (!s.mounted) return null;
      if (pred(s, f)) return f;
    }
    return null;
  }

  estSpeed(a, y) {
    return Math.sqrt(Math.max(1, a.speed * a.speed + 2 * G * (y - a.y)));
  }

  // Bend the path to a new heading with a radius Bosh can handle at speed v.
  turn(p, target, v, crest = 7.5) {
    p.a = normAngle(p.a);
    const d = angleDiff(target, p.a);
    if (Math.abs(d) < 0.01) return;
    const r = d < 0 ? clamp((v * v) / 1.6, 35, 700) : clamp(crest * v * v, 120, 5000);
    p.arc(r, d);
  }

  // Add the run-out, then test-ride the whole piece.
  *finish(paths, a, opts = {}) {
    const last = paths[paths.length - 1];
    last.a = normAngle(last.a);
    const v = this.estSpeed(a, last.y);
    const run = opts.run ?? clamp(v * 9, 70, 220);
    const from = last.end;
    last.line(run, 14);
    const k = run * 0.4;
    const exit = { x: from.x + Math.cos(last.a) * k, y: from.y + Math.sin(last.a) * k, a: last.a, slack: run * 0.35 };
    for (const p of paths) this.addPath(p);
    const res = yield* this.ride(a.frame, exit, opts);
    if (!res.ok) return res;
    return { ...res, end: last.end, exit, paths };
  }

  // ---------------------------------------------------------------- pieces

  // Start ramp under the rider. `from` lets endless mode restart somewhere new.
  *start(from = { x: this.track.start.x, y: this.track.start.y, frame: 0 }) {
    const a = { x: from.x - 30, y: from.y + 9, a: 0.3, frame: from.frame, speed: 0.4 };
    for (let attempt = 0; attempt < 6; attempt++) {
      const mark = this.pending.length;
      const p = new Path(a.x, a.y, a.a);
      p.line(50, 12);
      p.turnTo(0.5, 260);
      p.line(120 + attempt * 30, 14);
      this.turn(p, 0.3, 8);
      const res = yield* this.finish([p], a, { minSpeed: 1, run: 120 });
      if (res.ok) {
        this.commit('start', res, a, { paths: [p], startArch: this.isMap });
        return true;
      }
      this.rollbackTo(mark);
    }
    return false;
  }

  *cruise(a, rng, safe) {
    const v = a.speed;
    const p = new Path(a.x, a.y, a.a);
    let target;
    if (safe) target = v < 8 ? 0.35 : v > 14 ? -0.25 : 0.15;
    else if (v < 5) target = rng.range(0.4, 0.62);
    else if (v > 15) target = rng.range(-0.08, 0.12);
    else target = rng.range(0.12, 0.45);
    this.turn(p, target, v);
    p.line(rng.range(80, 220));
    if (!safe && rng.chance(0.55)) {
      this.turn(p, clamp(target + rng.range(-0.25, 0.25), -0.1, 0.65), this.estSpeed(a, p.y));
      p.line(rng.range(60, 160));
    }
    return yield* this.finish([p], a);
  }

  *rollers(a, rng) {
    const p = new Path(a.x, a.y, a.a);
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      this.turn(p, rng.range(-0.22, 0.05), this.estSpeed(a, p.y));
      p.line(rng.range(5, 35));
      this.turn(p, rng.range(0.25, 0.5), this.estSpeed(a, p.y), rng.range(6.5, 9));
      p.line(rng.range(20, 70));
    }
    return yield* this.finish([p], a);
  }

  // kicker / flip / drop / gap: ramp (or edge), flight, landing on the flight path
  *jump(a, rng, mode) {
    const p = new Path(a.x, a.y, a.a);
    let v = a.speed;
    const kind = mode.kind;
    if (kind === 'kicker') {
      this.turn(p, rng.range(0.05, 0.3), v);
      p.line(rng.range(30, 80));
      v = this.estSpeed(a, p.y);
      p.turnTo(rng.range(-0.75, -0.15), clamp((v * v) / rng.range(1.0, 1.8), 45, 260), 8);
      p.line(rng.range(16, 30), 8);
    } else if (kind === 'flip') {
      // a sharp kink at the lip pops the sled into a spin
      this.turn(p, rng.range(0.1, 0.4), v);
      p.line(rng.range(30, 70));
      v = this.estSpeed(a, p.y);
      if (rng.chance(0.65)) p.turnTo(p.a - rng.range(0.3, 0.8), Math.max(40, (v * v) / 2), 8);
      p.a -= rng.range(0.4, 1.15);
      p.line(rng.range(4, 10), 10);
    } else if (kind === 'drop') {
      this.turn(p, rng.range(-0.05, 0.22), v);
      p.line(rng.range(40, 110));
    } else {
      this.turn(p, rng.range(0.1, 0.4), v);
      p.line(rng.range(25, 60));
    }
    this.addPath(p);
    const lip = p.end;
    const takeoff = yield* this.until(a.frame, (s) => alongFrom(s, lip) > 6, 700);
    if (takeoff == null) return { ok: false, why: 'no takeoff' };

    // record the free flight
    const flight = [];
    const maxFlight = kind === 'flip' ? 190 : kind === 'gap' ? 40 : 150;
    let rot = 0, prevAng = null, vel0 = null;
    for (let f = takeoff; f < takeoff + maxFlight; f++) {
      if ((f - takeoff) % 30 === 0) yield;
      const s = this.sim.frame(f);
      if (!s.mounted) break;
      const m = sledInfo(s);
      if (prevAng != null) rot += angleDiff(m.ang, prevAng);
      prevAng = m.ang;
      flight.push({ f, mx: m.mx, my: m.my, ang: m.ang, lean: m.lean, rot });
    }

    // landing spots worth trying
    const minAir = mode.minAir ?? 12;
    const target = mode.airTarget ?? rng.range(20, 70);
    const cands = [];
    for (let i = Math.max(minAir, 9); i < flight.length; i++) {
      const c = flight[i], b = flight[i - 1];
      const vx = c.mx - b.mx, vy = c.my - b.my;
      if (vy <= 0.3) continue;
      const vel = Math.atan2(vy, vx);
      if (vel0 == null) vel0 = Math.atan2(flight[1].my - flight[0].my, flight[1].mx - flight[0].mx);
      if (vel < 0.12 || vel > 1.35) continue;
      const sp = Math.hypot(vx, vy);
      if (sp > 25) continue;
      const mis = Math.abs(angleDiff(c.ang, vel));
      if (mis > 0.75 || Math.abs(c.lean) > 0.9) continue;
      // spin relative to the direction of travel
      const rel = c.rot - (vel - vel0);
      const turns = Math.abs(rel) / TAU;
      if (kind === 'flip' && turns < 0.85) continue;
      if (kind !== 'flip' && turns > 0.4) continue;
      const score = mis * 3 + Math.abs(i - target) / 25 + Math.max(0, sp - 17) * 0.3
        + (kind === 'flip' ? Math.abs(turns - Math.round(turns)) * 4 : 0);
      cands.push({ i, vel, sp, score, rot: rel, spin: c.rot - b.rot });
    }
    cands.sort((x, y) => x.score - y.score);

    const tried = [];
    for (const c of cands) {
      if (tried.length >= (mode.tries ?? 4)) break;
      if (tried.some((t) => Math.abs(t - c.i) < 4)) continue;
      tried.push(c.i);
      const mark = this.pending.length;
      const land = this.landingPath(flight, c, rng, mode);
      const res = yield* this.finish([land], a, {
        run: mode.run ?? (kind === 'flip' ? clamp(c.sp * 14, 120, 300) : undefined),
        maxFrames: takeoff - a.frame + c.i + 400, maxSpeed: 21,
      });
      if (res.ok) {
        return {
          ...res, paths: [p, land], kick: p, land,
          takeoff, air: c.i, landFrame: takeoff + c.i, rot: c.rot,
          lip, touch: { x: flight[c.i].mx, y: flight[c.i].my },
        };
      }
      this.rollbackTo(mark);
    }
    return { ok: false, why: cands.length ? 'landing failed' : 'no landing spot' };
  }

  landingPath(flight, c, rng, mode) {
    const pts = [];
    for (let j = Math.max(1, c.i - 8); j <= c.i; j++) {
      const q = flight[j], b = flight[j - 1];
      const dx = q.mx - b.mx, dy = q.my - b.my, l = Math.hypot(dx, dy) || 1;
      pts.push([q.mx - (dy / l) * 1.0, q.my + (dx / l) * 1.0]);
    }
    const path = new Path(pts[0][0], pts[0][1], c.vel);
    path.through(pts.slice(1), c.vel);
    const exitA = mode.exitA ?? rng.range(0.12, 0.45);
    let r = clamp((c.sp * c.sp) / rng.range(1.4, 2.0), 50, 700);
    // match a backflip's spin so the ground turns with the rider
    if (mode.kind === 'flip' && c.spin < -0.02) r = clamp(c.sp / -c.spin, 45, 700);
    path.turnTo(exitA, r, 8);
    return path;
  }

  *chain(a, rng, n, mode) {
    let anchor = a;
    let res = null;
    const parts = [];
    for (let k = 0; k < n; k++) {
      res = yield* this.jump(anchor, rng, typeof mode === 'function' ? mode(k) : mode);
      if (!res.ok) return res;
      parts.push(res);
      anchor = { x: res.end.x, y: res.end.y, a: normAngle(res.end.a), frame: res.frame, speed: res.speed };
    }
    return { ...res, parts, paths: parts.flatMap((r) => r.paths) };
  }

  *gaps(a, rng) {
    const n = rng.int(2, 4);
    return yield* this.chain(a, rng, n, (k) => ({
      kind: 'gap', minAir: 7, airTarget: rng.range(9, 18), exitA: rng.range(0.15, 0.4),
      run: k === n - 1 ? undefined : Math.max(rng.range(40, 80), a.speed * 5),
    }));
  }

  *steps(a, rng) {
    const n = rng.int(2, 3);
    return yield* this.chain(a, rng, n, (k) => ({
      kind: 'drop', minAir: 10, airTarget: rng.range(14, 28), exitA: rng.range(0.03, 0.15),
      run: k === n - 1 ? undefined : Math.max(rng.range(50, 90), a.speed * 6),
    }));
  }

  // last resort: carry straight on
  *straight(a) {
    const p = new Path(a.x, a.y, a.a);
    p.line(80, 14);
    return yield* this.finish([p], a, { run: 160 });
  }

  // Spiral loop: jump a small gap into the loop, go round, then drop out
  // through the gap underneath the way in. One-sided lines make this work.
  *loop(a, rng) {
    let v = a.speed;
    const entry = new Path(a.x, a.y, a.a);
    this.turn(entry, 0, v);
    entry.line(rng.range(40, 90), 12);
    const paths = [entry];
    const count = v > 10.5 && rng.chance(0.3) ? 2 : 1;
    let cur = entry;
    const loops = [];
    for (let k = 0; k < count; k++) {
      v = this.estSpeed(a, cur.y);
      const R = clamp(v * rng.range(5.2, 6.4), 40, 85);
      const lland = Math.max(0, R - 40);
      const gap = R + 10 - lland;
      const t = gap / v;
      const drop = 0.5 * G * t * t + 1.5;
      const th = Math.atan2(G * t, v);
      const e = cur.end;
      const L = new Path(e.x + gap, e.y + drop, th);
      L.line(lland, 10);
      const startA = L.a;
      const bottom = L.end;
      L.arc(R, -(1.5 * Math.PI + startA), 8);
      const r2 = Math.max(30, R * 0.8);
      L.line(R + 45 - r2, 12);
      L.arc(r2, -Math.PI / 2, 8);
      L.a = 0;
      L.line(rng.range(60, 110), 14);
      loops.push({ cx: bottom.x + Math.sin(startA) * R, cy: bottom.y - Math.cos(startA) * R, R });
      paths.push(L);
      cur = L;
    }
    const res = yield* this.finish(paths, a, { maxSpeed: 21 });
    return res.ok ? { ...res, loops } : res;
  }

  *booster(a, rng) {
    const p = new Path(a.x, a.y, a.a);
    this.turn(p, rng.range(-0.04, 0.12), a.speed);
    p.line(20);
    const v = this.estSpeed(a, p.y);
    const target = rng.range(9.5, 12.5);
    const len = clamp((target * target - v * v) / (2 * 0.17), 60, 500);
    p.mark(LineType.ACCEL, (q) => q.line(len, 14));
    return yield* this.finish([p], a);
  }

  *brake(a, rng) {
    const p = new Path(a.x, a.y, a.a);
    const slope = rng.range(0.03, 0.12);
    this.turn(p, slope, a.speed);
    p.line(30);
    const v = this.estSpeed(a, p.y);
    const target = rng.range(8.5, 11);
    // measured: a brake strip removes about 0.19 of v^2/2 per unit; the slope gives some back
    const net = 0.19 - G * Math.sin(slope);
    const len = clamp((v * v - target * target) / (2 * net), 40, 2000);
    p.mark('brake', (q) => q.line(len, 14));
    return yield* this.finish([p], a, { maxSpeed: Math.max(19, v - 2) });
  }

  // End of a map: brake to a gentle speed, ride under the finish arch and cruise on.
  *finishLine(a, rng) {
    const p = new Path(a.x, a.y, a.a);
    const slope = 0.05;
    this.turn(p, slope, a.speed);
    p.line(40);
    const v = this.estSpeed(a, p.y);
    if (v > 4.5) {
      const len = (v * v - 16) / (2 * (0.19 - G * Math.sin(slope)));
      p.mark('brake', (q) => q.line(len, 14));
    }
    this.turn(p, 0.01, 4);
    p.line(80, 14);
    const finishAt = p.end;
    p.line(2400, 20);
    this.addPath(p);
    const exit = { x: finishAt.x + 140, y: finishAt.y + Math.sin(finishAt.a) * 140, a: finishAt.a };
    const res = yield* this.ride(a.frame, exit, { minSpeed: 1.5 });
    if (!res.ok) return res;
    return { ...res, end: p.end, exit, paths: [p], finishAt };
  }

  // ---------------------------------------------------------------- choosing

  chooseKind(rng, attempt) {
    const v = this.anchor.speed;
    const w = { cruise: 2, rollers: 2, kicker: 3, drop: 2, flip: 2.5, gaps: 1.4, steps: 1, loop: 1.4, booster: 0, brake: 0 };
    const bw = this.biome?.weights;
    if (bw) for (const k in bw) w[k] = bw[k];
    if (v < 6) { w.booster += 5; w.flip = 0; w.loop = 0; w.gaps *= 0.3; }
    if (v < 8.5) { w.loop = 0; w.flip *= 0.3; w.booster += 1; }
    if (v > 15) { w.brake += 4; w.drop *= 0.2; w.flip *= 0.3; w.steps *= 0.3; }
    if (v > 17) { w.loop = 0; w.brake += 8; w.flip = 0; w.drop = 0; w.kicker *= 0.3; }
    for (const k of this.lastKinds) if (k in w) w[k] *= 0.35;
    if (attempt >= 3) { w.cruise += 4; w.flip *= 0.3; w.loop *= 0.5; }
    return rng.weighted(Object.entries(w));
  }

  // flips are fussy: give them a few goes with different shapes
  *retry(n, rng, make) {
    let res = null;
    for (let i = 0; i < n; i++) {
      const mark = this.pending.length;
      res = yield* make(rng.fork());
      if (res.ok) return res;
      this.rollbackTo(mark);
    }
    return res;
  }

  build(kind, a, rng, safe) {
    switch (kind) {
      case 'cruise': return this.cruise(a, rng, safe);
      case 'rollers': return this.rollers(a, rng);
      case 'kicker': return this.jump(a, rng, { kind: 'kicker' });
      case 'drop': return this.jump(a, rng, { kind: 'drop', minAir: 16, airTarget: rng.range(30, 90) });
      case 'flip': return this.retry(3, rng, (r) => this.jump(a, r, { kind: 'flip', minAir: 18, airTarget: r.range(35, 90), tries: 4 }));
      case 'gaps': return this.gaps(a, rng);
      case 'steps': return this.steps(a, rng);
      case 'loop': return this.loop(a, rng);
      case 'booster': return this.booster(a, rng);
      case 'brake': return this.brake(a, rng);
      case 'finish': return this.finishLine(a, rng);
      case 'straight': return this.straight(a);
      default: return this.cruise(a, rng);
    }
  }

  // Generate and keep one new piece. Returns the piece, or null if nothing worked.
  *next(force, forceTries = 4) {
    if (!this.fixedBiome && this.biomeLeft <= 0 && this.biomes.length) this.switchBiome();
    if (!this.anchor) {
      const ok = yield* this.start(this.restartFrom || undefined);
      this.restartFrom = null;
      return ok ? this.pieces[this.pieces.length - 1] : null;
    }
    const a = this.anchor;
    const total = Math.max(10, forceTries + 4);
    for (let attempt = 0; attempt < total; attempt++) {
      const rng = this.rng.fork();
      const left = total - attempt;
      const kind = left <= 2 ? (left === 1 ? 'straight' : 'cruise')
        : force && attempt < forceTries ? force
        : this.chooseKind(rng, attempt);
      const safe = left <= 3;
      const mark = this.pending.length;
      const res = yield* this.build(kind, a, rng, safe);
      const st = (this.stats[kind] ||= { ok: 0, fail: {} });
      if (res && res.ok) st.ok++;
      else st.fail[res?.why || '?'] = (st.fail[res?.why || '?'] || 0) + 1;
      if (res && res.ok) {
        this.biomeLeft--;
        return this.commit(kind, res, a, res);
      }
      this.rollbackTo(mark);
      yield;
    }
    return null;
  }

  switchBiome() {
    const choices = this.biomes.filter((b) => b !== this.biome);
    this.biome = this.rng.pick(choices.length ? choices : this.biomes);
    this.biomeLeft = this.rng.int(7, 11);
    this.biomeStartPending = true;
  }

  commit(kind, res, a, info) {
    const lines = this.pending;
    this.pending = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of lines) {
      x0 = Math.min(x0, l.minX); y0 = Math.min(y0, l.minY);
      x1 = Math.max(x1, l.maxX); y1 = Math.max(y1, l.maxY);
    }
    const piece = {
      kind, lines, scenery: [],
      startFrame: a.frame, endFrame: res.frame,
      start: { x: a.x, y: a.y }, end: res.end,
      bbox: { x0, y0, x1, y1 },
      info,
      biome: this.fixedBiome || this.biome,
      newBiome: !!this.biomeStartPending,
    };
    this.biomeStartPending = false;
    this.pieces.push(piece);
    this.anchor = { x: res.end.x, y: res.end.y, a: normAngle(res.end.a), frame: res.frame, speed: res.speed };
    this.lastKinds.push(kind);
    if (this.lastKinds.length > 2) this.lastKinds.shift();
    this.recordEvents(piece);
    if (this.decorate) {
      const data = this.decorate(this, piece, makeRng((this.seed * 7919 + this.pieces.length * 104729) >>> 0));
      for (const d of data) piece.scenery.push(this.addLineData(d));
      this.pending = [];
    }
    return piece;
  }

  recordEvents(piece) {
    const ev = this.events;
    const info = piece.info;
    if (piece.newBiome && piece.biome) ev.push({ frame: piece.startFrame, type: 'biome', name: piece.biome.name, biome: piece.biome });
    const jumps = info.parts || (info.takeoff != null ? [info] : []);
    for (const j of jumps) {
      ev.push({ frame: j.takeoff, type: 'air', air: j.air });
      const turns = Math.round(Math.abs(j.rot || 0) / TAU);
      if (piece.kind === 'flip' && turns >= 1) {
        const name = j.rot < 0 ? 'Backflip' : 'Frontflip';
        ev.push({ frame: j.landFrame, type: 'flip', label: turns > 1 ? `${turns}× ${name}!` : `${name}!` });
      }
    }
    if (info.loops) {
      ev.push({ frame: piece.startFrame + 10, type: 'loop', label: info.loops.length > 1 ? 'Double loop!' : 'Loop!', count: info.loops.length });
    }
    ev.sort((x, y) => x.frame - y.frame);
  }

  // Remove pieces the rider finished long ago (endless mode).
  pruneBefore(frame) {
    let n = 0;
    while (this.pieces.length > 3 && this.pieces[0].endFrame < frame) {
      if (this.pieces[0].lines.some((l) => this.sim.touches(l))) break;
      const piece = this.pieces.shift();
      for (const l of piece.lines) this.track.remove(l);
      for (const l of piece.scenery) this.track.remove(l);
      n++;
    }
    while (this.events.length && this.events[0].frame < frame - 200) this.events.shift();
    return n;
  }

  get verifiedFrame() { return this.anchor ? this.anchor.frame : 0; }
}

// Run a generator function to completion (for tests and map building).
export function runSync(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

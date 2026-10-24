// "Nudge" track generator.
//
// Instead of laying a continuous track, this follows Bosh's natural motion
// and keeps inserting small pieces of track right where he is about to be:
// ramps at odd angles, tiny taps under the nose or tail that spin him, walls,
// curves that throw him straight up so he stops and falls back, boost and
// brake strips. Each candidate is test-ridden about a second ahead and scored
// for flips, reversals, stops and redirects; one of the best is kept.
//
// A candidate is only allowed if it leaves everything Bosh has already done
// exactly as it was, so the final track rides the same from the start.
// When it runs into a dead end it backs up a few steps and tries again.
// Now and then it lays a smooth "flow" section (loop, kicker, ...) for pacing.

import { Line, LineType, P, makeRider } from '../physics.js';
import { Path, pathLines, angleDiff, makeRng, snap } from './path.js';
import { Generator, sledInfo, speedOf } from './generator.js';
import { dressChunk } from './dress.js';

const STRIDE = 6;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

// the world slowly drifts down and to the right
export const GUIDE = 0.22;
const GX = Math.cos(GUIDE), GY = Math.sin(GUIDE);
const SCHEDULE = 3.4;     // expected progress along the guide, units per frame
const HORIZON = 36;       // frames each candidate is test-ridden for

// sled geometry for a state: mid point of the runners, along/down vectors, velocity
function sledFrame(s) {
  const p = s.p;
  const T = P.TAIL * STRIDE, N = P.NOSE * STRIDE, G = P.PEG * STRIDE;
  const tx = p[T], ty = p[T + 1], nx = p[N], ny = p[N + 1];
  let dx = nx - tx, dy = ny - ty;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  let ux = tx - p[G], uy = ty - p[G + 1];
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const vx = (p[T] - p[T + 2] + p[N] - p[N + 2]) / 2;
  const vy = (p[T + 1] - p[T + 3] + p[N + 1] - p[N + 3]) / 2;
  return { mx: (tx + nx) / 2, my: (ty + ny) / 2, tx, ty, nx, ny, dx, dy, ux, uy, vx, vy, ang: Math.atan2(dy, dx) };
}

function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

// A line through point (px, py) along direction (dx, dy) whose solid side faces
// along (ux, uy) (the side the rider must not pass through).
function lineAcross(px, py, dx, dy, len, frac, ux, uy, type = LineType.NORMAL) {
  const x1 = r2(px - dx * len * frac), y1 = r2(py - dy * len * frac);
  const x2 = r2(px + dx * len * (1 - frac)), y2 = r2(py + dy * len * (1 - frac));
  // unflipped solid side is (-dy, dx)
  const flipped = (-dy * ux + dx * uy) < 0;
  return { type, x1, y1, x2, y2, flipped };
}

// ---------------------------------------------------------------------------
// Trick detection for the HUD (fed one frame at a time, in order)

export class TrickTracker {
  constructor() {
    this.prevAng = null;
    this.airRot = 0;
    this.air = 0;
    this.vxSign = 0;
    this.lastRev = -1e9;
    this.lastStop = -1e9;
    this.lastInv = -1e9;
    this.stopped = false;
  }
  clone() { return Object.assign(new TrickTracker(), this); }
  feed(f, s, out) {
    if (!s.mounted) return;
    const m = sledFrame(s);
    const contact = s.contacts > 0;
    if (this.prevAng != null && !contact) this.airRot += angleDiff(m.ang, this.prevAng);
    this.prevAng = m.ang;
    if (contact) {
      const turns = Math.abs(this.airRot) / TAU;
      if (turns > 0.82) {
        const n = Math.max(1, Math.round(turns));
        const name = this.airRot < 0 ? 'Backflip' : 'Frontflip';
        out.push({ frame: f, type: 'flip', count: n, label: n > 1 ? `${n}× ${name}!` : `${name}!` });
      }
      if (this.air >= 45) out.push({ frame: f - this.air, type: 'air', air: this.air });
      this.airRot = 0;
      this.air = 0;
      // riding on the underside of something
      if (m.uy < -0.75 && f - this.lastInv > 80) {
        this.lastInv = f;
        out.push({ frame: f, type: 'trick', label: 'Upside down!' });
      }
    } else {
      this.air++;
    }
    const v = s.velocity();
    if (Math.abs(v.x) > 1.6) {
      const sign = Math.sign(v.x);
      if (this.vxSign && sign !== this.vxSign && f - this.lastRev > 35) {
        this.lastRev = f;
        out.push({ frame: f, type: 'reverse', label: sign < 0 ? 'Reverse!' : 'And back again!' });
      }
      this.vxSign = sign;
    }
    const sp = Math.hypot(v.x, v.y);
    if (sp < 0.7 && !this.stopped && f - this.lastStop > 50) {
      this.stopped = true;
      this.lastStop = f;
      out.push({ frame: f, type: 'stop', label: 'Dead stop!' });
    }
    if (sp > 2.5) this.stopped = false;
  }
}

// ---------------------------------------------------------------------------
// Where the rider has been (for keeping scenery out of the way)

export class PathIndex {
  constructor(cell = 16) { this.cell = cell; this.cells = new Map(); this.last = new Map(); this.log = []; }
  key(cx, cy) { return cx * 67108864 + cy; }
  add(x, y, frame = 0, vx = 0, vy = 0) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let a = this.cells.get(k);
    if (!a) this.cells.set(k, (a = []));
    a.push(x, y, vx, vy);
    this.last.set(k, frame);
    this.log.push(frame, k);
  }
  // forget cells the rider last visited before `frame` (endless mode housekeeping)
  pruneBefore(frame) {
    for (const [k, f] of this.last) {
      if (f < frame) { this.cells.delete(k); this.last.delete(k); }
    }
  }
  // forget points recorded after `frame` (used when the generator backs up)
  rewind(frame) {
    const log = this.log;
    while (log.length && log[log.length - 2] > frame) {
      const k = log.pop();
      log.pop();
      const a = this.cells.get(k);
      if (a) { a.length -= 4; if (!a.length) this.cells.delete(k); }
    }
  }
  // the undo log only needs recent entries
  trimLog(beforeFrame) {
    let i = 0;
    while (i < this.log.length && this.log[i] < beforeFrame) i += 2;
    if (i > 2000) this.log.splice(0, i);
  }
  // is any recorded rider point within r of (x, y)?
  near(x, y, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const rr = r * r;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.cells.get(this.key(cx, cy));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 4) {
          const dx = a[i] - x, dy = a[i + 1] - y;
          if (dx * dx + dy * dy < rr) return true;
        }
      }
    }
    return false;
  }
  // call fn(x, y) for recorded points in a box; stop early if fn returns true
  forEachNear(x0, y0, x1, y1, fn) {
    const c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const a = this.cells.get(this.key(cx, cy));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 4) if (fn(a[i], a[i + 1], a[i + 2], a[i + 3])) return;
      }
    }
  }

}

const TRACE = [P.TAIL, P.NOSE, P.PEG, P.STRING, P.BUTT, P.SHOULDER, P.LHAND, P.LFOOT];
const LAG = 30;     // the last LAG frames are checked exactly instead

// Could this line have pushed any point the rider already passed through?
// Only points inside the line's collision zone (just on its solid side) count.
export function lineHitsPath(path, d) {
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
  const len = Math.hypot(dx, dy) || 1;
  const f = d.flipped ? -1 : 1;
  const nx = (-dy / len) * f, ny = (dx / len) * f;
  const ext = 12;
  let hit = false;
  path.forEachNear(Math.min(d.x1, d.x2) - 14, Math.min(d.y1, d.y2) - 14, Math.max(d.x1, d.x2) + 14, Math.max(d.y1, d.y2) + 14, (x, y, vx, vy) => {
    const ox = x - d.x1, oy = y - d.y1;
    const along = (ox * dx + oy * dy) / len;
    if (along < -ext || along > len + ext) return false;
    const perp = ox * nx + oy * ny;
    // a point only gets pushed if it is moving into the line
    if (perp > -1.5 && perp < 12 && vx * nx + vy * ny > 0.05) { hit = true; return true; }
    return false;
  });
  return hit;
}

// ---------------------------------------------------------------------------

export class ChaosGenerator {
  constructor(track, sim, opts = {}) {
    this.track = track;
    this.sim = sim;
    this.seed = opts.seed ?? 1;
    this.rng = makeRng(this.seed);
    this.biomes = opts.biomes || [];
    this.biome = opts.biome || null;
    this.fixedBiome = !!opts.biome;
    this.fixedLevel = opts.level ?? null;
    this.level = this.fixedLevel ?? 0.6;
    this.flowEvery = opts.flowEvery ?? [900, 1600];  // frames between smooth sections
    this.biomeEvery = opts.biomeEvery ?? [1100, 1700];
    this.biomeOrder = opts.biomeOrder || null;
    if (this.biomeOrder) this.biomes = this.biomeOrder;
    this.flowKind = null;   // force the kind of the next smooth section (maps use 'finish')
    this.flow = new Generator(track, sim, { seed: (this.seed * 2654435761 + 7) >>> 0, map: !!opts.map });
    this.F = 0;
    this.snap = null;
    this.started = false;
    this.chunks = [];        // committed groups of lines: { lines, scenery, from, to, kind, dressed }
    this.stack = [];         // recent commits that can still be undone
    this.events = [];
    this.tracker = new TrickTracker();
    this.path = new PathIndex(16);
    this.decorate = opts.decorate === false ? null : opts.decorate || dressChunk;
    this.minUndoFrame = 0;
    this.nextFlow = 0;
    this.nextBiome = 0;
    this.restartFrom = null;
    this.stats = { tries: 0, kept: 0, undos: 0, flows: 0, kinds: {}, why: {} };
    this.idle = 0;          // how many steps in a row did nothing
    this.trouble = 0;       // recent dead ends
    this.episodeLeft = 0;   // nudges left before the next catch
    this.retries = 0;
    this.coasts = 0;
    this.flowStack = [];    // recent smooth sections, so a real dead end can back up past them
    this.deepUndos = 0;
    this.bestF = 0;
    this.levelSince = 0;
    this.doneAtLevel = 0;
    this.trace = opts.trace ? [] : null;
    this.pathUpTo = 0;      // frames recorded in this.path
    this.startX = track.start.x;
    this.startY = track.start.y;
    this.driftBase = 0;     // the corridor is re-centred after each smooth section
    // Backing up is only allowed within undoWindow frames of the furthest point
    // reached, so what's behind that is final (endless mode lets the rider play
    // up to there, whatever the timing, and the world stays the same per seed).
    this.undoWindow = opts.undoWindow ?? Infinity;
    this.maxF = 0;
    this.lockFloor = 0;
  }

  get locked() { return Math.max(this.lockFloor, this.maxF - this.undoWindow); }

  get verifiedFrame() { return this.F; }

  // where the rider is at the last checked frame (used for respawns)
  get anchor() {
    const s = this.sim.frame(this.F);
    const c = s.center();
    return { x: c.x, y: c.y, frame: this.F, speed: speedOf(s) };
  }

  // ------------------------------------------------------------ bookkeeping

  addLines(data) {
    const out = [];
    for (const d of data) {
      const l = new Line(null, d.type, snap(d.x1, d.type), snap(d.y1, d.type), snap(d.x2, d.type), snap(d.y2, d.type), d.flipped);
      if (d.style) l.style = d.style;
      this.track.add(l);
      if (l.collidable) this.track.linkEndpoints(l);
      out.push(l);
    }
    return out;
  }

  removeLines(lines) {
    for (let i = lines.length - 1; i >= 0; i--) this.track.remove(lines[i]);
  }

  historyIntact() {
    const s = this.sim.frame(this.F);
    if (!s.mounted) return false;
    const a = s.p, b = this.snap;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Lock in everything up to frame `f`: record tricks and the rider's path.
  advance(f, commit) {
    const events = [];
    for (let k = this.F + 1; k <= f; k++) this.tracker.feed(k, this.sim.frame(k), events);
    if (commit) commit.events = events;
    for (const e of events) this.events.push(e);
    this.F = f;
    this.maxF = Math.max(this.maxF, f);
    this.snap = this.sim.frame(f).p.slice();
    this.recordPath(f - LAG);
  }

  // remember where the rider went (up to frame `upTo`)
  recordPath(upTo) {
    for (let k = Math.max(this.pathUpTo + 1, this.sim.base + 1); k <= upTo; k++) {
      const s = this.sim.frame(k);
      const prev = this.sim.frame(k - 1);
      for (const i of TRACE) {
        const o = i * STRIDE;
        // a couple of in-between points so fast moves leave no gaps
        const x0 = prev.p[o], y0 = prev.p[o + 1], x1 = s.p[o], y1 = s.p[o + 1];
        const n = Math.min(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10));
        for (let j = 1; j <= n; j++) this.path.add(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n, k, x1 - x0, y1 - y0);
      }
    }
    this.pathUpTo = Math.max(this.pathUpTo, upTo);
  }

  commit(lines, kind, toFrame, extra = {}) {
    const chunk = { lines, scenery: [], from: this.F, to: toFrame, kind, dressed: false, biome: this.biome, ...extra };
    const rec = {
      chunk, F0: this.F, tracker: this.tracker.clone(),
    };
    this.chunks.push(chunk);
    this.advance(toFrame, rec);
    if (kind.startsWith('nudge') || kind === 'catch' || kind === 'coast') {
      this.stack.push(rec);   // everything since the last smooth section stays undoable
      this.path.trimLog(Math.min(this.stack[0].F0, this.flowStack.length ? this.flowStack[0].F0 : Infinity) - LAG - 5);
    } else {
      this.stack.length = 0;   // smooth sections are never undone
    }
    this.stats.kept++;
    this.stats.kinds[kind] = (this.stats.kinds[kind] || 0) + 1;
  }

  // Back up one step (dead end). Returns false if there's nothing left to undo.
  undo() {
    const rec = this.stack[this.stack.length - 1];
    if (!rec || rec.F0 < this.minUndoFrame || rec.F0 < this.locked) return false;
    this.stack.pop();
    this.removeLines(rec.chunk.lines);
    this.removeLines(rec.chunk.scenery);
    rec.chunk.scenery = [];
    const i = this.chunks.indexOf(rec.chunk);
    if (i >= 0) this.chunks.splice(i, 1);
    for (const e of rec.events || []) {
      const j = this.events.indexOf(e);
      if (j >= 0) this.events.splice(j, 1);
    }
    this.tracker = rec.tracker;
    this.F = rec.F0;
    this.path.rewind(rec.F0 - LAG);
    this.pathUpTo = Math.min(this.pathUpTo, rec.F0 - LAG);
    this.snap = this.sim.frame(this.F).p.slice();
    this.stats.undos++;
    return true;
  }

  // how much to care about moving on through the world
  urgency() {
    const c = this.sim.frame(this.F).center();
    const done = (c.x - this.startX) * GX + (c.y - this.startY) * GY;
    // wilder areas move on more slowly: the rider stays and ricochets around
    const sched = SCHEDULE * (1.15 - 0.6 * this.level);
    const behind = (this.F - this.levelSince) * sched + this.doneAtLevel - done;
    return clamp(1 + behind / 180, 0.4, 8);
  }

  markLevel() {
    const c = this.sim.frame(this.F).center();
    this.levelSince = this.F;
    this.doneAtLevel = (c.x - this.startX) * GX + (c.y - this.startY) * GY;
  }

  // distance below (+) or above (-) the corridor the world follows
  drift(x, y) {
    return (x - this.startX) * -GY + (y - this.startY) * GX - this.driftBase;
  }

  airTime() {
    let n = 0;
    for (let f = this.F; f > Math.max(this.sim.base, this.F - 200) && this.sim.frame(f).contacts === 0; f--) n++;
    return n;
  }

  // ------------------------------------------------------------ main step

  // Build scenery around chunks once the ride near them is known.
  dressSettled(force = false) {
    if (!this.decorate) return;
    const limit = force ? Infinity : this.F - 220;
    for (const ch of this.chunks) {
      if (ch.dressed || ch.to > limit) continue;
      ch.dressed = true;
      const rng = makeRng((this.seed * 7919 + Math.round(ch.from) * 104729) >>> 0);
      ch.scenery = this.addLines(this.decorate(this, ch, rng));
    }
  }

  // One unit of work. Returns false when completely stuck.
  // The ride is a series of episodes: a burst of nudges that must leave Bosh
  // catchable, then a catch ramp along his flight path, with a smooth flow
  // section (loop, kicker...) every so often.
  log(msg) {
    if (!this.trace) return;
    const s = this.sim.frame(this.F), c = s.center(), v = s.velocity();
    this.trace.push(`F${this.F} (${c.x.toFixed(0)},${c.y.toFixed(0)}) v(${v.x.toFixed(1)},${v.y.toFixed(1)}) c${s.contacts} ep${this.episodeLeft} st${this.stack.length}: ${msg}`);
  }

  *next() {
    const ok = yield* this.step();
    if (ok) this.dressSettled();
    return ok;
  }

  *step() {
    if (!this.started) {
      const ok = yield* this.begin();
      if (ok) this.newEpisode();
      return ok;
    }
    this.maybeSwitchBiome();
    // a smooth section every so often (and before the undo history gets long)
    if (this.F >= this.nextFlow || this.stack.length >= 26) {
      const kind = this.flowKind || this.rng.weighted([['loop', 3], ['flip', 2.5], ['kicker', 1.5], ['drop', 1], ['gaps', 1]]);
      if (yield* this.catchAndFlow(kind)) {
        this.log(`flow ${kind}`);
        this.scheduleFlow();
        this.newEpisode();
        return true;
      }
      if (this.F >= this.nextFlow) this.nextFlow = this.F + 40;
    }
    const s = this.sim.frame(this.F);
    const sp = speedOf(s);
    const c = s.center();
    const troubled = sp > 11.5 || this.airTime() > 70 || this.drift(c.x, c.y) > 900;
    if (this.episodeLeft > 0 && !troubled) {
      if (yield* this.nudge()) {
        this.coasts = 0;
        this.log(`nudge ${this.chunks[this.chunks.length - 1].kind}`);
        return true;
      }
    }
    // end of the episode (or things got hairy): catch him
    this.log(troubled ? 'troubled -> catch' : this.episodeLeft > 0 ? 'nudges failed -> catch' : 'episode over -> catch');
    if (yield* this.catchOnly(true)) { this.log('caught (right)'); this.newEpisode(); return true; }
    if (yield* this.catchAndFlow(sp > 12 ? 'brake' : 'cruise')) { this.log('caught + flow'); this.newEpisode(); return true; }
    if (yield* this.catchOnly(false)) { this.log('caught (turnaround)'); this.newEpisode(); return true; }
    if (yield* this.nudge(true)) { this.log('desperate nudge'); return true; }
    if (this.coasts < 3 && this.coast()) { this.coasts++; this.log('coast'); return true; }
    // dead end: rewind to just after the last smooth section and lay a plain piece from there
    this.log('dead end -> fallback');
    const deadF = this.F;
    if (this.F > this.bestF + 200) { this.deepUndos = 0; this.retries = 0; }
    this.bestF = Math.max(this.bestF, this.F);
    if (yield* this.fallbackFlow()) { this.log('fallback flow'); this.newEpisode(); return true; }
    // still stuck: back up past the last smooth section and take another route
    if (this.deepUndos < 6 && this.deepUndo()) { this.deepUndos++; this.log('deep undo'); this.newEpisode(); return true; }
    // can't back up that far (the rider has already seen it): try another way from as far back as we got
    if (this.F < deadF && this.retries < 12) { this.retries++; this.log('retry'); this.newEpisode(); return true; }
    this.log('stuck');
    return false;
  }

  *fallbackFlow() {
    const flow = this.flow;
    while (this.undo());
    if (!flow.anchor || this.F !== flow.anchor.frame) return false;
    const anchorBefore = flow.anchor;
    const rng = this.rng.fork();
    for (const kind of [rng.pick(['cruise', 'kicker', 'rollers', 'drop']), 'cruise', 'straight']) {
      const piece = yield* flow.next(kind, 4);
      if (!piece) continue;
      if (!this.historyIntact()) {
        flow.pieces.pop();
        this.removeLines(piece.lines);
        return false;
      }
      this.absorbFlow(kind, anchorBefore);
      this.coasts = 0;
      return true;
    }
    return false;
  }

  coast() {
    const n = this.rng.int(6, 18);
    for (let f = this.F + 1; f <= this.F + n + 20; f++) if (!this.sim.frame(f).mounted) return false;
    this.commit([], 'coast', this.F + n);
    return true;
  }

  newEpisode() {
    const lvl = this.level;
    this.episodeLeft = this.rng.int(3 + Math.round(4 * lvl), 6 + Math.round(12 * lvl));
  }

  scheduleFlow() {
    const [a, b] = this.flowEvery;
    this.nextFlow = this.F + this.rng.int(a, b);
  }

  maybeSwitchBiome() {
    if (this.fixedBiome || !this.biomes.length || this.F < this.nextBiome) return;
    if (this.biomeOrder) {
      // a set tour (Grand Tour map): stay in the last area once it's reached
      const i = this.biomeOrder.indexOf(this.biome) + 1;
      if (i >= this.biomeOrder.length) { this.nextBiome = Infinity; return; }
      this.biome = this.biomeOrder[i];
    } else {
      const choices = this.biomes.filter((b) => b !== this.biome);
      this.biome = this.rng.pick(choices.length ? choices : this.biomes);
    }
    this.level = this.fixedLevel ?? clamp((this.biome.chaos ?? 0.6) * this.rng.range(0.8, 1.2), 0.2, 1);
    this.markLevel();
    this.nextBiome = this.F + this.rng.int(...this.biomeEvery);
    this.events.push({ frame: this.F, type: 'biome', name: this.biome.name, biome: this.biome });
  }

  *begin() {
    const from = this.restartFrom ? this.restartFrom.frame : 0;
    this.F = from;
    if (!this.fixedBiome) { this.nextBiome = from; this.maybeSwitchBiome(); }
    else if (this.biome) this.events.push({ frame: from, type: 'biome', name: this.biome.name, biome: this.biome });
    const flow = this.flow;
    flow.anchor = null;
    flow.restartFrom = this.restartFrom;
    const piece = yield* flow.next();
    if (!piece) return false;
    this.started = true;
    this.snap = this.sim.frame(from).p.slice();
    this.restartFrom = null;
    this.absorbFlow('start');
    this.scheduleFlow();
    return true;
  }

  // take the pieces the flow generator just built
  absorbFlow(kind, anchorBefore = null) {
    const flow = this.flow;
    // (keeps the steps before it, so a deep undo can keep backing up through them)
    const rec = { F0: this.F, tracker: this.tracker.clone(), anchorBefore, chunks: [], events: [], prevStack: this.stack.slice() };
    for (const piece of flow.pieces) {
      const chunk = { lines: piece.lines, scenery: [], from: piece.startFrame, to: piece.endFrame, kind: `flow:${piece.kind}`, dressed: false, biome: this.biome, info: piece.info };
      this.chunks.push(chunk);
      rec.chunks.push(chunk);
      for (const e of flow.events) {
        if (e.type === 'loop' && e.frame >= piece.startFrame && e.frame <= piece.endFrame) { this.events.push(e); rec.events.push(e); }
      }
    }
    flow.pieces.length = 0;
    flow.events.length = 0;
    this.stack.length = 0;
    const evRec = {};
    this.advance(flow.anchor.frame, evRec);
    rec.events.push(...(evRec.events || []));
    rec.driftBase = this.driftBase;
    const c = this.sim.frame(this.F).center();
    this.driftBase += this.drift(c.x, c.y);
    if (kind !== 'start') {
      this.flowStack.push(rec);
      if (this.flowStack.length > 3) this.flowStack.shift();
    }
    this.stats.flows++;
  }

  // ------------------------------------------------------------ nudges

  *nudge(desperate = false) {
    const sim = this.sim;
    const rng = this.rng.fork();
    const lvl = this.level;
    const F = this.F;
    const touching = sim.frame(F).contacts > 0;
    const maxGap = desperate ? 4 : touching ? Math.round(4 + 8 * (1 - lvl)) : Math.round(2 + 4 * (1 - lvl));
    const H = HORIZON;
    // where Bosh goes if we add nothing
    const base = [];
    for (let f = F; f <= F + 30 + H; f++) base.push(sim.frame(f));
    const baseM = base.map((s) => sledFrame(s));
    // act when he is heading towards his runners (something placed there will catch him)
    let t = F + rng.int(1, maxGap);
    for (let g = 1; g <= 30; g++) {
      const m = baseM[g];
      if (m.vx * m.ux + m.vy * m.uy > 0.35 || g >= maxGap + 10) { t = F + Math.max(g, rng.int(1, maxGap)); break; }
    }
    const urg = this.urgency();
    this.air = this.airTime();

    const cands = [];
    const why = this.stats.why;
    const note = (k) => { why[k] = (why[k] || 0) + 1; };
    if (this.idle < 2 && !desperate) {
      const none = this.evaluate(F, t, H, base, baseM, null);
      if (none.ok) cands.push({ kind: 'none', lines: [], ...none });
    }
    const K = desperate ? 18 : 13;
    sim.protectUntil = F - LAG;
    // he must end up catchable: settled, and either on something or flying runners-first
    const recoverable = (r) => desperate || (Math.abs(r.lean) < 0.6 && Math.abs(r.spin) < 0.22
      && (r.endContact || (r.misalign < 0.7 && r.endUy > 0.15)));
    if (cands.length && !recoverable(cands[0])) cands.length = 0;
    for (let k = 0; k < K; k++) {
      const c = this.propose(F, t, base, baseM, rng, lvl, desperate);
      if (!c) { note('no fit'); continue; }
      this.stats.tries++;
      if (c.lines.some((d) => lineHitsPath(this.path, d))) { note('old path'); continue; }
      const added = this.addLines(c.lines);
      const res = this.historyIntact() ? this.evaluate(F, t, H, base, baseM, added) : { ok: false, why: 'history' };
      if (res.ok && !recoverable(res) && !res.endContact) {
        // still spinning in the air: fine if he'll be landable soon (that's a flip)
        const land = this.landableAfter(t + H, 50);
        if (land) { res.flipSetup = land.frame; res.rot += land.rot; }
      }
      this.removeLines(added);
      if (res.ok && !recoverable(res) && !res.flipSetup) note('wild');
      else if (res.ok) { cands.push({ ...c, ...res }); note(res.flipSetup ? 'flip setup' : 'ok'); } else note(res.why || 'crash');
      if (k % 2 === 1) yield;
    }
    sim.protectUntil = 0;
    if (!cands.length) return false;
    for (const c of cands) c.score = this.score(c, lvl, urg, rng);
    cands.sort((a, b) => b.score - a.score);
    // pick among the top few, favouring the best
    const pick = cands.length > 1 && rng.chance(0.3) ? cands[1] : cands[0];
    sim.protectUntil = F - LAG;
    const lines = this.addLines(pick.lines);
    sim.protectUntil = 0;
    if (!this.historyIntact()) { this.removeLines(lines); return false; }
    const effect = pick.diverge > 0 ? pick.diverge : t;
    const to = clamp(effect + rng.int(4, 16), F + 1, t + H - 12);
    for (let f = F + 1; f <= to; f++) if (!sim.frame(f).mounted) { this.removeLines(lines); return false; }
    this.idle = pick.kind === 'none' ? this.idle + 1 : 0;
    if (pick.kind !== 'none') this.episodeLeft--;
    if (pick.flipSetup) this.episodeLeft = 0;   // land the flip next
    this.commit(lines, `nudge:${pick.kind}`, to);
    return true;
  }

  // After frame f (no more track added), is there a moment he could be caught?
  landableAfter(f, n) {
    let rotAcc = 0, prev = sledFrame(this.sim.frame(f)).ang;
    for (let k = f + 1; k <= f + n; k++) {
      const s = this.sim.frame(k);
      if (!s.mounted) return null;
      const m = sledFrame(s);
      rotAcc += angleDiff(m.ang, prev);
      prev = m.ang;
      if (s.contacts > 0) return null;
      if (m.vy < 0.3 || m.uy < 0.3) continue;
      const h = Math.atan2(m.vy, m.vx);
      const mis = Math.min(Math.abs(angleDiff(m.ang, h)), Math.abs(angleDiff(m.ang + Math.PI, h)));
      if (mis < 0.6 && Math.abs(sledInfo(s).lean) < 0.7) return { frame: k, rot: rotAcc };
    }
    return null;
  }

  // Try some track at frame t and see what happens over the next H frames.
  evaluate(F, t, H, base, baseM, added) {
    const sim = this.sim;
    let diverge = -1, rotSum = 0, prevAng = null, minSp = Infinity, maxSp = 0;
    let contactFrames = 0, revs = 0, vxSign = 0, startM = null;
    for (let f = F + 1; f <= t + H; f++) {
      const s = sim.frame(f);
      if (!s.mounted) return { ok: false, why: 'crash' };
      const m = sledFrame(s);
      const b = baseM[f - F];
      if (diverge < 0 && added && Math.hypot(m.mx - b.mx, m.my - b.my) > 0.5) diverge = f;
      if (f < t) continue;
      if (!startM) startM = m;
      if (prevAng != null) rotSum += angleDiff(m.ang, prevAng);
      prevAng = m.ang;
      const sp = Math.hypot(m.vx, m.vy);
      minSp = Math.min(minSp, sp);
      maxSp = Math.max(maxSp, sp);
      if (s.contacts > 0) contactFrames++;
      if (Math.abs(m.vx) > 1.4) {
        const sign = Math.sign(m.vx);
        if (vxSign && sign !== vxSign) revs++;
        vxSign = sign;
      }
    }
    if (added && diverge < 0) return { ok: false, why: 'no effect' };
    if (revs >= 2 && contactFrames > H * 0.5) return { ok: false, why: 'trapped' };
    // grinding to a halt on the track is a dead end (a stop in mid-air is fine)
    let slowContact = 0;
    for (let f = t + H - 12; f <= t + H; f++) {
      const s = sim.frame(f);
      const m = sledFrame(s);
      if (s.contacts > 0 && Math.hypot(m.vx, m.vy) < 2.2) slowContact++;
    }
    if (slowContact > 8) return { ok: false, why: 'grinding' };
    const startSp = Math.hypot(startM.vx, startM.vy);
    if (maxSp > Math.max(12, startSp + 0.5)) return { ok: false, why: 'too fast' };
    const end = sim.frame(t + H);
    const me = sledFrame(end);
    const m3 = sledFrame(sim.frame(t + H - 3));
    const info = sledInfo(end);
    const turn = Math.abs(angleDiff(Math.atan2(me.vy, me.vx), Math.atan2(startM.vy, startM.vx)));
    const prog = me.mx - startM.mx;
    // how much of this goes somewhere new (crowding the old path leads to dead ends)
    let fresh = 0, samples = 0;
    for (let f = t + 4; f <= t + H; f += 4) {
      const m = sledFrame(sim.frame(f));
      samples++;
      if (!this.path.near(m.mx, m.my, 30)) fresh++;
    }
    return {
      ok: true, diverge, rot: rotSum, turn, revs, stop: minSp < 1, minSp, maxSp,
      endSp: Math.hypot(me.vx, me.vy), startSp, lean: info.lean, spin: angleDiff(me.ang, m3.ang) / 3,
      contactFrames, prog, drift: this.drift(me.mx, me.my), drift0: this.drift(startM.mx, startM.my),
      fresh: samples ? fresh / samples : 1,
      endContact: end.contacts > 0 || sim.frame(t + H - 1).contacts > 0,
      endUy: me.uy,
      misalign: Math.abs(angleDiff(me.ang, Math.atan2(me.vy, me.vx))),
    };
  }

  score(c, lvl, urg, rng) {
    let s = 0;
    const turns = Math.abs(c.rot) / TAU;
    s += (1.2 + 3.2 * lvl) * Math.min(turns, 3);
    s += (0.4 + 1.3 * lvl) * Math.min(c.turn, Math.PI);
    s += (1.4 + 3.0 * lvl) * Math.min(c.revs, 2);
    if (c.stop) s += 1.2 + 2.2 * lvl;
    // a spin that ends in a catchable landing is a flip: the best thing there is
    if (c.flipSetup && turns > 0.7) s += (1.5 + 4 * lvl) * Math.min(Math.round(turns + 0.2), 2);
    if (c.contactFrames > 0) s += 0.6 + Math.min(this.air, 80) / 30;
    s += 0.006 * clamp(c.prog, -120, 220) * urg;
    // stay near the corridor (falling below it is the usual way things go wrong)
    s -= 0.01 * Math.max(0, Math.abs(c.drift) - 120);
    s += 0.006 * clamp(Math.abs(c.drift0) - Math.abs(c.drift), -100, 100);
    // keep speed sensible: reward slowing down when quick
    if (c.startSp > 8) s += 0.35 * (c.startSp - c.endSp);
    s -= Math.max(0, c.endSp - 10) * 0.5;
    s -= Math.max(0, 4 - c.endSp) * 0.35;
    if (Math.abs(c.lean) > 0.6) s -= 1.6;
    if (Math.abs(c.spin) > 0.25) s -= 0.8;
    s += (1.8 - 1.2 * lvl) * c.fresh - 0.6;
    if (c.kind === 'none') s -= 0.8 + 1.6 * lvl;
    return s + rng.range(0, 1.3);
  }

  // ------------------------------------------------------------ candidates

  propose(F, t, base, baseM, rng, lvl, desperate) {
    const k = rng.int(1, 3);
    const s = base[t + k - F];
    if (!s) return null;
    const m = baseM[t + k - F];
    const sp = Math.hypot(m.vx, m.vy);
    if (sp < 0.3) return null;
    const vd = { x: m.vx / sp, y: m.vy / sp };
    // how hard to hit: the speed into the new line is what decides if Bosh survives
    const sev = rng.next() < 0.08 + 0.3 * lvl ? 'extreme' : rng.next() < 0.45 ? 'medium' : 'mild';
    const hitMax = sev === 'extreme' ? 6.5 : sev === 'medium' ? 4 : 2.2;
    // the side his runners face, relative to where he's going
    const ud = m.ux * vd.x + m.uy * vd.y;
    let px = m.ux - ud * vd.x, py = m.uy - ud * vd.y;
    const pl = Math.hypot(px, py);
    const kind = rng.weighted([
      ['ramp', 3],
      ['tap', 0.8 + 2.4 * lvl],
      ['curve', desperate ? 5 : 2.4],
      ['boost', sp < 6 ? 1.4 : 0.3],
      ['brake', sp > 8 ? 1.3 : 0.1],
    ]);
    const gap = rng.range(0.4, 2.2);

    if (kind !== 'curve') {
      // a deflector under the runners, angled so he hits it at a chosen speed
      if (pl < 0.35) return null;   // runners face forwards/backwards: nothing safe to put there
      px /= pl; py /= pl;
      const hit = rng.range(0.5, Math.min(hitMax * (kind === 'tap' ? 1.3 : 1), sp * 0.97));
      const delta = Math.asin(clamp(hit / sp, 0, 0.99));
      // line direction tilts away from his runners; its solid side faces them
      const c = Math.cos(delta), sn = Math.sin(delta);
      let dx = vd.x * c - px * sn, dy = vd.y * c - py * sn;
      const nx = vd.x * sn + px * c, ny = vd.y * sn + py * c;
      let type = LineType.NORMAL;
      let len = rng.range(16, sev === 'mild' ? 80 : 50);
      let ox = m.mx, oy = m.my, frac = rng.range(0.08, 0.5);
      if (kind === 'tap') {
        // tiny line under one end of the sled: kicks him into a spin
        const nose = rng.chance(0.5);
        ox = nose ? m.nx : m.tx;
        oy = nose ? m.ny : m.ty;
        len = rng.range(3, 9);
        frac = 0.5;
      } else if (kind === 'boost' || kind === 'brake') {
        type = LineType.ACCEL;
        if (kind === 'brake') { dx = -dx; dy = -dy; }
        len = rng.range(18, 60);
      }
      return { kind, lines: [lineAcross(ox + m.ux * gap, oy + m.uy * gap, dx, dy, len, frac, nx, ny, type)] };
    }

    // curve: a short bent track he lands on (tangent to his path) and follows
    const h = Math.atan2(vd.y, vd.x) + rng.range(-0.08, 0.08);
    const right = { x: -Math.sin(h), y: Math.cos(h) };
    const side = right.x * m.ux + right.y * m.uy >= 0 ? 1 : -1;   // -1: riding upside down
    const pm = baseM[t + k - 1 - F] || m;
    const path = new Path(pm.mx + m.ux * gap, pm.my + m.uy * gap, h);
    path.line(Math.max(4, sp * rng.range(0.5, 1.3)), 6);
    const mag = sev === 'extreme' ? rng.range(1.8, 3.1) : sev === 'medium' ? rng.range(0.8, 1.8) : rng.range(0.25, 0.8);
    const concave = rng.chance(0.78);
    const dA = concave ? -mag * side : mag * side * 0.5;
    const rad = clamp((sp * sp) / rng.range(1.1, 2.6), 22, 260);
    path.arc(rad, dA, 7);
    if (rng.chance(0.5)) path.line(rng.range(8, 45), 10);
    return { kind: 'curve', lines: pathLines(path, LineType.NORMAL, side < 0) };
  }

  // ------------------------------------------------------------ smooth sections

  // Catch Bosh on a ramp laid along his flight path, then build a classic piece.
  *catchAndFlow(kind) {
    const sim = this.sim, flow = this.flow;
    const rng = this.rng.fork();
    const F = this.F;
    const flight = [];
    let rotAcc = 0, prev = null;
    for (let f = F; f < F + 160; f++) {
      if ((f - F) % 40 === 0) yield;
      const s = sim.frame(f);
      if (!s.mounted) break;
      const m = sledInfo(s);
      if (prev != null) rotAcc += angleDiff(m.ang, prev);
      prev = m.ang;
      flight.push({ f, mx: m.mx, my: m.my, ang: m.ang, lean: m.lean, rot: rotAcc });
    }
    const cands = [];
    for (let i = 4; i < flight.length; i++) {
      const c = flight[i], b = flight[i - 1];
      const vx = c.mx - b.mx, vy = c.my - b.my;
      if (vy <= 0.2) continue;
      const vel = Math.atan2(vy, vx);
      if (vel < 0.05 || vel > 1.5 || vx < 0.3) continue;
      const spd = Math.hypot(vx, vy);
      if (spd > 22) continue;
      const mis = Math.abs(angleDiff(c.ang, vel));
      if (mis > 0.6 || Math.abs(c.lean) > 0.8) continue;
      cands.push({ i, vel, sp: spd, spin: c.rot - b.rot, score: mis * 3 + i / 40 });
    }
    cands.sort((a, b) => a.score - b.score);
    const tried = [];
    for (const c of cands) {
      if (tried.length >= 4) break;
      if (tried.some((x) => Math.abs(x - c.i) < 4)) continue;
      tried.push(c.i);
      const mark = flow.pending.length;
      const land = flow.landingPath(flight, c, rng, { kind: 'catch', exitA: rng.range(0.15, 0.5) });
      const a = { x: land.pts[0][0], y: land.pts[0][1], a: c.vel, frame: F, speed: speedOf(sim.frame(F)) };
      const res = yield* flow.finish([land], a, { maxFrames: c.i + 300, maxSpeed: 20 });
      if (!res.ok || !this.historyIntact()) { flow.rollbackTo(mark); continue; }
      const anchorBefore = flow.anchor;
      flow.commit('catch', res, a, { paths: [land] });
      const catchAnchor = flow.anchor;
      if (kind && kind !== 'cruise') {
        const piece = yield* flow.next(kind, 6);
        if (piece && !this.historyIntact()) {
          flow.pieces.pop();
          this.removeLines(piece.lines);
          flow.anchor = catchAnchor;
        }
      }
      this.absorbFlow(kind, anchorBefore);
      return true;
    }
    return false;
  }

  // Back up past the last smooth section (only for real dead ends).
  deepUndo() {
    while (this.undo());
    const rec = this.flowStack[this.flowStack.length - 1];
    if (!rec || rec.F0 < this.minUndoFrame || rec.F0 < this.locked || !rec.anchorBefore) return false;
    this.flowStack.pop();
    for (const ch of rec.chunks) {
      this.removeLines(ch.lines);
      this.removeLines(ch.scenery);
      const i = this.chunks.indexOf(ch);
      if (i >= 0) this.chunks.splice(i, 1);
    }
    for (const e of rec.events) {
      const j = this.events.indexOf(e);
      if (j >= 0) this.events.splice(j, 1);
    }
    this.tracker = rec.tracker;
    this.F = rec.F0;
    this.path.rewind(rec.F0 - LAG);
    this.pathUpTo = Math.min(this.pathUpTo, rec.F0 - LAG);
    this.snap = this.sim.frame(this.F).p.slice();
    this.flow.anchor = rec.anchorBefore;
    this.stack = rec.prevStack;
    this.driftBase = rec.driftBase;
    this.nextFlow = this.F + this.rng.int(100, 300);
    this.stats.undos++;
    return true;
  }

  // Catch Bosh on a ramp along his flight path, whichever way he is going,
  // and settle him onto a short run-out.
  *catchOnly(rightOnly = false) {
    const sim = this.sim;
    const rng = this.rng.fork();
    const F = this.F;
    const flight = [];
    for (let f = F; f < F + 140; f++) {
      if ((f - F) % 40 === 0) yield;
      const s = sim.frame(f);
      if (!s.mounted) break;
      flight.push(sledFrame(s));
    }
    const cands = [];
    const patience = rng.range(10, 50);   // usually catch him soon; now and then let him fly
    for (let i = 3; i < flight.length; i++) {
      const c = flight[i];
      const sp = Math.hypot(c.vx, c.vy);
      if (sp < 1.5 || sp > 21 || c.vy < 0.2) continue;
      const dir = Math.sign(c.vx) || 1;
      if (rightOnly && dir < 0) continue;
      const desc = Math.atan2(c.vy, Math.abs(c.vx));     // 0 = level, PI/2 = straight down
      if (desc < 0.05 || desc > 1.45) continue;
      const heading = Math.atan2(c.vy, c.vx);
      const mis = Math.abs(angleDiff(c.ang, heading)) < Math.PI / 2 ? Math.abs(angleDiff(c.ang, heading)) : Math.abs(angleDiff(c.ang + Math.PI, heading));
      if (mis > 0.7) continue;
      // the runners must face the ground
      if (c.uy < 0.3) continue;
      cands.push({ i, dir, heading, sp, score: mis * 3 + i / patience });
    }
    cands.sort((a, b) => a.score - b.score);
    const why = this.stats.why;
    const note = (k) => { why[k] = (why[k] || 0) + 1; };
    if (!cands.length) note('catch: no spot');
    const tried = [];
    for (const c of cands) {
      if (tried.length >= 4) break;
      if (tried.some((x) => Math.abs(x - c.i) < 4)) continue;
      tried.push(c.i);
      const pts = [];
      for (let j = Math.max(1, c.i - 7); j <= c.i; j++) {
        const q = flight[j];
        pts.push([q.mx + q.ux * 1.0, q.my + q.uy * 1.0]);
      }
      const path = new Path(pts[0][0], pts[0][1], c.heading);
      path.through(pts.slice(1), c.heading);
      const turnaround = c.dir < 0;
      const fast = c.sp > 10.5;
      // quick riders get flung back up (gravity slows them); otherwise settle onto a run-out
      const launch = !turnaround && (fast ? rng.chance(0.8) : rng.chance(0.5));
      const exit = c.dir > 0
        ? (launch ? -rng.range(0.15, 0.6) : fast ? -rng.range(0, 0.12) : rng.range(0.1, 0.45))
        : Math.PI - rng.range(0.1, 0.45);
      const rad = clamp((c.sp * c.sp) / rng.range(1.4, 2.0), 45, 600);
      if (turnaround) {
        // heading left: curve up into a quarter-pipe so he comes back the other way
        path.arc(rad, angleDiff(exit, path.a), 8);
        path.line(rng.range(10, 40), 10);
        path.arc(clamp(c.sp * c.sp / 1.6, 40, 200), 1.35, 8);
        path.line(rng.range(20, 60), 10);
      } else {
        path.arc(launch ? clamp(rad, 45, 220) : rad, angleDiff(exit, path.a), 8);
      }
      const runFrom = path.end;
      if (launch) {
        path.line(rng.range(10, 28), 10);
      } else if (!turnaround && fast) {
        // too quick: level out a touch uphill over brake strips
        path.line(30, 14);
        path.mark('brake', (q) => q.line(clamp((c.sp * c.sp - 64) / (2 * 0.19), 40, 700), 14));
        path.line(60, 14);
      } else if (!turnaround) path.line(clamp(c.sp * rng.range(4, 9), 35, 160), 14);
      const lines = this.addLines(pathLines(path, LineType.NORMAL, c.dir < 0));
      let ok = this.historyIntact();
      if (!ok) note('catch: history');
      let endF = -1;
      if (ok && launch) {
        // fine once he has left the lip cleanly
        const lip = path.end;
        for (let f = F + 1; f <= F + c.i + 200; f++) {
          if ((f - F) % 30 === 0) yield;
          const s = sim.frame(f);
          if (!s.mounted) { ok = false; note('catch: crash'); break; }
          const m = sledFrame(s);
          if ((m.mx - lip.x) * Math.cos(exit) + (m.my - lip.y) * Math.sin(exit) > 4) {
            const info = sledInfo(s);
            const m3 = sledFrame(sim.frame(f - 3));
            ok = Math.abs(info.lean) < 0.6 && Math.abs(angleDiff(m.ang, m3.ang)) < 0.3;
            if (!ok) note('catch: wobbly launch');
            endF = f + 1;
            break;
          }
        }
      } else if (ok && turnaround) {
        // wait until he's heading right again, upright
        for (let f = F + c.i; f <= F + c.i + 260; f++) {
          if ((f - F) % 30 === 0) yield;
          const s = sim.frame(f);
          if (!s.mounted) { ok = false; note('catch: crash'); break; }
          const m = sledFrame(s);
          if (m.vx > 1.5 && f > F + c.i + 10) {
            ok = Math.abs(sledInfo(s).lean) < 0.7;
            endF = f + 3;
            break;
          }
        }
      } else if (ok) {
        const goal = { x: runFrom.x + Math.cos(exit) * 25, y: runFrom.y + Math.sin(exit) * 25 };
        for (let f = F + 1; f <= F + c.i + 200; f++) {
          if ((f - F) % 30 === 0) yield;
          const s = sim.frame(f);
          if (!s.mounted) { ok = false; note('catch: crash'); break; }
          const m = sledFrame(s);
          if ((m.mx - goal.x) * Math.cos(exit) + (m.my - goal.y) * Math.sin(exit) >= 0) {
            const info = sledInfo(s);
            ok = Math.abs(info.lean) < 0.7 && s.contacts > 0;
            if (!ok) note('catch: unsettled');
            endF = f;
            break;
          }
        }
      }
      if (ok && endF > 0 && !launch && speedOf(sim.frame(endF)) < 3.5) { ok = false; note('catch: slow'); }
      if (ok && endF > 0) {
        this.commit(lines, 'catch', endF);
        return true;
      }
      this.removeLines(lines);
    }
    return false;
  }

  // ------------------------------------------------------------ endless housekeeping

  // Remove chunks the rider finished with long ago, if nothing cached still uses them.
  pruneBefore(frame) {
    let n = 0;
    while (this.chunks.length > 4 && this.chunks[0].to < frame) {
      const c = this.chunks[0];
      if (c.lines.some((l) => this.sim.touches(l))) break;
      this.chunks.shift();
      this.removeLines(c.lines);
      this.removeLines(c.scenery);
      n++;
    }
    this.events = this.events.filter((e) => e.frame >= frame - 400);
    this.path.pruneBefore(frame);
    return n;
  }

  // Start again with a fresh rider at `pos` (endless mode's last resort).
  restartAt(pos, frame) {
    this.sim.setState(frame, makeRider(pos));
    this.started = false;
    this.restartFrom = { x: pos.x, y: pos.y, frame };
    this.stack.length = 0;
    this.flowStack.length = 0;
    this.flow.pieces.length = 0;
    this.flow.events.length = 0;
    this.F = frame;
    this.pathUpTo = frame;
    this.minUndoFrame = frame;
    this.maxF = frame;
    this.lockFloor = frame;
    this.tracker = new TrickTracker();
    this.nextFlow = frame;
    this.startX = pos.x;
    this.startY = pos.y;
    this.driftBase = 0;
    this.markLevel();
  }
}

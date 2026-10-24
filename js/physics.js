// Line Rider physics, modelled on the classic "6.2" engine.
// Constants and rules follow lr-core by conundrumer (MIT licence).
// Units: world units, one simulation frame = 1/40 s, y points down.

export const LineType = { NORMAL: 0, ACCEL: 1, SCENERY: 2 };

export const FPS = 40;
export const ITERATIONS = 6;
export const GRAVITY = 0.175;
export const START_VELOCITY = { x: 0.4, y: 0 };
export const ZONE = 10;          // how far "into" a line a point can be and still get pushed out
const MAX_EXTENSION_RATIO = 0.25;
const ACCEL = 0.1;
const CELL = 14;                 // physics grid cell size

// ---------------------------------------------------------------------------
// Lines

export class Line {
  constructor(id, type, x1, y1, x2, y2, flipped = false, leftExt = false, rightExt = false) {
    this.id = id;
    this.type = type;
    this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    this.flipped = !!flipped;
    this.leftExt = !!leftExt;
    this.rightExt = !!rightExt;
    this.multiplier = 1;
    this.compute();
  }

  get collidable() { return this.type !== LineType.SCENERY; }

  compute() {
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const lenSq = dx * dx + dy * dy;
    const len = Math.sqrt(lenSq) || 1e-9;
    const f = this.flipped ? -1 : 1;
    this.dx = dx; this.dy = dy;
    this.len = len;
    this.invLenSq = 1 / (lenSq || 1e-18);
    // Normal points into the solid side; points coming from the other side get pushed back.
    this.nx = (-dy / len) * f;
    this.ny = (dx / len) * f;
    const ext = Math.min(MAX_EXTENSION_RATIO, ZONE / len);
    this.lb = this.leftExt ? -ext : 0;
    this.rb = this.rightExt ? 1 + ext : 1;
    // Acceleration lines push along the drawing direction.
    const a = ACCEL * this.multiplier;
    this.ax = (-dx / len) * a;
    this.ay = (-dy / len) * a;
    this.minX = Math.min(this.x1, this.x2); this.maxX = Math.max(this.x1, this.x2);
    this.minY = Math.min(this.y1, this.y2); this.maxY = Math.max(this.y1, this.y2);
  }

  toData() {
    return {
      id: this.id, type: this.type,
      x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2,
      flipped: this.flipped, leftExt: this.leftExt, rightExt: this.rightExt,
    };
  }

  static fromData(d) {
    return new Line(d.id, d.type, d.x1, d.y1, d.x2, d.y2, d.flipped, d.leftExt, d.rightExt);
  }
}

// ---------------------------------------------------------------------------
// Spatial grids

function cellKey(cx, cy) { return cx * 67108864 + cy; }

// All grid cells a segment passes through (Amanatides & Woo traversal).
function cellsOnSegment(x1, y1, x2, y2, size, out) {
  let cx = Math.floor(x1 / size), cy = Math.floor(y1 / size);
  const ex = Math.floor(x2 / size), ey = Math.floor(y2 / size);
  out.push(cx, cy);
  const dx = x2 - x1, dy = y2 - y1;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(size / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(size / dy) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * size - x1 : x1 - cx * size) / Math.abs(dx)) : Infinity;
  let tmy = dy !== 0 ? ((dy > 0 ? (cy + 1) * size - y1 : y1 - cy * size) / Math.abs(dy)) : Infinity;
  let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (tmx < tmy) { tmx += tdx; cx += stepX; } else { tmy += tdy; cy += stepY; }
    out.push(cx, cy);
  }
  return out;
}

class Grid {
  constructor(size) {
    this.size = size;
    this.cells = new Map();
    this.lineCells = new Map();
  }
  add(line) {
    const pts = cellsOnSegment(line.x1, line.y1, line.x2, line.y2, this.size, []);
    const keys = [];
    for (let i = 0; i < pts.length; i += 2) {
      const k = cellKey(pts[i], pts[i + 1]);
      if (keys.includes(k)) continue;
      keys.push(k);
      let arr = this.cells.get(k);
      if (!arr) { arr = []; this.cells.set(k, arr); }
      // newest lines first, like the classic engine
      let idx = 0;
      while (idx < arr.length && arr[idx].id > line.id) idx++;
      arr.splice(idx, 0, line);
    }
    this.lineCells.set(line.id, keys);
  }
  remove(line) {
    const keys = this.lineCells.get(line.id);
    if (!keys) return;
    for (const k of keys) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(line);
      if (i >= 0) arr.splice(i, 1);
      if (arr.length === 0) this.cells.delete(k);
    }
    this.lineCells.delete(line.id);
  }
  cellAt(cx, cy) { return this.cells.get(cellKey(cx, cy)); }
}

// ---------------------------------------------------------------------------
// Track: the set of lines plus lookup structures

export class Track {
  constructor() {
    this.lines = new Map();
    this.physicsGrid = new Grid(CELL);
    this.viewGrid = new Grid(128);
    this.nextId = 1;
    this.start = { x: 0, y: 0 };
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit(kind, line) { for (const fn of this.listeners) fn(kind, line); }

  get size() { return this.lines.size; }

  add(line) {
    if (line.id == null) line.id = this.nextId++;
    else this.nextId = Math.max(this.nextId, line.id + 1);
    this.lines.set(line.id, line);
    if (line.collidable) this.physicsGrid.add(line);
    this.viewGrid.add(line);
    this.emit('add', line);
    return line;
  }

  remove(line) {
    if (!this.lines.has(line.id)) return;
    this.lines.delete(line.id);
    this.physicsGrid.remove(line);
    this.viewGrid.remove(line);
    this.emit('remove', line);
  }

  clear() {
    for (const l of [...this.lines.values()]) this.remove(l);
    this.nextId = 1;
    this.emit('clear', null);
  }

  // Mark endpoint extensions where this line meets other lines, like the
  // classic editor does when lines snap together. Stops riders slipping through joints.
  linkEndpoints(line) {
    if (!line.collidable) return;
    const eps = 1e-3;
    const touches = (x, y) => {
      let hit = false;
      this.forLinesInRect(x - 1, y - 1, x + 1, y + 1, (o) => {
        if (o === line || !o.collidable) return;
        if (Math.abs(o.x1 - x) < eps && Math.abs(o.y1 - y) < eps) {
          hit = true;
          if (!o.leftExt) { o.leftExt = true; o.compute(); this.emit('modify', o); }
        }
        if (Math.abs(o.x2 - x) < eps && Math.abs(o.y2 - y) < eps) {
          hit = true;
          if (!o.rightExt) { o.rightExt = true; o.compute(); this.emit('modify', o); }
        }
      });
      return hit;
    };
    const l = touches(line.x1, line.y1);
    const r = touches(line.x2, line.y2);
    if (l !== line.leftExt || r !== line.rightExt) {
      line.leftExt = line.leftExt || l;
      line.rightExt = line.rightExt || r;
      line.compute();
    }
  }

  // Visit each line whose cell overlaps a rectangle (may include lines just outside it).
  forLinesInRect(x0, y0, x1, y1, fn) {
    const g = this.viewGrid;
    const cx0 = Math.floor(x0 / g.size), cx1 = Math.floor(x1 / g.size);
    const cy0 = Math.floor(y0 / g.size), cy1 = Math.floor(y1 / g.size);
    const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (cellCount > this.lines.size) {
      for (const l of this.lines.values()) {
        if (l.maxX >= x0 && l.minX <= x1 && l.maxY >= y0 && l.minY <= y1) fn(l);
      }
      return;
    }
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = g.cellAt(cx, cy);
        if (!arr) continue;
        for (const l of arr) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          fn(l);
        }
      }
    }
  }

  bounds() {
    if (this.lines.size === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of this.lines.values()) {
      x0 = Math.min(x0, l.minX); y0 = Math.min(y0, l.minY);
      x1 = Math.max(x1, l.maxX); y1 = Math.max(y1, l.maxY);
    }
    return { x0, y0, x1, y1 };
  }
}

// ---------------------------------------------------------------------------
// Rider ("Bosh"): 10 contact points + 7 scarf points

export const P = {
  PEG: 0, TAIL: 1, NOSE: 2, STRING: 3, BUTT: 4, SHOULDER: 5,
  RHAND: 6, LHAND: 7, LFOOT: 8, RFOOT: 9, SCARF: 10,
};
const CONTACT_COUNT = 10;
const SCARF_COUNT = 7;
export const POINT_COUNT = CONTACT_COUNT + SCARF_COUNT;
const STRIDE = 6; // x, y, prevX, prevY, velX, velY

const POINTS = [
  // x, y, friction
  [0, 0, 0.8],      // PEG
  [0, 5, 0],        // TAIL
  [15, 5, 0],       // NOSE
  [17.5, 0, 0],     // STRING
  [5, 0, 0.8],      // BUTT
  [5, -5.5, 0.8],   // SHOULDER
  [11.5, -5, 0.1],  // RHAND
  [11.5, -5, 0.1],  // LHAND
  [10, 5, 0],       // LFOOT
  [10, 5, 0],       // RFOOT
];
const SCARF_START = [[3, -5.5], [1, -5.5], [-1, -5.5], [-3, -5.5], [-5, -5.5], [-7, -5.5], [-9, -5.5]];
const SCARF_AIR_FRICTION = 0.2;
const FRICTION = POINTS.map((p) => p[2]);

const STICK = 0, BIND = 1, REPEL = 2;
const ENDURANCE = 0.057;
const { PEG, TAIL, NOSE, STRING, BUTT, SHOULDER, RHAND, LHAND, LFOOT, RFOOT } = P;
const CONSTRAINT_DEFS = [
  [STICK, PEG, TAIL], [STICK, TAIL, NOSE], [STICK, NOSE, STRING], [STICK, STRING, PEG],
  [STICK, PEG, NOSE], [STICK, STRING, TAIL],
  [BIND, PEG, BUTT], [BIND, TAIL, BUTT], [BIND, NOSE, BUTT],
  [STICK, SHOULDER, BUTT], [STICK, SHOULDER, LHAND], [STICK, SHOULDER, RHAND],
  [STICK, BUTT, LFOOT], [STICK, BUTT, RFOOT], [STICK, SHOULDER, RHAND],
  [BIND, SHOULDER, PEG], [BIND, STRING, LHAND], [BIND, STRING, RHAND],
  [BIND, LFOOT, NOSE], [BIND, RFOOT, NOSE],
  [REPEL, SHOULDER, LFOOT], [REPEL, SHOULDER, RFOOT],
];
const CONSTRAINTS = CONSTRAINT_DEFS.map(([type, a, b]) => {
  let rest = Math.hypot(POINTS[a][0] - POINTS[b][0], POINTS[a][1] - POINTS[b][1]);
  if (type === REPEL) rest *= 0.5;
  return { type, a, b, rest, endurance: ENDURANCE * rest * 0.5 };
});
const SCARF_LENGTHS = SCARF_START.map((p, i) => {
  const prev = i === 0 ? POINTS[SHOULDER] : SCARF_START[i - 1];
  return Math.hypot(p[0] - prev[0], p[1] - prev[1]);
});

export class RiderState {
  constructor(p, mounted = true, sledIntact = true) {
    this.p = p;
    this.mounted = mounted;
    this.sledIntact = sledIntact;
    this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
  }
  clone() {
    const s = new RiderState(new Float64Array(this.p), this.mounted, this.sledIntact);
    return s;
  }
  x(i) { return this.p[i * STRIDE]; }
  y(i) { return this.p[i * STRIDE + 1]; }
  computeBounds() {
    const p = this.p;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < CONTACT_COUNT; i++) {
      const x = p[i * STRIDE], y = p[i * STRIDE + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    this.minX = x0; this.minY = y0; this.maxX = x1; this.maxY = y1;
  }
  // centre of the rider's body, used by the camera
  center() {
    const ids = [BUTT, SHOULDER, RHAND, LHAND, LFOOT, RFOOT];
    let x = 0, y = 0;
    for (const i of ids) { x += this.p[i * STRIDE]; y += this.p[i * STRIDE + 1]; }
    return { x: x / ids.length, y: y / ids.length };
  }
  velocity() {
    const ids = [BUTT, SHOULDER, RHAND, LHAND, LFOOT, RFOOT];
    let x = 0, y = 0;
    for (const i of ids) { x += this.p[i * STRIDE + 4]; y += this.p[i * STRIDE + 5]; }
    return { x: x / ids.length, y: y / ids.length };
  }
}

export function makeRider(start, vel = START_VELOCITY) {
  const p = new Float64Array(POINT_COUNT * STRIDE);
  const all = [...POINTS.map((q) => [q[0], q[1]]), ...SCARF_START];
  all.forEach(([x, y], i) => {
    const o = i * STRIDE;
    p[o] = x + start.x; p[o + 1] = y + start.y;
    p[o + 2] = p[o] - vel.x; p[o + 3] = p[o + 1] - vel.y;
    p[o + 4] = vel.x; p[o + 5] = vel.y;
  });
  const s = new RiderState(p);
  s.computeBounds();
  return s;
}

// Pseudo-random scarf flutter (canonical GLSL rand)
function rand(x, y) { return (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1; }

function stickResolve(p, a, b, diff) {
  const oa = a * STRIDE, ob = b * STRIDE;
  const dx = (p[oa] - p[ob]) * diff, dy = (p[oa + 1] - p[ob + 1]) * diff;
  p[oa] -= dx; p[oa + 1] -= dy;
  p[ob] += dx; p[ob + 1] += dy;
}

function collide(line, p, i) {
  const o = i * STRIDE;
  if (line.nx * p[o + 4] + line.ny * p[o + 5] <= 0) return; // not moving into the line
  const offX = p[o] - line.x1, offY = p[o + 1] - line.y1;
  const perp = line.nx * offX + line.ny * offY;
  if (!(perp > 0 && perp < ZONE)) return;
  const along = (line.dx * offX + line.dy * offY) * line.invLenSq;
  if (along < line.lb || along > line.rb) return;
  const x = p[o] - line.nx * perp;
  const y = p[o + 1] - line.ny * perp;
  // friction: drag the previous position along the line to bleed off speed
  const fr = FRICTION[i];
  let fx = line.ny * fr * perp;
  let fy = -line.nx * fr * perp;
  if (p[o + 2] >= x) fx = -fx;
  if (p[o + 3] < y) fy = -fy;
  let px = p[o + 2] + fx, py = p[o + 3] + fy;
  if (line.type === LineType.ACCEL) { px += line.ax; py += line.ay; }
  p[o] = x; p[o + 1] = y; p[o + 2] = px; p[o + 3] = py;
}

function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

export function stepRider(prev, track) {
  const s = prev.clone();
  const p = s.p;

  // 1. integrate
  for (let i = 0; i < POINT_COUNT; i++) {
    const o = i * STRIDE;
    const air = i >= CONTACT_COUNT ? 1 - SCARF_AIR_FRICTION : 1;
    const vx = (p[o] - p[o + 2]) * air;
    const vy = (p[o + 1] - p[o + 3]) * air + GRAVITY;
    let nx = p[o] + vx, ny = p[o + 1] + vy;
    if (i >= CONTACT_COUNT) {
      const speed = Math.pow(vx * vx + vy * vy, 0.25);
      const mag = rand(vx, vy) * 2 * speed * -Math.expm1(-speed / 40);
      const ang = rand(p[o], p[o + 1]) * 2 * Math.PI;
      nx += mag * Math.cos(ang);
      ny += mag * Math.sin(ang);
    }
    p[o + 2] = p[o]; p[o + 3] = p[o + 1];
    p[o] = nx; p[o + 1] = ny;
    p[o + 4] = vx; p[o + 5] = vy;
  }

  // 2. constraints + collisions, several passes
  const grid = track.physicsGrid;
  for (let it = 0; it < ITERATIONS; it++) {
    for (let c = 0; c < CONSTRAINTS.length; c++) {
      const k = CONSTRAINTS[c];
      const oa = k.a * STRIDE, ob = k.b * STRIDE;
      const len = Math.hypot(p[oa] - p[ob], p[oa + 1] - p[ob + 1]);
      if (k.type === REPEL && len >= k.rest) continue;
      if (k.type === BIND && !s.mounted) continue;
      const diff = len === 0 ? 0 : ((len - k.rest) / len) * 0.5;
      if (k.type === BIND && diff > k.endurance) { s.mounted = false; continue; }
      stickResolve(p, k.a, k.b, diff);
    }
    for (let i = 0; i < CONTACT_COUNT; i++) {
      const o = i * STRIDE;
      const gx = Math.floor(p[o] / CELL), gy = Math.floor(p[o + 1] / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const lines = grid.cellAt(gx + dx, gy + dy);
          if (!lines) continue;
          for (let l = 0; l < lines.length; l++) collide(lines[l], p, i);
        }
      }
    }
  }

  // 3. crash checks (sled flipped / rider flipped relative to sled)
  const X = (i) => p[i * STRIDE], Y = (i) => p[i * STRIDE + 1];
  const sledX = X(PEG) - X(STRING), sledY = Y(PEG) - Y(STRING);
  if (cross(X(BUTT) - X(SHOULDER), Y(BUTT) - Y(SHOULDER), sledX, sledY) < 0) s.mounted = false;
  if (cross(X(TAIL) - X(PEG), Y(TAIL) - Y(PEG), sledX, sledY) < 0) {
    s.sledIntact = false;
    s.mounted = false;
  }

  // 4. scarf follows the shoulder
  let ax = X(SHOULDER), ay = Y(SHOULDER);
  for (let i = 0; i < SCARF_COUNT; i++) {
    const o = (CONTACT_COUNT + i) * STRIDE;
    const len = Math.hypot(ax - p[o], ay - p[o + 1]);
    const d = len === 0 ? 0 : (len - SCARF_LENGTHS[i]) / len;
    p[o] += (ax - p[o]) * d;
    p[o + 1] += (ay - p[o + 1]) * d;
    ax = p[o]; ay = p[o + 1];
  }

  s.computeBounds();
  return s;
}

// ---------------------------------------------------------------------------
// Simulator: caches every frame so the timeline can be scrubbed

const AFFECT_MARGIN = 25;

export class Simulator {
  constructor(track) {
    this.track = track;
    this.frames = [makeRider(track.start)];
    this.crashFrame = -1;
    track.onChange((kind, line) => {
      if (kind === 'clear' || !line) this.reset();
      else this.invalidateNear(line);
    });
  }

  reset() {
    this.frames = [makeRider(this.track.start)];
    this.crashFrame = -1;
  }

  get computed() { return this.frames.length; }

  // Drop cached frames from the first one where the rider came near this line.
  invalidateNear(line) {
    if (!line.collidable) return;
    const x0 = line.minX - AFFECT_MARGIN, x1 = line.maxX + AFFECT_MARGIN;
    const y0 = line.minY - AFFECT_MARGIN, y1 = line.maxY + AFFECT_MARGIN;
    const f = this.frames;
    for (let i = 0; i < f.length; i++) {
      const s = f[i];
      if (s.maxX >= x0 && s.minX <= x1 && s.maxY >= y0 && s.minY <= y1) {
        this.truncate(Math.max(1, i));
        return;
      }
    }
  }

  truncate(len) {
    if (this.frames.length > len) this.frames.length = len;
    if (this.crashFrame >= len) this.crashFrame = -1;
  }

  frame(n) {
    const f = this.frames;
    while (f.length <= n) {
      const next = stepRider(f[f.length - 1], this.track);
      if (!next.mounted && this.crashFrame < 0) this.crashFrame = f.length;
      f.push(next);
    }
    return f[n];
  }
}

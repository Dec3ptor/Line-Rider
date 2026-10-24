// Turtle-style path builder for generated track.
// Heading angles use screen coordinates (y down): 0 = right, +PI/2 = straight down.
// A rider sitting on the path turns "up" when the heading decreases (a valley)
// and "over" when it increases (a crest).

export const round2 = (v) => Math.round(v * 100) / 100;

export class Path {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.a = angle;
    this.pts = [[round2(x), round2(y)]];
    this.marks = [];       // [{ from, to, type }] point-index ranges with a special line type
  }

  get end() { return { x: this.x, y: this.y, a: this.a }; }
  get count() { return this.pts.length; }

  push(x, y) {
    this.x = x;
    this.y = y;
    this.pts.push([round2(x), round2(y)]);
  }

  line(len, seg = 14) {
    if (len <= 0) return this;
    const n = Math.max(1, Math.ceil(len / seg));
    const dx = Math.cos(this.a) * len / n, dy = Math.sin(this.a) * len / n;
    let x = this.x, y = this.y;
    for (let i = 0; i < n; i++) { x += dx; y += dy; this.push(x, y); }
    return this;
  }

  // turn by dA radians along a circle of the given radius
  arc(radius, dA, seg = 9) {
    if (Math.abs(dA) < 1e-6) return this;
    const len = Math.abs(dA) * radius;
    const n = Math.max(1, Math.ceil(len / seg));
    const step = dA / n;
    const chord = 2 * radius * Math.sin(Math.abs(step) / 2);
    let x = this.x, y = this.y;
    for (let i = 0; i < n; i++) {
      const mid = this.a + step / 2;
      x += Math.cos(mid) * chord;
      y += Math.sin(mid) * chord;
      this.a += step;
      this.push(x, y);
    }
    return this;
  }

  turnTo(target, radius, seg) { return this.arc(radius, target - this.a, seg); }

  // add raw points (e.g. a recorded trajectory)
  through(points, endAngle) {
    for (const [x, y] of points) this.push(x, y);
    if (endAngle != null) this.a = endAngle;
    return this;
  }

  // mark the segments added by fn() with a line type (e.g. boost)
  mark(type, fn) {
    const from = this.pts.length - 1;
    fn(this);
    this.marks.push({ from, to: this.pts.length - 1, type });
    return this;
  }
}

// Convert a path to line data. Brake ranges are drawn backwards and flipped,
// so they stay solid underneath but push against the direction of travel.
export function pathLines(path, baseType = 0) {
  const out = [];
  const typeAt = (i) => {
    for (const m of path.marks) if (i >= m.from && i < m.to) return m.type;
    return baseType;
  };
  for (let i = 0; i < path.pts.length - 1; i++) {
    const [x1, y1] = path.pts[i], [x2, y2] = path.pts[i + 1];
    if (x1 === x2 && y1 === y2) continue;
    let t = typeAt(i);
    if (t === 'brake/2') t = i % 2 ? 'brake' : baseType;   // gentler: every other segment
    if (t === 'boost/2') t = i % 2 ? 1 : baseType;
    if (t === 'brake') out.push({ type: 1, x1: x2, y1: y2, x2: x1, y2: y1, flipped: true });
    else out.push({ type: t, x1, y1, x2, y2, flipped: false });
  }
  return out;
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Small seeded random generator (mulberry32)
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (entries) => {
      let total = 0;
      for (const [, w] of entries) total += Math.max(0, w);
      let r = next() * total;
      for (const [v, w] of entries) { r -= Math.max(0, w); if (r <= 0) return v; }
      return entries[entries.length - 1][0];
    },
    fork: () => makeRng(Math.floor(next() * 4294967296)),
  };
  return rng;
}

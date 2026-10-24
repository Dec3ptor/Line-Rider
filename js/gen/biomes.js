// Themed areas for generated tracks: piece preferences, colours and scenery art.
// All art is made of scenery lines (not solid), each with a colour and width.

import { textLines, textWidth } from './font.js';

const styles = new Map();
export function style(color, width = 1.5) {
  const key = `${color}|${width}`;
  let s = styles.get(key);
  if (!s) { s = Object.freeze({ color, width }); styles.set(key, s); }
  return s;
}

// Collects scenery line data in the current colour.
class Pen {
  constructor(out) { this.out = out; this.st = style('#888'); }
  set(color, width = 1.5) { this.st = style(color, width); return this; }
  line(x1, y1, x2, y2) {
    if (x1 === x2 && y1 === y2) return this;
    this.out.push({ type: 2, x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), style: this.st });
    return this;
  }
  poly(pts, closed = false) {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (closed && pts.length > 2) this.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
    return this;
  }
  arc(cx, cy, rad, a0, a1, segs) {
    const n = segs || Math.max(6, Math.ceil(Math.abs(a1 - a0) * rad / 6));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    return this.poly(pts);
  }
  circle(cx, cy, rad, segs) { return this.arc(cx, cy, rad, 0, Math.PI * 2, segs || Math.max(8, Math.min(28, Math.ceil(rad)))); }
  text(str, x, y, size) {
    for (const d of textLines(str, x, y, size, this.st)) this.out.push(d);
    return this;
  }
}
const r = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Art

const art = {
  pine(p, x, y, h, c = '#3f7d5c', trunk = '#7a5a43') {
    p.set(trunk, 2.5).line(x, y, x, y - h * 0.22);
    const w = h * 0.4;
    p.set(c, 1.6).poly([
      [x - w, y - h * 0.2], [x - w * 0.42, y - h * 0.48], [x - w * 0.78, y - h * 0.48], [x - w * 0.28, y - h * 0.76],
      [x - w * 0.55, y - h * 0.76], [x, y - h], [x + w * 0.55, y - h * 0.76], [x + w * 0.28, y - h * 0.76],
      [x + w * 0.78, y - h * 0.48], [x + w * 0.42, y - h * 0.48], [x + w, y - h * 0.2],
    ], true);
  },
  tree(p, x, y, h, c = '#4caf50', trunk = '#8d6e63') {
    p.set(trunk, 3).line(x, y, x, y - h * 0.55);
    p.set(trunk, 1.6).line(x, y - h * 0.45, x + h * 0.15, y - h * 0.6);
    p.set(c, 1.8).circle(x, y - h * 0.72, h * 0.28).circle(x - h * 0.2, y - h * 0.55, h * 0.18).circle(x + h * 0.22, y - h * 0.58, h * 0.17);
  },
  mountain(p, x, y, w, h, rng, c = '#a9bdd3', snow = '#7fa3c8') {
    const pts = [[x - w / 2, y]];
    const peaks = rng.int(1, 3);
    let px = x - w / 2;
    for (let i = 0; i < peaks; i++) {
      const cx = x - w / 2 + (w * (i + 0.5)) / peaks + rng.range(-w * 0.08, w * 0.08);
      const ph = h * (i === 0 ? 1 : rng.range(0.55, 0.9));
      pts.push([(px + cx) / 2, y - ph * rng.range(0.35, 0.5)]);
      pts.push([cx, y - ph]);
      px = cx;
    }
    pts.push([x + w / 2, y]);
    p.set(c, 2).poly(pts);
    p.set(snow, 1.5);
    // snow line drawn between the two slopes just below each peak
    for (let k = 2; k < pts.length - 1; k += 2) {
      const [px2, py2] = pts[k], [lx, ly] = pts[k - 1], [rx, ry] = pts[k + 1];
      const f = 0.22;
      const L = [px2 + (lx - px2) * f, py2 + (ly - py2) * f];
      const R = [px2 + (rx - px2) * f, py2 + (ry - py2) * f];
      const depth = Math.max(L[1], R[1]) - py2;
      const at = (t, d) => [L[0] + (R[0] - L[0]) * t, L[1] + (R[1] - L[1]) * t + d * depth];
      p.poly([L, at(0.25, 0.3), at(0.5, -0.1), at(0.75, 0.3), R]);
    }
  },
  cloud(p, x, y, w, c = '#b7c7d9') {
    const h = w * 0.28;
    p.set(c, 1.6);
    p.arc(x - w * 0.28, y, h * 0.75, Math.PI * 0.9, Math.PI * 1.75);
    p.arc(x, y - h * 0.25, h, Math.PI * 1.15, Math.PI * 1.9);
    p.arc(x + w * 0.3, y, h * 0.7, Math.PI * 1.25, Math.PI * 2.1);
    p.line(x - w * 0.5, y + h * 0.2, x + w * 0.5, y + h * 0.2);
  },
  sun(p, x, y, rad, c = '#f2b632') {
    p.set(c, 2).circle(x, y, rad);
    p.set(c, 1.5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.line(x + Math.cos(a) * rad * 1.3, y + Math.sin(a) * rad * 1.3, x + Math.cos(a) * rad * 1.65, y + Math.sin(a) * rad * 1.65);
    }
  },
  moon(p, x, y, rad, c = '#9aa3b5') {
    p.set(c, 2).arc(x, y, rad, Math.PI * 0.35, Math.PI * 1.65);
    p.arc(x + rad * 0.45, y, rad * 0.85, Math.PI * 0.55, Math.PI * 1.45);
  },
  star(p, x, y, s, c = '#e9b949') {
    p.set(c, 1.4).line(x - s, y, x + s, y).line(x, y - s, x, y + s);
    p.set(c, 1).line(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.45).line(x - s * 0.45, y + s * 0.45, x + s * 0.45, y - s * 0.45);
  },
  bird(p, x, y, s, c = '#5d6470') {
    p.set(c, 1.3).arc(x - s / 2, y + s * 0.4, s / 2, Math.PI * 1.2, Math.PI * 1.85).arc(x + s / 2, y + s * 0.4, s / 2, Math.PI * 1.15, Math.PI * 1.8);
  },
  planet(p, x, y, rad, c = '#9b8cd8', ring = '#c5b0f0') {
    p.set(c, 2).circle(x, y, rad);
    p.set(ring, 1.5);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * 0.05 + (i / 24) * Math.PI * 0.9;
      pts.push([x + Math.cos(a) * rad * 1.8, y + Math.sin(a) * rad * 0.45]);
    }
    p.poly(pts);
    p.line(pts[0][0], pts[0][1], x + rad * 1.8, y - rad * 0.05);
  },
  rocket(p, x, y, s, c = '#e2574c') {
    p.set('#8a93a6', 1.6).poly([[x, y - s * 1.2], [x + s * 0.3, y - s * 0.7], [x + s * 0.3, y + s * 0.3], [x - s * 0.3, y + s * 0.3], [x - s * 0.3, y - s * 0.7]], true);
    p.set(c, 1.6).poly([[x - s * 0.3, y], [x - s * 0.6, y + s * 0.5], [x - s * 0.3, y + s * 0.3]]).poly([[x + s * 0.3, y], [x + s * 0.6, y + s * 0.5], [x + s * 0.3, y + s * 0.3]]);
    p.circle(x, y - s * 0.45, s * 0.12, 8);
    p.set('#f2a43a', 1.4).poly([[x - s * 0.18, y + s * 0.35], [x, y + s * 0.9], [x + s * 0.18, y + s * 0.35]]);
  },
  cactus(p, x, y, h, c = '#4c9a5b') {
    p.set(c, 5).line(x, y, x, y - h);
    p.set(c, 4);
    const ay = y - h * 0.5, by = y - h * 0.65;
    p.line(x, ay, x - h * 0.28, ay).line(x - h * 0.28, ay, x - h * 0.28, ay - h * 0.25);
    p.line(x, by, x + h * 0.25, by).line(x + h * 0.25, by, x + h * 0.25, by - h * 0.2);
  },
  mesa(p, x, y, w, h, rng, c = '#d9935f') {
    const t = w * rng.range(0.25, 0.4);
    p.set(c, 2).poly([[x - w / 2, y], [x - t - w * 0.05, y - h * 0.6], [x - t, y - h], [x + t, y - h], [x + t + w * 0.07, y - h * 0.55], [x + w / 2, y]]);
    p.set(c, 1);
    for (let k = 1; k <= 3; k++) {
      const yy = y - h + (h * k) / 4;
      const half = t + (w / 2 - t) * (k / 4) * 0.8;
      p.line(x - half + 4, yy, x + half - 4, yy);
    }
  },
  rock(p, x, y, s, rng, c = '#9c8a7a') {
    p.set(c, 1.8).poly([[x - s, y], [x - s * 0.8, y - s * 0.6], [x - s * 0.1, y - s * rng.range(0.8, 1.1)], [x + s * 0.7, y - s * 0.55], [x + s, y]]);
  },
  building(p, x, y, w, h, rng, c = '#8890a3', win = '#f0c23b') {
    p.set(c, 1.8).poly([[x, y], [x, y - h], [x + w, y - h], [x + w, y]]);
    if (rng.chance(0.4)) p.set(c, 1.2).line(x + w * 0.5, y - h, x + w * 0.5, y - h - rng.range(10, 30));
    p.set(win, 2.2);
    const cols = Math.max(1, Math.floor(w / 9));
    const rows = Math.max(1, Math.floor(h / 13));
    const maxWindows = 26;
    let n = 0;
    for (let rr = 0; rr < rows && n < maxWindows; rr++) {
      for (let cc = 0; cc < cols && n < maxWindows; cc++) {
        if (!rng.chance(0.42)) continue;
        const wx = x + (w / cols) * (cc + 0.5);
        const wy = y - h + 8 + rr * 13;
        p.line(wx - 2, wy, wx + 2, wy);
        n++;
      }
    }
  },
  crane(p, x, y, h, c = '#f39c4a') {
    p.set(c, 1.6).line(x, y, x, y - h).line(x + 5, y, x + 5, y - h);
    for (let k = 0; k < h - 12; k += 12) p.line(x, y - k, x + 5, y - k - 12);
    p.line(x - h * 0.3, y - h, x + h * 0.6, y - h).line(x + 2.5, y - h - 10, x - h * 0.3, y - h).line(x + 2.5, y - h - 10, x + h * 0.6, y - h);
    p.set('#666', 1).line(x + h * 0.45, y - h, x + h * 0.45, y - h * 0.6);
  },
  lamp(p, x, y, h, c = '#666', glow = '#f6c945') {
    p.set(c, 1.6).line(x, y, x, y - h).line(x, y - h, x + 7, y - h);
    p.set(glow, 2.5).line(x + 5, y - h + 2, x + 9, y - h + 2);
  },
  volcano(p, x, y, w, h, c = '#8d6e63', lava = '#ef5b2a') {
    const t = w * 0.12;
    p.set(c, 2).poly([[x - w / 2, y], [x - t, y - h], [x - t * 0.4, y - h + 6], [x + t * 0.4, y - h + 6], [x + t, y - h], [x + w / 2, y]]);
    p.set(lava, 2).poly([[x - t * 0.6, y - h + 3], [x - t * 0.9, y - h * 0.7], [x - t * 1.6, y - h * 0.45], [x - t * 2.2, y - h * 0.2]]);
    p.poly([[x + t * 0.5, y - h + 3], [x + t * 1.1, y - h * 0.6], [x + t * 1.4, y - h * 0.3]]);
    p.set('#b0a59f', 1.5).circle(x - 4, y - h - 14, 8).circle(x + 8, y - h - 30, 11).circle(x - 2, y - h - 52, 14);
  },
  palm(p, x, y, h, rng) {
    const lean = rng.range(-0.25, 0.25) * h;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x + lean * t * t, y - h * t]);
    }
    p.set('#a1887f', 3).poly(pts);
    const tx = x + lean, ty = y - h;
    p.set('#3d9a50', 2);
    for (const a of [-2.7, -2.1, -1.4, -0.7, -0.2]) {
      const ex = tx + Math.cos(a) * h * 0.45, ey = ty + Math.sin(a) * h * 0.45 + h * 0.12;
      p.poly([[tx, ty], [(tx + ex) / 2 + Math.cos(a - 1.57) * 4, (ty + ey) / 2 - 6], [ex, ey]]);
    }
  },
  boat(p, x, y, s) {
    p.set('#7a5a43', 2).poly([[x - s, y - s * 0.3], [x - s * 0.7, y], [x + s * 0.7, y], [x + s, y - s * 0.3]], true);
    p.set('#555', 1.4).line(x, y - s * 0.3, x, y - s * 1.6);
    p.set('#e35d5b', 1.6).poly([[x + 1, y - s * 1.55], [x + s * 0.8, y - s * 0.45], [x + 1, y - s * 0.45]], true);
  },
  waves(p, x, y, w, c = '#4aa3df') {
    const pts = [];
    for (let i = 0; i <= 24; i++) pts.push([x + (w * i) / 24, y + Math.sin(i * 0.9) * 3]);
    p.set(c, 1.6).poly(pts);
  },
  snowman(p, x, y, h) {
    p.set('#8fa9c4', 1.6).circle(x, y - h * 0.22, h * 0.22).circle(x, y - h * 0.58, h * 0.16).circle(x, y - h * 0.84, h * 0.11);
    p.set('#f08a24', 1.8).line(x + h * 0.08, y - h * 0.84, x + h * 0.24, y - h * 0.82);
    p.set('#333', 2.5).line(x - h * 0.1, y - h * 0.95, x + h * 0.1, y - h * 0.95);
  },
  mushroom(p, x, y, h) {
    p.set('#d8c3a5', 2.5).line(x, y, x, y - h * 0.6);
    p.set('#e0533d', 2).arc(x, y - h * 0.55, h * 0.45, Math.PI, Math.PI * 2).line(x - h * 0.45, y - h * 0.55, x + h * 0.45, y - h * 0.55);
  },
  lollipop(p, x, y, h, c) {
    p.set('#c9b8a6', 2).line(x, y, x, y - h * 0.65);
    p.set(c, 2.2);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = i * 0.47, rad = (h * 0.32 * i) / 40;
      pts.push([x + Math.cos(a) * rad, y - h * 0.65 - h * 0.32 + Math.sin(a) * rad]);
    }
    p.poly(pts);
    p.circle(x, y - h * 0.97, h * 0.32);
  },
  cane(p, x, y, h) {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([x, y - (h * 0.8 * i) / 10]);
    for (let i = 1; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      pts.push([x + h * 0.15 + Math.cos(a) * h * 0.15, y - h * 0.8 + Math.sin(a) * h * 0.15]);
    }
    for (let i = 1; i < pts.length; i++) {
      p.set(i % 2 ? '#e8414f' : '#f3c6cb', 3.2).line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
  },
  gumdrop(p, x, y, s, c) {
    p.set(c, 2).arc(x, y, s, Math.PI, Math.PI * 2).line(x - s, y, x + s, y);
  },
  ufo(p, x, y, s) {
    p.set('#7d8597', 1.8).poly([[x - s, y], [x - s * 0.5, y - s * 0.3], [x + s * 0.5, y - s * 0.3], [x + s, y], [x + s * 0.5, y + s * 0.2], [x - s * 0.5, y + s * 0.2]], true);
    p.set('#5fd0c4', 1.6).arc(x, y - s * 0.3, s * 0.42, Math.PI, Math.PI * 2);
    p.set('#f6c945', 2.2).line(x - s * 0.5, y + s * 0.02, x - s * 0.4, y + s * 0.02).line(x + s * 0.4, y + s * 0.02, x + s * 0.5, y + s * 0.02);
  },
  grass(p, x, y, c = '#6abf69') {
    p.set(c, 1.2).line(x, y, x - 2, y - 6).line(x, y, x + 0.5, y - 7).line(x, y, x + 3, y - 5);
  },
  // banner arch over the track at (x, y), e.g. START / FINISH
  arch(p, x, y, text, color = '#333') {
    const half = Math.max(46, textWidth(text, 12) / 2 + 16);
    const top = y - 92;
    p.set('#555', 3).line(x - half, y + 40, x - half, top).line(x + half, y + 40, x + half, top);
    p.set(color, 2).poly([[x - half, top], [x + half, top], [x + half, top + 22], [x - half, top + 22]], true);
    p.set(color, 1.8).text(text, x - textWidth(text, 12) / 2, top + 5, 12);
    // chequered strip
    for (let i = 0; i < 12; i++) {
      const sx = x - half + (2 * half * i) / 12;
      p.set(i % 2 ? '#222' : '#ddd', 4).line(sx + 1, top + 26, sx + (2 * half) / 12 - 1, top + 26);
    }
    // pennants
    p.set('#e0261b', 1.6).poly([[x - half, top], [x - half, top - 18], [x - half + 14, top - 13], [x - half, top - 8]]);
    p.set('#1565e6', 1.6).poly([[x + half, top], [x + half, top - 18], [x + half - 14, top - 13], [x + half, top - 8]]);
  },
  sign(p, x, y, text, size, post = '#7a5a43', board = '#7a5a43', ink = '#333') {
    const w = textWidth(text, size) + size * 1.2;
    const h = size * 2;
    p.set(post, 3).line(x, y, x, y - size * 1.5);
    p.set(board, 2).poly([[x - w / 2, y - h - size * 1.5], [x + w / 2, y - h - size * 1.5], [x + w / 2, y - size * 1.5], [x - w / 2, y - size * 1.5]], true);
    p.set(ink, Math.max(1.4, size / 8)).text(text, x - w / 2 + size * 0.6, y - h - size * 1.5 + size * 0.5, size);
  },
};

// ---------------------------------------------------------------------------
// Track decoration helpers

// points along the track paths with a "down" normal for each
function samplePaths(paths) {
  const out = [];
  for (const path of paths) {
    const pts = path.pts;
    const list = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      list.push({ x: pts[i][0], y: pts[i][1], nx: -dy / l, ny: dx / l, a: Math.atan2(dy, dx) });
    }
    out.push({ path, pts: list });
  }
  return out;
}

function underlay(p, samples, kind, c1, c2) {
  for (const { pts } of samples) {
    const off = kind === 'planks' ? 4 : kind === 'rail' ? 5 : 8;
    const lo = pts.map((q) => [q.x + q.nx * off, q.y + q.ny * off]);
    if (kind === 'stripes') {
      for (let i = 1; i < lo.length; i++) p.set(i % 2 ? c1 : c2, 3).line(lo[i - 1][0], lo[i - 1][1], lo[i][0], lo[i][1]);
      continue;
    }
    p.set(c1, kind === 'truss' ? 1.4 : 1.5).poly(lo);
    if (kind === 'rail') {
      const lo2 = pts.map((q) => [q.x + q.nx * 10, q.y + q.ny * 10]);
      p.set(c2, 1.2).poly(lo2);
    }
    p.set(c2 || c1, 1);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (kind === 'hatch' && i % 2 === 0) p.line(q.x + q.nx * 2, q.y + q.ny * 2, lo[Math.min(i + 1, lo.length - 1)][0], lo[Math.min(i + 1, lo.length - 1)][1]);
      else if (kind === 'truss' && i > 0) p.line(i % 2 ? q.x : lo[i][0], i % 2 ? q.y : lo[i][1], i % 2 ? lo[i - 1][0] : pts[i - 1].x, i % 2 ? lo[i - 1][1] : pts[i - 1].y);
      else if (kind === 'planks') p.line(q.x + q.nx * 1.5, q.y + q.ny * 1.5, lo[i][0], lo[i][1]);
      else if (kind === 'snow' && i % 3 === 0) p.line(lo[i][0], lo[i][1], lo[i][0] - q.ny * 3 + q.nx * 3, lo[i][1] + q.nx * 3 + q.ny * 3);
    }
  }
}

function posts(p, samples, depth, c, every = 4) {
  p.set(c, 2);
  for (const { pts } of samples) {
    for (let i = 2; i < pts.length - 1; i += every) {
      const q = pts[i];
      if (Math.abs(q.a) > 1.2) continue;
      p.line(q.x + q.nx * 8, q.y + q.ny * 8, q.x + q.nx * 8, q.y + depth);
    }
  }
}

// lowest track y at a given x (or null)
function trackYAt(samples, x) {
  let best = null;
  for (const { pts } of samples) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
        const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
        const y = a.y + (b.y - a.y) * t;
        if (best == null || y > best) best = y;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Biomes

export const BIOMES = [
  {
    id: 'alpine', name: 'Frosty Peaks', tint: '#eef5fc',
    weights: { kicker: 3.5, drop: 2.5, flip: 2.5, rollers: 2 },
    underlay: ['snow', '#9fc0e0', '#9fc0e0'], posts: '#8a6a50',
    big: (p, x, y, rng) => art.mountain(p, x, y + rng.range(120, 260), rng.range(300, 600), rng.range(220, 420), rng),
    ground: (p, x, y, rng) => rng.chance(0.15) ? art.snowman(p, x, y, rng.range(26, 36)) : art.pine(p, x, y, rng.range(30, 70)),
    sky: (p, x, y, rng) => rng.chance(0.7) ? art.cloud(p, x, y, rng.range(50, 110)) : art.bird(p, x, y, 8),
  },
  {
    id: 'forest', name: 'Whispering Woods', tint: '#f0f8ec',
    weights: { rollers: 3, gaps: 2.5, kicker: 2.5, cruise: 2 },
    underlay: ['hatch', '#a1887f', '#6abf69'], posts: '#8d6e63',
    big: (p, x, y, rng) => { for (let k = 0; k < 4; k++) art.pine(p, x + k * 22 + rng.range(-6, 6), y + rng.range(60, 120), rng.range(60, 110), '#2f8a4a'); },
    ground: (p, x, y, rng) => {
      const k = rng.next();
      if (k < 0.45) art.tree(p, x, y, rng.range(40, 80));
      else if (k < 0.75) art.pine(p, x, y, rng.range(40, 80), '#2f8a4a');
      else art.mushroom(p, x, y, rng.range(10, 18));
    },
    sky: (p, x, y, rng) => rng.chance(0.25) ? art.sun(p, x, y, 16, '#f4c542') : art.bird(p, x, y, rng.range(6, 10)),
  },
  {
    id: 'desert', name: 'Canyon Run', tint: '#fdf5e8',
    weights: { drop: 3.5, steps: 2.5, gaps: 2, kicker: 2.5 },
    underlay: ['hatch', '#d7a77a', '#d7a77a'], posts: '#b08d6c',
    big: (p, x, y, rng) => art.mesa(p, x, y + rng.range(140, 260), rng.range(220, 420), rng.range(140, 260), rng),
    ground: (p, x, y, rng) => rng.chance(0.6) ? art.cactus(p, x, y, rng.range(24, 44)) : art.rock(p, x, y, rng.range(8, 18), rng),
    sky: (p, x, y, rng) => rng.chance(0.2) ? art.sun(p, x, y, 18) : art.bird(p, x, y, 9, '#8a6a50'),
  },
  {
    id: 'city', name: 'Neon City', tint: '#f3f2f9',
    weights: { gaps: 3, steps: 3, loop: 2.5, kicker: 2.5, booster: 0.5 },
    underlay: ['truss', '#7d8597', '#9aa1b1'], posts: '#7d8597',
    big: (p, x, y, rng) => {
      let bx = x - 120;
      while (bx < x + 120) {
        const w = rng.range(26, 60);
        art.building(p, bx, y + rng.range(160, 260), w, rng.range(90, 230), rng);
        bx += w + rng.range(4, 16);
      }
    },
    ground: (p, x, y, rng) => rng.chance(0.7) ? art.lamp(p, x, y, rng.range(26, 34)) : art.crane(p, x, y + 40, rng.range(90, 140)),
    sky: (p, x, y, rng) => rng.chance(0.5) ? art.moon(p, x, y, 14) : art.star(p, x, y, 4),
  },
  {
    id: 'space', name: 'Star Lanes', tint: '#eeedf8',
    weights: { loop: 3.5, flip: 3, kicker: 2.5, drop: 2, rollers: 1 },
    underlay: ['rail', '#8e7cc3', '#c5b0f0'], posts: null,
    big: (p, x, y, rng) => art.planet(p, x, y - rng.range(120, 240), rng.range(20, 42)),
    ground: (p, x, y, rng) => rng.chance(0.5) ? art.star(p, x, y - rng.range(0, 60), rng.range(3, 6)) : art.rocket(p, x, y - 40, rng.range(14, 22)),
    sky: (p, x, y, rng) => rng.chance(0.75) ? art.star(p, x, y, rng.range(3, 6)) : art.ufo(p, x, y, rng.range(14, 22)),
  },
  {
    id: 'volcano', name: 'Lava Falls', tint: '#fcf0ea',
    weights: { drop: 3, kicker: 3, flip: 2.5, gaps: 2 },
    underlay: ['hatch', '#6d5d57', '#ef7b4a'], posts: '#6d5d57',
    big: (p, x, y, rng) => art.volcano(p, x, y + rng.range(160, 260), rng.range(260, 420), rng.range(160, 260)),
    ground: (p, x, y, rng) => rng.chance(0.6) ? art.rock(p, x, y, rng.range(8, 20), rng, '#6d5d57') : art.waves(p, x - 20, y, 40, '#ef5b2a'),
    sky: (p, x, y, rng) => p.set('#b0a59f', 1.5).circle(x, y, rng.range(8, 16)),
  },
  {
    id: 'beach', name: 'Sunny Bay', tint: '#edf8fa',
    weights: { rollers: 3, cruise: 2.5, kicker: 2.5, loop: 2 },
    underlay: ['planks', '#b08d6c', '#b08d6c'], posts: '#a1887f',
    big: (p, x, y, rng) => { const yy = y + rng.range(140, 220); art.waves(p, x - 120, yy, 240); art.waves(p, x - 100, yy + 14, 200); if (rng.chance(0.6)) art.boat(p, x + rng.range(-60, 60), yy - 4, rng.range(14, 22)); },
    ground: (p, x, y, rng) => art.palm(p, x, y, rng.range(40, 70), rng),
    sky: (p, x, y, rng) => rng.chance(0.3) ? art.sun(p, x, y, 18) : art.bird(p, x, y, 8),
  },
  {
    id: 'candy', name: 'Sugar Rush', tint: '#fdf0f6',
    weights: { loop: 3, rollers: 3, gaps: 2, flip: 2 },
    underlay: ['stripes', '#f49cc4', '#8fdcc6'], posts: '#ec6fa8',
    big: (p, x, y, rng) => { for (let k = 0; k < 3; k++) art.gumdrop(p, x + k * 40 - 40, y + rng.range(120, 200), rng.range(14, 26), rng.pick(['#ec6fa8', '#4cc9a7', '#f6c945', '#8e7cc3'])); },
    ground: (p, x, y, rng) => rng.chance(0.5) ? art.lollipop(p, x, y, rng.range(30, 50), rng.pick(['#ec6fa8', '#4cc9a7', '#8e7cc3'])) : art.cane(p, x, y, rng.range(30, 46)),
    sky: (p, x, y, rng) => art.cloud(p, x, y, rng.range(50, 100), '#f2b8d0'),
  },
];

export const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

// Scenery for one generated piece.
export function decoratePiece(gen, piece, rng) {
  const out = [];
  const p = new Pen(out);
  const biome = piece.biome || BIOMES[0];
  const info = piece.info || {};
  const paths = info.paths || [];
  const samples = samplePaths(paths);
  if (!samples.length) return out;

  // decoration under the track itself
  const [kind, c1, c2] = biome.underlay;
  underlay(p, samples, kind, c1, c2);

  // stilts under ramps and landings
  if (biome.posts) {
    const ramps = samplePaths([info.kick, info.land, ...(info.parts || []).flatMap((q) => [q.kick, q.land])].filter(Boolean));
    posts(p, ramps, rng.range(70, 140), biome.posts, 5);
  }

  // loop frame
  for (const L of info.loops || []) {
    p.set(c1, 1.2).circle(L.cx, L.cy, L.R + 14, 28);
    p.set(c1, 1.4).line(L.cx, L.cy + L.R + 14, L.cx, L.cy + L.R + 60);
  }

  const x0 = Math.min(piece.start.x, piece.end.x), x1 = Math.max(piece.start.x, piece.end.x);
  // far background: mountains, skylines, planets...
  for (let x = x0 + rng.range(0, 250); x < x1; x += rng.range(300, 560)) {
    const y = trackYAt(samples, x);
    if (y != null) biome.big(p, x, y, rng);
  }
  // things on the ground below the track, in little clusters
  for (let x = x0 + rng.range(0, 60); x < x1; x += rng.range(50, 130)) {
    const y = trackYAt(samples, x);
    if (y == null) continue;
    const n = rng.int(1, 3);
    let gx = x;
    const gy = y + rng.range(50, 170);
    for (let k = 0; k < n; k++) {
      biome.ground(p, gx, gy + rng.range(-8, 8), rng);
      gx += rng.range(14, 34);
    }
  }
  // sky
  for (let x = x0 + rng.range(0, 150); x < x1; x += rng.range(130, 280)) {
    const y = trackYAt(samples, x);
    if (y != null) biome.sky(p, x, y - rng.range(110, 300), rng);
  }

  if (info.startArch) art.arch(p, piece.start.x + 60, trackYAt(samples, piece.start.x + 60) ?? piece.start.y, 'START', '#2e7d32');
  if (info.finishAt) art.arch(p, info.finishAt.x, info.finishAt.y, 'FINISH', '#c62828');

  // signs: entering a new area, and distance markers
  if (piece.newBiome && piece.kind !== 'start') {
    const y = trackYAt(samples, x0 + 40) ?? piece.start.y;
    art.sign(p, x0 + 40, y + 70, biome.name, 10, '#7a5a43', '#7a5a43', '#333');
  }
  const step = 2000;
  const mark = Math.ceil(x0 / step) * step;
  if (mark > 0 && mark < x1) {
    const y = trackYAt(samples, mark);
    if (y != null) art.sign(p, mark, y + 60, `${mark / 10} M`, 8, '#888', '#888', '#555');
  }
  return out;
}

export { art, Pen };

// Turns generated track into scenery: every solid line becomes the edge of
// something (a rock ledge, a rooftop, a girder, a plank, a crate...), built on
// the line's solid side and carved so it never covers the path Bosh rides.

import { Pen, art } from './biomes.js';

const SHAPES = {
  alpine: { body: 'rock', color: '#8fa5bd', accent: '#c4d6e8', support: 'post', supportColor: '#8a6a50', house: 'chalet', tap: 'ice' },
  forest: { body: 'log', color: '#8d6e63', accent: '#6abf69', support: 'trunk', supportColor: '#7a5a43', house: 'hut', tap: 'mushroom' },
  desert: { body: 'rock', color: '#d9935f', accent: '#b5733f', support: 'pillar', supportColor: '#c98552', house: 'adobe', tap: 'cactus' },
  city: { body: 'brick', color: '#8890a3', accent: '#f0c23b', support: 'girder', supportColor: '#7d8597', house: 'tower', tap: 'crate' },
  space: { body: 'metal', color: '#8e7cc3', accent: '#5fd0c4', support: 'none', supportColor: '#8e7cc3', house: 'pod', tap: 'gem' },
  volcano: { body: 'rock', color: '#6d5d57', accent: '#ef5b2a', support: 'pillar', supportColor: '#6d5d57', house: 'hut', tap: 'ember' },
  beach: { body: 'plank', color: '#b08d6c', accent: '#4aa3df', support: 'post', supportColor: '#a1887f', house: 'hut', tap: 'buoy' },
  candy: { body: 'candy', color: '#f49cc4', accent: '#8fdcc6', support: 'cane', supportColor: '#e8414f', house: 'gingerbread', tap: 'gum' },
};

const CLEAR = 7;   // keep this far from anywhere the rider has been

export function dressChunk(gen, chunk, rng) {
  const out = [];
  const p = new Pen(out);
  const biome = chunk.biome || gen.biome;
  const sh = SHAPES[biome?.id] || SHAPES.alpine;
  const path = gen.path;
  const free = (x, y, r = CLEAR) => !path.near(x, y, r);

  for (const strip of strips(chunk.lines)) {
    const pts = strip.pts;               // [{x, y, nx, ny}] along the strip, normals point into the solid side
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len < 1) continue;

    // how deep can the body go at each point without covering the ride?
    // (the rider's contact points sit right on the surface, so test from a little way in)
    const maxDepth = len < 12 ? 10 : sh.body === 'plank' || sh.body === 'log' ? 8 : rng.range(18, 48);
    const depth = pts.map((q) => {
      let d = 0;
      for (let k = 10; k <= Math.max(10, maxDepth); k += 5) {
        if (!free(q.x + q.nx * k, q.y + q.ny * k, 6)) break;
        d = Math.min(k, maxDepth);
      }
      return d;
    });
    // also check between points on long segments
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 7 / segLen; t < 1; t += 7 / segLen) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const d = Math.min(depth[i - 1], depth[i]);
        if (d > 0 && !free(x + a.nx * d, y + a.ny * d, 6)) { depth[i - 1] = Math.min(depth[i - 1], 4); depth[i] = Math.min(depth[i], 4); }
      }
    }
    const minDepth = Math.min(...depth);

    if (pts.length === 2 && len < 12) {
      if (minDepth >= 4) tapObject(p, sh, pts, len, minDepth, rng);
      else p.set(sh.color, 1.2).line(pts[0].x + pts[0].nx * 2.5, pts[0].y + pts[0].ny * 2.5, pts[1].x + pts[1].nx * 2.5, pts[1].y + pts[1].ny * 2.5);
      continue;
    }
    if (pts.length === 2 && strip.role === 'floor' && len > 16 && len < 75 && rng.chance(0.35) && house(p, sh, strip.line, free, rng)) continue;

    const squeezed = depth.filter((d) => d < 4).length;
    let bottom = null;
    if (squeezed > pts.length / 2) {
      // squeezed: just a slim edge
      p.set(sh.color, 1.2).poly(pts.map((q) => [q.x + q.nx * 2.5, q.y + q.ny * 2.5]));
    } else {
      // the body tapers wherever the ride passes close underneath
      for (let i = 0; i < depth.length; i++) depth[i] = Math.max(3, depth[i]);
      bottom = stripBody(p, sh, pts, depth, len, rng);
    }

    // hold it up (floors) or hang it (ceilings)
    if (bottom && sh.support !== 'none' && len > 14) {
      const every = rng.range(70, 140);
      for (let at = rng.range(10, every * 0.6); at < len - 6; at += every) {
        const q = pointAt(pts, at);
        if (!q || Math.abs(q.ny) < 0.5) continue;
        const dir = q.ny > 0 ? 1 : -1;
        const d = bottom[q.i];
        if (depth[q.i] < 8) continue;
        const bx = q.x + q.nx * d, by = q.y + q.ny * d;
        let reach = 0;
        const maxReach = rng.range(60, 220);
        while (reach < maxReach && free(bx, by + dir * (reach + 8), 9)) reach += 8;
        if (reach >= 16) support(p, sh, bx, by, dir, reach, rng);
      }
    }
  }

  // a little landscape around it, kept clear of the ride
  const ls = chunk.lines.filter((l) => l.collidable);
  if (ls.length && biome) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of ls) { x0 = Math.min(x0, l.minX); x1 = Math.max(x1, l.maxX); y0 = Math.min(y0, l.minY); y1 = Math.max(y1, l.maxY); }
    const span = x1 - x0;
    const n = Math.min(6, Math.round(span / 150) + (rng.chance(0.5) ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const x = rng.range(x0 - 40, x1 + 40);
      const roll = rng.next();
      if (roll < 0.25) {
        const y = y1 + rng.range(80, 220);
        if (free(x, y - 40, 40)) biome.big(p, x, y, rng);
      } else if (roll < 0.7) {
        const y = y1 + rng.range(40, 160);
        if (free(x, y - 30, 30)) biome.ground(p, x, y, rng);
      } else {
        const y = y0 - rng.range(80, 240);
        if (free(x, y, 30)) biome.sky(p, x, y, rng);
      }
    }
  }
  // start and finish gates on built-in maps
  const info = chunk.info || {};
  if (info.startArch && ls.length) {
    const x = ls[0].x1 + 90;
    art.arch(p, x, trackY(ls, x) ?? ls[0].y1, 'START', '#2e7d32');
  }
  if (info.finishAt) art.arch(p, info.finishAt.x, info.finishAt.y, 'FINISH', '#c62828');
  return out;
}

// height of the track at x (first line spanning it)
function trackY(lines, x) {
  for (const l of lines) {
    if (l.minX <= x && l.maxX >= x && l.maxX > l.minX) return l.y1 + ((x - l.x1) / (l.x2 - l.x1)) * (l.y2 - l.y1);
  }
  return null;
}

// Chain lines that share end points into strips, each with a solid-side normal per point.
function strips(lines) {
  const segs = lines.filter((l) => l.collidable).map((l) => ({ l, used: false }));
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const byEnd = new Map();
  for (const s of segs) {
    for (const [x, y] of [[s.l.x1, s.l.y1], [s.l.x2, s.l.y2]]) {
      const k = key(x, y);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(s);
    }
  }
  const out = [];
  for (const s0 of segs) {
    if (s0.used) continue;
    s0.used = true;
    // walk both ways from this segment
    let chain = [s0.l];
    let a = { x: s0.l.x1, y: s0.l.y1 }, b = { x: s0.l.x2, y: s0.l.y2 };
    for (const forward of [true, false]) {
      let end = forward ? b : a;
      for (;;) {
        const next = (byEnd.get(key(end.x, end.y)) || []).find((s) => !s.used);
        if (!next) break;
        next.used = true;
        const l = next.l;
        const far = Math.abs(l.x1 - end.x) < 0.05 && Math.abs(l.y1 - end.y) < 0.05 ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 };
        if (forward) chain.push(l); else chain.unshift(l);
        end = far;
      }
      if (forward) b = end; else a = end;
    }
    // ordered points from a to b
    const pts = [{ x: a.x, y: a.y }];
    let cur = a;
    for (const l of chain) {
      const far = Math.abs(l.x1 - cur.x) < 0.05 && Math.abs(l.y1 - cur.y) < 0.05 ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 };
      pts.push({ x: far.x, y: far.y });
      cur = far;
    }
    // per-point normals: average of the neighbouring segments' solid sides
    for (let i = 0; i < pts.length; i++) {
      let nx = 0, ny = 0;
      if (i > 0) { nx += chain[i - 1].nx; ny += chain[i - 1].ny; }
      if (i < chain.length) { nx += chain[i].nx; ny += chain[i].ny; }
      const nl = Math.hypot(nx, ny) || 1;
      pts[i].nx = nx / nl;
      pts[i].ny = ny / nl;
    }
    const n0 = chain[0];
    out.push({ pts, line: n0, role: n0.ny > 0.55 ? 'floor' : n0.ny < -0.55 ? 'ceiling' : 'wall' });
  }
  return out;
}

function pointAt(pts, dist) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= dist) {
      const t = (dist - acc) / l;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: a.nx, ny: a.ny, i: t < 0.5 ? i - 1 : i };
    }
    acc += l;
  }
  return null;
}

// The body under a whole strip: top edge is the track, the rest is drawn here.
function stripBody(p, sh, pts, depth, len, rng) {
  const c = sh.color;
  const off = (i, d) => [pts[i].x + pts[i].nx * d, pts[i].y + pts[i].ny * d];
  const last = pts.length - 1;
  // fewer points for the inner details (curves have lots of short segments)
  const few = [0];
  for (let i = 1, acc = 0; i < last; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= 12) { few.push(i); acc = 0; }
  }
  if (last > 0) few.push(last);
  switch (sh.body) {
    case 'rock': {
      const ds = depth.map((d, i) => d * (i === 0 || i === last ? 0.6 : rng.range(0.7, 1)));
      // thin out very dense points for a rugged edge
      for (let i = 1; i < last; i += 2) ds[i] = (ds[i - 1] + ds[i + 1]) / 2;
      const edge = few.map((i) => off(i, ds[i]));
      p.set(c, 1.6).poly([[pts[0].x, pts[0].y], ...edge, [pts[last].x, pts[last].y]]);
      p.set(sh.accent, 1);
      for (let k = 0; k < Math.min(4, Math.floor(len / 30)); k++) {
        const q = pointAt(pts, rng.range(len * 0.1, len * 0.9));
        if (!q) continue;
        const d = depth[q.i] * rng.range(0.3, 0.6);
        p.line(q.x + q.nx * 3, q.y + q.ny * 3, q.x + q.nx * d + rng.range(-4, 4), q.y + q.ny * d + rng.range(-4, 4));
      }
      return ds;
    }
    case 'brick': {
      p.set(c, 1.5).poly([[pts[0].x, pts[0].y], ...few.map((i) => off(i, depth[i])), [pts[last].x, pts[last].y]]);
      p.set(c, 0.8);
      const minD = Math.min(...depth);
      for (let d = 8; d < minD - 2; d += 8) p.poly(few.map((i) => off(i, d)));
      p.set(sh.accent, 2);
      for (let at = 8; at < len - 6 && minD > 14; at += rng.range(18, 36)) {
        const q = pointAt(pts, at);
        if (!q) continue;
        const d = rng.range(8, minD - 4);
        p.line(q.x + q.nx * d, q.y + q.ny * d, q.x + q.nx * d + (pts[last].x - pts[0].x) / len * 3, q.y + q.ny * d + (pts[last].y - pts[0].y) / len * 3);
      }
      return depth;
    }
    case 'metal': {
      p.set(c, 1.6).poly([[pts[0].x, pts[0].y], ...few.map((i) => off(i, depth[i])), [pts[last].x, pts[last].y]]);
      p.set(sh.accent, 1.2).poly(few.map((i) => off(i, depth[i] / 2)));
      return depth;
    }
    case 'candy': {
      const ds = depth.map((d) => Math.min(d, 12));
      for (let k = 1; k < few.length; k++) {
        const [ax, ay] = off(few[k - 1], ds[few[k - 1]] / 2), [bx, by] = off(few[k], ds[few[k]] / 2);
        p.set(k % 2 ? c : sh.accent, 3).line(ax, ay, bx, by);
      }
      p.set('#e06aa0', 1.2).poly([[pts[0].x, pts[0].y], ...few.map((i) => off(i, ds[i])), [pts[last].x, pts[last].y]]);
      return ds;
    }
    default: { // plank / log: a slim beam with cross ticks
      const ds = depth.map((d) => Math.min(d, sh.body === 'log' ? 7 : 5));
      p.set(c, 1.5).poly([[pts[0].x, pts[0].y], ...few.map((i) => off(i, ds[i])), [pts[last].x, pts[last].y]]);
      p.set(c, 0.8);
      for (let at = 8; at < len - 2; at += 12) {
        const q = pointAt(pts, at);
        if (q) p.line(q.x, q.y, q.x + q.nx * ds[q.i], q.y + q.ny * ds[q.i]);
      }
      if (sh.body === 'log' && len > 30) {
        const q = pointAt(pts, len * rng.range(0.3, 0.7));
        if (q) p.set(sh.accent, 1.6).circle(q.x + q.nx * 12, q.y + q.ny * 12, 4, 8);
      }
      return ds;
    }
  }
}

// ---------------------------------------------------------------------------

function support(p, sh, x, y, dir, reach, rng) {
  const c = sh.supportColor;
  const ey = y + dir * reach;
  switch (sh.support) {
    case 'girder':
      p.set(c, 1.2).line(x - 4, y, x - 4, ey).line(x + 4, y, x + 4, ey);
      for (let k = 0; k + 18 <= reach; k += 18) p.line(x - 4, y + dir * k, x + 4, y + dir * (k + 18));
      break;
    case 'pillar':
      p.set(c, 1.4).line(x - 5, y, x - 6, ey).line(x + 5, y, x + 6, ey);
      for (let k = 14; k < reach; k += rng.range(14, 26)) p.set(c, 0.8).line(x - 5, y + dir * k, x + 5, y + dir * (k + rng.range(-2, 2)));
      break;
    case 'trunk':
      p.set(c, 3).line(x, y, x + rng.range(-3, 3), ey);
      break;
    case 'cane':
      for (let k = 0; k < reach; k += 6) p.set(Math.floor(k / 6) % 2 ? '#f7d3dc' : c, 3).line(x, y + dir * k, x, y + dir * Math.min(reach, k + 6));
      break;
    default:
      p.set(c, 2.2).line(x, y, x, ey);
      if (reach > 40) p.set(c, 1).line(x, y + dir * reach * 0.4, x + 10, y + dir * 4);
  }
  if (dir < 0) {
    // a hanging thing needs something to hang from: a little bracket
    p.set(c, 1.4).line(x - 6, ey, x + 6, ey);
  }
}

function tapObject(p, sh, pts, len, depth, rng) {
  const nx = pts[0].nx, ny = pts[0].ny;
  const cx = (pts[0].x + pts[1].x) / 2 + nx * depth * 0.5, cy = (pts[0].y + pts[1].y) / 2 + ny * depth * 0.5;
  const r = Math.max(4, Math.min(depth, len + 4) * 0.55);
  switch (sh.tap) {
    case 'crate':
      p.set('#a07850', 1.4).poly([[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]], true);
      p.set('#a07850', 0.9).line(cx - r, cy - r, cx + r, cy + r).line(cx + r, cy - r, cx - r, cy + r);
      break;
    case 'gem':
      p.set(sh.accent, 1.5).poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], true);
      p.set(sh.color, 1).line(cx - r, cy, cx + r, cy);
      break;
    case 'ice':
      p.set('#9fc0e0', 1.5).poly([[cx - r, cy - r * 0.4], [cx - r * 0.3, cy - r], [cx + r, cy - r * 0.6], [cx + r * 0.7, cy + r], [cx - r * 0.6, cy + r * 0.8]], true);
      break;
    case 'mushroom':
      p.set('#e0533d', 1.6).circle(cx, cy, r, 10);
      p.set('#fff', 1.4).circle(cx - r * 0.3, cy - r * 0.2, 1, 5);
      break;
    case 'cactus':
      p.set('#4c9a5b', 4).line(cx, cy - r * 0.6, cx, cy + r * 0.8);
      break;
    case 'ember':
      p.set('#ef5b2a', 1.6).circle(cx, cy, r, 9);
      p.set('#f2b632', 1.2).circle(cx, cy, r * 0.5, 7);
      break;
    case 'buoy':
      p.set('#e35d5b', 1.6).circle(cx, cy, r, 10);
      p.set('#fff', 1.6).line(cx - r, cy, cx + r, cy);
      break;
    case 'gum':
      p.set(rng.pick(['#ec6fa8', '#4cc9a7', '#f6c945', '#8e7cc3']), 1.8).circle(cx, cy, r, 10);
      break;
    default:
      p.set(sh.color, 1.5).circle(cx, cy, r, 10);
  }
}

// A little building whose roof is the track line.
function house(p, sh, l, free, rng) {
  const x1 = Math.min(l.x1, l.x2), x2 = Math.max(l.x1, l.x2);
  const yl = l.x1 < l.x2 ? l.y1 : l.y2, yr = l.x1 < l.x2 ? l.y2 : l.y1;
  const w = x2 - x1;
  if (w < 14) return false;
  const h = rng.range(26, 70);
  const base = Math.max(yl, yr) + h;
  // must not cover the ride
  for (let x = x1 + 3; x <= x2 - 3; x += 7) {
    for (let y = Math.min(yl, yr) + 7; y <= base; y += 7) if (!free(x, y, 6)) return false;
  }
  const wall = sh.house === 'tower' ? '#8890a3' : sh.house === 'gingerbread' ? '#b5733f' : sh.house === 'pod' ? '#8e7cc3' : sh.house === 'adobe' ? '#d9935f' : '#8a6a50';
  p.set(wall, 1.6).poly([[x1, yl], [x1, base], [x2, base], [x2, yr]]);
  // door
  const dw = Math.min(8, w * 0.25), dx = x1 + w * rng.range(0.2, 0.6);
  p.set(wall, 1.2).poly([[dx, base], [dx, base - 12], [dx + dw, base - 12], [dx + dw, base]]);
  // windows
  p.set(sh.house === 'tower' ? '#f0c23b' : '#8ec5ff', 1.4);
  const rows = sh.house === 'tower' ? Math.floor((base - Math.max(yl, yr) - 16) / 12) : 1;
  for (let r = 0; r < Math.max(1, rows); r++) {
    const wy = Math.max(yl, yr) + 8 + r * 12;
    for (let wx = x1 + 5; wx < x2 - 8; wx += 12) {
      if (wx > dx - 6 && wx < dx + dw + 2 && wy > base - 16) continue;
      p.poly([[wx, wy], [wx + 5, wy], [wx + 5, wy + 5], [wx, wy + 5]], true);
    }
  }
  if (sh.house === 'chalet' || sh.house === 'hut') {
    // chimney with a puff of smoke
    const cx = x1 + w * 0.75;
    const cy = yl + (yr - yl) * 0.75;
    p.set(wall, 1.4).line(cx, cy, cx, cy - 8).line(cx + 4, cy, cx + 4, cy - 8);
    if (free(cx + 4, cy - 18, 8)) p.set('#c9c9c9', 1.2).circle(cx + 4, cy - 16, 3.5, 8);
  }
  return true;
}

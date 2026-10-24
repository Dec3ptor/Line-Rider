// Canvas drawing: track lines, the rider, and editor overlays.
import { LineType, P, POINT_COUNT } from './physics.js';

export const LINE_COLORS = {
  [LineType.NORMAL]: '#1565e6',
  [LineType.ACCEL]: '#e0261b',
  [LineType.SCENERY]: '#1f9e3a',
};
const PLAY_COLOR = '#111';
export const LINE_WIDTH = 2;

// ---------------------------------------------------------------------------
// View helpers

export function applyView(ctx, view, dpr) {
  const z = view.zoom * dpr;
  ctx.setTransform(z, 0, 0, z, dpr * (view.w / 2 - view.x * view.zoom), dpr * (view.h / 2 - view.y * view.zoom));
}

export function viewBounds(view, pad = 0) {
  const hw = view.w / 2 / view.zoom + pad, hh = view.h / 2 / view.zoom + pad;
  return { x0: view.x - hw, y0: view.y - hh, x1: view.x + hw, y1: view.y + hh };
}

// ---------------------------------------------------------------------------
// Lines

export function drawTrack(ctx, track, view, opts) {
  const b = viewBounds(view, 4);
  const groups = { 0: [], 1: [], 2: [] };
  const styled = new Map();
  track.forLinesInRect(b.x0, b.y0, b.x1, b.y1, (l) => {
    if (l.maxX < b.x0 || l.minX > b.x1 || l.maxY < b.y0 || l.minY > b.y1) return;
    if (l.style) {
      let arr = styled.get(l.style);
      if (!arr) styled.set(l.style, (arr = []));
      arr.push(l);
      return;
    }
    groups[l.type].push(l);
  });
  const lw = Math.max(LINE_WIDTH, 1.25 / view.zoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // coloured scenery art sits behind everything
  for (const [st, arr] of styled) {
    ctx.beginPath();
    for (const l of arr) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
    }
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(st.width, 0.9 / view.zoom);
    ctx.stroke();
  }

  const colored = opts.colored;
  // Shading on the solid side shows which way a line can be ridden.
  if (opts.showSides && view.zoom > 0.3) {
    ctx.lineCap = 'butt';
    for (const type of [LineType.NORMAL, LineType.ACCEL]) {
      const arr = groups[type];
      if (!arr.length) continue;
      ctx.beginPath();
      for (const l of arr) {
        const ox = l.nx * lw * 1.1, oy = l.ny * lw * 1.1;
        ctx.moveTo(l.x1 + ox, l.y1 + oy);
        ctx.lineTo(l.x2 + ox, l.y2 + oy);
      }
      ctx.strokeStyle = type === LineType.ACCEL ? 'rgba(224,38,27,0.28)' : 'rgba(21,101,230,0.25)';
      ctx.lineWidth = lw * 1.2;
      ctx.stroke();
    }
    ctx.lineCap = 'round';
  }

  for (const type of [LineType.SCENERY, LineType.NORMAL, LineType.ACCEL]) {
    const arr = groups[type];
    if (!arr.length) continue;
    ctx.beginPath();
    for (const l of arr) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
    }
    ctx.strokeStyle = colored || (opts.showBoost && type === LineType.ACCEL) ? LINE_COLORS[type] : PLAY_COLOR;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // Little arrow heads on acceleration lines, pointing the way they push.
  if (colored && view.zoom > 0.5 && groups[LineType.ACCEL].length) {
    ctx.beginPath();
    for (const l of groups[LineType.ACCEL]) {
      if (l.len < 6) continue;
      const ux = l.dx / l.len, uy = l.dy / l.len;
      const s = 4;
      const tipX = l.x2 - ux * 1.5 + l.nx * lw * 0.5, tipY = l.y2 - uy * 1.5 + l.ny * lw * 0.5;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * s + l.nx * s * 0.8, tipY - uy * s + l.ny * s * 0.8);
      ctx.lineTo(tipX - ux * s, tipY - uy * s);
      ctx.closePath();
    }
    ctx.fillStyle = LINE_COLORS[LineType.ACCEL];
    ctx.fill();
  }
}

export function drawLinePreview(ctx, view, a, b, type, flipped) {
  const lw = Math.max(LINE_WIDTH, 1.25 / view.zoom);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len > 0 && type !== LineType.SCENERY) {
    const f = flipped ? -1 : 1;
    const nx = (-dy / len) * f, ny = (dx / len) * f;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * lw * 1.1, a.y + ny * lw * 1.1);
    ctx.lineTo(b.x + nx * lw * 1.1, b.y + ny * lw * 1.1);
    ctx.strokeStyle = type === LineType.ACCEL ? 'rgba(224,38,27,0.28)' : 'rgba(21,101,230,0.25)';
    ctx.lineWidth = lw * 1.2;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = LINE_COLORS[type];
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// circle that stays the same size on screen
export function drawScreenCircle(ctx, view, x, y, px, stroke, fill) {
  ctx.beginPath();
  ctx.arc(x, y, px / view.zoom, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 / view.zoom; ctx.stroke(); }
}

// ---------------------------------------------------------------------------
// Rider

const STRIDE = 6;

// Positions for all rider points, blended between two frames for smooth motion.
export function riderPoints(a, b, t, out = new Float64Array(POINT_COUNT * 2)) {
  for (let i = 0; i < POINT_COUNT; i++) {
    const ax = a.p[i * STRIDE], ay = a.p[i * STRIDE + 1];
    if (b && t > 0) {
      out[i * 2] = ax + (b.p[i * STRIDE] - ax) * t;
      out[i * 2 + 1] = ay + (b.p[i * STRIDE + 1] - ay) * t;
    } else {
      out[i * 2] = ax; out[i * 2 + 1] = ay;
    }
  }
  return out;
}

const INK = '#141414';
const SCARF_RED = '#e3262e';

function segment(ctx, x1, y1, x2, y2, w, color) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function limb(ctx, x1, y1, x2, y2, bendX, bendY, w, color) {
  // a gently bent limb: quadratic curve through an offset midpoint
  const mx = (x1 + x2) / 2 + bendX, my = (y1 + y2) / 2 + bendY;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export function drawRider(ctx, pts, state, opts = {}) {
  const X = (i) => pts[i * 2], Y = (i) => pts[i * 2 + 1];
  const { PEG, TAIL, NOSE, STRING, BUTT, SHOULDER, RHAND, LHAND, LFOOT, RFOOT, SCARF } = P;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // body frame: "up" runs from butt to shoulder
  let ux = X(SHOULDER) - X(BUTT), uy = Y(SHOULDER) - Y(BUTT);
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const rx = -uy, ry = ux; // facing direction

  // scarf (behind everything)
  ctx.beginPath();
  ctx.moveTo(X(SHOULDER), Y(SHOULDER));
  for (let i = 0; i < 7; i++) ctx.lineTo(X(SCARF + i), Y(SCARF + i));
  ctx.lineWidth = 2.3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  let sx = X(SHOULDER), sy = Y(SHOULDER);
  for (let i = 0; i < 7; i++) {
    const nx = X(SCARF + i), ny = Y(SCARF + i);
    segment(ctx, sx, sy, nx, ny, 1.4, i % 2 ? '#fff' : SCARF_RED);
    sx = nx; sy = ny;
  }

  // back arm and leg
  limb(ctx, X(SHOULDER), Y(SHOULDER), X(RHAND), Y(RHAND), -ux * 0.8, -uy * 0.8, 1.5, '#4a4a4a');
  limb(ctx, X(BUTT), Y(BUTT), X(RFOOT), Y(RFOOT), ux * 2.2, uy * 2.2, 1.9, '#4a4a4a');

  // rope from sled to hands
  if (state.mounted) {
    ctx.beginPath();
    ctx.moveTo(X(LHAND), Y(LHAND));
    ctx.lineTo(X(STRING), Y(STRING));
    ctx.lineTo(X(RHAND), Y(RHAND));
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = '#555';
    ctx.stroke();
  }

  drawSled(ctx, X, Y, state.sledIntact, { PEG, TAIL, NOSE, STRING });

  // torso
  ctx.save();
  ctx.transform(rx, ry, -ux, -uy, X(BUTT), Y(BUTT));
  ctx.beginPath();
  roundRect(ctx, -2.3, -6.4, 4.8, 7.2, 2.1);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // scarf wrap at the neck
  ctx.beginPath();
  roundRect(ctx, -2.5, -6.6, 5.2, 1.6, 0.8);
  ctx.fillStyle = SCARF_RED;
  ctx.fill();
  ctx.lineWidth = 0.4;
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(0.5, -9.4, 3.1, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // hat
  ctx.beginPath();
  ctx.moveTo(-2.7, -10.1);
  ctx.quadraticCurveTo(-2.4, -13.6, 0.7, -13.5);
  ctx.quadraticCurveTo(3.7, -13.4, 3.7, -10.4);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-2.4, -13.2, 0.9, 0, Math.PI * 2);
  ctx.fillStyle = SCARF_RED;
  ctx.fill();
  // face
  ctx.beginPath();
  ctx.arc(2.3, -9.3, 0.45, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  if (state.mounted) ctx.arc(2.1, -8.4, 1.1, 0.2, 1.4);
  else ctx.arc(2.3, -7.2, 0.9, -2.2, -0.9);
  ctx.lineWidth = 0.4;
  ctx.stroke();
  ctx.restore();

  // front leg and arm
  limb(ctx, X(BUTT), Y(BUTT), X(LFOOT), Y(LFOOT), ux * 2.2, uy * 2.2, 2.0, INK);
  drawBoot(ctx, X(LFOOT), Y(LFOOT), X(LFOOT) - X(BUTT), Y(LFOOT) - Y(BUTT));
  limb(ctx, X(SHOULDER), Y(SHOULDER), X(LHAND), Y(LHAND), -ux * 0.8, -uy * 0.8, 1.6, INK);
  ctx.beginPath();
  ctx.arc(X(LHAND), Y(LHAND), 0.9, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();

  ctx.restore();
}

function drawBoot(ctx, x, y, dx, dy) {
  const l = Math.hypot(dx, dy) || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy, dx) - Math.PI / 4);
  ctx.beginPath();
  ctx.ellipse(0.6, 0, 1.6, 1, 0, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  return l;
}

function drawSled(ctx, X, Y, intact, { PEG, TAIL, NOSE, STRING }) {
  // sled frame: x along tail→nose, y along peg→tail (both 1 unit = 1 world unit)
  const vx = (X(NOSE) - X(TAIL)) / 15, vy = (Y(NOSE) - Y(TAIL)) / 15;
  const wx = (X(TAIL) - X(PEG)) / 5, wy = (Y(TAIL) - Y(PEG)) / 5;
  ctx.save();
  ctx.transform(vx, vy, wx, wy, X(PEG), Y(PEG));
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = INK;
  // runner with curled front
  ctx.beginPath();
  ctx.moveTo(-0.6, 5);
  ctx.lineTo(13.2, 5);
  ctx.quadraticCurveTo(18.6, 5, 17.5, 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
  // deck
  ctx.beginPath();
  ctx.moveTo(-0.4, 2.2);
  ctx.lineTo(14.2, 2.2);
  ctx.quadraticCurveTo(15.6, 2.2, 15.9, 1.0);
  ctx.lineTo(15.4, 3.4);
  ctx.lineTo(-0.4, 3.4);
  ctx.closePath();
  ctx.fillStyle = intact ? '#f4d6a7' : '#d9b98a';
  ctx.fill();
  ctx.lineWidth = 0.55;
  ctx.stroke();
  // struts
  ctx.beginPath();
  for (const sx of [1.5, 7.2, 12.6]) { ctx.moveTo(sx, 3.4); ctx.lineTo(sx, 5); }
  ctx.moveTo(0, 0.2); ctx.lineTo(0, 5);
  ctx.lineWidth = 0.6;
  ctx.stroke();
  if (!intact) {
    // cracked deck
    ctx.beginPath();
    ctx.moveTo(6.5, 2.0); ctx.lineTo(7.6, 2.8); ctx.lineTo(6.9, 3.6);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Flag marker for the checkpoint, drawn at a fixed screen size.
export function drawFlag(ctx, view, x, y) {
  const s = 1 / view.zoom;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -34);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#333';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.lineTo(16, -28);
  ctx.lineTo(0, -22);
  ctx.closePath();
  ctx.fillStyle = '#f2a400';
  ctx.fill();
  ctx.restore();
}

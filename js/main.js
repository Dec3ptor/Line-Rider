import { Track, Line, LineType, Simulator, FPS } from './physics.js';
import {
  applyView, drawTrack, drawRider, riderPoints, drawLinePreview, drawScreenCircle, drawFlag, LINE_WIDTH,
} from './render.js';
import {
  serialize, parseTrack, toLineRiderJSON, encodeShare, decodeShare, storeGet, storeSet, downloadFile,
} from './storage.js';
import { demoLines } from './demo.js';
import { Endless, randomSeed } from './endless.js';
import { BIOME_BY_ID } from './gen/biomes.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const canvas = $('#c');
const ctx = canvas.getContext('2d');

// The editor's own track. Endless mode swaps in its own world while it runs.
const editor = { track: new Track() };
editor.sim = new Simulator(editor.track);
let track = editor.track;
let sim = editor.sim;

const MIN_ZOOM = 0.05, MAX_ZOOM = 24;
const PENCIL_STEP_PX = 6;
const SNAP_PX = 12;
const ERASER_PX = 12;
const MAX_FRAMES = FPS * 60 * 20; // 20 minutes
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const STORE_TRACK = 'linerider.track';
const STORE_SETTINGS = 'linerider.settings';
const STORE_HELP = 'linerider.seenHelp';

const view = { x: 0, y: 0, zoom: 2, w: 1, h: 1 };
let dpr = 1;

const app = {
  tool: 'pencil',
  lineType: LineType.NORMAL,
  flip: false,
  shift: false,
  mode: 'edit',      // edit | play | pause
  frame: 0,
  sub: 0,            // fraction of the way to the next frame (for smooth drawing)
  flag: -1,
  maxFrame: 0,
  speed: 2,          // index into SPEEDS
  colorPlayback: false,
  dirty: true,
  followEase: 0,
  followHold: 0,     // camera stops following until this time (after the user drags)
  endless: null,     // Endless instance while in endless mode
  bg: [255, 255, 255],
  bgTarget: [255, 255, 255],
};

// ---------------------------------------------------------------------------
// Helpers

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roundPt = (p) => ({ x: round2(p.x), y: round2(p.y) });

function toWorld(sx, sy) {
  return { x: view.x + (sx - view.w / 2) / view.zoom, y: view.y + (sy - view.h / 2) / view.zoom };
}

function eventPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function formatTime(frame) {
  const t = frame / FPS;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function markDirty() { app.dirty = true; }

// ---------------------------------------------------------------------------
// Undo / redo

const undoStack = [];
const redoStack = [];

function commit(action) {
  if (!action.added.length && !action.removed.length && !action.start) return;
  undoStack.push(action);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  trackEdited();
}

function applyAction(a, reverse) {
  const toRemove = reverse ? a.added : a.removed;
  const toAdd = reverse ? a.removed : a.added;
  for (const l of toRemove) track.remove(l);
  for (const l of toAdd) track.add(l);
  if (a.start) setStart(reverse ? a.start.before : a.start.after);
}

function undo() {
  const a = undoStack.pop();
  if (!a) return;
  applyAction(a, true);
  redoStack.push(a);
  trackEdited();
}

function redo() {
  const a = redoStack.pop();
  if (!a) return;
  applyAction(a, false);
  undoStack.push(a);
  trackEdited();
}

function setStart(p) {
  track.start = { x: p.x, y: p.y };
  sim.reset();
  app.flag = -1;
}

let saveTimer = 0;
function trackEdited() {
  markDirty();
  updateButtons();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}

function saveLocal() {
  clearTimeout(saveTimer);
  storeSet(STORE_TRACK, JSON.stringify(serialize(editor.track)));
}

// ---------------------------------------------------------------------------
// Editing tools

let stroke = null;

function addLine(a, b, flipped) {
  if (a.x === b.x && a.y === b.y) return null;
  const l = track.add(new Line(null, app.lineType, a.x, a.y, b.x, b.y, flipped));
  track.linkEndpoints(l);
  return l;
}

// nearest line end within reach of a point (for snapping)
function findSnap(w, exclude) {
  const r = SNAP_PX / view.zoom;
  let best = null, bestD = r * r;
  track.forLinesInRect(w.x - r, w.y - r, w.x + r, w.y + r, (l) => {
    for (let k = 0; k < 2; k++) {
      const x = k ? l.x2 : l.x1, y = k ? l.y2 : l.y1;
      if (exclude && x === exclude.x && y === exclude.y) continue;
      const d = (x - w.x) ** 2 + (y - w.y) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  });
  return best;
}

function segDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

function segmentsCross(a, b, l) {
  const d = (b.x - a.x) * (l.y2 - l.y1) - (b.y - a.y) * (l.x2 - l.x1);
  if (d === 0) return false;
  const t = ((l.x1 - a.x) * (l.y2 - l.y1) - (l.y1 - a.y) * (l.x2 - l.x1)) / d;
  const u = ((l.x1 - a.x) * (b.y - a.y) - (l.y1 - a.y) * (b.x - a.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function eraseAlong(a, b) {
  const r = ERASER_PX / view.zoom + LINE_WIDTH / 2;
  const hits = [];
  track.forLinesInRect(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, (l) => {
    const d = Math.min(
      segDistSq(l.x1, l.y1, a.x, a.y, b.x, b.y),
      segDistSq(l.x2, l.y2, a.x, a.y, b.x, b.y),
      segDistSq(a.x, a.y, l.x1, l.y1, l.x2, l.y2),
      segDistSq(b.x, b.y, l.x1, l.y1, l.x2, l.y2),
    );
    if (d <= r * r || segmentsCross(a, b, l)) hits.push(l);
  });
  for (const l of hits) {
    track.remove(l);
    stroke.removed.push(l);
  }
  if (hits.length) markDirty();
}

function riderHit(w) {
  const s = sim.frame(0);
  const pad = Math.max(4, 10 / view.zoom);
  return w.x >= s.minX - pad && w.x <= s.maxX + pad && w.y >= s.minY - 8 - pad && w.y <= s.maxY + pad;
}

function beginTool(p, e) {
  const w = toWorld(p.x, p.y);
  const noSnap = e.ctrlKey || e.metaKey;
  const flipped = app.flip !== e.shiftKey;
  if (app.tool === 'pencil') {
    const start = (!noSnap && findSnap(w)) || roundPt(w);
    stroke = { kind: 'pencil', last: start, added: [], flipped, startScreen: p };
  } else if (app.tool === 'line') {
    const a = (!noSnap && findSnap(w)) || roundPt(w);
    stroke = { kind: 'line', a, b: a, flipped };
  } else if (app.tool === 'eraser') {
    stroke = { kind: 'eraser', last: w, removed: [] };
    eraseAlong(w, w);
  }
}

function moveTool(p, e) {
  if (!stroke) return;
  const w = toWorld(p.x, p.y);
  const noSnap = e.ctrlKey || e.metaKey;
  if (stroke.kind === 'pencil') {
    stroke.flipped = app.flip !== e.shiftKey;
    const d = Math.hypot(w.x - stroke.last.x, w.y - stroke.last.y) * view.zoom;
    if (d >= PENCIL_STEP_PX) {
      const next = roundPt(w);
      const l = addLine(stroke.last, next, stroke.flipped);
      if (l) stroke.added.push(l);
      stroke.last = next;
      markDirty();
    }
  } else if (stroke.kind === 'line') {
    stroke.b = (!noSnap && findSnap(w, stroke.a)) || roundPt(w);
    stroke.flipped = app.flip !== e.shiftKey;
  } else if (stroke.kind === 'eraser') {
    eraseAlong(stroke.last, w);
    stroke.last = w;
  }
}

function endTool(p, e) {
  if (!stroke) return;
  const w = toWorld(p.x, p.y);
  if (stroke.kind === 'pencil') {
    const d = Math.hypot(w.x - stroke.last.x, w.y - stroke.last.y) * view.zoom;
    if (d >= 1.5) {
      const l = addLine(stroke.last, roundPt(w), stroke.flipped);
      if (l) stroke.added.push(l);
    }
    commit({ added: stroke.added, removed: [] });
  } else if (stroke.kind === 'line') {
    const { a, b } = stroke;
    if (Math.hypot(b.x - a.x, b.y - a.y) * view.zoom >= 3) {
      const l = addLine(a, b, stroke.flipped);
      if (l) commit({ added: [l], removed: [] });
    }
  } else if (stroke.kind === 'eraser') {
    commit({ added: [], removed: stroke.removed });
  } else if (stroke.kind === 'start') {
    const after = stroke.current;
    if (after.x !== stroke.before.x || after.y !== stroke.before.y) {
      commit({ added: [], removed: [], start: { before: stroke.before, after } });
    }
  }
  stroke = null;
  markDirty();
}

function cancelTool() {
  if (!stroke) return;
  if (stroke.kind === 'pencil') for (const l of stroke.added) track.remove(l);
  if (stroke.kind === 'eraser') for (const l of stroke.removed) track.add(l);
  if (stroke.kind === 'start') setStart(stroke.before);
  stroke = null;
  markDirty();
}

// ---------------------------------------------------------------------------
// Pointer input: one finger/mouse = tool, two fingers = pinch & pan

const pointers = new Map();
let gesture = null; // 'tool' | 'pan' | 'pinch' | 'wait'
let panLast = null;
let pinch = null;
let hover = null;

canvas.addEventListener('pointerdown', (e) => {
  closeMenu();
  const p = eventPos(e);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  pointers.set(e.pointerId, p);

  if (pointers.size === 2 && e.pointerType === 'touch') {
    if (gesture === 'tool') cancelTool();
    startPinch();
    gesture = 'pinch';
    return;
  }
  if (pointers.size > 1) return;

  if (app.endless) {
    // endless mode: dragging just looks around
    gesture = 'pan';
    panLast = p;
    app.followHold = Infinity;
    canvas.classList.add('grabbing');
    return;
  }
  if (app.mode === 'play') pause();

  const w = toWorld(p.x, p.y);
  if (e.button === 1 || e.button === 2 || (app.tool === 'pan' && !(app.mode === 'edit' && riderHit(w)))) {
    gesture = 'pan';
    panLast = p;
    canvas.classList.add('grabbing');
    return;
  }
  if (e.button !== 0) return;
  if (app.tool === 'pan') {
    // drag Bosh to move the start point
    stroke = { kind: 'start', before: { ...track.start }, current: { ...track.start }, grab: { x: w.x - track.start.x, y: w.y - track.start.y } };
    gesture = 'tool';
    return;
  }
  gesture = 'tool';
  beginTool(p, e);
  markDirty();
});

canvas.addEventListener('pointermove', (e) => {
  const p = eventPos(e);
  hover = e.pointerType === 'touch' ? null : p;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (gesture === 'pinch') {
    updatePinch();
  } else if (gesture === 'pan' && pointers.has(e.pointerId)) {
    view.x -= (p.x - panLast.x) / view.zoom;
    view.y -= (p.y - panLast.y) / view.zoom;
    panLast = p;
  } else if (gesture === 'tool' && pointers.has(e.pointerId)) {
    if (stroke?.kind === 'start') {
      const w = toWorld(p.x, p.y);
      stroke.current = roundPt({ x: w.x - stroke.grab.x, y: w.y - stroke.grab.y });
      setStart(stroke.current);
    } else {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (events.length > 1 && stroke?.kind !== 'line') {
        for (const ce of events) moveTool(eventPos(ce), ce);
      } else {
        moveTool(p, e);
      }
    }
  }
  markDirty();
});

function pointerEnd(e) {
  if (!pointers.has(e.pointerId)) return;
  const p = eventPos(e);
  pointers.delete(e.pointerId);
  if (gesture === 'tool') {
    if (e.type === 'pointercancel') cancelTool(); else endTool(p, e);
    gesture = null;
  } else if (gesture === 'pan') {
    gesture = null;
    canvas.classList.remove('grabbing');
  } else if (gesture === 'pinch' || gesture === 'wait') {
    gesture = pointers.size === 0 ? null : 'wait';
  }
  if (app.endless && pointers.size === 0) app.followHold = performance.now() + 2500;
  markDirty();
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => { hover = null; markDirty(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function startPinch() {
  if (app.endless) app.followHold = Infinity;
  const [a, b] = [...pointers.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: view.zoom, world: toWorld(mid.x, mid.y) };
}

function updatePinch() {
  if (pointers.size < 2 || !pinch) return;
  const [a, b] = [...pointers.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const z = clamp(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist, MIN_ZOOM, MAX_ZOOM);
  view.zoom = z;
  view.x = pinch.world.x - (mid.x - view.w / 2) / z;
  view.y = pinch.world.y - (mid.y - view.h / 2) / z;
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = eventPos(e);
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
  const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(p, view.zoom * factor);
}, { passive: false });

// stop iOS Safari from zooming the page
document.addEventListener('gesturestart', (e) => e.preventDefault());

function zoomAt(p, z) {
  z = clamp(z, MIN_ZOOM, MAX_ZOOM);
  const w = toWorld(p.x, p.y);
  view.zoom = z;
  view.x = w.x - (p.x - view.w / 2) / z;
  view.y = w.y - (p.y - view.h / 2) / z;
  markDirty();
}

// ---------------------------------------------------------------------------
// Playback

function play() {
  if (app.mode === 'edit') app.frame = app.flag >= 0 ? app.flag : 0;
  app.mode = 'play';
  app.sub = 0;
  app.followEase = 24;
  lastTick = performance.now();
  updateButtons();
  markDirty();
}

function pause() {
  if (app.mode !== 'play') return;
  app.mode = 'pause';
  app.sub = 0;
  updateButtons();
  markDirty();
}

function stop() {
  if (app.endless) { restartEndless(); return; }
  app.mode = 'edit';
  app.frame = 0;
  app.sub = 0;
  updateButtons();
  markDirty();
}

function togglePlay() {
  if (app.mode === 'play') pause(); else play();
}

function restart() {
  stop();
  play();
}

function seek(frame) {
  if (app.endless) return;
  if (app.mode === 'play') pause();
  if (app.mode === 'edit') app.mode = 'pause';
  app.frame = clamp(Math.round(frame), 0, MAX_FRAMES);
  app.sub = 0;
  app.maxFrame = Math.max(app.maxFrame, app.frame);
  followCamera(true);
  updateButtons();
  markDirty();
}

function flagAction() {
  if (app.endless) return;
  if (app.mode === 'edit') {
    if (app.flag >= 0) { app.flag = -1; toast('Flag removed'); }
    else toast('Play or pause the ride, then press Flag to set a checkpoint');
  } else if (app.flag === app.frame) {
    app.flag = -1;
    toast('Flag removed');
  } else {
    app.flag = app.frame;
    toast(`Flag set at ${formatTime(app.frame)} — Play restarts here`);
  }
  updateButtons();
  markDirty();
}

function riderCenterNow() {
  const a = sim.frame(app.frame);
  if (app.mode === 'play' && app.sub > 0) {
    const b = sim.frame(app.frame + 1);
    const ca = a.center(), cb = b.center();
    return { x: ca.x + (cb.x - ca.x) * app.sub, y: ca.y + (cb.y - ca.y) * app.sub };
  }
  return a.center();
}

function followCamera(instant = false) {
  const c = riderCenterNow();
  if (app.endless) {
    // look ahead in the direction of travel so jumps show where they land
    const v = sim.frame(app.frame).velocity();
    const k = Math.min(1, 0.04 * (instant ? 25 : 1));
    app.lead = app.lead || { x: 0, y: 0 };
    app.lead.x += (clamp(v.x * 20, -view.w * 0.32 / view.zoom, view.w * 0.32 / view.zoom) - app.lead.x) * k;
    app.lead.y += (clamp(v.y * 16, -view.h * 0.28 / view.zoom, view.h * 0.28 / view.zoom) - app.lead.y) * k;
    c.x += app.lead.x;
    c.y += app.lead.y;
  }
  const box = app.endless ? 0.04 : 0.16;
  const bx = (view.w * box) / view.zoom, by = (view.h * box) / view.zoom;
  let tx = view.x, ty = view.y;
  if (c.x > view.x + bx) tx = c.x - bx; else if (c.x < view.x - bx) tx = c.x + bx;
  if (c.y > view.y + by) ty = c.y - by; else if (c.y < view.y - by) ty = c.y + by;
  if (!instant && app.followEase > 0) {
    view.x += (tx - view.x) * 0.2;
    view.y += (ty - view.y) * 0.2;
    app.followEase--;
  } else {
    view.x = tx;
    view.y = ty;
  }
}

function centerOnRider() {
  const c = sim.frame(app.frame).center();
  view.x = c.x;
  view.y = c.y;
  markDirty();
}

function frameStart() {
  view.zoom = clamp(Math.min(view.w / 480, view.h / 320), 1.6, 2.6);
  view.x = track.start.x + (view.w * 0.2) / view.zoom;
  view.y = track.start.y + (view.h * 0.08) / view.zoom;
  markDirty();
}

// ---------------------------------------------------------------------------
// Main loop

let lastTick = performance.now();

function tick(now) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  const E = app.endless;
  if (E) E.work(app.frame, app.mode === 'play' ? 7 : 4);
  if (app.mode === 'play') {
    app.sub += dt * FPS * SPEEDS[app.speed];
    const steps = Math.floor(app.sub);
    if (steps > 0) {
      app.frame += steps;
      app.sub -= steps;
    }
    if (E) {
      // never ride onto track that hasn't been checked yet
      const cap = E.playableFrame;
      if (app.frame >= cap) { app.frame = cap; app.sub = 0; }
    } else if (app.frame >= MAX_FRAMES) {
      app.frame = MAX_FRAMES;
      pause();
    }
    app.maxFrame = Math.max(app.maxFrame, app.frame);
    if (now > app.followHold) followCamera();
    app.dirty = true;
  }
  if (E) {
    handleEndlessEvents(E.update(app.frame));
    const k = Math.min(1, dt * 1.5);
    for (let i = 0; i < 3; i++) app.bg[i] += (app.bgTarget[i] - app.bg[i]) * k;
    app.dirty = true;
  }
  if (app.dirty) {
    app.dirty = false;
    render();
  }
  requestAnimationFrame(tick);
}

const scratchPts = new Float64Array(34);

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = app.endless ? `rgb(${app.bg.map(Math.round).join(',')})` : '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyView(ctx, view, dpr);

  const playing = app.mode === 'play';
  drawTrack(ctx, track, view, {
    colored: app.endless ? false : !playing || app.colorPlayback,
    showSides: !playing && !app.endless,
    showBoost: !!app.endless,
  });

  // checkpoint flag (with a ghost of the rider when editing)
  if (app.flag >= 0) {
    const fs = sim.frame(app.flag);
    if (app.mode === 'edit') drawRider(ctx, riderPoints(fs, null, 0, scratchPts), fs, { alpha: 0.3 });
    const c = fs.center();
    drawFlag(ctx, view, c.x, c.y - 14);
  }

  const a = sim.frame(app.frame);
  const b = playing && app.sub > 0 ? sim.frame(app.frame + 1) : null;
  const pts = riderPoints(a, b, app.sub, scratchPts);
  drawRider(ctx, pts, b && app.sub >= 0.5 ? b : a);

  // editor overlays
  if (stroke?.kind === 'line') drawLinePreview(ctx, view, stroke.a, stroke.b, app.lineType, stroke.flipped);
  if (stroke?.kind === 'eraser' && !hover) {
    // touch: show the eraser under the finger while rubbing out
    drawScreenCircle(ctx, view, stroke.last.x, stroke.last.y, ERASER_PX, '#7a808a', 'rgba(120,128,138,0.12)');
  }
  if (hover && !playing) {
    const w = toWorld(hover.x, hover.y);
    if (app.tool === 'eraser') {
      drawScreenCircle(ctx, view, w.x, w.y, ERASER_PX, '#7a808a', 'rgba(120,128,138,0.12)');
    } else if ((app.tool === 'line' || app.tool === 'pencil') && gesture !== 'pan') {
      const target = stroke?.kind === 'line' ? stroke.b : (!stroke && findSnap(w));
      if (target) drawScreenCircle(ctx, view, target.x, target.y, 5, '#1565e6', 'rgba(21,101,230,0.15)');
    }
  }

  if (!app.endless) updateTimeline();
  updateHud(a);
}

// ---------------------------------------------------------------------------
// UI wiring

const timeline = $('#timeline');
const timeEl = $('#time');
const hud = $('#hud');
let lastHud = '';
let lastTimeText = '';

function updateTimeline() {
  const max = Math.max(400, app.maxFrame + 80);
  if (+timeline.max !== max) timeline.max = max;
  if (+timeline.value !== app.frame) timeline.value = app.frame;
  timeline.style.setProperty('--fill', `${(app.frame / max) * 100}%`);
  const t = formatTime(app.frame);
  if (t !== lastTimeText) { timeEl.textContent = t; lastTimeText = t; }
}

function updateHud(state) {
  if (app.endless) {
    const E = app.endless;
    const v = state.velocity();
    const st = E.stats;
    const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const text = `${E.distance(app.frame)} m  ·  speed ${Math.hypot(v.x, v.y).toFixed(1)}\n`
      + `${n(st.jumps, 'jump')}  ·  ${n(st.flips, 'flip')}  ·  ${n(st.loops, 'loop')}`;
    if (text !== lastHud) { lastHud = text; hud.textContent = text; }
    return;
  }
  const n = track.size;
  let text = `${n} line${n === 1 ? '' : 's'}`;
  if (app.mode !== 'edit') {
    const v = state.velocity();
    text += `  ·  speed ${Math.hypot(v.x, v.y).toFixed(1)}`;
  }
  const crashed = app.mode !== 'edit' && !state.mounted;
  const key = text + crashed;
  if (key === lastHud) return;
  lastHud = key;
  hud.textContent = text;
  if (crashed) {
    const s = document.createElement('span');
    s.className = 'crash';
    s.textContent = state.sledIntact ? '  ·  crashed!' : '  ·  sled broke!';
    hud.appendChild(s);
  }
}

function setTool(t) {
  if (stroke) cancelTool();
  app.tool = t;
  for (const b of $$('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  canvas.className = `tool-${t}`;
  markDirty();
}

function setLineType(t) {
  app.lineType = t;
  for (const b of $$('[data-type]')) b.classList.toggle('active', +b.dataset.type === t);
  if (app.tool === 'eraser' || app.tool === 'pan') setTool('pencil');
}

function toggleFlip() {
  app.flip = !app.flip;
  $('#flip').classList.toggle('active', app.flip);
  $('#flip').setAttribute('aria-pressed', String(app.flip));
  toast(app.flip ? 'Flip on: new lines are solid on the other side' : 'Flip off');
}

function setSpeed(i) {
  app.speed = (i + SPEEDS.length) % SPEEDS.length;
  const s = SPEEDS[app.speed];
  $('#speed').textContent = s < 1 ? `${s === 0.25 ? '¼' : '½'}×` : `${s}×`;
  saveSettings();
}

function updateButtons() {
  const playBtn = $('#play');
  playBtn.classList.toggle('playing', app.mode === 'play');
  playBtn.setAttribute('aria-label', app.mode === 'play' ? 'Pause' : 'Play');
  $('#undo').disabled = undoStack.length === 0;
  $('#redo').disabled = redoStack.length === 0;
  $('#flag').classList.toggle('set', app.flag >= 0);
}

function saveSettings() {
  storeSet(STORE_SETTINGS, JSON.stringify({ colorPlayback: app.colorPlayback, speed: app.speed }));
}

function loadSettings() {
  try {
    const s = JSON.parse(storeGet(STORE_SETTINGS) || '{}');
    app.colorPlayback = !!s.colorPlayback;
    if (Number.isInteger(s.speed)) app.speed = clamp(s.speed, 0, SPEEDS.length - 1);
  } catch { /* defaults */ }
  setSpeed(app.speed);
  $('[data-action="color"]').setAttribute('aria-checked', String(app.colorPlayback));
}

for (const b of $$('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
for (const b of $$('[data-type]')) b.addEventListener('click', () => setLineType(+b.dataset.type));
$('#flip').addEventListener('click', toggleFlip);
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#play').addEventListener('click', togglePlay);
$('#stop').addEventListener('click', stop);
$('#flag').addEventListener('click', flagAction);
$('#speed').addEventListener('click', () => { setSpeed(app.speed + 1); toast(`Speed ${$('#speed').textContent}`, 1000); });
$('#zoomIn').addEventListener('click', () => zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom * 1.4));
$('#zoomOut').addEventListener('click', () => zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom / 1.4));
$('#center').addEventListener('click', centerOnRider);
timeline.addEventListener('input', () => seek(+timeline.value));

// keep keyboard shortcuts working after clicking a button
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.closest('.modal')) b.blur();
});

// ---- menu ----
const menu = $('#menu');
const menuBtn = $('#menuBtn');

function openMenu() {
  menu.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  menuBtn.classList.add('active');
}
function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.classList.remove('active');
}
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (menu.hidden) openMenu(); else closeMenu();
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
});

menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  if (action !== 'color') closeMenu();
  ({
    new: newTrack,
    demo: () => replaceTrack(demoTrack(), 'Demo track loaded'),
    open: () => $('#fileInput').click(),
    save: saveFile,
    share: shareLink,
    color: () => {
      app.colorPlayback = !app.colorPlayback;
      b.setAttribute('aria-checked', String(app.colorPlayback));
      saveSettings();
    },
    help: showHelp,
    explore: showExplore,
    exitEndless,
    newWorld,
  })[action]?.();
});

// ---- help ----
function showHelp() {
  $('#help').hidden = false;
  $('#helpGo').focus({ preventScroll: true });
  $('#help .card').scrollTop = 0;
}
function hideHelp() {
  $('#help').hidden = true;
  storeSet(STORE_HELP, '1');
}
$('#helpClose').addEventListener('click', hideHelp);
$('#helpGo').addEventListener('click', hideHelp);
$('#help').addEventListener('pointerdown', (e) => { if (e.target.id === 'help') hideHelp(); });

// ---------------------------------------------------------------------------
// Tracks: new, demo, files, share links

function demoTrack() {
  const lines = demoLines().map((d, i) => new Line(i + 1, d.type, d.x1, d.y1, d.x2, d.y2));
  return { name: 'Demo', start: { x: 0, y: 0 }, lines, link: true };
}

function replaceTrack(parsed, message) {
  if (stroke) cancelTool();
  stop();
  const removed = [...track.lines.values()];
  for (const l of removed) track.remove(l);
  const before = { ...track.start };
  setStart(parsed.start);
  for (const l of parsed.lines) track.add(l);
  if (parsed.link) for (const l of parsed.lines) track.linkEndpoints(l);
  app.maxFrame = 0;
  commit({ added: parsed.lines, removed, start: { before, after: { ...parsed.start } } });
  frameStart();
  if (message) toast(message);
}

function newTrack() {
  if (track.size === 0) return;
  replaceTrack({ start: { x: 0, y: 0 }, lines: [] }, 'New track — press Undo to get the old one back');
}

function saveFile() {
  const data = toLineRiderJSON(track, 'Line Rider track');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadFile(`line-rider-${stamp}.track.json`, JSON.stringify(data));
  toast('Track saved as a file');
}

$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = parseTrack(await file.text());
    replaceTrack(parsed, `Opened ${file.name} (${parsed.lines.length} lines)`);
  } catch (err) {
    toast(`Couldn't open that file: ${err.message}`, 3500);
  }
});

async function shareLink() {
  if (app.endless) {
    const url = `${location.origin}${location.pathname}#endless=${app.endless.seed}`;
    try { await navigator.clipboard.writeText(url); toast('Link to this world copied'); } catch { window.prompt('Copy this link:', url); }
    return;
  }
  try {
    const code = await encodeShare(serialize(track));
    const url = `${location.origin}${location.pathname}#track=${code}`;
    if (url.length > 60000) toast('This track is large — the link may not work everywhere', 3500);
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied');
    } catch {
      window.prompt('Copy this link to share your track:', url);
    }
  } catch (err) {
    toast(`Couldn't make a link: ${err.message}`, 3500);
  }
}

async function loadFromHash() {
  const m = location.hash.match(/[#&]track=([^&]+)/);
  const em = location.hash.match(/[#&]endless=(\d+)/);
  if (em) {
    app.pendingEndless = +em[1];
    history.replaceState(null, '', location.pathname + location.search);
    return false;
  }
  if (!m) return false;
  try {
    const parsed = parseTrack(await decodeShare(m[1]));
    loadInitial(parsed);
    toast(`Loaded a shared track (${parsed.lines.length} lines)`);
    return true;
  } catch {
    toast("Couldn't read that share link", 3500);
    return false;
  } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function loadInitial(parsed) {
  setStart(parsed.start);
  for (const l of parsed.lines) track.add(l);
  if (parsed.link) for (const l of parsed.lines) track.linkEndpoints(l);
}

window.addEventListener('hashchange', async () => {
  const em = location.hash.match(/[#&]endless=(\d+)/);
  if (em) {
    history.replaceState(null, '', location.pathname + location.search);
    enterEndless(+em[1]);
    return;
  }
  const m = location.hash.match(/[#&]track=([^&]+)/);
  if (!m) return;
  if (app.endless) exitEndless();
  try {
    replaceTrack(parseTrack(await decodeShare(m[1])), 'Loaded a shared track');
  } catch {
    toast("Couldn't read that share link", 3500);
  }
  history.replaceState(null, '', location.pathname + location.search);
});

// ---------------------------------------------------------------------------
// Keyboard

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input:not([type=range]), textarea')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Shift' && !app.shift) {
    app.shift = true;
    if (stroke?.kind === 'line' || stroke?.kind === 'pencil') { stroke.flipped = !app.flip; markDirty(); }
  }
  if (!$('#help').hidden) {
    if (k === 'escape' || k === 'enter') { hideHelp(); e.preventDefault(); }
    return;
  }
  if (app.endless) {
    if (mod) return;
    switch (k) {
      case ' ': e.preventDefault(); if (!e.repeat) togglePlay(); break;
      case 'n': newWorld(); break;
      case 'u': case 'y': restartEndless(); break;
      case 'c': case 'home': app.followHold = 0; app.followEase = 20; break;
      case '+': case '=': zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom * 1.25); break;
      case '-': case '_': zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom / 1.25); break;
      case 'escape': if (!menu.hidden) closeMenu(); else if (!$('#explore').hidden) hideExplore(); break;
      case '?': case 'h': showHelp(); break;
      default: return;
    }
    return;
  }
  if (mod) {
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); saveFile(); }
    else if (k === 'o') { e.preventDefault(); $('#fileInput').click(); }
    return;
  }
  if (e.altKey) return;
  switch (k) {
    case 'q': setTool('pencil'); break;
    case 'w': setTool('line'); break;
    case 'e': setTool('eraser'); break;
    case 'r': setTool('pan'); break;
    case '1': setLineType(LineType.NORMAL); break;
    case '2': setLineType(LineType.ACCEL); break;
    case '3': setLineType(LineType.SCENERY); break;
    case 'f': toggleFlip(); break;
    case ' ': e.preventDefault(); if (!e.repeat) togglePlay(); break;
    case 'y': restart(); break;
    case 'u': stop(); break;
    case 'i': flagAction(); break;
    case 'c': case 'home': centerOnRider(); break;
    case 'arrowright': e.preventDefault(); seek(app.frame + (e.shiftKey ? 10 : 1)); break;
    case 'arrowleft': e.preventDefault(); seek(app.frame - (e.shiftKey ? 10 : 1)); break;
    case '+': case '=': zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom * 1.25); break;
    case '-': case '_': zoomAt({ x: view.w / 2, y: view.h / 2 }, view.zoom / 1.25); break;
    case 'escape': closeMenu(); if (stroke) cancelTool(); break;
    case '?': case 'h': showHelp(); break;
    default: return;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    app.shift = false;
    if (stroke?.kind === 'line' || stroke?.kind === 'pencil') { stroke.flipped = app.flip; markDirty(); }
  }
});
window.addEventListener('blur', () => { app.shift = false; });

// ---------------------------------------------------------------------------
// Startup

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = canvas.getBoundingClientRect();
  view.w = Math.max(1, r.width);
  view.h = Math.max(1, r.height);
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  markDirty();
}
window.addEventListener('resize', resize);
window.addEventListener('pagehide', saveLocal);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveLocal(); pause(); }
});

async function init() {
  resize();
  loadSettings();
  let loaded = await loadFromHash();
  if (!loaded) {
    const saved = storeGet(STORE_TRACK);
    if (saved) {
      try { loadInitial(parseTrack(saved)); loaded = true; } catch { /* fall back to demo */ }
    }
  }
  if (!loaded) loadInitial(demoTrack());
  frameStart();
  setTool('pencil');
  updateButtons();
  if (app.pendingEndless) enterEndless(app.pendingEndless);
  else if (!storeGet(STORE_HELP)) showHelp();
  requestAnimationFrame((t) => { lastTick = t; tick(t); });
}

// ---------------------------------------------------------------------------
// Endless mode

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function enterEndless(seed = randomSeed()) {
  closeMenu();
  hideExplore();
  $('#help').hidden = true;
  if (stroke) cancelTool();
  if (!app.endless) saveLocal();
  const E = new Endless(seed);
  app.endless = E;
  track = E.track;
  sim = E.sim;
  app.mode = 'pause';
  app.frame = 0;
  app.sub = 0;
  app.flag = -1;
  app.maxFrame = 0;
  app.followHold = 0;
  app.bg = [255, 255, 255];
  app.bgTarget = [255, 255, 255];
  E.work(0, 300);
  document.body.classList.add('endless');
  canvas.className = 'tool-pan';
  $('#areaName').textContent = 'Endless ride';
  view.zoom = clamp(Math.min(view.w / 620, view.h / 420), 0.8, 1.8);
  app.lead = { x: 0, y: 0 };
  centerOnRider();
  lastHud = '';
  play();
}

function exitEndless() {
  if (!app.endless) return;
  app.endless = null;
  track = editor.track;
  sim = editor.sim;
  document.body.classList.remove('endless');
  $('#banner').classList.remove('show');
  $('#trick').classList.remove('show');
  app.mode = 'edit';
  app.frame = 0;
  app.sub = 0;
  lastHud = '';
  setTool(app.tool);
  updateButtons();
  frameStart();
}

function restartEndless() {
  if (app.endless) enterEndless(app.endless.seed);
}

function newWorld() {
  enterEndless(randomSeed());
}

let bannerTimer = 0, trickTimer = 0;
function showBanner(name) {
  const b = $('#banner');
  b.querySelector('span').textContent = name;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 2600);
}

function showTrick(label) {
  const t = $('#trick');
  t.textContent = label;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(trickTimer);
  trickTimer = setTimeout(() => t.classList.remove('show'), 1300);
}

function handleEndlessEvents(events) {
  for (const e of events) {
    if (e.type === 'biome') {
      showBanner(e.name);
      $('#areaName').textContent = e.name;
      app.bgTarget = hexToRgb(e.biome.tint);
    } else if (e.type === 'flip' || e.type === 'loop') {
      showTrick(e.label);
    } else if (e.type === 'air' && e.air >= 70) {
      showTrick(`Huge air! ${(e.air / FPS).toFixed(1)}s`);
    } else if (e.type === 'respawn') {
      app.followEase = 40;
      app.followHold = 0;
      toast('Wipeout! Back on the sled…');
    }
  }
}

// ---- explore (endless + maps) ----
function showExplore() {
  closeMenu();
  $('#explore').hidden = false;
  $('#explore .card').scrollTop = 0;
}
function hideExplore() {
  $('#explore').hidden = true;
}
$('#exploreBtn').addEventListener('click', showExplore);
$('#exploreClose').addEventListener('click', hideExplore);
$('#explore').addEventListener('pointerdown', (e) => { if (e.target.id === 'explore') hideExplore(); });
$('#playEndless').addEventListener('click', () => enterEndless());
$('#helpEndless').addEventListener('click', () => { hideHelp(); enterEndless(); });
$('#exitEndless').addEventListener('click', exitEndless);
$('#newWorld').addEventListener('click', newWorld);

init();

// handy for debugging from the console
window.lineRider = {
  get track() { return track; },
  get sim() { return sim; },
  get endless() { return app.endless; },
  app, view, enterEndless, exitEndless,
};

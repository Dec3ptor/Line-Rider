// Saving, loading and sharing tracks.
import { Line, LineType } from './physics.js';

// drawn lines are already rounded to 0.01; keep imported tracks precise
const r2 = (v) => Math.round(v * 1e6) / 1e6;

// Compact format used for autosave and share links:
// { v: 1, name, start: [x, y], lines: [flags, x1, y1, x2, y2, ...] }
// flags = type | flipped << 2 | leftExt << 3 | rightExt << 4
export function serialize(track, name = '') {
  const sorted = [...track.lines.values()].sort((a, b) => a.id - b.id);
  const lines = [];
  for (const l of sorted) {
    const flags = l.type | (l.flipped ? 4 : 0) | (l.leftExt ? 8 : 0) | (l.rightExt ? 16 : 0);
    lines.push(flags, r2(l.x1), r2(l.y1), r2(l.x2), r2(l.y2));
  }
  return { v: 1, name, start: [r2(track.start.x), r2(track.start.y)], lines };
}

// Returns { name, start, lines: Line[] } from any supported format.
export function parseTrack(data) {
  if (typeof data === 'string') data = JSON.parse(data);
  if (!data || typeof data !== 'object') throw new Error('Not a track file');

  // our compact format
  if (data.v === 1 && Array.isArray(data.lines) && (data.lines.length === 0 || typeof data.lines[0] === 'number')) {
    const out = [];
    const a = data.lines;
    for (let i = 0, id = 1; i + 4 < a.length; i += 5, id++) {
      const f = a[i];
      out.push(new Line(id, f & 3, a[i + 1], a[i + 2], a[i + 3], a[i + 4], !!(f & 4), !!(f & 8), !!(f & 16)));
    }
    const s = data.start || [0, 0];
    return { name: data.name || '', start: { x: s[0], y: s[1] }, lines: out };
  }

  // linerider.com / Line Rider Advanced JSON
  if (Array.isArray(data.lines)) {
    const lines = data.lines
      .filter((d) => d && isFinite(d.x1) && isFinite(d.y1) && isFinite(d.x2) && isFinite(d.y2))
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const out = lines.map((d, i) => {
      const type = d.type === 1 ? LineType.ACCEL : d.type === 2 ? LineType.SCENERY : LineType.NORMAL;
      const l = new Line(i + 1, type, +d.x1, +d.y1, +d.x2, +d.y2, !!d.flipped, !!d.leftExtended, !!d.rightExtended);
      if (type === LineType.ACCEL && d.multiplier > 0) { l.multiplier = d.multiplier; l.compute(); }
      return l;
    });
    let start = data.startPosition || data.riders?.[0]?.startPosition || { x: 0, y: 0 };
    return { name: data.label || data.name || '', start: { x: +start.x || 0, y: +start.y || 0 }, lines: out };
  }
  throw new Error('Unrecognised track format');
}

// linerider.com-compatible export so tracks open in other Line Rider editors too.
export function toLineRiderJSON(track, name = 'My track') {
  const lines = [...track.lines.values()].sort((a, b) => a.id - b.id).map((l, i) => {
    const o = {
      id: i + 1, type: l.type,
      x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
      flipped: l.flipped, leftExtended: l.leftExt, rightExtended: l.rightExt,
    };
    if (l.type === LineType.ACCEL) o.multiplier = l.multiplier || 1;
    if (l.type === LineType.SCENERY) { delete o.flipped; delete o.leftExtended; delete o.rightExtended; }
    return o;
  });
  return {
    label: name, creator: '', description: '', duration: 0, version: '6.2', audio: null,
    startPosition: { x: track.start.x, y: track.start.y },
    riders: [{ startPosition: { x: track.start.x, y: track.start.y }, startVelocity: { x: 0.4, y: 0 }, remountable: false }],
    lines,
  };
}

// ---------------------------------------------------------------------------
// Share links: JSON -> deflate -> base64url

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeShare(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(str) {
  const kind = str[0];
  const bytes = fromBase64Url(str.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

// ---------------------------------------------------------------------------
// Local storage helpers (wrapped: storage can be blocked or full)

export function storeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function downloadFile(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

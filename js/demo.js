// A small starter track: drop-in, a jump, a boost and a run-out.
import { LineType } from './physics.js';

function polyline(out, type, pts) {
  for (let i = 1; i < pts.length; i++) {
    out.push({ type, x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] });
  }
}

function curve(fn, x0, x1, step) {
  const pts = [];
  for (let x = x0; x < x1; x += step) pts.push([round(x), round(fn(x))]);
  pts.push([round(x1), round(fn(x1))]);
  return pts;
}

const round = (v) => Math.round(v * 100) / 100;

export function demoLines() {
  const out = [];
  // drop-in: steep at first, flattening into a valley
  polyline(out, LineType.NORMAL, curve((x) => 12 + 140 * (1 - Math.cos(Math.min(x + 30, 330) / 330 * Math.PI)) / 2 + Math.max(0, x - 300) * 0, -30, 300, 10));
  // kicker up to the lip
  polyline(out, LineType.NORMAL, curve((x) => 152 - 45 * Math.pow((x - 300) / 140, 2), 300, 440, 10));
  // landing: a long slope that eases out
  polyline(out, LineType.NORMAL, curve((x) => 150 + 160 * (1 - Math.cos((x - 560) / 380 * Math.PI)) / 2, 560, 940, 12));
  // flat run with booster
  polyline(out, LineType.NORMAL, [[940, 310], [1060, 310]]);
  polyline(out, LineType.ACCEL, [[1060, 310], [1160, 310]]);
  polyline(out, LineType.NORMAL, [[1160, 310], [1260, 310]]);
  // second kicker
  polyline(out, LineType.NORMAL, curve((x) => 310 - 40 * Math.pow((x - 1260) / 120, 2), 1260, 1380, 10));
  // big landing hill
  polyline(out, LineType.NORMAL, curve((x) => 280 + 500 * (1 - Math.cos((x - 1500) / 1200 * Math.PI)) / 2, 1500, 2700, 14));
  polyline(out, LineType.NORMAL, [[2700, 780], [3300, 780]]);
  // run-out: ease into a long uphill so the rider rolls to a stop and back
  polyline(out, LineType.NORMAL, curve((x) => 780 - 0.0006 * (x - 3300) ** 2, 3300, 3780, 12));
  polyline(out, LineType.NORMAL, [[3780, round(780 - 0.0006 * 480 ** 2)], [4800, round(780 - 0.0006 * 480 ** 2 - 0.576 * 1020)]]);
  // scenery: a little tree and a sign
  polyline(out, LineType.SCENERY, [[-62, 12], [-62, 0], [-80, 0], [-66, -14], [-76, -14], [-62, -30], [-48, -14], [-58, -14], [-44, 0], [-62, 0]]);
  polyline(out, LineType.SCENERY, [[-110, 12], [-110, 4], [-122, 4], [-112, -6], [-118, -6], [-110, -16], [-102, -6], [-108, -6], [-98, 4], [-110, 4]]);
  polyline(out, LineType.SCENERY, [[3200, 780], [3200, 740], [3240, 740], [3240, 760], [3200, 760]]);
  return out;
}

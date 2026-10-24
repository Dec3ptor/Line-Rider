import { Track, Line, LineType, Simulator, P } from '../js/physics.js';

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  if (!cond) failed++;
}

function trackWith(segments) {
  const t = new Track();
  for (const [type, x1, y1, x2, y2, flip] of segments) {
    const l = t.add(new Line(null, type, x1, y1, x2, y2, !!flip));
    t.linkEndpoints(l);
  }
  return t;
}

// 1. Gentle slope: rider lands and slides right without crashing
{
  const t = trackWith([[LineType.NORMAL, -20, 15, 400, 120]]);
  const sim = new Simulator(t);
  const s = sim.frame(200);
  check('slides down a slope', s.mounted && s.center().x > 100, `x=${s.center().x.toFixed(1)}`);
}

// 2. One-sided: a line drawn right-to-left does not hold the rider from above
{
  const t = trackWith([[LineType.NORMAL, 400, 120, -20, 15]]);
  const sim = new Simulator(t);
  const s = sim.frame(100);
  check('reversed line lets rider fall through', s.center().y > 150, `y=${s.center().y.toFixed(1)}`);
}

// 3. Big drop onto flat ground crashes the rider
{
  const t = trackWith([[LineType.NORMAL, -50, 600, 400, 600]]);
  const sim = new Simulator(t);
  const s = sim.frame(200);
  check('hard landing crashes', !s.mounted, `crashFrame=${sim.crashFrame}`);
}

// 4. Acceleration line makes the rider faster than a normal line
{
  const run = (type) => {
    const t = trackWith([[type, -20, 15, 1000, 15]]);
    const s = new Simulator(t).frame(120);
    return s.center().x;
  };
  const normal = run(LineType.NORMAL), accel = run(LineType.ACCEL);
  check('red line accelerates', accel > normal * 2, `normal=${normal.toFixed(1)} accel=${accel.toFixed(1)}`);
}

// 5. Scenery lines do not collide
{
  const t = trackWith([[LineType.SCENERY, -20, 15, 400, 120]]);
  const s = new Simulator(t).frame(100);
  check('scenery line is not solid', s.center().y > 150);
}

// 6. Cache invalidation: adding a line far away keeps cached frames
{
  const t = trackWith([[LineType.NORMAL, -20, 15, 400, 120]]);
  const sim = new Simulator(t);
  sim.frame(100);
  t.add(new Line(null, LineType.NORMAL, 5000, 5000, 5100, 5000));
  check('far edit keeps cache', sim.computed === 101);
  t.add(new Line(null, LineType.NORMAL, 100, 40, 150, 52));
  check('near edit truncates cache', sim.computed < 101 && sim.computed >= 1, `computed=${sim.computed}`);
  // determinism: recomputed result equals a fresh sim
  const a = sim.frame(150).center();
  const b = new Simulator(t).frame(150).center();
  check('recompute is deterministic', a.x === b.x && a.y === b.y);
}

// 7. Pencil-style connected segments (curve) are ridden smoothly
{
  const segs = [];
  let px = -20, py = 15;
  for (let x = -10; x <= 600; x += 6) {
    const y = 15 + 80 * (1 - Math.cos((x + 20) / 140));
    segs.push([LineType.NORMAL, px, py, x, y]);
    px = x; py = y;
  }
  const t = trackWith(segs);
  const s = new Simulator(t).frame(300);
  check('rides a curved pencil track', s.mounted, `x=${s.center().x.toFixed(1)} y=${s.center().y.toFixed(1)}`);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

// How often do flip jumps succeed at different speeds?
import { Track, Simulator } from '../js/physics.js';
import { Generator, runSync } from '../js/gen/generator.js';
import { makeRng } from '../js/gen/path.js';

for (const seed of [5, 9, 13, 21]) {
  const track = new Track(); const sim = new Simulator(track);
  const gen = new Generator(track, sim, { seed });
  runSync(gen.next());
  for (let i = 0; i < 5; i++) runSync(gen.next(seed % 2 ? 'kicker' : 'drop'));
  const why = {};
  for (let i = 0; i < 40; i++) {
    const mark = gen.pending.length;
    const res = runSync(gen.build('flip', gen.anchor, makeRng(1000 + i)));
    const key = res.ok ? `ok(${(Math.abs(res.rot) / 6.283).toFixed(1)} turns)` : res.why;
    why[key] = (why[key] || 0) + 1;
    gen.rollbackTo(mark);
  }
  console.log('seed', seed, 'speed', gen.anchor.speed.toFixed(1), JSON.stringify(why));
}

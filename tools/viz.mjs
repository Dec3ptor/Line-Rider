// Render a generated track to an HTML page (then screenshot it) for tuning.
// usage: node tools/viz.mjs <seed> <seconds> <out.html> [level]
import { writeFileSync } from 'node:fs';
import { Track, Simulator } from '../js/physics.js';
import { ChaosGenerator } from '../js/gen/chaos.js';
import { runSync } from '../js/gen/generator.js';
import { BIOMES } from '../js/gen/biomes.js';

const seed = +(process.argv[2] || 1), secs = +(process.argv[3] || 30), out = process.argv[4] || 'viz.html';
const level = process.argv[5] ? +process.argv[5] : null;
const track = new Track();
const sim = new Simulator(track);
const gen = new ChaosGenerator(track, sim, { seed, biomes: BIOMES, level });
const t0 = performance.now();
let stuck = 0;
while (gen.F < secs * 40) { if (!runSync(gen.next())) { stuck++; break; } }
gen.dressSettled(true);
{ const s = sim.frame(gen.F), m = s.center(), v = s.velocity(); console.log('final state: F', gen.F, 'pos', m.x.toFixed(0), m.y.toFixed(0), 'vel', v.x.toFixed(1), v.y.toFixed(1), 'contacts', s.contacts, 'episodeLeft', gen.episodeLeft, 'trouble', gen.trouble); }
const ms = performance.now() - t0;
// fresh re-ride check
const fresh = new Simulator(track);
let crash = -1;
for (let f = 0; f <= gen.F; f++) if (!fresh.frame(f).mounted) { crash = f; break; }
const same = JSON.stringify(fresh.frame(gen.F).center()) === JSON.stringify(sim.frame(gen.F).center());
const show = +(process.argv[6] || 0);
const win = process.argv[7] ? process.argv[7].split('-').map((x) => +x * 40) : null;
const lines0 = [...track.lines.values()].filter((l) => !show || (Math.abs(l.x1 - sim.frame(gen.F).center().x) < show && Math.abs(l.y1 - sim.frame(gen.F).center().y) < show)).map((l) => [l.type, l.x1, l.y1, l.x2, l.y2, l.style ? l.style.color : null, l.style ? l.style.width : 2]);
const path = [];
let lines = lines0;
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
if (win) for (let f = win[0]; f <= Math.min(win[1], gen.F); f++) { const c = fresh.frame(f).center(); bx0 = Math.min(bx0, c.x); bx1 = Math.max(bx1, c.x); by0 = Math.min(by0, c.y); by1 = Math.max(by1, c.y); }
const inWin = (x, y) => !win || (x > bx0 - 80 && x < bx1 + 80 && y > by0 - 80 && y < by1 + 80);
for (let f = win ? win[0] : 0; f <= (win ? Math.min(win[1], gen.F) : gen.F + 120); f++) { const c = (f <= gen.F ? fresh : sim).frame(f).center(); if (!show || (Math.abs(c.x - sim.frame(gen.F).center().x) < show && Math.abs(c.y - sim.frame(gen.F).center().y) < show)) path.push([+c.x.toFixed(1), +c.y.toFixed(1)]); }
if (win) lines = lines.filter(([t, a, b, d, e]) => inWin(a, b) || inWin(d, e));
const events = gen.events.filter((e) => e.label).map((e) => e.label);
const tally = {};
for (const e of events) tally[e] = (tally[e] || 0) + 1;
console.log(`seed ${seed}: ${(gen.F / 40).toFixed(0)}s, ${track.size} lines, ${ms.toFixed(0)} ms (${(ms / (gen.F / 40)).toFixed(0)} ms per ride-second), stuck=${stuck}`);
console.log(`fresh ride: ${crash < 0 ? 'clean' : 'CRASH at ' + crash}, identical: ${same}`);
console.log('stats', JSON.stringify(gen.stats));
console.log('tricks', JSON.stringify(tally));
writeFileSync(out, `<!doctype html><body style="margin:0;background:#fff"><canvas id=c width=1600 height=1000></canvas><script>
const L=${JSON.stringify(lines)}, P=${JSON.stringify(path)};
const c=document.getElementById('c').getContext('2d');
let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const [x,y] of P){ x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);} x0-=40;y0-=40;x1+=40;y1+=40;
const s=Math.min(1560/(x1-x0),960/(y1-y0)); c.setTransform(s,0,0,s,20-x0*s,20-y0*s);
c.lineCap='round';
for(const [t,a,b,d,e,col,w] of L){ if(t!==2) continue; c.strokeStyle=col||'#7c7';c.lineWidth=Math.max(w,0.6/s);c.beginPath();c.moveTo(a,b);c.lineTo(d,e);c.stroke(); }
c.strokeStyle='rgba(255,140,0,0.55)';c.lineWidth=1/s;c.beginPath();P.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();
for(const [t,a,b,d,e] of L){ if(t===2) continue; c.strokeStyle=t===1?'#e0261b':'#111';c.lineWidth=Math.max(2,1.6/s);c.beginPath();c.moveTo(a,b);c.lineTo(d,e);c.stroke(); }
</script>`);

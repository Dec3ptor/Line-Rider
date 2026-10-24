// Endless mode: a world that keeps building itself ahead of the rider.
import { Track, Simulator, makeRider, FPS } from './physics.js';
import { Generator } from './gen/generator.js';
import { BIOMES, decoratePiece } from './gen/biomes.js';

const AHEAD = FPS * 12;        // keep this many verified frames ahead of the rider
const KEEP_BEHIND = FPS * 10;  // frames of history kept for the camera/timeline
const PRUNE_EVERY = FPS * 4;

export class Endless {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.track = new Track();
    this.sim = new Simulator(this.track);
    this.gen = new Generator(this.track, this.sim, { seed: this.seed, biomes: BIOMES, decorate: decoratePiece });
    this.task = null;
    this.lastPrune = 0;
    this.eventPos = 0;
    this.biome = null;
    this.stats = { jumps: 0, flips: 0, loops: 0, bestAir: 0 };
    this.crashAt = -1;
    this.stuck = false;
  }

  get verified() { return this.gen.verifiedFrame; }

  // Do generation work for up to `budgetMs`. Returns true while still behind.
  work(frame, budgetMs) {
    const deadline = performance.now() + budgetMs;
    while (performance.now() < deadline) {
      if (!this.task) {
        if (this.gen.anchor && this.verified > frame + AHEAD) return false;
        this.task = this.gen.next();
      }
      const r = this.task.next();
      if (r.done) {
        this.task = null;
        if (!r.value) this.stuck = true;   // nothing fitted: restart further on when the rider gets there
        if (this.stuck) return false;
      }
    }
    return true;
  }

  // Frame the rider may advance to.
  get playableFrame() {
    return this.stuck ? Infinity : this.verified;
  }

  // Called once per animation frame with the current playback frame.
  // Returns new events that the rider has just reached.
  update(frame) {
    const fresh = [];
    const ev = this.gen.events;
    // events array is pruned from the front, so track by frame not index
    for (const e of ev) {
      if (e.frame > frame) break;
      if (e.seen) continue;
      e.seen = true;
      fresh.push(e);
      if (e.type === 'biome') this.biome = e.biome;
      if (e.type === 'air') {
        this.stats.jumps++;
        this.stats.bestAir = Math.max(this.stats.bestAir, e.air);
      }
      if (e.type === 'flip') this.stats.flips++;
      if (e.type === 'loop') this.stats.loops += e.count || 1;
    }
    if (!this.biome && this.gen.pieces.length) this.biome = this.gen.pieces[this.gen.pieces.length - 1].biome;

    if (frame - this.lastPrune > PRUNE_EVERY) {
      this.lastPrune = frame;
      const keepFrom = Math.max(0, frame - KEEP_BEHIND);
      this.sim.dropBefore(keepFrom);
      this.gen.pruneBefore(keepFrom - FPS * 5);
    }

    // safety net: should never happen because every piece is test-ridden
    const s = this.sim.frame(frame);
    if (!s.mounted || (this.stuck && frame >= this.verified)) {
      if (this.crashAt < 0) this.crashAt = frame;
      if (frame - this.crashAt > FPS * 1.5 || this.stuck) {
        this.respawn(frame);
        fresh.push({ type: 'respawn' });
      }
    } else {
      this.crashAt = -1;
    }
    return fresh;
  }

  respawn(frame) {
    const end = this.gen.anchor || { x: 0, y: 0 };
    const pos = { x: Math.round(end.x + 400), y: Math.round(end.y - 60) };
    if (this.task) { this.task.return?.(); this.task = null; }
    this.gen.rollbackTo(0);
    this.sim.setState(frame, makeRider(pos));
    this.gen.anchor = null;
    this.gen.restartFrom = { x: pos.x, y: pos.y, frame };
    this.crashAt = -1;
    this.stuck = false;
  }

  center(frame) { return this.sim.frame(frame).center(); }

  distance(frame) {
    const c = this.sim.frame(frame).center();
    return Math.max(0, Math.round((c.x - this.track.start.x) / 10));
  }
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e9) + 1;
}

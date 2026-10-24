// Endless mode: a world that keeps building itself ahead of the rider.
import { Track, Simulator, FPS } from './physics.js';
import { ChaosGenerator } from './gen/chaos.js';
import { BIOMES } from './gen/biomes.js';

const AHEAD = FPS * 16;        // keep this many checked frames ahead of the rider
const KEEP_BEHIND = FPS * 10;  // frames of history kept for the camera
const PRUNE_EVERY = FPS * 4;
const UNDO_WINDOW = FPS * 10;  // the generator may back up this far; the rider plays only what's behind it

export class Endless {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.track = new Track();
    this.sim = new Simulator(this.track);
    this.gen = new ChaosGenerator(this.track, this.sim, { seed: this.seed, biomes: BIOMES, undoWindow: UNDO_WINDOW });
    this.task = null;
    this.lastPrune = 0;
    this.biome = null;
    this.stats = { jumps: 0, flips: 0, loops: 0, reverses: 0, stops: 0, bestAir: 0 };
    this.crashAt = -1;
    this.stuck = false;
  }

  get verified() { return this.gen.verifiedFrame; }

  // Do generation work for up to `budgetMs`. Returns true while still behind.
  work(frame, budgetMs) {
    const deadline = performance.now() + budgetMs;
    while (performance.now() < deadline) {
      if (!this.task) {
        if (this.stuck) return false;
        if (this.gen.started && this.verified > frame + AHEAD) return false;
        this.task = this.gen.next();
      }
      const r = this.task.next();
      if (r.done) {
        this.task = null;
        if (!r.value) { this.stuck = true; return false; }   // dead end: start afresh when Bosh gets there
      }
    }
    return true;
  }

  // Frame the rider may advance to: track up to there is final.
  get playableFrame() {
    return this.stuck ? this.verified : this.gen.locked;
  }

  // Called once per animation frame with the current playback frame.
  // Returns the events the rider has just reached.
  update(frame) {
    const fresh = [];
    for (const e of this.gen.events) {
      // air time is reported where the jump started, but shown on landing
      const at = e.type === 'air' ? e.frame + e.air : e.frame;
      if (e.seen || at > frame) continue;
      e.seen = true;
      fresh.push(e);
      const st = this.stats;
      if (e.type === 'biome') this.biome = e.biome;
      else if (e.type === 'air') { st.jumps++; st.bestAir = Math.max(st.bestAir, e.air); }
      else if (e.type === 'flip') st.flips += e.count || 1;
      else if (e.type === 'loop') st.loops += e.count || 1;
      else if (e.type === 'reverse') st.reverses++;
      else if (e.type === 'stop') st.stops++;
    }
    if (!this.biome) this.biome = this.gen.biome;

    if (frame - this.lastPrune > PRUNE_EVERY) {
      this.lastPrune = frame;
      const keepFrom = Math.max(0, frame - KEEP_BEHIND);
      this.sim.dropBefore(keepFrom);
      this.gen.pruneBefore(keepFrom - FPS * 5);
    }

    // Safety net. Every bit of track is test-ridden, so this should only
    // happen when the generator hit a dead end it couldn't back out of.
    const s = this.sim.frame(frame);
    if (!s.mounted || (this.stuck && frame >= this.verified)) {
      if (this.crashAt < 0) this.crashAt = frame;
      if (frame - this.crashAt > FPS * 1.5 || this.stuck) {
        fresh.push({ type: 'respawn', why: s.mounted ? 'stuck' : 'crash' });
        this.respawn(frame);
      }
    } else {
      this.crashAt = -1;
    }
    return fresh;
  }

  // Put Bosh on a fresh start ramp past everything built so far.
  respawn(frame) {
    if (this.task) { this.task.return?.(); this.task = null; }
    let maxX = -Infinity;
    for (const ch of this.gen.chunks.slice(-12)) for (const l of ch.lines) maxX = Math.max(maxX, l.maxX);
    const c = this.sim.frame(Math.min(frame, this.verified)).center();
    const pos = { x: Math.round(Math.max(maxX, c.x) + 400), y: Math.round(c.y - 60) };
    this.gen.restartAt(pos, frame);
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

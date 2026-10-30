/** Cancels the frame source while paused/hidden; a resume starts a fresh clock sample. */
export class MotionLoop {
  constructor({ render, request = requestAnimationFrame.bind(globalThis), cancel = cancelAnimationFrame.bind(globalThis) }) {
    this.render = render;
    this.request = request;
    this.cancel = cancel;
    this.time = 0;
    this.paused = false;
    this.hidden = false;
    this.started = false;
    this.disposed = false;
    this.frame = null;
    this.last = null;
    this.lastPaint = null;
    this.tick = this.tick.bind(this);
  }

  start() { this.started = true; this.sync(); }
  setPaused(value) { this.paused = value; this.sync(); }
  setHidden(value) { this.hidden = value; this.sync(); }

  sync() {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.last = null;
    this.lastPaint = null;
    if (this.started && !this.disposed && !this.paused && !this.hidden) this.frame = this.request(this.tick);
  }

  tick(now) {
    this.frame = null;
    if (this.disposed || this.paused || this.hidden) return;
    if (this.last !== null) this.time += Math.min((now - this.last) / 1000, 0.06);
    this.last = now;
    // 30 fps is enough for these very slow trajectories; high-refresh screens do no extra GPU work.
    if (this.lastPaint === null || now - this.lastPaint >= 1000 / 30 - 0.2) {
      this.render(this.time);
      this.lastPaint = now;
    }
    this.frame = this.request(this.tick);
  }

  draw() { if (!this.disposed && !this.hidden) this.render(this.time); }
  dispose() { this.disposed = true; this.sync(); }
}

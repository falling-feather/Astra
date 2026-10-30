const smooth = value => value * value * (3 - 2 * value);
export const FOOT_RIPPLE_PERIOD=2.8;

/** A normalized three-scene blend; selecting mid-fade starts from the visible mix. */
export class SceneCycle {
  constructor({ hold = 18, fade = 7 } = {}) {
    if (!(hold > 0 && fade > 0)) throw new RangeError('Scene durations must be positive');
    this.hold = hold;
    this.fade = fade;
    this.index = 0;
    this.weights = [1, 0, 0];
    this.elapsed = 0;
    this.from = null;
  }

  select(index, { immediate = false } = {}) {
    if (!Number.isInteger(index) || index < 0 || index > 2) throw new RangeError('Unknown scene');
    this.index = index;
    this.elapsed = 0;
    this.from = immediate ? null : [...this.weights];
    if (immediate) this.weights = this.weights.map((_, i) => Number(i === index));
  }

  advance(seconds) {
    let remaining = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    while (remaining > 1e-9) {
      const duration = this.from ? this.fade : this.hold;
      const used = Math.min(remaining, duration - this.elapsed);
      this.elapsed += used;
      remaining -= used;
      if (this.from) {
        const amount = smooth(Math.min(1, this.elapsed / this.fade));
        this.weights = this.from.map((weight, i) => weight * (1 - amount) + Number(i === this.index) * amount);
      }
      if (this.elapsed >= duration - 1e-9) {
        if (this.from) {
          this.weights = this.weights.map((_, i) => Number(i === this.index));
          this.from = null;
          this.elapsed = 0;
        } else {
          this.select((this.index + 1) % 3);
        }
      }
    }
  }

  get progress() { return this.from ? this.elapsed / this.fade : this.elapsed / this.hold; }
}

export class AnimationClock {
  constructor({ paused = false } = {}) {
    this.time = 0;
    this.paused = paused;
    this.hidden = false;
  }
  advance(delta) {
    const dt = this.paused || this.hidden ? 0 : Math.max(0, Math.min(0.05, Number.isFinite(delta) ? delta : 0));
    this.time += dt;
    return dt;
  }
}

/** Return only pulse times in (start, end], including redraw-safe interval boundaries. */
export function footRippleTimesBetween(start, end, interval = FOOT_RIPPLE_PERIOD) {
  if (!(end > start) || !(interval > 0)) return [];
  const events = [];
  const first = Math.floor((start + 1e-10) / interval) + 1;
  const last = Math.floor((end + 1e-10) / interval);
  for (let i = first; i <= last; i++) events.push(i * interval);
  return events;
}

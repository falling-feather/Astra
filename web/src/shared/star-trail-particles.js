const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Distance-based emission stays equally dense on 30 Hz and 240 Hz pointers. */
export class StarTrailParticles {
  constructor() {
    this.particles = [];
    this.capacity = 128;
    this.spacing = 6.5;
    this.emitted = 0;
    this.seed = 76213;
    this.resetPointer();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  resetPointer() { this.previous = null; this.remainder = 0; }
  clear() { this.particles.length = 0; this.resetPointer(); }

  moveTo(x, y, now) {
    if (![x, y, now].every(Number.isFinite)) return;
    const end = { x, y, now }, previous = this.previous;
    this.previous = end;
    if (!previous || now - previous.now > 180 || now < previous.now) {
      this.remainder = 0;
      return;
    }
    let dx = x - previous.x, dy = y - previous.y, distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return;
    const ux = dx / distance, uy = dy / distance;
    const speed = clamp(distance / Math.max(8, now - previous.now), 0, 2);
    let start = previous;
    if (distance > 240) {
      start = { x: x - ux * 240, y: y - uy * 240, now };
      distance = 240;
      this.remainder = 0;
    }
    for (let along = this.spacing - this.remainder; along <= distance + 1e-8; along += this.spacing) {
      const ratio = along / distance, id = this.emitted++;
      this.particles.push({
        x: start.x + ux * along, y: start.y + uy * along,
        born: start.now + (now - start.now) * ratio,
        life: 570 + this.random() * 470,
        vx: -ux * (7 + speed * 4) + (this.random() - .5) * 24,
        vy: -uy * (7 + speed * 4) + (this.random() - .5) * 20 - 3,
        size: id % 5 === 0 ? 13 + this.random() * 8 : 5 + this.random() * 7,
        star: id % 5 === 0, color: id % 7 === 0 ? 1 : id % 3 === 0 ? 2 : 0,
        phase: this.random() * Math.PI * 2,
      });
    }
    this.remainder = (this.remainder + distance) % this.spacing;
    if (this.remainder < 1e-7 || this.spacing - this.remainder < 1e-7) this.remainder = 0;
    if (this.particles.length > this.capacity) this.particles.splice(0, this.particles.length - this.capacity);
  }

  advance(now) {
    let live = 0;
    for (const particle of this.particles) {
      if (now < particle.born + particle.life) this.particles[live++] = particle;
    }
    this.particles.length = live;
    return this.particles.map(particle => sampleTrailParticle(particle, now));
  }
}

/** Analytic drift/fade: delayed frames cannot stretch a one-second trail forever. */
export function sampleTrailParticle(particle, now) {
  const age = Math.max(0, now - particle.born), progress = clamp(age / particle.life, 0, 1);
  const drift = (1 - Math.exp(-age / 1000 * 3.2)) / 3.2;
  const shimmer = .78 + .22 * Math.sin(age / 1000 * 12 + particle.phase);
  return {
    ...particle, x: particle.x + particle.vx * drift, y: particle.y + particle.vy * drift,
    age, alpha: Math.pow(1 - progress, 1.65) * shimmer,
    size: particle.size * (.62 + (1 - progress) * .38),
  };
}

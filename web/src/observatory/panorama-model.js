const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function wrapPosition(value, period) {
  if (!(period > 0)) throw new RangeError('星空周期必须大于零。');
  return ((value % period) + period) % period;
}

export function wrapDelta(delta, period) {
  return wrapPosition(delta + period / 2, period) - period / 2;
}

/** One projection for nebulae, stars, labels, hit targets and the sector index. */
export function projectWorldPoint(point, camera, viewport, world, out = {}) {
  out.dx = wrapDelta(point.x - camera.x, world.width);
  out.dy = point.y - camera.y;
  out.x = viewport.width / 2 + out.dx * viewport.scale;
  out.y = viewport.height / 2 + out.dy * viewport.scale;
  return out;
}

export function worldPointAt(point, camera, viewport, world, out = {}) {
  out.x = wrapPosition(camera.x + (point.x - viewport.width / 2) / viewport.scale, world.width);
  out.y = camera.y + (point.y - viewport.height / 2) / viewport.scale;
  return out;
}

/** Bounded vertical exploration around a horizontally periodic world. */
export class PanoramaController {
  constructor({ world, initial }) {
    if (!(world.width > 0 && world.height > 0)) throw new RangeError('星空需要有效尺寸。');
    this.world = world;
    this.initial = { x: initial?.x ?? world.width / 2, y: initial?.y ?? world.height / 2, zoom: initial?.zoom ?? 1 };
    this.camera = { ...this.initial };
    this.viewport = { width: 1120, height: 840, scale: 1 };
    this.baseScale = 1;
    this.velocity = { x: 0, y: 0 };
    this.dragging = false;
    this.flight = null;
    this.constrain();
  }

  get minZoom() {
    return Math.max(.6, this.viewport.width / (this.baseScale * this.world.width * .82), this.viewport.height / (this.baseScale * this.world.height * .96));
  }
  get maxZoom() { return Math.max(2.2, this.minZoom); }
  get moving() { return Boolean(this.flight) || (!this.dragging && Math.hypot(this.velocity.x, this.velocity.y) > 2); }

  constrain() {
    this.camera.zoom = clamp(this.camera.zoom, this.minZoom, this.maxZoom);
    this.viewport.scale = this.baseScale * this.camera.zoom;
    this.camera.x = wrapPosition(this.camera.x, this.world.width);
    const halfHeight = Math.min(this.world.height / 2, this.viewport.height / this.viewport.scale / 2);
    this.camera.y = clamp(this.camera.y, halfHeight, this.world.height - halfHeight);
  }

  resize(width, height) {
    if (!(width > 0 && height > 0)) return;
    this.viewport.width = width; this.viewport.height = height;
    this.baseScale = Math.min(width / 1120, height / 840);
    this.flight = null;
    this.constrain();
  }

  beginDrag() {
    this.stop(); this.dragging = true;
  }

  dragBy(dx, dy, elapsed = .016) {
    if (!this.dragging || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const x = -dx / this.viewport.scale, y = -dy / this.viewport.scale;
    this.camera.x += x; this.camera.y += y;
    const dt = Math.max(.008, elapsed);
    this.velocity.x = this.velocity.x * .45 + clamp(x / dt, -1800, 1800) * .55;
    this.velocity.y = this.velocity.y * .45 + clamp(y / dt, -1100, 1100) * .55;
    this.constrain();
  }

  endDrag(inertia = true) {
    this.dragging = false;
    if (!inertia) this.velocity.x = this.velocity.y = 0;
  }

  stop() {
    this.velocity.x = this.velocity.y = 0;
    this.flight = null;
    this.dragging = false;
  }

  zoomAt(factor, point = { x: this.viewport.width / 2, y: this.viewport.height / 2 }) {
    if (!(factor > 0 && Number.isFinite(factor))) return;
    const anchor = worldPointAt(point, this.camera, this.viewport, this.world);
    this.stop();
    this.camera.zoom = clamp(this.camera.zoom * factor, this.minZoom, this.maxZoom);
    this.viewport.scale = this.baseScale * this.camera.zoom;
    this.camera.x = anchor.x - (point.x - this.viewport.width / 2) / this.viewport.scale;
    this.camera.y = anchor.y - (point.y - this.viewport.height / 2) / this.viewport.scale;
    this.constrain();
  }

  focus(point, { animate = true, duration = .85 } = {}) {
    this.stop();
    const halfHeight = Math.min(this.world.height / 2, this.viewport.height / this.viewport.scale / 2);
    const y = clamp(point.y, halfHeight, this.world.height - halfHeight);
    const dx = wrapDelta(point.x - this.camera.x, this.world.width);
    if (!animate || duration <= 0) {
      this.camera.x += dx; this.camera.y = y; this.constrain();
      return;
    }
    this.flight = { startX: this.camera.x, startY: this.camera.y, dx, dy: y - this.camera.y, elapsed: 0, duration };
  }

  reset(options) {
    this.camera.zoom = clamp(this.initial.zoom, this.minZoom, this.maxZoom);
    this.constrain(); this.focus(this.initial, options);
  }

  step(elapsed) {
    const dt = clamp(elapsed, 0, .1);
    if (!dt || this.dragging) return false;
    if (this.flight) {
      const flight = this.flight;
      flight.elapsed += dt;
      const progress = Math.min(1, flight.elapsed / flight.duration), eased = 1 - Math.pow(1 - progress, 3);
      this.camera.x = flight.startX + flight.dx * eased;
      this.camera.y = flight.startY + flight.dy * eased;
      if (progress === 1) this.flight = null;
      this.constrain(); return true;
    }
    if (!this.moving) { this.velocity.x = this.velocity.y = 0; return false; }
    const drag = 5.2, distance = (1 - Math.exp(-drag * dt)) / drag;
    this.camera.x += this.velocity.x * distance;
    const intendedY = this.camera.y + this.velocity.y * distance;
    this.camera.y = intendedY;
    this.constrain();
    if (Math.abs(this.camera.y - intendedY) > 1e-8) this.velocity.y = 0;
    this.velocity.x *= Math.exp(-drag * dt); this.velocity.y *= Math.exp(-drag * dt);
    return true;
  }
}

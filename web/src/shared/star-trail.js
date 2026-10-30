import './star-trail.css';
import { StarTrailParticles } from './star-trail-particles.js';

const COLORS = ['#aed8ff', '#ffe0a0', '#e2dcff'];

function sparkSprite(color, star) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 96;
  const ctx = sprite.getContext('2d');
  const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 45);
  glow.addColorStop(0, '#fffef4');
  glow.addColorStop(.07, color);
  glow.addColorStop(.25, `${color}70`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 96, 96);
  if (star) {
    ctx.fillStyle = '#fff7e4';
    ctx.beginPath();
    ctx.moveTo(48, 8); ctx.lineTo(52, 43); ctx.lineTo(85, 48); ctx.lineTo(52, 53);
    ctx.lineTo(48, 88); ctx.lineTo(44, 53); ctx.lineTo(11, 48); ctx.lineTo(44, 43);
    ctx.closePath(); ctx.fill();
  }
  return sprite;
}

/** One shared, non-interactive overlay for all three pages. It sleeps when empty. */
export function createStarTrail({ paused = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-star-trail';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.inert = true;
  document.body.append(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('无法创建星光尾迹画布。');
  const sprites = COLORS.map(color => [sparkSprite(color, false), sparkSprite(color, true)]);
  const model = new StarTrailParticles();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController(), { signal } = events;
  let suspended = false, disposed = false, frameId = 0, width = 0, height = 0, frames = 0;
  let lastFrame = null, budget = 0;
  const interval = 1000 / 60;
  const blocked = () => paused || document.hidden || suspended || preference.matches || disposed;

  function clear() {
    cancelAnimationFrame(frameId); frameId = 0; lastFrame = null; budget = 0;
    model.clear(); context.clearRect(0, 0, width, height);
  }
  function resize() {
    width = innerWidth; height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    clear();
  }
  function draw(particles) {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    context.strokeStyle = '#b8dbff'; context.lineWidth = .7;
    let previous = null;
    for (const particle of particles) {
      if (particle.age < 270) {
        if (previous && Math.hypot(particle.x - previous.x, particle.y - previous.y) < 26) {
          context.globalAlpha = Math.min(particle.alpha, previous.alpha) * .28;
          context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(particle.x, particle.y); context.stroke();
        }
        previous = particle;
      }
      context.globalAlpha = particle.alpha * (particle.star ? .92 : .76);
      context.drawImage(sprites[particle.color][Number(particle.star)], particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    context.globalAlpha = 1;
    frames++;
  }
  function frame(now) {
    frameId = 0;
    if (blocked()) { clear(); return; }
    const particles = model.advance(now);
    budget += lastFrame === null ? interval : now - lastFrame;
    lastFrame = now;
    if (budget + 1e-4 >= interval || !particles.length) {
      draw(particles); budget = Math.max(0, budget % interval);
    }
    if (particles.length) frameId = requestAnimationFrame(frame);
    else { lastFrame = null; budget = 0; }
  }
  function move(event) {
    if (event.pointerType !== 'mouse' || blocked()) return;
    // Event timestamps use the same monotonic clock as requestAnimationFrame.
    const now = performance.now();
    model.moveTo(event.clientX, event.clientY, now);
    if (!frameId && model.particles.length) frameId = requestAnimationFrame(frame);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; clear(); events.abort(); canvas.remove();
    if (window.__ASTRA_TRAIL__ === diagnostic) delete window.__ASTRA_TRAIL__;
  }
  const diagnostic = Object.freeze({ get state() { return {
    particles: model.particles.length, emitted: model.emitted, frames, running: Boolean(frameId),
    paused, reduced: preference.matches, hidden: document.hidden || suspended, width, height,
  }; } });
  Object.defineProperty(window, '__ASTRA_TRAIL__', { configurable: true, value: diagnostic });
  window.addEventListener('pointermove', move, { passive: true, signal });
  window.addEventListener('pointerout', event => { if (!event.relatedTarget) model.resetPointer(); }, { signal });
  window.addEventListener('blur', clear, { signal });
  window.addEventListener('resize', resize, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); }, { signal });
  preference.addEventListener('change', clear, { signal });
  window.addEventListener('pagehide', event => {
    if (event.persisted) { suspended = true; clear(); }
    else dispose();
  }, { signal });
  window.addEventListener('pageshow', () => { suspended = false; model.resetPointer(); }, { signal });
  resize();
  return {
    setPaused(value) {
      const next = Boolean(value);
      if (next === paused) return;
      paused = next; clear();
    },
    dispose,
  };
}

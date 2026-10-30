import test from 'node:test';
import assert from 'node:assert/strict';
import { StarTrailParticles, sampleTrailParticle } from '../src/shared/star-trail-particles.js';

function stroke(samples) {
  const trail = new StarTrailParticles();
  for (let i = 0; i <= samples; i++) trail.moveTo(i / samples * 360, 120, i / samples * 300);
  return trail;
}

test('同一路径在不同鼠标事件频率下生成相同密度的星光', () => {
  const sparse = stroke(9), dense = stroke(36);
  assert.equal(sparse.emitted, dense.emitted);
  assert.ok(sparse.emitted >= 50 && sparse.emitted <= 60);
  sparse.particles.forEach((particle, index) => {
    assert.ok(Math.abs(particle.x - dense.particles[index].x) < 1e-7);
    assert.ok(Math.abs(particle.born - dense.particles[index].born) < 1e-7);
  });
});

test('鼠标静止不持续发射，尾迹在生命周期结束后全部消散', () => {
  const trail = stroke(12), count = trail.emitted;
  for (let t = 310; t < 700; t += 10) trail.moveTo(360, 120, t);
  assert.equal(trail.emitted, count);
  assert.ok(trail.advance(500).length > 0);
  assert.equal(trail.advance(1700).length, 0);
});

test('长时间停留或重新进入页面后，不从旧位置拉出贯穿页面的亮线', () => {
  const trail = stroke(12), count = trail.emitted;
  trail.moveTo(800, 500, 2000);
  assert.equal(trail.emitted, count);
  trail.moveTo(820, 500, 2020);
  assert.ok(trail.particles.slice(-3).every(p => p.x >= 800));
  trail.resetPointer();
  const before = trail.emitted;
  trail.moveTo(10, 10, 2050);
  assert.equal(trail.emitted, before);
});

test('高速移动受到粒子数和单段发射长度限制', () => {
  const trail = new StarTrailParticles();
  trail.moveTo(0, 0, 0);
  for (let i = 1; i <= 100; i++) trail.moveTo(i % 2 ? 1900 : 0, 400, i * 8);
  assert.ok(trail.particles.length <= trail.capacity);
  assert.ok(trail.particles.length > 0);
  assert.ok(trail.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('粒子位置与淡出只取决于绝对年龄，不依赖绘制帧率', () => {
  const trail = stroke(12), particle = trail.particles[10];
  const direct = sampleTrailParticle(particle, 400);
  for (let t = particle.born; t < 400; t += 1000 / 144) sampleTrailParticle(particle, t);
  assert.deepEqual(sampleTrailParticle(particle, 400), direct);
  assert.equal(sampleTrailParticle(particle, particle.born + particle.life).alpha, 0);
  trail.clear();
  assert.equal(trail.particles.length, 0);
  const before = trail.emitted;
  trail.moveTo(500, 500, 1000);
  assert.equal(trail.emitted, before, '清空后第一事件仅注册新鼠标位置');
});

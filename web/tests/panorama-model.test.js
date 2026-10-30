import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapDelta, wrapPosition, projectWorldPoint, worldPointAt, PanoramaController } from '../src/observatory/panorama-model.js';
import { COURSE_GALAXIES, PANORAMA_WORLD } from '../src/observatory/courses.js';

test('横向完整绕行后回到同一星区，负方向和多圈同样成立', () => {
  const width = PANORAMA_WORLD.width;
  for (const turns of [-100, -2, -1, 0, 1, 3, 200]) {
    assert.equal(wrapPosition(137 + width * turns, width), 137);
    assert.equal(wrapDelta(90 + width * turns, width), 90);
  }
  assert.equal(wrapDelta(width - 120, width), -120);
});

test('跨接缝时星系和星点连续经过视口，不从画面中间跳走', () => {
  const world = { width: 7200, height: 2600 }, viewport = { width: 1000, height: 800, scale: 1 };
  const point = { x: 20, y: 1000 };
  const before = projectWorldPoint(point, { x: 7190, y: 1000 }, viewport, world);
  const after = projectWorldPoint(point, { x: 10, y: 1000 }, viewport, world);
  assert.equal(after.x - before.x, -20);
  assert.equal(after.y, before.y);
  const output = {};
  assert.equal(projectWorldPoint(point, { x: 10, y: 1000 }, viewport, world, output), output);
});

test('屏幕与世界互相映射，在接缝附近仍能正确点击星系', () => {
  const camera = { x: 7180, y: 1200 }, viewport = { width: 991, height: 898, scale: .8 };
  const point = { x: 80, y: 1310 };
  const screen = projectWorldPoint(point, camera, viewport, PANORAMA_WORLD);
  const restored = worldPointAt(screen, camera, viewport, PANORAMA_WORLD);
  assert.ok(Math.abs(restored.x - point.x) < 1e-8);
  assert.ok(Math.abs(restored.y - point.y) < 1e-8);
});

test('相机拖过一圈返回起点，并始终有垂直边界', () => {
  const map = new PanoramaController({ world: PANORAMA_WORLD, initial: { x: 900, y: 1300, zoom: 1 } });
  map.resize(1120, 840);
  const start = { ...map.camera };
  map.beginDrag(); map.dragBy(PANORAMA_WORLD.width * map.viewport.scale, 0, .1); map.endDrag(false);
  assert.ok(Math.abs(map.camera.x - start.x) < 1e-8);
  map.beginDrag(); map.dragBy(0, 100000, .1); map.endDrag(false);
  assert.ok(map.camera.y >= map.viewport.height / map.viewport.scale / 2);
});

test('缩放围绕鼠标指向的世界位置，且不会缩出水平周期和垂直范围', () => {
  const map = new PanoramaController({ world: PANORAMA_WORLD, initial: { x: 1500, y: 1300, zoom: 1 } });
  map.resize(1120, 840);
  const pointer = { x: 780, y: 410 }, before = worldPointAt(pointer, map.camera, map.viewport, PANORAMA_WORLD);
  map.zoomAt(1.3, pointer);
  const after = worldPointAt(pointer, map.camera, map.viewport, PANORAMA_WORLD);
  assert.ok(Math.abs(wrapDelta(after.x - before.x, PANORAMA_WORLD.width)) < 1e-7);
  assert.ok(Math.abs(after.y - before.y) < 1e-7);
  for (const [width, height] of [[390, 844], [991, 898], [3840, 1080]]) {
    map.resize(width, height); map.zoomAt(.0001, { x: width / 2, y: height / 2 });
    assert.ok(width / map.viewport.scale <= PANORAMA_WORLD.width * .82 + 1e-7);
    assert.ok(height / map.viewport.scale <= PANORAMA_WORLD.height + 1e-7);
  }
});

test('目录定位走跨接缝的短路径，减少动效时可以立即到达', () => {
  const map = new PanoramaController({ world: PANORAMA_WORLD, initial: { x: 7100, y: 1300, zoom: 1 } });
  map.resize(1120, 840);
  map.focus({ x: 100, y: 1400 }); map.step(.3);
  assert.ok(Math.abs(wrapDelta(map.camera.x - 7100, 7200)) < 201);
  for (let i = 0; i < 30; i++) map.step(.05);
  assert.ok(Math.abs(map.camera.x - 100) < 1e-7);
  assert.equal(map.moving, false);
  map.focus(COURSE_GALAXIES[2].position, { animate: false });
  assert.equal(map.camera.x, COURSE_GALAXIES[2].position.x);
});

test('松手后的惯性会衰减，新拖动和停止操作会取消旧惯性', () => {
  const map = new PanoramaController({ world: PANORAMA_WORLD, initial: { x: 900, y: 1300, zoom: 1 } });
  map.resize(1120, 840); map.beginDrag(); map.dragBy(40, 0, .04); map.endDrag();
  const released = map.camera.x; map.step(.05);
  assert.notEqual(map.camera.x, released);
  for (let i = 0; i < 120; i++) map.step(.05);
  assert.equal(map.moving, false);
  map.beginDrag(); map.dragBy(20, 0, .04); map.endDrag(); map.stop();
  const stopped = map.camera.x; map.step(.1);
  assert.equal(map.camera.x, stopped);
});

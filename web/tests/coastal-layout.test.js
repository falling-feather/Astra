import test from 'node:test';
import assert from 'node:assert/strict';
import { coastalLayout } from '../src/observatory/coastal-layout.js';
import { createLayerState } from '../src/observatory/layers.js';
import { PanoramaController, projectWorldPoint } from '../src/observatory/panorama-model.js';
import { PANORAMA_WORLD, COURSE_GALAXIES } from '../src/observatory/courses.js';
import { projectPoint } from '../src/observatory/motion.js';

test('竖屏同时保留左侧海潮和右侧观星前景，不裁成全幅悬崖', () => {
  const layers = createLayerState();
  for (const [width,height] of [[320,568],[390,844],[540,960]]) {
    const layout = coastalLayout(width,height,layers);
    const ocean = projectPoint(.60,.80,layout.frame,width,height);
    const child = projectPoint(.90,.60,layout.frame,width,height);
    assert.ok(ocean.x > 0 && ocean.x < width*.55);
    assert.ok(ocean.y > layout.waterline && ocean.y < height);
    assert.ok(child.x > width*.6 && child.x < width);
    assert.ok(Math.abs(width/(1672*layout.frame.cropX)-height/(941*layout.frame.cropY)) < 1e-9);
  }
});

test('海潮前景全幅保留，可拖动天空只延伸到固定海天交界处', () => {
  const layers = createLayerState();
  for (const [width, height] of [[1672,941],[991,898],[390,844],[2560,1080]]) {
    const layout = coastalLayout(width, height, layers);
    assert.deepEqual(layout.coast, { width, height });
    assert.ok(layout.sky.height >= layout.waterline);
    assert.ok(layout.sky.height < height);
    assert.ok(layout.telescope.x > 0 && layout.telescope.x < width);
    assert.ok(layout.telescope.y > 0 && layout.telescope.y < height);
  }
});

test('绕行与缩放天空不改变海潮、望远镜的布局和命中范围', () => {
  const layers = createLayerState(), before = coastalLayout(1672,941,layers);
  const map = new PanoramaController({ world: PANORAMA_WORLD, initial: { ...COURSE_GALAXIES[0].position, zoom:1 } });
  map.resize(before.sky.width, before.sky.height);
  const first = projectWorldPoint(COURSE_GALAXIES[0].position, map.camera, map.viewport, PANORAMA_WORLD);
  map.beginDrag(); map.dragBy(500,120,.1); map.endDrag(false); map.zoomAt(1.3);
  const second = projectWorldPoint(COURSE_GALAXIES[0].position, map.camera, map.viewport, PANORAMA_WORLD);
  assert.notEqual(first.x, second.x);
  assert.deepEqual(coastalLayout(1672,941,layers), before);
});

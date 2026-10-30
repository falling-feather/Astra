import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoastComposer,galaxyFocusPoint,presentationZoom,galaxyLabelLayout} from '../src/observatory/desktop-composition.js';
import {createLayerState,layerRect,projectLayer,registrationMetrics} from '../src/observatory/layers.js';
import {coastalLayout} from '../src/observatory/coastal-layout.js';
import {COURSE_GALAXIES,PANORAMA_WORLD} from '../src/observatory/courses.js';
import {PanoramaController,projectWorldPoint} from '../src/observatory/panorama-model.js';

const sizes=[[1366,768],[1920,1080],[1024,640],[2560,1080],[991,898],[1920,640],[1366,600]];
test('桌面海面约占三成，前景缩小后仍等比且眼睛与目镜准确相接',()=>{
  const layers=createLayerState(),arrange=createCoastComposer(layers);
  for(const [w,h] of sizes){
    arrange(w,h);const layout=coastalLayout(w,h,layers),points=registrationMetrics(layers);
    assert.ok(Math.abs(layout.waterline/h-.695)<.001);
    assert.ok(points.eyeGap<1e-7);
    const child=projectLayer(layers.find(x=>x.id==='child'),layout.frame,w,h).rect;
    assert.ok(child.height<h*.18&&child.height>h*.10);
    assert.ok(child.x>w*.83&&child.x+child.width<w*.98);
    assert.ok(Math.abs(child.width/child.height-2/3)<1e-8);
    const scale=w/(1672*layout.frame.cropX);
    assert.ok(Math.abs(points.childFeet.y-points.cliffSurface.y)*scale<6);
    assert.ok(Math.abs(points.telescopeFeet.y-points.cliffSurface.y)*scale<6);
    assert.ok(layout.telescope.x>w*.77&&layout.telescope.x<w*.94);
  }
});

test('桌面布局反复调整不累积缩放，切回窄屏恢复已有图层',()=>{
  const layers=createLayerState(),original=structuredClone(layers),arrange=createCoastComposer(layers);
  arrange(1366,768);const first=layers.map(layerRect);
  arrange(1920,1080);arrange(1366,768);
  assert.deepEqual(layers.map(layerRect),first);
  arrange(390,844);assert.deepEqual(layers,original);
});

test('初始聚焦及四星系切换时，标题、统计和课程按钮位于天空内',()=>{
  const layers=createLayerState(),arrange=createCoastComposer(layers);
  for(const [w,h] of sizes)for(const category of COURSE_GALAXIES){
    arrange(w,h);const {sky}=coastalLayout(w,h,layers);
    const map=new PanoramaController({world:PANORAMA_WORLD,initial:category.position});
    map.resize(w,sky.height);map.camera.zoom=presentationZoom(category,map.viewport);map.constrain();
    map.focus(galaxyFocusPoint(category,map.viewport),{animate:false});
    const point=projectWorldPoint(category.position,map.camera,map.viewport,PANORAMA_WORLD);
    const label=galaxyLabelLayout(category,point,map.viewport);
    assert.equal(label.visible,true,`${w}×${h} ${category.id}`);
    assert.ok(point.y+label.labelOffset>h*.35);
    assert.ok(point.y+label.labelOffset+label.copyHeight<sky.height);
    assert.ok(point.x-label.labelWidth/2>20);
    assert.ok(label.titleSize>=30);
  }
});

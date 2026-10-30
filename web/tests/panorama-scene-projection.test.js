import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWorldPoint} from '../src/observatory/panorama-model.js';
import {projectPanoramaDisc,projectConnectedWorldPoint,panoramaBackgroundUniforms,panoramaPixelRatio} from '../src/observatory/panorama-scene-projection.js';

const world={width:7200,height:2600},viewport={width:1000,height:800,scale:1};

test('星云与局部光色在横向接缝处使用同一最近周期位置',()=>{
  const disc=projectPanoramaDisc({position:{x:5,y:900},radius:330},{x:7195,y:1000},viewport,world);
  assert.equal(disc.x,510);assert.equal(disc.y,300);assert.equal(disc.radius,330);assert.equal(disc.visible,true);
  const before=projectPanoramaDisc({position:{x:2,y:1000},radius:330},{x:7199,y:1000},viewport,world);
  const after=projectPanoramaDisc({position:{x:2,y:1000},radius:330},{x:1,y:1000},viewport,world);
  assert.equal(after.x-before.x,-2);
});

test('流星与细丝跨接缝仍是短轨迹，不连出贯穿全屏的假长线',()=>{
  const camera={x:0,y:1000},head={x:3,y:1000},headScreen=projectWorldPoint(head,camera,viewport,world);
  const tail=projectConnectedWorldPoint({x:7193,y:990},head,headScreen,viewport,world);
  assert.equal(tail.x,493);assert.equal(tail.y,390);
  const opposite={x:7100,y:1000},oppositeScreen=projectWorldPoint(opposite,{x:3500,y:1000},viewport,world);
  const nearby=projectConnectedWorldPoint({x:7070,y:1010},opposite,oppositeScreen,viewport,world);
  assert.equal(nearby.x-oppositeScreen.x,-30);
  assert.ok(nearby.x<0&&oppositeScreen.x<0);
});

test('相机走满一圈后背景着色参数与星云投影完全一致',()=>{
  const a={x:13.25,y:1020},b={x:7213.25,y:1020};
  const uniformA=panoramaBackgroundUniforms(a,viewport,world),uniformB=panoramaBackgroundUniforms(b,viewport,world);
  assert.ok(uniformA.phaseX>0);assert.deepEqual(uniformA,uniformB);
  const nebula={position:{x:7080,y:1000},radius:310};
  assert.deepEqual(projectPanoramaDisc(nebula,a,viewport,world),projectPanoramaDisc(nebula,b,viewport,world));
});

test('手机与高分屏绘制像素受预算限制，尺寸变大不会无限乘DPR',()=>{
  for(const [width,height,dpr,mobile,budget] of [[390,844,3,true,1800000],[991,898,3,true,1800000],[2560,1600,2,false,3400000]]){
    const ratio=panoramaPixelRatio(width,height,dpr,mobile);
    assert.ok(ratio>0&&ratio<=dpr);assert.ok(width*height*ratio*ratio<=budget+1);
  }
});

test('银河按四个星区循环，世界首尾一致且纹理保持接近原画的宽高比',()=>{
  const a=panoramaBackgroundUniforms({x:18,y:1000},viewport,world),half=panoramaBackgroundUniforms({x:3618,y:1000},viewport,world),full=panoramaBackgroundUniforms({x:7218,y:1000},viewport,world);
  assert.equal(a.dustPhaseX,.01);assert.equal(half.dustPhaseX,a.dustPhaseX);assert.equal(full.dustPhaseX,a.dustPhaseX);
  assert.equal(a.dustHorizontalSpan,1000/1800);
  assert.equal(a.dustVerticalSpan,.8);assert.equal(a.dustCenterY,.4);
});

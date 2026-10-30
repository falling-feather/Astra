import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerState, patchLayer, layerRect, layerPoint, projectLayer, lensFrame, registrationMetrics } from '../src/observatory/layers.js';
import { sceneFrame } from '../src/observatory/motion.js';
import { Texture } from 'three';
import { loadLayerTextures } from '../src/observatory/scene.js';

const fixture=()=>[
  {id:'child',src:'/child.png',rect:{x:1420,y:370,width:80,height:230},position:{x:0,y:0},scale:{x:1,y:1},anchor:{x:.5,y:1},opacity:1,tint:[1,1,1],anchors:{eye:{x:.1,y:.1},feet:{x:.5,y:1}}},
  {id:'telescope',src:'/telescope.png',rect:{x:1300,y:360,width:128,height:240},position:{x:0,y:0},scale:{x:1,y:1},anchor:{x:.5,y:1},opacity:1,tint:[1,1,1],anchors:{eyepiece:{x:1,y:.1375},feet:{x:.5,y:1}}},
];

test('独立裁片的眼位、目镜和落脚点经同一映射准确注册',()=>{
  const [child,telescope]=createLayerState(fixture());
  assert.deepEqual(layerPoint(child,'eye'),{x:1428,y:393});
  assert.deepEqual(layerPoint(telescope,'eyepiece'),{x:1428,y:393});
  assert.equal(layerPoint(child,'feet').y,600);
  assert.equal(layerPoint(telescope,'feet').y,600);
});

test('缩放以注册点为中心，调整人物不改变望远镜或原始素材清单',()=>{
  const source=fixture(),layers=createLayerState(source);
  patchLayer(layers,'child',{scale:{x:.8,y:.8},opacity:.6,tint:[.8,.9,1]});
  assert.deepEqual(layerRect(layers[0]),{x:1428,y:416,width:64,height:184});
  assert.deepEqual(layerPoint(layers[0],'feet'),{x:1460,y:600});
  assert.deepEqual(layerRect(layers[1]),{x:1300,y:360,width:128,height:240});
  assert.equal(source[0].opacity,1);
  assert.deepEqual(source[0].scale,{x:1,y:1});
});

test('回退图、实时图和点击区的手机投影使用同一裁切且不压扁人物',()=>{
  const [child]=createLayerState(fixture());
  const desktop=projectLayer(child,sceneFrame(1672,941),1672,941);
  assert.deepEqual(desktop.rect,{x:1420,y:370,width:80,height:230});
  const mobile=projectLayer(child,sceneFrame(390,844),390,844);
  assert.ok(mobile.rect.x>0&&mobile.rect.x+mobile.rect.width<390);
  assert.ok(Math.abs(mobile.rect.width/mobile.rect.height-80/230)<1e-10);
});

test('单层移动和旋转后，功能锚点跟随图像，不保留旧坐标',()=>{
  const layers=createLayerState(fixture());
  patchLayer(layers,'child',{position:{x:10,y:-5},rotation:90});
  assert.deepEqual(layerPoint(layers[0],'feet'),{x:1470,y:595});
  const eye=layerPoint(layers[0],'eye');
  assert.ok(Math.abs(eye.x-1677)<1e-10);
  assert.ok(Math.abs(eye.y-563)<1e-10);
});

test('六类场景拒绝共享复合图片，非法调整不会污染现有状态',()=>{
  const source=fixture();source[1].src=source[0].src;
  assert.throws(()=>createLayerState(source),/独立/);
  const layers=createLayerState(fixture());
  assert.throws(()=>patchLayer(layers,'child',{scale:{x:0,y:1}}),/scale/);
  assert.deepEqual(layers[0].scale,{x:1,y:1});
});

test('望远镜取景围绕目标放大并保持正方形视场比例',()=>{
  const wide=lensFrame({x:.59,y:.25},1),close=lensFrame({x:.59,y:.25},4);
  assert.ok(close.cropX<wide.cropX&&close.cropY<wide.cropY);
  assert.ok(Math.abs(close.offsetX+close.cropX/2-.59)<1e-10);
  assert.ok(Math.abs(close.offsetY+close.cropY/2-.25)<1e-10);
  assert.ok(Math.abs(close.cropX*1672-close.cropY*941)<1e-10);
});

test('一层加载失败时释放已完成的独立纹理，错误指出失败图层',async()=>{
  const loaded=new Texture();let disposed=false;
  loaded.addEventListener('dispose',()=>{disposed=true;});
  const loader={loadAsync:async src=>{if(src==='/child.png')return loaded;throw new Error('missing asset');}};
  await assert.rejects(()=>loadLayerTextures(loader,createLayerState(fixture())),/telescope/);
  assert.equal(disposed,true);
});

test('最终独立人物与望远镜按测量锚点相接，两个裁片保留原始2比3比例',()=>{
  const layers=createLayerState(),registration=registrationMetrics(layers);
  assert.ok(registration.eyeGap<1e-8,'孩子眼睛应准确贴住目镜');
  for(const id of ['child','telescope']){
    const rect=layerRect(layers.find(layer=>layer.id===id));
    assert.ok(Math.abs(rect.width/rect.height-2/3)<1e-8,'不能拉伸裁片');
  }
  assert.ok(Math.abs(registration.childFeet.y-registration.cliffSurface.y)<5);
  assert.ok(Math.abs(registration.telescopeFeet.y-registration.cliffSurface.y)<5);
});

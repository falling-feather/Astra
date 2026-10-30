import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapDelta,projectWorldPoint} from '../src/observatory/panorama-model.js';
import * as THREE from 'three';
import {createSelectionEffects} from '../src/observatory/panorama-scene-selection-effects.js';
import {createPanoramaResourceScope} from '../src/observatory/panorama-scene-resources.js';
import {projectPanoramaDisc} from '../src/observatory/panorama-scene-projection.js';
import {createSelectionWeights,sampleSelectedAmbientStar,createSelectionParticles,sampleSelectionParticle,sampleSelectionFilament,sampleSelectionFlare} from '../src/observatory/panorama-scene-selection.js';

const world={width:7200,height:2600};
const catalog=['engineering','code','future','ai'].map((id,index)=>({id,position:{x:900+index*1800,y:1000},radius:330}));

test('选中用1.25秒平滑交叉淡变，快速切换从当前权重继续',()=>{
  const weights=createSelectionWeights(catalog.map(item=>item.id));
  assert.deepEqual([...weights.update('engineering',0)],[1,0,0,0]);
  assert.deepEqual([...weights.update('code',1)],[1,0,0,0]);
  const half=[...weights.update('code',1.625)];assert.ok(Math.abs(half[0]-.5)<1e-6&&Math.abs(half[1]-.5)<1e-6);
  const beforeInterrupt=[...weights.update('code',1.7)],afterInterrupt=[...weights.update('future',1.7001)];
  afterInterrupt.forEach((value,index)=>assert.ok(Math.abs(value-beforeInterrupt[index])<.001));
  const settled=[...weights.update('future',3)];assert.deepEqual(settled,[0,0,1,0]);
  assert.ok(settled.reduce((sum,value)=>sum+value,0)<=1.000001);
});

test('暂停时选中输入立即可见，重复静止时间不继续环境动画',()=>{
  const weights=createSelectionWeights(catalog.map(item=>item.id));weights.update('engineering',5);
  assert.deepEqual([...weights.update('ai',5)],[0,0,0,1]);
  assert.deepEqual(weights.snapshot(),{engineering:0,code:0,future:0,ai:1});
  const particle=createSelectionParticles(catalog,4)[0],a=sampleSelectionParticle(particle,catalog[0],5,1),b=sampleSelectionParticle(particle,catalog[0],5,1);
  assert.deepEqual(a,b);
});

test('附近原有星点真实位移，影响边界以外与取消选中后仍回到原位置',()=>{
  const nebula=catalog[0],star={x:1250,y:1070,seed:.3};
  const moved=sampleSelectedAmbientStar(star,nebula,3,1,world);
  assert.ok(Math.hypot(moved.x-star.x,moved.y-star.y)>12);
  const released=sampleSelectedAmbientStar(star,nebula,3,0,world);assert.equal(released.x,star.x);assert.equal(released.y,star.y);
  const far={x:1800,y:1000,seed:.2},untouched=sampleSelectedAmbientStar(far,nebula,3,1,world);assert.equal(untouched.x,far.x);assert.equal(untouched.y,far.y);
});

test('跨世界首尾的环境星点响应同一相机，位移不会绕远路',()=>{
  const nebula={...catalog[0],position:{x:7160,y:1000}},star={x:35,y:1030,seed:.2};
  const moved=sampleSelectedAmbientStar(star,nebula,7,1,world);
  const viewport={width:1000,height:700,scale:1},camera={x:0,y:1000};
  const a=projectWorldPoint(star,camera,viewport,world),b=projectWorldPoint(moved,camera,viewport,world);
  assert.ok(Math.abs(b.x-a.x)<100);assert.ok(Math.abs(wrapDelta(moved.x-nebula.position.x,world.width))<nebula.radius*1.62);
});

test('四类流动轨迹不同且所有选中粒子和光丝都受安全半径约束',()=>{
  const particles=createSelectionParticles(catalog,12);assert.equal(particles.length,48);
  const signatures=[];
  for(let region=0;region<4;region++){
    const nebula=catalog[region],particle=particles[region*12],a=sampleSelectionParticle(particle,nebula,1,1),b=sampleSelectionParticle(particle,nebula,4,1);
    assert.ok(Math.hypot(b.x-a.x,b.y-a.y)>5);
    signatures.push([Math.round(a.x-nebula.position.x),Math.round(a.y-nebula.position.y)].join(','));
    for(const time of [0,2,9,31])for(const weight of [0,.5,1])for(let index=0;index<12;index++){
      const point=sampleSelectionParticle(particles[region*12+index],nebula,time,weight);
      assert.ok(Math.hypot(point.x-nebula.position.x,point.y-nebula.position.y)<=nebula.radius*1.62);
    }
    for(let line=0;line<6;line++)for(let u=0;u<=1;u+=.05){const point=sampleSelectionFilament(nebula,line,u,4,1);assert.ok(Math.hypot(point.x-nebula.position.x,point.y-nebula.position.y)<=nebula.radius*1.62);}
  }
  assert.equal(new Set(signatures).size,4);
});

test('偶发星芒有淡入淡出的有限生命期，未选中时不发光',()=>{
  const nebula=catalog[0];
  assert.equal(sampleSelectionFlare(nebula,0,1,1).alpha,0);
  assert.ok(sampleSelectionFlare(nebula,0,1.6,1).alpha>.2);
  assert.equal(sampleSelectionFlare(nebula,0,2.5,1).alpha,0);
  assert.equal(sampleSelectionFlare(nebula,0,1.6,0).alpha,0);
});

test('冻结时间下强度调整立即改变特效亮度，实际粒子缓冲位置不变',()=>{
  const scope=createPanoramaResourceScope(),scene=new THREE.Scene(),viewport={width:1000,height:700,scale:1},camera={x:900,y:1000};
  const common={uViewport:{value:new THREE.Vector2(1000,700)},uTime:{value:5},uPixelRatio:{value:1},uZoomSize:{value:1}};
  const colors=catalog.map(()=>new THREE.Color('#9dc8eb')),nebulae=catalog.map(entry=>({entry,projection:projectPanoramaDisc(entry,camera,viewport,world)}));
  const effects=createSelectionEffects({scene,scope,catalog,world,common,colors}),weights=new Float64Array([1,0,0,0]);
  effects.update(5,viewport,nebulae,weights,.35,false);
  const low=effects.snapshot(),pointBuffer=scene.children.find(object=>object.isPoints).geometry.attributes.position;
  const positions=pointBuffer.array.slice();
  effects.update(5,viewport,nebulae,weights,1.6,false);
  const high=effects.snapshot();
  assert.equal(high.effectIntensity,1.6);assert.deepEqual(pointBuffer.array,positions);
  assert.ok(high.effectParticleSamples[0].alpha>low.effectParticleSamples[0].alpha);
  assert.ok(high.effectParticleSamples.every(sample=>sample.alpha<=.88));scope.dispose();
});

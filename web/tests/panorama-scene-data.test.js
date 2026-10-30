import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanoramaParticles,sampleNebulaParticle,sampleNebulaFilament,createPanoramaMeteors,samplePanoramaMeteor} from '../src/observatory/panorama-scene-data.js';

const world={width:7200,height:2600};
const catalog=Array.from({length:4},(_,index)=>({id:`galaxy-${index}`,position:{x:900+1800*index,y:1000+index*100},radius:330,color:'#9dc8eb'}));

test('桌面和手机星点预算有界，生成覆盖整圈的真实独立粒子',()=>{
  const desktop=createPanoramaParticles(catalog,world,false),mobile=createPanoramaParticles(catalog,world,true);
  const total=desktop.far.length+desktop.inside.length,small=mobile.far.length+mobile.inside.length;
  assert.ok(total>=16000&&total<=17000);assert.ok(small>=3200&&small<4000);
  assert.ok(desktop.far.some(star=>star.x<100)&&desktop.far.some(star=>star.x>7100));
  assert.ok(new Set(desktop.inside.map(star=>star.nebulaIndex)).size===4);
});

test('星云内部有非刚性运动，粒子间距会变化且保持在各自星云附近',()=>{
  const stars=createPanoramaParticles(catalog,world,false).inside.filter(star=>star.nebulaIndex===0),nebula=catalog[0];
  const a=sampleNebulaParticle(stars[0],nebula,0),b=sampleNebulaParticle(stars[1],nebula,0);
  const laterA=sampleNebulaParticle(stars[0],nebula,8),laterB=sampleNebulaParticle(stars[1],nebula,8);
  assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-Math.hypot(laterA.x-laterB.x,laterA.y-laterB.y))>1);
  for(const time of [0,5,12,37])for(const star of stars){const point=sampleNebulaParticle(star,nebula,time);assert.ok(Math.hypot(point.x-nebula.position.x,point.y-nebula.position.y)<nebula.radius*1.12);}
});

test('细丝局部变形且两端淡出，暂停重绘同一时刻得到同一形状',()=>{
  const first=sampleNebulaFilament(catalog[0],2,.43,1),later=sampleNebulaFilament(catalog[0],2,.43,8);
  assert.ok(Math.hypot(first.x-later.x,first.y-later.y)>2);
  assert.deepEqual(sampleNebulaFilament(catalog[0],2,.43,1),first);
  assert.equal(sampleNebulaFilament(catalog[0],2,0,1).alpha,0);
  assert.equal(sampleNebulaFilament(catalog[0],2,1,1).alpha,0);
});

test('各星系独立流星流保持生命期，结束后没有静止尾迹',()=>{
  const slots=createPanoramaMeteors(catalog),slot=slots[0];
  assert.ok(slots.length>=12);
  const first=samplePanoramaMeteor(slot,slot.start+.2),later=samplePanoramaMeteor(slot,slot.start+.7),dead=samplePanoramaMeteor(slot,slot.start+slot.duration+.1);
  assert.ok(first.alpha>0&&later.alpha>0);
  assert.ok(later.x<first.x&&later.y>first.y);assert.equal(dead.alpha,0);
  assert.ok(new Set(slots.map(entry=>entry.nebulaIndex)).size===4);
});

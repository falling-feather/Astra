import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservatoryClock, sceneFrame, projectPoint, meteorAt, meteorTrailPoint, METEOR_COUNT, gatherStar } from '../src/observatory/motion.js';

test('暂停和后台恢复不把墙上时间累加进海潮与星空', () => {
  const clock = createObservatoryClock(false);
  clock.step(0); clock.step(20);
  assert.equal(clock.time,0.02);
  clock.setPlaying(false);
  clock.step(8000);
  assert.equal(clock.time,0.02);
  clock.setPlaying(true);
  clock.step(9000); clock.step(9020);
  assert.equal(clock.time,0.04);
  clock.setVisible(false); clock.step(15000); clock.setVisible(true);
  clock.step(20000); clock.step(20020);
  assert.equal(clock.time,0.06);
});

test('减少动态效果默认静止，但用户仍可以明确开始播放', () => {
  const clock=createObservatoryClock(true);
  clock.step(0); clock.step(1000);
  assert.equal(clock.time,0);
  assert.equal(clock.playing,false);
  clock.setPlaying(true); clock.step(1000); clock.step(1020);
  assert.equal(clock.time,0.02);
});

test('手机裁切保留右侧孩子和望远镜，天文画面不被横向压扁', () => {
  for (const [width,height] of [[390,844],[320,568],[1672,941]]) {
    const frame=sceneFrame(width,height);
    const head=projectPoint(0.858,0.39,frame,width,height);
    const scope=projectPoint(0.80,0.37,frame,width,height);
    assert.ok(head.x>0 && head.x<width);
    assert.ok(scope.x>0 && scope.x<width);
    assert.ok(head.y>0 && head.y<height);
  }
});

test('流星头部随时间移动，尾迹生命周期结束后不可见', () => {
  const first=meteorAt(.9,0),second=meteorAt(1.4,0),finished=meteorAt(2.6,0);
  assert.ok(first.alpha>0 && second.alpha>0);
  assert.ok(second.x<first.x && second.y>first.y);
  assert.equal(finished.alpha,0);
});

test('流星约每2至4秒出现，偶尔成小群，出生和结束均透明',()=>{
  for(let from=0;from<40;from+=4){
    let seen=false;
    for(let time=from;time<from+4;time+=.1)for(let index=0;index<METEOR_COUNT;index++)if(meteorAt(time,index).alpha>.2)seen=true;
    assert.ok(seen,`${from}秒起的4秒内应看到流星`);
  }
  assert.ok(Array.from({length:METEOR_COUNT},(_,index)=>meteorAt(7,index)).filter(sample=>sample.alpha>.15).length>=2);
  assert.equal(meteorAt(.7,0).alpha,0);
  assert.equal(meteorAt(2.05,0).alpha,0);
});

test('流星尾迹实际位于运动后方，由亮且粗的头端渐隐变细',()=>{
  const meteor=meteorAt(1.2,0),head=meteorTrailPoint(meteor,0),middle=meteorTrailPoint(meteor,.45),tip=meteorTrailPoint(meteor,1);
  assert.equal(head.x,meteor.x);assert.equal(head.y,meteor.y);
  assert.ok(tip.x>head.x&&tip.y<head.y);
  assert.ok(Math.hypot((tip.x-head.x)*1672,(tip.y-head.y)*941)>70);
  assert.ok(head.halfWidth>middle.halfWidth&&middle.halfWidth>tip.halfWidth);
  assert.ok(head.alpha>middle.alpha);
  assert.equal(tip.alpha,0);
});

test('流星错峰槽具有不同速度和尾长，循环重生不会遗留长线',()=>{
  const samples=[meteorAt(1.2,0),meteorAt(4,1),meteorAt(6.6,2),meteorAt(10,3)];
  assert.ok(new Set(samples.map(sample=>sample.speed)).size>=3);
  assert.ok(new Set(samples.map(sample=>Math.round(sample.tailLength))).size>=3);
  for(let index=0;index<METEOR_COUNT;index++){
    for(const time of [0,13.9,14,27.9,28]){
      const sample=meteorAt(time,index);
      assert.ok(Number.isFinite(sample.x)&&Number.isFinite(sample.y));
      if(!sample.active)assert.equal(meteorTrailPoint(sample,.1).alpha,0);
    }
  }
});

test('星群在短时间内穿越可辨距离并在新周期从透明状态归来',()=>{
  const star={sx:.12,sy:.12,tx:.66,ty:.29,seed:.35,delay:0};
  const early=gatherStar(star,2),later=gatherStar(star,4);
  assert.ok(Math.hypot((later.x-early.x)*1672,(later.y-early.y)*941)>200);
  assert.equal(gatherStar(star,17.5).alpha,0);
  assert.ok(gatherStar(star,6.8).progress>.99);
});

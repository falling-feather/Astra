import test from 'node:test';
import assert from 'node:assert/strict';
import { CourseWheel, visibleCourses } from '../src/domain/course-wheel.ts';

function land(wheel){let result=null;for(let i=0;i<240;i++){const index=wheel.update(1/60);if(index!==null)result=index;if(wheel.position===wheel.target)break;}assert.equal(wheel.position,wheel.target);return result;}

test('整条轨道落位前不改变当前课程',()=>{
  const wheel=new CourseWheel(6);wheel.step(1);
  assert.equal(wheel.update(.08),null);assert.equal(wheel.index,0);
  assert.ok(wheel.position>0&&wheel.position<1);
  assert.equal(land(wheel),1);assert.equal(wheel.index,1);
  assert.equal(wheel.update(.1),null);
});

test('前后首尾循环，显示窗口不随课程总数增长',()=>{
  const wheel=new CourseWheel(6);
  for(let i=1;i<=6;i++){wheel.step(1);assert.equal(land(wheel),i%6);}
  wheel.step(-1);assert.equal(land(wheel),5);
  for(const position of [-201.8,-.5,0,.8,9999.6]){
    const layers=visibleCourses(position,2000);
    assert.equal(layers.length,3);
    assert.ok(layers.every(layer=>layer.index>=0&&layer.index<2000&&layer.opacity>=0&&layer.opacity<=1));
  }
});

test('停稳时两门课程，换层过程中最多三门',()=>{
  assert.equal(visibleCourses(0,6).filter(layer=>layer.labelVisible).length,2);
  assert.equal(visibleCourses(.5,6).filter(layer=>layer.labelVisible).length,3);
  assert.equal(visibleCourses(1,6).filter(layer=>layer.labelVisible).length,2);
});

test('拖拽撤销恢复原位，反向接手不会提前提交内容',()=>{
  const wheel=new CourseWheel(6);wheel.step(1);wheel.update(.1);
  wheel.beginDrag();wheel.drag(-1.2);wheel.endDrag(true);land(wheel);
  assert.equal(wheel.index,0);
  wheel.beginDrag();wheel.drag(-.8);wheel.endDrag();assert.equal(land(wheel),5);
});

test('空列表、单门、两门课程保持可预测并不重复标签',()=>{
  assert.deepEqual(visibleCourses(0,0),[]);
  const one=new CourseWheel(1);one.step(1);one.beginDrag();one.drag(2);one.endDrag();land(one);
  assert.equal(one.index,0);assert.equal(visibleCourses(0,1).length,1);
  for(const position of [0,.2,.5,.8,1]){
    const names=visibleCourses(position,2).filter(layer=>layer.labelVisible).map(layer=>layer.index);
    assert.equal(new Set(names).size,names.length);
  }
});

test('静态动效立即落位，搜索直达选择最短循环方向',()=>{
  const wheel=new CourseWheel(6);wheel.select(5);
  assert.equal(wheel.target,-1);assert.equal(wheel.update(0,true),5);
  wheel.select(2,true);assert.equal(wheel.index,2);assert.equal(wheel.position,wheel.target);
});

test('后台绘制节流后，单次换层按实际经过时间完成',()=>{
  const wheel=new CourseWheel(6);wheel.step(1);
  assert.equal(wheel.update(1),1);
  assert.equal(wheel.position,1);
});

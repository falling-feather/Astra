import test from 'node:test';
import assert from 'node:assert/strict';
import { CourseAtlasMotion, atlasLayout, atlasNodePose } from '../src/observatory/course-atlas-model.js';
import { COURSE_GALAXIES } from '../src/observatory/courses.js';

test('星图展开可随时反向收回，连续进度不跳变',()=>{
  const motion=new CourseAtlasMotion(COURSE_GALAXIES);
  motion.open('code'); assert.equal(motion.active,true);
  for(let i=0;i<6;i++)motion.step(.025);
  assert.ok(motion.progress>0&&motion.progress<1);
  const p=motion.progress;motion.close();assert.equal(motion.progress,p);
  for(let i=0;i<80;i++)motion.step(.025);
  assert.equal(motion.active,false);assert.equal(motion.progress,0);
});
test('收回途中重新打开同一星系不会闪回起点',()=>{
  const motion=new CourseAtlasMotion(COURSE_GALAXIES);
  motion.open('engineering',{animate:false});assert.equal(motion.progress,1);
  motion.close();motion.step(.1);const p=motion.progress;
  motion.open('engineering');assert.equal(motion.progress,p);
  for(let i=0;i<80;i++)motion.step(.025);
  assert.equal(motion.progress,1);assert.equal(motion.moving,false);
});
test('选课立即生效，禁止把其他星系的课程放入当前星图',()=>{
  const motion=new CourseAtlasMotion(COURSE_GALAXIES);
  motion.open('code',{animate:false});motion.select('algorithm-thinking');
  assert.equal(motion.topicId,'algorithm-thinking');
  assert.throws(()=>motion.select('energy'),RangeError);
  motion.select(null);assert.equal(motion.topicId,null);
  motion.close({animate:false});assert.equal(motion.active,false);
});
test('桌面和手机课程标签均在工作区内，不互相重叠',()=>{
  for(const [width,height] of [[1699,853],[991,898],[390,844],[320,568],[820,450]]){
   for(const count of [3,5,6]){
    const layout=atlasLayout(width,height,count);
    assert.equal(layout.nodes.length,count);
    for(const node of layout.nodes){
      assert.ok(node.box.x>=12&&node.box.x+node.box.width<=width-10);
      assert.ok(node.box.y>=90);
    }
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
      const a=layout.nodes[i].box,b=layout.nodes[j].box;
      assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
   }
  }
});
test('课程星从源星云沿不同深度的弧线到达固定文字入口',()=>{
  const source={x:420,y:210},node={x:730,y:400};
  const start=atlasNodePose(source,node,0,2),middle=atlasNodePose(source,node,.5,2),end=atlasNodePose(source,node,1,2);
  assert.equal(start.x,source.x);assert.equal(start.y,source.y);
  assert.equal(end.x,node.x);assert.equal(end.y,node.y);
  assert.ok(Math.abs(middle.y-(source.y+node.y)/2)>10);
  assert.notEqual(middle.z,start.z);
});

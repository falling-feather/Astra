import test from 'node:test';
import assert from 'node:assert/strict';
import {LAB_SPACES,findLabActivity,experimentHref,resolveExperimentRoute,filterLabActivities} from '../src/observatory/lab-catalog.js';

test('本地副本有127个唯一活动，三个空间分别为90、18、19',()=>{
  const keys=LAB_SPACES.flatMap(space=>space.topics).flatMap(topic=>topic.activities).map(item=>item.key);
  assert.equal(keys.length,127);assert.equal(new Set(keys).size,127);
  assert.deepEqual(LAB_SPACES.map(space=>space.topics.reduce((sum,topic)=>sum+topic.activities.length,0)),[90,18,19]);
});
test('实验地址沿用原身份，主页面返回到相应星系和学科',()=>{
  const activity=findLabActivity('physics.double-pendulum-chaos');
  assert.equal(activity.galaxyId,'engineering');assert.equal(activity.topicId,'physics');
  const route=resolveExperimentRoute('?activity=physics.double-pendulum-chaos','https://example.test/astra/');
  assert.equal(route.iframeUrl,'https://example.test/astra/labs/index.html#physics/double-pendulum-chaos');
  assert.equal(route.returnHref,'https://example.test/astra/observatory.html#galaxy=engineering&subject=physics');
  assert.equal(experimentHref(activity.key),'./experiment.html?activity=physics.double-pendulum-chaos');
});
test('全部127个实验都能解析到本地入口，未知活动不降级为其他实验',()=>{
  for(const space of LAB_SPACES)for(const topic of space.topics)for(const activity of topic.activities){
    const route=resolveExperimentRoute('?activity='+encodeURIComponent(activity.key),'https://example.test/');
    assert.equal(route.activity.key,activity.key);assert.ok(route.iframeUrl.startsWith('https://example.test/labs/'));
  }
  assert.equal(resolveExperimentRoute('?activity=https://evil.test/','https://example.test/'),null);
  assert.equal(resolveExperimentRoute('?activity=physics.missing','https://example.test/'),null);
});
test('实验搜索支持名称和内容，不改变源目录顺序',()=>{
  const physics=LAB_SPACES[0].topics.find(item=>item.id==='physics').activities;
  assert.equal(filterLabActivities(physics,'双摆').length,1);
  assert.equal(filterLabActivities(physics,'双摆')[0],physics.find(item=>item.key==='physics.double-pendulum-chaos'));
  assert.equal(filterLabActivities(physics,'无匹配名称').length,0);
  assert.deepEqual(filterLabActivities(physics,''),physics);
});

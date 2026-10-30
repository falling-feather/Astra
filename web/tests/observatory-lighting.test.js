import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEnvironmentLight } from '../src/observatory/environment-light.js';
const viewport={width:1000,height:650};
const region=(x,color)=>({projection:{x,y:240},lightColor:color});
const out=()=>({x:.5,strength:0,color:[0,0,0]});

test('可见星云的光色由相同选中权重混合，并保持有界亮度',()=>{
  const regions=[region(280,[.2,.6,1]),region(680,[.8,.3,.7])];
  const cold=sampleEnvironmentLight(regions,[1,0],viewport,out());
  const warm=sampleEnvironmentLight(regions,[0,1],viewport,out());
  const mixed=sampleEnvironmentLight(regions,[.5,.5],viewport,out());
  assert.ok(cold.color[2]>cold.color[0]);
  assert.ok(mixed.x>cold.x&&mixed.x<warm.x);
  assert.ok(mixed.color[0]>cold.color[0]&&mixed.color[0]<warm.color[0]);
  assert.ok(mixed.strength>0&&mixed.strength<=1);
});

test('星云移出视野时环境光逐渐退去，不留下无来源的固定色罩',()=>{
  const values=[280,1000,1300,2500].map(x=>sampleEnvironmentLight([region(x,[.2,.6,1])],[1],viewport,out()).strength);
  assert.ok(values[0]>values[1]&&values[1]>values[2]&&values[2]>values[3]);
  assert.ok(values[3]<.0001);
});

test('冻结时间重绘保持同一光场，原位环绕后光照也回到同一状态',()=>{
  const regions=[region(280,[.2,.6,1])],result=out();
  assert.equal(sampleEnvironmentLight(regions,[1],viewport,result),result);
  const before=structuredClone(result);
  sampleEnvironmentLight(regions,[1],viewport,result);
  assert.deepEqual(result,before);
  sampleEnvironmentLight(regions,[0],viewport,result);
  assert.equal(result.strength,0);
});

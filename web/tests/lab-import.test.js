import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActivityHref,buildSnapshot} from '../scripts/prepare-labs.mjs';

test('实验地址只接受本地副本，拒绝越界与外部跳转',()=>{
  assert.equal(validateActivityHref('labs/index.html#physics/mechanics'),'labs/index.html#physics/mechanics');
  for(const href of ['https://example.com/','labs/../backend/data','labs/%2e%2e/private','labs/a\\b','/labs/index.html'])assert.throws(()=>validateActivityHref(href));
});
test('复制目录沿用原活动身份，重复与未归类活动明确报错',()=>{
  const input={activities:[{key:'physics.one',title:'实验',galaxy:'englab',subject:'physics',href:'labs/index.html#physics/one'}],config:{pages:{physics:{label:'物理',desc:'原描述'}},experiments:{physics:[{id:'one',description:'实验介绍'}]}},codeCourses:[],futureCourses:[],source:{commit:'sample'}};
  const snapshot=buildSnapshot(input),item=snapshot.spaces[0].topics[0].activities[0];
  assert.equal(item.key,'physics.one');assert.equal(item.summary,'实验介绍');
  assert.throws(()=>buildSnapshot({...input,activities:[...input.activities,...input.activities]}),/重复/);
  assert.throws(()=>buildSnapshot({...input,activities:[{...input.activities[0],subject:'unknown'}]}),/未分配/);
});

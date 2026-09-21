import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingExperimentBlock } from '../src/domain/experiment-entry.ts';

const base=new URL('https://school.test/Astra/');
const here=new URL('https://school.test/Astra/labs/index.html?astra_context_key=frozen#physics/mechanics');
const block={block_id:'one',resource_version_id:127,adapter:'numeric-controls-v1',entry:'labs/index.html#physics/mechanics',controls:[{key:'gravity',selector:'#gravity-slider'}]};

test('整页运行仅匹配同源、同实验和所选内容块；重复引用不能猜归属',()=>{
  assert.equal(matchingExperimentBlock([block],here,base,'one'),block);
  assert.equal(matchingExperimentBlock([block],here,base,null),block);
  assert.equal(matchingExperimentBlock([block],new URL('https://school.test/Astra/labs/index.html#chemistry/atom'),base,'one'),undefined);
  assert.equal(matchingExperimentBlock([block],new URL('https://another.test/Astra/labs/index.html#physics/mechanics'),base,'one'),undefined);
  const repeated={...block,block_id:'two'};
  assert.equal(matchingExperimentBlock([block,repeated],here,base,null),undefined);
  assert.equal(matchingExperimentBlock([block,repeated],here,base,'two'),repeated);
  assert.equal(matchingExperimentBlock([{...block,controls:[]}],here,base,'one'),undefined);
});

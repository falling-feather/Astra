import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherParticle, curtainPoint } from '../src/motion.js';

test('gathering stars cross a visible distance and settle at their own target',()=>{
  const p={sx:.4,sy:.6,tx:.85,ty:.18,delay:0,seed:.2};
  const a=gatherParticle(p,.5),b=gatherParticle(p,10);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>.35);
  assert.ok(Math.hypot(b.x-p.tx,b.y-p.ty)<1e-6);
  assert.ok(b.alpha>.5);
});
test('aurora vertices change shape non-rigidly, including the lower edge',()=>{
  const a=curtainPoint(.25,0,0,1),b=curtainPoint(.25,0,4,1);
  const c=curtainPoint(.75,0,0,1),d=curtainPoint(.75,0,4,1);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>.035);
  assert.ok(Math.hypot((b.x-a.x)-(d.x-c.x),(b.y-a.y)-(d.y-c.y))>.02,'different curtain columns must not translate as one rigid sheet');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginFlow } from '../src/login/flow.js';

test('empty credentials stay at the form and identify the first missing field', async () => {
  let calls = 0;
  const flow = new LoginFlow({ authenticate: async () => { calls++; } });
  assert.equal(await flow.submit({ identifier: '   ', password: 'password' }), false);
  assert.equal(flow.state.field, 'identifier');
  assert.equal(await flow.submit({ identifier: '星序', password: '' }), false);
  assert.equal(flow.state.field, 'password');
  assert.equal(calls, 0);
});

test('submission keeps password bytes and prevents concurrent authentication', async () => {
  let finish;
  const values = [];
  const successful = [];
  const result = { username: '星序', mode: 'demo' };
  const flow = new LoginFlow({
    authenticate: credentials => { values.push(credentials); return new Promise(resolve => { finish = resolve; }); },
    onSuccess: session => successful.push(session),
  });
  const pending = flow.submit({ identifier: '  星序  ', password: ' p a s s ', remember: true });
  assert.equal(flow.state.status, 'loading');
  assert.equal(await flow.submit({ identifier: 'other', password: 'other' }), false);
  assert.deepEqual(values, [{ identifier: '星序', password: ' p a s s ', remember: true }]);
  finish(result);
  assert.equal(await pending, true);
  assert.deepEqual(successful, [result]);
  assert.equal(flow.state.status, 'success');
  assert.equal('password' in flow.state, false);
});

test('provider errors remain visible and a corrected submission can retry', async () => {
  let attempts = 0;
  const flow = new LoginFlow({ authenticate: async () => {
    if (++attempts === 1) throw Object.assign(new Error('账号或密码不正确'), { field: 'password' });
    return { username: '星序', mode: 'demo' };
  } });
  assert.equal(await flow.submit({ identifier: '星序', password: 'incorrect' }), false);
  assert.deepEqual(flow.state, { status: 'error', message: '账号或密码不正确', field: 'password' });
  assert.equal(await flow.submit({ identifier: '星序', password: 'correct' }), true);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseBaselines, baselineStopMode} from './release-policy.mjs';

test('V3.0.1 requires a real V3.0.0 upgrade and graceful shutdown receipt', () => {
  assert.deepEqual(releaseBaselines('3.0.1'), ['V3.0.0']);
  assert.equal(baselineStopMode('V3.0.0'), 'ipc_graceful_close');
});
test('legacy release retains both migration and crash recovery coverage', () => {
  assert.deepEqual(releaseBaselines('1.0.0'), ['V0.9.3', 'V0.9.4']);
  assert.equal(baselineStopMode('V0.9.3'), 'forced_crash_then_explicit_stale_lease_recovery');
  assert.equal(baselineStopMode('V0.9.4'), 'ipc_graceful_close');
});
test('unknown releases cannot silently skip receipt validation', () => {
  assert.throws(() => releaseBaselines('3.0.2'), /尚未定义/);
});

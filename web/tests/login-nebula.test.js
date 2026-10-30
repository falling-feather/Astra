import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNebulaDensity } from '../src/login/nebula-density.js';

const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(150);
const image = { width: 8, height: 8, data: pixels };

test('nebula volume is bounded in the glass sphere and empty corners stay transparent', () => {
  const size = 16;
  const data = buildNebulaDensity(image, size);
  assert.equal(data.length, size ** 3 * 4);
  for (const index of [0, size - 1, size ** 3 - 1]) assert.equal(data[index * 4 + 3], 0);
  const center = ((8 * size + 8) * size + 8) * 4;
  assert.ok(data[center + 3] > 0, 'the central cloud has real density');
});

test('cloud thickness varies through depth and is deterministic without a render clock', () => {
  const size = 16;
  const first = buildNebulaDensity(image, size);
  assert.deepEqual(first, buildNebulaDensity(image, size));
  const alphaAt = z => first[((z * size + 8) * size + 8) * 4 + 3];
  assert.ok(alphaAt(8) > alphaAt(2), 'the volume is not an opaque texture shell');
  assert.ok(alphaAt(8) > alphaAt(13));
});

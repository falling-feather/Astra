import test from 'node:test';
import assert from 'node:assert/strict';
import {serverTime} from '../src/domain/time.ts';

test('UTC 数据库时间、带 Z 时间与明确时区表示同一时刻',()=>{
  assert.equal(serverTime('2026-09-07T14:49:00').getTime(),serverTime('2026-09-07T14:49:00Z').getTime());
  assert.equal(serverTime('2026-09-07T14:49:00').getTime(),serverTime('2026-09-07T22:49:00+08:00').getTime());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, monthCells, moveMonth, parseDate, startOfWeek } from '../src/domain/calendar.ts';

test('闰年二月保留 29 日，按周一至周日排列', () => {
  const cells = monthCells(new Date(2024, 1, 1));
  assert.equal(cells.length, 35);
  assert.equal(cells[0].getDay(), 1);
  assert.equal(cells.at(-1).getDay(), 0);
  assert.equal(cells.filter(day => day.getMonth() === 1).length, 29);
  assert.equal(new Set(cells.map(dateKey)).size, cells.length);
});

test('跨世纪非闰年与六行月份正确展开', () => {
  assert.equal(monthCells(new Date(2100, 1, 1)).filter(day => day.getMonth() === 1).length, 28);
  assert.equal(monthCells(new Date(2026, 7, 1)).length, 42);
});

test('周日属于当前周末，跨年偏移保持完整七天', () => {
  assert.equal(dateKey(startOfWeek(new Date(2026, 8, 6))), '2026-08-31');
  assert.equal(dateKey(startOfWeek(new Date(2026, 8, 6), 1)), '2026-09-07');
  assert.equal(dateKey(startOfWeek(new Date(2027, 0, 1))), '2026-12-28');
});

test('月切换不受 31 日溢出影响，日期键按本地日期往返', () => {
  assert.equal(dateKey(moveMonth(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(dateKey(moveMonth(new Date(2026, 11, 31), 1)), '2027-01-01');
  assert.equal(dateKey(parseDate('2024-02-29')), '2024-02-29');
});

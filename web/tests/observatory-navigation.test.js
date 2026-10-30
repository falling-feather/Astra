import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutNavigation, navigationLines, transitionNavigation, initialNavigation } from '../src/observatory/navigation.js';

test('每条光带和星轨共享唯一端点，斗柄与闭合斗身不会连成普通折线', () => {
  const rows = layoutNavigation(1672, 941);
  assert.equal(rows.length, 7);
  const lines = navigationLines(rows);
  assert.deepEqual(lines.map(line => [line.from, line.to]), [[0,1],[1,2],[2,3],[3,4],[4,6],[6,5],[5,3]]);
  for (const line of lines) {
    assert.equal(line.x1, rows[line.from].x);
    assert.equal(line.y1, rows[line.from].y);
    assert.equal(line.x2, rows[line.to].x);
    assert.equal(line.y2, rows[line.to].y);
  }
  assert.deepEqual(rows.map(({x,y}) => [x,y]), [[800,135],[699,216],[632,310],[551,427],[620,524],[355,620],[510,704]]);
});

test('窄屏和矮屏保持七项可触达、文字不撞端点、行不重叠、宽度不统一', () => {
  for (const [width,height] of [[320,568],[390,844],[844,390],[1280,720],[1920,1080]]) {
    const rows = layoutNavigation(width,height);
    assert.equal(rows.length,7);
    assert.ok(new Set(rows.map(row => Math.round(row.x))).size >= 6);
    rows.forEach((row,index) => {
      assert.ok(row.x > row.labelEnd + 18, `文字末端与星点分离，${width}×${height}, row ${index}`);
      assert.ok(row.x < width - 10);
      assert.ok(row.y - row.height / 2 >= 76);
      assert.ok(row.y + row.height / 2 < height - 28);
      if (index) assert.ok(row.y - rows[index - 1].y >= row.height, '相邻点击区不重叠');
    });
  }
});

test('选择实际页面会关闭导航，Esc 不丢失当前项，未知项不改变状态', () => {
  const open = transitionNavigation(initialNavigation(), {type:'toggle'});
  assert.equal(open.open,true);
  const selected = transitionNavigation(open, {type:'select', id:'journal'});
  assert.equal(selected.open,false);
  assert.equal(selected.panel,'journal');
  assert.equal(selected.active,'journal');
  const closed = transitionNavigation(selected, {type:'escape'});
  assert.equal(closed.panel,null);
  assert.equal(closed.active,'journal');
  assert.deepEqual(transitionNavigation(closed,{type:'select',id:'unknown'}),closed);
});

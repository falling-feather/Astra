import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCatalogResults } from '../src/observatory/course-panels.js';
import { COURSE_GALAXIES } from '../src/observatory/courses.js';

test('目录列出四个星系及真实学科方向，直接使用权威课程对象', () => {
  const result = selectCatalogResults(COURSE_GALAXIES);
  assert.equal(result.length, 4);
  assert.equal(result.reduce((sum, item) => sum + item.topics.length, 0), 20);
  assert.equal(result[0].category, COURSE_GALAXIES[0]);
});

test('可以直接按实验名找到所属学科',()=>{
  const result=selectCatalogResults(COURSE_GALAXIES,'双摆');
  assert.equal(result.length,1);assert.equal(result[0].category.id,'engineering');
  assert.equal(result[0].topics[0].id,'physics');
});

test('目录搜索兼容全角英文，并可以筛选学习方向', () => {
  assert.deepEqual(selectCatalogResults(COURSE_GALAXIES, 'ａｉ').map(item => item.category.id), ['ai']);
  const found = selectCatalogResults(COURSE_GALAXIES, '代码空间 算法思维');
  assert.equal(found.length, 1);
  assert.equal(found[0].category.id, 'code');
  assert.equal(found[0].topics.length, 1);
  assert.equal(found[0].topics[0].title, '算法思维');
});

test('目录支持未知关键词的空结果与后续添加的星系', () => {
  assert.deepEqual(selectCatalogResults(COURSE_GALAXIES, '无匹配的学习名称'), []);
  const category = { id: 'new', title: '新星系', subtitle: '', topics: [] };
  const extended = [...COURSE_GALAXIES, category];
  assert.equal(selectCatalogResults(extended).at(-1).category, category);
});

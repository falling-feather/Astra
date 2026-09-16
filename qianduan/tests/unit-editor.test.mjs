import test from 'node:test';
import assert from 'node:assert/strict';
import { readUnit, toWriteUnit } from '../src/domain/course-unit-draft.ts';
import { reviewImpact } from '../src/domain/course-sync.ts';
import { submissionText } from '../src/portal/presentation.ts';

const original = {
  id: 12,
  activity_key: 'physics.mechanics',
  title: '原单元',
  position: 1,
  content: {
    schemaVersion: 'astra-content-page-v2',
    slug: 'course/example',
    galaxy: 'englab',
    subject: 'physics',
    title: '原单元',
    summary: '目标',
    layout: 'course-page',
    status: 'draft',
    version: 'draft',
    courseUnit: {
      courseId: 'course-7',
      unitId: 'physics.mechanics',
      title: '原单元',
      order: 1,
      completion: { preset: 'checkpoint_passed', checkpointKey: 'numeric-check' },
    },
    blocks: [
      {
        blockId: 'numeric',
        type: 'checkpoint',
        checkpointKey: 'numeric-check',
        title: '数值题',
        prompt: '2+2',
        mode: 'inline',
        responseType: 'numeric',
        numericAnswer: 4,
        tolerance: 0.1,
        maxAttempts: 3,
      },
      { blockId: 'illustration', type: 'media', mediaType: 'image', assetKey: 'diagram-01', alt: '示意图' },
      {
        blockId: 'sources',
        type: 'sources',
        title: '资料',
        items: [{ sourceId: 'source-1', label: '参考', url: 'https://example.org/' }],
      },
    ],
  },
};
function fields() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    unit_title: '修改标题',
    activity_key: 'physics.mechanics',
    goal: '比较变量',
    markdown: '教学说明',
    completion: 'checkpoint_passed', checkpoint_enabled: 'on', response_type: 'numeric', question: '2+2', numeric_answer: '4', tolerance: '0.1', max_attempts: '3',
  }))
    data.set(key, value);
  return data;
}

test('修改基本文本不会破坏原数值检查点、媒体和完成规则', () => {
  const before = structuredClone(original),
    result = readUnit(original, fields());
  assert.deepEqual(original, before);
  for (const block of before.content.blocks)
    for (const [key, value] of Object.entries(block))
      assert.deepEqual(result.content.blocks.find((item) => item.blockId === block.blockId)[key], value);
  assert.deepEqual(result.content.courseUnit.completion, before.content.courseUnit.completion);
  assert.equal(result.title, '修改标题');
  assert.ok(!result.content.blocks.some((block) => block.type === 'official-simulation'));
});

test('检查点和作业完成条件需要有效目标', () => {
  const empty = structuredClone(original);
  empty.content.blocks = [];
  const data = fields();
  data.delete('checkpoint_enabled');
  data.set('completion', 'checkpoint_passed');
  assert.throws(() => readUnit(empty, data), /先配置理解检查点/);
  data.set('completion', 'assignment_reviewed');
  assert.throws(() => readUnit(empty, data), /请选择/);
  data.set('assignment_id', '55');
  assert.deepEqual(readUnit(empty, data).content.courseUnit.completion, {
    preset: 'assignment_reviewed',
    assignmentId: 55,
  });
});

test('读取单元转为编辑状态时保留实例 ID，编辑副本不修改原件', () => {
  const unit = { ...structuredClone(original), id: 100, origin_key: 'origin-100', block_origins: {}, resource_version_id: null, revision: 1 };
  const result = toWriteUnit(unit);
  assert.equal(result.id, 100);
  result.content.blocks.length = 0;
  assert.ok(unit.content.blocks.length);
});

test('差异预览忽略草稿和发布标记，仍识别教学说明变化', () => {
  const before = { settings: {}, units: [{ ...structuredClone(original), origin_key: 'origin-12', block_origins: {}, resource_version_id: null }] };
  const next = structuredClone(before);
  next.units[0].content.version = 'next';
  next.units[0].content.status = 'published';
  assert.equal(reviewImpact(next, before).units[0].change, 'unchanged');
  next.units[0].content.summary = '新的教学说明';
  assert.equal(reviewImpact(next, before).units[0].change, 'modified');
  assert.equal(reviewImpact(next, before).units[0].learning_changed, false);
});

test('新回答与旧实验报告均保留可读正文', () => {
  assert.equal(submissionText({ answer: '新回答' }), '新回答');
  assert.equal(submissionText({ report: '既有报告' }), '既有报告');
  assert.match(submissionText({ observations: [1, 2] }), /observations/);
});

test('旧单元缺少正文时可人工补齐，不伪造资源引用或完成规则', () => {
  const old = { id: 9, activity_key: 'physics.mechanics', title: '旧单元', position: 1, content: null, resource_version_id: null };
  const next = toWriteUnit(old, { galaxy_key: 'englab', subject_key: 'physics' });
  assert.equal(next.id, 9);
  assert.equal(next.activity_key, old.activity_key);
  assert.equal(next.content.title, '旧单元');
  assert.equal(next.content.courseUnit.completion, null);
  assert.ok(!next.content.blocks.some((block) => ['resource', 'official-simulation'].includes(block.type)));
  assert.equal(old.content, null);
});

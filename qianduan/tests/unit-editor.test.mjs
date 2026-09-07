import test from 'node:test';
import assert from 'node:assert/strict';
import { updateUnit } from '../src/portal/unit-editor.ts';
import { restoredUnits, comparableContent, submissionText } from '../src/portal/presentation.ts';

const course = { id: 7, galaxy_key: 'englab', subject_key: 'physics' };
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
    completion: 'preserve',
  }))
    data.set(key, value);
  return data;
}

test('修改基本文本不会破坏原数值检查点、媒体和完成规则', () => {
  const before = structuredClone(original),
    result = updateUnit(course, original, fields());
  assert.deepEqual(original, before);
  for (const block of before.content.blocks)
    assert.deepEqual(
      result.content.blocks.find((item) => item.blockId === block.blockId),
      block,
    );
  assert.deepEqual(result.content.courseUnit.completion, before.content.courseUnit.completion);
  assert.equal(result.title, '修改标题');
  assert.ok(!result.content.blocks.some((block) => block.type === 'official-simulation'));
});

test('检查点和作业完成条件需要有效目标', () => {
  const empty = structuredClone(original);
  empty.content.blocks = [];
  const data = fields();
  data.set('completion', 'checkpoint_passed');
  assert.throws(() => updateUnit(course, empty, data), /先配置检查点/);
  data.set('completion', 'assignment_reviewed');
  assert.throws(() => updateUnit(course, empty, data), /请选择/);
  data.set('completion_assignment', '55');
  assert.deepEqual(updateUnit(course, empty, data).content.courseUnit.completion, {
    preset: 'assignment_reviewed',
    assignmentId: 55,
  });
});

test('恢复发布保留原单元 ID，内容复制不改变历史快照', () => {
  const release = [
    {
      source_course_unit_id: 100,
      activity_key: 'physics.mechanics',
      title: '历史标题',
      position: 1,
      content: original.content,
    },
  ];
  const result = restoredUnits(release);
  assert.equal(result[0].id, 100);
  result[0].content.blocks.length = 0;
  assert.ok(original.content.blocks.length);
  assert.equal(restoredUnits(release)[0].id, 100);
});

test('比较内容时忽略草稿/发布标记，保留真正的说明和规则变化', () => {
  const published = structuredClone(original.content),
    draft = structuredClone(original.content);
  draft.status = 'draft';
  draft.version = 'next';
  published.status = 'published';
  assert.equal(comparableContent(published), comparableContent(draft));
  draft.summary = '新的教学说明';
  assert.notEqual(comparableContent(published), comparableContent(draft));
});

test('新回答与旧实验报告均保留可读正文', () => {
  assert.equal(submissionText({ answer: '新回答' }), '新回答');
  assert.equal(submissionText({ report: '既有报告' }), '既有报告');
  assert.match(submissionText({ observations: [1, 2] }), /observations/);
});

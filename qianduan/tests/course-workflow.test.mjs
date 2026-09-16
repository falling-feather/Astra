import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSchoolDemo } from '../src/services/school-demo.ts';
import { createWorkflowDemo } from '../src/services/workflow-demo.ts';
import { createResourceDemo } from '../src/services/resource-demo.ts';
import { blankUnit, readUnit } from '../src/domain/course-unit-draft.ts';
import { loadCatalog } from '../scripts/catalog.mjs';
import { loadTemplateSeeds } from '../scripts/learning-spaces.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const activities = loadCatalog(root), templates = loadTemplateSeeds(root);
const key = () => crypto.randomUUID();
function fixture() {
  let role = 'teacher';
  const school = createSchoolDemo(() => role, activities);
  const resources = createResourceDemo(() => role, activities, templates);
  return { school, resources, api: createWorkflowDemo(() => role, school.teaching, resources), role(value) { role = value; } };
}
const settings = { school_id: 1, title: '博弈与合作', summary: '比较不同选择产生的结果。', academic_year: '2026—2027', schedule_text: '周三下午', total_hours: 8, galaxy_key: 'englab', subject_key: 'mathematics', admission_mode: 'open', level_key: null, collaborator_user_ids: [], admission_class_ids: [] };
function lesson(title, position) {
  const unit = blankUnit(settings, position); unit.title = title;
  unit.content.blocks.push({ blockId: 'check', type: 'checkpoint', checkpointKey: 'check', title: '理解检查', prompt: '比较时保持什么不变？', mode: 'inline', responseType: 'single-choice', choices: [{ choiceId: 'yes', label: '其他条件' }, { choiceId: 'no', label: '所有变量都改变' }], correctChoiceIds: ['yes'] });
  unit.content.courseUnit.completion = { preset: 'checkpoint_passed', checkpointKey: 'check' };
  return unit;
}
async function create(scope, units = [lesson('合作与选择', 1)]) {
  const course = await scope.api.create({ ...settings, client_request_id: key() });
  const draft = await scope.api.draft(course.id);
  return scope.api.save(course.id, { client_request_id: key(), expected_revision: draft.revision, expected_state_token: draft.state_token, settings: draft.settings, units });
}
const writes = (draft) => draft.units.map(({ id, activity_key, resource_version_id, title, position, content }) => ({ id, activity_key, resource_version_id, title, position, content }));
async function save(scope, draft, units = writes(draft)) {
  return scope.api.save(draft.course_id, { client_request_id: key(), expected_revision: draft.revision, expected_state_token: draft.state_token, settings: draft.settings, units });
}
async function submit(scope, draft, extra = {}) {
  const input = { source_revision: draft.revision, source_state_token: draft.state_token, ...extra };
  const preview = await scope.api.preview(draft.course_id, input);
  return scope.api.submit(draft.course_id, { ...input, client_request_id: key(), preview_token: preview.preview_token });
}
async function review(scope, items, decision = 'approved') {
  scope.role('admin');
  const result = await scope.api.review({ client_request_id: key(), decision, items: items.map((item) => ({ review_item_id: item.review_item_id, expected_version: item.review_version })) });
  scope.role('teacher'); return result.items;
}
const publication = (items, request = key()) => ({ client_request_id: request, items: items.map((item) => ({ candidate_id: item.candidate_id, expected_review_version: item.review_version })) });

test('静态演示完整经过教师送审、学校批复和冻结发布，后续草稿保留', async () => {
  const scope = fixture();
  const draft = await create(scope);
  const sent = await submit(scope, draft);
  await assert.rejects(() => scope.api.publish(publication(sent.items)), (error) => error.status === 409);
  const approved = await review(scope, sent.items);
  const changed = writes(draft); changed[0].content.blocks.find((block) => block.type === 'rich-text').markdown = '后续尚未送审的修改';
  const working = await save(scope, draft, changed);
  const command = publication(approved);
  const published = await scope.api.publish(command);
  assert.equal(published.items[0].release.units[0].content.blocks.find((block) => block.type === 'rich-text').markdown, '记录预测、改变的条件和观察到的结果。');
  assert.equal((await scope.api.draft(draft.course_id)).state_token, working.state_token);
  assert.deepEqual(await scope.api.publish(command), published);
  assert.deepEqual((await scope.api.receipt(command.client_request_id)).response, published);
  scope.role('student');
  await assert.rejects(() => scope.api.draft(draft.course_id), (error) => error.status === 403);
});

test('同源同步按来源匹配，缺失跳过、冲突保留，混合审核不能部分发布', async () => {
  const scope = fixture();
  let source = await create(scope, [lesson('复数', 1), lesson('三角', 2)]);
  const base = source.revision_id;
  const forked = await scope.api.fork(source.course_id, { client_request_id: key(), settings: { ...source.settings, title: '高二数学' }, expected_source_revision: source.revision });
  assert.equal(forked.course.family_id, source.family_id);
  assert.equal(forked.draft.units[0].origin_key, source.units[0].origin_key);
  assert.notEqual(forked.draft.units[0].id, source.units[0].id);
  const targetUnits = writes(forked.draft).slice(0, 1);
  targetUnits[0].content.blocks.find((block) => block.type === 'rich-text').markdown = '目标教师另行补充';
  const target = await save(scope, forked.draft, targetUnits);
  const changed = writes(source);
  changed.forEach((unit) => { unit.content.blocks.find((block) => block.type === 'rich-text').markdown = '共同修正公式'; });
  source = await save(scope, source, changed);
  const input = { source_revision: source.revision, source_state_token: source.state_token, base_revision_id: base, target_course_ids: [target.course_id] };
  const preview = await scope.api.preview(source.course_id, input);
  const changes = preview.courses.find((item) => item.course_id === target.course_id).changes;
  assert.ok(changes.some((item) => item.status === 'skipped'));
  const conflict = changes.find((item) => item.status === 'conflict'); assert.ok(conflict);
  const submitted = await submit(scope, source, { ...input, conflict_choices: { [conflict.key]: 'replace' } });
  const approved = await review(scope, [submitted.items[0]]);
  const rejected = await review(scope, [submitted.items[1]], 'rejected');
  await assert.rejects(() => scope.api.publish(publication([...approved, ...rejected])), (error) => error.status === 409);
  assert.equal((await scope.school.releases(source.course_id)).length, 0);
  await scope.api.publish(publication(approved));
  assert.equal((await scope.api.draft(target.course_id)).units.length, 1);
});

test('演示回滚重建新修订，可恢复当前草稿已移除的历史单元', async () => {
  const scope = fixture();
  let draft = await create(scope);
  const first = (await scope.api.publish(publication(await review(scope, (await submit(scope, draft)).items)))).items[0].release;
  draft = await scope.api.draft(draft.course_id);
  draft = await save(scope, draft, [lesson('新的专题', 1)]);
  await scope.api.publish(publication(await review(scope, (await submit(scope, draft)).items)));
  draft = await scope.api.draft(draft.course_id);
  const restored = await scope.api.restore(draft.course_id, { client_request_id: key(), expected_revision: draft.revision, expected_state_token: draft.state_token, release_id: first.id });
  assert.equal(restored.units[0].id, first.units[0].source_course_unit_id);
  assert.ok(restored.revision > draft.revision);
});

test('课程编辑保留已有检查点身份及无关内容块，不改变资源原件', async () => {
  const original = lesson('条件与结果', 1);
  original.content.blocks.push({ blockId: 'sources', type: 'sources', title: '参考资料', items: [{ sourceId: 'book', label: '教材', url: 'https://example.com/book' }] });
  const data = new FormData();
  for (const [key, value] of Object.entries({ unit_title: '条件与结果', goal: '解释比较过程', markdown: '补充新的教学说明', checkpoint_enabled: 'on', question: '比较时保持什么不变？', response_type: 'single-choice', choices: '其他条件\n所有变量都改变', correct_choices: '1', completion: 'checkpoint_passed', max_attempts: '', numeric_answer: '', tolerance: '0', accepted_answers: '' })) data.set(key, value);
  const updated = readUnit(original, data);
  const oldCheck = original.content.blocks.find((block) => block.type === 'checkpoint'), newCheck = updated.content.blocks.find((block) => block.type === 'checkpoint');
  assert.equal(newCheck.blockId, oldCheck.blockId);
  assert.deepEqual(newCheck.correctChoiceIds, ['yes']);
  assert.deepEqual(newCheck.choices, oldCheck.choices);
  assert.deepEqual(updated.content.blocks.find((block) => block.type === 'sources'), original.content.blocks.find((block) => block.type === 'sources'));
  assert.notEqual(updated.content.blocks.find((block) => block.type === 'rich-text').markdown, original.content.blocks.find((block) => block.type === 'rich-text').markdown);
});

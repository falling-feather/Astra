import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../scripts/catalog.mjs';
import { createSchoolDemo } from '../src/services/school-demo.ts';
import { createStudyDemo } from '../src/services/study-demo.ts';
import { createResourceDemo } from '../src/services/resource-demo.ts';
import { HttpClient, ApiError } from '../src/services/http-client.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const activities = loadCatalog(root);

test('目录来自三个现有空间，包含 127 个唯一活动和实际标题', () => {
  assert.equal(activities.length, 127);
  assert.equal(new Set(activities.map((item) => item.key)).size, 127);
  assert.deepEqual(
    ['englab', 'code-space', 'future-galaxy'].map(
      (key) => activities.filter((item) => item.galaxy === key).length,
    ),
    [90, 18, 19],
  );
  assert.ok(activities.every((item) => item.title !== item.key && item.href.startsWith('labs/')));
});

test('作业退回重交保留两个回答，改分只增加差额，界面列表仍指向当前稿', async () => {
  let role = 'student';
  const api = createSchoolDemo(() => role, activities);
  const study = createStudyDemo(() => role, api.teaching, api, createResourceDemo(() => role, activities, []));
  const open = () => study.openAssignment(1, { client_request_id: crypto.randomUUID(), class_id: 1 });
  const submit = (opened, answer) => study.submit(1, { client_request_id: crypto.randomUUID(), context_key: opened.context.context_key, expected_submission_revision: opened.submission_revision, content: { answer } });
  const first = await submit(await open(), '先预测，再对照实验。');
  assert.equal((await api.studentAssignments('active')).items[0].can_submit, false);
  await assert.rejects(submit(await open(), '重复请求'), (error) => error.status === 409);
  const command = { client_request_id: crypto.randomUUID(), expected_submission_revision: 1, expected_grade_revision: 0, status: 'returned', score: null, feedback: '请补充解释' };
  await assert.rejects(study.grade(first.id, command), (error) => error.status === 403);
  role = 'teacher';
  await study.grade(first.id, command);
  role = 'student';
  const returned = (await api.studentAssignments('feedback')).items[0];
  assert.equal(returned.can_submit, true);
  assert.equal(returned.submission.feedback, '请补充解释');
  const second = await submit(await open(), '补充解释：其余变量保持不变。');
  assert.equal(second.submission_id, first.submission_id);
  role = 'teacher';
  const state = await study.submissionHistory(first.submission_id);
  const grade = { client_request_id: crypto.randomUUID(), expected_submission_revision: state.revision, expected_grade_revision: 0, status: 'graded', score: 92, feedback: '解释清楚' };
  const saved = await study.grade(second.id, grade);
  assert.equal(saved.point_delta, 92);
  assert.deepEqual(await study.grade(second.id, grade), saved);
  const next = await study.submissionHistory(first.submission_id);
  await assert.rejects(study.grade(second.id, { ...grade, client_request_id: crypto.randomUUID(), score: 93 }), (error) => error.status === 409);
  const revised = await study.grade(second.id, { ...grade, client_request_id: crypto.randomUUID(), expected_submission_revision: next.revision, expected_grade_revision: 1, score: 95 });
  assert.equal(revised.point_delta, 3);
  role = 'student';
  const history = await study.submissionHistory(first.submission_id);
  assert.deepEqual(history.attempts.map((row) => row.content.answer), ['补充解释：其余变量保持不变。', '先预测，再对照实验。']);
  assert.equal(history.grades.length, 3);
  const graded = (await api.studentAssignments('feedback')).items[0];
  assert.equal(graded.submission.score, 95);
  assert.equal(graded.can_submit, false);
});

test('学习开始固定版本，补做阻断旧题完成，自主探索不能提交课程答案', async () => {
  let role = 'student';
  const school = createSchoolDemo(() => role, activities);
  const resources = createResourceDemo(() => role, activities, []);
  const study = createStudyDemo(() => role, school.teaching, school, resources);
  const release = (await school.currentRelease(1)).release;
  const unit = release.units[0];
  const context = await study.start({ client_request_id: crypto.randomUUID(), mode: 'formal', course_id: 1, course_unit_id: unit.source_course_unit_id, expected_release_id: release.id });
  assert.ok(context.content.blocks.every((block) => !block.correctChoiceIds));
  role = 'teacher';
  const draft = await school.draft(1);
  draft.units[0].title = '新版题目';
  const saved = await school.saveDraft(1, draft);
  const newer = (await school.publish(1, saved.revision, '补做')).release;
  school.teaching.resultPolicies.set(newer.id, { [unit.source_course_unit_id]: 'redo' });
  role = 'student';
  const result = await study.checkpoint(context.context_key, 'first-check', { client_attempt_id: crypto.randomUUID(), selected_choice_ids: ['a'] });
  assert.equal(result.completed, true);
  assert.equal(result.current_version_completed, false);
  assert.equal((await study.context(context.context_key)).unit_title, unit.title);
  assert.equal((await study.history(1)).items[0].source_release_id, release.id);
  const catalogue = await resources.list();
  const explore = await study.start({ client_request_id: crypto.randomUUID(), mode: 'explore', resource_version_id: catalogue.items[0].id });
  assert.equal(explore.records_course_results, false);
  await assert.rejects(study.checkpoint(explore.context_key, 'first-check', { client_attempt_id: crypto.randomUUID(), selected_choice_ids: ['a'] }), (error) => error.status === 403);
});

test('演示发布保留旧快照，过期草稿不能覆盖最新修改', async () => {
  let role = 'teacher';
  const api = createSchoolDemo(() => role, activities);
  const old = await api.releases(1),
    draft = await api.draft(1),
    stale = structuredClone(draft);
  draft.units[0].title = '修订后的单元';
  const saved = await api.saveDraft(1, draft);
  await assert.rejects(api.saveDraft(1, stale), (error) => error.status === 409);
  await api.publish(1, saved.revision, '修订');
  const all = await api.releases(1);
  assert.deepEqual(all[0], old[0]);
  assert.equal(all[1].units[0].title, '修订后的单元');
  role = 'student';
  const publicRelease = await api.currentRelease(1);
  assert.ok(publicRelease.release.units[0].content.blocks.every((block) => !block.correctChoiceIds));
});

test('演示课程资料未通过审核时不进入学生课程目录', async () => {
  let role = 'teacher';
  const api = createSchoolDemo(() => role, activities),
    reference = await api.course(1);
  const newCourse = await api.createCourse({
    ...reference.information_revision.information_snapshot,
    school_id: 1,
    collaborator_user_ids: [],
    title: '尚未开放的课程',
  });
  role = 'student';
  assert.ok(!(await api.workbench()).courses.items.some((course) => course.course_id === newCourse.id));
  assert.equal((await api.discover('ASTRA001')).can_request, false);
});

test('演示开放计划确实控制学生快照正文', async () => {
  let role = 'teacher';
  const api = createSchoolDemo(() => role, activities);
  const plan = await api.releasePlan(1, 1);
  plan.items[0].release_mode = 'locked';
  await api.saveReleasePlan(plan);
  role = 'student';
  const locked = (await api.currentRelease(1)).release.units[0];
  assert.equal(locked.access_state, 'locked');
  assert.deepEqual(locked.content.blocks, []);
});

test('请求仅使用 Cookie，不自动重试失败写入，也不退回演示数据', async () => {
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ detail: 'conflict' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'test-request' },
      });
    };
    await assert.rejects(
      new HttpClient('/api').request('/users/me', 'PATCH', { display_name: '测试' }),
      (error) => error instanceof ApiError && error.status === 409 && error.requestId === 'test-request',
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.credentials, 'include');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    globalThis.fetch = async () => {
      throw new TypeError('offline');
    };
    await assert.rejects(
      new HttpClient().request('/assignments/1/submissions', 'POST', {}),
      /操作可能已生效/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

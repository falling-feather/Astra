import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../scripts/catalog.mjs';
import { createSchoolDemo } from '../src/services/school-demo.ts';
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

test('演示作业提交、批改、退回和重交由同一状态源驱动', async () => {
  let role = 'student';
  const api = createSchoolDemo(() => role, activities);
  const first = await api.submitAssignment(1, 1, '先预测，再对照实验。');
  assert.equal((await api.studentAssignments('active')).items[0].can_submit, false);
  await assert.rejects(api.submitAssignment(1, 1, '重复请求'), (error) => error.status === 409);
  await assert.rejects(api.grade(first.id, 80, '反馈', 'graded'), (error) => error.status === 403);
  role = 'teacher';
  await api.grade(first.id, 75, '请补充解释', 'returned');
  role = 'student';
  const returned = (await api.studentAssignments('feedback')).items[0];
  assert.equal(returned.can_submit, true);
  assert.equal(returned.submission.feedback, '请补充解释');
  const second = await api.submitAssignment(1, 1, '补充解释：其余变量保持不变。');
  role = 'teacher';
  await api.grade(second.id, 92, '解释清楚', 'graded');
  role = 'student';
  const graded = (await api.studentAssignments('feedback')).items[0];
  assert.equal(graded.submission.score, 92);
  assert.equal(graded.can_submit, false);
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

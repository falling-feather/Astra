const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('pages/admin/admin-course-governance.js');
const styles = read('pages/admin/admin.css');

assert.match(source, /\/api\/v1\/admin\/course-information-revisions/);
assert.match(source, /method:\s*'PATCH'/);
assert.match(source, /当前信息与拟修改信息对照/);
assert.match(source, /共同教师/);
assert.match(source, /准入行政班/);
assert.match(source, /再次确认批准/);
assert.match(source, /再次确认驳回/);
assert.match(source, /暂无已发布内容/);
assert.match(source, /不会提前生成空内容版本/);
assert.doesNotMatch(source, /course-information-revisions[^\n]+\/(?:draft|releases)/);
assert.match(styles, /\.admin-course-review-diff/);
assert.match(styles, /\.admin-course-review-actions/);
assert.match(styles, /@media \(max-width: 820px\)/);
assert.match(styles, /@media \(max-width: 520px\)/);

class TestElement {
  constructor() {
    this.innerHTML = '';
    this.listeners = Object.create(null);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  removeEventListener(type) {
    delete this.listeners[type];
  }

  querySelector() {
    return null;
  }
}

const runtimeWindow = {
  AbortController,
  AstraApiClient: {
    request: async () => { throw new Error('unexpected request'); },
    isCancelled: (error) => error && error.name === 'AbortError',
    isAmbiguousMutation: () => false,
    message: (error) => String(error && error.message || error),
  },
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (callback) => setImmediate(callback),
  cancelAnimationFrame: (id) => clearImmediate(id),
};
const context = { window: runtimeWindow, Element: TestElement, AbortController };
vm.runInNewContext(source, context, { filename: 'pages/admin/admin-course-governance.js' });

const owner = runtimeWindow.AdminCourseGovernance;
const contract = owner.contract;
assert.ok(contract, 'course owner must expose FE-039 contract helpers');

const review = {
  revision: {
    id: 41,
    course_id: 12,
    revision_number: 2,
    status: 'submitted',
    submitted_at: '2026-08-25T08:00:00Z',
  },
  course_id: 12,
  school_id: 3,
  course_status: 'published',
  course_code: 'ABCD2345',
  current_information_revision_id: 40,
  proposed_information: {
    title: '机械原理进阶',
    summary: '用实验理解机械结构。',
    academic_year: '2026-2027',
    schedule_text: '周三第 5-6 节',
    total_hours: 32,
    galaxy_key: 'engineering',
    subject_key: 'physics',
    admission_mode: 'class_restricted',
    admission_class_ids: [8],
  },
  current_information: {
    title: '机械原理',
    summary: '基础课程。',
    academic_year: '2026-2027',
    schedule_text: '周三第 5-6 节',
    total_hours: 24,
    galaxy_key: 'engineering',
    subject_key: 'physics',
    admission_mode: 'open',
    admission_class_ids: [],
  },
  changed_fields: ['admission_class_ids', 'admission_mode', 'summary', 'teacher_ids', 'title', 'total_hours'],
  proposed_teachers: [
    { user_id: 7, username: 'lin', display_name: '林老师', role: 'teacher', is_creator: true },
    { user_id: 9, username: 'zhou', display_name: '周老师', role: 'teacher', is_creator: false },
  ],
  current_teachers: [
    { user_id: 7, username: 'lin', display_name: '林老师', role: 'teacher', is_creator: true },
  ],
  proposed_admission_classes: [{ class_id: 8, name: '高二（3）班', status: 'active' }],
  current_admission_classes: [],
  internal_class_id: 18,
  internal_course_class_id: 22,
  has_published_content: false,
  content_status: 'not_published',
  content_status_label: '暂无已发布内容',
};

assert.equal(contract.reviewRecordMatches(review), true);
assert.equal(contract.reviewRecordMatches({}), false);
assert.equal(contract.reviewPageMatches({ items: [review], total: 1 }), true);
assert.equal(contract.reviewPageMatches({ items: [review], total: 0 }), false);
assert.equal(contract.reviewPageMatches({ items: [], total: null }), false);
assert.equal(contract.normalizeReviewNote('  信息正确  '), '信息正确');
assert.equal(contract.normalizeReviewNote('  '), null);
assert.throws(() => contract.normalizeReviewNote('x'.repeat(501)), /500/);

const approval = contract.buildReviewMutation(review, 'approved', '  资料完整  ');
assert.deepEqual(JSON.parse(JSON.stringify(approval)), { status: 'approved', note: '资料完整' });
assert.throws(() => contract.buildReviewMutation(review, 'pending', ''), /无效/);
assert.throws(() => contract.buildReviewMutation({ ...review, revision: { ...review.revision, status: 'approved' } }, 'approved', ''), /待审核/);

const firstConfirmation = contract.reviewConfirmationDecision(null, review, approval);
assert.equal(firstConfirmation.send, false);
assert.equal(firstConfirmation.pending.revisionId, 41);
assert.equal(contract.reviewConfirmationDecision(firstConfirmation.pending, review, approval).send, true);
assert.equal(
  contract.reviewConfirmationDecision(firstConfirmation.pending, review, { status: 'approved', note: '已修改' }).send,
  false,
  'editing the note must invalidate the prior confirmation',
);

const approvedResponse = {
  ...review,
  revision: { ...review.revision, status: 'approved' },
  current_information_revision_id: 41,
  course_code: 'EFGH6789',
  internal_class_id: 18,
  internal_course_class_id: 22,
};
assert.equal(contract.reviewResponseMatches(approvedResponse, review, 'approved'), true);
assert.equal(contract.reviewResponseMatches({ ...approvedResponse, course_code: null }, review, 'approved'), false);
assert.equal(contract.reviewResponseMatches({
  ...review,
  revision: { ...review.revision, status: 'rejected' },
}, review, 'rejected'), true);

async function run() {
  let executeCount = 0;
  let latestSnapshot = null;
  const executor = contract.createConfirmedReviewExecutor(
    async () => { executeCount += 1; return true; },
    (snapshot) => { latestSnapshot = snapshot; },
    () => true,
  );
  assert.equal((await executor.submit(review, approval)).kind, 'confirmation');
  assert.equal(executeCount, 0);
  assert.equal(latestSnapshot.pending.revisionId, 41);
  assert.equal((await executor.submit(review, approval)).kind, 'sent');
  assert.equal(executeCount, 1);
  assert.equal(latestSnapshot.busy, false);

  const host = new TestElement();
  const calls = [];
  runtimeWindow.AstraApiClient.request = async (pathname, options = {}) => {
    calls.push({ pathname, options });
    if (pathname === '/api/courses') return [];
    if (pathname === '/api/v1/admin/course-information-revisions') {
      return { items: [review], total: 1, limit: 200, offset: 0, next_offset: null };
    }
    throw new Error(`unexpected request: ${pathname}`);
  };
  assert.equal(owner.mount(host, { refreshIcons: () => {}, getApiBase: () => 'https://api.example' }), true);
  assert.equal(await owner.activate(), true);
  assert.deepEqual(calls.map((call) => call.pathname), [
    '/api/courses',
    '/api/v1/admin/course-information-revisions',
  ]);
  assert.equal(calls[1].options.params.status, 'submitted');
  assert.match(host.innerHTML, /机械原理进阶/);
  assert.match(host.innerHTML, /机械原理/);
  assert.match(host.innerHTML, /林老师/);
  assert.match(host.innerHTML, /周老师/);
  assert.match(host.innerHTML, /高二（3）班/);
  assert.match(host.innerHTML, /运行中课程修改/);
  assert.match(host.innerHTML, /课程内容审核/);
  assert.equal(owner.snapshot().reviewTotal, 1);
  assert.equal(owner.snapshot().reviewSelectedId, 41);
  owner.destroy();
  console.log('course-information-review-fe039-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

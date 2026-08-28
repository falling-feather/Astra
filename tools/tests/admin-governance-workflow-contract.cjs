const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('pages/admin/admin.js');
const course = read('pages/admin/admin-course-governance.js');
const secondary = read('pages/admin/admin-secondary-governance.js');
const styles = read('pages/admin/admin.css');
const roleHome = read('shared/js/role-home-client.js');
const sharedAuthStyles = read('shared/css/auth-ui.css');
const sharedAuthRuntime = read('shared/js/auth-ui.js');
const canonicalizeLf = (source) => source.replace(/\r\n?/g, '\n');
const canonicalSha256 = (source) => crypto
  .createHash('sha256')
  .update(canonicalizeLf(source))
  .digest('hex');

async function main() {
const roleHomeContext = { window: {} };
vm.runInNewContext(roleHome, roleHomeContext, { filename: 'shared/js/role-home-client.js' });
const roleHomeContract = roleHomeContext.window.AstraRoleHomeClient.contract;
const adminHomeCalls = [];
const pendingPage = (items, total = items.length) => ({
  items, total, limit: 1, offset: 0, next_offset: total > items.length ? items.length : null,
});
const auditPage = (items, total = items.length, offset = 0) => ({
  items, total, limit: 25, offset, next_offset: offset + items.length < total ? offset + items.length : null,
});
const technicalAudit = (id) => ({
  id,
  action: 'admin.audit.report',
  resource: `audit_log:${id}`,
  resource_type: 'audit_log',
  resource_id: String(id),
  request_id: null,
});
const homeCourse = (id, status, title) => ({
  id,
  school_id: 3,
  creator_user_id: 2,
  galaxy_key: 'englab',
  course_key: `course-${id}`,
  title,
  status,
});
const pendingHomeTask = await roleHomeContract.resolveAdminTask(async (pathname, options) => {
  adminHomeCalls.push({ pathname, options });
  return pendingPage([{
      id: 31,
      school_id: 3,
      class_id: 12,
      user_id: 44,
      requested_by_user_id: 44,
      class_name: '权威一班',
      role: 'student',
      status: 'pending',
  }]);
});
assert.equal(pendingHomeTask.title, '处理 权威一班 的加入申请');
assert.equal(pendingHomeTask.href, '#admin');
assert.deepEqual(adminHomeCalls.map((call) => call.pathname), ['/api/admin/class-join-requests']);

adminHomeCalls.length = 0;
const courseHomeTask = await roleHomeContract.resolveAdminTask(async (pathname, options) => {
  adminHomeCalls.push({ pathname, options });
  if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
  if (pathname === '/api/courses') {
    return [
      homeCourse(8, 'published', '已发布课'),
      homeCourse(7, 'archived', '归档课'),
      homeCourse(9, 'draft', '真实草稿课'),
    ];
  }
  throw new Error(`unexpected admin home request: ${pathname}`);
});
assert.equal(courseHomeTask.title, '真实草稿课');
assert.equal(courseHomeTask.code, '课程待完善');
assert.equal(courseHomeTask.href, '#admin');
assert.deepEqual(
  adminHomeCalls.map((call) => call.pathname),
  ['/api/admin/class-join-requests', '/api/courses'],
  'admin home must stop at the first real priority task',
);

adminHomeCalls.length = 0;
const auditHomeTask = await roleHomeContract.resolveAdminTask(async (pathname, options) => {
  adminHomeCalls.push({ pathname, options });
  if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
  if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
  return auditPage([
      technicalAudit(4),
      {
        id: 31,
        action: 'class.join.request.approve',
        resource: 'class_join_request:31',
        resource_type: 'class_join_request',
        resource_id: '31',
        request_id: 'recent-business-audit',
      },
  ]);
});
assert.equal(auditHomeTask.title, '检查最近一次治理变更');
assert.equal(auditHomeTask.meta, '可在管理员工作台查看变更对象、结果与时间。');
assert.equal(auditHomeTask.href, '#admin');
assert.deepEqual(
  adminHomeCalls.map((call) => call.pathname),
  ['/api/admin/class-join-requests', '/api/courses', '/api/admin/audit-logs'],
);
for (const item of [
  { action: 'admin.content_script_asset.inventory', resource_type: 'content_script_asset' },
  { action: 'admin.alert_outbox.list', resource_type: 'admin_alert_outbox' },
  { action: 'admin.background_task.execute', resource_type: 'background_task' },
  { action: 'admin.audit.report', resource_type: 'audit_log' },
  { action: 'class.join.request.approve', resource_type: 'background_task' },
]) {
  assert.equal(roleHomeContract.isBusinessAudit(item), false, `${item.action} must not become a home business task`);
}
assert.equal(roleHomeContract.isBusinessAudit({
  action: 'course.status.patch',
  resource_type: 'course',
}), true);
const honestEmptyTask = await roleHomeContract.resolveAdminTask(async (pathname) => {
  if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
  if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
  return auditPage([
    { id: 41, action: 'admin.content_script_asset.inventory', resource: 'content_script_asset:41', resource_type: 'content_script_asset', resource_id: '41', request_id: null },
    { id: 42, action: 'admin.alert_outbox.list', resource: 'admin_alert_outbox:42', resource_type: 'admin_alert_outbox', resource_id: '42', request_id: null },
    { id: 43, action: 'admin.background_task.execute', resource: 'background_task:43', resource_type: 'background_task', resource_id: '43', request_id: null },
  ]);
});
assert.equal(honestEmptyTask, null, 'operations-only audit history must produce an honest empty state');

const lateBusinessCalls = [];
const lateBusinessTask = await roleHomeContract.resolveAdminTask(async (pathname, options = {}) => {
  lateBusinessCalls.push({ pathname, params: options.params || null });
  if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
  if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
  if (options.params.offset === 0) return auditPage(
    Array.from({ length: 25 }, (_, index) => technicalAudit(100 + index)),
    26,
    0,
  );
  return auditPage([{
    id: 126,
    action: 'course.status.patch',
    resource: 'course:9',
    resource_type: 'course',
    resource_id: '9',
    request_id: 'business-at-26',
  }], 26, 25);
});
assert.equal(lateBusinessTask.meta, '可在管理员工作台查看变更对象、结果与时间。');
assert.deepEqual(
  lateBusinessCalls.filter((call) => call.pathname === '/api/admin/audit-logs').map((call) => call.params.offset),
  [0, 25],
  'admin home must continue bounded audit paging when page one is technical-only',
);

for (const malformedJoinPage of [
  { items: [], total: 1, limit: 1, offset: 0 },
  { items: [{}], total: 1, limit: 1, offset: 0 },
]) {
  let malformedCalls = 0;
  await assert.rejects(
    roleHomeContract.resolveAdminTask(async () => {
      malformedCalls += 1;
      return malformedJoinPage;
    }),
    (error) => error.code === 'admin_home_authority_invalid',
  );
  assert.equal(malformedCalls, 1, 'malformed pending authority must not fall through to another task');
}
await assert.rejects(
  roleHomeContract.resolveAdminTask(async (pathname) => (
    pathname === '/api/admin/class-join-requests' ? pendingPage([]) : [{ id: 8, school_id: 3, status: 'published' }]
  )),
  (error) => error.code === 'admin_home_authority_invalid',
);
await assert.rejects(
  roleHomeContract.resolveAdminTask(async (pathname) => {
    if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
    if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
    return auditPage([{}]);
  }),
  (error) => error.code === 'admin_home_authority_invalid',
);
let auditGenerationCurrent = true;
let staleAuditCalls = 0;
await assert.rejects(
  roleHomeContract.readRecentBusinessAudits(async () => {
    staleAuditCalls += 1;
    auditGenerationCurrent = false;
    return auditPage(Array.from({ length: 25 }, (_, index) => technicalAudit(200 + index)), 26, 0);
  }, null, () => auditGenerationCurrent),
  (error) => error.name === 'AbortError',
);
assert.equal(staleAuditCalls, 1, 'stale admin-home audit generation must not fetch another page');
for (const call of adminHomeCalls) {
  assert.doesNotMatch(call.pathname, /health|script|snapshot|outbox|bug/i);
}
const loadAdminBody = roleHome.match(/async function loadAdmin\(scope\) \{([\s\S]*?)\n    function changeMatchesSelectedScope/);
assert.ok(loadAdminBody);
assert.doesNotMatch(loadAdminBody[1], /health|script|snapshot|outbox|bug/i);

class RoleHomeElement {
  constructor() {
    this.dataset = {};
    this.innerHTML = '';
    this.isConnected = true;
    this.listeners = Object.create(null);
  }

  setAttribute() {}

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  removeEventListener(type) {
    delete this.listeners[type];
  }

  remove() {
    this.isConnected = false;
  }
}
class RoleHomeRoot extends RoleHomeElement {
  constructor() {
    super();
    this.host = null;
    this.main = { prepend: (host) => { this.host = host; } };
  }

  querySelector(selector) {
    if (selector === '.planets-intro') return null;
    if (selector === '.planets-main') return this.main;
    return null;
  }
}
async function malformedAdminHome(resolvePayload) {
  const calls = [];
  const runtimeWindow = {
    AstraApiClient: {
      request: async (pathname, options = {}) => {
        calls.push({ pathname, options });
        return resolvePayload(pathname, options);
      },
    },
    AstraLearningEvidenceClient: {
      subscribe: () => () => {},
      normalizeError: (error) => error,
    },
  };
  const runtimeContext = {
    window: runtimeWindow,
    Element: RoleHomeElement,
    document: { createElement: () => new RoleHomeElement(), getElementById: () => null },
    AbortController,
  };
  vm.runInNewContext(roleHome, runtimeContext, { filename: 'shared/js/role-home-client.js' });
  const rootElement = new RoleHomeRoot();
  const client = runtimeWindow.AstraRoleHomeClient;
  assert.equal(client.mount(rootElement, { id: 1, role: 'admin' }), true);
  await client.load();
  const result = {
    phase: client.snapshot().phase,
    issue: client.snapshot().issue,
    task: client.snapshot().task,
    markup: rootElement.host.innerHTML,
    calls,
  };
  client.destroy();
  return result;
}
const invalidAdminHomeScenarios = [
  {
    name: 'string join id',
    forbidden: '#31',
    resolve: (pathname) => {
      assert.equal(pathname, '/api/admin/class-join-requests');
      return pendingPage([{
        id: '31',
        school_id: 3,
        class_id: 12,
        user_id: 44,
        requested_by_user_id: 44,
        class_name: '严格 DTO 班',
        role: 'student',
        status: 'pending',
      }]);
    },
  },
  {
    name: 'string course id',
    forbidden: '#8',
    resolve: (pathname) => pathname === '/api/admin/class-join-requests'
      ? pendingPage([])
      : [{ ...homeCourse(8, 'draft', '严格 DTO 课'), id: '8' }],
  },
  {
    name: 'string audit id',
    forbidden: '#41',
    resolve: (pathname) => {
      if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
      if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
      return auditPage([{
        id: '41',
        action: 'class.join',
        resource: 'class_membership:41',
        resource_type: 'class_membership',
        resource_id: 41,
        request_id: 'audit-string-id',
      }]);
    },
  },
  ...['resource_id', 'request_id'].map((field) => ({
    name: `object audit ${field}`,
    forbidden: '[object Object]',
    resolve: (pathname) => {
      if (pathname === '/api/admin/class-join-requests') return pendingPage([]);
      if (pathname === '/api/courses') return [homeCourse(8, 'published', '已发布课')];
      return auditPage([{
        id: 41,
        action: 'class.join',
        resource: 'class_membership:41',
        resource_type: 'class_membership',
        resource_id: '41',
        request_id: 'audit-object-scalar',
        [field]: { unsafe: true },
      }]);
    },
  })),
];
for (const scenario of invalidAdminHomeScenarios) {
  const result = await malformedAdminHome(scenario.resolve);
  assert.equal(result.phase, 'error', `${scenario.name} must fail closed in loadAdmin`);
  assert.equal(result.issue.code, 'admin_home_authority_invalid');
  assert.equal(result.task, null);
  assert.doesNotMatch(result.markup, new RegExp(scenario.forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const courseContext = { window: {} };
vm.runInNewContext(course, courseContext, { filename: 'pages/admin/admin-course-governance.js' });
const contract = courseContext.window.AdminCourseGovernance.contract;
assert.ok(contract, 'course governance owner must expose executable contract helpers');

const jsonClone = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(Array.from(contract.allowedTransitions('draft')), ['published', 'archived']);
assert.deepEqual(Array.from(contract.allowedTransitions('published')), ['draft', 'archived']);
assert.deepEqual(Array.from(contract.allowedTransitions('archived')), ['draft']);
assert.equal(contract.allowedTransitions('archived').includes('published'), false);

const originalCourse = { id: 9, school_id: 3, status: 'draft' };
const mutation = contract.buildMutation(originalCourse, 'published', '  完成课程发布核对  ');
assert.deepEqual(jsonClone(mutation), {
  expected_status: 'draft',
  status: 'published',
  reason: '完成课程发布核对',
});
assert.throws(() => contract.buildMutation(originalCourse, 'draft', '原因'), /没有变化/);
assert.throws(
  () => contract.buildMutation({ ...originalCourse, status: 'archived' }, 'published', '原因'),
  /不能直接转换/,
);
assert.throws(() => contract.buildMutation(originalCourse, 'published', ' '.repeat(4)), /不能为空/);
assert.throws(() => contract.buildMutation(originalCourse, 'published', 'x'.repeat(1001)), /1000/);
assert.deepEqual(jsonClone(contract.selectionFromAuthority(
  [{ id: 9, school_id: 8, status: 'archived' }],
  9,
)), {
  selectedId: 9,
  editor: { targetStatus: 'draft', reason: '', message: '', messageType: '' },
}, 'a new API Base authority read must rebuild the inspector editor');

const crossBaseContext = {
  loaded: true,
  loading: false,
  courses: [{ id: 9, school_id: 3, status: 'published' }],
  editor: { targetStatus: 'draft' },
  results: new Map(),
  locks: new Map(),
};
const oldBaseResult = {
  type: 'success',
  title: '课程状态已确认',
  requestId: 'old-base-request-id',
  impact: { attached_class_count: 17, course_unit_count: 18, assignment_count: 19 },
};
contract.storeCourseResult(crossBaseContext.results, 9, oldBaseResult);
assert.equal(crossBaseContext.results.get(9), oldBaseResult, 'old Base success must enter the production result store');
contract.resetCourseContext(crossBaseContext);
assert.equal(crossBaseContext.results.size, 0, 'context reset must clear every old Base result');
const newBaseAuthority = [{ id: 9, school_id: 8, status: 'archived' }];
const newBaseSelection = contract.selectionFromAuthority(newBaseAuthority, 9);
crossBaseContext.courses = newBaseAuthority;
crossBaseContext.editor = newBaseSelection.editor;
const inspectorState = {
  course: crossBaseContext.courses[0],
  editor: crossBaseContext.editor,
  result: crossBaseContext.results.get(newBaseSelection.selectedId),
};
assert.equal(inspectorState.result, undefined, 'same course id on the new Base must not recover an old result');
assert.doesNotMatch(JSON.stringify(inspectorState), /old-base-request-id|attached_class_count|course_unit_count|assignment_count/);
assert.match(course, /storeCourseResult\(state\.results, course\.id, \{[\s\S]*title: '课程状态与精确审计已确认'/);
assert.match(course, /function invalidateContext\(\)[\s\S]*resetCourseContext\(state\)/);

const impact = { attached_class_count: 2, course_unit_count: 3, assignment_count: 4 };
const validResponse = {
  course: { id: 9, school_id: 3, status: 'published' },
  impact,
};
assert.equal(contract.impactMatches(impact), true);
assert.equal(contract.impactMatches({ ...impact, assignment_count: -1 }), false);
assert.equal(contract.impactMatches({ ...impact, assignment_count: 1.5 }), false);
assert.equal(contract.responseMatches(validResponse, originalCourse, 'published'), true);
assert.equal(
  contract.responseMatches(
    { ...validResponse, course: { id: 9, school_id: 4, status: 'published' } },
    originalCourse,
    'published',
  ),
  false,
  'same id/status from another school must become unknown',
);
assert.equal(
  contract.responseMatches({ ...validResponse, impact: {} }, originalCourse, 'published'),
  false,
);

const lock = {
  courseId: 9,
  schoolId: 3,
  expectedStatus: 'draft',
  targetStatus: 'published',
  requestId: 'admin-course-proof',
};
const auditIdentity = {
  action: 'course.status.patch',
  resource_type: 'course',
  resource_id: 9,
  request_id: 'admin-course-proof',
};
const exactAudit = {
  items: [{
    ...auditIdentity,
    event_result: 'success',
    snapshot_json: { before: { status: 'draft' }, after: { status: 'published' } },
  }],
};
const exactAuditJson = {
  items: [{
    ...auditIdentity,
    event_result: 'success',
    snapshot_json: JSON.stringify({ after: { status: 'published' } }),
  }],
};
assert.equal(contract.exactAuditPresent(exactAudit, lock), true);
assert.equal(contract.exactAuditPresent(exactAuditJson, lock), true);
assert.equal(contract.reconcileOutcome({ id: 9, school_id: 3, status: 'published' }, exactAudit, lock), 'applied');
assert.equal(contract.reconcileOutcome({ id: 9, school_id: 3, status: 'draft' }, { items: [] }, lock), 'unchanged');
assert.equal(
  contract.reconcileOutcome(
    { id: 9, school_id: 3, status: 'draft' },
    { items: [] },
    { ...lock, writeConfirmed: true },
  ),
  'mismatch',
  'a trusted 2xx response may not be downgraded to unchanged and manually unlocked',
);
assert.equal(
  contract.reconcileOutcome({ id: 9, school_id: 4, status: 'published' }, exactAudit, lock),
  'mismatch',
  'authority from another school cannot prove applied',
);

for (const [label, item] of [
  ['failure event', { ...auditIdentity, event_result: 'failure', snapshot_json: { after: { status: 'published' } } }],
  ['missing snapshot', { ...auditIdentity, event_result: 'success' }],
  ['invalid snapshot JSON', { ...auditIdentity, event_result: 'success', snapshot_json: '{invalid' }],
  ['wrong after status', { ...auditIdentity, event_result: 'success', snapshot_json: { after: { status: 'archived' } } }],
]) {
  const evidence = { items: [item] };
  assert.equal(contract.auditEvidenceState(evidence, lock), 'mismatch', label);
  assert.equal(
    contract.reconcileOutcome({ id: 9, school_id: 3, status: 'published' }, evidence, lock),
    'mismatch',
    `${label} cannot prove applied`,
  );
  assert.equal(
    contract.reconcileOutcome({ id: 9, school_id: 3, status: 'draft' }, evidence, lock),
    'mismatch',
    `${label} cannot unlock unchanged`,
  );
}
for (const [field, value] of [
  ['action', 'course.update'],
  ['resource_type', 'school'],
  ['resource_id', 10],
  ['request_id', 'different'],
]) {
  assert.equal(
    contract.exactAuditPresent({
      items: [{ ...exactAudit.items[0], [field]: value }],
    }, lock),
    false,
    `audit ${field} must match exactly`,
  );
}
assert.deepEqual(jsonClone(contract.auditFact(exactAudit.items[0])), {
  action: 'course.status.patch',
  resourceType: 'course',
  resourceId: 9,
  requestId: 'admin-course-proof',
  eventResult: 'success',
  afterStatus: 'published',
  createdAt: '',
});
assert.deepEqual(jsonClone(contract.courseAuditParams(lock)), {
  action: 'course.status.patch',
  resource_type: 'course',
  resource_id: 9,
  request_id: 'admin-course-proof',
  limit: 25,
  offset: 0,
});

const checkpointOwners = contract.createControllerOwnership(AbortController);
const checkpointOperation = checkpointOwners.beginMutation({
  courseId: 9,
  course: originalCourse,
  payload: mutation,
  requestId: 'admin-course-checkpoint',
  sent: true,
  checkpoint: null,
});
let resolveCheckpointAudit;
const checkpointAuditGate = new Promise((resolve) => { resolveCheckpointAudit = resolve; });
let resolveCheckpointReady;
const checkpointReady = new Promise((resolve) => { resolveCheckpointReady = resolve; });
let checkpointPatchCount = 0;
const checkpointTransaction = contract.executeCourseWriteTransaction(originalCourse, mutation, {
  requestId: 'admin-course-checkpoint',
  signal: checkpointOperation.signal,
  request: async (pathname, options = {}) => {
    if (options.method === 'PATCH') {
      checkpointPatchCount += 1;
      return validResponse;
    }
    return checkpointAuditGate;
  },
  onResponseVerified: (checkpoint) => {
    assert.equal(contract.transferMutationCheckpoint(checkpointOperation, checkpoint), true);
    resolveCheckpointReady();
  },
  isAmbiguous: () => false,
});
await checkpointReady;
assert.equal(checkpointPatchCount, 1);
assert.equal(checkpointOperation.checkpoint.writeConfirmed, true);
assert.deepEqual(jsonClone(checkpointOperation.checkpoint.authority), validResponse.course);
assert.deepEqual(jsonClone(checkpointOperation.checkpoint.impact), impact);
let handedOffCheckpointLock = null;
checkpointOwners.destroy((operation) => {
  handedOffCheckpointLock = contract.lockFromMutationOperation(operation, 'unknown');
});
assert.ok(handedOffCheckpointLock, 'destroy must hand off a sent mutation checkpoint');
assert.equal(handedOffCheckpointLock.writeConfirmed, true);
assert.deepEqual(jsonClone(handedOffCheckpointLock.authority), validResponse.course);
assert.deepEqual(jsonClone(handedOffCheckpointLock.impact), impact);
assert.equal(
  contract.reconcileOutcome(
    { id: 9, school_id: 3, status: 'draft' },
    { items: [] },
    handedOffCheckpointLock,
  ),
  'mismatch',
  'trusted 2xx plus temporarily empty audit may never become unchanged/unlockable after remount',
);
const remountedLockSnapshot = {
  mutationCourseId: 0,
  lockCount: 1,
  lockedCourseIds: [9],
};
assert.equal(contract.courseWriteBlocked(remountedLockSnapshot), true);
assert.equal(
  contract.guardedCourseSelection(9, 10, remountedLockSnapshot),
  9,
  'course A lock must reject a click on course B',
);
assert.equal(
  contract.courseRowDisabled(9, 9, remountedLockSnapshot),
  false,
  'the selected locked course A must remain a read-only reconciliation entry',
);
assert.equal(
  contract.courseRowDisabled(10, 9, remountedLockSnapshot),
  true,
  'every non-selected course row must remain behaviorally disabled while A is locked',
);
assert.equal(contract.guardedCourseSelection(9, 9, remountedLockSnapshot), 9);
let blockedPatchCount = 0;
const blockedExecutor = contract.createConfirmedMutationExecutor(
  async () => {
    blockedPatchCount += 1;
    return validResponse;
  },
  null,
  () => !contract.courseWriteBlocked(remountedLockSnapshot),
);
assert.equal((await blockedExecutor.submit({ ...originalCourse, id: 10 }, mutation)).kind, 'blocked');
assert.equal((await blockedExecutor.submit({ ...originalCourse, id: 10 }, mutation)).kind, 'blocked');
assert.equal(blockedPatchCount, 0, 'a lock on course A must block every new course PATCH');
const checkpointExactAudit = {
  items: [{
    ...exactAudit.items[0],
    request_id: 'admin-course-checkpoint',
  }],
};
assert.equal(
  contract.reconcileOutcome(validResponse.course, checkpointExactAudit, handedOffCheckpointLock),
  'applied',
  'only the later exact matching audit may complete a trusted checkpoint',
);
resolveCheckpointAudit(checkpointExactAudit);
assert.equal((await checkpointTransaction).kind, 'verified');
assert.equal(checkpointPatchCount, 1, 'late audit completion must not send another PATCH');
assert.match(course, /operation\.checkpoint[\s\S]*writeConfirmed/);
assert.match(course, /mutationLock\([\s\S]*operation\.checkpoint/);

const courseTransactionCalls = [];
const verifiedCourseTransaction = await contract.executeCourseWriteTransaction(originalCourse, mutation, {
  requestId: 'admin-course-proof',
  request: async (pathname, options = {}) => {
    courseTransactionCalls.push({ pathname, options });
    if (options.method === 'PATCH') return validResponse;
    if (pathname === '/api/admin/audit-logs') return exactAudit;
    throw new Error(`unexpected course transaction request: ${pathname}`);
  },
  isAmbiguous: () => false,
});
assert.equal(verifiedCourseTransaction.kind, 'verified');
assert.equal(courseTransactionCalls.filter((call) => call.options.method === 'PATCH').length, 1);
assert.equal(courseTransactionCalls.filter((call) => call.pathname === '/api/admin/audit-logs').length, 1);
assert.deepEqual(jsonClone(courseTransactionCalls[0].options.body), jsonClone(mutation));
assert.deepEqual(jsonClone(courseTransactionCalls[0].options.headers), { 'X-Request-ID': 'admin-course-proof' });
assert.deepEqual(
  jsonClone(courseTransactionCalls[1].options.params),
  jsonClone(contract.courseAuditParams(lock)),
);
assert.deepEqual(
  jsonClone(contract.auditFact(verifiedCourseTransaction.audit)),
  jsonClone(contract.auditFact(exactAudit.items[0])),
);

async function executeCourseEvidenceCase(requestId, auditResult) {
  const calls = [];
  const result = await contract.executeCourseWriteTransaction(originalCourse, mutation, {
    requestId,
    request: async (pathname, options = {}) => {
      calls.push({ pathname, options });
      if (options.method === 'PATCH') return validResponse;
      if (auditResult instanceof Error) throw auditResult;
      return auditResult;
    },
    isAmbiguous: () => false,
  });
  assert.equal(calls.filter((call) => call.options.method === 'PATCH').length, 1);
  assert.equal(calls.filter((call) => call.pathname === '/api/admin/audit-logs').length, 1);
  return result;
}

const missingAuditTransaction = await executeCourseEvidenceCase(
  'admin-course-missing',
  { items: [] },
);
assert.equal(missingAuditTransaction.kind, 'audit-missing');
assert.equal(missingAuditTransaction.checkpoint.writeConfirmed, true);
const mismatchedAuditTransaction = await executeCourseEvidenceCase(
  'admin-course-mismatch',
  {
    items: [{
      ...auditIdentity,
      request_id: 'admin-course-mismatch',
      event_result: 'failure',
      snapshot_json: { after: { status: 'published' } },
    }],
  },
);
assert.equal(mismatchedAuditTransaction.kind, 'audit-mismatch');
assert.equal(mismatchedAuditTransaction.checkpoint.writeConfirmed, true);
const failedAuditTransaction = await executeCourseEvidenceCase(
  'admin-course-read-failed',
  new Error('audit unavailable'),
);
assert.equal(failedAuditTransaction.kind, 'audit-read-failed');
assert.equal(failedAuditTransaction.checkpoint.writeConfirmed, true);

const ambiguousCalls = [];
const ambiguousTransaction = await contract.executeCourseWriteTransaction(originalCourse, mutation, {
  requestId: 'admin-course-ambiguous',
  request: async (pathname, options = {}) => {
    ambiguousCalls.push({ pathname, options });
    const error = new Error('connection closed after write');
    error.ambiguous = true;
    throw error;
  },
  isAmbiguous: (error) => error.ambiguous === true,
});
assert.equal(ambiguousTransaction.kind, 'ambiguous');
assert.equal(ambiguousCalls.filter((call) => call.options.method === 'PATCH').length, 1);
assert.equal(ambiguousCalls.some((call) => call.pathname === '/api/admin/audit-logs'), false);
const ambiguousLock = {
  ...lock,
  requestId: 'admin-course-ambiguous',
};
const ambiguousExactAudit = {
  items: [{ ...exactAudit.items[0], request_id: 'admin-course-ambiguous' }],
};
assert.equal(
  contract.reconcileOutcome(
    { id: 9, school_id: 3, status: 'published' },
    ambiguousExactAudit,
    ambiguousLock,
  ),
  'applied',
  'ambiguous writes are resolved only by the read-only authority state machine',
);
assert.match(course, /transaction\.kind !== 'verified'[\s\S]*mutationLock\(course, payload, requestId, outcome, transaction\.checkpoint\)/);
assert.match(course, /transaction\.kind === 'ambiguous'[\s\S]*await reconcile\(lock\)/);
assert.match(course, /audit:\s*auditFact\(transaction\.audit\)/);
assert.match(course, /data-admin-course-audit-fact/);

assert.equal(
  contract.classifyConflict({ status: 'published' }, 'draft', 'published'),
  'no-op',
);
assert.equal(
  contract.classifyConflict({ status: 'archived' }, 'published', 'draft'),
  'stale',
);
assert.equal(
  contract.classifyConflict({ status: 'archived' }, 'archived', 'published'),
  'invalid',
);
assert.equal(
  contract.classifyConflict({ status: 'draft' }, 'draft', 'published'),
  'unresolved',
);
assert.equal(contract.classifyConflict(null, 'draft', 'published'), 'read-failed');
assert.deepEqual(jsonClone(contract.conflictPresentation(
  'stale',
  { status: 'archived' },
  { expected_status: 'published', status: 'draft' },
)), {
  title: '状态冲突：前置状态已过期',
  messageHtml: '课程状态已从「已发布」变为「已归档」。本次请求未重发；请核对最新状态后重新选择。',
});
assert.deepEqual(jsonClone(contract.conflictPresentation(
  'invalid',
  { status: 'archived' },
  { expected_status: 'archived', status: 'published' },
)), {
  title: '状态冲突：转换非法',
  messageHtml: '不能从「已归档」直接切换为「已发布」。已归档课程必须先恢复为草稿并重新复核。',
});
assert.deepEqual(jsonClone(contract.conflictPresentation(
  'no-op',
  { status: 'published' },
  { expected_status: 'draft', status: 'published' },
)), {
  title: '状态冲突：目标已存在',
  messageHtml: '课程已处于「已发布」，没有产生写入，也不会新增审计记录。',
});
assert.deepEqual(jsonClone(contract.conflictPresentation('read-failed', null, mutation)), {
  title: '冲突回读失败',
  messageHtml: '未读取到课程权威当前状态（actual），无法分类本次冲突。本次请求未重发；请人工刷新。',
});
assert.match(
  contract.conflictPresentation(
    'stale',
    { status: '<actual>' },
    { expected_status: '<expected>', status: 'draft' },
  ).messageHtml,
  /&lt;expected&gt;[\s\S]*&lt;actual&gt;/,
  'authority and payload status values must be HTML-escaped',
);

const owners = contract.createControllerOwnership(AbortController);
const writeOwner = owners.beginMutation({
  courseId: 9,
  course: originalCourse,
  payload: mutation,
  requestId: 'controller-proof',
  sent: true,
});
const firstRead = owners.beginRead({ purpose: 'first' });
const reconcileOwner = owners.beginReconcile({ courseId: 9 });
const secondRead = owners.beginRead({ purpose: 'refresh' });
assert.equal(firstRead.signal.aborted, true, 'new list read may replace only the previous list read');
assert.equal(secondRead.signal.aborted, false);
assert.equal(writeOwner.signal.aborted, false, 'ordinary refresh must not abort a sent PATCH');
assert.equal(reconcileOwner.signal.aborted, false, 'ordinary refresh must not abort reconciliation');
assert.equal(owners.beginMutation({ courseId: 10 }), null, 'one mutation owner must remain course-bound');
let destroyedMutation = null;
owners.destroy((owner) => {
  destroyedMutation = owner;
});
assert.equal(destroyedMutation, writeOwner, 'destroy must surface the sent mutation as ambiguous');
assert.equal(writeOwner.signal.aborted, true);
assert.equal(reconcileOwner.signal.aborted, true);

class CourseElement {}
class CourseDialog {
  constructor() {
    this.open = false;
  }

  showModal() {
    this.open = true;
  }

  setAttribute(name) {
    if (name === 'open') this.open = true;
  }

  removeAttribute(name) {
    if (name === 'open') this.open = false;
  }

  close() {
    this.open = false;
  }

  querySelector() {
    return null;
  }
}
class CourseHost extends CourseElement {
  constructor() {
    super();
    this.listeners = Object.create(null);
    this._innerHTML = '';
    this.dialog = new CourseDialog();
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.dialog = new CourseDialog();
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '[data-admin-course-dialog]') return this.dialog;
    if (selector === '[data-admin-course-dialog][open]') return this.dialog.open ? this.dialog : null;
    return null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  removeEventListener(type) {
    delete this.listeners[type];
  }
}
let courseApiBase = 'https://course-old.example';
const courseReadCalls = [];
const courseReadResolvers = [];
const courseOwnerWindow = {
  AbortController,
  AstraApiClient: {
    request: (pathname, options = {}) => {
      assert.ok([
        '/api/courses',
        '/api/v1/admin/course-information-revisions',
      ].includes(pathname));
      courseReadCalls.push({ pathname, baseUrl: options.baseUrl, signal: options.signal });
      return new Promise((resolve) => courseReadResolvers.push({ pathname, resolve }));
    },
    isCancelled: (error) => error && error.name === 'AbortError',
    message: (error) => error.message,
  },
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (callback) => setImmediate(callback),
  cancelAnimationFrame: (id) => clearImmediate(id),
};
const courseOwnerContext = {
  window: courseOwnerWindow,
  Element: CourseElement,
  AbortController,
};
vm.runInNewContext(course, courseOwnerContext, {
  filename: 'pages/admin/admin-course-governance.js',
});
const courseOwner = courseOwnerWindow.AdminCourseGovernance;
const courseHost = new CourseHost();
assert.equal(courseOwner.mount(courseHost, {
  getApiBase: () => courseApiBase,
  refreshIcons: () => {},
}), true);
const oldBaseActivation = courseOwner.activate();
assert.equal(courseReadCalls.length, 2);
assert.deepEqual(courseReadCalls.map((call) => call.pathname), [
  '/api/courses',
  '/api/v1/admin/course-information-revisions',
]);
courseReadCalls.forEach((call) => assert.equal(call.baseUrl, 'https://course-old.example'));
assert.equal(courseOwner.invalidateContext(), true);
courseReadCalls.forEach((call) => {
  assert.equal(call.signal.aborted, true, 'Base reset must abort every active old-Base course-governance read');
});
courseApiBase = 'https://course-new.example';
courseReadResolvers.find((item) => item.pathname === '/api/courses').resolve([{
  id: 9,
  school_id: 3,
  status: 'draft',
  title: 'OLD BASE AUTHORITY',
}]);
courseReadResolvers.find((item) => item.pathname === '/api/v1/admin/course-information-revisions').resolve({
  items: [], total: 0, limit: 200, offset: 0, next_offset: null,
});
courseReadResolvers.length = 0;
assert.equal(await oldBaseActivation, false);
assert.equal(courseOwner.snapshot().loaded, false);
assert.deepEqual(Array.from(courseOwner.snapshot().courses), [], 'late old-Base authority must write back zero courses');
assert.doesNotMatch(courseHost.innerHTML, /OLD BASE AUTHORITY/);
const newBaseActivation = courseOwner.activate();
assert.equal(courseReadCalls.length, 4, 'first activation on the new Base must issue both governance reads');
courseReadCalls.slice(2).forEach((call) => assert.equal(call.baseUrl, 'https://course-new.example'));
courseReadResolvers.find((item) => item.pathname === '/api/courses').resolve([{
  id: 9,
  school_id: 8,
  status: 'archived',
  title: 'NEW BASE AUTHORITY',
}]);
courseReadResolvers.find((item) => item.pathname === '/api/v1/admin/course-information-revisions').resolve({
  items: [], total: 0, limit: 200, offset: 0, next_offset: null,
});
courseReadResolvers.length = 0;
assert.equal(await newBaseActivation, true);
const newBaseCourseSnapshot = jsonClone(courseOwner.snapshot().courses);
assert.deepEqual(newBaseCourseSnapshot, [{ id: 9, school_id: 8, status: 'archived' }]);
assert.match(courseHost.innerHTML, /待审队列已清空/);
assert.doesNotMatch(courseHost.innerHTML, /OLD BASE AUTHORITY/);
assert.equal(
  contract.buildMutation(newBaseCourseSnapshot[0], 'draft', '新 Base 重新预览').expected_status,
  'archived',
  'an old-Base draft expected_status must not be available to submit after reset',
);
courseOwner.destroy();

const patchCalls = [];
const patchResolvers = [];
let currentApiBase = 'https://old.example';
const AstraApiClient = {
  request(pathname, options) {
    patchCalls.push({ baseUrl: currentApiBase, pathname, options });
    return new Promise((resolve) => patchResolvers.push(() => resolve(validResponse)));
  },
};
const mutationExecutor = contract.createConfirmedMutationExecutor(
  (courseAuthority, body) => contract.sendCourseStatusPatch(
    courseAuthority,
    body,
    'admin-course-harness',
    undefined,
    AstraApiClient.request,
  ),
);
let execution = await mutationExecutor.submit(originalCourse, mutation);
assert.equal(execution.kind, 'confirmation');
assert.equal(patchCalls.length, 0, 'first confirmation sends zero PATCH requests');
assert.equal(contract.invalidateConfirmationContext(mutationExecutor), true);
currentApiBase = 'https://new.example';
execution = await mutationExecutor.submit(originalCourse, mutation);
assert.equal(execution.kind, 'confirmation', 'the old backend confirmation must not cross an API Base change');
assert.equal(patchCalls.length, 0, 'the first confirmation on the new Base still sends zero PATCH requests');
const secondConfirmation = mutationExecutor.submit(originalCourse, mutation);
const duplicateWhileWriting = await mutationExecutor.submit(originalCourse, mutation);
assert.equal(duplicateWhileWriting.kind, 'busy');
await Promise.resolve();
assert.equal(patchCalls.length, 1, 'second unchanged confirmation sends exactly one PATCH');
assert.equal(patchCalls[0].baseUrl, 'https://new.example', 'PATCH and subsequent authority work stay on the new Base');
assert.equal(patchCalls[0].pathname, '/api/courses/9/status');
assert.equal(patchCalls[0].options.method, 'PATCH');
assert.deepEqual(jsonClone(patchCalls[0].options.headers), { 'X-Request-ID': 'admin-course-harness' });
assert.deepEqual(jsonClone(patchCalls[0].options.body), jsonClone(mutation), 'PATCH body must be the production JSON payload');
patchResolvers.shift()();
execution = await secondConfirmation;
assert.equal(execution.kind, 'sent');
assert.equal(patchCalls.length, 1, 'repeated submit while writing must remain one PATCH');

await mutationExecutor.submit(originalCourse, mutation);
mutationExecutor.invalidate();
const changedMutation = { ...mutation, reason: '输入变化后的新原因' };
execution = await mutationExecutor.submit(originalCourse, changedMutation);
assert.equal(execution.kind, 'confirmation', 'input invalidation requires a fresh first confirmation');
assert.equal(patchCalls.length, 1);
const changedConfirmation = mutationExecutor.submit(originalCourse, changedMutation);
await Promise.resolve();
assert.equal(patchCalls.length, 2);
assert.deepEqual(jsonClone(patchCalls[1].options.body), changedMutation);
patchResolvers.shift()();
await changedConfirmation;

const secondaryValidationWindow = {};
vm.runInNewContext(secondary, { window: secondaryValidationWindow }, {
  filename: 'pages/admin/admin-secondary-governance.js',
});
const secondaryValidationOwner = secondaryValidationWindow.AdminSecondaryGovernance;
assert.equal(secondaryValidationOwner.contract.isBusinessAudit({
  action: 'class.join',
  resource_type: 'class_membership',
}), true);
assert.equal(secondaryValidationOwner.contract.isBusinessAudit({
  action: 'class.member.status.batch_update',
  resource_type: 'class_membership_batch',
}), true);
for (const mismatchedAudit of [
  { action: 'class.join', resource_type: 'class_member' },
  { action: 'class.join.request.approve', resource_type: 'class_membership' },
  { action: 'admin.alert_outbox.list', resource_type: 'admin_alert_outbox' },
]) {
  assert.equal(
    secondaryValidationOwner.contract.isBusinessAudit(mismatchedAudit),
    false,
    `${mismatchedAudit.action}:${mismatchedAudit.resource_type} must stay outside the finite business allowlist`,
  );
}
const validAdminStats = Object.freeze({
  pending_class_join_requests: 0,
  total_users: 3,
  total_schools: 1,
  total_classes: 2,
  total_courses: 4,
  total_assignments: 5,
  total_submissions: 6,
  total_learning_events: 7,
  total_audit_logs: 8,
  users_by_role: Object.freeze({ admin: 1, teacher: 1, student: 1 }),
});
assert.equal(secondaryValidationOwner.validateStatsPayload(validAdminStats), validAdminStats);
for (const field of [
  'pending_class_join_requests', 'total_users', 'total_schools', 'total_classes',
  'total_courses', 'total_assignments', 'total_submissions', 'total_learning_events',
  'total_audit_logs', 'users_by_role',
]) {
  const missing = { ...validAdminStats };
  delete missing[field];
  assert.throws(
    () => secondaryValidationOwner.validateStatsPayload(missing),
    /管理员统计响应结构无效/,
    `stats must fail closed when ${field} is missing`,
  );
}
for (const invalidStats of [
  {},
  { ...validAdminStats, total_users: -1 },
  { ...validAdminStats, total_users: '3' },
  { ...validAdminStats, total_users: Number.NaN },
  { ...validAdminStats, users_by_role: null },
  { ...validAdminStats, users_by_role: [] },
  { ...validAdminStats, users_by_role: { admin: -1 } },
  { ...validAdminStats, users_by_role: { admin: '1' } },
  { ...validAdminStats, users_by_role: { admin: 1, owner: 1 } },
]) {
  assert.throws(() => secondaryValidationOwner.validateStatsPayload(invalidStats), /管理员统计响应结构无效/);
}

const adminContext = {
  window: { AdminSecondaryGovernance: secondaryValidationOwner },
  AdminSecondaryGovernance: secondaryValidationOwner,
  navigator: { onLine: true },
  console,
};
vm.runInNewContext(admin, adminContext, { filename: 'pages/admin/admin.js' });
const adminContract = adminContext.window.AdminGovernance.contract;
class OwnerScript {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.src = '';
    this.async = false;
    this.isConnected = false;
    this.listeners = { load: new Set(), error: new Set() };
  }

  getAttribute(name) {
    return name === 'src' ? this.src : null;
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type].delete(listener);
  }

  dispatch(type) {
    for (const listener of Array.from(this.listeners[type])) listener({ type, target: this });
  }

  remove() {
    this.isConnected = false;
    const index = this.ownerDocument.scripts.indexOf(this);
    if (index >= 0) this.ownerDocument.scripts.splice(index, 1);
  }
}
const ownerDocument = {
  scripts: [],
  created: [],
  createElement: (tagName) => {
    assert.equal(tagName, 'script');
    const script = new OwnerScript(ownerDocument);
    ownerDocument.created.push(script);
    return script;
  },
  body: {
    appendChild: (script) => {
      script.isConnected = true;
      ownerDocument.scripts.push(script);
      return script;
    },
  },
};
adminContext.document = ownerDocument;
delete adminContext.window.AdminCourseGovernance;
delete adminContext.window.AdminSecondaryGovernance;
const failedOwnerLoad = adminContract.ensureOwnerModules();
assert.strictEqual(
  adminContract.ensureOwnerModules(),
  failedOwnerLoad,
  'concurrent owner loads must share one valid in-flight promise',
);
const failedOwnerScripts = ownerDocument.scripts.slice();
assert.equal(failedOwnerScripts.length, 2);
failedOwnerScripts[0].dispatch('error');
await assert.rejects(failedOwnerLoad, /治理模块加载失败/);
assert.equal(ownerDocument.scripts.length, 0, 'one error must remove the entire owner-script batch before retry');
assert.ok(failedOwnerScripts.every((script) => (
  !script.isConnected
  && script.listeners.load.size === 0
  && script.listeners.error.size === 0
)), 'the failed node and never-settled sibling must both release their listeners');
const retriedOwnerLoad = adminContract.ensureOwnerModules();
assert.strictEqual(adminContract.ensureOwnerModules(), retriedOwnerLoad);
const retriedOwnerScripts = ownerDocument.scripts.slice();
assert.equal(retriedOwnerScripts.length, 2, 'retry must create fresh owner script nodes');
assert.ok(retriedOwnerScripts.every((script) => !failedOwnerScripts.includes(script)));
assert.equal(ownerDocument.created.length, 4, 'retry must not reuse either node from the failed batch');
adminContext.window.AdminCourseGovernance = {};
adminContext.window.AdminSecondaryGovernance = secondaryValidationOwner;
adminContext.AdminSecondaryGovernance = secondaryValidationOwner;
retriedOwnerScripts.forEach((script) => script.dispatch('load'));
await retriedOwnerLoad;
assert.equal(ownerDocument.scripts.length, 2, 'successful retry must retain exactly one fresh node per owner');
assert.ok(retriedOwnerScripts.every((script) => (
  script.dataset.adminOwnerState === 'loaded'
  && script.listeners.load.size === 0
  && script.listeners.error.size === 0
)), 'successful retry must resolve and release listeners');

const applyJoinReadbackBody = admin.match(/function applyJoinReviewReadback\(readback\) \{([\s\S]*?)\n    \}/);
assert.ok(applyJoinReadbackBody);
assert.match(applyJoinReadbackBody[1], /state\.panelData\['audit-logs'\] = readback\.audit/);
assert.match(applyJoinReadbackBody[1], /state\.sectionLoaded\.audit = false/);
assert.match(applyJoinReadbackBody[1], /rerenderPanel\('audit-logs'\)/);
const joinAuthority = {
  id: 77,
  school_id: 3,
  class_id: 12,
  user_id: 44,
  role: 'student',
  status: 'pending',
};
const reviewedJoin = { ...joinAuthority, status: 'approved', reviewed_by_user_id: 1 };
const joinRequestId = 'admin-join-executable-proof';
const joinCalls = [];
let releaseJoinPatch;
const joinPatchGate = new Promise((resolve) => { releaseJoinPatch = resolve; });
const joinRequest = async (pathname, options = {}) => {
  joinCalls.push({ pathname, options });
  if (options.method === 'PATCH') {
    await joinPatchGate;
    return reviewedJoin;
  }
  if (pathname.endsWith('/members/page')) {
    return {
      items: [{ id: 91, class_id: 12, user_id: 44, role: 'student', status: 'active' }],
      total: 1,
      limit: 200,
      offset: 0,
      next_offset: null,
    };
  }
  if (pathname === '/api/admin/stats') return validAdminStats;
  if (pathname === '/api/admin/audit-logs') {
    return {
      items: [{
        action: 'class.join.request.approve',
        resource_type: 'class_join_request',
        resource_id: 77,
        request_id: joinRequestId,
        event_result: 'success',
        snapshot_json: {
          after: { class_id: 12, user_id: 44, role: 'student', status: 'approved' },
        },
      }],
      total: 1,
      limit: 25,
      offset: 0,
      next_offset: null,
    };
  }
  if (pathname === '/api/admin/class-join-requests' && options.params.status === 'approved') {
    return { items: [reviewedJoin], total: 1, limit: 200, offset: 0, next_offset: null };
  }
  if (pathname === '/api/admin/class-join-requests') {
    return { items: [], total: 0, limit: 10, offset: 0, next_offset: null };
  }
  throw new Error(`unexpected join request: ${pathname}`);
};
const joinExecutor = adminContract.createConfirmedJoinReviewExecutor(
  (authority, nextStatus) => adminContract.executeJoinReviewTransaction(authority, nextStatus, {
    request: joinRequest,
    requestId: joinRequestId,
    baseUrl: 'https://admin-new.example',
    listParams: { status: 'pending', limit: 10, offset: 0 },
    isAmbiguous: () => false,
  }),
);
let joinExecution = await joinExecutor.submit(joinAuthority, 'approved');
assert.equal(joinExecution.kind, 'confirmation');
assert.equal(joinCalls.length, 0, 'first join confirmation must issue zero requests');
const joinCommit = joinExecutor.submit(joinAuthority, 'approved');
await Promise.resolve();
const duplicateJoinCommit = await joinExecutor.submit(joinAuthority, 'approved');
assert.equal(duplicateJoinCommit.kind, 'busy');
assert.equal(joinCalls.filter((call) => call.options.method === 'PATCH').length, 1);
releaseJoinPatch();
joinExecution = await joinCommit;
assert.equal(joinExecution.kind, 'sent');
const joinResult = joinExecution.value;
const joinPatches = joinCalls.filter((call) => call.options.method === 'PATCH');
assert.equal(joinPatches.length, 1, 'double confirmation and busy repeat must share exactly one production PATCH');
assert.equal(joinPatches[0].pathname, '/api/admin/class-join-requests/77');
assert.equal(joinPatches[0].options.baseUrl, 'https://admin-new.example');
assert.deepEqual(jsonClone(joinPatches[0].options.headers), { 'X-Request-ID': joinRequestId });
assert.deepEqual(jsonClone(joinPatches[0].options.body), {
  status: 'approved',
  note: 'reviewed from admin governance UI',
});
assert.equal(joinResult.readback.reviewed.id, 77, 'the reviewed application row must come from authority');
assert.equal(joinResult.readback.member.member.user_id, 44, 'approved membership must come from the paged member authority');
assert.equal(joinResult.readback.stats.pending_class_join_requests, 0, 'stats must be a returned authority payload');
assert.equal(joinResult.readback.audit.items[0].request_id, joinRequestId, 'audit must carry the exact UI Request ID');
for (const call of joinCalls) {
  assert.equal(call.options.baseUrl, 'https://admin-new.example', 'PATCH and every readback must stay on one API Base');
}
for (const requiredPath of [
  '/api/admin/class-join-requests',
  '/api/classes/12/members/page',
  '/api/admin/stats',
  '/api/admin/audit-logs',
]) {
  assert.ok(joinCalls.some((call) => call.pathname === requiredPath), `missing production readback ${requiredPath}`);
}
assert.equal(
  adminContract.joinReviewAuditMatches(joinResult.readback.audit, joinAuthority, 'approved', joinRequestId),
  true,
);
assert.equal(
  adminContract.joinReviewAuditMatches({
    items: [{ ...joinResult.readback.audit.items[0], request_id: 'wrong-request' }],
  }, joinAuthority, 'approved', joinRequestId),
  false,
);

const rejectedAuthority = { ...joinAuthority, id: 78, user_id: 45 };
const rejectedResult = { ...rejectedAuthority, status: 'rejected' };
const rejectCalls = [];
const rejectRequestId = 'admin-join-reject-proof';
const rejectRequest = async (pathname, options = {}) => {
  rejectCalls.push({ pathname, options });
  if (options.method === 'PATCH') return rejectedResult;
  if (pathname.endsWith('/members/page')) throw new Error('rejection must not request or fabricate membership');
  if (pathname === '/api/admin/stats') return validAdminStats;
  if (pathname === '/api/admin/audit-logs') {
    return {
      items: [{
        action: 'class.join.request.reject',
        resource_type: 'class_join_request',
        resource_id: 78,
        request_id: rejectRequestId,
        event_result: 'success',
        snapshot_json: {
          after: { class_id: 12, user_id: 45, role: 'student', status: 'rejected' },
        },
      }],
    };
  }
  if (pathname === '/api/admin/class-join-requests' && options.params.status === 'rejected') {
    return { items: [rejectedResult], total: 1, limit: 200, offset: 0, next_offset: null };
  }
  return { items: [], total: 0, limit: 10, offset: 0, next_offset: null };
};
const rejectExecutor = adminContract.createConfirmedJoinReviewExecutor(
  (authority, nextStatus) => adminContract.executeJoinReviewTransaction(authority, nextStatus, {
    request: rejectRequest,
    requestId: rejectRequestId,
    baseUrl: 'https://admin-reject.example',
    listParams: { status: 'pending', limit: 10, offset: 0 },
    isAmbiguous: () => false,
  }),
);
assert.equal((await rejectExecutor.submit(rejectedAuthority, 'approved')).kind, 'confirmation');
assert.equal((await rejectExecutor.submit(rejectedAuthority, 'rejected')).kind, 'confirmation', 'changed decision must invalidate the first confirmation');
assert.equal(rejectCalls.length, 0);
const rejectedExecution = await rejectExecutor.submit(rejectedAuthority, 'rejected');
assert.equal(rejectedExecution.kind, 'sent');
assert.equal(rejectCalls.filter((call) => call.options.method === 'PATCH').length, 1);
assert.equal(rejectCalls.some((call) => call.pathname.endsWith('/members/page')), false);
assert.equal(rejectedExecution.value.readback.member, null);

let failedReadbackPatchCount = 0;
await assert.rejects(
  adminContract.executeJoinReviewTransaction(joinAuthority, 'approved', {
    requestId: 'admin-join-readback-failure',
    baseUrl: 'https://admin-failure.example',
    listParams: { status: 'pending', limit: 10, offset: 0 },
    isAmbiguous: () => false,
    request: async (pathname, options = {}) => {
      if (options.method === 'PATCH') {
        failedReadbackPatchCount += 1;
        return reviewedJoin;
      }
      if (pathname === '/api/admin/stats') return { pending_class_join_requests: 'not-authority' };
      if (pathname.endsWith('/members/page')) {
        return {
          items: [{ class_id: 12, user_id: 44, role: 'student', status: 'active' }],
          total: 1,
          limit: 200,
          offset: 0,
          next_offset: null,
        };
      }
      if (pathname === '/api/admin/audit-logs') return joinResult.readback.audit;
      if (options.params.status === 'approved') {
        return { items: [reviewedJoin], total: 1, limit: 200, offset: 0, next_offset: null };
      }
      return { items: [], total: 0, limit: 10, offset: 0, next_offset: null };
    },
  }),
  (error) => error.joinReviewUnknown === true && /必要回读/.test(error.message),
);
assert.equal(failedReadbackPatchCount, 1, 'a failed necessary readback must never retry the PATCH');
assert.match(admin, /reconcileJoinReviewWrite\(state\.writeLock\)/);
assert.match(admin, /写锁保持，系统不会自动重发 PATCH/);

assert.equal(adminContract.courseWriteBlocked({ mutationCourseId: 0, lockCount: 0, lockedCourseIds: [] }), false);
assert.equal(adminContract.courseWriteBlocked({ mutationCourseId: 9, lockCount: 0, lockedCourseIds: [] }), true);
assert.equal(adminContract.courseWriteBlocked({ mutationCourseId: 0, lockCount: 1, lockedCourseIds: [9] }), true);
assert.equal(adminContract.courseWriteBlocked({ mutationCourseId: 0, lockCount: 0, lockedCourseIds: [9] }), true);
assert.match(admin, /if \(state\.busy \|\| state\.writeLock \|\| courseWriteBlocked\(\)\)/);
assert.match(admin, /control\.disabled = state\.busy \|\| Boolean\(state\.writeLock\) \|\| courseBlocked/);
assert.match(admin, /control\.disabled = state\.busy \|\| courseBlocked/);
assert.match(admin, /if \(courseWriteBlocked\(courseState\)\)/);
assert.match(admin, /onWriteStateChange:\s*applyAdminWriteAvailability/);
assert.match(admin, /AdminCourseGovernance\.invalidateContext\(\)/);

const shell = adminContract.governanceShellMarkup();
const ids = Array.from(shell.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'rendered governance shell must not contain duplicate ids');
const tabControls = Array.from(
  shell.matchAll(/<button[^>]*role="tab"[^>]*aria-controls="([^"]+)"/g),
  (match) => match[1],
);
const expectedTabpanels = [
  'admin-domain-overview',
  'admin-domain-organizations',
  'admin-domain-identity',
  'admin-domain-classes',
  'admin-domain-courses',
  'admin-domain-audit',
];
assert.deepEqual(tabControls.slice().sort(), expectedTabpanels.slice().sort());
for (const targetId of tabControls) {
  assert.equal(ids.filter((id) => id === targetId).length, 1, `${targetId} must resolve exactly once`);
  const target = shell.match(new RegExp(`<[^>]+id="${targetId}"[^>]*>`));
  assert.ok(target && /role="tabpanel"/.test(target[0]), `${targetId} must resolve to a tabpanel`);
}

for (const section of ['overview', 'organizations', 'identity', 'classes', 'courses', 'audit']) {
  assert.match(admin, new RegExp(`id: '${section}'`), `missing governance domain: ${section}`);
}
assert.match(admin, /role="tablist"/);
assert.match(admin, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
assert.match(admin, /AdminCourseGovernance\.activate/);
assert.match(admin, /AdminSecondaryGovernance\.open/);

const initBody = admin.match(/function initAdmin\(\) \{([\s\S]*?)\n    function destroyAdmin/);
assert.ok(initBody);
assert.doesNotMatch(initBody[1], /mountOwnerModules\(/, 'owners must not mount before /api/users/me');
assert.doesNotMatch(initBody[1], /ensureOwnerModules\(/, 'owner scripts must not load before /api/users/me');
const refreshAllBody = admin.match(/async function refreshAll\(options\) \{([\s\S]*?)\n    async function refreshStats/);
assert.ok(refreshAllBody, 'refreshAll must remain inspectable');
const roleAuthority = refreshAllBody[1].indexOf("user.role !== 'admin'");
const ownerLoad = refreshAllBody[1].indexOf('await ensureOwnerModules()');
const ownerMount = refreshAllBody[1].indexOf('if (!mountOwnerModules()');
assert.ok(
  roleAuthority >= 0 && ownerLoad > roleAuthority && ownerMount > ownerLoad,
  'owner scripts load and mount only after admin role authority',
);
assert.doesNotMatch(refreshAllBody[1], /refreshSummaries|PANEL_CONFIGS\.map/);
assert.doesNotMatch(refreshAllBody[1], /\/api\/health/, 'health is an advanced on-entry request');
assert.match(admin, /healthPath:\s*'\/api\/health'/);
assert.match(secondary, /id:\s*'health'[\s\S]*pathKey:\s*'healthPath'/);

for (const advancedPath of [
  '/api/admin/content/script-assets',
  '/api/admin/content/script-host-policies',
  '/api/admin/knowledge-snapshot-runs',
  '/api/admin/alert-outbox',
  '/api/admin/bugs',
]) {
  const escaped = advancedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.doesNotMatch(refreshAllBody[1], new RegExp(escaped));
  assert.match(secondary, new RegExp(escaped));
}
const secondaryMount = secondary.match(/function mount\(host, context\) \{([\s\S]*?)\n    function destroy/);
assert.ok(secondaryMount);
assert.doesNotMatch(secondaryMount[1], /request\(|loadGroup\(/, 'secondary mount must issue zero requests');
const secondaryReset = secondary.match(/function resetAuthorityContext\(renderAfter\) \{([\s\S]*?)\n    \}/);
assert.ok(secondaryReset);
const secondaryDestroy = secondary.match(/function destroy\(\) \{([\s\S]*?)\n    global\.AdminSecondaryGovernance/);
assert.ok(secondaryDestroy);
for (const reset of [
  /state\.activeGroup = 'more'/,
  /state\.loaded\.clear\(\)/,
  /state\.data = Object\.create\(null\)/,
  /state\.errors = Object\.create\(null\)/,
]) {
  assert.match(secondaryReset[1], reset, 'secondary reset must clear cross-Base/session cache');
}
assert.match(secondaryDestroy[1], /resetAuthorityContext\(false\)/);
const baseChangeBody = admin.match(/const apiInput = event\.target\.closest\('\[data-admin-api-base\]'\);([\s\S]*?)\n            const form/);
assert.ok(baseChangeBody);
const secondaryInvalidation = baseChangeBody[1].indexOf('AdminSecondaryGovernance.invalidateContext()');
const baseAssignment = baseChangeBody[1].indexOf('state.apiBase = normalizeApiBase');
assert.ok(
  secondaryInvalidation >= 0 && baseAssignment > secondaryInvalidation,
  'secondary authority must reset before the API Base changes',
);

class SecondaryElement {}
class SecondaryDialog {
  constructor() {
    this.open = false;
  }

  showModal() {
    this.open = true;
  }

  setAttribute(name) {
    if (name === 'open') this.open = true;
  }

  removeAttribute(name) {
    if (name === 'open') this.open = false;
  }

  close() {
    this.open = false;
  }

  querySelector() {
    return null;
  }
}
class SecondaryHost extends SecondaryElement {
  constructor() {
    super();
    this.listeners = Object.create(null);
    this._innerHTML = '';
    this.dialog = null;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.dialog = new SecondaryDialog();
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    return selector === '[data-admin-secondary-dialog]' ? this.dialog : null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  removeEventListener(type) {
    delete this.listeners[type];
  }
}
class OverviewHost extends SecondaryElement {
  constructor() {
    super();
    this.innerHTML = '';
  }
}
const secondaryRequests = [];
const deferredSecondaryRequests = [];
const secondaryTechnicalAudit = (id) => ({
  id,
  action: 'admin.alert_outbox.list',
  resource: `admin_alert_outbox:${id}`,
  resource_type: 'admin_alert_outbox',
  resource_id: String(id),
});
let secondaryApiBase = 'https://secondary-old.example';
let deferOldAdvanced = false;
let overviewFailurePath = '';
let secondaryBusinessAudit = {
  id: 326,
  action: 'class.join',
  resource: 'class_membership:91',
  resource_type: 'class_membership',
  resource_id: '91',
  request_id: 'overview-class-join-at-26',
};
const secondaryWindow = {
  AbortController,
  AstraApiClient: {
    request: (pathname, options = {}) => {
      const baseUrl = options.baseUrl;
      secondaryRequests.push({ pathname, baseUrl, params: options.params || null });
      if (deferOldAdvanced && baseUrl === 'https://secondary-old.example') {
        return new Promise((resolve) => {
          deferredSecondaryRequests.push({ pathname, baseUrl, params: options.params || null, resolve });
        });
      }
      if (overviewFailurePath === pathname) {
        const error = new Error(`403 forbidden: ${pathname}`);
        error.status = 403;
        return Promise.reject(error);
      }
      if (pathname === '/api/courses') {
        return Promise.resolve([
          { id: 1, status: 'draft' },
          { id: 2, status: 'draft' },
          { id: 3, status: 'published' },
          { id: 4, status: 'archived' },
        ]);
      }
      if (pathname === '/api/admin/audit-logs') {
        if (options.params.offset === 0) {
          return Promise.resolve({
            items: Array.from({ length: 25 }, (_, index) => secondaryTechnicalAudit(300 + index)),
            total: 26,
            limit: 25,
            offset: 0,
            next_offset: 25,
          });
        }
        return Promise.resolve({
          items: [{ ...secondaryBusinessAudit }],
          total: 26,
          limit: 25,
          offset: 25,
          next_offset: null,
        });
      }
      const overviewTotals = {
        '/api/admin/class-join-requests:pending': 0,
        '/api/admin/users:disabled': 2,
        '/api/admin/schools:active': 3,
        '/api/admin/schools:archived': 1,
        '/api/admin/classes:active': 4,
        '/api/admin/classes:archived': 2,
      };
      const overviewKey = `${pathname}:${options.params && options.params.status || ''}`;
      if (Object.prototype.hasOwnProperty.call(overviewTotals, overviewKey)) {
        return Promise.resolve({ items: [], total: overviewTotals[overviewKey] });
      }
      return Promise.resolve({
        items: [{ id: pathname, title: `authority:${baseUrl}:${pathname}` }],
        total: 1,
      });
    },
    message: (error) => error.message,
  },
  requestAnimationFrame: (callback) => {
    callback();
    return 1;
  },
  cancelAnimationFrame: () => {},
};
const secondaryContext = {
  window: secondaryWindow,
  Element: SecondaryElement,
  AbortController,
};
vm.runInNewContext(secondary, secondaryContext, {
  filename: 'pages/admin/admin-secondary-governance.js',
});
const secondaryOwner = secondaryWindow.AdminSecondaryGovernance;
const secondaryHost = new SecondaryHost();
const overviewHost = new OverviewHost();
assert.equal(secondaryOwner.mount(secondaryHost, {
  getApiBase: () => secondaryApiBase,
  refreshIcons: () => {},
  overviewHost,
  healthPath: '/api/health',
}), true);
assert.equal(secondaryRequests.length, 0, 'secondary mount must prefetch neither business overview nor advanced diagnostics');
assert.equal(await secondaryOwner.loadOverview({ force: true }), true);
assert.equal(secondaryOwner.snapshot().overviewLoaded, true);
assert.match(overviewHost.innerHTML, /data-admin-business-overview-state="ready"/);
assert.match(overviewHost.innerHTML, /data-admin-overview-kind="pending-relationships"[\s\S]*data-admin-overview-total>0</);
assert.match(overviewHost.innerHTML, /data-admin-overview-kind="disabled-accounts"[\s\S]*data-admin-overview-total>2</);
assert.match(overviewHost.innerHTML, /data-admin-organization-summary-kind="schools"[\s\S]*data-admin-overview-active>3<[\s\S]*data-admin-overview-archived>1</);
assert.match(overviewHost.innerHTML, /data-admin-organization-summary-kind="classes"[\s\S]*data-admin-overview-active>4<[\s\S]*data-admin-overview-archived>2</);
assert.match(overviewHost.innerHTML, /data-admin-course-status="draft">2<[\s\S]*data-admin-course-status="published">1<[\s\S]*data-admin-course-status="archived">1</);
assert.match(overviewHost.innerHTML, /class\.join[\s\S]*overview-class-join-at-26/);
assert.doesNotMatch(overviewHost.innerHTML, /admin\.alert_outbox\.list/);
assert.deepEqual(
  secondaryRequests.filter((call) => call.pathname === '/api/admin/audit-logs').map((call) => call.params.offset),
  [0, 25],
  'overview must find a business audit at record 26 with bounded paging',
);
secondaryBusinessAudit = {
  id: 326,
  action: 'class.member.status.batch_update',
  resource: 'class_membership_batch:12',
  resource_type: 'class_membership_batch',
  resource_id: '12',
  request_id: 'overview-membership-batch-at-26',
};
const batchAuditRequestStart = secondaryRequests.length;
assert.equal(await secondaryOwner.loadOverview({ force: true }), true);
assert.deepEqual(
  secondaryRequests.slice(batchAuditRequestStart)
    .filter((call) => call.pathname === '/api/admin/audit-logs')
    .map((call) => call.params.offset),
  [0, 25],
  'batch membership governance at record 26 must use the same bounded business-audit paging',
);
assert.match(overviewHost.innerHTML, /class\.member\.status\.batch_update[\s\S]*overview-membership-batch-at-26/);
for (const advancedPath of [
  '/api/health',
  '/api/admin/content/drafts',
  '/api/admin/content/script-assets',
  '/api/admin/content/script-host-policies',
  '/api/admin/knowledge-snapshot-runs',
  '/api/admin/alert-outbox',
  '/api/admin/bugs',
]) {
  assert.equal(
    secondaryRequests.some((call) => call.pathname === advancedPath),
    false,
    `overview must not prefetch secondary/advanced resource ${advancedPath}`,
  );
}
overviewFailurePath = '/api/admin/users';
assert.equal(await secondaryOwner.loadOverview({ force: true }), false);
assert.match(overviewHost.innerHTML, /data-admin-business-overview-state="partial"/);
assert.match(overviewHost.innerHTML, /data-admin-overview-kind="disabled-accounts"[\s\S]*读取失败：403 forbidden/);
assert.match(overviewHost.innerHTML, /当前没有待审关系/);
overviewFailurePath = '';
assert.equal(await secondaryOwner.loadOverview({ force: true }), true);
const clickSecondaryTab = (groupId) => {
  secondaryHost.listeners.click({
    target: {
      closest: (selector) => selector === '[data-admin-secondary-tab]'
        ? { dataset: { adminSecondaryTab: groupId } }
        : null,
    },
  });
};
const flushSecondary = () => new Promise((resolve) => setImmediate(resolve));
clickSecondaryTab('more');
await flushSecondary();
assert.match(secondaryHost.innerHTML, /<h2 id="admin-secondary-title">更多治理<\/h2>/);
assert.match(secondaryHost.innerHTML, /data-admin-secondary-resource="content-drafts"/);
assert.match(secondaryHost.innerHTML, /authority:https:\/\/secondary-old\.example/);
clickSecondaryTab('advanced');
await flushSecondary();
assert.equal(secondaryOwner.snapshot().activeGroup, 'advanced');
assert.match(secondaryHost.innerHTML, /<h2 id="admin-secondary-title">高级诊断<\/h2>/);
assert.match(secondaryHost.innerHTML, /data-admin-secondary-resource="health"/);
const requestsBeforeCachedReturn = secondaryRequests.length;
clickSecondaryTab('more');
assert.equal(secondaryOwner.snapshot().activeGroup, 'more');
assert.equal(secondaryRequests.length, requestsBeforeCachedReturn, 'cached return must not refetch the group');
assert.match(secondaryHost.innerHTML, /<h2 id="admin-secondary-title">更多治理<\/h2>/);
assert.match(secondaryHost.innerHTML, /data-admin-secondary-resource="content-drafts"/);
assert.doesNotMatch(secondaryHost.innerHTML, /data-admin-secondary-resource="health"/);
assert.equal(secondaryOwner.invalidateContext(), true);
assert.deepEqual(Array.from(secondaryOwner.snapshot().loadedGroups), []);
assert.deepEqual(Array.from(secondaryOwner.snapshot().dataKeys), []);
assert.equal(secondaryOwner.snapshot().activeGroup, 'more');
assert.equal(secondaryOwner.snapshot().dialogOpen, false);
assert.equal(secondaryOwner.snapshot().overviewLoaded, false);
assert.deepEqual(Array.from(secondaryOwner.snapshot().overviewDataKeys), []);
assert.match(overviewHost.innerHTML, /data-admin-business-overview-state="loading"/);
assert.doesNotMatch(secondaryHost.innerHTML, /authority:https:\/\/secondary-old\.example/);

deferOldAdvanced = true;
clickSecondaryTab('advanced');
assert.ok(deferredSecondaryRequests.length > 0, 'old Base advanced reads must be in flight for the late-response test');
const lateOldOverview = secondaryOwner.loadOverview({ force: true });
assert.ok(
  deferredSecondaryRequests.some((call) => call.pathname === '/api/courses'),
  'old Base business overview reads must also be in flight for authority-generation proof',
);
secondaryApiBase = 'https://secondary-new.example';
assert.equal(secondaryOwner.invalidateContext(), true);
deferOldAdvanced = false;
const newBaseRequestStart = secondaryRequests.length;
clickSecondaryTab('more');
const newOverview = secondaryOwner.loadOverview({ force: true });
await Promise.all([flushSecondary(), newOverview]);
const newBaseRequests = secondaryRequests.slice(newBaseRequestStart);
assert.ok(
  newBaseRequests.some((call) => (
    call.pathname === '/api/admin/content/drafts'
    && call.baseUrl === 'https://secondary-new.example'
  )),
  'a group loaded on the old Base must request authority again on the new Base',
);
assert.ok(
  newBaseRequests.some((call) => (
    call.pathname === '/api/courses'
    && call.baseUrl === 'https://secondary-new.example'
  )),
  'new Base business overview must request fresh course authority',
);
for (const advancedPath of [
  '/api/health',
  '/api/admin/content/script-assets',
  '/api/admin/content/script-host-policies',
  '/api/admin/knowledge-snapshot-runs',
  '/api/admin/alert-outbox',
  '/api/admin/bugs',
]) {
  assert.equal(
    newBaseRequests.some((call) => call.pathname === advancedPath),
    false,
    `advanced diagnostics must remain zero-prefetch after Base reset: ${advancedPath}`,
  );
}
assert.match(secondaryHost.innerHTML, /authority:https:\/\/secondary-new\.example/);
for (const pending of deferredSecondaryRequests) {
  if (pending.pathname === '/api/courses') {
    pending.resolve([{ id: 99, status: 'draft', title: 'OLD OVERVIEW AUTHORITY' }]);
  } else if (pending.pathname === '/api/admin/audit-logs') {
    pending.resolve({
      items: [{
        id: 399,
        action: 'course.status.patch',
        resource: 'course:99',
        resource_type: 'course',
        resource_id: '99',
        request_id: 'old-overview-audit',
      }],
      total: 1,
      limit: 25,
      offset: 0,
    });
  } else {
    pending.resolve({
      items: [{ id: pending.pathname, title: `authority:${pending.baseUrl}:${pending.pathname}` }],
      total: 99,
    });
  }
}
assert.equal(await lateOldOverview, false, 'late old-Base overview settlement must fail the generation check');
await flushSecondary();
assert.equal(secondaryOwner.snapshot().activeGroup, 'more');
assert.match(secondaryHost.innerHTML, /authority:https:\/\/secondary-new\.example/);
assert.doesNotMatch(secondaryHost.innerHTML, /authority:https:\/\/secondary-old\.example/);
assert.match(overviewHost.innerHTML, /data-admin-business-overview-state="ready"/);
assert.match(overviewHost.innerHTML, /data-admin-overview-kind="disabled-accounts"[\s\S]*data-admin-overview-total>2</);
assert.doesNotMatch(overviewHost.innerHTML, /OLD OVERVIEW AUTHORITY|old-overview-audit|>99</);
secondaryOwner.destroy();

assert.match(course, /headers:\s*\{\s*'X-Request-ID': requestId\s*\}/);
assert.match(course, /method:\s*'PATCH'/);
assert.match(course, /beginRead/);
assert.match(course, /beginMutation/);
assert.match(course, /beginReconcile/);
assert.match(course, /if \(mutationBusy\(\)\) return/);
assert.match(course, /const disabled = courseRowDisabled\(course\.id, state\.selectedId\)/);
assert.match(course, /guardedCourseSelection\(state\.selectedId, courseId\)/);
assert.match(course, /state\.locks\.has\(Number\(course\.id\)\)[\s\S]*Number\(state\.selectedId\)\) return true/);
assert.match(course, /function invalidateContext\(\)[\s\S]*state\.controllers\.invalidate\('read'\)[\s\S]*resetCourseContext\(state\)/);
assert.match(course, /!course \|\| !state\.editor \|\| courseWriteBlocked\(\)/);
assert.match(course, /data-admin-course-refresh[\s\S]*if \(courseWriteBlocked\(\)\) return/);
assert.match(course, /createConfirmedMutationExecutor\(commitCourse,[\s\S]*\(\) => !courseWriteBlocked\(\)/);
assert.match(course, /operation\.checkpoint[\s\S]*离页时精确审计待确认/);
assert.match(course, /离页时写入结果未知/);
assert.doesNotMatch(course, /students? affected/i);
assert.match(course, /不表示“受影响学生人数”/);
assert.match(course, /removeEventListener/);
assert.match(course, /cancelAnimationFrame/);
assert.match(admin, /data-admin-business-overview[\s\S]*data-admin-stats[\s\S]*data-admin-database-map/);
assert.match(admin, /refreshStats\(generation\), AdminSecondaryGovernance\.loadOverview\(\{ force \}\)/);
assert.match(secondary, /pending-relationships[\s\S]*disabled-accounts[\s\S]*active-schools[\s\S]*archived-schools[\s\S]*courses[\s\S]*recent-audit/);
assert.match(secondary, /data-admin-organization-summary-kind="\$\{kind\}"/);
assert.match(secondary, /data-admin-course-status-summary/);
assert.match(secondary, /data-admin-recent-audit/);

assert.match(styles, /\.admin-course-grid\s*\{[\s\S]*grid-template-columns:/);
assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.admin-course-dialog\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100dvh/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /\.admin-course-filters input,[\s\S]*min-height:\s*44px/);
assert.equal(
  Array.from(styles.matchAll(/\.astra-sessions\s+button/g)).length,
  1,
  'admin styles must keep exactly one page-scoped activity-session button rule',
);
assert.match(
  styles,
  /\.admin-auth-state\s+\.astra-sessions\s+button\s*\{\s*min-height:\s*44px;\s*\}/,
  'admin activity-session actions must keep a page-scoped 44px minimum touch height',
);
assert.equal(
  canonicalSha256('first\r\nsecond\rthird\n'),
  canonicalSha256('first\nsecond\nthird\n'),
  'canonical content SHA-256 must be identical for CRLF, isolated CR, and LF input',
);
assert.equal(
  canonicalSha256(sharedAuthStyles),
  '17d959562c5123eac765d3143d0a23933df10a40d6869b41f1b1ca24d9ca99c7',
  'the shared auth-ui stylesheet must keep its V8.4.0 teacher-application canonical content SHA-256',
);
assert.equal(
  canonicalSha256(sharedAuthRuntime),
  '27215dcce9c6f132fd50b09291240e40b09bfcf31accdb0de5781bef1bb4e6f6',
  'the shared auth-ui runtime must keep its V8.6.1 presentation-cleanup canonical content SHA-256',
);

const lineCount = admin.replace(/\r\n?/g, '\n').split('\n').length - (admin.endsWith('\n') ? 1 : 0);
assert.ok(lineCount <= 2485, `admin.js must not grow beyond the frozen ceiling (${lineCount})`);

console.log('admin-governance-workflow-contract: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

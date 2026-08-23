#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const {
  PROVENANCE_ASSURANCE,
  PROVENANCE_LIMITATION,
  PROVENANCE_SCHEMA_VERSION,
  QA016_PROVENANCE_VERIFIER,
  VERIFIER_ID,
  VERIFIER_VERSION,
  clone: cloneJson,
  verifyProvenanceEnvelope,
} = require('./qa016-provenance-verifier.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_REVISION = 'aec0587f643190e2c435ff88945d4f9066dd5316';
const ISSUE_IDS = Object.freeze([
  'FUTURE-01',
  'FUTURE-02',
  'TEACH-01',
  'CODE-01',
  'MECH-01',
  'DEMO-01',
]);

const ISSUE_CONTRACTS = Object.freeze({
  'FUTURE-01': Object.freeze({
    owner: 'FE-024',
    preconditions: [
      '学生拥有一门 open Future 活动。',
      '进入活动后不触发任何学生输入、变量变化或观察确认。',
    ],
    steps: [
      '选中一个判断答案。',
      '直接触发 data-fg-submit。',
      '检查本地反馈、输入事件和活动状态。',
    ],
    expected: '未产生有效变量变化和观察快照时，判断提交必须被阻止。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
  'FUTURE-02': Object.freeze({
    owner: 'FE-024',
    preconditions: [
      '学生拥有一门 open Future 活动。',
      '捕获 fetch、学习证据客户端和学习领域命令。',
    ],
    steps: [
      '选中正确判断。',
      '触发 data-fg-submit。',
      '核对反馈变化、网络请求和权威证据命令。',
    ],
    expected: '判断必须形成可由教师回读的权威学习证据，而不只是修改本地反馈文本。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
  'TEACH-01': Object.freeze({
    owner: 'FE-023',
    preconditions: [
      '同一班级至少有 Physics 与其他课程。',
      '其他课程存在 submitted 待批改项，当前选择 Physics。',
    ],
    steps: [
      '加载教师 class scope。',
      '记录 pending 请求参数和响应课程集合。',
      '渲染待批改队列并检查非 Physics 行。',
    ],
    expected: '选择 Physics 后，pending 请求必须携带 course_id，DOM 只能包含 Physics。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
  'CODE-01': Object.freeze({
    owner: 'BE-014',
    preconditions: [
      '同一学生、班级和题目版本已有一次正式提交。',
      '第二次提交使用不同源码。',
    ],
    steps: [
      '读取第一次提交和源码摘要。',
      '向同一题目版本 POST 修改后的源码。',
      '读取响应、code_submissions 和 code_judge_attempts。',
    ],
    expected: '不同源码的第二次学生修订应创建第二条 submission；网络重放才返回原提交。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
  'MECH-01': Object.freeze({
    owner: 'FE-025',
    preconditions: [
      '打开已经恢复为独立实验的力学模拟页面。',
      '页面尚未注入课程步骤、预测门槛或学习证据面板。',
    ],
    steps: [
      '检查原有参数控件、操作按钮和画布是否仍然存在。',
      '检查页面与实验脚本是否重新出现课程化标记。',
      '直接调用原有发射操作并检查小球是否进入模拟。',
    ],
    expected: '力学模拟保持原有直接操作方式，不依赖课程步骤、预测提交或学习证据。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
  'DEMO-01': Object.freeze({
    owner: 'PM（建立 DATA 后续任务）',
    preconditions: [
      '使用全新仓库外 SQLite 数据目录。',
      '仅执行一次正式演示初始化，学生尚未进行现场学习。',
    ],
    steps: [
      '运行 initialize_demo_data。',
      '读取初始化响应中的 representative_evidence。',
      '查询学习证据事件和活动投影。',
    ],
    expected: '全新演示学生应默认为 not_started，不应在首次学习前具有 completed 投影。',
    command: 'node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python',
  }),
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function rawRecord(issueId, channel, sourceKind, data, capturedAt = new Date().toISOString()) {
  return {
    source_id: `qa016-${issueId.toLowerCase()}-${channel}`,
    source_kind: sourceKind,
    captured_at: capturedAt,
    payload: {
      issue_id: issueId,
      channel,
      data: cloneJson(data),
    },
  };
}

function notExecutedObservation(issueId) {
  const capturedAt = new Date().toISOString();
  return {
    defect_observed: false,
    actual: 'frontend-only mode: not executed',
    request_response: { status: 'NOT_EXECUTED' },
    database_or_state_evidence: { status: 'NOT_EXECUTED' },
    raw_records: [rawRecord(issueId, 'not-executed-state', 'state', {
      status: 'NOT_EXECUTED',
    }, capturedAt)],
  };
}

function classifyObservations(observations) {
  const issues = {};
  for (const issueId of ISSUE_IDS) {
    const observation = observations[issueId];
    if (!observation || typeof observation.defect_observed !== 'boolean') {
      throw new Error(`missing boolean observation for ${issueId}`);
    }
    issues[issueId] = {
      defect_observed: observation.defect_observed,
      baseline_assertion: observation.defect_observed ? 'PASS' : 'FAIL',
      desired_gate: observation.defect_observed ? 'FAIL' : 'PASS',
    };
  }
  return {
    issues,
    all_expected_defects_observed: ISSUE_IDS.every((issueId) => issues[issueId].defect_observed),
    desired_gate_passed: ISSUE_IDS.every((issueId) => !issues[issueId].defect_observed),
  };
}

function selfTest() {
  const defective = Object.fromEntries(ISSUE_IDS.map((issueId) => [issueId, { defect_observed: true }]));
  const repaired = Object.fromEntries(ISSUE_IDS.map((issueId) => [issueId, { defect_observed: false }]));
  const defectiveResult = classifyObservations(defective);
  const repairedResult = classifyObservations(repaired);
  assert.equal(defectiveResult.all_expected_defects_observed, true);
  assert.equal(defectiveResult.desired_gate_passed, false);
  assert.equal(repairedResult.all_expected_defects_observed, false);
  assert.equal(repairedResult.desired_gate_passed, true);
  for (const issueId of ISSUE_IDS) {
    assert.equal(defectiveResult.issues[issueId].baseline_assertion, 'PASS');
    assert.equal(defectiveResult.issues[issueId].desired_gate, 'FAIL');
    assert.equal(repairedResult.issues[issueId].baseline_assertion, 'FAIL');
    assert.equal(repairedResult.issues[issueId].desired_gate, 'PASS');
    assert.ok(ISSUE_CONTRACTS[issueId]);
  }
  const scopedTeacherFacts = {
    selected_class_id: 11,
    selected_course_id: 101,
    selected_course_title: 'Physics',
    request_class_id: '11',
    request_course_id: '101',
    raw_response_course_ids: [101, 202],
    accepted_state_course_ids: [],
    foreign_course_row_rendered: false,
  };
  const scopedEvaluation = evaluateTeacherObservationFacts(scopedTeacherFacts);
  assert.equal(scopedEvaluation.defect_observed, false);
  assert.equal(scopedEvaluation.historical_issue_defect_observed, false);
  assert.equal(scopedEvaluation.controlled_positive_defect_observed, false);
  const missingCourseEvaluation = evaluateTeacherObservationFacts({
    ...scopedTeacherFacts,
    request_course_id: null,
    evaluation_semantic: 'controlled_positive',
  });
  assert.equal(missingCourseEvaluation.defect_observed, true);
  assert.equal(missingCourseEvaluation.historical_issue_defect_observed, false);
  const mixedRowsEvaluation = evaluateTeacherObservationFacts({
    ...scopedTeacherFacts,
    accepted_state_course_ids: [101, 202],
    foreign_course_row_rendered: true,
    evaluation_semantic: 'controlled_positive',
  });
  assert.equal(mixedRowsEvaluation.defect_observed, true);
  assert.equal(mixedRowsEvaluation.historical_issue_defect_observed, false);
  const historicalCombinationEvaluation = evaluateTeacherObservationFacts({
    ...scopedTeacherFacts,
    request_course_id: null,
    accepted_state_course_ids: [101, 202],
    foreign_course_row_rendered: true,
  });
  assert.equal(historicalCombinationEvaluation.defect_observed, true);
  assert.equal(historicalCombinationEvaluation.historical_issue_defect_observed, true);
  return {
    status: 'PASS',
    checks: [
      'six issue identifiers are complete and unique',
      'defective synthetic observations pass the baseline assertion and fail the desired gate',
      'repaired synthetic observations fail the old baseline assertion and pass the desired gate',
      'every issue has owner, preconditions, steps, expected result, and rerun command',
      'TEACH-01 keeps the historical conjunction while controlled positives expose each sub-fact',
    ],
  };
}

class FakeElement {
  constructor(properties = {}) {
    this._listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    Object.assign(this, properties);
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const listeners = this._listeners.get(type) || [];
    this._listeners.set(type, listeners.filter((candidate) => candidate !== handler));
  }

  click() {
    for (const handler of this._listeners.get('click') || []) {
      handler({ currentTarget: this, target: this, preventDefault() {} });
    }
  }

  focus() {}

  closest() { return null; }
}

function probeFuture() {
  const source = read('shared/js/frontier-learning.js');
  const exposed = source
    .replace(
      /        mountVisual\(\);\r?\n    }\r?\n\r?\n    function render\(requestedPage\)/,
      '        if (!global.__qa016SkipVisual) mountVisual();\n    }\n\n    function render(requestedPage)',
    )
    .replace(
      '    Object.assign(FrontierLearning, {',
      '    global.__qa016FrontierTest = Object.freeze({ wireCourse });\n\n    Object.assign(FrontierLearning, {',
    );
  assert.notEqual(exposed, source, 'Future QA instrumentation must apply');

  const submit = new FakeElement();
  const feedback = new FakeElement();
  const selected = new FakeElement({ dataset: { fgCorrect: 'true' } });
  const stage = new FakeElement({ isConnected: true });
  const networkCalls = [];
  const evidenceCalls = [];
  const domainEvents = [];
  const mount = {
    querySelector(selector) {
      if (selector === '[data-fg-submit]') return submit;
      if (selector === '[data-fg-feedback]') return feedback;
      if (selector === '[data-fg-stage]') return stage;
      if (selector === 'input[name="fg-answer-1"]:checked') return selected;
      return null;
    },
  };
  const context = {
    AbortController,
    console: { log() {}, warn() {}, error() {} },
    document: {},
    Event,
    URL,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.__qa016SkipVisual = true;
  context.addEventListener = () => {};
  context.fetch = (...args) => { networkCalls.push(args); return Promise.resolve({ ok: true }); };
  context.dispatchEvent = (event) => { domainEvents.push(event); return true; };
  context.AstraLearningEvidenceClient = new Proxy({}, {
    get() {
      return (...args) => { evidenceCalls.push(args); return Promise.resolve({}); };
    },
  });
  vm.createContext(context);
  vm.runInContext(exposed, context, { filename: 'shared/js/frontier-learning.js' });

  const runtime = { id: 1, mount, abort: new AbortController(), visual: null };
  const route = {
    course: { course_key: 'qa016-course' },
    activity: { activity_key: 'qa016.future', kind: 'canvas', title: 'QA-016 Future', decision: '判断证据' },
  };
  context.__qa016FrontierTest.wireCourse(runtime, route);
  const feedbackBefore = feedback.textContent;
  const submitDisabledBefore = submit.disabled;
  submit.click();
  const acceptedLocally = /观察支持/.test(feedback.textContent);
  const capturedAt = new Date().toISOString();

  return {
    'FUTURE-01': {
      defect_observed: acceptedLocally && submitDisabledBefore === false,
      actual: '零变量变化、零观察确认时，正确选项仍直接得到“观察支持”的本地成功反馈。',
      request_response: {
        action: 'click [data-fg-submit]',
        response: feedback.textContent,
        response_before: feedbackBefore,
      },
      database_or_state_evidence: {
        user_input_change_count: 0,
        observation_checkpoint_count: 0,
        submit_disabled_before_click: submitDisabledBefore,
        accepted_locally: acceptedLocally,
      },
      raw_records: [
        rawRecord('FUTURE-01', 'submit-action', 'request', {
          action: 'click [data-fg-submit]',
        }, capturedAt),
        rawRecord('FUTURE-01', 'interaction-state', 'state', {
          user_input_change_count: 0,
          observation_checkpoint_count: 0,
          submit_disabled_before_click: submitDisabledBefore,
        }, capturedAt),
        rawRecord('FUTURE-01', 'feedback-dom', 'dom', {
          response_before: feedbackBefore,
          response: feedback.textContent,
        }, capturedAt),
      ],
    },
    'FUTURE-02': {
      defect_observed: acceptedLocally && networkCalls.length === 0 && evidenceCalls.length === 0 && domainEvents.length === 0,
      actual: '判断只修改 data-fg-feedback；没有网络写入、证据客户端调用或学习领域命令。',
      request_response: {
        action: 'click [data-fg-submit]',
        local_response: feedback.textContent,
        network_request_count: networkCalls.length,
        learning_evidence_client_call_count: evidenceCalls.length,
        learning_domain_command_count: domainEvents.length,
      },
      database_or_state_evidence: {
        authoritative_event_created: false,
        teacher_readback_possible_from_this_action: false,
      },
      raw_records: [
        rawRecord('FUTURE-02', 'submit-action', 'request', {
          action: 'click [data-fg-submit]',
        }, capturedAt),
        rawRecord('FUTURE-02', 'write-channels', 'response', {
          network_request_count: networkCalls.length,
          learning_evidence_client_call_count: evidenceCalls.length,
          learning_domain_command_count: domainEvents.length,
        }, capturedAt),
        rawRecord('FUTURE-02', 'feedback-dom', 'dom', {
          local_response: feedback.textContent,
        }, capturedAt),
      ],
    },
  };
}

function evaluateTeacherObservationFacts(facts) {
  if (!facts || typeof facts !== 'object') throw new Error('missing TEACH-01 observation facts');
  const selectedClassId = String(facts.selected_class_id || '');
  const selectedCourseId = String(facts.selected_course_id || '');
  const requestClassId = String(facts.request_class_id || '');
  const requestCourseId = String(facts.request_course_id || '');
  const requestClassIdPresent = typeof facts.request_class_id_present === 'boolean'
    ? facts.request_class_id_present
    : facts.request_class_id !== null && facts.request_class_id !== undefined;
  const requestCourseIdPresent = typeof facts.request_course_id_present === 'boolean'
    ? facts.request_course_id_present
    : facts.request_course_id !== null && facts.request_course_id !== undefined;
  const missingClassParam = !requestClassIdPresent;
  const missingCourseParam = !requestCourseIdPresent;
  const classScopeMismatched = requestClassIdPresent && (!selectedClassId || requestClassId !== selectedClassId);
  const courseScopeMismatched = requestCourseIdPresent && (!selectedCourseId || requestCourseId !== selectedCourseId);
  const missingClassScope = missingClassParam || classScopeMismatched;
  const missingCourseScope = missingCourseParam || courseScopeMismatched;
  const acceptedCourseIds = Array.isArray(facts.accepted_state_course_ids)
    ? facts.accepted_state_course_ids.map((value) => String(value))
    : [];
  const foreignReturnedCourseIds = [...new Set(acceptedCourseIds.filter((value) => value !== selectedCourseId))];
  const foreignRowRendered = facts.foreign_course_row_rendered === true;
  const controlledPositiveDefectObserved = missingClassScope || missingCourseScope
    || foreignReturnedCourseIds.length > 0 || foreignRowRendered;
  const historicalIssueDefectObserved = missingCourseParam
    && acceptedCourseIds.includes('202')
    && foreignRowRendered;
  const selectedSemantic = facts.evaluation_semantic === 'controlled_positive'
    ? 'controlled_positive'
    : 'historical_combination';
  const selectedFrontendDefectObserved = selectedSemantic === 'controlled_positive'
    ? controlledPositiveDefectObserved
    : historicalIssueDefectObserved;
  const backendConfirmation = facts.backend_confirmation;
  const defectObserved = backendConfirmation && typeof backendConfirmation.defect_observed === 'boolean'
    ? selectedFrontendDefectObserved && backendConfirmation.defect_observed
    : selectedFrontendDefectObserved;
  return {
    request_class_param_missing: missingClassParam,
    request_course_param_missing: missingCourseParam,
    class_scope_mismatched: classScopeMismatched,
    course_scope_mismatched: courseScopeMismatched,
    missing_class_scope: missingClassScope,
    missing_course_scope: missingCourseScope,
    foreign_returned_course_ids: foreignReturnedCourseIds,
    foreign_course_row_rendered: foreignRowRendered,
    historical_issue_defect_observed: historicalIssueDefectObserved,
    controlled_positive_defect_observed: controlledPositiveDefectObserved,
    selected_semantic: selectedSemantic,
    selected_frontend_defect_observed: selectedFrontendDefectObserved,
    ...(backendConfirmation && typeof backendConfirmation.defect_observed === 'boolean'
      ? { backend_confirmation_observed: backendConfirmation.defect_observed }
      : {}),
    defect_observed: defectObserved,
  };
}

function describeTeacherObservation(facts) {
  const evaluated = evaluateTeacherObservationFacts(facts);
  const selectedCourseId = String(facts.selected_course_id || '');
  const selectedCourseTitle = String(facts.selected_course_title || selectedCourseId || '当前课程');
  const selectedClassId = String(facts.selected_class_id || '');
  if (!evaluated.controlled_positive_defect_observed) {
    const rawIds = Array.isArray(facts.raw_response_course_ids)
      ? [...new Set(facts.raw_response_course_ids.map((value) => String(value)))]
      : [];
    const rejectedForeignFixture = rawIds.some((value) => value !== selectedCourseId);
    const acceptedCount = Array.isArray(facts.accepted_state_course_ids)
      ? facts.accepted_state_course_ids.length
      : 0;
    if (rejectedForeignFixture && acceptedCount === 0) {
      return `pending 请求携带 class_id=${selectedClassId} 与 course_id=${selectedCourseId}；夹具中的混课响应被整页拒绝，零行进入状态且 DOM 未渲染 submission row，未观察到 foreign-course row。`;
    }
    return `pending 请求携带 class_id=${selectedClassId} 与 course_id=${selectedCourseId}；${acceptedCount} 行进入 ${selectedCourseTitle}(course_id=${selectedCourseId}) 状态，DOM 未观察到 foreign-course row。`;
  }
  const observations = [];
  if (evaluated.request_class_param_missing) observations.push('pending 请求缺少 class_id');
  else if (evaluated.class_scope_mismatched) observations.push('pending 请求的 class_id 与当前班级错配');
  if (evaluated.request_course_param_missing) observations.push('pending 请求缺少 course_id');
  else if (evaluated.course_scope_mismatched) observations.push('pending 请求的 course_id 与当前课程错配');
  if (evaluated.foreign_returned_course_ids.length) {
    observations.push(`进入状态的返回行混入 foreign course_id=${evaluated.foreign_returned_course_ids.join(',')}`);
  }
  if (evaluated.foreign_course_row_rendered) observations.push('DOM 渲染了 foreign-course row');
  if (facts.backend_confirmation && facts.backend_confirmation.defect_observed === false) {
    observations.push('live API 对照未确认该前端缺陷，组合判定保持失败关闭');
  }
  return `观察到：${observations.join('；')}。`;
}

function instrumentTeacherSource(source, fixture) {
  let exposed = source.replace(
    '    window.initTeacher = initTeacher;',
    `    window.__qa016TeacherTest = Object.freeze({
        state, loadClassScope, renderSubmissionQueue
    });
    window.initTeacher = initTeacher;`,
  );
  assert.notEqual(exposed, source, 'Teacher QA instrumentation must apply');
  if (fixture.missingCourseParam === true) {
    const before = exposed;
    exposed = exposed.replace(
      'const submissionParams = { class_id: classId, course_id: courseId, status:',
      'const submissionParams = { class_id: classId, status:',
    );
    assert.notEqual(exposed, before, 'controlled missing-course mutation must apply');
  }
  if (fixture.acceptMixedPending === true) {
    const before = exposed;
    exposed = exposed.replace(
      "fetchJson('/api/admin/submissions/pending', { params: submissionParams }).then((page) => validateCourseScopedPage(page, courseScope, PENDING_SUBMISSION_PAGE_LIMIT, 0, 'pending_submission_scope_invalid'))",
      "fetchJson('/api/admin/submissions/pending', { params: submissionParams }).then((page) => page)",
    );
    assert.notEqual(exposed, before, 'controlled mixed-page mutation must apply');
  }
  return exposed;
}

async function probeTeacher(options = {}) {
  const source = read('pages/teacher/teacher.js');
  const fixture = {
    missingCourseParam: options.missingCourseParam === true,
    acceptMixedPending: options.acceptMixedPending === true,
  };
  const controlledPositive = fixture.missingCourseParam || fixture.acceptMixedPending;
  const exposed = instrumentTeacherSource(source, fixture);

  const calls = [];
  const pendingResponse = {
    items: [
      { id: 901, student_id: 31, student_username: 'student', assignment_title: 'Physics review', course_title: 'Physics', course_id: 101, status: 'submitted', submitted_at: '2026-08-09T01:00:00Z' },
      { id: 902, student_id: 31, student_username: 'student', assignment_title: 'Loop review', course_title: 'Control Flow', course_id: 202, status: 'submitted', submitted_at: '2026-08-09T01:01:00Z' },
    ],
    total: 2,
    limit: 50,
    offset: 0,
    next_offset: null,
  };
  const emptyPage = { items: [], total: 0, limit: 50, offset: 0, next_offset: null };
  const responses = new Map([
    ['/api/classes/11/members/page', emptyPage],
    ['/api/admin/submissions/pending', pendingResponse],
    ['/api/courses', [{ id: 101, title: 'Physics' }, { id: 202, title: 'Control Flow' }]],
    ['/api/classes/11/knowledge', { knowledge_stats: [] }],
  ]);
  const context = {
    AbortController,
    console: { log() {}, warn() {}, error() {} },
    document: {},
    FormData,
    Intl,
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  };
  context.window = context;
  context.AstraApiClient = {
    request(url, options = {}) {
      calls.push({ url, options });
      if (!responses.has(url)) throw new Error(`unexpected teacher request: ${url}`);
      return Promise.resolve(responses.get(url));
    },
    message(error) { return error && error.message || 'request failed'; },
  };
  vm.createContext(context);
  vm.runInContext(exposed, context, { filename: 'pages/teacher/teacher.js' });
  const api = context.__qa016TeacherTest;
  api.state.active = true;
  api.state.user = { id: 7, role: 'teacher' };
  api.state.selected.classId = '11';
  api.state.selected.courseId = '101';
  api.state.data.courses = [{ id: 101, title: 'Physics' }, { id: 202, title: 'Control Flow' }];
  api.state.lifecycleController = new AbortController();
  api.state.requestGeneration = 1;
  await api.loadClassScope(1);
  const pendingCall = calls.find((call) => call.url === '/api/admin/submissions/pending');
  const rendered = api.renderSubmissionQueue();
  const mixedCourseIds = [...new Set(api.state.data.submissions.map((item) => item.course_id))];
  const foreignRowRendered = rendered.includes('Control Flow');
  const params = pendingCall.options.params || {};
  const requestClassIdPresent = Object.prototype.hasOwnProperty.call(params, 'class_id');
  const requestCourseIdPresent = Object.prototype.hasOwnProperty.call(params, 'course_id');
  const facts = {
    selected_class_id: 11,
    selected_course_id: 101,
    selected_course_title: 'Physics',
    request_class_id_present: requestClassIdPresent,
    request_course_id_present: requestCourseIdPresent,
    request_class_id: requestClassIdPresent ? params.class_id : null,
    request_course_id: requestCourseIdPresent ? params.course_id : null,
    raw_response_course_ids: [...new Set(pendingResponse.items.map((item) => item.course_id))],
    accepted_state_course_ids: mixedCourseIds,
    foreign_course_row_rendered: foreignRowRendered,
    evaluation_semantic: controlledPositive ? 'controlled_positive' : 'historical_combination',
    fixture: Object.freeze({ ...fixture }),
  };
  const evaluated = evaluateTeacherObservationFacts(facts);
  const capturedAt = new Date().toISOString();

  return {
    defect_observed: evaluated.defect_observed,
    actual: describeTeacherObservation(facts),
    observation_facts: facts,
    observation_evaluation: evaluated,
    request_response: {
      request: { path: pendingCall.url, params: pendingCall.options.params },
      response: pendingResponse,
    },
    database_or_state_evidence: {
      selected_course_id: 101,
      selected_course_title: 'Physics',
      state_submission_course_ids: mixedCourseIds,
      foreign_course_row_rendered: foreignRowRendered,
    },
    raw_records: [
      rawRecord('TEACH-01', 'frontend-pending-request', 'request', {
        path: pendingCall.url,
        params: pendingCall.options.params,
      }, capturedAt),
      rawRecord('TEACH-01', 'frontend-pending-response', 'response', {
        body: pendingResponse,
      }, capturedAt),
      rawRecord('TEACH-01', 'frontend-scope-state', 'state', {
        selected_class_id: 11,
        selected_course_id: 101,
        selected_course_title: 'Physics',
        accepted_state_course_ids: mixedCourseIds,
        evaluation_semantic: controlledPositive ? 'controlled_positive' : 'historical_combination',
        fixture,
      }, capturedAt),
      rawRecord('TEACH-01', 'frontend-pending-dom', 'dom', {
        rendered_html: rendered,
      }, capturedAt),
    ],
  };
}

function probeMechanics() {
  const source = read('pages/physics/physics.js');
  const indexHtml = read('index.html');
  const mechanicsBlock = indexHtml.match(/<section id="page-physics"[\s\S]*?<section id="page-optics"/)?.[0] || '';
  const directControlIds = [
    'gravity-slider',
    'restitution-slider',
    'friction-slider',
    'radius-slider',
    'physics-clear',
    'physics-pause',
    'physics-canvas',
  ];
  const directControlsPresent = directControlIds.every((id) => mechanicsBlock.includes(`id="${id}"`));
  const retiredCourseSymbols = [
    'mechanics-course',
    'mechanics-prediction',
    'mechanics-trial-',
    '_submitCoursePrediction',
    '_startControlledTrial',
    '_courseState',
    'astra:learning-evidence',
  ];
  const courseSymbolsPresent = retiredCourseSymbols.some((symbol) => (
    mechanicsBlock.includes(symbol) || source.includes(symbol)
  ));
  const context = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    cancelAnimationFrame() {},
    requestAnimationFrame() { return 1; },
    performance: { now: () => 0 },
    CF: { sans: 'sans-serif' },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };
  context.window = {
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
    PhysicsZoom: { movedCanvas: null },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'pages/physics/physics.js' });
  const sim = context.window.PhysicsSim;
  sim.canvas = {};
  sim.W = 640;
  sim.H = 360;
  sim.updateStats = () => {};
  sim.render = () => {};
  const ballsBefore = sim.balls.length;
  sim.launchBall({ x: 120, y: 100 }, { x: 80, y: 70 });
  const ballsAfter = sim.balls.length;
  const launchWorked = ballsAfter === ballsBefore + 1;
  const defectObserved = !directControlsPresent || courseSymbolsPresent || !launchWorked;
  const capturedAt = new Date().toISOString();

  return {
    defect_observed: defectObserved,
    actual: defectObserved
      ? '独立力学实验恢复不完整：原有控件、直接发射操作或课程化隔离至少有一项不符合要求。'
      : '原有参数控件、按钮、画布和直接发射操作均可用，页面与实验脚本未重新引入课程化标记。',
    request_response: {
      action: 'inspect restored mechanics surface then launchBall()',
      direct_controls_present: directControlsPresent,
      launch_worked: launchWorked,
    },
    database_or_state_evidence: {
      course_symbols_present: courseSymbolsPresent,
      balls_before: ballsBefore,
      balls_after: ballsAfter,
      checked_control_ids: directControlIds,
    },
    raw_records: [
      rawRecord('MECH-01', 'controlled-sequence-request', 'request', {
        action: 'inspect restored mechanics surface then launchBall()',
      }, capturedAt),
      rawRecord('MECH-01', 'controlled-sequence-response', 'response', {
        direct_controls_present: directControlsPresent,
        launch_worked: launchWorked,
      }, capturedAt),
      rawRecord('MECH-01', 'controlled-sequence-state', 'state', {
        course_symbols_present: courseSymbolsPresent,
        balls_before: ballsBefore,
        balls_after: ballsAfter,
        checked_control_ids: directControlIds,
      }, capturedAt),
    ],
  };
}

function resolveRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || 'git rev-parse failed');
  return result.stdout.trim();
}

function runBackendProbe(pythonCommand, keepData) {
  const script = path.join(__dirname, 'qa016_backend_probe.py');
  const args = ['-X', 'utf8', script];
  if (keepData) args.push('--keep-data');
  const result = spawnSync(pythonCommand, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`backend probe failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`backend probe returned invalid JSON: ${error.message}\n${result.stdout}`);
  }
}

function attachBackendRawRecords(issueId, observation) {
  const capturedAt = new Date().toISOString();
  if (issueId === 'CODE-01') {
    return {
      ...observation,
      raw_records: [
        rawRecord(issueId, 'second-submission-request', 'request', {
          first_submission_id: observation.request_response.first_submission_id,
          second_request: observation.request_response.second_request,
        }, capturedAt),
        rawRecord(issueId, 'second-submission-response', 'response',
          observation.request_response.second_response, capturedAt),
        rawRecord(issueId, 'submission-ledger-state', 'state',
          observation.database_or_state_evidence, capturedAt),
      ],
    };
  }
  if (issueId === 'DEMO-01') {
    return {
      ...observation,
      raw_records: [
        rawRecord(issueId, 'demo-initialization-request', 'request', {
          student_recovery_request: observation.request_response.student_recovery_request,
        }, capturedAt),
        rawRecord(issueId, 'demo-initialization-response', 'response', {
          initializer_status: observation.request_response.initializer_status,
          initializer_completed_activity_keys: observation.request_response.initializer_completed_activity_keys,
          student_recovery_statuses: observation.request_response.student_recovery_statuses,
        }, capturedAt),
        rawRecord(issueId, 'demo-ledger-state', 'state',
          observation.database_or_state_evidence, capturedAt),
      ],
    };
  }
  throw new Error(`unsupported backend raw issue: ${issueId}`);
}

function combineTeacherObservation(frontendObservation, backendObservation) {
  const observationFacts = {
    ...frontendObservation.observation_facts,
    backend_confirmation: {
      defect_observed: backendObservation.defect_observed,
    },
  };
  const evaluated = evaluateTeacherObservationFacts(observationFacts);
  const liveApi = backendObservation.request_response;
  const {
    status: frontendShapedStatus,
    ...frontendShapedRequest
  } = liveApi.frontend_shaped_request;
  const {
    status: controlStatus,
    ...controlRequest
  } = liveApi.control_request;
  const capturedAt = new Date().toISOString();
  return {
    ...frontendObservation,
    defect_observed: evaluated.defect_observed,
    actual: describeTeacherObservation(observationFacts),
    observation_facts: observationFacts,
    observation_evaluation: evaluated,
    request_response: {
      frontend_runtime: frontendObservation.request_response,
      live_api: backendObservation.request_response,
    },
    database_or_state_evidence: {
      frontend_runtime: frontendObservation.database_or_state_evidence,
      live_database: backendObservation.database_or_state_evidence,
    },
    raw_records: [
      ...frontendObservation.raw_records,
      rawRecord('TEACH-01', 'backend-pending-requests', 'request', {
        frontend_shaped_request: frontendShapedRequest,
        control_request: controlRequest,
      }, capturedAt),
      rawRecord('TEACH-01', 'backend-pending-responses', 'response', {
        frontend_shaped_status: frontendShapedStatus,
        frontend_shaped_response: liveApi.frontend_shaped_response,
        control_status: controlStatus,
        control_response: liveApi.control_response,
      }, capturedAt),
      rawRecord('TEACH-01', 'backend-ledger-state', 'state',
        backendObservation.database_or_state_evidence, capturedAt),
    ],
  };
}

function deriveExecution(mode, classification) {
  if (!['frontend', 'baseline', 'gate'].includes(mode)) throw new Error(`unsupported report mode: ${mode}`);
  const gateMode = mode === 'gate';
  const passed = gateMode
    ? classification.desired_gate_passed
    : classification.all_expected_defects_observed;
  return {
    mode,
    selected_semantic: gateMode ? 'desired_gate' : 'baseline_assertion',
    status: passed ? 'PASS' : 'FAIL',
    exit_code: passed ? 0 : (gateMode ? 1 : 2),
  };
}

function deriveOverall(classification) {
  return {
    baseline_assertion: classification.all_expected_defects_observed ? 'PASS' : 'FAIL',
    desired_gate: classification.desired_gate_passed ? 'PASS' : 'FAIL',
  };
}

function provenanceEnvelopeId(revision, mode) {
  const revisionToken = String(revision || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 40);
  return `qa016-${revisionToken}-${mode}`;
}

function createProvenance(revision, observations, mode) {
  const rawRecords = ISSUE_IDS.flatMap((issueId) => {
    const records = observations[issueId] && observations[issueId].raw_records;
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`missing raw provenance records for ${issueId}`);
    }
    return records.map(cloneJson);
  });
  const envelopeId = provenanceEnvelopeId(revision, mode);
  const recomputeInput = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    envelope_id: envelopeId,
    raw_records: cloneJson(rawRecords),
  };
  const canonicalFacts = QA016_PROVENANCE_VERIFIER.recompute(recomputeInput);
  return {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    envelope_id: envelopeId,
    verifier: { id: VERIFIER_ID, version: VERIFIER_VERSION },
    raw_records: rawRecords,
    canonical_facts: canonicalFacts,
    status: 'PASS',
    assurance: PROVENANCE_ASSURANCE,
    limitation: PROVENANCE_LIMITATION,
  };
}

function issueFromCanonicalFact(issueId, factValue, revision, classification) {
  const contract = ISSUE_CONTRACTS[issueId];
  return {
    owner: contract.owner,
    preconditions: contract.preconditions,
    steps: contract.steps,
    expected: contract.expected,
    actual: factValue.actual,
    request_response: factValue.request_response,
    database_or_state_evidence: factValue.database_or_state_evidence,
    exact_revision: revision,
    reproducible_command: contract.command,
    defect_observed: factValue.defect_observed,
    baseline_assertion: classification.issues[issueId].baseline_assertion,
    desired_gate: classification.issues[issueId].desired_gate,
    ...(factValue.observation_facts ? { observation_facts: factValue.observation_facts } : {}),
    ...(factValue.observation_evaluation ? { observation_evaluation: factValue.observation_evaluation } : {}),
  };
}

function reportLayersFromCanonicalFacts(report, facts) {
  const factsByIssue = new Map(facts.map((item) => [item.value.issue_id || item.fact_id.split('.')[1], item.value]));
  const canonicalObservations = Object.fromEntries(ISSUE_IDS.map((issueId) => {
    const value = factsByIssue.get(issueId);
    if (!value || typeof value.defect_observed !== 'boolean') {
      throw new Error(`missing canonical observation for ${issueId}`);
    }
    return [issueId, value];
  }));
  const summary = classifyObservations(canonicalObservations);
  const issues = Object.fromEntries(ISSUE_IDS.map((issueId) => [
    issueId,
    issueFromCanonicalFact(issueId, canonicalObservations[issueId], report.observed_revision, summary),
  ]));
  const overall = deriveOverall(summary);
  const execution = deriveExecution(report.execution && report.execution.mode, summary);
  const expectedReport = { ...report, summary, overall, execution, issues };
  return {
    issues,
    summary,
    overall,
    execution,
    human_summary: renderHumanSummary(expectedReport),
  };
}

function renderHumanSummary(report) {
  const execution = report.execution || {};
  const overall = report.overall || {};
  const teacher = report.issues && report.issues['TEACH-01'] || {};
  return `[QA-016] mode=${execution.mode || 'unknown'} overall=${execution.status || 'UNKNOWN'} exit_code=${String(execution.exit_code)}; baseline=${overall.baseline_assertion || 'UNKNOWN'}; desired_gate=${overall.desired_gate || 'UNKNOWN'}; TEACH-01 defect_observed=${String(teacher.defect_observed)}; actual=${JSON.stringify(teacher.actual || '')}`;
}

function validateReportConsistency(report) {
  const failures = [];
  const check = (condition, code) => {
    if (!condition) failures.push(code);
  };
  try {
    const provenanceResult = verifyProvenanceEnvelope(report.provenance);
    for (const provenanceFailure of provenanceResult.failures) {
      failures.push(`provenance:${provenanceFailure}`);
    }
    check(report.provenance && report.provenance.status === provenanceResult.status,
      'provenance_status_not_recomputed');
    check(report.provenance && report.provenance.assurance === PROVENANCE_ASSURANCE,
      'provenance_assurance_invalid');
    check(report.provenance && report.provenance.limitation === PROVENANCE_LIMITATION,
      'provenance_limitation_invalid');
    check(
      report.provenance && report.provenance.envelope_id
        === provenanceEnvelopeId(report.observed_revision, report.execution && report.execution.mode),
      'provenance_envelope_not_bound_to_report',
    );
    if (provenanceResult.valid) {
      const layers = reportLayersFromCanonicalFacts(report, provenanceResult.recomputed_facts);
      const reportedTeacher = report.issues && report.issues['TEACH-01'];
      const canonicalTeacher = layers.issues['TEACH-01'];
      check(Boolean(reportedTeacher && reportedTeacher.observation_facts), 'teach_observation_facts_missing');
      if (reportedTeacher) {
        check(reportedTeacher.defect_observed === canonicalTeacher.defect_observed,
          'teach_defect_not_derived_from_observation_facts');
        check(reportedTeacher.actual === canonicalTeacher.actual,
          'teach_actual_not_derived_from_observation_facts');
        check(isDeepStrictEqual(reportedTeacher.observation_evaluation, canonicalTeacher.observation_evaluation),
          'teach_evaluation_not_derived_from_observation_facts');
      }
      for (const issueId of ISSUE_IDS) {
        check(
          isDeepStrictEqual(report.issues && report.issues[issueId], layers.issues[issueId]),
          `issue_not_derived_from_canonical_fact:${issueId}`,
        );
      }
      check(isDeepStrictEqual(report.summary, layers.summary), 'summary_not_derived_from_canonical_facts');
      check(isDeepStrictEqual(report.overall, layers.overall), 'overall_not_derived_from_summary');
      check(isDeepStrictEqual(report.execution, layers.execution), 'exit_semantics_not_derived_from_selected_gate');
      check(report.human_summary === layers.human_summary, 'human_summary_not_derived_from_report');
    }
  } catch (error) {
    failures.push(`invalid_report_shape:${error.message}`);
  }
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

function exitCodeForReport(report) {
  const consistency = validateReportConsistency(report);
  return consistency.status === 'PASS' ? report.execution.exit_code : 3;
}

function buildReport(revision, observations, backendEnvironment, mode = 'baseline') {
  const provenance = createProvenance(revision, observations, mode);
  const canonicalObservations = Object.fromEntries(provenance.canonical_facts.map((item) => [
    item.fact_id.split('.')[1],
    item.value,
  ]));
  const classification = classifyObservations(canonicalObservations);
  const report = {
    schema: 'astra.qa016.critical-journeys.v1',
    task: 'QA-016',
    version: 'V8.0.1',
    baseline_revision: BASELINE_REVISION,
    observed_revision: revision,
    revision_matches_assignment: revision === BASELINE_REVISION,
    generated_at: new Date().toISOString(),
    environment: {
      frontend_probe: 'Node.js VM executing current tracked owners',
      backend_probe: backendEnvironment || null,
    },
    semantics: {
      baseline_assertion: 'PASS means the assigned defect was honestly reproduced.',
      desired_gate: 'PASS means repaired product semantics; current baseline is expected to FAIL.',
    },
    provenance,
    summary: classification,
    overall: deriveOverall(classification),
    execution: deriveExecution(mode, classification),
    issues: Object.fromEntries(ISSUE_IDS.map((issueId) => [
      issueId,
      issueFromCanonicalFact(issueId, canonicalObservations[issueId], revision, classification),
    ])),
  };
  report.human_summary = renderHumanSummary(report);
  const consistency = validateReportConsistency(report);
  if (consistency.status !== 'PASS') {
    throw new Error(`internally inconsistent QA-016 report: ${consistency.failures.join(', ')}`);
  }
  return report;
}

function parseArgs(argv) {
  const options = { mode: 'baseline', python: process.env.PYTHON || 'python', output: '', keepData: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') options.mode = 'self-test';
    else if (arg === '--keep-data') options.keepData = true;
    else if (arg === '--mode') options.mode = argv[++index] || '';
    else if (arg === '--python') options.python = argv[++index] || '';
    else if (arg === '--output') options.output = argv[++index] || '';
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['self-test', 'frontend', 'baseline', 'gate'].includes(options.mode)) {
    throw new Error(`unsupported mode: ${options.mode}`);
  }
  return options;
}

async function run(options) {
  if (options.mode === 'self-test') {
    return { exitCode: 0, report: { schema: 'astra.qa016.self-test.v1', task: 'QA-016', result: selfTest() } };
  }
  const revision = resolveRevision();
  const future = probeFuture();
  const teacher = await probeTeacher();
  const mechanics = probeMechanics();
  const observations = { ...future, 'TEACH-01': teacher, 'MECH-01': mechanics };
  let backendEnvironment = null;
  if (options.mode !== 'frontend') {
    const backend = runBackendProbe(options.python, options.keepData);
    backendEnvironment = backend.environment;
    for (const issueId of ['TEACH-01', 'CODE-01', 'DEMO-01']) {
      if (issueId === 'TEACH-01') {
        observations[issueId] = combineTeacherObservation(observations[issueId], backend.issues[issueId]);
      } else {
        observations[issueId] = attachBackendRawRecords(issueId, backend.issues[issueId]);
      }
    }
  } else {
    observations['CODE-01'] = notExecutedObservation('CODE-01');
    observations['DEMO-01'] = notExecutedObservation('DEMO-01');
  }
  const report = buildReport(revision, observations, backendEnvironment, options.mode);
  return { exitCode: exitCodeForReport(report), report };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { exitCode, report } = await run(options);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (report.human_summary) process.stderr.write(`${report.human_summary}\n`);
  process.exitCode = exitCode;
}

module.exports = Object.freeze({
  BASELINE_REVISION,
  ISSUE_CONTRACTS,
  ISSUE_IDS,
  buildReport,
  classifyObservations,
  combineTeacherObservation,
  createProvenance,
  describeTeacherObservation,
  deriveExecution,
  deriveOverall,
  evaluateTeacherObservationFacts,
  exitCodeForReport,
  issueFromCanonicalFact,
  probeFuture,
  probeMechanics,
  probeTeacher,
  reportLayersFromCanonicalFacts,
  renderHumanSummary,
  run,
  selfTest,
  validateReportConsistency,
});

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 3;
  });
}

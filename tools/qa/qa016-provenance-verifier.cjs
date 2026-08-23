'use strict';

const { isDeepStrictEqual } = require('node:util');

const PROVENANCE_SCHEMA_VERSION = 'astra-raw-evidence-provenance-v1';
const PROVENANCE_ASSURANCE = 'consistency-only';
const PROVENANCE_LIMITATION = 'coordinated raw-record and claimed-fact changes require external source-authenticity verification';
const VERIFIER_ID = 'astra.qa021.qa016.raw-provenance';
const VERIFIER_VERSION = '1';
const RAW_SOURCE_KINDS = Object.freeze(['request', 'response', 'state', 'dom']);
const ISSUE_IDS = Object.freeze([
  'FUTURE-01',
  'FUTURE-02',
  'TEACH-01',
  'CODE-01',
  'MECH-01',
  'DEMO-01',
]);

function failure(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireCondition(condition, code, message) {
  if (!condition) throw failure(code, message);
}

function clone(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw failure('non_json_value', error.message);
  }
  requireCondition(serialized !== undefined, 'non_json_value');
  return JSON.parse(serialized);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizedString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function validateInputShape(input) {
  requireCondition(input && typeof input === 'object' && !Array.isArray(input), 'recompute_input_invalid');
  const keys = Object.keys(input).sort();
  requireCondition(
    isDeepStrictEqual(keys, ['envelope_id', 'raw_records', 'schema_version']),
    'recompute_input_forbidden_field',
    `recompute accepts only schema_version, envelope_id, and raw_records; received ${keys.join(',')}`,
  );
  requireCondition(input.schema_version === PROVENANCE_SCHEMA_VERSION, 'provenance_schema_invalid');
  requireCondition(
    typeof input.envelope_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.envelope_id),
    'provenance_envelope_id_invalid',
  );
}

function validateRawRecords(rawRecords) {
  requireCondition(Array.isArray(rawRecords) && rawRecords.length > 0, 'raw_records_missing');
  const sourceIds = new Set();
  const channels = new Set();
  const byChannel = new Map();
  for (const record of rawRecords) {
    requireCondition(record && typeof record === 'object' && !Array.isArray(record), 'raw_record_invalid');
    requireCondition(
      isDeepStrictEqual(Object.keys(record).sort(), ['captured_at', 'payload', 'source_id', 'source_kind']),
      'raw_record_shape_invalid',
    );
    requireCondition(
      typeof record.source_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(record.source_id),
      'raw_source_id_invalid',
    );
    requireCondition(!sourceIds.has(record.source_id), 'raw_source_id_duplicate');
    sourceIds.add(record.source_id);
    requireCondition(RAW_SOURCE_KINDS.includes(record.source_kind), 'raw_source_kind_invalid');
    requireCondition(typeof record.captured_at === 'string', 'raw_timestamp_invalid');
    let normalizedTimestamp;
    try {
      normalizedTimestamp = new Date(record.captured_at).toISOString();
    } catch {
      throw failure('raw_timestamp_invalid');
    }
    requireCondition(normalizedTimestamp === record.captured_at, 'raw_timestamp_not_canonical');
    requireCondition(record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload), 'raw_payload_invalid');
    requireCondition(
      isDeepStrictEqual(Object.keys(record.payload).sort(), ['channel', 'data', 'issue_id']),
      'raw_payload_shape_invalid',
    );
    requireCondition(ISSUE_IDS.includes(record.payload.issue_id), 'raw_issue_id_invalid');
    requireCondition(
      typeof record.payload.channel === 'string'
        && /^[a-z][a-z0-9-]{2,63}$/.test(record.payload.channel),
      'raw_channel_invalid',
    );
    clone(record.payload.data);
    const channelKey = `${record.payload.issue_id}:${record.payload.channel}`;
    requireCondition(!channels.has(channelKey), 'raw_channel_duplicate');
    channels.add(channelKey);
    byChannel.set(channelKey, record);
  }
  return { byChannel, sourceIds };
}

function getRecord(index, issueId, channel, sourceKind) {
  const record = index.byChannel.get(`${issueId}:${channel}`);
  requireCondition(Boolean(record), 'raw_source_missing', `${issueId}:${channel}`);
  requireCondition(record.source_kind === sourceKind, 'raw_source_kind_mismatch', `${issueId}:${channel}`);
  return record;
}

function optionalRecord(index, issueId, channel, sourceKind) {
  const record = index.byChannel.get(`${issueId}:${channel}`);
  if (!record) return null;
  requireCondition(record.source_kind === sourceKind, 'raw_source_kind_mismatch', `${issueId}:${channel}`);
  return record;
}

function fact(issueId, records, value) {
  return {
    fact_id: `qa016.${issueId}.observation`,
    source_ids: records.map((record) => record.source_id),
    value: { issue_id: issueId, ...value },
  };
}

function evaluateTeacherFacts(facts) {
  const selectedClassId = normalizedString(facts.selected_class_id);
  const selectedCourseId = normalizedString(facts.selected_course_id);
  const requestClassId = normalizedString(facts.request_class_id);
  const requestCourseId = normalizedString(facts.request_course_id);
  const requestClassIdPresent = facts.request_class_id_present === true;
  const requestCourseIdPresent = facts.request_course_id_present === true;
  const missingClassParam = !requestClassIdPresent;
  const missingCourseParam = !requestCourseIdPresent;
  const classScopeMismatched = requestClassIdPresent
    && (!selectedClassId || requestClassId !== selectedClassId);
  const courseScopeMismatched = requestCourseIdPresent
    && (!selectedCourseId || requestCourseId !== selectedCourseId);
  const missingClassScope = missingClassParam || classScopeMismatched;
  const missingCourseScope = missingCourseParam || courseScopeMismatched;
  const acceptedCourseIds = Array.isArray(facts.accepted_state_course_ids)
    ? facts.accepted_state_course_ids.map(normalizedString)
    : [];
  const foreignReturnedCourseIds = [
    ...new Set(acceptedCourseIds.filter((value) => value !== selectedCourseId)),
  ];
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

function describeTeacherFacts(facts) {
  const evaluated = evaluateTeacherFacts(facts);
  const selectedCourseId = normalizedString(facts.selected_course_id);
  const selectedCourseTitle = normalizedString(facts.selected_course_title)
    || selectedCourseId || '当前课程';
  const selectedClassId = normalizedString(facts.selected_class_id);
  if (!evaluated.controlled_positive_defect_observed) {
    const rawIds = Array.isArray(facts.raw_response_course_ids)
      ? [...new Set(facts.raw_response_course_ids.map(normalizedString))]
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

function recomputeFuture01(index) {
  const request = getRecord(index, 'FUTURE-01', 'submit-action', 'request');
  const state = getRecord(index, 'FUTURE-01', 'interaction-state', 'state');
  const dom = getRecord(index, 'FUTURE-01', 'feedback-dom', 'dom');
  const acceptedLocally = /观察支持/.test(normalizedString(dom.payload.data.response));
  const stateData = state.payload.data;
  const defectObserved = Number(stateData.user_input_change_count) === 0
    && Number(stateData.observation_checkpoint_count) === 0
    && stateData.submit_disabled_before_click === false
    && acceptedLocally;
  return fact('FUTURE-01', [request, state, dom], {
    defect_observed: defectObserved,
    actual: defectObserved
      ? '零变量变化、零观察确认时，正确选项仍直接得到“观察支持”的本地成功反馈。'
      : '未同时观察到“零变量变化、零观察确认、提交可用且本地反馈接受”；FUTURE-01 历史缺陷未复现。',
    request_response: {
      action: request.payload.data.action,
      response: dom.payload.data.response,
      response_before: dom.payload.data.response_before,
    },
    database_or_state_evidence: {
      user_input_change_count: stateData.user_input_change_count,
      observation_checkpoint_count: stateData.observation_checkpoint_count,
      submit_disabled_before_click: stateData.submit_disabled_before_click,
      accepted_locally: acceptedLocally,
    },
  });
}

function recomputeFuture02(index) {
  const request = getRecord(index, 'FUTURE-02', 'submit-action', 'request');
  const response = getRecord(index, 'FUTURE-02', 'write-channels', 'response');
  const dom = getRecord(index, 'FUTURE-02', 'feedback-dom', 'dom');
  const counts = response.payload.data;
  const acceptedLocally = /观察支持/.test(normalizedString(dom.payload.data.local_response));
  const noAuthorityWrite = Number(counts.network_request_count) === 0
    && Number(counts.learning_evidence_client_call_count) === 0
    && Number(counts.learning_domain_command_count) === 0;
  return fact('FUTURE-02', [request, response, dom], {
    defect_observed: acceptedLocally && noAuthorityWrite,
    actual: acceptedLocally && noAuthorityWrite
      ? '判断只修改 data-fg-feedback；没有网络写入、证据客户端调用或学习领域命令。'
      : '未同时观察到“本地判断成功且零网络、证据客户端与学习领域写入”；FUTURE-02 历史缺陷未复现。',
    request_response: {
      action: request.payload.data.action,
      local_response: dom.payload.data.local_response,
      network_request_count: counts.network_request_count,
      learning_evidence_client_call_count: counts.learning_evidence_client_call_count,
      learning_domain_command_count: counts.learning_domain_command_count,
    },
    database_or_state_evidence: {
      authoritative_event_created: !noAuthorityWrite,
      teacher_readback_possible_from_this_action: !noAuthorityWrite,
    },
  });
}

function recomputeTeacher(index) {
  const request = getRecord(index, 'TEACH-01', 'frontend-pending-request', 'request');
  const response = getRecord(index, 'TEACH-01', 'frontend-pending-response', 'response');
  const state = getRecord(index, 'TEACH-01', 'frontend-scope-state', 'state');
  const dom = getRecord(index, 'TEACH-01', 'frontend-pending-dom', 'dom');
  const params = request.payload.data.params || {};
  const stateData = state.payload.data;
  const responseBody = response.payload.data.body;
  const requestClassIdPresent = Object.hasOwn(params, 'class_id');
  const requestCourseIdPresent = Object.hasOwn(params, 'course_id');
  const responseItems = Array.isArray(responseBody.items) ? responseBody.items : [];
  const foreignCourseTitles = responseItems
    .filter((item) => normalizedString(item.course_id) !== normalizedString(stateData.selected_course_id))
    .map((item) => normalizedString(item.course_title))
    .filter(Boolean);
  const renderedHtml = normalizedString(dom.payload.data.rendered_html);
  const foreignCourseRowRendered = foreignCourseTitles.some((title) => renderedHtml.includes(title));
  const facts = {
    selected_class_id: stateData.selected_class_id,
    selected_course_id: stateData.selected_course_id,
    selected_course_title: stateData.selected_course_title,
    request_class_id_present: requestClassIdPresent,
    request_course_id_present: requestCourseIdPresent,
    request_class_id: requestClassIdPresent ? params.class_id : null,
    request_course_id: requestCourseIdPresent ? params.course_id : null,
    raw_response_course_ids: [...new Set(responseItems.map((item) => item.course_id))],
    accepted_state_course_ids: clone(stateData.accepted_state_course_ids || []),
    foreign_course_row_rendered: foreignCourseRowRendered,
    evaluation_semantic: stateData.evaluation_semantic === 'controlled_positive'
      ? 'controlled_positive'
      : 'historical_combination',
    fixture: clone(stateData.fixture || {}),
  };
  const backendRequest = optionalRecord(index, 'TEACH-01', 'backend-pending-requests', 'request');
  const backendResponse = optionalRecord(index, 'TEACH-01', 'backend-pending-responses', 'response');
  const backendState = optionalRecord(index, 'TEACH-01', 'backend-ledger-state', 'state');
  const backendRecords = [backendRequest, backendResponse, backendState].filter(Boolean);
  requireCondition(
    backendRecords.length === 0 || backendRecords.length === 3,
    'teacher_backend_raw_incomplete',
  );
  let requestResponse = {
    request: { path: request.payload.data.path, params: clone(params) },
    response: clone(responseBody),
  };
  let databaseOrStateEvidence = {
    selected_course_id: stateData.selected_course_id,
    selected_course_title: stateData.selected_course_title,
    state_submission_course_ids: clone(stateData.accepted_state_course_ids || []),
    foreign_course_row_rendered: foreignCourseRowRendered,
  };
  if (backendRecords.length === 3) {
    const backendRequestData = backendRequest.payload.data;
    const backendResponseData = backendResponse.payload.data;
    const backendStateData = backendState.payload.data;
    const selectedPhysicsCourseId = Number(backendStateData.selected_physics_course_id);
    const unscopedCourseIds = Array.isArray(backendResponseData.frontend_shaped_response.course_ids)
      ? backendResponseData.frontend_shaped_response.course_ids.map(Number)
      : [];
    facts.backend_confirmation = {
      defect_observed: unscopedCourseIds.some((courseId) => courseId !== selectedPhysicsCourseId),
    };
    requestResponse = {
      frontend_runtime: requestResponse,
      live_api: {
        frontend_shaped_request: {
          ...clone(backendRequestData.frontend_shaped_request),
          status: backendResponseData.frontend_shaped_status,
        },
        frontend_shaped_response: clone(backendResponseData.frontend_shaped_response),
        control_request: {
          ...clone(backendRequestData.control_request),
          status: backendResponseData.control_status,
        },
        control_response: clone(backendResponseData.control_response),
      },
    };
    databaseOrStateEvidence = {
      frontend_runtime: databaseOrStateEvidence,
      live_database: clone(backendStateData),
    };
  }
  const evaluation = evaluateTeacherFacts(facts);
  return fact('TEACH-01', [request, response, state, dom, ...backendRecords], {
    defect_observed: evaluation.defect_observed,
    actual: describeTeacherFacts(facts),
    request_response: requestResponse,
    database_or_state_evidence: databaseOrStateEvidence,
    observation_facts: facts,
    observation_evaluation: evaluation,
  });
}

function recomputeCode(index) {
  const skipped = optionalRecord(index, 'CODE-01', 'not-executed-state', 'state');
  if (skipped) {
    return fact('CODE-01', [skipped], {
      defect_observed: false,
      actual: 'frontend-only mode: not executed',
      request_response: { status: 'NOT_EXECUTED' },
      database_or_state_evidence: { status: 'NOT_EXECUTED' },
    });
  }
  const request = getRecord(index, 'CODE-01', 'second-submission-request', 'request');
  const response = getRecord(index, 'CODE-01', 'second-submission-response', 'response');
  const state = getRecord(index, 'CODE-01', 'submission-ledger-state', 'state');
  const ledger = state.payload.data;
  const defectObserved = Number(response.payload.data.status) === 409
    && Number(ledger.submission_count) === 1;
  return fact('CODE-01', [request, response, state], {
    defect_observed: defectObserved,
    actual: defectObserved
      ? '同学生、同班、同题版本修改源码后第二次正式提交返回 409，数据库仍只有一条 submission。'
      : `第二次正式提交返回 ${String(response.payload.data.status)}，数据库 submission_count=${String(ledger.submission_count)}；未复现“409 且仅一条 submission”的历史冲突组合。`,
    request_response: {
      first_submission_id: request.payload.data.first_submission_id,
      second_request: clone(request.payload.data.second_request),
      second_response: clone(response.payload.data),
    },
    database_or_state_evidence: clone(ledger),
  });
}

function recomputeMechanics(index) {
  const request = getRecord(index, 'MECH-01', 'controlled-sequence-request', 'request');
  const response = getRecord(index, 'MECH-01', 'controlled-sequence-response', 'response');
  const state = getRecord(index, 'MECH-01', 'controlled-sequence-state', 'state');
  const responseData = response.payload.data;
  const stateData = state.payload.data;
  const defectObserved = responseData.direct_controls_present !== true
    || responseData.launch_worked !== true
    || stateData.course_symbols_present === true
    || stateData.balls_after !== stateData.balls_before + 1;
  return fact('MECH-01', [request, response, state], {
    defect_observed: defectObserved,
    actual: defectObserved
      ? '独立力学实验恢复不完整：原有控件、直接发射操作或课程化隔离至少有一项不符合要求。'
      : '原有参数控件、按钮、画布和直接发射操作均可用，页面与实验脚本未重新引入课程化标记。',
    request_response: {
      action: request.payload.data.action,
      direct_controls_present: responseData.direct_controls_present,
      launch_worked: responseData.launch_worked,
    },
    database_or_state_evidence: clone(stateData),
  });
}

function recomputeDemo(index) {
  const skipped = optionalRecord(index, 'DEMO-01', 'not-executed-state', 'state');
  if (skipped) {
    return fact('DEMO-01', [skipped], {
      defect_observed: false,
      actual: 'frontend-only mode: not executed',
      request_response: { status: 'NOT_EXECUTED' },
      database_or_state_evidence: { status: 'NOT_EXECUTED' },
    });
  }
  const request = getRecord(index, 'DEMO-01', 'demo-initialization-request', 'request');
  const response = getRecord(index, 'DEMO-01', 'demo-initialization-response', 'response');
  const state = getRecord(index, 'DEMO-01', 'demo-ledger-state', 'state');
  const responseData = response.payload.data;
  const ledger = state.payload.data;
  const defectObserved = Array.isArray(responseData.initializer_completed_activity_keys)
    && responseData.initializer_completed_activity_keys.length > 0
    && Number(ledger.completed_projection_count) > 0;
  return fact('DEMO-01', [request, response, state], {
    defect_observed: defectObserved,
    actual: defectObserved
      ? '全新演示初始化在任何现场学习前已生成 completed 代表活动与完整学习事件。'
      : `全新演示初始化 completed activity count=${String((responseData.initializer_completed_activity_keys || []).length)}，数据库 completed projection count=${String(ledger.completed_projection_count)}；DEMO-01 预完成历史缺陷未复现。`,
    request_response: {
      initializer_status: responseData.initializer_status,
      initializer_completed_activity_keys: clone(responseData.initializer_completed_activity_keys),
      student_recovery_request: clone(request.payload.data.student_recovery_request),
      student_recovery_statuses: clone(responseData.student_recovery_statuses),
    },
    database_or_state_evidence: clone(ledger),
  });
}

function recomputeCanonicalFacts(input) {
  validateInputShape(input);
  const index = validateRawRecords(input.raw_records);
  return [
    recomputeFuture01(index),
    recomputeFuture02(index),
    recomputeTeacher(index),
    recomputeCode(index),
    recomputeMechanics(index),
    recomputeDemo(index),
  ];
}

const QA016_PROVENANCE_VERIFIER = Object.freeze({
  id: VERIFIER_ID,
  version: VERIFIER_VERSION,
  recompute: recomputeCanonicalFacts,
});

function validateFacts(facts, sourceIds) {
  requireCondition(Array.isArray(facts) && facts.length === ISSUE_IDS.length, 'canonical_facts_incomplete');
  const factIds = new Set();
  return facts.map((candidate) => {
    requireCondition(candidate && typeof candidate === 'object' && !Array.isArray(candidate), 'canonical_fact_invalid');
    requireCondition(
      isDeepStrictEqual(Object.keys(candidate).sort(), ['fact_id', 'source_ids', 'value']),
      'canonical_fact_shape_invalid',
    );
    requireCondition(
      typeof candidate.fact_id === 'string' && /^qa016\.[A-Z]+-[0-9]{2}\.observation$/.test(candidate.fact_id),
      'canonical_fact_id_invalid',
    );
    requireCondition(!factIds.has(candidate.fact_id), 'canonical_fact_id_duplicate');
    factIds.add(candidate.fact_id);
    requireCondition(
      candidate.value && ISSUE_IDS.includes(candidate.value.issue_id)
        && candidate.fact_id === `qa016.${candidate.value.issue_id}.observation`,
      'canonical_fact_issue_mismatch',
    );
    requireCondition(
      Array.isArray(candidate.source_ids) && candidate.source_ids.length > 0,
      'canonical_fact_sources_missing',
    );
    requireCondition(
      new Set(candidate.source_ids).size === candidate.source_ids.length,
      'canonical_fact_source_duplicate',
    );
    requireCondition(
      candidate.source_ids.every((sourceId) => sourceIds.has(sourceId)),
      'canonical_fact_source_missing',
    );
    clone(candidate.value);
    return clone(candidate);
  });
}

function normalizeFacts(facts) {
  return facts
    .map((candidate) => canonicalJson(candidate))
    .sort((left, right) => left.fact_id.localeCompare(right.fact_id));
}

function verifyProvenanceEnvelope(envelope) {
  const failures = [];
  let recomputedFacts = [];
  try {
    requireCondition(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'provenance_envelope_invalid');
    requireCondition(envelope.schema_version === PROVENANCE_SCHEMA_VERSION, 'provenance_schema_invalid');
    requireCondition(envelope.verifier && envelope.verifier.id === VERIFIER_ID, 'provenance_verifier_identity_invalid');
    requireCondition(envelope.verifier.version === VERIFIER_VERSION, 'provenance_verifier_version_invalid');
    const rawIndex = validateRawRecords(envelope.raw_records);
    const claimedFacts = validateFacts(envelope.canonical_facts, rawIndex.sourceIds);
    const recomputeInput = deepFreeze(clone({
      schema_version: envelope.schema_version,
      envelope_id: envelope.envelope_id,
      raw_records: envelope.raw_records,
    }));
    recomputedFacts = QA016_PROVENANCE_VERIFIER.recompute(recomputeInput);
    validateFacts(recomputedFacts, rawIndex.sourceIds);
    requireCondition(
      isDeepStrictEqual(normalizeFacts(claimedFacts), normalizeFacts(recomputedFacts)),
      'canonical_facts_not_recomputed_from_raw',
    );
  } catch (error) {
    failures.push(error && error.code || 'provenance_consistency_failed');
  }
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    valid: failures.length === 0,
    failures,
    recomputed_facts: recomputedFacts,
    assurance: PROVENANCE_ASSURANCE,
    limitation: PROVENANCE_LIMITATION,
  };
}

module.exports = Object.freeze({
  ISSUE_IDS,
  PROVENANCE_ASSURANCE,
  PROVENANCE_LIMITATION,
  PROVENANCE_SCHEMA_VERSION,
  QA016_PROVENANCE_VERIFIER,
  RAW_SOURCE_KINDS,
  VERIFIER_ID,
  VERIFIER_VERSION,
  clone,
  recomputeCanonicalFacts,
  verifyProvenanceEnvelope,
});

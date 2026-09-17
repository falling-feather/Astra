import {
  AdminGroundedBusinessMoveV4Schema,
  DecisionRationaleSourceSchema,
  FlagshipContentReferenceV4Schema,
  GroundedCollaborationPlanV4Schema,
  GroundedEvidenceAuthorizationV4Schema,
  GroundedKnowledgeCitationV4Schema,
  GroundedCollaborationRefreshRecordV4Schema,
  GroundedRetrievalResultV4Schema,
  GroundedDispatchDecisionV4Schema,
  type AdminGroundedBusinessMoveV4,
  type FlagshipContentReferenceV4,
  type TeacherGroundedCollaborationEpisodeV4,
  type DecisionRationaleSource,
  type GroundedCollaborationPlanV4,
  type GroundedEvidenceAuthorizationV4,
  type GroundedKnowledgeCitationV4,
  type GroundedCollaborationRefreshRecordV4,
  type GroundedRetrievalResultV4,
} from "@ronggang/contracts";

export const GroundedCollaborationRecordV4Version =
  "grounded-collaboration-record/4.0.0" as const;

export type GroundedCollaborationPolicyV4 =
  | "single_agent"
  | "fixed_team"
  | "affected_set";

export type GroundedMovePositionV4 =
  | "propose"
  | "challenge"
  | "needs_evidence"
  | "revise"
  | "joint";

export interface GroundedEvidenceSnapshotV4 {
  evidenceRef: string;
  evidenceKind: string;
  objectRefs: string[];
  contentHash: string;
}

export interface GroundedCollaborationRequestSnapshotV4 {
  requestHash: string;
  studentBindingHash: string;
  episodeTemplateRef: string;
  sourceWorldStateVersion: number;
  triggerEventRef: string;
  affectedObjectRefs: string[];
  claimRefs: string[];
  evidence: GroundedEvidenceSnapshotV4[];
  riskLevel: "low" | "medium" | "high";
  policy: GroundedCollaborationPolicyV4;
  maximumSelectedAgents: number;
  executionBudgetMicros: number;
  retrieval?: GroundedRetrievalResultV4;
  evidenceAuthorization?: GroundedEvidenceAuthorizationV4;
}

export interface GroundedAgentTaskRecordV4 {
  agentTaskRef: string;
  episodeId: string;
  moveIndex: number;
  moveKind: AdminGroundedBusinessMoveV4["moveKind"];
  agentTemplateRef: string;
  professionalRoleId: string;
  status: "completed" | "failed";
  idempotencyKey: string;
  observationRef: string;
  createdAt: string;
  completedAt: string;
}

export interface GroundedAgentObservationRecordV4 {
  observationRef: string;
  agentTaskRef: string;
  sourceWorldStateVersion: number;
  affectedObjectRefs: string[];
  groundedClaimRefs: string[];
  knowledgeRefs: string[];
  evidenceRefs: string[];
  predecessorMoveRefs: string[];
  inputHash: string;
  authorizationHash?: string;
  retrievalResultHash?: string;
}

export interface GroundedAgentIntentRecordV4 {
  intentRef: string;
  agentTaskRef: string;
  observationRef: string;
  moveId: string;
  position: GroundedMovePositionV4;
  groundedClaimRefs: string[];
  knowledgeRefs: string[];
  evidenceRefs: string[];
  predecessorMoveRefs: string[];
  outputHash: string;
  authority: "proposal_only";
}

export interface GroundedAgentRunRecordV4 {
  agentRunRef: string;
  agentTaskRef: string;
  observationRef: string;
  intentRef: string;
  status: "completed" | "degraded" | "failed";
  executionMode: "deterministic_demo" | "live";
  providerId: string | null;
  modelId: string | null;
  promptTemplateRef: string;
  traceRef: string;
  latencyMs: number;
  estimatedCostMicros: number;
  fallbackReason:
    | "model_unavailable"
    | "model_failed"
    | "model_invalid"
    | "model_ungrounded"
    | "budget_exhausted"
    | null;
  outputHash: string | null;
  startedAt: string;
  completedAt: string;
}

export interface GroundedStudentDecisionRecordV4 {
  bindingHash: string;
  decisionRef: string;
  decision: "accept" | "request_evidence" | "reject";
  rationale: string;
  rationaleSource?: DecisionRationaleSource;
  decidedAt: string;
  requestHash: string;
}

export interface GroundedWorldConsequenceReceiptV4 {
  receiptRef: string;
  sourceWorldStateVersion: number;
  resultingWorldStateVersion: number;
  worldConsequenceRef: string;
  worldEventContentHash: string;
  committedAt: string;
  payloadHash: string;
}

export interface GroundedCollaborationFailureV4 {
  reasonCode:
    | "no_applicable_agent"
    | "knowledge_not_grounded"
    | "move_sequence_incomplete"
    | "agent_execution_failed"
    | "version_hash_drift";
  safeMessage: string;
  failedMoveRef: string | null;
}

export interface GroundedCollaborationRecordV4 {
  recordVersion: typeof GroundedCollaborationRecordV4Version;
  recordRevision: number;
  episodeId: string;
  sessionId: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  request: GroundedCollaborationRequestSnapshotV4;
  plan?: GroundedCollaborationPlanV4;
  refreshHistory?: GroundedCollaborationRefreshRecordV4[];
  dispatchDecisions: TeacherGroundedCollaborationEpisodeV4["dispatchDecisions"];
  tasks: GroundedAgentTaskRecordV4[];
  observations: GroundedAgentObservationRecordV4[];
  runs: GroundedAgentRunRecordV4[];
  intents: GroundedAgentIntentRecordV4[];
  moves: AdminGroundedBusinessMoveV4[];
  jointProposal: {
    jointProposalId: string;
    sourceMoveRefs: string[];
    publicSummary: string;
    recommendedActionRefs: string[];
    groundedClaimRefs: string[];
    evidenceRefs: string[];
    riskLevel: "low" | "medium" | "high";
    requiresTeacherGate: boolean;
    authority: "proposal_only";
    contentHash: string;
  } | null;
  status: "in_progress" | "joint_proposal_ready" | "failed" | "student_decided" | "completed";
  failure: GroundedCollaborationFailureV4 | null;
  studentDecision: GroundedStudentDecisionRecordV4 | null;
  worldConsequence: GroundedWorldConsequenceReceiptV4 | null;
  createdAt: string;
  updatedAt: string;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const expectedMoveKinds = [
  "proposal",
  "challenge",
  "evidence_request",
  "revision",
  "joint_proposal",
] as const;

function assertRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4 知识协作记录非法：${message}`);
}

function unique(values: readonly string[], label: string): void {
  assertRecord(new Set(values).size === values.length, `${label}不得重复`);
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}

function assertMoveCitationAuthorization(
  citations: readonly GroundedKnowledgeCitationV4[],
  authorization: GroundedEvidenceAuthorizationV4,
): void {
  const allowed = new Map(authorization.allowedFragments.map((fragment) => (
    [fragment.fragmentRef, fragment]
  )));
  for (const citation of citations) {
    const fragment = allowed.get(citation.fragmentRef ?? citation.knowledgeRef);
    assertRecord(fragment !== undefined, "历史动作引用了未授权片段");
    assertRecord(fragment.knowledgeRef === citation.knowledgeRef, "历史动作知识授权漂移");
    assertRecord(citation.sourceDocumentRef === fragment.sourceDocumentRef, "历史动作来源文档漂移");
    assertRecord(citation.sourceRevision === fragment.sourceRevision, "历史动作来源版本漂移");
    assertRecord(citation.fragmentHash === fragment.fragmentHash, "历史动作片段哈希漂移");
    assertRecord(citation.sourceRef === fragment.sourceRef, "历史动作来源引用漂移");
    assertRecord(citation.sourceKind === fragment.sourceKind, "历史动作来源类型漂移");
    assertRecord(citation.sourceUrl === fragment.sourceUrl, "历史动作来源 URL 漂移");
    assertRecord(citation.sourceTitle === fragment.sourceTitle, "历史动作来源标题漂移");
    assertRecord(citation.snippet === fragment.snippet, "历史动作短引漂移");
    assertRecord(citation.locator === fragment.locator, "历史动作定位漂移");
    assertRecord(citation.reviewStatus === fragment.reviewStatus, "历史动作复核状态漂移");
    assertRecord((citation.expiresAt ?? null) === fragment.expiresAt, "历史动作有效期漂移");
    assertRecord((citation.revokedAt ?? null) === fragment.revokedAt, "历史动作撤回状态漂移");
  }
}

export function validateGroundedCollaborationRecordV4(
  value: GroundedCollaborationRecordV4,
): GroundedCollaborationRecordV4 {
  assertRecord(value.recordVersion === GroundedCollaborationRecordV4Version, "记录版本不支持");
  assertRecord(Number.isInteger(value.recordRevision) && value.recordRevision >= 0, "修订号非法");
  assertRecord(idPattern.test(value.episodeId) && idPattern.test(value.sessionId), "会话或 Episode ID 非法");
  FlagshipContentReferenceV4Schema.parse(value.flagshipContentRef);
  assertRecord(hashPattern.test(value.request.requestHash), "请求哈希非法");
  assertRecord(hashPattern.test(value.request.studentBindingHash), "学生绑定哈希非法");
  assertRecord(idPattern.test(value.request.episodeTemplateRef), "Episode 模板引用非法");
  assertRecord(idPattern.test(value.request.triggerEventRef), "触发事件引用非法");
  assertRecord(Number.isInteger(value.request.sourceWorldStateVersion) && value.request.sourceWorldStateVersion >= 0, "来源世界版本非法");
  assertRecord(["low", "medium", "high"].includes(value.request.riskLevel), "风险等级非法");
  assertRecord(["single_agent", "fixed_team", "affected_set"].includes(value.request.policy), "协作策略非法");
  assertRecord(Number.isInteger(value.request.maximumSelectedAgents) && value.request.maximumSelectedAgents >= 1 && value.request.maximumSelectedAgents <= 5, "选择预算非法");
  assertRecord(Number.isInteger(value.request.executionBudgetMicros) && value.request.executionBudgetMicros >= 0, "成本预算非法");
  if (value.request.retrieval) {
    GroundedRetrievalResultV4Schema.parse(value.request.retrieval);
    assertRecord(
      value.request.evidenceAuthorization !== undefined
        && value.request.retrieval.authorizationHash
          === value.request.evidenceAuthorization.authorizationHash,
      "检索结果没有绑定可信授权范围",
    );
    const authorizedFragments = new Map(
      value.request.evidenceAuthorization!.allowedFragments.map((fragment) => (
        [fragment.fragmentRef, fragment]
      )),
    );
    for (const citation of value.request.retrieval.citations) {
      const fragment = authorizedFragments.get(citation.fragmentRef);
      assertRecord(fragment !== undefined, "检索结果携带未授权片段");
      assertRecord(fragment.knowledgeRef === citation.knowledgeRef, "检索知识授权漂移");
      assertRecord(fragment.sourceDocumentRef === citation.sourceDocumentRef, "检索文档授权漂移");
      assertRecord(fragment.sourceRevision === citation.sourceRevision, "检索版本授权漂移");
      assertRecord(fragment.fragmentHash === citation.fragmentHash, "检索片段哈希授权漂移");
      assertRecord(fragment.sourceRef === citation.sourceRef, "检索稳定来源引用漂移");
      assertRecord(fragment.sourceKind === citation.sourceKind, "检索来源类型漂移");
      assertRecord(fragment.sourceUrl === citation.sourceUrl, "检索来源 URL 漂移");
      assertRecord(fragment.sourceTitle === citation.sourceTitle, "检索来源标题漂移");
      assertRecord(fragment.snippet === citation.snippet, "检索短引授权漂移");
      assertRecord(fragment.locator === citation.locator, "检索定位授权漂移");
      assertRecord(fragment.reviewStatus === citation.reviewStatus, "检索复核状态授权漂移");
      assertRecord(fragment.effectiveAt === citation.effectiveAt, "检索生效时间授权漂移");
      assertRecord(fragment.expiresAt === citation.expiresAt, "检索有效期授权漂移");
      assertRecord(fragment.revokedAt === citation.revokedAt, "检索撤回状态授权漂移");
      assertRecord(sameSet(fragment.objectRefs, citation.objectRefs), "检索对象授权漂移");
      assertRecord(sameSet(fragment.supportsClaimRefs, citation.supportsClaimRefs), "检索 Claim 授权漂移");
      assertRecord(sameSet(fragment.evidenceKinds, citation.evidenceKinds), "检索证据类型授权漂移");
    }
  }
  if (value.request.evidenceAuthorization) {
    GroundedEvidenceAuthorizationV4Schema.parse(value.request.evidenceAuthorization);
  }
  if (value.plan) {
    GroundedCollaborationPlanV4Schema.parse(value.plan);
    assertRecord(
      value.request.retrieval !== undefined
        && value.plan.retrievalQueryHash === value.request.retrieval.queryHash
        && value.plan.retrievalResultHash === value.request.retrieval.resultHash,
      "动态协作计划没有绑定本轮检索结果",
    );
  }
  if (value.refreshHistory) {
    unique(value.refreshHistory.map((item) => item.refreshId), "补证刷新");
    for (const refresh of value.refreshHistory) {
      GroundedCollaborationRefreshRecordV4Schema.parse(refresh);
    }
  }
  assertRecord(value.request.affectedObjectRefs.length > 0, "受影响对象不能为空");
  assertRecord(value.request.claimRefs.length > 0, "Claim 不能为空");
  unique(value.request.affectedObjectRefs, "受影响对象");
  unique(value.request.claimRefs, "Claim");
  assertRecord(value.request.affectedObjectRefs.every((item) => idPattern.test(item)), "受影响对象引用非法");
  assertRecord(value.request.claimRefs.every((item) => idPattern.test(item)), "Claim 引用非法");
  unique(value.request.evidence.map((item) => item.evidenceRef), "证据");
  for (const evidence of value.request.evidence) {
    assertRecord(idPattern.test(evidence.evidenceRef) && idPattern.test(evidence.evidenceKind), "证据引用非法");
    assertRecord(hashPattern.test(evidence.contentHash), "证据内容哈希非法");
    assertRecord(evidence.objectRefs.length > 0, "证据对象不能为空");
    unique(evidence.objectRefs, `${evidence.evidenceRef} 对象`);
    assertRecord(evidence.objectRefs.every((item) => idPattern.test(item)), "证据对象引用非法");
    assertRecord(
      evidence.objectRefs.some((item) => value.request.affectedObjectRefs.includes(item)),
      "证据没有命中本轮受影响对象",
    );
  }

  assertRecord(value.dispatchDecisions.length === 14, "必须逐项记录十四个候选智能体");
  const dispatchDecisions = value.dispatchDecisions.map((decision) => (
    GroundedDispatchDecisionV4Schema.parse(decision)
  ));
  unique(dispatchDecisions.map((decision) => decision.agentTemplateRef), "调度决定");
  const selected = new Set(dispatchDecisions.filter((decision) => (
    decision.decision === "selected"
  )).map((decision) => decision.agentTemplateRef));
  assertRecord(selected.size <= value.request.maximumSelectedAgents, "选中智能体超过预算");

  unique(value.tasks.map((task) => task.agentTaskRef), "Task");
  unique(value.tasks.map((task) => task.idempotencyKey), "Task 幂等键");
  unique(value.observations.map((item) => item.observationRef), "Observation");
  unique(value.runs.map((run) => run.agentRunRef), "Run");
  unique(value.intents.map((intent) => intent.intentRef), "Intent");
  unique(value.moves.map((move) => move.moveId), "Move");
  assertRecord(
    value.tasks.length === value.observations.length
      && value.tasks.length === value.runs.length
      && value.tasks.length === value.intents.length
      && value.tasks.length === value.moves.length,
    "Task/Observation/Run/Intent/Move 数量必须闭合",
  );
  const plannedSteps = value.plan?.steps ?? expectedMoveKinds.map((moveKind, index) => ({
    stepId: `legacy-step-${index}`,
    moveKind,
    agentTemplateRef: "",
    position: "propose" as const,
  }));
  assertRecord(value.moves.length <= plannedSteps.length, "协作动作超过当前计划步骤");
  const currentEvidenceRefs = value.request.evidence.map((item) => item.evidenceRef);
  const hasRefreshHistory = (value.refreshHistory?.length ?? 0) > 0;
  const currentAuthorization = value.request.evidenceAuthorization;
  const historicalAuthorizations = (value.refreshHistory ?? [])
    .map((refresh) => refresh.previousAuthorization)
    .filter((authorization): authorization is GroundedEvidenceAuthorizationV4 => (
      authorization !== null
    ));
  const seenMoves = new Set<string>();
  for (const [index, rawMove] of value.moves.entries()) {
    const move = AdminGroundedBusinessMoveV4Schema.parse(rawMove);
    const task = value.tasks[index]!;
    const observation = value.observations[index]!;
    const run = value.runs[index]!;
    const intent = value.intents[index]!;
    const plannedStep = plannedSteps[index];
    assertRecord(plannedStep !== undefined, "协作动作超出当前计划");
    assertRecord(move.moveKind === plannedStep.moveKind, "协作动作顺序非法");
    assertRecord(selected.has(move.agentTemplateRef), "未选中智能体产生了动作");
    if (value.plan) {
      assertRecord(move.agentTemplateRef === plannedStep.agentTemplateRef, "动态计划智能体漂移");
      assertRecord(intent.position === plannedStep.position, "动态计划立场漂移");
    }
    assertRecord(task.episodeId === value.episodeId, "Task Episode 引用漂移");
    assertRecord(task.status === "completed", "已持久动作的 Task 必须完成");
    assertRecord(task.moveIndex === index && task.moveKind === move.moveKind, "Task 动作位置漂移");
    assertRecord(task.agentTemplateRef === move.agentTemplateRef, "Task 与 Move 智能体漂移");
    assertRecord(task.observationRef === observation.observationRef, "Task 与 Observation 漂移");
    assertRecord(hashPattern.test(task.idempotencyKey), "Task 幂等键非法");
    assertRecord(validDate(task.createdAt) && validDate(task.completedAt), "Task 时间戳非法");
    assertRecord(observation.agentTaskRef === task.agentTaskRef, "Observation 与 Task 引用漂移");
    assertRecord(observation.sourceWorldStateVersion === value.request.sourceWorldStateVersion, "Observation 世界版本漂移");
    assertRecord(sameSet(observation.affectedObjectRefs, value.request.affectedObjectRefs), "Observation 受影响对象漂移");
    assertRecord(sameSet(observation.groundedClaimRefs, value.request.claimRefs), "Observation Claim 漂移");
    assertRecord(observation.evidenceRefs.every((ref) => currentEvidenceRefs.includes(ref)), "Observation 证据漂移");
    if (!hasRefreshHistory) {
      assertRecord(sameSet(observation.evidenceRefs, currentEvidenceRefs), "Observation 证据漂移");
    }
    assertRecord(hashPattern.test(observation.inputHash), "Observation 输入哈希非法");
    if (observation.authorizationHash !== undefined) {
      assertRecord(hashPattern.test(observation.authorizationHash), "Observation 授权哈希非法");
    }
    if (observation.retrievalResultHash !== undefined) {
      assertRecord(hashPattern.test(observation.retrievalResultHash), "Observation 检索哈希非法");
    }
    if (observation.authorizationHash !== undefined) {
      const authorization = [currentAuthorization, ...historicalAuthorizations]
        .find((candidate) => candidate?.authorizationHash === observation.authorizationHash);
      assertRecord(authorization !== undefined, "历史动作缺少其生成时的授权快照");
      assertMoveCitationAuthorization(move.knowledgeCitations, authorization);
    }
    assertRecord(run.agentTaskRef === task.agentTaskRef && run.observationRef === observation.observationRef, "Run 因果引用漂移");
    assertRecord(run.status !== "failed" && run.outputHash !== null, "已持久动作的 Run 不得失败或缺输出");
    assertRecord(["deterministic_demo", "live"].includes(run.executionMode), "Run 执行模式非法");
    assertRecord(Number.isInteger(run.latencyMs) && run.latencyMs >= 0, "Run 延迟非法");
    assertRecord(Number.isInteger(run.estimatedCostMicros) && run.estimatedCostMicros >= 0, "Run 成本非法");
    assertRecord(validDate(run.startedAt) && validDate(run.completedAt), "Run 时间戳非法");
    assertRecord(idPattern.test(run.promptTemplateRef) && idPattern.test(run.traceRef), "Run 模板或 Trace 引用非法");
    if (run.executionMode === "live") {
      assertRecord(run.status === "completed" && run.fallbackReason === null, "Live Run 不得降级");
      assertRecord(run.providerId !== null && run.providerId.trim().length > 0, "Live Run 缺供应方");
      assertRecord(run.modelId !== null && run.modelId.trim().length > 0, "Live Run 缺模型");
    } else {
      assertRecord(run.providerId === null && run.modelId === null, "确定性 Run 不得携带供应方");
      assertRecord(run.fallbackReason !== null, "确定性 Run 缺降级原因");
    }
    assertRecord(intent.agentTaskRef === task.agentTaskRef && intent.observationRef === observation.observationRef, "Intent 因果引用漂移");
    assertRecord(intent.intentRef === run.intentRef && intent.moveId === move.moveId, "Run/Intent/Move 引用漂移");
    assertRecord(move.execution.agentTaskRef === task.agentTaskRef, "管理员 Task 引用漂移");
    assertRecord(move.execution.agentRunRef === run.agentRunRef, "管理员 Run 引用漂移");
    assertRecord(move.execution.observationRef === observation.observationRef, "管理员 Observation 引用漂移");
    assertRecord(move.execution.intentRef === intent.intentRef, "管理员 Intent 引用漂移");
    assertRecord(move.outputHash === intent.outputHash && move.outputHash === run.outputHash, "输出哈希漂移");
    assertRecord(hashPattern.test(move.outputHash), "Move 输出哈希非法");
    const expectedPredecessors = value.moves.slice(0, index).map((item) => item.moveId);
    assertRecord(sameSequence(move.predecessorMoveRefs, expectedPredecessors), "Move 前驱链不完整或乱序");
    assertRecord(sameSequence(intent.predecessorMoveRefs, expectedPredecessors), "Intent 前驱链不完整或乱序");
    assertRecord(sameSet(move.groundedClaimRefs, value.request.claimRefs), "Move Claim 漂移");
    assertRecord(sameSet(intent.groundedClaimRefs, value.request.claimRefs), "Intent Claim 漂移");
    assertRecord(move.evidenceRefs.every((ref) => currentEvidenceRefs.includes(ref)), "Move 证据漂移");
    if (!hasRefreshHistory) {
      assertRecord(sameSet(move.evidenceRefs, currentEvidenceRefs), "Move 证据漂移");
    }
    assertRecord(sameSet(intent.evidenceRefs, move.evidenceRefs), "Intent 证据漂移");
    assertRecord(sameSet(intent.knowledgeRefs, move.knowledgeCitations.map((item) => item.knowledgeRef)), "Intent 知识引用漂移");
    assertRecord(intent.authority === "proposal_only", "Intent 越过提案权限");
    seenMoves.add(move.moveId);
  }

  if (value.status === "in_progress") {
    assertRecord(value.failure === null && value.jointProposal === null, "进行中记录提前形成结论");
  } else if (value.status === "failed") {
    assertRecord(value.failure !== null && value.jointProposal === null, "失败记录缺少失败或携带联合提案");
    assertRecord(value.studentDecision === null && value.worldConsequence === null, "失败记录不得携带学生决定或世界后果");
  } else {
    assertRecord(value.failure === null && value.jointProposal !== null, "成功记录缺少联合提案");
    assertRecord(value.moves.length === plannedSteps.length, "联合提案必须完成当前计划动作");
    assertRecord(
      value.jointProposal.sourceMoveRefs.length === plannedSteps.length
        && sameSequence(value.jointProposal.sourceMoveRefs, value.moves.map((move) => move.moveId)),
      "联合提案没有引用完整动作链",
    );
    assertRecord(value.jointProposal.authority === "proposal_only", "联合提案越权");
    assertRecord(hashPattern.test(value.jointProposal.contentHash), "联合提案内容哈希非法");
    assertRecord(sameSet(value.jointProposal.groundedClaimRefs, value.request.claimRefs), "联合提案 Claim 漂移");
    assertRecord(sameSet(value.jointProposal.evidenceRefs, value.request.evidence.map((item) => item.evidenceRef)), "联合提案证据漂移");
    if (["student_decided", "completed"].includes(value.status)) {
      assertRecord(value.studentDecision !== null, "已决定记录缺少学生决定");
    } else {
      assertRecord(value.studentDecision === null, "未决定记录提前携带学生决定");
    }
    if (value.status === "completed") {
      assertRecord(value.worldConsequence !== null, "完成记录缺少权威世界后果");
    } else {
      assertRecord(value.worldConsequence === null, "未完成记录不得携带世界后果");
    }
  }
  if (value.studentDecision) {
    if (value.studentDecision.rationaleSource !== undefined) {
      DecisionRationaleSourceSchema.parse(value.studentDecision.rationaleSource);
    }
    assertRecord(hashPattern.test(value.studentDecision.bindingHash), "学生绑定哈希非法");
    assertRecord(hashPattern.test(value.studentDecision.requestHash), "学生决定哈希非法");
    assertRecord(validDate(value.studentDecision.decidedAt), "学生决定时间非法");
  }
  if (value.worldConsequence) {
    assertRecord(value.worldConsequence.resultingWorldStateVersion === value.worldConsequence.sourceWorldStateVersion + 1, "世界后果版本必须单步前进");
    assertRecord(value.worldConsequence.sourceWorldStateVersion === value.request.sourceWorldStateVersion, "世界后果来源版本漂移");
    assertRecord(idPattern.test(value.worldConsequence.receiptRef) && idPattern.test(value.worldConsequence.worldConsequenceRef), "世界后果引用非法");
    assertRecord(hashPattern.test(value.worldConsequence.worldEventContentHash), "世界后果哈希非法");
    assertRecord(hashPattern.test(value.worldConsequence.payloadHash), "世界收据载荷哈希非法");
    assertRecord(validDate(value.worldConsequence.committedAt), "世界后果时间戳非法");
  }
  assertRecord(validDate(value.createdAt) && validDate(value.updatedAt), "时间戳非法");
  return structuredClone({
    ...value,
    dispatchDecisions,
    moves: value.moves.map((move) => AdminGroundedBusinessMoveV4Schema.parse(move)),
  });
}

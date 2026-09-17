import {
  GoldPilotAnalysisPlanSchema,
  GoldPilotAnalysisReportSchema,
  GoldPilotAnalysisSchemaVersion,
  GoldPilotAnalysisStabilitySummarySchema,
  GoldPilotAnalysisWorkloadSummarySchema,
  GoldPilotArmSummarySchema,
  GoldPilotParticipantAssignmentSchema,
  GoldPilotProtocolSchema,
  GoldPilotReadinessFreezeReceiptSchema,
  GoldPilotRunFinalizeInputSchema,
  GoldPilotRunMetricsSchema,
  GoldPilotRunReceiptSchema,
  GoldPilotStudyDesignBindingSchema,
  GoldPilotStudySchemaVersion,
  GoldPilotStudySummarySchema,
  GoldPilotStudyViewSchema,
  GoldPilotTaskAllocationSchema,
  GoldPilotWorkflowViewSchema,
  GoldPilotWorkloadPhaseSchema,
  GoldPilotWorkloadSegmentSchema,
  GoldPilotWorkloadSummarySchema,
  type ActionSourceMode,
  type ActorKind,
  type GoldPilotAnalysisMetricId,
  type GoldPilotAnalysisPlan,
  type GoldPilotAnalysisReport,
  type GoldPilotArm,
  type GoldPilotParticipantAssignment,
  type GoldPilotProtocol,
  type GoldPilotReadinessFreezeReceipt,
  type GoldPilotRunFinalizeInput,
  type GoldPilotRunMetrics,
  type GoldPilotRunReceipt,
  type GoldPilotStudyDesignBinding,
  type GoldPilotStudySummary,
  type GoldPilotStudyView,
  type GoldPilotTaskAllocation,
  type GoldPilotWorkflowView,
  type GoldPilotWorkloadPhase,
  type GoldPilotWorkloadSegment,
  type RoleId,
  type WorldEvent,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import { z } from "zod";

const pilotClaimBoundary =
  "试点工作流只记录去标识分组、权威事件聚合和服务端计时收据。达到样本门槛仅表示可进入描述性分析，不自动证明学习增益、因果效应或可推广性；真实招募、知情说明、退出记录和访谈材料必须在线下独立留存。";
const pilotAnalysisClaimBoundary =
  "本报告仅按采集前冻结的完整配对规则汇总去标识聚合指标；退出、技术失败和缺失运行全部进入样本流转但不插补、不进入配对差值。报告只支持描述性比较与设计诊断，不自动证明学习增益、因果效应、统计显著性或可推广性。";

const pilotProtocolFrozenAt = "2026-07-30T00:00:00.000Z";
const pilotAnalysisPlanFrozenAt = "2026-07-30T00:00:00.000Z";
const analysisMetricIds = [
  "valid_student_action_count",
  "active_question_count",
  "evidence_record_count",
  "distinct_evidence_ref_count",
  "plan_revision_count",
  "task_completion_count",
  "scene_completion",
  "teacher_intervention_count",
  "teacher_model_correction_count",
  "failure_event_count",
  "degraded_event_count",
  "timeout_count",
  "manual_takeover_count",
  "recovery_count",
  "observed_duration_seconds",
] as const satisfies readonly GoldPilotAnalysisMetricId[];
const failureEventTypes = new Set([
  "media_processing_step_failed",
  "agent_task_failed",
  "learning_candidate_generation_failed",
]);
const recoveryEventTypes = new Set([
  "media_processing_retry_requested",
  "director_recovery_requested",
  "evaluation_branch_retry_requested",
  "learning_candidate_generation_retry_requested",
]);
const teacherInterventionCommands = new Set([
  "approve_candidate_event",
  "reject_candidate_event",
]);

function withoutHash<T extends Record<string, unknown>>(
  value: T,
  key: keyof T,
): Omit<T, keyof T> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

export function createGoldPilotProtocol(
  frozenAt = pilotProtocolFrozenAt,
): GoldPilotProtocol {
  const unsigned = {
    schemaVersion: GoldPilotStudySchemaVersion,
    protocolVersion: "gold-pilot-protocol/1.0.0" as const,
    design: "within_participant_crossover" as const,
    arms: [
      "course_platform_only",
      "full_dual_dimension",
    ] as const,
    targetMinimums: {
      teacherCount: 3 as const,
      studentCount: 20 as const,
      runsPerStudent: 2 as const,
    },
    studentMetrics: [
      "valid_action_count",
      "active_question_count",
      "evidence_record_count",
      "distinct_evidence_ref_count",
      "plan_revision_count",
      "task_completion_count",
      "scene_completion",
      "exit_category",
    ] as const,
    teacherWorkloadPhases: [
      "configuration",
      "intervention",
      "final_review",
    ] as const,
    stabilityMetrics: [
      "failure_event_count",
      "degraded_event_count",
      "timeout_count",
      "manual_takeover_count",
      "recovery_count",
    ] as const,
    ethics: {
      informedExplanationRequired: true as const,
      minimumDataOnly: true as const,
      deidentifiedAliasesOnly: true as const,
      withdrawalAllowed: true as const,
      freeTextExitReasonForbidden: true as const,
    },
    frozenAt,
  };
  return GoldPilotProtocolSchema.parse({
    ...unsigned,
    protocolHash: hashValue(unsigned),
  });
}

export function createGoldPilotAnalysisPlan(
  frozenAt = pilotAnalysisPlanFrozenAt,
): GoldPilotAnalysisPlan {
  const unsigned = {
    schemaVersion: GoldPilotAnalysisSchemaVersion,
    planVersion: "gold-pilot-analysis-plan/1.0.0" as const,
    unitOfAnalysis: "complete_participant_pair" as const,
    inclusionRule: "both_preregistered_runs_completed" as const,
    missingDataRule: "no_imputation" as const,
    inferenceMode: "descriptive_only" as const,
    targetMinimums: {
      teacherCount: 3 as const,
      completePairCount: 20 as const,
    },
    metrics: [...analysisMetricIds],
    diagnostics: [
      "condition_sequence",
      "task_sequence",
      "condition_by_task_cell",
      "period_by_arm",
    ] as const,
    frozenAt,
  };
  return GoldPilotAnalysisPlanSchema.parse({
    ...unsigned,
    planHash: hashValue(unsigned),
  });
}

export const GoldPilotStudyStateSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  studyId: z.string().regex(/^gps_[a-f0-9]{24}$/u),
  anchorSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  createdByActorId: z.string().min(1).max(160),
  protocol: GoldPilotProtocolSchema,
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
  taskAllocations: z.array(GoldPilotTaskAllocationSchema).default([]),
  analysisPlan: GoldPilotAnalysisPlanSchema.nullable().default(null),
  designBinding: GoldPilotStudyDesignBindingSchema.nullable().default(null),
  analysisReport: GoldPilotAnalysisReportSchema.nullable().default(null),
  workloadSegments: z.array(GoldPilotWorkloadSegmentSchema),
  runReceipts: z.array(GoldPilotRunReceiptSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
}).strict().superRefine((state, context) => {
  if (
    hashValue(withoutHash(state.protocol, "protocolHash"))
    !== state.protocol.protocolHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["protocol", "protocolHash"],
      message: "试点预登记协议哈希不匹配",
    });
  }
  if (
    state.analysisPlan
    && hashValue(withoutHash(state.analysisPlan, "planHash"))
      !== state.analysisPlan.planHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["analysisPlan", "planHash"],
      message: "试点分析计划哈希不匹配",
    });
  }
  const aliases = state.participantAssignments.map(
    (assignment) => assignment.participantAlias,
  );
  if (new Set(aliases).size !== aliases.length) {
    context.addIssue({
      code: "custom",
      path: ["participantAssignments"],
      message: "去标识参与者别名不得重复",
    });
  }
  const slots = state.participantAssignments.flatMap(
    (assignment) => assignment.runs.map((run) => ({
      participantAlias: assignment.participantAlias,
      ...run,
    })),
  );
  const sessionIds = slots.map((slot) => slot.sessionId);
  if (new Set(sessionIds).size !== sessionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["participantAssignments"],
      message: "每个试点运行必须独占一个训练会话",
    });
  }
  if (!sessionIds.includes(state.anchorSessionId)) {
    context.addIssue({
      code: "custom",
      path: ["anchorSessionId"],
      message: "试点锚点会话必须属于预登记运行",
    });
  }
  if (state.taskAllocations.length > 0) {
    const allocationAliases = state.taskAllocations.map(
      (allocation) => allocation.participantAlias,
    );
    const expectedAliases = [...aliases].sort();
    if (
      new Set(allocationAliases).size !== allocationAliases.length
      || hashValue([...allocationAliases].sort()) !== hashValue(expectedAliases)
    ) {
      context.addIssue({
        code: "custom",
        path: ["taskAllocations"],
        message: "试点任务分配必须与参与者分组一一对应",
      });
    }
    const assignmentsByAlias = new Map(
      state.participantAssignments.map((assignment) => [
        assignment.participantAlias,
        assignment,
      ]),
    );
    for (const allocation of state.taskAllocations) {
      const assignment = assignmentsByAlias.get(
        allocation.participantAlias,
      );
      if (
        !assignment
        || allocation.runs.some((run, index) => (
          run.sessionId !== assignment.runs[index]?.sessionId
          || run.period !== assignment.runs[index]?.period
        ))
      ) {
        context.addIssue({
          code: "custom",
          path: ["taskAllocations", allocation.participantAlias],
          message: "试点任务分配的期次或会话与交叉分组不一致",
        });
      }
    }
  }
  if (state.designBinding) {
    if (
      !state.analysisPlan
      || state.taskAllocations.length === 0
      || hashValue(withoutHash(state.designBinding, "bindingHash"))
        !== state.designBinding.bindingHash
      || state.designBinding.readinessProtocolHash
        !== state.protocol.protocolHash
      || state.designBinding.assignmentSnapshotHash
        !== hashValue(state.participantAssignments)
      || state.designBinding.taskAllocationSnapshotHash
        !== hashValue(state.taskAllocations)
      || state.designBinding.analysisPlanHash
        !== state.analysisPlan?.planHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["designBinding"],
        message: "试点来源绑定与协议、分组、任务或分析计划不一致",
      });
    }
  }
  const slotBySession = new Map(slots.map((slot) => [slot.sessionId, slot]));
  const segmentIds = new Set<string>();
  const activeTimerTeachers = new Set<string>();
  for (const segment of state.workloadSegments) {
    const slot = slotBySession.get(segment.sessionId);
    const unsignedSegment = withoutHash(segment, "receiptHash");
    if (
      segment.studyId !== state.studyId
      || !slot
      || slot.teacherAlias !== segment.teacherAlias
      || segmentIds.has(segment.segmentId)
      || (
        segment.receiptHash !== null
        && hashValue(unsignedSegment) !== segment.receiptHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["workloadSegments", segment.segmentId],
        message: "教师负担计时段与预登记分组或收据哈希不一致",
      });
    }
    if (segment.finishedAt === null) {
      if (activeTimerTeachers.has(segment.teacherAlias)) {
        context.addIssue({
          code: "custom",
          path: ["workloadSegments", segment.segmentId],
          message: "同一教师不能同时存在多个活动负担计时段",
        });
      }
      activeTimerTeachers.add(segment.teacherAlias);
    }
    segmentIds.add(segment.segmentId);
  }
  const receiptSessions = new Set<string>();
  for (const receipt of state.runReceipts) {
    const slot = slotBySession.get(receipt.sessionId);
    const unsignedReceipt = withoutHash(receipt, "receiptHash");
    if (
      receipt.studyId !== state.studyId
      || !slot
      || slot.participantAlias !== receipt.participantAlias
      || slot.period !== receipt.period
      || slot.arm !== receipt.arm
      || slot.teacherAlias !== receipt.teacherAlias
      || receiptSessions.has(receipt.sessionId)
      || hashValue(unsignedReceipt) !== receipt.receiptHash
      || (
        receipt.arm === "course_platform_only"
        && receipt.metrics.worldInteractionActionCount !== 0
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["runReceipts", receipt.receiptId],
        message: "试点运行收据与预登记分组、条件门禁或内容哈希不一致",
      });
    }
    receiptSessions.add(receipt.sessionId);
  }
  if (state.analysisReport) {
    const report = state.analysisReport;
    if (
      !state.analysisPlan
      || !state.designBinding
      || report.studyId !== state.studyId
      || report.analysisPlan.planHash !== state.analysisPlan.planHash
      || report.designBinding.bindingHash
        !== state.designBinding.bindingHash
      || report.sourceRevision !== state.revision - 1
      || report.sourceSnapshot.designBindingHash
        !== state.designBinding.bindingHash
      || report.sourceSnapshot.readinessFreezeReceiptHash
        !== state.designBinding.readinessFreezeReceiptHash
      || report.sourceSnapshot.protocolHash !== state.protocol.protocolHash
      || report.sourceSnapshot.assignmentSnapshotHash
        !== hashValue(state.participantAssignments)
      || report.sourceSnapshot.taskAllocationSnapshotHash
        !== hashValue(state.taskAllocations)
      || report.sourceSnapshot.runReceiptSnapshotHash
        !== hashValue(state.runReceipts)
      || report.sourceSnapshot.workloadSnapshotHash
        !== hashValue(state.workloadSegments)
      || hashValue(withoutHash(report, "reportHash")) !== report.reportHash
      || state.runReceipts.length !== slots.length
      || state.workloadSegments.some(
        (segment) => segment.finishedAt === null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["analysisReport"],
        message: "试点分析报告与冻结来源快照不一致",
      });
    }
  }
});
export type GoldPilotStudyState = z.infer<
  typeof GoldPilotStudyStateSchema
>;

export type GoldPilotStudyErrorCode =
  | "active_timer_conflict"
  | "arm_policy_violation"
  | "idempotency_conflict"
  | "invalid_run_snapshot"
  | "invalid_study_input"
  | "revision_conflict"
  | "session_not_registered"
  | "status_conflict"
  | "study_exists"
  | "study_not_found"
  | "timer_not_found";

export class GoldPilotStudyError extends Error {
  readonly code: GoldPilotStudyErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: GoldPilotStudyErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GoldPilotStudyError";
    this.code = code;
    this.details = details;
  }
}

export interface GoldPilotStudyStore {
  create(state: GoldPilotStudyState): Promise<GoldPilotStudyState>;
  get(studyId: string): Promise<GoldPilotStudyState | null>;
  list(sessionId: string): Promise<GoldPilotStudyState[]>;
  startWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: GoldPilotWorkloadSegment;
    updatedAt: string;
  }): Promise<GoldPilotStudyState>;
  finishWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: GoldPilotWorkloadSegment;
    updatedAt: string;
  }): Promise<GoldPilotStudyState>;
  finalizeRun(input: {
    studyId: string;
    expectedRevision: number;
    receipt: GoldPilotRunReceipt;
    updatedAt: string;
  }): Promise<GoldPilotStudyState>;
  freezeAnalysisReport(input: {
    studyId: string;
    expectedRevision: number;
    report: GoldPilotAnalysisReport;
    updatedAt: string;
  }): Promise<GoldPilotStudyState>;
}

function cloneState(state: GoldPilotStudyState): GoldPilotStudyState {
  return GoldPilotStudyStateSchema.parse(structuredClone(state));
}

function sessionsForState(state: GoldPilotStudyState): Set<string> {
  return new Set(state.participantAssignments.flatMap(
    (assignment) => assignment.runs.map((run) => run.sessionId),
  ));
}

function requireState(
  states: Map<string, GoldPilotStudyState>,
  studyId: string,
): GoldPilotStudyState {
  const state = states.get(studyId);
  if (!state) {
    throw new GoldPilotStudyError(
      "study_not_found",
      "教学试点不存在",
      { studyId },
    );
  }
  return state;
}

function assertRevision(
  state: GoldPilotStudyState,
  expectedRevision: number,
): void {
  if (state.revision !== expectedRevision) {
    throw new GoldPilotStudyError(
      "revision_conflict",
      "教学试点已被其他请求更新，请刷新后重试",
      {
        studyId: state.studyId,
        expectedRevision,
        actualRevision: state.revision,
      },
    );
  }
}

function assertAnalysisNotFrozen(state: GoldPilotStudyState): void {
  if (state.analysisReport) {
    throw new GoldPilotStudyError(
      "status_conflict",
      "试点分析报告已经冻结，来源收据不得继续变更",
      {
        studyId: state.studyId,
        reportId: state.analysisReport.reportId,
      },
    );
  }
}

export class InMemoryGoldPilotStudyStore implements GoldPilotStudyStore {
  readonly #states = new Map<string, GoldPilotStudyState>();

  async create(state: GoldPilotStudyState): Promise<GoldPilotStudyState> {
    const parsed = GoldPilotStudyStateSchema.parse(state);
    if (this.#states.has(parsed.studyId)) {
      throw new GoldPilotStudyError(
        "study_exists",
        "同一预登记分组已经建立教学试点",
        { studyId: parsed.studyId },
      );
    }
    const sessions = sessionsForState(parsed);
    for (const existing of this.#states.values()) {
      if ([...sessions].some((sessionId) => (
        sessionsForState(existing).has(sessionId)
      ))) {
        throw new GoldPilotStudyError(
          "study_exists",
          "训练会话已经绑定其他教学试点",
          { studyId: existing.studyId },
        );
      }
    }
    this.#states.set(parsed.studyId, cloneState(parsed));
    return cloneState(parsed);
  }

  async get(studyId: string): Promise<GoldPilotStudyState | null> {
    const state = this.#states.get(studyId);
    return state ? cloneState(state) : null;
  }

  async list(sessionId: string): Promise<GoldPilotStudyState[]> {
    return [...this.#states.values()]
      .filter((state) => sessionsForState(state).has(sessionId))
      .sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || right.studyId.localeCompare(left.studyId)
      ))
      .map(cloneState);
  }

  async startWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: GoldPilotWorkloadSegment;
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    const state = requireState(this.#states, input.studyId);
    assertRevision(state, input.expectedRevision);
    assertAnalysisNotFrozen(state);
    if (state.workloadSegments.some((segment) => (
      segment.teacherAlias === input.segment.teacherAlias
      && segment.finishedAt === null
    ))) {
      throw new GoldPilotStudyError(
        "active_timer_conflict",
        "当前教师已有进行中的负担计时段",
        {
          sessionId: input.segment.sessionId,
          teacherAlias: input.segment.teacherAlias,
        },
      );
    }
    const next = GoldPilotStudyStateSchema.parse({
      ...state,
      workloadSegments: [
        ...state.workloadSegments,
        GoldPilotWorkloadSegmentSchema.parse(input.segment),
      ],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.studyId, cloneState(next));
    return cloneState(next);
  }

  async finishWorkloadSegment(input: {
    studyId: string;
    expectedRevision: number;
    segment: GoldPilotWorkloadSegment;
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    const state = requireState(this.#states, input.studyId);
    assertRevision(state, input.expectedRevision);
    assertAnalysisNotFrozen(state);
    const index = state.workloadSegments.findIndex(
      (segment) => segment.segmentId === input.segment.segmentId,
    );
    if (index < 0) {
      throw new GoldPilotStudyError(
        "timer_not_found",
        "教师负担计时段不存在",
        { segmentId: input.segment.segmentId },
      );
    }
    if (state.workloadSegments[index]!.finishedAt !== null) {
      throw new GoldPilotStudyError(
        "status_conflict",
        "教师负担计时段已经结束",
        { segmentId: input.segment.segmentId },
      );
    }
    const segments = [...state.workloadSegments];
    segments[index] = GoldPilotWorkloadSegmentSchema.parse(input.segment);
    const next = GoldPilotStudyStateSchema.parse({
      ...state,
      workloadSegments: segments,
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.studyId, cloneState(next));
    return cloneState(next);
  }

  async finalizeRun(input: {
    studyId: string;
    expectedRevision: number;
    receipt: GoldPilotRunReceipt;
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    const state = requireState(this.#states, input.studyId);
    assertRevision(state, input.expectedRevision);
    assertAnalysisNotFrozen(state);
    if (state.runReceipts.some(
      (receipt) => receipt.sessionId === input.receipt.sessionId,
    )) {
      throw new GoldPilotStudyError(
        "status_conflict",
        "当前试点运行已经形成冻结收据",
        { sessionId: input.receipt.sessionId },
      );
    }
    const next = GoldPilotStudyStateSchema.parse({
      ...state,
      runReceipts: [
        ...state.runReceipts,
        GoldPilotRunReceiptSchema.parse(input.receipt),
      ],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.studyId, cloneState(next));
    return cloneState(next);
  }

  async freezeAnalysisReport(input: {
    studyId: string;
    expectedRevision: number;
    report: GoldPilotAnalysisReport;
    updatedAt: string;
  }): Promise<GoldPilotStudyState> {
    const state = requireState(this.#states, input.studyId);
    assertRevision(state, input.expectedRevision);
    assertAnalysisNotFrozen(state);
    const next = GoldPilotStudyStateSchema.parse({
      ...state,
      analysisReport: GoldPilotAnalysisReportSchema.parse(input.report),
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.studyId, cloneState(next));
    return cloneState(next);
  }
}

interface PilotRunSlot {
  participantAlias: string;
  sequence: "course_then_dual" | "dual_then_course";
  period: 1 | 2;
  sessionId: string;
  arm: GoldPilotArm;
  roleId: RoleId;
  teacherAlias: string;
}

function runSlots(
  state: Pick<GoldPilotStudyState, "participantAssignments">,
): PilotRunSlot[] {
  return state.participantAssignments.flatMap((assignment) => (
    assignment.runs.map((run) => ({
      participantAlias: assignment.participantAlias,
      sequence: assignment.sequence,
      ...run,
    }))
  ));
}

function requireRunSlot(
  state: GoldPilotStudyState,
  sessionId: string,
): PilotRunSlot {
  const slot = runSlots(state).find((run) => run.sessionId === sessionId);
  if (!slot) {
    throw new GoldPilotStudyError(
      "session_not_registered",
      "当前会话未登记到教学试点",
      { studyId: state.studyId, sessionId },
    );
  }
  return slot;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((
    values.reduce((sum, value) => sum + value, 0) / values.length
  ) * 100) / 100;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  return Math.round(value * 100) / 100;
}

function armSummary(
  arm: GoldPilotArm,
  receipts: readonly GoldPilotRunReceipt[],
) {
  const matching = receipts.filter((receipt) => receipt.arm === arm);
  const included = matching.filter(
    (receipt) => receipt.disposition.outcome === "completed",
  );
  return GoldPilotArmSummarySchema.parse({
    arm,
    finalizedRunCount: matching.length,
    completedRunCount: included.length,
    completionRate: matching.length === 0
      ? null
      : included.length / matching.length,
    meanValidStudentActionCount: mean(
      included.map((receipt) => receipt.metrics.validStudentActionCount),
    ),
    meanActiveQuestionCount: mean(
      included.map((receipt) => receipt.metrics.activeQuestionCount),
    ),
    meanEvidenceRecordedCount: mean(
      included.map((receipt) => receipt.metrics.evidenceRecordedCount),
    ),
    meanPlanRevisionCount: mean(
      included.map((receipt) => receipt.metrics.planRevisionCount),
    ),
    meanTaskCompletionCount: mean(
      included.map((receipt) => receipt.metrics.taskCompletionCount),
    ),
    meanTeacherInterventionCount: mean(
      included.map((receipt) => receipt.metrics.teacherInterventionCount),
    ),
    meanTeacherModelCorrectionCount: mean(
      included.map(
        (receipt) => receipt.metrics.teacherModelCorrectionCount,
      ),
    ),
    meanFailureEventCount: mean(
      included.map((receipt) => receipt.metrics.failureEventCount),
    ),
    meanObservedDurationSeconds: mean(
      included.map((receipt) => receipt.metrics.observedDurationSeconds),
    ),
  });
}

function workloadSummary(
  phase: GoldPilotWorkloadPhase,
  segments: readonly GoldPilotWorkloadSegment[],
) {
  const matching = segments.filter((segment) => (
    segment.phase === phase && segment.durationSeconds !== null
  ));
  const durations = matching.map((segment) => segment.durationSeconds!);
  return GoldPilotWorkloadSummarySchema.parse({
    phase,
    closedSegmentCount: matching.length,
    totalDurationSeconds: durations.reduce((sum, value) => sum + value, 0),
    meanDurationSeconds: mean(durations),
  });
}

function studySummary(state: GoldPilotStudyState): GoldPilotStudySummary {
  const teachers = new Set(
    runSlots(state).map((slot) => slot.teacherAlias),
  );
  const studentCount = state.participantAssignments.length;
  const expectedRunCount = studentCount * 2;
  const finalizedRunCount = state.runReceipts.length;
  const completedRunCount = state.runReceipts.filter(
    (receipt) => receipt.disposition.outcome === "completed",
  ).length;
  const withdrawnRunCount = state.runReceipts.filter(
    (receipt) => receipt.disposition.outcome === "withdrawn",
  ).length;
  const technicalFailureRunCount = state.runReceipts.filter(
    (receipt) => receipt.disposition.outcome === "technical_failure",
  ).length;
  const receiptBySession = new Map(
    state.runReceipts.map((receipt) => [receipt.sessionId, receipt]),
  );
  const completePairCount = state.participantAssignments.filter(
    (assignment) => assignment.runs.every((run) => (
      receiptBySession.get(run.sessionId)?.disposition.outcome === "completed"
    )),
  ).length;
  const incompletePairCount = studentCount - completePairCount;
  const openWorkloadSegmentCount = state.workloadSegments.filter(
    (segment) => segment.finishedAt === null,
  ).length;
  const analysisFreezeReady = Boolean(
    state.analysisPlan
    && state.designBinding
    && state.taskAllocations.length === studentCount
    && finalizedRunCount === expectedRunCount
    && openWorkloadSegmentCount === 0,
  );
  const targetReady = analysisFreezeReady
    && teachers.size >= state.protocol.targetMinimums.teacherCount
    && completePairCount >= state.protocol.targetMinimums.studentCount;
  const missingTargets: string[] = [];
  if (teachers.size < state.protocol.targetMinimums.teacherCount) {
    missingTargets.push(
      `还需 ${state.protocol.targetMinimums.teacherCount - teachers.size} 名去标识教师样本`,
    );
  }
  if (studentCount < state.protocol.targetMinimums.studentCount) {
    missingTargets.push(
      `还需 ${state.protocol.targetMinimums.studentCount - studentCount} 名去标识学生样本`,
    );
  }
  if (finalizedRunCount < expectedRunCount) {
    missingTargets.push(
      `还需 ${expectedRunCount - finalizedRunCount} 个冻结运行收据`,
    );
  }
  if (completePairCount < state.protocol.targetMinimums.studentCount) {
    missingTargets.push(
      `还需 ${state.protocol.targetMinimums.studentCount - completePairCount} 个完整配对样本`,
    );
  }
  if (openWorkloadSegmentCount > 0) {
    missingTargets.push(
      `还需关闭 ${openWorkloadSegmentCount} 个教师负担计时段`,
    );
  }
  if (!state.analysisPlan || !state.designBinding) {
    missingTargets.push("缺少采集前分析计划或来源绑定，不能冻结分析报告");
  }
  return GoldPilotStudySummarySchema.parse({
    status: state.analysisReport
      ? "analysis_frozen"
      : targetReady
        ? "ready_for_analysis"
        : "insufficient",
    teacherCount: teachers.size,
    studentCount,
    expectedRunCount,
    finalizedRunCount,
    completedRunCount,
    withdrawnRunCount,
    technicalFailureRunCount,
    completePairCount,
    incompletePairCount,
    openWorkloadSegmentCount,
    analysisFreezeReady,
    analysisReportStatus: state.analysisReport?.status ?? null,
    missingTargets,
    armSummaries: [
      armSummary("course_platform_only", state.runReceipts),
      armSummary("full_dual_dimension", state.runReceipts),
    ],
    workloadSummaries: [
      workloadSummary("configuration", state.workloadSegments),
      workloadSummary("intervention", state.workloadSegments),
      workloadSummary("final_review", state.workloadSegments),
    ],
    claimBoundary: pilotClaimBoundary,
  });
}

function studyView(state: GoldPilotStudyState): GoldPilotStudyView {
  return GoldPilotStudyViewSchema.parse({
    schemaVersion: GoldPilotStudySchemaVersion,
    studyId: state.studyId,
    anchorSessionId: state.anchorSessionId,
    protocol: state.protocol,
    participantAssignments: state.participantAssignments,
    taskAllocations: state.taskAllocations,
    analysisPlan: state.analysisPlan,
    designBinding: state.designBinding,
    analysisReport: state.analysisReport,
    workloadSegments: state.workloadSegments,
    runReceipts: state.runReceipts,
    summary: studySummary(state),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    revision: state.revision,
  });
}

interface CompletePilotPair {
  course: GoldPilotRunReceipt;
  dual: GoldPilotRunReceipt;
}

const designCellDefinitions = [
  {
    cellId: "course_then_dual__task_a_then_b",
    conditionSequence: "course_then_dual",
    taskSequence: "task_a_then_b",
  },
  {
    cellId: "course_then_dual__task_b_then_a",
    conditionSequence: "course_then_dual",
    taskSequence: "task_b_then_a",
  },
  {
    cellId: "dual_then_course__task_a_then_b",
    conditionSequence: "dual_then_course",
    taskSequence: "task_a_then_b",
  },
  {
    cellId: "dual_then_course__task_b_then_a",
    conditionSequence: "dual_then_course",
    taskSequence: "task_b_then_a",
  },
] as const;

function completePilotPairs(
  state: GoldPilotStudyState,
): CompletePilotPair[] {
  const receiptBySession = new Map(
    state.runReceipts.map((receipt) => [receipt.sessionId, receipt]),
  );
  return state.participantAssignments.flatMap((assignment) => {
    const receipts = assignment.runs.map(
      (run) => receiptBySession.get(run.sessionId),
    );
    if (
      receipts.some((receipt) => (
        receipt?.disposition.outcome !== "completed"
      ))
    ) {
      return [];
    }
    const course = receipts.find(
      (receipt) => receipt?.arm === "course_platform_only",
    );
    const dual = receipts.find(
      (receipt) => receipt?.arm === "full_dual_dimension",
    );
    return course && dual ? [{ course, dual }] : [];
  });
}

function analysisMetricValue(
  metricId: GoldPilotAnalysisMetricId,
  receipt: GoldPilotRunReceipt,
): number {
  switch (metricId) {
    case "valid_student_action_count":
      return receipt.metrics.validStudentActionCount;
    case "active_question_count":
      return receipt.metrics.activeQuestionCount;
    case "evidence_record_count":
      return receipt.metrics.evidenceRecordedCount;
    case "distinct_evidence_ref_count":
      return receipt.metrics.distinctEvidenceRefCount;
    case "plan_revision_count":
      return receipt.metrics.planRevisionCount;
    case "task_completion_count":
      return receipt.metrics.taskCompletionCount;
    case "scene_completion":
      return receipt.metrics.sceneCompleted ? 1 : 0;
    case "teacher_intervention_count":
      return receipt.metrics.teacherInterventionCount;
    case "teacher_model_correction_count":
      return receipt.metrics.teacherModelCorrectionCount;
    case "failure_event_count":
      return receipt.metrics.failureEventCount;
    case "degraded_event_count":
      return receipt.metrics.degradedEventCount;
    case "timeout_count":
      return receipt.metrics.timeoutCount;
    case "manual_takeover_count":
      return receipt.metrics.manualTakeoverCount;
    case "recovery_count":
      return receipt.metrics.recoveryCount;
    case "observed_duration_seconds":
      return receipt.metrics.observedDurationSeconds;
  }
}

function buildGoldPilotAnalysisReport(
  state: GoldPilotStudyState,
  frozenAt: string,
): GoldPilotAnalysisReport {
  const analysisPlan = state.analysisPlan;
  const designBinding = state.designBinding;
  if (
    !analysisPlan
    || !designBinding
    || state.taskAllocations.length !== state.participantAssignments.length
  ) {
    throw new GoldPilotStudyError(
      "status_conflict",
      "试点缺少采集前分析计划、任务分配或来源绑定",
      { studyId: state.studyId },
    );
  }
  const slots = runSlots(state);
  const openWorkloadSegmentCount = state.workloadSegments.filter(
    (segment) => segment.finishedAt === null,
  ).length;
  if (
    state.runReceipts.length !== slots.length
    || openWorkloadSegmentCount > 0
  ) {
    throw new GoldPilotStudyError(
      "status_conflict",
      "全部预登记运行形成收据且教师计时关闭后，才能冻结分析报告",
      {
        expectedRunCount: slots.length,
        finalizedRunCount: state.runReceipts.length,
        openWorkloadSegmentCount,
      },
    );
  }

  const pairs = completePilotPairs(state);
  const completeAliases = new Set(
    pairs.map((pair) => pair.course.participantAlias),
  );
  const teachers = new Set(slots.map((slot) => slot.teacherAlias));
  const exitCategoryCounts = {
    completed: 0,
    participantWithdrawal: 0,
    consentRevoked: 0,
    otherWithdrawal: 0,
    timeout: 0,
    degradedService: 0,
    stuckSession: 0,
    manualAbort: 0,
    otherTechnical: 0,
  };
  for (const receipt of state.runReceipts) {
    switch (receipt.disposition.exitCategory) {
      case "completed":
        exitCategoryCounts.completed += 1;
        break;
      case "participant_withdrawal":
        exitCategoryCounts.participantWithdrawal += 1;
        break;
      case "consent_revoked":
        exitCategoryCounts.consentRevoked += 1;
        break;
      case "other_withdrawal":
        exitCategoryCounts.otherWithdrawal += 1;
        break;
      case "timeout":
        exitCategoryCounts.timeout += 1;
        break;
      case "degraded_service":
        exitCategoryCounts.degradedService += 1;
        break;
      case "stuck_session":
        exitCategoryCounts.stuckSession += 1;
        break;
      case "manual_abort":
        exitCategoryCounts.manualAbort += 1;
        break;
      case "other_technical":
        exitCategoryCounts.otherTechnical += 1;
        break;
    }
  }
  const completedRunCount = exitCategoryCounts.completed;
  const withdrawnRunCount = exitCategoryCounts.participantWithdrawal
    + exitCategoryCounts.consentRevoked
    + exitCategoryCounts.otherWithdrawal;
  const technicalFailureRunCount = exitCategoryCounts.timeout
    + exitCategoryCounts.degradedService
    + exitCategoryCounts.stuckSession
    + exitCategoryCounts.manualAbort
    + exitCategoryCounts.otherTechnical;

  const allocationByAlias = new Map(
    state.taskAllocations.map((allocation) => [
      allocation.participantAlias,
      allocation,
    ]),
  );
  const designCells = designCellDefinitions.map((definition) => {
    const matching = state.participantAssignments.filter((assignment) => (
      assignment.sequence === definition.conditionSequence
      && allocationByAlias.get(assignment.participantAlias)?.taskSequence
        === definition.taskSequence
    ));
    return {
      ...definition,
      registeredParticipantCount: matching.length,
      completePairCount: matching.filter(
        (assignment) => completeAliases.has(assignment.participantAlias),
      ).length,
    };
  });
  const registrationCellCounts = designCells.map(
    (cell) => cell.registeredParticipantCount,
  );
  const maximumRegistrationCellImbalance =
    Math.max(...registrationCellCounts)
    - Math.min(...registrationCellCounts);

  const registeredTaskRuns = state.participantAssignments.flatMap(
    (assignment) => {
      const allocation = allocationByAlias.get(
        assignment.participantAlias,
      )!;
      return assignment.runs.map((run, index) => ({
        ...run,
        taskVariantId: allocation.runs[index]!.taskVariantId,
      }));
    },
  );
  const completedSessions = new Set(
    state.runReceipts.filter(
      (receipt) => receipt.disposition.outcome === "completed",
    ).map((receipt) => receipt.sessionId),
  );
  const taskVariantIds = [...new Set(
    registeredTaskRuns.map((run) => run.taskVariantId),
  )].sort();
  const armTaskCells = (
    ["course_platform_only", "full_dual_dimension"] as const
  ).flatMap((arm) => taskVariantIds.map((taskVariantId) => {
    const matching = registeredTaskRuns.filter((run) => (
      run.arm === arm && run.taskVariantId === taskVariantId
    ));
    return {
      arm,
      taskVariantId,
      registeredRunCount: matching.length,
      completedRunCount: matching.filter(
        (run) => completedSessions.has(run.sessionId),
      ).length,
    };
  }));
  const periodArmCells = ([1, 2] as const).flatMap((period) => (
    ["course_platform_only", "full_dual_dimension"] as const
  ).map((arm) => {
    const matching = slots.filter((slot) => (
      slot.period === period && slot.arm === arm
    ));
    return {
      period,
      arm,
      registeredRunCount: matching.length,
      completedRunCount: matching.filter(
        (slot) => completedSessions.has(slot.sessionId),
      ).length,
    };
  }));

  const pairedMetrics = analysisPlan.metrics.map((metricId) => {
    const courseValues = pairs.map(
      (pair) => analysisMetricValue(metricId, pair.course),
    );
    const dualValues = pairs.map(
      (pair) => analysisMetricValue(metricId, pair.dual),
    );
    const differences = dualValues.map(
      (value, index) => value - courseValues[index]!,
    );
    return {
      metricId,
      completePairCount: pairs.length,
      coursePlatformMean: mean(courseValues),
      fullDualMean: mean(dualValues),
      meanDifference: mean(differences),
      medianDifference: median(differences),
      minimumDifference: differences.length > 0
        ? Math.min(...differences)
        : null,
      maximumDifference: differences.length > 0
        ? Math.max(...differences)
        : null,
    };
  });

  const workloadSummaries = (
    ["configuration", "intervention", "final_review"] as const
  ).map((phase) => {
    const durations = state.workloadSegments.filter((segment) => (
      segment.phase === phase && segment.durationSeconds !== null
    )).map((segment) => segment.durationSeconds!);
    return GoldPilotAnalysisWorkloadSummarySchema.parse({
      phase,
      closedSegmentCount: durations.length,
      totalDurationSeconds: durations.reduce(
        (sum, duration) => sum + duration,
        0,
      ),
      meanDurationSeconds: mean(durations),
      medianDurationSeconds: median(durations),
    });
  });
  const includedReceipts = pairs.flatMap((pair) => [
    pair.course,
    pair.dual,
  ]);
  const stabilitySummaries = (
    ["course_platform_only", "full_dual_dimension"] as const
  ).map((arm) => {
    const matching = includedReceipts.filter(
      (receipt) => receipt.arm === arm,
    );
    return GoldPilotAnalysisStabilitySummarySchema.parse({
      arm,
      includedCompletedRunCount: matching.length,
      failureEventCount: matching.reduce(
        (sum, receipt) => sum + receipt.metrics.failureEventCount,
        0,
      ),
      degradedEventCount: matching.reduce(
        (sum, receipt) => sum + receipt.metrics.degradedEventCount,
        0,
      ),
      timeoutCount: matching.reduce(
        (sum, receipt) => sum + receipt.metrics.timeoutCount,
        0,
      ),
      manualTakeoverCount: matching.reduce(
        (sum, receipt) => sum + receipt.metrics.manualTakeoverCount,
        0,
      ),
      recoveryCount: matching.reduce(
        (sum, receipt) => sum + receipt.metrics.recoveryCount,
        0,
      ),
    });
  });
  const missingTargets: string[] = [];
  if (teachers.size < analysisPlan.targetMinimums.teacherCount) {
    missingTargets.push(
      `还需 ${analysisPlan.targetMinimums.teacherCount - teachers.size} 名去标识教师样本`,
    );
  }
  if (pairs.length < analysisPlan.targetMinimums.completePairCount) {
    missingTargets.push(
      `还需 ${analysisPlan.targetMinimums.completePairCount - pairs.length} 个完整配对样本`,
    );
  }
  if (maximumRegistrationCellImbalance > 1) {
    missingTargets.push("条件顺序与任务顺序的登记四格不平衡");
  }
  const missingWorkloadPhases = workloadSummaries.filter(
    (summary) => summary.closedSegmentCount === 0,
  ).map((summary) => summary.phase);
  if (missingWorkloadPhases.length > 0) {
    missingTargets.push(
      `教师负担缺少阶段：${missingWorkloadPhases.join(", ")}`,
    );
  }

  const sourceSnapshot = {
    designBindingHash: designBinding.bindingHash,
    readinessFreezeReceiptHash:
      designBinding.readinessFreezeReceiptHash,
    protocolHash: state.protocol.protocolHash,
    assignmentSnapshotHash: hashValue(state.participantAssignments),
    taskAllocationSnapshotHash: hashValue(state.taskAllocations),
    runReceiptSnapshotHash: hashValue(state.runReceipts),
    workloadSnapshotHash: hashValue(state.workloadSegments),
  };
  const reportId = `gpar_${hashValue({
    studyId: state.studyId,
    analysisPlanHash: analysisPlan.planHash,
    sourceSnapshot,
  }).slice(0, 24)}`;
  const limitations = [
    "仅汇总服务端冻结的结构化聚合收据，不读取原始聊天、录音、真实姓名或自由文本退出原因。",
    "仅完整完成两种条件的参与者进入配对差值；退出、技术失败和缺失运行不插补。",
    "顺序、任务、时期与稳定性指标只用于诊断设计执行，不自动构成因果或显著性结论。",
    "真实招募代表性、知情过程、教师访谈和线下异常仍需由试点团队独立核验。",
  ];
  const unsigned = {
    schemaVersion: GoldPilotAnalysisSchemaVersion,
    reportId,
    studyId: state.studyId,
    status: missingTargets.length === 0
      ? "target_ready_for_descriptive_comparison" as const
      : "exploratory" as const,
    analysisPlan,
    designBinding,
    sourceRevision: state.revision,
    sourceSnapshot,
    participantFlow: {
      registeredTeacherCount: teachers.size,
      registeredParticipantCount: state.participantAssignments.length,
      expectedRunCount: slots.length,
      finalizedRunCount: state.runReceipts.length,
      unfinalizedRunCount: slots.length - state.runReceipts.length,
      completedRunCount,
      withdrawnRunCount,
      technicalFailureRunCount,
      completePairCount: pairs.length,
      incompletePairCount:
        state.participantAssignments.length - pairs.length,
      analysisIncludedRunCount: pairs.length * 2,
      exitCategoryCounts,
    },
    designDiagnostics: {
      designCells,
      armTaskCells,
      periodArmCells,
      maximumRegistrationCellImbalance,
      balancedAtRegistration: maximumRegistrationCellImbalance <= 1,
    },
    pairedMetrics,
    workloadSummaries,
    stabilitySummaries,
    missingTargets,
    limitations,
    claimBoundary: pilotAnalysisClaimBoundary,
    frozenAt,
  };
  return GoldPilotAnalysisReportSchema.parse({
    ...unsigned,
    reportHash: hashValue(unsigned),
  });
}

function eventSnapshotHash(events: readonly WorldEvent[]): string {
  return hashValue(events.map((event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    stateVersion: event.stateVersion,
    timestamp: event.timestamp,
    actorIdHash: hashValue(event.actorId),
    summaryHash: hashValue(event.summary),
    payloadHash: hashValue(event.payload),
    actionContext: event.actionContext,
  })));
}

function nestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : null;
}

function runMetrics(
  events: readonly WorldEvent[],
  participantActorId: string,
): GoldPilotRunMetrics {
  const actionEvents = new Map<string, WorldEvent[]>();
  for (const event of events) {
    const rootActionId = event.actionContext?.rootActionId;
    if (!rootActionId) continue;
    const group = actionEvents.get(rootActionId) ?? [];
    group.push(event);
    actionEvents.set(rootActionId, group);
  }
  const studentActions = [...actionEvents.values()].filter((group) => (
    group.some((event) => event.actorId === participantActorId)
  ));
  const studentRootIds = new Set(studentActions.map(
    (group) => group[0]!.actionContext!.rootActionId,
  ));
  const studentActionContexts = studentActions.map(
    (group) => group[0]!.actionContext!,
  );
  const evidenceEvents = events.filter((event) => (
    event.eventType === "evidence_recorded"
    && event.actionContext
    && studentRootIds.has(event.actionContext.rootActionId)
  ));
  const evidenceRefs = new Set<string>();
  for (const event of evidenceEvents) {
    const evidence = nestedRecord(event.payload, "evidence");
    if (typeof evidence?.evidenceId === "string") {
      evidenceRefs.add(evidence.evidenceId);
    }
  }
  const teacherInterventionRoots = new Set(events.flatMap((event) => (
    event.actionContext
    && teacherInterventionCommands.has(event.actionContext.commandName)
      ? [event.actionContext.rootActionId]
      : []
  )));
  let teacherModelCorrectionCount = 0;
  for (const event of events) {
    if (event.eventType !== "teacher_reviewed") continue;
    const review = nestedRecord(event.payload, "review");
    const dimensions = Array.isArray(review?.dimensions)
      ? review.dimensions
      : [];
    teacherModelCorrectionCount += dimensions.filter((dimension) => (
      dimension
      && typeof dimension === "object"
      && typeof (dimension as Record<string, unknown>).delta === "number"
      && (dimension as Record<string, unknown>).delta !== 0
    )).length;
  }
  const degradedEventCount = events.filter((event) => (
    JSON.stringify(event.payload).includes('"degraded"')
  )).length;
  const timeoutCount = events.filter((event) => (
    JSON.stringify(event.payload).toLowerCase().includes("timeout")
  )).length;
  const timestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const observedDurationSeconds = timestamps.length < 2
    ? 0
    : Math.max(
      0,
      Math.floor((timestamps.at(-1)! - timestamps[0]!) / 1_000),
    );
  return GoldPilotRunMetricsSchema.parse({
    eventCount: events.length,
    validStudentActionCount: studentActionContexts.length,
    coursePlatformActionCount: studentActionContexts.filter(
      (context) => context.sourceMode === "course_platform",
    ).length,
    worldInteractionActionCount: studentActionContexts.filter(
      (context) => context.sourceMode === "world_interaction",
    ).length,
    activeQuestionCount: studentActionContexts.filter(
      (context) => context.commandName === "send_role_interaction",
    ).length,
    evidenceRecordedCount: evidenceEvents.length,
    distinctEvidenceRefCount: evidenceRefs.size,
    planRevisionCount: studentActionContexts.filter(
      (context) => context.commandName === "save_artifact_revision",
    ).length,
    taskCompletionCount: studentActionContexts.filter((context) => (
      context.commandName === "record_experience_choice"
      || context.commandName === "submit_for_review"
    )).length,
    sceneCompleted: events.some(
      (event) => event.eventType === "scene_completed",
    ),
    teacherInterventionCount: teacherInterventionRoots.size,
    teacherModelCorrectionCount,
    failureEventCount: events.filter(
      (event) => failureEventTypes.has(event.eventType),
    ).length,
    degradedEventCount,
    timeoutCount,
    manualTakeoverCount: events.filter(
      (event) => event.eventType === "media_processing_manual_supplied",
    ).length,
    recoveryCount: events.filter(
      (event) => recoveryEventTypes.has(event.eventType),
    ).length,
    observedDurationSeconds,
  });
}

function createStudyDesignBinding(
  receipt: GoldPilotReadinessFreezeReceipt,
  analysisPlan: GoldPilotAnalysisPlan,
  boundAt: string,
): GoldPilotStudyDesignBinding {
  const unsigned = {
    schemaVersion: GoldPilotAnalysisSchemaVersion,
    readinessId: receipt.readinessId,
    readinessFreezeReceiptHash: receipt.receiptHash,
    readinessProtocolHash: receipt.protocolHash,
    rubricPackageHash: receipt.rubricPackageHash,
    equivalentTaskPairHash: receipt.equivalentTaskPairHash,
    assignmentSnapshotHash: receipt.assignmentSnapshotHash,
    taskAllocationSnapshotHash: receipt.taskAllocationSnapshotHash,
    contentValiditySnapshotHash: receipt.contentValiditySnapshotHash,
    consentSnapshotHash: receipt.consentSnapshotHash,
    analysisPlanHash: analysisPlan.planHash,
    boundAt,
  };
  return GoldPilotStudyDesignBindingSchema.parse({
    ...unsigned,
    bindingHash: hashValue(unsigned),
  });
}

export interface CreateGoldPilotStudyInput {
  anchorSessionId: string;
  createdByActorId: string;
  participantAssignments: readonly GoldPilotParticipantAssignment[];
  taskAllocations?: readonly GoldPilotTaskAllocation[];
  readinessFreezeReceipt?: GoldPilotReadinessFreezeReceipt;
}

export class GoldPilotStudyCoordinator {
  readonly #store: GoldPilotStudyStore;
  readonly #now: () => string;
  readonly #protocol: GoldPilotProtocol;
  readonly #analysisPlan: GoldPilotAnalysisPlan;

  constructor(
    store: GoldPilotStudyStore,
    options: {
      now?: () => string;
      protocol?: GoldPilotProtocol;
      analysisPlan?: GoldPilotAnalysisPlan;
    } = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#protocol = GoldPilotProtocolSchema.parse(
      options.protocol ?? createGoldPilotProtocol(),
    );
    this.#analysisPlan = GoldPilotAnalysisPlanSchema.parse(
      options.analysisPlan ?? createGoldPilotAnalysisPlan(),
    );
    if (
      hashValue(withoutHash(this.#protocol, "protocolHash"))
      !== this.#protocol.protocolHash
      || hashValue(withoutHash(this.#analysisPlan, "planHash"))
        !== this.#analysisPlan.planHash
    ) {
      throw new GoldPilotStudyError(
        "invalid_study_input",
        "试点预登记协议或分析计划哈希不匹配",
      );
    }
  }

  async createStudy(
    input: CreateGoldPilotStudyInput,
  ): Promise<GoldPilotStudyView> {
    let assignments: GoldPilotParticipantAssignment[];
    try {
      assignments = input.participantAssignments.map((assignment) => (
        GoldPilotParticipantAssignmentSchema.parse(assignment)
      )).sort((left, right) => (
        left.participantAlias.localeCompare(right.participantAlias)
      ));
    } catch (error) {
      throw new GoldPilotStudyError(
        "invalid_study_input",
        "试点参与者分组不符合固定交叉设计",
        { cause: error instanceof Error ? error.message : "invalid" },
      );
    }
    if (assignments.length === 0) {
      throw new GoldPilotStudyError(
        "invalid_study_input",
        "教学试点至少需要一个真实招募后的去标识参与者",
      );
    }
    const aliases = assignments.map(
      (assignment) => assignment.participantAlias,
    );
    const sessionIds = assignments.flatMap(
      (assignment) => assignment.runs.map((run) => run.sessionId),
    );
    if (
      new Set(aliases).size !== aliases.length
      || new Set(sessionIds).size !== sessionIds.length
      || !sessionIds.includes(input.anchorSessionId)
    ) {
      throw new GoldPilotStudyError(
        "invalid_study_input",
        "参与者别名、运行会话必须唯一，且锚点会话必须已登记",
      );
    }
    const hasReadinessReceipt = input.readinessFreezeReceipt !== undefined;
    const hasTaskAllocations = input.taskAllocations !== undefined;
    if (hasReadinessReceipt !== hasTaskAllocations) {
      throw new GoldPilotStudyError(
        "invalid_study_input",
        "采集前冻结收据与任务分配必须同时提供",
      );
    }
    let taskAllocations: GoldPilotTaskAllocation[] = [];
    let readinessReceipt: GoldPilotReadinessFreezeReceipt | null = null;
    if (hasReadinessReceipt && hasTaskAllocations) {
      try {
        readinessReceipt = GoldPilotReadinessFreezeReceiptSchema.parse(
          input.readinessFreezeReceipt,
        );
        taskAllocations = input.taskAllocations!.map((allocation) => (
          GoldPilotTaskAllocationSchema.parse(allocation)
        )).sort((left, right) => (
          left.participantAlias.localeCompare(right.participantAlias)
        ));
      } catch (error) {
        throw new GoldPilotStudyError(
          "invalid_study_input",
          "采集前冻结收据或任务分配不符合固定合同",
          { cause: error instanceof Error ? error.message : "invalid" },
        );
      }
      const allocationByAlias = new Map(
        taskAllocations.map((allocation) => [
          allocation.participantAlias,
          allocation,
        ]),
      );
      const allocationsAligned = taskAllocations.length === assignments.length
        && assignments.every((assignment) => {
          const allocation = allocationByAlias.get(
            assignment.participantAlias,
          );
          return allocation && allocation.runs.every((run, index) => (
            run.sessionId === assignment.runs[index]!.sessionId
            && run.period === assignment.runs[index]!.period
          ));
        });
      if (
        !allocationsAligned
        || hashValue(withoutHash(readinessReceipt, "receiptHash"))
          !== readinessReceipt.receiptHash
        || readinessReceipt.protocolHash !== this.#protocol.protocolHash
        || readinessReceipt.assignmentSnapshotHash
          !== hashValue(assignments)
        || readinessReceipt.taskAllocationSnapshotHash
          !== hashValue(taskAllocations)
      ) {
        throw new GoldPilotStudyError(
          "invalid_study_input",
          "试点分组、任务、协议与采集前冻结收据不一致",
        );
      }
    }
    const createdAt = this.#now();
    const designBinding = readinessReceipt
      ? createStudyDesignBinding(
          readinessReceipt,
          this.#analysisPlan,
          createdAt,
        )
      : null;
    const studyId = `gps_${hashValue({
      namespace: GoldPilotStudySchemaVersion,
      protocolHash: this.#protocol.protocolHash,
      analysisPlanHash: this.#analysisPlan.planHash,
      designBindingHash: designBinding?.bindingHash ?? null,
      assignments,
    }).slice(0, 24)}`;
    const state = GoldPilotStudyStateSchema.parse({
      schemaVersion: GoldPilotStudySchemaVersion,
      studyId,
      anchorSessionId: input.anchorSessionId,
      createdByActorId: input.createdByActorId,
      protocol: this.#protocol,
      participantAssignments: assignments,
      taskAllocations,
      analysisPlan: this.#analysisPlan,
      designBinding,
      analysisReport: null,
      workloadSegments: [],
      runReceipts: [],
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    });
    return studyView(await this.#store.create(state));
  }

  async getWorkflowView(sessionId: string): Promise<GoldPilotWorkflowView> {
    const states = await this.#store.list(sessionId);
    const studies = states.map(studyView);
    const activeState = states[0] ?? null;
    const activeStudy = studies[0] ?? null;
    const currentSlot = activeState
      ? runSlots(activeState).find((run) => run.sessionId === sessionId) ?? null
      : null;
    return GoldPilotWorkflowViewSchema.parse({
      schemaVersion: GoldPilotStudySchemaVersion,
      generatedAt: this.#now(),
      protocol: this.#protocol,
      activeStudy,
      studies,
      currentRun: activeState && currentSlot
        ? {
            studyId: activeState.studyId,
            participantAlias: currentSlot.participantAlias,
            sessionId,
            period: currentSlot.period,
            arm: currentSlot.arm,
            roleId: currentSlot.roleId,
            teacherAlias: currentSlot.teacherAlias,
            finalized: activeState.runReceipts.some(
              (receipt) => receipt.sessionId === sessionId,
            ),
            activeWorkloadSegment:
              activeState.workloadSegments.find((segment) => (
                segment.sessionId === sessionId
                && segment.finishedAt === null
              )) ?? null,
          }
        : null,
      claimBoundary: pilotClaimBoundary,
    });
  }

  async assertSourceModeAllowed(input: {
    sessionId: string;
    actorKind: ActorKind;
    roleId: RoleId;
    sourceMode: ActionSourceMode;
  }): Promise<void> {
    if (input.actorKind !== "student") return;
    const states = await this.#store.list(input.sessionId);
    if (states.length === 0) return;
    const slot = requireRunSlot(states[0]!, input.sessionId);
    if (slot.roleId !== input.roleId) {
      throw new GoldPilotStudyError(
        "arm_policy_violation",
        "当前学生岗位不属于预登记试点运行，拒绝写入受控会话",
        {
          studyId: states[0]!.studyId,
          sessionId: input.sessionId,
          expectedRoleId: slot.roleId,
          actualRoleId: input.roleId,
        },
      );
    }
    if (
      slot.arm === "course_platform_only"
      && input.sourceMode === "world_interaction"
    ) {
      throw new GoldPilotStudyError(
        "arm_policy_violation",
        "当前预登记运行仅允许课程操作平台，服务端已拒绝世界交互来源",
        {
          studyId: states[0]!.studyId,
          sessionId: input.sessionId,
          arm: slot.arm,
        },
      );
    }
  }

  async startWorkloadPhase(
    sessionId: string,
    rawPhase: GoldPilotWorkloadPhase,
  ): Promise<GoldPilotStudyView> {
    const phase = GoldPilotWorkloadPhaseSchema.parse(rawPhase);
    const state = await this.#requireStudyForSession(sessionId);
    const slot = requireRunSlot(state, sessionId);
    if (state.runReceipts.some(
      (receipt) => receipt.sessionId === sessionId,
    )) {
      throw new GoldPilotStudyError(
        "status_conflict",
        "运行已经冻结，不能新增教师负担计时段",
        { sessionId },
      );
    }
    const startedAt = this.#now();
    const segment = GoldPilotWorkloadSegmentSchema.parse({
      schemaVersion: GoldPilotStudySchemaVersion,
      segmentId: `gpsw_${hashValue({
        studyId: state.studyId,
        sessionId,
        phase,
        startedAt,
        revision: state.revision,
      }).slice(0, 24)}`,
      studyId: state.studyId,
      sessionId,
      teacherAlias: slot.teacherAlias,
      phase,
      startedAt,
      finishedAt: null,
      durationSeconds: null,
      receiptHash: null,
    });
    return studyView(await this.#store.startWorkloadSegment({
      studyId: state.studyId,
      expectedRevision: state.revision,
      segment,
      updatedAt: startedAt,
    }));
  }

  async finishWorkloadSegment(
    sessionId: string,
    segmentId: string,
  ): Promise<GoldPilotStudyView> {
    const state = await this.#requireStudyForSession(sessionId);
    const segment = state.workloadSegments.find(
      (candidate) => candidate.segmentId === segmentId,
    );
    if (!segment || segment.sessionId !== sessionId) {
      throw new GoldPilotStudyError(
        "timer_not_found",
        "当前会话不存在该教师负担计时段",
        { sessionId, segmentId },
      );
    }
    if (segment.finishedAt !== null) return studyView(state);
    const finishedAt = this.#now();
    const durationSeconds = Math.max(
      0,
      Math.floor(
        (Date.parse(finishedAt) - Date.parse(segment.startedAt)) / 1_000,
      ),
    );
    const {
      receiptHash: _openReceiptHash,
      ...openSegment
    } = segment;
    const unsigned = {
      ...openSegment,
      finishedAt,
      durationSeconds,
    };
    const finished = GoldPilotWorkloadSegmentSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return studyView(await this.#store.finishWorkloadSegment({
      studyId: state.studyId,
      expectedRevision: state.revision,
      segment: finished,
      updatedAt: finishedAt,
    }));
  }

  async finalizeRun(input: {
    sessionId: string;
    participantActorId: string;
    finalization: GoldPilotRunFinalizeInput;
    events: readonly WorldEvent[];
  }): Promise<GoldPilotStudyView> {
    const finalization = GoldPilotRunFinalizeInputSchema.parse(
      input.finalization,
    );
    const state = await this.#requireStudyForSession(input.sessionId);
    const slot = requireRunSlot(state, input.sessionId);
    if (state.workloadSegments.some((segment) => (
      segment.sessionId === input.sessionId && segment.finishedAt === null
    ))) {
      throw new GoldPilotStudyError(
        "active_timer_conflict",
        "请先结束当前教师负担计时段，再冻结运行收据",
        { sessionId: input.sessionId },
      );
    }
    if (input.events.some((event) => event.sessionId !== input.sessionId)) {
      throw new GoldPilotStudyError(
        "invalid_run_snapshot",
        "运行快照混入其他会话事件",
        { sessionId: input.sessionId },
      );
    }
    const snapshotHash = eventSnapshotHash(input.events);
    const idempotencyHash = hashValue(finalization.idempotencyKey);
    const existing = state.runReceipts.find(
      (receipt) => receipt.sessionId === input.sessionId,
    );
    if (existing) {
      if (
        existing.idempotencyHash === idempotencyHash
        && existing.eventSnapshotHash === snapshotHash
        && hashValue(existing.disposition)
          === hashValue(finalization.disposition)
      ) {
        return studyView(state);
      }
      throw new GoldPilotStudyError(
        "idempotency_conflict",
        "当前运行已绑定不同快照、退出类别或幂等键",
        { sessionId: input.sessionId },
      );
    }
    const metrics = runMetrics(input.events, input.participantActorId);
    if (
      finalization.disposition.outcome === "completed"
      && !metrics.sceneCompleted
    ) {
      throw new GoldPilotStudyError(
        "invalid_run_snapshot",
        "标记完成的试点运行缺少 scene_completed 权威事件",
        { sessionId: input.sessionId },
      );
    }
    if (
      slot.arm === "course_platform_only"
      && metrics.worldInteractionActionCount > 0
    ) {
      throw new GoldPilotStudyError(
        "arm_policy_violation",
        "仅课程操作平台组检测到世界交互行动，拒绝冻结受污染快照",
        {
          sessionId: input.sessionId,
          worldInteractionActionCount: metrics.worldInteractionActionCount,
        },
      );
    }
    const finalizedAt = this.#now();
    const receiptId = `gpsr_${hashValue({
      studyId: state.studyId,
      sessionId: input.sessionId,
      snapshotHash,
    }).slice(0, 24)}`;
    const unsigned = {
      schemaVersion: GoldPilotStudySchemaVersion,
      receiptId,
      studyId: state.studyId,
      participantAlias: slot.participantAlias,
      sessionId: input.sessionId,
      period: slot.period,
      arm: slot.arm,
      teacherAlias: slot.teacherAlias,
      disposition: finalization.disposition,
      metrics,
      eventSnapshotHash: snapshotHash,
      idempotencyHash,
      finalizedAt,
    };
    const receipt = GoldPilotRunReceiptSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return studyView(await this.#store.finalizeRun({
      studyId: state.studyId,
      expectedRevision: state.revision,
      receipt,
      updatedAt: finalizedAt,
    }));
  }

  async freezeAnalysisReport(
    sessionId: string,
  ): Promise<GoldPilotStudyView> {
    const state = await this.#requireStudyForSession(sessionId);
    if (state.analysisReport) return studyView(state);
    const frozenAt = this.#now();
    const report = buildGoldPilotAnalysisReport(state, frozenAt);
    return studyView(await this.#store.freezeAnalysisReport({
      studyId: state.studyId,
      expectedRevision: state.revision,
      report,
      updatedAt: frozenAt,
    }));
  }

  async #requireStudyForSession(
    sessionId: string,
  ): Promise<GoldPilotStudyState> {
    const states = await this.#store.list(sessionId);
    if (states.length === 0) {
      throw new GoldPilotStudyError(
        "study_not_found",
        "当前会话尚未登记教学试点",
        { sessionId },
      );
    }
    return states[0]!;
  }
}

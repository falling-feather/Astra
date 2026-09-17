import {
  GoldPilotConsentEventSchema,
  GoldPilotConsentInputSchema,
  GoldPilotEquivalentTaskPairInputSchema,
  GoldPilotEquivalentTaskPairSchema,
  GoldPilotInformationSheetSchema,
  GoldPilotMinimumDataPolicyInputSchema,
  GoldPilotMinimumDataPolicySchema,
  GoldPilotParticipantAssignmentSchema,
  GoldPilotProtocolSchema,
  GoldPilotReadinessFreezeReceiptSchema,
  GoldPilotReadinessIdSchema,
  GoldPilotReadinessPlanInputSchema,
  GoldPilotReadinessSchemaVersion,
  GoldPilotReadinessSummarySchema,
  GoldPilotReadinessViewSchema,
  GoldPilotReadinessWorkflowViewSchema,
  GoldPilotRubricPackageInputSchema,
  GoldPilotRubricPackageSchema,
  GoldPilotRubricResolutionInputSchema,
  GoldPilotRubricResolutionRecordSchema,
  GoldPilotRubricReviewInputSchema,
  GoldPilotRubricReviewRecordSchema,
  GoldPilotTaskAllocationSchema,
  type ActorKind,
  type GoldPilotConsentEvent,
  type GoldPilotConsentInput,
  type GoldPilotEquivalentTaskPair,
  type GoldPilotEquivalentTaskPairInput,
  type GoldPilotMinimumDataPolicy,
  type GoldPilotMinimumDataPolicyInput,
  type GoldPilotParticipantAssignment,
  type GoldPilotReadinessFreezeReceipt,
  type GoldPilotReadinessPlanInput,
  type GoldPilotReadinessSummary,
  type GoldPilotReadinessView,
  type GoldPilotReadinessWorkflowView,
  type GoldPilotRubricPackage,
  type GoldPilotRubricPackageInput,
  type GoldPilotRubricResolutionInput,
  type GoldPilotRubricResolutionRecord,
  type GoldPilotRubricReviewInput,
  type GoldPilotRubricReviewRecord,
  type GoldPilotRunDisposition,
  type GoldPilotTaskAllocation,
  type RoleId,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import { z } from "zod";
import {
  createGoldPilotProtocol,
} from "./gold-pilot-study.js";

const readinessClaimBoundary =
  "采集前冻结门只证明量规审查、等价任务、知情材料、最小数据规则和去标识同意收据已按固定哈希登记。它不验证评审者真实资质，不替代机构伦理审查、线下原始同意记录或真实教学效度；没有冻结收据不得创建试点，撤回后不得继续参与者行动。";

function withoutHash<T extends Record<string, unknown>>(
  value: T,
  key: keyof T,
): Omit<T, keyof T> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

function sortedAssignments(
  assignments: readonly GoldPilotParticipantAssignment[],
): GoldPilotParticipantAssignment[] {
  return assignments
    .map((assignment) => GoldPilotParticipantAssignmentSchema.parse(
      assignment,
    ))
    .sort((left, right) => (
      left.participantAlias.localeCompare(right.participantAlias)
    ));
}

function sortedAllocations(
  allocations: readonly GoldPilotTaskAllocation[],
): GoldPilotTaskAllocation[] {
  return allocations
    .map((allocation) => GoldPilotTaskAllocationSchema.parse(allocation))
    .sort((left, right) => (
      left.participantAlias.localeCompare(right.participantAlias)
    ));
}

export function createGoldPilotRubricPackage(
  raw: GoldPilotRubricPackageInput,
): GoldPilotRubricPackage {
  const input = GoldPilotRubricPackageInputSchema.parse(raw);
  const dimensions = [...input.dimensions].sort((left, right) => (
    left.dimensionId.localeCompare(right.dimensionId)
  ));
  if (
    new Set(dimensions.map((dimension) => dimension.dimensionId)).size
    !== dimensions.length
  ) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "量规维度编号不得重复",
    );
  }
  const unsigned = {
    ...input,
    dimensions,
  };
  return GoldPilotRubricPackageSchema.parse({
    ...unsigned,
    packageHash: hashValue(unsigned),
  });
}

export function createGoldPilotEquivalentTaskPair(
  raw: GoldPilotEquivalentTaskPairInput,
): GoldPilotEquivalentTaskPair {
  const input = GoldPilotEquivalentTaskPairInputSchema.parse(raw);
  const [taskA, taskB] = input.variants;
  if (
    taskA.taskVariantId === taskB.taskVariantId
    || taskA.taskDefinitionHash === taskB.taskDefinitionHash
  ) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "等价任务必须使用不同任务编号和不同任务定义哈希",
    );
  }
  if (
    taskA.learningOutcomeSetHash !== taskB.learningOutcomeSetHash
    || taskA.evidenceRequirementSetHash
      !== taskB.evidenceRequirementSetHash
    || taskA.rubricHash !== taskB.rubricHash
  ) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "等价任务必须共享学习目标、证据要求和量规哈希",
    );
  }
  if (Math.abs(taskA.expectedMinutes - taskB.expectedMinutes) > 5) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "等价任务的预计时长差不得超过五分钟",
    );
  }
  const unsigned = {
    variants: input.variants,
    equivalenceRule: {
      sameLearningOutcomes: true as const,
      sameEvidenceRequirements: true as const,
      sameRubric: true as const,
      maximumExpectedMinutesDifference: 5 as const,
    },
  };
  return GoldPilotEquivalentTaskPairSchema.parse({
    ...unsigned,
    pairHash: hashValue(unsigned),
  });
}

export function createGoldPilotMinimumDataPolicy(
  raw: GoldPilotMinimumDataPolicyInput,
): GoldPilotMinimumDataPolicy {
  const input = GoldPilotMinimumDataPolicyInputSchema.parse(raw);
  const unsigned = {
    ...input,
    permittedFields: [
      "participant_alias",
      "condition_and_task_assignment",
      "aggregate_student_metrics",
      "aggregate_teacher_workload",
      "standardized_exit_category",
      "receipt_hashes",
    ] as const,
    prohibitedFields: [
      "real_name",
      "contact_details",
      "raw_chat",
      "raw_recording",
      "private_memory",
      "free_text_exit_reason",
    ] as const,
  };
  return GoldPilotMinimumDataPolicySchema.parse({
    ...unsigned,
    policyHash: hashValue(unsigned),
  });
}

function runSlots(
  assignments: readonly GoldPilotParticipantAssignment[],
) {
  return assignments.flatMap((assignment) => (
    assignment.runs.map((run) => ({
      participantAlias: assignment.participantAlias,
      conditionSequence: assignment.sequence,
      ...run,
    }))
  ));
}

function assertPlanAlignment(input: {
  anchorSessionId: string;
  assignments: readonly GoldPilotParticipantAssignment[];
  allocations: readonly GoldPilotTaskAllocation[];
  taskPair: GoldPilotEquivalentTaskPair;
}): void {
  const aliases = input.assignments.map(
    (assignment) => assignment.participantAlias,
  );
  const allocationAliases = input.allocations.map(
    (allocation) => allocation.participantAlias,
  );
  if (
    new Set(aliases).size !== aliases.length
    || new Set(allocationAliases).size !== allocationAliases.length
    || hashValue([...aliases].sort()) !== hashValue([...allocationAliases].sort())
  ) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "试点分组与等价任务分配必须一一覆盖同一参与者别名",
    );
  }
  const slots = runSlots(input.assignments);
  const sessionIds = slots.map((slot) => slot.sessionId);
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "每个预登记试点运行必须独占一个训练会话",
    );
  }
  const studentAliases = new Set(aliases);
  const teacherAliases = new Set(slots.map((slot) => slot.teacherAlias));
  if ([...studentAliases].some((alias) => teacherAliases.has(alias))) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "教师与学生去标识别名不得复用",
    );
  }
  if (!slots.some((slot) => slot.sessionId === input.anchorSessionId)) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "采集前计划锚点会话必须属于预登记运行",
    );
  }
  const taskA = input.taskPair.variants[0].taskVariantId;
  const taskB = input.taskPair.variants[1].taskVariantId;
  const assignmentsByAlias = new Map(
    input.assignments.map((assignment) => [
      assignment.participantAlias,
      assignment,
    ]),
  );
  for (const allocation of input.allocations) {
    const assignment = assignmentsByAlias.get(allocation.participantAlias);
    if (!assignment) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "等价任务分配引用未知参与者",
      );
    }
    const expectedTasks = allocation.taskSequence === "task_a_then_b"
      ? [taskA, taskB]
      : [taskB, taskA];
    for (let index = 0; index < 2; index += 1) {
      if (
        allocation.runs[index]!.sessionId
          !== assignment.runs[index]!.sessionId
        || allocation.runs[index]!.period
          !== assignment.runs[index]!.period
        || allocation.runs[index]!.taskVariantId !== expectedTasks[index]
      ) {
        throw new GoldPilotReadinessError(
          "invalid_plan_input",
          "任务顺序、期次或会话与交叉分组不一致",
          { participantAlias: allocation.participantAlias },
        );
      }
    }
  }
  const cellCounts = new Map<string, number>();
  for (const assignment of input.assignments) {
    const taskSequence = input.allocations.find(
      (allocation) => (
        allocation.participantAlias === assignment.participantAlias
      ),
    )!.taskSequence;
    const key = `${assignment.sequence}:${taskSequence}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const cells = [
    "course_then_dual:task_a_then_b",
    "course_then_dual:task_b_then_a",
    "dual_then_course:task_a_then_b",
    "dual_then_course:task_b_then_a",
  ].map((key) => cellCounts.get(key) ?? 0);
  if (Math.max(...cells) - Math.min(...cells) > 1) {
    throw new GoldPilotReadinessError(
      "invalid_plan_input",
      "条件顺序与等价任务顺序必须按四格拉丁方平衡，格间人数差不得超过一",
    );
  }
}

export const GoldPilotReadinessStateSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  readinessId: GoldPilotReadinessIdSchema,
  anchorSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  createdByActorId: z.string().min(1).max(160),
  protocol: GoldPilotProtocolSchema,
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
  taskAllocations: z.array(GoldPilotTaskAllocationSchema).min(1),
  expertReviewerAliases: z.array(
    z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u),
  ).min(3).max(10),
  rubricPackage: GoldPilotRubricPackageSchema,
  equivalentTasks: GoldPilotEquivalentTaskPairSchema,
  informationSheet: GoldPilotInformationSheetSchema,
  minimumDataPolicy: GoldPilotMinimumDataPolicySchema,
  rubricReviews: z.array(GoldPilotRubricReviewRecordSchema),
  rubricResolutions: z.array(GoldPilotRubricResolutionRecordSchema),
  consentEvents: z.array(GoldPilotConsentEventSchema),
  freezeReceipt: GoldPilotReadinessFreezeReceiptSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
}).strict().superRefine((state, context) => {
  if (
    hashValue(withoutHash(state.protocol, "protocolHash"))
      !== state.protocol.protocolHash
    || hashValue(withoutHash(state.rubricPackage, "packageHash"))
      !== state.rubricPackage.packageHash
    || hashValue(withoutHash(state.equivalentTasks, "pairHash"))
      !== state.equivalentTasks.pairHash
    || hashValue(withoutHash(state.minimumDataPolicy, "policyHash"))
      !== state.minimumDataPolicy.policyHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["protocol"],
      message: "采集前计划的协议、量规、等价任务或最小数据哈希不匹配",
    });
  }
  const reviewerSet = new Set(state.expertReviewerAliases);
  if (reviewerSet.size !== state.expertReviewerAliases.length) {
    context.addIssue({
      code: "custom",
      path: ["expertReviewerAliases"],
      message: "内容效度评审别名不得重复",
    });
  }
  const dimensionSet = new Set(
    state.rubricPackage.dimensions.map((dimension) => dimension.dimensionId),
  );
  const reviewKeys = new Set<string>();
  for (const record of state.rubricReviews) {
    const key = `${record.reviewerAlias}:${record.review.dimensionId}`;
    if (
      record.readinessId !== state.readinessId
      || !reviewerSet.has(record.reviewerAlias)
      || !dimensionSet.has(record.review.dimensionId)
      || reviewKeys.has(key)
      || hashValue(withoutHash(record, "receiptHash"))
        !== record.receiptHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["rubricReviews", record.reviewId],
        message: "量规评审与计划、评审人、维度或收据哈希不一致",
      });
    }
    reviewKeys.add(key);
  }
  const resolutionDimensions = new Set<string>();
  for (const record of state.rubricResolutions) {
    if (
      record.readinessId !== state.readinessId
      || !dimensionSet.has(record.resolution.dimensionId)
      || resolutionDimensions.has(record.resolution.dimensionId)
      || hashValue(withoutHash(record, "receiptHash"))
        !== record.receiptHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["rubricResolutions", record.resolutionId],
        message: "量规处置与计划、维度或收据哈希不一致",
      });
    }
    resolutionDimensions.add(record.resolution.dimensionId);
  }
  const slots = runSlots(state.participantAssignments);
  const studentAliases = new Set(
    state.participantAssignments.map(
      (assignment) => assignment.participantAlias,
    ),
  );
  const teacherAliases = new Set(slots.map((slot) => slot.teacherAlias));
  const consentState = new Map<string, "confirmed" | "withdrawn">();
  for (const event of state.consentEvents) {
    const expectedKind = studentAliases.has(event.participantAlias)
      ? "student"
      : teacherAliases.has(event.participantAlias)
        ? "teacher"
        : null;
    const current = consentState.get(event.participantAlias);
    if (
      event.readinessId !== state.readinessId
      || event.participantKind !== expectedKind
      || event.informationSheetHash !== state.informationSheet.documentHash
      || event.minimumDataPolicyHash !== state.minimumDataPolicy.policyHash
      || (
        event.action === "confirmed"
        && current !== undefined
      )
      || (
        event.action === "withdrawn"
        && current !== "confirmed"
      )
      || hashValue(withoutHash(event, "receiptHash"))
        !== event.receiptHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["consentEvents", event.eventId],
        message: "知情或撤回收据与参与者、固定材料或前序状态不一致",
      });
    }
    consentState.set(event.participantAlias, event.action);
  }
  if (state.freezeReceipt) {
    const receipt = state.freezeReceipt;
    const expected = {
      schemaVersion: GoldPilotReadinessSchemaVersion,
      readinessId: state.readinessId,
      protocolHash: state.protocol.protocolHash,
      rubricPackageHash: state.rubricPackage.packageHash,
      equivalentTaskPairHash: state.equivalentTasks.pairHash,
      assignmentSnapshotHash: hashValue(state.participantAssignments),
      taskAllocationSnapshotHash: hashValue(state.taskAllocations),
      contentValiditySnapshotHash: hashValue({
        reviews: state.rubricReviews,
        resolutions: state.rubricResolutions,
      }),
      consentSnapshotHash: hashValue(
        state.consentEvents.filter((event) => event.action === "confirmed"),
      ),
      frozenAt: receipt.frozenAt,
    };
    if (
      hashValue(expected) !== receipt.receiptHash
      || hashValue(withoutHash(receipt, "receiptHash"))
        !== receipt.receiptHash
      || hashValue(withoutHash(receipt, "receiptHash"))
        !== hashValue(expected)
    ) {
      context.addIssue({
        code: "custom",
        path: ["freezeReceipt"],
        message: "采集前冻结收据与协议、量规、任务、分组或同意快照不一致",
      });
    }
  }
});
export type GoldPilotReadinessState = z.infer<
  typeof GoldPilotReadinessStateSchema
>;

export type GoldPilotReadinessErrorCode =
  | "consent_required"
  | "consent_withdrawn"
  | "invalid_plan_input"
  | "plan_exists"
  | "plan_not_found"
  | "readiness_not_frozen"
  | "readiness_not_ready"
  | "revision_conflict"
  | "session_not_registered"
  | "status_conflict";

export class GoldPilotReadinessError extends Error {
  readonly code: GoldPilotReadinessErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: GoldPilotReadinessErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GoldPilotReadinessError";
    this.code = code;
    this.details = details;
  }
}

export interface GoldPilotReadinessStore {
  create(state: GoldPilotReadinessState): Promise<GoldPilotReadinessState>;
  get(readinessId: string): Promise<GoldPilotReadinessState | null>;
  list(sessionId: string): Promise<GoldPilotReadinessState[]>;
  appendRubricReview(input: {
    readinessId: string;
    expectedRevision: number;
    record: GoldPilotRubricReviewRecord;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState>;
  recordRubricResolution(input: {
    readinessId: string;
    expectedRevision: number;
    record: GoldPilotRubricResolutionRecord;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState>;
  appendConsentEvent(input: {
    readinessId: string;
    expectedRevision: number;
    event: GoldPilotConsentEvent;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState>;
  freeze(input: {
    readinessId: string;
    expectedRevision: number;
    receipt: GoldPilotReadinessFreezeReceipt;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState>;
}

function cloneState(
  state: GoldPilotReadinessState,
): GoldPilotReadinessState {
  return GoldPilotReadinessStateSchema.parse(structuredClone(state));
}

function sessionsForState(state: GoldPilotReadinessState): Set<string> {
  return new Set(runSlots(state.participantAssignments).map(
    (slot) => slot.sessionId,
  ));
}

function requireState(
  states: Map<string, GoldPilotReadinessState>,
  readinessId: string,
): GoldPilotReadinessState {
  const state = states.get(readinessId);
  if (!state) {
    throw new GoldPilotReadinessError(
      "plan_not_found",
      "教学试点采集前计划不存在",
      { readinessId },
    );
  }
  return state;
}

function assertRevision(
  state: GoldPilotReadinessState,
  expectedRevision: number,
): void {
  if (state.revision !== expectedRevision) {
    throw new GoldPilotReadinessError(
      "revision_conflict",
      "采集前计划已被其他请求更新，请刷新后重试",
      {
        readinessId: state.readinessId,
        expectedRevision,
        actualRevision: state.revision,
      },
    );
  }
}

export class InMemoryGoldPilotReadinessStore
implements GoldPilotReadinessStore {
  readonly #states = new Map<string, GoldPilotReadinessState>();

  async create(
    state: GoldPilotReadinessState,
  ): Promise<GoldPilotReadinessState> {
    const parsed = GoldPilotReadinessStateSchema.parse(state);
    if (this.#states.has(parsed.readinessId)) {
      throw new GoldPilotReadinessError(
        "plan_exists",
        "同一采集前计划已经存在",
        { readinessId: parsed.readinessId },
      );
    }
    const sessions = sessionsForState(parsed);
    for (const existing of this.#states.values()) {
      if ([...sessions].some((sessionId) => (
        sessionsForState(existing).has(sessionId)
      ))) {
        throw new GoldPilotReadinessError(
          "plan_exists",
          "训练会话已经绑定其他采集前计划",
          { readinessId: existing.readinessId },
        );
      }
    }
    this.#states.set(parsed.readinessId, cloneState(parsed));
    return cloneState(parsed);
  }

  async get(
    readinessId: string,
  ): Promise<GoldPilotReadinessState | null> {
    const state = this.#states.get(readinessId);
    return state ? cloneState(state) : null;
  }

  async list(sessionId: string): Promise<GoldPilotReadinessState[]> {
    return [...this.#states.values()]
      .filter((state) => sessionsForState(state).has(sessionId))
      .sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || right.readinessId.localeCompare(left.readinessId)
      ))
      .map(cloneState);
  }

  async appendRubricReview(input: {
    readinessId: string;
    expectedRevision: number;
    record: GoldPilotRubricReviewRecord;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState> {
    const state = requireState(this.#states, input.readinessId);
    assertRevision(state, input.expectedRevision);
    if (state.freezeReceipt) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "采集前计划冻结后不能新增量规评审",
      );
    }
    if (state.rubricReviews.some((record) => (
      record.reviewerAlias === input.record.reviewerAlias
      && record.review.dimensionId === input.record.review.dimensionId
    ))) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "同一评审者对同一量规维度只能提交一次不可变评审",
      );
    }
    const next = GoldPilotReadinessStateSchema.parse({
      ...state,
      rubricReviews: [
        ...state.rubricReviews,
        GoldPilotRubricReviewRecordSchema.parse(input.record),
      ],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.readinessId, cloneState(next));
    return cloneState(next);
  }

  async recordRubricResolution(input: {
    readinessId: string;
    expectedRevision: number;
    record: GoldPilotRubricResolutionRecord;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState> {
    const state = requireState(this.#states, input.readinessId);
    assertRevision(state, input.expectedRevision);
    if (state.freezeReceipt) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "采集前计划冻结后不能修改量规处置",
      );
    }
    if (state.rubricResolutions.some((record) => (
      record.resolution.dimensionId === input.record.resolution.dimensionId
    ))) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "同一量规维度只能形成一次不可变处置",
      );
    }
    const next = GoldPilotReadinessStateSchema.parse({
      ...state,
      rubricResolutions: [
        ...state.rubricResolutions,
        GoldPilotRubricResolutionRecordSchema.parse(input.record),
      ],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.readinessId, cloneState(next));
    return cloneState(next);
  }

  async appendConsentEvent(input: {
    readinessId: string;
    expectedRevision: number;
    event: GoldPilotConsentEvent;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState> {
    const state = requireState(this.#states, input.readinessId);
    assertRevision(state, input.expectedRevision);
    const existing = state.consentEvents.filter((event) => (
      event.participantAlias === input.event.participantAlias
    ));
    const latest = existing.at(-1);
    if (
      input.event.action === "confirmed"
      && (state.freezeReceipt || latest)
    ) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "同一计划中的知情确认不可覆盖、重复或在冻结后补录",
      );
    }
    if (
      input.event.action === "withdrawn"
      && latest?.action !== "confirmed"
    ) {
      throw new GoldPilotReadinessError(
        "status_conflict",
        "只有已确认参与者才能记录撤回",
      );
    }
    const next = GoldPilotReadinessStateSchema.parse({
      ...state,
      consentEvents: [
        ...state.consentEvents,
        GoldPilotConsentEventSchema.parse(input.event),
      ],
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.readinessId, cloneState(next));
    return cloneState(next);
  }

  async freeze(input: {
    readinessId: string;
    expectedRevision: number;
    receipt: GoldPilotReadinessFreezeReceipt;
    updatedAt: string;
  }): Promise<GoldPilotReadinessState> {
    const state = requireState(this.#states, input.readinessId);
    assertRevision(state, input.expectedRevision);
    if (state.freezeReceipt) {
      if (state.freezeReceipt.receiptHash === input.receipt.receiptHash) {
        return cloneState(state);
      }
      throw new GoldPilotReadinessError(
        "status_conflict",
        "采集前计划已经绑定其他冻结收据",
      );
    }
    const next = GoldPilotReadinessStateSchema.parse({
      ...state,
      freezeReceipt: GoldPilotReadinessFreezeReceiptSchema.parse(
        input.receipt,
      ),
      updatedAt: input.updatedAt,
      revision: state.revision + 1,
    });
    this.#states.set(next.readinessId, cloneState(next));
    return cloneState(next);
  }
}

function participantKind(
  state: GoldPilotReadinessState,
  alias: string,
): "teacher" | "student" | null {
  if (state.participantAssignments.some(
    (assignment) => assignment.participantAlias === alias,
  )) return "student";
  if (runSlots(state.participantAssignments).some(
    (slot) => slot.teacherAlias === alias,
  )) return "teacher";
  return null;
}

function latestConsentActions(
  state: GoldPilotReadinessState,
): Map<string, "confirmed" | "withdrawn"> {
  const actions = new Map<string, "confirmed" | "withdrawn">();
  for (const event of state.consentEvents) {
    actions.set(event.participantAlias, event.action);
  }
  return actions;
}

function concernsInReview(review: GoldPilotRubricReviewInput): boolean {
  return [
    review.definition,
    review.behaviorAnchors,
    review.evidenceSources,
    review.redLines,
  ].some((status) => status === "revision_required")
    || review.weightRecommendation !== "retain";
}

function missingRequirements(
  state: GoldPilotReadinessState,
): string[] {
  const missing: string[] = [];
  const expectedReviews = (
    state.expertReviewerAliases.length
    * state.rubricPackage.dimensions.length
  );
  if (state.rubricReviews.length < expectedReviews) {
    missing.push(
      `还需 ${expectedReviews - state.rubricReviews.length} 份独立量规维度评审`,
    );
  }
  if (
    state.rubricResolutions.length
    < state.rubricPackage.dimensions.length
  ) {
    missing.push(
      `还需 ${
        state.rubricPackage.dimensions.length
        - state.rubricResolutions.length
      } 个量规维度处置`,
    );
  }
  const consent = latestConsentActions(state);
  const teacherAliases = new Set(
    runSlots(state.participantAssignments).map((slot) => slot.teacherAlias),
  );
  const studentAliases = state.participantAssignments.map(
    (assignment) => assignment.participantAlias,
  );
  const missingTeachers = [...teacherAliases].filter(
    (alias) => consent.get(alias) !== "confirmed",
  );
  const missingStudents = studentAliases.filter(
    (alias) => consent.get(alias) !== "confirmed",
  );
  if (missingTeachers.length > 0) {
    missing.push(`还需 ${missingTeachers.length} 份去标识教师知情确认收据`);
  }
  if (missingStudents.length > 0) {
    missing.push(`还需 ${missingStudents.length} 份去标识学生知情确认收据`);
  }
  return missing;
}

function readinessSummary(
  state: GoldPilotReadinessState,
): GoldPilotReadinessSummary {
  const consent = latestConsentActions(state);
  const teacherAliases = new Set(
    runSlots(state.participantAssignments).map((slot) => slot.teacherAlias),
  );
  const studentAliases = state.participantAssignments.map(
    (assignment) => assignment.participantAlias,
  );
  const missing = missingRequirements(state);
  const withdrawnParticipantCount = [...consent.values()].filter(
    (action) => action === "withdrawn",
  ).length;
  const status = state.freezeReceipt
    ? withdrawnParticipantCount > 0
      ? "frozen_with_withdrawals"
      : "frozen"
    : missing.length === 0
      ? "ready_to_freeze"
      : "collecting_prerequisites";
  return GoldPilotReadinessSummarySchema.parse({
    status,
    expertReviewerCount: state.expertReviewerAliases.length,
    rubricDimensionCount: state.rubricPackage.dimensions.length,
    completedRubricReviewCount: state.rubricReviews.length,
    expectedRubricReviewCount:
      state.expertReviewerAliases.length
      * state.rubricPackage.dimensions.length,
    resolvedRubricDimensionCount: state.rubricResolutions.length,
    consentedTeacherCount: [...teacherAliases].filter(
      (alias) => consent.get(alias) === "confirmed",
    ).length,
    consentedStudentCount: studentAliases.filter(
      (alias) => consent.get(alias) === "confirmed",
    ).length,
    withdrawnParticipantCount,
    missingRequirements: missing,
    claimBoundary: readinessClaimBoundary,
  });
}

function readinessView(
  state: GoldPilotReadinessState,
): GoldPilotReadinessView {
  return GoldPilotReadinessViewSchema.parse({
    schemaVersion: GoldPilotReadinessSchemaVersion,
    readinessId: state.readinessId,
    anchorSessionId: state.anchorSessionId,
    protocol: state.protocol,
    participantAssignments: state.participantAssignments,
    taskAllocations: state.taskAllocations,
    expertReviewerAliases: state.expertReviewerAliases,
    rubricPackage: state.rubricPackage,
    equivalentTasks: state.equivalentTasks,
    informationSheet: state.informationSheet,
    minimumDataPolicy: state.minimumDataPolicy,
    rubricReviews: state.rubricReviews,
    rubricResolutions: state.rubricResolutions,
    consentEvents: state.consentEvents,
    freezeReceipt: state.freezeReceipt,
    summary: readinessSummary(state),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    revision: state.revision,
  });
}

export interface CreateGoldPilotReadinessInput
extends GoldPilotReadinessPlanInput {
  anchorSessionId: string;
  createdByActorId: string;
}

export class GoldPilotReadinessCoordinator {
  readonly #store: GoldPilotReadinessStore;
  readonly #now: () => string;
  readonly #protocol = createGoldPilotProtocol();

  constructor(
    store: GoldPilotReadinessStore,
    options: { now?: () => string } = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async createPlan(
    raw: CreateGoldPilotReadinessInput,
  ): Promise<GoldPilotReadinessView> {
    let parsed: GoldPilotReadinessPlanInput;
    try {
      const {
        anchorSessionId: _anchorSessionId,
        createdByActorId: _createdByActorId,
        ...planInput
      } = raw;
      parsed = GoldPilotReadinessPlanInputSchema.parse(planInput);
    } catch (error) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "采集前计划输入不符合固定合同",
        { cause: error instanceof Error ? error.message : "invalid" },
      );
    }
    const assignments = sortedAssignments(parsed.participantAssignments);
    const allocations = sortedAllocations(parsed.taskAllocations);
    const reviewerAliases = [...parsed.expertReviewerAliases].sort();
    if (new Set(reviewerAliases).size !== reviewerAliases.length) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "内容效度评审别名不得重复",
      );
    }
    const rubricPackage = createGoldPilotRubricPackage(
      parsed.rubricPackage,
    );
    const equivalentTasks = createGoldPilotEquivalentTaskPair(
      parsed.equivalentTasks,
    );
    const informationSheet = GoldPilotInformationSheetSchema.parse(
      parsed.informationSheet,
    );
    const minimumDataPolicy = createGoldPilotMinimumDataPolicy(
      parsed.minimumDataPolicy,
    );
    assertPlanAlignment({
      anchorSessionId: raw.anchorSessionId,
      assignments,
      allocations,
      taskPair: equivalentTasks,
    });
    if (
      equivalentTasks.variants.some((variant) => (
        variant.rubricHash !== rubricPackage.packageHash
      ))
    ) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "等价任务必须绑定本次内容效度审查的量规包哈希",
      );
    }
    const readinessId = `gpr_${hashValue({
      namespace: GoldPilotReadinessSchemaVersion,
      protocolHash: this.#protocol.protocolHash,
      assignments,
      allocations,
      reviewerAliases,
      rubricPackageHash: rubricPackage.packageHash,
      taskPairHash: equivalentTasks.pairHash,
      informationSheet,
      minimumDataPolicyHash: minimumDataPolicy.policyHash,
    }).slice(0, 24)}`;
    const createdAt = this.#now();
    const state = GoldPilotReadinessStateSchema.parse({
      schemaVersion: GoldPilotReadinessSchemaVersion,
      readinessId,
      anchorSessionId: raw.anchorSessionId,
      createdByActorId: raw.createdByActorId,
      protocol: this.#protocol,
      participantAssignments: assignments,
      taskAllocations: allocations,
      expertReviewerAliases: reviewerAliases,
      rubricPackage,
      equivalentTasks,
      informationSheet,
      minimumDataPolicy,
      rubricReviews: [],
      rubricResolutions: [],
      consentEvents: [],
      freezeReceipt: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    });
    return readinessView(await this.#store.create(state));
  }

  async submitRubricReview(
    readinessId: string,
    reviewerAlias: string,
    rawReview: GoldPilotRubricReviewInput,
  ): Promise<GoldPilotReadinessView> {
    const state = await this.#requireState(readinessId);
    if (!state.expertReviewerAliases.includes(reviewerAlias)) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "评审别名未登记到本次内容效度计划",
        { reviewerAlias },
      );
    }
    const review = GoldPilotRubricReviewInputSchema.parse(rawReview);
    if (!state.rubricPackage.dimensions.some(
      (dimension) => dimension.dimensionId === review.dimensionId,
    )) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "量规评审引用未知维度",
        { dimensionId: review.dimensionId },
      );
    }
    const hasConcerns = concernsInReview(review);
    if (
      hasConcerns
        ? (
            review.reasonCodes.includes("accepted_as_is")
            || review.rationaleArtifactHash === null
          )
        : (
            review.reasonCodes.length !== 1
            || review.reasonCodes[0] !== "accepted_as_is"
            || review.rationaleArtifactHash !== null
          )
    ) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "无争议评审只能使用 accepted_as_is；有争议评审必须使用结构化问题码并绑定独立理由制品哈希",
      );
    }
    if (new Set(review.reasonCodes).size !== review.reasonCodes.length) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "量规评审问题码不得重复",
      );
    }
    const submittedAt = this.#now();
    const unsigned = {
      schemaVersion: GoldPilotReadinessSchemaVersion,
      reviewId: `gprv_${hashValue({
        readinessId,
        reviewerAlias,
        dimensionId: review.dimensionId,
      }).slice(0, 24)}`,
      readinessId,
      reviewerAlias,
      review,
      submittedAt,
    };
    const record = GoldPilotRubricReviewRecordSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return readinessView(await this.#store.appendRubricReview({
      readinessId,
      expectedRevision: state.revision,
      record,
      updatedAt: submittedAt,
    }));
  }

  async resolveRubricDimension(
    readinessId: string,
    rawResolution: GoldPilotRubricResolutionInput,
  ): Promise<GoldPilotReadinessView> {
    const state = await this.#requireState(readinessId);
    const resolution = GoldPilotRubricResolutionInputSchema.parse(
      rawResolution,
    );
    if (!state.rubricPackage.dimensions.some(
      (dimension) => dimension.dimensionId === resolution.dimensionId,
    )) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "量规处置引用未知维度",
      );
    }
    const reviews = state.rubricReviews.filter((record) => (
      record.review.dimensionId === resolution.dimensionId
    ));
    if (reviews.length !== state.expertReviewerAliases.length) {
      throw new GoldPilotReadinessError(
        "readiness_not_ready",
        "量规维度必须先完成全部独立评审，才能形成处置",
      );
    }
    const hasConcerns = reviews.some((record) => (
      concernsInReview(record.review)
    ));
    if (
      (
        hasConcerns
        && resolution.decision === "retained"
      )
      || (
        resolution.decision === "revised"
        && resolution.revisionArtifactHash === null
      )
      || (
        resolution.decision !== "revised"
        && resolution.revisionArtifactHash !== null
      )
    ) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "有争议维度不得原样保留；修订必须绑定新制品哈希，非修订处置不得伪装修订制品",
      );
    }
    const resolvedAt = this.#now();
    const unsigned = {
      schemaVersion: GoldPilotReadinessSchemaVersion,
      resolutionId: `gprs_${hashValue({
        readinessId,
        dimensionId: resolution.dimensionId,
      }).slice(0, 24)}`,
      readinessId,
      resolution,
      resolvedAt,
    };
    const record = GoldPilotRubricResolutionRecordSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return readinessView(await this.#store.recordRubricResolution({
      readinessId,
      expectedRevision: state.revision,
      record,
      updatedAt: resolvedAt,
    }));
  }

  async confirmConsent(
    readinessId: string,
    rawInput: GoldPilotConsentInput,
  ): Promise<GoldPilotReadinessView> {
    return this.#recordConsent(readinessId, rawInput, "confirmed");
  }

  async withdrawConsent(
    readinessId: string,
    rawInput: GoldPilotConsentInput,
  ): Promise<GoldPilotReadinessView> {
    return this.#recordConsent(readinessId, rawInput, "withdrawn");
  }

  async freezePlan(
    readinessId: string,
  ): Promise<GoldPilotReadinessView> {
    const state = await this.#requireState(readinessId);
    if (state.freezeReceipt) return readinessView(state);
    const missing = missingRequirements(state);
    if (missing.length > 0) {
      throw new GoldPilotReadinessError(
        "readiness_not_ready",
        "量规评审、维度处置或知情确认尚未完成，拒绝冻结",
        { missingRequirements: missing },
      );
    }
    const frozenAt = this.#now();
    const unsigned = {
      schemaVersion: GoldPilotReadinessSchemaVersion,
      readinessId,
      protocolHash: state.protocol.protocolHash,
      rubricPackageHash: state.rubricPackage.packageHash,
      equivalentTaskPairHash: state.equivalentTasks.pairHash,
      assignmentSnapshotHash: hashValue(state.participantAssignments),
      taskAllocationSnapshotHash: hashValue(state.taskAllocations),
      contentValiditySnapshotHash: hashValue({
        reviews: state.rubricReviews,
        resolutions: state.rubricResolutions,
      }),
      consentSnapshotHash: hashValue(
        state.consentEvents.filter((event) => event.action === "confirmed"),
      ),
      frozenAt,
    };
    const receipt = GoldPilotReadinessFreezeReceiptSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return readinessView(await this.#store.freeze({
      readinessId,
      expectedRevision: state.revision,
      receipt,
      updatedAt: frozenAt,
    }));
  }

  async getWorkflowView(
    sessionId: string,
  ): Promise<GoldPilotReadinessWorkflowView> {
    const states = await this.#store.list(sessionId);
    const plans = states.map(readinessView);
    return GoldPilotReadinessWorkflowViewSchema.parse({
      schemaVersion: GoldPilotReadinessSchemaVersion,
      generatedAt: this.#now(),
      activePlan: plans[0] ?? null,
      plans,
      claimBoundary: readinessClaimBoundary,
    });
  }

  async getPlan(
    readinessId: string,
  ): Promise<GoldPilotReadinessView> {
    return readinessView(await this.#requireState(readinessId));
  }

  async assertStudyLaunchAllowed(input: {
    readinessId: string;
    freezeReceiptHash: string;
    anchorSessionId: string;
    participantAssignments: readonly GoldPilotParticipantAssignment[];
  }): Promise<GoldPilotReadinessFreezeReceipt> {
    const state = await this.#requireState(input.readinessId);
    if (!state.freezeReceipt) {
      throw new GoldPilotReadinessError(
        "readiness_not_frozen",
        "试点创建前必须先冻结量规、等价任务、知情和最小数据收据",
      );
    }
    if (
      state.freezeReceipt.receiptHash !== input.freezeReceiptHash
      || state.anchorSessionId !== input.anchorSessionId
      || hashValue(state.participantAssignments)
        !== hashValue(sortedAssignments(input.participantAssignments))
    ) {
      throw new GoldPilotReadinessError(
        "readiness_not_frozen",
        "试点创建输入与采集前冻结收据不一致",
      );
    }
    if ([...latestConsentActions(state).values()].some(
      (action) => action === "withdrawn",
    )) {
      throw new GoldPilotReadinessError(
        "consent_withdrawn",
        "采集前冻结后已有参与者撤回，拒绝启动原分组",
      );
    }
    return state.freezeReceipt;
  }

  async assertSessionAccessAllowed(input: {
    sessionId: string;
    actorKind: ActorKind;
    roleId: RoleId;
  }): Promise<void> {
    const states = await this.#store.list(input.sessionId);
    if (states.length === 0) return;
    const state = states[0]!;
    if (!state.freezeReceipt) {
      throw new GoldPilotReadinessError(
        "readiness_not_frozen",
        "当前会话已进入试点计划，但采集前冻结门尚未完成",
      );
    }
    const slot = runSlots(state.participantAssignments).find(
      (candidate) => candidate.sessionId === input.sessionId,
    );
    if (!slot) {
      throw new GoldPilotReadinessError(
        "session_not_registered",
        "当前会话未登记到采集前计划",
      );
    }
    let alias: string | null = null;
    if (input.actorKind === "student") {
      if (slot.roleId !== input.roleId) {
        throw new GoldPilotReadinessError(
          "consent_required",
          "当前学生岗位不属于预登记参与者，拒绝写入试点会话",
        );
      }
      alias = slot.participantAlias;
    } else if (input.actorKind === "teacher") {
      alias = slot.teacherAlias;
    } else {
      return;
    }
    const action = latestConsentActions(state).get(alias);
    if (action === "withdrawn") {
      throw new GoldPilotReadinessError(
        "consent_withdrawn",
        "参与者已经撤回，当前会话拒绝继续采集行动",
        { participantAlias: alias },
      );
    }
    if (action !== "confirmed") {
      throw new GoldPilotReadinessError(
        "consent_required",
        "当前参与者尚无与固定知情材料一致的确认收据",
        { participantAlias: alias },
      );
    }
  }

  async assertFinalizationAllowed(
    sessionId: string,
    disposition: GoldPilotRunDisposition,
  ): Promise<void> {
    const states = await this.#store.list(sessionId);
    if (states.length === 0) return;
    const state = states[0]!;
    const slot = runSlots(state.participantAssignments).find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (!slot) return;
    const action = latestConsentActions(state).get(slot.participantAlias);
    if (
      action === "withdrawn"
      && !(
        disposition.outcome === "withdrawn"
        && disposition.exitCategory === "consent_revoked"
      )
    ) {
      throw new GoldPilotReadinessError(
        "consent_withdrawn",
        "参与者撤回后只能以 consent_revoked 冻结退出收据",
      );
    }
  }

  async taskVariantForSession(
    readinessId: string,
    sessionId: string,
  ) {
    const state = await this.#requireState(readinessId);
    const allocation = state.taskAllocations.flatMap(
      (candidate) => candidate.runs,
    ).find((run) => run.sessionId === sessionId);
    if (!allocation) {
      throw new GoldPilotReadinessError(
        "session_not_registered",
        "当前会话没有等价任务分配",
      );
    }
    return state.equivalentTasks.variants.find(
      (variant) => variant.taskVariantId === allocation.taskVariantId,
    )!;
  }

  async #recordConsent(
    readinessId: string,
    rawInput: GoldPilotConsentInput,
    action: "confirmed" | "withdrawn",
  ): Promise<GoldPilotReadinessView> {
    const state = await this.#requireState(readinessId);
    const input = GoldPilotConsentInputSchema.parse(rawInput);
    const expectedKind = participantKind(state, input.participantAlias);
    if (expectedKind !== input.participantKind) {
      throw new GoldPilotReadinessError(
        "invalid_plan_input",
        "知情收据的参与者别名或类型未登记到本次计划",
      );
    }
    const recordedAt = this.#now();
    const unsigned = {
      schemaVersion: GoldPilotReadinessSchemaVersion,
      eventId: `gprc_${hashValue({
        readinessId,
        participantAlias: input.participantAlias,
        action,
      }).slice(0, 24)}`,
      readinessId,
      participantAlias: input.participantAlias,
      participantKind: input.participantKind,
      action,
      sourceRecordHash: input.sourceRecordHash,
      informationSheetHash: state.informationSheet.documentHash,
      minimumDataPolicyHash: state.minimumDataPolicy.policyHash,
      recordedAt,
    };
    const event = GoldPilotConsentEventSchema.parse({
      ...unsigned,
      receiptHash: hashValue(unsigned),
    });
    return readinessView(await this.#store.appendConsentEvent({
      readinessId,
      expectedRevision: state.revision,
      event,
      updatedAt: recordedAt,
    }));
  }

  async #requireState(
    readinessId: string,
  ): Promise<GoldPilotReadinessState> {
    const state = await this.#store.get(readinessId);
    if (!state) {
      throw new GoldPilotReadinessError(
        "plan_not_found",
        "教学试点采集前计划不存在",
        { readinessId },
      );
    }
    return state;
  }
}

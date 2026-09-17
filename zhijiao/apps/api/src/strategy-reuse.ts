import {
  CollaborationReplaySchema,
  CollaborationStrategyReferenceSchema,
  FlagshipCollaborationEvidenceWritebackRef,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationStudentDecisionRefPrefix,
  FlagshipCollaborationTaskAnchorId,
  FlagshipStrategyReuseCurrentEventId,
  parseFlagshipCollaborationStudentDecisionRef,
  StrategyReuseExplanationSchema,
  StrategyReuseExplanationSchemaVersion,
  type CollaborationReplay,
  type CollaborationStrategy,
  type CollaborationStrategyQuery,
  type CollaborationStrategyReference,
  type CollaborationStrategyStatus,
  type StrategyReuseExplanation,
  type StrategyReuseReasonCode,
} from "@ronggang/contracts";

export interface StrategyReuseStrategyReader {
  get(
    strategyId: string,
    version: number,
  ): Promise<CollaborationStrategy | null>;
  list(
    query?: CollaborationStrategyQuery,
  ): Promise<CollaborationStrategy[]>;
}

export interface ExplainStrategyReuseInput {
  expectedStrategyRef: CollaborationStrategyReference;
  replay: CollaborationReplay;
  generatedAt?: string;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function strategyRef(
  strategy: CollaborationStrategy,
): CollaborationStrategyReference {
  return {
    strategyId: strategy.strategyId,
    version: strategy.version,
    contentHash: strategy.contentHash,
  };
}

function sameStrategyRef(
  left: CollaborationStrategyReference,
  right: CollaborationStrategyReference,
): boolean {
  return left.strategyId === right.strategyId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

function governanceReason(
  status: Exclude<CollaborationStrategyStatus, "approved">,
): Extract<
  StrategyReuseReasonCode,
  "strategy_draft" | "strategy_disabled" | "strategy_retired"
> {
  return ({
    draft: "strategy_draft",
    disabled: "strategy_disabled",
    retired: "strategy_retired",
  } as const)[status];
}

function governanceMessage(
  status: Exclude<CollaborationStrategyStatus, "approved">,
): string {
  return {
    draft: "不复用：策略仍处于 draft，尚未获得教师批准。",
    disabled: "不复用：策略已被教师禁用。",
    retired: "不复用：策略已被教师淘汰并进入终态。",
  }[status];
}

interface ConsumableReplayReferences {
  eventTriggerIds: Set<string>;
  studentDecisionIds: Set<string>;
  teacherReviewIds: Set<string>;
  worldWritebackIds: Set<string>;
  taskIds: Set<string>;
  evidenceIds: Set<string>;
  worldWritebackEvidenceIds: Set<string>;
  technicalTraceRefs: Set<string>;
}

function consumableReplayReferences(
  strategy: CollaborationStrategy,
  replay: CollaborationReplay,
): {
  references: ConsumableReplayReferences | null;
  differences: string[];
} {
  const stages = new Map(replay.stages.map((stage) => [stage.phase, stage]));
  const expectedStudentStatus =
    strategy.content.studentChoice.decision === "accepted"
      ? "completed"
      : "rejected";
  const expectedStatuses = {
    event_trigger: "completed",
    candidate_screening: "completed",
    agent_wakeup: "completed",
    permission_check: "completed",
    agent_contribution: "completed",
    student_decision: expectedStudentStatus,
    teacher_review: "completed",
    world_writeback: "completed",
  } as const;
  const differences = Object.entries(expectedStatuses).flatMap(
    ([phase, expectedStatus]) => {
      const actualStatus = stages.get(
        phase as CollaborationReplay["stages"][number]["phase"],
      )?.status;
      return actualStatus === expectedStatus
        ? []
        : [`阶段 ${phase} 需要 ${expectedStatus}，当前为 ${
          actualStatus ?? "missing"
        }`];
    },
  );
  const semanticDecision =
    parseFlagshipCollaborationStudentDecisionRef(
      strategy.content.studentChoice.actionRef,
    );
  if (
    strategy.content.studentChoice.actionRef.startsWith(
      FlagshipCollaborationStudentDecisionRefPrefix,
    )
    && semanticDecision === null
  ) {
    differences.push(
      "学生决策引用占用旗舰保留命名空间但格式无效",
    );
  }
  if (
    semanticDecision !== null
    && (
      semanticDecision.decision !== strategy.content.studentChoice.decision
      || (
        semanticDecision.decision === "accepted"
        && !strategy.content.studentChoice.selectedAgentIds.includes(
          semanticDecision.agentId,
        )
      )
    )
  ) {
    differences.push(
      "学生决策语义引用与冻结的 decision/selectedAgentIds 不一致",
    );
  }
  if (differences.length > 0) {
    return { references: null, differences };
  }

  const eventTrigger = stages.get("event_trigger")!;
  const studentDecision = stages.get("student_decision")!;
  const teacherReview = stages.get("teacher_review")!;
  const contribution = stages.get("agent_contribution")!;
  const writeback = stages.get("world_writeback")!;
  const agentExecutionPhases = [
    stages.get("agent_wakeup")!,
    stages.get("permission_check")!,
    contribution,
  ];
  return {
    references: {
      eventTriggerIds: new Set(eventTrigger.eventIds),
      studentDecisionIds: new Set(studentDecision.eventIds),
      teacherReviewIds: new Set(teacherReview.eventIds),
      worldWritebackIds: new Set(writeback.eventIds),
      taskIds: new Set(writeback.taskIds),
      evidenceIds: new Set([
        ...contribution.evidenceIds,
        ...writeback.evidenceIds,
      ]),
      worldWritebackEvidenceIds: new Set(writeback.evidenceIds),
      technicalTraceRefs: new Set(agentExecutionPhases.flatMap(
        (stage) => stage.technicalTraceRefs,
      )),
    },
    differences: [],
  };
}

interface CausalReferences {
  eventIds: string[];
  taskIds: string[];
  evidenceIds: string[];
  consequenceSummaries: string[];
  missingRefs: string[];
}

function causalReferences(
  strategy: CollaborationStrategy,
  available: ConsumableReplayReferences,
): CausalReferences {
  const basisEventTriggerIds = strategy.content.basisRefs.flatMap(
    (reference) => (
      reference.refType === "world_event" ? [reference.refId] : []
    ),
  );
  const basisStudentDecisionIds = strategy.content.basisRefs.flatMap(
    (reference) => (
      reference.refType === "student_action" ? [reference.refId] : []
    ),
  );
  const basisTeacherReviewIds = strategy.content.basisRefs.flatMap(
    (reference) => (
      reference.refType === "teacher_review" ? [reference.refId] : []
    ),
  );
  const basisWorldWritebackIds = strategy.content.basisRefs.flatMap(
    (reference) => (
      reference.refType === "world_consequence" ? [reference.refId] : []
    ),
  );
  const basisEvidenceIds = strategy.content.basisRefs.flatMap((reference) => (
    reference.refType === "evidence" ? [reference.refId] : []
  ));
  const basisTechnicalRefs = strategy.content.basisRefs.flatMap((reference) => (
    reference.refType === "agent_run" ? [reference.refId] : []
  ));
  const requiredEventTriggerIds = unique([
    FlagshipCollaborationEventId,
    ...strategy.content.eventConditions.requiredEventRefs,
    ...basisEventTriggerIds,
  ]);
  const requiredStudentDecisionIds = unique([
    ...basisStudentDecisionIds,
    strategy.content.studentChoice.actionRef,
  ]);
  const requiredTeacherReviewIds = unique([
    ...basisTeacherReviewIds,
  ]);
  const requiredWorldWritebackIds = unique([
    ...basisWorldWritebackIds,
    ...strategy.content.consequenceRefs,
  ]);
  const requiredEvidenceIds = unique([
    ...strategy.content.evidenceRefs,
    ...basisEvidenceIds,
  ]);
  const requiredTaskIds = [FlagshipCollaborationTaskAnchorId];
  const hasRequiredEvidence = (refId: string) => (
    refId === FlagshipCollaborationEvidenceWritebackRef
      ? available.worldWritebackEvidenceIds.has(refId)
      : available.evidenceIds.has(refId)
  );
  const missingRefs = [
    ...requiredEventTriggerIds
      .filter((refId) => !available.eventTriggerIds.has(refId))
      .map((refId) => `event:${refId}`),
    ...requiredStudentDecisionIds
      .filter((refId) => !available.studentDecisionIds.has(refId))
      .map((refId) => `event:${refId}`),
    ...requiredTeacherReviewIds
      .filter((refId) => !available.teacherReviewIds.has(refId))
      .map((refId) => `event:${refId}`),
    ...requiredWorldWritebackIds
      .filter((refId) => !available.worldWritebackIds.has(refId))
      .map((refId) => `event:${refId}`),
    ...requiredTaskIds
      .filter((refId) => !available.taskIds.has(refId))
      .map((refId) => `task:${refId}`),
    ...requiredEvidenceIds
      .filter((refId) => !hasRequiredEvidence(refId))
      .map((refId) => `evidence:${refId}`),
    ...basisTechnicalRefs
      .filter((refId) => !available.technicalTraceRefs.has(refId))
      .map((refId) => `trace:${refId}`),
  ];
  const consequenceSummaries = strategy.content.consequenceRefs
    .filter((refId) => available.worldWritebackIds.has(refId))
    .map((refId) => `既有回放确认后果引用 ${refId}。`);

  return {
    eventIds: [
      ...requiredEventTriggerIds.filter((refId) => (
        available.eventTriggerIds.has(refId)
      )),
      ...requiredStudentDecisionIds.filter((refId) => (
        available.studentDecisionIds.has(refId)
      )),
      ...requiredTeacherReviewIds.filter((refId) => (
        available.teacherReviewIds.has(refId)
      )),
      ...requiredWorldWritebackIds.filter((refId) => (
        available.worldWritebackIds.has(refId)
      )),
    ],
    taskIds: requiredTaskIds.filter((refId) => (
      available.taskIds.has(refId)
    )),
    evidenceIds: requiredEvidenceIds.filter((refId) => (
      hasRequiredEvidence(refId)
    )),
    consequenceSummaries: unique(consequenceSummaries),
    missingRefs,
  };
}

function sharedExplanation(
  replay: CollaborationReplay,
  generatedAt: string,
) {
  return {
    schemaVersion: StrategyReuseExplanationSchemaVersion,
    sessionId: replay.sessionId,
    scenarioId: replay.scenarioId,
    routeId: FlagshipCollaborationRouteId,
    sourceEventId: FlagshipCollaborationEventId,
    currentEventId: FlagshipStrategyReuseCurrentEventId,
    taskId: FlagshipCollaborationTaskAnchorId,
    stateVersion: replay.stateVersion,
    generatedAt,
  } as const;
}

function noMatch(
  replay: CollaborationReplay,
  generatedAt: string,
  reason: string,
  currentDifferences: string[] = [],
): StrategyReuseExplanation {
  return StrategyReuseExplanationSchema.parse({
    ...sharedExplanation(replay, generatedAt),
    status: "not_reused",
    reasonCode: "no_match",
    strategyRef: null,
    strategyStatus: null,
    applicability: {
      reason,
      notApplicableWhen: [
        "没有唯一 approved 策略时不复用。",
        "既有协作回放未完成或因果引用不完整时不复用。",
      ],
      currentDifferences,
    },
    actualPath: null,
    alternativePath: null,
  });
}

function governanceNoMatch(
  replay: CollaborationReplay,
  generatedAt: string,
  strategy: CollaborationStrategy,
): StrategyReuseExplanation {
  if (strategy.governance.status === "approved") {
    throw new TypeError("approved 策略不能进入非批准治理结果");
  }
  return StrategyReuseExplanationSchema.parse({
    ...sharedExplanation(replay, generatedAt),
    status: "not_reused",
    reasonCode: governanceReason(strategy.governance.status),
    strategyRef: strategyRef(strategy),
    strategyStatus: strategy.governance.status,
    applicability: {
      reason: governanceMessage(strategy.governance.status),
      notApplicableWhen: [
        "策略不是 approved 状态时不复用。",
      ],
      currentDifferences: [],
    },
    actualPath: null,
    alternativePath: null,
  });
}

function drift(
  replay: CollaborationReplay,
  generatedAt: string,
  expectedStrategyRef: CollaborationStrategyReference,
): StrategyReuseExplanation {
  return StrategyReuseExplanationSchema.parse({
    ...sharedExplanation(replay, generatedAt),
    status: "error",
    reasonCode: "version_hash_drift",
    strategyRef: expectedStrategyRef,
    strategyStatus: null,
    applicability: {
      reason: "策略版本或内容哈希与冻结引用不一致，复用失败关闭。",
      notApplicableWhen: [
        "冻结策略版本或内容哈希发生漂移时不复用。",
      ],
      currentDifferences: [],
    },
    actualPath: null,
    alternativePath: null,
  });
}

function alternativePath(
  strategy: CollaborationStrategy,
) {
  const accepted = strategy.content.studentChoice.decision === "accepted";
  return {
    occurred: false,
    writesWorldEvents: false,
    writesTasks: false,
    writesEvidence: false,
    summary: accepted
      ? "如果学生没有采纳既有智能体建议，可能维持原协作顺序并把核验延后。"
      : "如果学生转而采纳既有智能体建议，可能先核验材料再调整协作顺序。",
    possibleConsequences: [
      accepted
        ? "交付节奏可能暂时更快，但来源与材料风险会在后续集中暴露。"
        : "来源风险可能更早暴露，但当前交付节奏可能因补充核验而放缓。",
    ],
  } as const;
}

/**
 * Deterministically explains one preset reuse target.
 *
 * The service receives only a read-capability for immutable strategies and a
 * prebuilt CollaborationReplay. It has no WorldEngine, task-store or evidence
 * writer dependency, so the counterfactual branch cannot execute or persist.
 */
export class StrategyReuseService {
  readonly #strategies: StrategyReuseStrategyReader;
  readonly #now: () => string;

  constructor(
    strategies: StrategyReuseStrategyReader,
    options: { now?: () => string } = {},
  ) {
    this.#strategies = strategies;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async explain(
    rawInput: ExplainStrategyReuseInput,
  ): Promise<StrategyReuseExplanation> {
    const replay = CollaborationReplaySchema.parse(rawInput.replay);
    const expectedStrategyRef = CollaborationStrategyReferenceSchema.parse(
      rawInput.expectedStrategyRef,
    );
    const generatedAt = rawInput.generatedAt ?? this.#now();
    const approved = await this.#strategies.list({
      status: "approved",
      triggerEventId: FlagshipCollaborationEventId,
    });
    if (approved.length > 1) {
      return drift(replay, generatedAt, expectedStrategyRef);
    }

    const expected = await this.#strategies.get(
      expectedStrategyRef.strategyId,
      expectedStrategyRef.version,
    );
    if (!expected) {
      return approved.length === 0
        ? noMatch(
            replay,
            generatedAt,
            "不复用：当前没有满足冻结引用的 approved 协作策略。",
          )
        : drift(replay, generatedAt, expectedStrategyRef);
    }
    if (expected.contentHash !== expectedStrategyRef.contentHash) {
      return drift(replay, generatedAt, expectedStrategyRef);
    }
    if (expected.governance.status !== "approved") {
      return governanceNoMatch(replay, generatedAt, expected);
    }
    if (
      approved.length !== 1
      || !sameStrategyRef(strategyRef(approved[0]!), expectedStrategyRef)
    ) {
      return drift(replay, generatedAt, expectedStrategyRef);
    }

    if (
      replay.routeId !== expected.content.eventConditions.routeId
      || replay.representativeEventId
        !== expected.content.eventConditions.triggerEventId
      || replay.representativeTaskId
        !== expected.content.eventConditions.taskAnchorId
    ) {
      return noMatch(
        replay,
        generatedAt,
        "不复用：当前回放不属于被冻结的旗舰事件、路线和任务锚点。",
      );
    }
    if (replay.status !== "completed") {
      return noMatch(
        replay,
        generatedAt,
        "不复用：既有协作回放尚未形成完整实际路径。",
      );
    }

    const consumable = consumableReplayReferences(expected, replay);
    if (!consumable.references) {
      return noMatch(
        replay,
        generatedAt,
        "不复用：既有协作回放的必需阶段或学生选择与冻结策略不一致。",
        consumable.differences,
      );
    }

    const causal = causalReferences(expected, consumable.references);
    if (causal.missingRefs.length > 0) {
      return noMatch(
        replay,
        generatedAt,
        "不复用：策略依据与既有协作回放的因果引用不完整。",
        causal.missingRefs.map((refId) => `缺少因果引用 ${refId}`),
      );
    }
    return StrategyReuseExplanationSchema.parse({
      ...sharedExplanation(replay, generatedAt),
      status: "reused",
      reasonCode: "approved_match",
      strategyRef: expectedStrategyRef,
      strategyStatus: "approved",
      applicability: {
        reason: "唯一 approved 策略与预置相似事件保持同一路线、任务锚点和完整因果引用。",
        notApplicableWhen: [
          "策略被禁用、淘汰或仍处于 draft 时不复用。",
          "冻结版本、内容哈希或唯一 approved 约束漂移时失败关闭。",
          "既有回放未完成或策略因果引用缺失时不复用。",
        ],
        currentDifferences: [
          "原事件是首次突发暴雨升级，本次是同一旗舰情境中的后续降雨预警。",
          "复用的是协作决策结构；本轮材料时效与处理节奏仍需重新判断。",
        ],
      },
      actualPath: {
        source: "collaboration_replay",
        occurred: true,
        summary: [
          `既有回放以 ${causal.eventIds.length} 个事件、`,
          `${causal.taskIds.length} 个任务和 `,
          `${causal.evidenceIds.length} 个证据引用确认实际路径：`,
          expected.content.recommendationSummary,
          `学生实际选择为 ${expected.content.studentChoice.decision}。`,
        ].join(""),
        eventIds: causal.eventIds,
        taskIds: causal.taskIds,
        evidenceIds: causal.evidenceIds,
        consequences: causal.consequenceSummaries.length > 0
          ? causal.consequenceSummaries
          : ["既有回放已形成可追溯的世界、任务与证据后果。"],
      },
      alternativePath: alternativePath(expected),
    });
  }
}

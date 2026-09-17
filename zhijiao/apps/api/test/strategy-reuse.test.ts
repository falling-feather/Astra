import { describe, expect, it, vi } from "vitest";
import {
  FlagshipCollaborationEvidenceWritebackRef,
  FlagshipCollaborationEventId,
  FlagshipCollaborationTeacherApprovedRef,
  FlagshipCollaborationWorldWritebackRef,
  flagshipCollaborationStudentDecisionRef,
  type CollaborationStrategy,
  type CollaborationStrategyContent,
  type CollaborationStrategyReference,
  type CollaborationStrategyStatus,
} from "@ronggang/contracts";
import {
  CollaborationStrategyService,
  InMemoryCollaborationStrategyStore,
} from "../src/collaboration-strategy-store.js";
import {
  StrategyReuseService,
  type StrategyReuseStrategyReader,
} from "../src/strategy-reuse.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";
import { collaborationReplayForReuse } from "./strategy-reuse.fixture.js";

const teacher = {
  actorId: "teacher-main",
  actorKind: "teacher",
} as const;
const now = "2026-07-31T01:00:00.000Z";

function reference(
  strategy: CollaborationStrategy,
): CollaborationStrategyReference {
  return {
    strategyId: strategy.strategyId,
    version: strategy.version,
    contentHash: strategy.contentHash,
  };
}

async function strategyWithStatus(
  status: CollaborationStrategyStatus,
  content: CollaborationStrategyContent = collaborationStrategyContent(),
): Promise<{
  record: CollaborationStrategy;
  reader: InMemoryCollaborationStrategyStore;
}> {
  const reader = new InMemoryCollaborationStrategyStore();
  const governance = new CollaborationStrategyService(
    reader,
    { now: () => now },
  );
  let record = await governance.createDraft({
    strategyId: "strategy-rain-collaboration",
    version: 1,
    content,
  }, teacher);
  if (status === "draft") return { record, reader };
  record = await governance.transitionGovernance(
    record.strategyId,
    record.version,
    {
      expectedStatus: "draft",
      expectedGovernanceRevision: 0,
      expectedContentHash: record.contentHash,
      action: status === "retired" ? "retire" : "approve",
      reason: "测试教师治理。",
    },
    teacher,
  );
  if (status !== "disabled") return { record, reader };
  record = await governance.transitionGovernance(
    record.strategyId,
    record.version,
    {
      expectedStatus: "approved",
      expectedGovernanceRevision: 1,
      expectedContentHash: record.contentHash,
      action: "disable",
      reason: "测试禁用。",
    },
    teacher,
  );
  return { record, reader };
}

const acceptedEvidenceDecisionRef =
  flagshipCollaborationStudentDecisionRef(
    "agent-evidence-coach",
    "accepted",
  );

function groundedSemanticStrategyContent(
  overrides: Partial<CollaborationStrategyContent> = {},
): CollaborationStrategyContent {
  const base = collaborationStrategyContent();
  return collaborationStrategyContent({
    eventConditions: {
      ...base.eventConditions,
      requiredEventRefs: [FlagshipCollaborationEventId],
    },
    agentSet: [
      "agent-evidence-coach",
      "agent-material-understanding",
      "agent-evaluation-review",
    ],
    permissions: [
      ...base.permissions,
      {
        agentId: "agent-evaluation-review",
        visibleScopes: ["teacher_only", "audit_only"],
        capabilities: [
          "read-evaluation-case",
          "suggest-review-order",
        ],
        privateDataPolicy: "teacher_only",
        authoritativeWorldWrite: false,
      },
    ],
    basisRefs: [
      {
        refType: "world_event",
        refId: FlagshipCollaborationEventId,
        version: null,
      },
      {
        refType: "student_action",
        refId: acceptedEvidenceDecisionRef,
        version: null,
      },
      {
        refType: "teacher_review",
        refId: FlagshipCollaborationTeacherApprovedRef,
        version: null,
      },
      {
        refType: "world_consequence",
        refId: FlagshipCollaborationWorldWritebackRef,
        version: null,
      },
      {
        refType: "evidence",
        refId: FlagshipCollaborationEvidenceWritebackRef,
        version: null,
      },
    ],
    studentChoice: {
      ...base.studentChoice,
      actionRef: acceptedEvidenceDecisionRef,
    },
    consequenceRefs: [FlagshipCollaborationWorldWritebackRef],
    evidenceRefs: [FlagshipCollaborationEvidenceWritebackRef],
    ...overrides,
  });
}

const groundedSemanticEventRefs = new Set<string>([
  FlagshipCollaborationEventId,
  acceptedEvidenceDecisionRef,
  FlagshipCollaborationTeacherApprovedRef,
  FlagshipCollaborationWorldWritebackRef,
]);
const groundedSemanticEvidenceRefs = new Set<string>([
  FlagshipCollaborationEvidenceWritebackRef,
]);

function groundedReplayForSession(prefix: string) {
  const replay = collaborationReplayForReuse();
  replay.sessionId = `session-${prefix}`;
  replay.stages = replay.stages.map((stage) => ({
    ...stage,
    eventIds: [
      ...stage.eventIds.map((eventId) => (
        groundedSemanticEventRefs.has(eventId)
          ? eventId
          : `${prefix}:${eventId}`
      )),
      ...(stage.phase === "student_decision"
        ? [acceptedEvidenceDecisionRef]
        : stage.phase === "teacher_review"
          ? [FlagshipCollaborationTeacherApprovedRef]
          : stage.phase === "world_writeback"
            ? [FlagshipCollaborationWorldWritebackRef]
            : []),
    ],
    evidenceIds: [
      ...stage.evidenceIds.map((evidenceId) => (
        groundedSemanticEvidenceRefs.has(evidenceId)
          ? evidenceId
          : `${prefix}:${evidenceId}`
      )),
      ...(stage.phase === "world_writeback"
        ? [FlagshipCollaborationEvidenceWritebackRef]
        : []),
    ],
    technicalTraceRefs: stage.technicalTraceRefs.map(
      (traceRef) => `${prefix}:${traceRef}`,
    ),
  })) as typeof replay.stages;
  replay.technicalTraceRefs = replay.technicalTraceRefs.map(
    (traceRef) => `${prefix}:${traceRef}`,
  );
  return replay;
}

describe("StrategyReuseService", () => {
  it("deterministically matches the unique approved strategy and trims replay noise", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const target = new StrategyReuseService(reader, { now: () => now });
    const replay = collaborationReplayForReuse();
    const snapshot = structuredClone(replay);

    const result = await target.explain({
      expectedStrategyRef: reference(record),
      replay,
    });

    expect(result).toMatchObject({
      status: "reused",
      reasonCode: "approved_match",
      strategyStatus: "approved",
      strategyRef: reference(record),
      actualPath: {
        source: "collaboration_replay",
        occurred: true,
        eventIds: [
          "flagship-event-rain-escalation",
          "event-rain-triggered",
          "action-rain-collaboration",
          "consequence-rain-priority-updated",
        ],
        taskIds: ["flagship-task-rain-collaboration"],
        evidenceIds: ["evidence-rain-source-check"],
      },
      alternativePath: {
        occurred: false,
        writesWorldEvents: false,
        writesTasks: false,
        writesEvidence: false,
      },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "unrelated",
      "无关",
      "噪声",
      "event-unrelated-trigger-noise",
      "event-unrelated-agent-noise",
      "event-unrelated-writeback-noise",
      "task-unrelated-noise",
      "evidence-unrelated-noise",
      "trace-unrelated-noise",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(replay).toEqual(snapshot);
  });

  it("returns explicit no_match and never generates a temporary strategy", async () => {
    const write = vi.fn();
    const reader = {
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      createDraft: write,
      transitionGovernance: write,
    };
    const target = new StrategyReuseService(reader);
    const result = await target.explain({
      expectedStrategyRef: {
        strategyId: "strategy-missing",
        version: 1,
        contentHash: "a".repeat(64),
      },
      replay: collaborationReplayForReuse(),
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      strategyRef: null,
      strategyStatus: null,
      actualPath: null,
      alternativePath: null,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", "strategy_draft"],
    ["disabled", "strategy_disabled"],
    ["retired", "strategy_retired"],
  ] as const)(
    "does not reuse a %s strategy",
    async (status, reasonCode) => {
      const { record, reader } = await strategyWithStatus(status);
      const result = await new StrategyReuseService(reader).explain({
        expectedStrategyRef: reference(record),
        replay: collaborationReplayForReuse(),
        generatedAt: now,
      });
      expect(result).toMatchObject({
        status: "not_reused",
        reasonCode,
        strategyStatus: status,
        actualPath: null,
        alternativePath: null,
      });
    },
  );

  it("returns a drift error for a changed content hash or approved version", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const target = new StrategyReuseService(reader);
    const replay = collaborationReplayForReuse();

    const hashDrift = await target.explain({
      expectedStrategyRef: {
        ...reference(record),
        contentHash: "0".repeat(64),
      },
      replay,
      generatedAt: now,
    });
    const versionDrift = await target.explain({
      expectedStrategyRef: {
        ...reference(record),
        version: 2,
      },
      replay,
      generatedAt: now,
    });

    for (const result of [hashDrift, versionDrift]) {
      expect(result).toMatchObject({
        status: "error",
        reasonCode: "version_hash_drift",
        strategyStatus: null,
        actualPath: null,
        alternativePath: null,
      });
    }
  });

  it("returns a drift error when the approved match is not unique", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const duplicate = structuredClone(record);
    duplicate.strategyId = "strategy-rain-collaboration-duplicate";
    const ambiguousReader: StrategyReuseStrategyReader = {
      get: reader.get.bind(reader),
      list: async () => [record, duplicate],
    };

    const result = await new StrategyReuseService(
      ambiguousReader,
    ).explain({
      expectedStrategyRef: reference(record),
      replay: collaborationReplayForReuse(),
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "error",
      reasonCode: "version_hash_drift",
      strategyStatus: null,
      actualPath: null,
      alternativePath: null,
    });
  });

  it.each([
    [
      "eventConditions.triggerEventId",
      FlagshipCollaborationEventId,
      `event:${FlagshipCollaborationEventId}`,
    ],
    ["basisRefs", "event-rain-triggered", "event:event-rain-triggered"],
    [
      "consequenceRefs",
      "consequence-rain-priority-updated",
      "event:consequence-rain-priority-updated",
    ],
    [
      "evidenceRefs",
      "evidence-rain-source-check",
      "evidence:evidence-rain-source-check",
    ],
    [
      "studentChoice.actionRef",
      "action-rain-collaboration",
      "event:action-rain-collaboration",
    ],
  ] as const)(
    "fails closed when a required %s reference is absent despite unrelated noise",
    async (_referenceKind, missingId, expectedMissingRef) => {
      const { record, reader } = await strategyWithStatus("approved");
      const replay = collaborationReplayForReuse();
      replay.stages = replay.stages.map((stage) => ({
        ...stage,
        eventIds: stage.eventIds.filter((eventId) => (
          eventId !== missingId
        )),
        evidenceIds: stage.evidenceIds.filter((evidenceId) => (
          evidenceId !== missingId
        )),
      })) as typeof replay.stages;

      const result = await new StrategyReuseService(reader).explain({
        expectedStrategyRef: reference(record),
        replay,
        generatedAt: now,
      });

      expect(result).toMatchObject({
        status: "not_reused",
        reasonCode: "no_match",
        actualPath: null,
        alternativePath: null,
      });
      expect(result.applicability.currentDifferences).toEqual(
        expect.arrayContaining([
          `缺少因果引用 ${expectedMissingRef}`,
        ]),
      );
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("unrelated");
      expect(serialized).not.toContain("无关");
      expect(serialized).not.toContain("噪声");
    },
  );

  it("fails closed when an agent_run basis trace is absent", async () => {
    const baseContent = collaborationStrategyContent();
    const { record, reader } = await strategyWithStatus(
      "approved",
      collaborationStrategyContent({
        basisRefs: [
          ...baseContent.basisRefs,
          {
            refType: "agent_run",
            refId: "trace-agent-run",
            version: "run-1",
          },
        ],
      }),
    );
    const replay = collaborationReplayForReuse();
    replay.technicalTraceRefs = replay.technicalTraceRefs.filter(
      (traceRef) => traceRef !== "trace-agent-run",
    );
    replay.stages = replay.stages.map((stage) => ({
      ...stage,
      technicalTraceRefs: stage.technicalTraceRefs.filter(
        (traceRef) => traceRef !== "trace-agent-run",
      ),
    })) as typeof replay.stages;

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
    expect(result.applicability.currentDifferences).toContain(
      "缺少因果引用 trace:trace-agent-run",
    );
  });

  it.each([
    ["teacher_review", "rejected", "world_writeback", "not_applicable"],
    ["agent_contribution", "missing", null, null],
    ["permission_check", "failed", null, null],
    ["world_writeback", "missing", null, null],
  ] as const)(
    "does not consume an inconsistent %s=%s replay",
    async (phase, status, secondaryPhase, secondaryStatus) => {
      const { record, reader } = await strategyWithStatus("approved");
      const replay = collaborationReplayForReuse();
      replay.stages = replay.stages.map((stage) => {
        if (stage.phase === phase) return { ...stage, status };
        if (stage.phase === secondaryPhase && secondaryStatus) {
          return { ...stage, status: secondaryStatus };
        }
        return stage;
      }) as typeof replay.stages;

      const result = await new StrategyReuseService(reader).explain({
        expectedStrategyRef: reference(record),
        replay,
        generatedAt: now,
      });

      expect(result).toMatchObject({
        status: "not_reused",
        reasonCode: "no_match",
        actualPath: null,
        alternativePath: null,
      });
    },
  );

  it("requires the task reference in the completed writeback stage", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const replay = collaborationReplayForReuse();
    replay.stages = replay.stages.map((stage) => ({
      ...stage,
      taskIds: [],
    })) as typeof replay.stages;

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
    expect(result.applicability.currentDifferences).toContain(
      "缺少因果引用 task:flagship-task-rain-collaboration",
    );
  });

  it("requires the replayed student decision to match the frozen accepted choice", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const replay = collaborationReplayForReuse();
    replay.stages = replay.stages.map((stage) => (
      stage.phase === "student_decision"
        ? { ...stage, status: "rejected" }
        : stage
    )) as typeof replay.stages;

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
  });

  it("requires the replayed student decision to match the frozen rejected choice", async () => {
    const base = collaborationStrategyContent();
    const { record, reader } = await strategyWithStatus(
      "approved",
      collaborationStrategyContent({
        studentChoice: {
          ...base.studentChoice,
          decision: "rejected",
          selectedAgentIds: [],
        },
      }),
    );

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay: collaborationReplayForReuse(),
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
  });

  it("keeps the counterfactual branch read-only even when extra writers exist", async () => {
    const { record, reader } = await strategyWithStatus("approved");
    const createDraft = vi.fn();
    const transitionGovernance = vi.fn();
    const readerWithForbiddenWriters: StrategyReuseStrategyReader & {
      createDraft: typeof createDraft;
      transitionGovernance: typeof transitionGovernance;
    } = {
      get: reader.get.bind(reader),
      list: reader.list.bind(reader),
      createDraft,
      transitionGovernance,
    };

    const result = await new StrategyReuseService(
      readerWithForbiddenWriters,
    ).explain({
      expectedStrategyRef: reference(record),
      replay: collaborationReplayForReuse(),
      generatedAt: now,
    });

    expect(result.status).toBe("reused");
    expect(createDraft).not.toHaveBeenCalled();
    expect(transitionGovernance).not.toHaveBeenCalled();
  });

  it("reuses grounded semantic refs across sessions without trusting occurrence ids", async () => {
    const { record, reader } = await strategyWithStatus(
      "approved",
      groundedSemanticStrategyContent(),
    );
    const sourceReplay = groundedReplayForSession("source");
    const currentReplay = groundedReplayForSession("current");
    const sourceOccurrenceIds = new Set(sourceReplay.stages.flatMap(
      (stage) => stage.eventIds.filter(
        (eventId) => !groundedSemanticEventRefs.has(eventId),
      ),
    ));
    const currentOccurrenceIds = new Set(currentReplay.stages.flatMap(
      (stage) => stage.eventIds.filter(
        (eventId) => !groundedSemanticEventRefs.has(eventId),
      ),
    ));
    expect([...sourceOccurrenceIds].every(
      (eventId) => !currentOccurrenceIds.has(eventId),
    )).toBe(true);

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay: currentReplay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "reused",
      reasonCode: "approved_match",
      actualPath: {
        eventIds: [
          FlagshipCollaborationEventId,
          acceptedEvidenceDecisionRef,
          FlagshipCollaborationTeacherApprovedRef,
          FlagshipCollaborationWorldWritebackRef,
        ],
        taskIds: ["flagship-task-rain-collaboration"],
        evidenceIds: [FlagshipCollaborationEvidenceWritebackRef],
      },
      alternativePath: {
        occurred: false,
        writesWorldEvents: false,
        writesTasks: false,
        writesEvidence: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("source:");
    expect(JSON.stringify(result)).not.toContain("current:");
  });

  it.each([
    {
      label: "source event",
      refId: FlagshipCollaborationEventId,
      field: "eventIds",
      correctPhase: "event_trigger",
      wrongPhase: "student_decision",
    },
    {
      label: "student action",
      refId: acceptedEvidenceDecisionRef,
      field: "eventIds",
      correctPhase: "student_decision",
      wrongPhase: "teacher_review",
    },
    {
      label: "teacher review",
      refId: FlagshipCollaborationTeacherApprovedRef,
      field: "eventIds",
      correctPhase: "teacher_review",
      wrongPhase: "world_writeback",
    },
    {
      label: "world consequence",
      refId: FlagshipCollaborationWorldWritebackRef,
      field: "eventIds",
      correctPhase: "world_writeback",
      wrongPhase: "event_trigger",
    },
    {
      label: "grounded evidence",
      refId: FlagshipCollaborationEvidenceWritebackRef,
      field: "evidenceIds",
      correctPhase: "world_writeback",
      wrongPhase: "event_trigger",
    },
  ] as const)(
    "rejects a $label alias placed outside its causal phase",
    async ({ refId, field, correctPhase, wrongPhase }) => {
      const { record, reader } = await strategyWithStatus(
        "approved",
        groundedSemanticStrategyContent(),
      );
      const replay = groundedReplayForSession("wrong-phase");
      replay.stages = replay.stages.map((stage) => {
        if (field === "eventIds") {
          return {
            ...stage,
            eventIds: [
              ...stage.eventIds.filter((eventId) => (
                eventId !== refId
              )),
              ...(stage.phase === wrongPhase ? [refId] : []),
            ],
          };
        }
        return {
          ...stage,
          evidenceIds: [
            ...stage.evidenceIds.filter((evidenceId) => (
              evidenceId !== refId
            )),
            ...(stage.phase === wrongPhase ? [refId] : []),
          ],
        };
      }) as typeof replay.stages;
      expect(replay.stages.find(
        (stage) => stage.phase === correctPhase,
      )?.[field]).not.toContain(refId);

      const result = await new StrategyReuseService(reader).explain({
        expectedStrategyRef: reference(record),
        replay,
        generatedAt: now,
      });

      expect(result).toMatchObject({
        status: "not_reused",
        reasonCode: "no_match",
        actualPath: null,
        alternativePath: null,
      });
    },
  );

  it("does not consume an agent trace placed only in a review phase", async () => {
    const base = groundedSemanticStrategyContent();
    const { record, reader } = await strategyWithStatus(
      "approved",
      groundedSemanticStrategyContent({
        basisRefs: [
          ...base.basisRefs,
          {
            refType: "agent_run",
            refId: "trace-grounded-agent-run",
            version: null,
          },
        ],
      }),
    );
    const replay = groundedReplayForSession("wrong-trace-phase");
    replay.stages = replay.stages.map((stage) => ({
      ...stage,
      technicalTraceRefs: stage.phase === "teacher_review"
        ? [...stage.technicalTraceRefs, "trace-grounded-agent-run"]
        : stage.technicalTraceRefs.filter(
            (traceRef) => traceRef !== "trace-grounded-agent-run",
          ),
    })) as typeof replay.stages;
    replay.technicalTraceRefs.push("trace-grounded-agent-run");

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
  });

  it("requires the grounded evidence-writeback alias in world_writeback", async () => {
    const { record, reader } = await strategyWithStatus(
      "approved",
      groundedSemanticStrategyContent(),
    );
    const replay = groundedReplayForSession(
      "evidence-alias-contribution-only",
    );
    replay.stages = replay.stages.map((stage) => ({
      ...stage,
      evidenceIds: [
        ...stage.evidenceIds.filter(
          (evidenceId) => (
            evidenceId !== FlagshipCollaborationEvidenceWritebackRef
          ),
        ),
        ...(stage.phase === "agent_contribution"
          ? [FlagshipCollaborationEvidenceWritebackRef]
          : []),
      ],
    })) as typeof replay.stages;

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
    expect(result.applicability.currentDifferences).toContain(
      `缺少因果引用 evidence:${FlagshipCollaborationEvidenceWritebackRef}`,
    );
  });

  it("rejects a semantic action ref whose agent conflicts with selectedAgentIds", async () => {
    const base = groundedSemanticStrategyContent();
    const { record, reader } = await strategyWithStatus(
      "approved",
      groundedSemanticStrategyContent({
        studentChoice: {
          ...base.studentChoice,
          selectedAgentIds: ["agent-material-understanding"],
          actionRef: acceptedEvidenceDecisionRef,
        },
      }),
    );
    const replay = groundedReplayForSession("decision-agent-mismatch");
    replay.stages = replay.stages.map((stage) => (
      stage.phase === "student_decision"
        ? {
            ...stage,
            eventIds: [
              ...stage.eventIds,
              flagshipCollaborationStudentDecisionRef(
                "agent-material-understanding",
                "rejected",
              ),
            ],
          }
        : stage
    )) as typeof replay.stages;

    const result = await new StrategyReuseService(reader).explain({
      expectedStrategyRef: reference(record),
      replay,
      generatedAt: now,
    });

    expect(result).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      actualPath: null,
      alternativePath: null,
    });
    expect(result.applicability.currentDifferences).toContain(
      "学生决策语义引用与冻结的 decision/selectedAgentIds 不一致",
    );
  });

  it.each([
    "flagship-rain-collaboration:student-decision:agent-unknown:accepted",
    "flagship-rain-collaboration:student-decision:agent-evidence-coach:maybe",
    "flagship-rain-collaboration:student-decision:agent-evidence-coach:accepted:extra",
  ])(
    "rejects malformed refs in the reserved decision namespace: %s",
    async (malformedActionRef) => {
      const base = groundedSemanticStrategyContent();
      const { record, reader } = await strategyWithStatus(
        "approved",
        groundedSemanticStrategyContent({
          studentChoice: {
            ...base.studentChoice,
            actionRef: malformedActionRef,
          },
        }),
      );
      const replay = groundedReplayForSession("malformed-decision-ref");
      replay.stages = replay.stages.map((stage) => (
        stage.phase === "student_decision"
          ? {
              ...stage,
              eventIds: [...stage.eventIds, malformedActionRef],
            }
          : stage
      )) as typeof replay.stages;

      const result = await new StrategyReuseService(reader).explain({
        expectedStrategyRef: reference(record),
        replay,
        generatedAt: now,
      });

      expect(result).toMatchObject({
        status: "not_reused",
        reasonCode: "no_match",
        actualPath: null,
        alternativePath: null,
      });
      expect(result.applicability.currentDifferences).toContain(
        "学生决策引用占用旗舰保留命名空间但格式无效",
      );
    },
  );
});

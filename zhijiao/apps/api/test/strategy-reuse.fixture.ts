import {
  CollaborationReplaySchema,
  CollaborationReplaySchemaVersion,
  FlagshipCollaborationEventId,
  type CollaborationReplay,
  type CollaborationReplayPhase,
} from "@ronggang/contracts";

const phases: CollaborationReplayPhase[] = [
  "event_trigger",
  "candidate_screening",
  "agent_wakeup",
  "permission_check",
  "agent_contribution",
  "student_decision",
  "teacher_review",
  "world_writeback",
];

const eventIdsByPhase: Record<CollaborationReplayPhase, string[]> = {
  event_trigger: [
    FlagshipCollaborationEventId,
    "event-rain-triggered",
    "event-unrelated-trigger-noise",
  ],
  candidate_screening: [],
  agent_wakeup: ["event-agent-wakeup"],
  permission_check: ["event-permission-checked"],
  agent_contribution: [
    "event-agent-contribution",
    "event-unrelated-agent-noise",
  ],
  student_decision: ["action-rain-collaboration"],
  teacher_review: ["event-teacher-review"],
  world_writeback: [
    "consequence-rain-priority-updated",
    "event-unrelated-writeback-noise",
  ],
};

export function collaborationReplayForReuse(
  overrides: Partial<CollaborationReplay> = {},
): CollaborationReplay {
  return CollaborationReplaySchema.parse({
    schemaVersion: CollaborationReplaySchemaVersion,
    sessionId: "session-collaboration",
    scenarioId: "scenario-local-tourism-media-v0.1",
    routeId: "route-rain-escalation",
    representativeEventId: "flagship-event-rain-escalation",
    representativeTaskId: "flagship-task-rain-collaboration",
    stateVersion: 48,
    generatedAt: "2026-07-31T01:00:00.000Z",
    status: "completed",
    stages: phases.map((phase, index) => ({
      phase,
      status: "completed",
      occurredAt: new Date(
        Date.parse("2026-07-31T00:00:00.000Z") + index * 1_000,
      ).toISOString(),
      stateVersion: 41 + index,
      title: `阶段 ${phase}`,
      summary: phase === "agent_contribution"
        ? "相关建议与一条无关智能体噪声同时存在。"
        : phase === "world_writeback"
          ? "合法后果与无关任务、证据噪声同时写入回放摘要。"
          : `已完成 ${phase}。`,
      actorIds: [],
      agentRefs: [],
      eventIds: eventIdsByPhase[phase],
      taskIds: phase === "world_writeback"
        ? [
            "flagship-task-rain-collaboration",
            "task-unrelated-noise",
          ]
        : [],
      evidenceIds: (
        phase === "agent_contribution"
        || phase === "world_writeback"
      )
        ? [
            "evidence-rain-source-check",
            "evidence-unrelated-noise",
          ]
        : [],
      technicalTraceRefs: phase === "agent_contribution"
        ? ["trace-agent-run", "trace-unrelated-noise"]
        : [],
    })),
    technicalTraceRefs: [
      "trace-agent-run",
      "trace-unrelated-noise",
    ],
    ...overrides,
  });
}

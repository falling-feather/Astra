import { describe, expect, it } from "vitest";
import {
  CollaborationReplayPhaseSchema,
  CollaborationReplaySchema,
  CollaborationReplaySchemaVersion,
  type CollaborationReplayPhase,
} from "../src/index.js";

function replayStage(
  phase: CollaborationReplayPhase,
  status: "completed" | "missing" = "completed",
) {
  return {
    phase,
    status,
    occurredAt: status === "missing"
      ? null
      : "2026-07-31T00:00:00.000Z",
    stateVersion: status === "missing" ? null : 20,
    title: phase,
    summary: status === "missing" ? "节点缺失" : "节点已完成",
    actorIds: [],
    agentRefs: [],
    eventIds: [],
    taskIds: [],
    evidenceIds: [],
    technicalTraceRefs: [],
  };
}

function completedReplay() {
  return {
    schemaVersion: CollaborationReplaySchemaVersion,
    sessionId: "session-collaboration",
    scenarioId: "scenario-local-tourism-media-v0.1",
    routeId: "route-rain-escalation",
    representativeEventId: "flagship-event-rain-escalation",
    representativeTaskId: "flagship-task-rain-collaboration",
    stateVersion: 28,
    generatedAt: "2026-07-31T00:01:00.000Z",
    status: "completed" as const,
    stages: CollaborationReplayPhaseSchema.options.map((phase) => (
      replayStage(phase)
    )),
    technicalTraceRefs: ["event:event-rain"],
  };
}

describe("CollaborationReplaySchema", () => {
  it("accepts the fixed eight-stage causal projection", () => {
    expect(CollaborationReplaySchema.parse(completedReplay())).toMatchObject({
      status: "completed",
      stages: expect.arrayContaining([
        expect.objectContaining({ phase: "event_trigger" }),
        expect.objectContaining({ phase: "world_writeback" }),
      ]),
    });
  });

  it("rejects a stage sequence that reorders causality", () => {
    const candidate = completedReplay();
    const first = candidate.stages[0]!;
    candidate.stages[0] = candidate.stages[1]!;
    candidate.stages[1] = first;
    expect(CollaborationReplaySchema.safeParse(candidate).success).toBe(false);
  });

  it("requires explicit evidence for not-triggered and failed summaries", () => {
    const notTriggered = completedReplay();
    notTriggered.status = "not_triggered" as never;
    expect(CollaborationReplaySchema.safeParse(notTriggered).success).toBe(
      false,
    );

    const failed = completedReplay();
    failed.status = "failed" as never;
    expect(CollaborationReplaySchema.safeParse(failed).success).toBe(false);

    const explicit = completedReplay();
    explicit.status = "not_triggered" as never;
    explicit.stages[0] = replayStage("event_trigger", "missing");
    expect(CollaborationReplaySchema.safeParse(explicit).success).toBe(true);
  });
});

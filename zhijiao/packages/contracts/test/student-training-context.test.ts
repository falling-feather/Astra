import { describe, expect, it } from "vitest";
import {
  StudentAdviceDecisionRequestSchema,
  StudentTrainingContextSchema,
  StudentTrainingContextSchemaVersion,
  StudentTrainingMutationReceiptSchema,
  StudentTrainingMutationReceiptSchemaVersion,
} from "../src/index.js";

function fixture() {
  return {
    schemaVersion: StudentTrainingContextSchemaVersion,
    sessionId: "demo-xunpu-v2",
    bindingId: "binding-student-xunpu",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "release-course-xunpu-runtime-2",
      version: 3,
      contentHash: "a".repeat(64),
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-media",
      version: "2.0.1",
      contentHash: "b".repeat(64),
    },
    stateVersion: 12,
    generatedAt: "2026-08-09T06:00:00.000Z",
    actor: { roleId: "reporter" as const, displayName: "学生记者" },
    remainingMinutes: 80,
    scene: {
      sceneId: "xunpu-scene-topic-desk",
      title: "蟳埔专题选题台",
      description: "比较候选角度并核验来源。",
      phase: "active" as const,
      riskLevel: "low" as const,
      stateTags: ["选题", "待核验"],
    },
    hotspots: [{
      hotspotId: "xunpu-hotspot-topic-board",
      label: "选题依据板",
      description: "整理受众与来源边界。",
      status: "available" as const,
      relationship: "cooperative" as const,
      consequencePreview: "完成后进入教师核对。",
    }],
    eventCards: [{
      eventRef: "event-xunpu-topic-opened",
      title: "选题任务开放",
      changes: ["记者开始整理候选角度"],
      tone: "info" as const,
    }],
    currentAction: {
      actionRef: "xunpu-topic-compare-angles",
      sceneId: "xunpu-scene-topic-desk",
      label: "比较候选角度",
      description: "比较三个角度的受众价值。",
      expectedOutput: "候选角度比较表",
      status: "ready" as const,
      priority: "normal" as const,
      sourceEventRefs: ["event-xunpu-topic-opened"],
    },
    evidenceRefs: ["evidence-xunpu-topic-brief"],
  };
}

describe("StudentTrainingContext/2.0.0", () => {
  it("accepts the minimal student-safe context and server decision request", () => {
    expect(StudentTrainingContextSchema.parse(fixture())).toEqual(fixture());
    expect(StudentAdviceDecisionRequestSchema.parse({
      suggestionId: "suggestion-xunpu-topic",
      decision: "request_evidence",
    })).toEqual({
      suggestionId: "suggestion-xunpu-topic",
      decision: "request_evidence",
    });
    expect(StudentTrainingMutationReceiptSchema.parse({
      schemaVersion: StudentTrainingMutationReceiptSchemaVersion,
      accepted: true,
      sessionId: "demo-xunpu-v2",
      stateVersion: 13,
    })).toMatchObject({ accepted: true, stateVersion: 13 });
  });

  it("rejects technical policies, private execution fields and client action refs", () => {
    for (const extra of [
      { roleTable: [{ roleId: "teacher" }] },
      { toolPolicy: ["search"] },
      { tokenBudget: 2_000 },
      { prompt: "private prompt" },
      { privateMemory: ["secret"] },
      { provider: "model-vendor" },
      { trace: { runId: "run-private" } },
    ]) {
      expect(StudentTrainingContextSchema.safeParse({
        ...fixture(),
        ...extra,
      }).success).toBe(false);
    }
    expect(StudentAdviceDecisionRequestSchema.safeParse({
      suggestionId: "suggestion-xunpu-topic",
      decision: "accept",
      choiceRef: "xunpu-topic-brief:agent-decision:accept",
    }).success).toBe(false);
  });

  it("rejects an action from another scene", () => {
    const candidate = fixture();
    candidate.currentAction.sceneId = "xunpu-scene-foreign";
    expect(StudentTrainingContextSchema.safeParse(candidate).success).toBe(false);
  });
});

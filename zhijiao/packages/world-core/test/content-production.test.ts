import { describe, expect, it } from "vitest";
import {
  createMessageMeta,
  type Command,
  type CommandName,
} from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  InvalidWorldActionError,
  PermissionDeniedError,
  WorldEngine,
} from "../src/index.js";

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-${++value}` };
}

function fixedClock() {
  let second = 0;
  const base = Date.parse("2026-07-25T07:00:00.000Z");
  return {
    now: () => new Date(base + second++ * 1_000).toISOString(),
  };
}

async function execute(
  engine: WorldEngine,
  sessionId: string,
  actorId: string,
  name: CommandName,
  payload: Record<string, unknown>,
) {
  const projection = await engine.getProjection(sessionId, actorId);
  const command: Command = {
    ...createMessageMeta({
      sessionId,
      sceneId: projection.sceneId,
      actorId,
      correlationId: String(payload.requestId ?? `test-${name}`),
      timestamp: "2026-07-25T07:00:00.000Z",
    }),
    kind: "Command",
    name,
    expectedStateVersion: projection.stateVersion,
    payload,
  };
  return engine.execute(command);
}

describe("content production world state", () => {
  it("pins processing input, rejects forged verification, and appends immutable R1/R2", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "content-revisions";
    await engine.createSession(sessionId, true);
    let projection = await execute(
      engine,
      sessionId,
      "student-editor",
      "request_media_processing",
      {
        materialId: "material-festival-photo",
        planId: "image-editorial-analysis",
        requestId: "processing-1",
      },
    );
    const task = projection.mediaProcessingTasks[0]!;
    expect(task).toMatchObject({
      materialVersion: "raw-1",
      status: "queued",
    });
    expect(task.inputContentHash).toMatch(/^[a-f0-9]{64}$/u);

    let state = await engine.getStateSnapshot(sessionId);
    const firstStep = state.mediaProcessingTasks[0]!.steps[0]!;
    await engine.startMediaProcessingStep({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      stepId: firstStep.stepId,
      expectedStateVersion: state.stateVersion,
      workerId: "test-worker",
      correlationId: "forged-output-start",
    });
    state = await engine.getStateSnapshot(sessionId);
    await expect(engine.completeMediaProcessingStep({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      stepId: firstStep.stepId,
      expectedStateVersion: state.stateVersion,
      output: {
        outputId: "forged-output",
        capability: firstStep.capability,
        provider: "forged-provider",
        providerMode: "live",
        summary: "恶意处理器试图自称已核验",
        extracted: { verified: true },
        sourceRef: task.inputRef,
        confidence: 1,
        trust: "observation_only",
        verificationStatus: "verified",
        providerRequestId: "forged",
        createdAt: "2026-07-25T07:00:30.000Z",
      },
      correlationId: "forged-output",
    })).rejects.toBeInstanceOf(InvalidWorldActionError);

    state = await engine.getStateSnapshot(sessionId);
    await engine.completeMediaProcessingStep({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      stepId: firstStep.stepId,
      expectedStateVersion: state.stateVersion,
      output: {
        outputId: "output-first",
        capability: firstStep.capability,
        provider: "iflytek",
        providerMode: "mock",
        summary: "图片观察完成，仍未核验",
        extracted: { scene: "市集" },
        sourceRef: task.inputRef,
        confidence: 0.86,
        trust: "observation_only",
        verificationStatus: "unverified",
        providerRequestId: "provider-first",
        createdAt: "2026-07-25T07:00:31.000Z",
      },
      correlationId: "complete-first",
    });
    state = await engine.getStateSnapshot(sessionId);
    const secondStep = state.mediaProcessingTasks[0]!.steps[1]!;
    await engine.startMediaProcessingStep({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      stepId: secondStep.stepId,
      expectedStateVersion: state.stateVersion,
      workerId: "test-worker",
      correlationId: "start-second",
    });
    state = await engine.getStateSnapshot(sessionId);
    await engine.completeMediaProcessingStep({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      stepId: secondStep.stepId,
      expectedStateVersion: state.stateVersion,
      output: {
        outputId: "output-second",
        capability: secondStep.capability,
        provider: "iflytek",
        providerMode: "mock",
        summary: "图片合规检查完成，仍需岗位复核",
        extracted: { decision: "review_required" },
        sourceRef: task.inputRef,
        confidence: 0.9,
        trust: "observation_only",
        verificationStatus: "unverified",
        providerRequestId: "provider-second",
        createdAt: "2026-07-25T07:00:32.000Z",
      },
      correlationId: "complete-second",
    });
    state = await engine.getStateSnapshot(sessionId);
    await engine.finalizeMediaProcessingTask({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      expectedStateVersion: state.stateVersion,
      correlationId: "finalize-task",
    });

    const citations = [
      {
        sourceKind: "fact",
        sourceId: "fact-event-schedule",
        locator: null,
      },
      {
        sourceKind: "material",
        sourceId: "material-festival-photo",
        locator: null,
      },
      {
        sourceKind: "processing_output",
        sourceId: "output-first",
        locator: null,
      },
    ];
    const sections = [
      { sectionId: "lead", content: "水乡非遗市集连接游客与真实技艺。" },
      { sectionId: "body", content: "主稿区分统计事实、图片观察与授权边界。" },
      { sectionId: "image-note", content: "现场图不能独立证明客流总量。" },
    ];
    projection = await execute(
      engine,
      sessionId,
      "student-editor",
      "create_production_artifact",
      {
        templateId: "article-main",
        requestId: "artifact-r1",
        title: "水乡非遗市集主稿",
        summary: "首版固定事实、材料与机器观察。",
        sections,
        citations,
        revisionNote: "建立 R1。",
      },
    );
    const artifact = projection.productionArtifacts[0]!;
    const r1 = projection.artifactRevisions[0]!;
    expect(artifact).toMatchObject({
      revisionCount: 1,
      latestRevisionId: r1.revisionId,
      status: "draft",
    });
    expect(r1.citations.map((citation) => citation.trust)).toEqual(
      expect.arrayContaining([
        "verified_world_fact",
        "source_material",
        "machine_observation",
      ]),
    );

    const duplicate = await execute(
      engine,
      sessionId,
      "student-editor",
      "create_production_artifact",
      {
        templateId: "article-main",
        requestId: "artifact-r1",
        title: "水乡非遗市集主稿",
        summary: "首版固定事实、材料与机器观察。",
        sections,
        citations,
        revisionNote: "建立 R1。",
      },
    );
    expect(duplicate.productionArtifacts).toHaveLength(1);
    expect(duplicate.artifactRevisions).toHaveLength(1);

    await expect(execute(
      engine,
      sessionId,
      "student-reporter",
      "save_artifact_revision",
      {
        artifactId: artifact.artifactId,
        expectedRevisionNumber: 1,
        requestId: "forged-reporter-r2",
        title: "越权修改",
        summary: "记者岗不应能修改责任编辑成果。",
        sections,
        citations,
        revisionNote: "越权。",
      },
    )).rejects.toBeInstanceOf(PermissionDeniedError);

    projection = await execute(
      engine,
      sessionId,
      "student-editor",
      "save_artifact_revision",
      {
        artifactId: artifact.artifactId,
        expectedRevisionNumber: 1,
        requestId: "artifact-r2",
        title: "水乡非遗市集主稿·修订",
        summary: "R2 收紧事实表述并保留来源。",
        sections: sections.map((section) => (
          section.sectionId === "body"
            ? { ...section, content: `${section.content} R2 补充发布边界。` }
            : section
        )),
        citations,
        revisionNote: "保存 R2。",
      },
    );
    expect(projection.productionArtifacts[0]).toMatchObject({
      revisionCount: 2,
    });
    expect(projection.artifactRevisions.map((revision) => (
      revision.revisionNumber
    ))).toEqual([1, 2]);
    expect(projection.artifactRevisions[0]?.contentHash).toBe(
      r1.contentHash,
    );

    await expect(execute(
      engine,
      sessionId,
      "student-editor",
      "save_artifact_revision",
      {
        artifactId: artifact.artifactId,
        expectedRevisionNumber: 1,
        requestId: "stale-r3",
        title: "陈旧覆盖",
        summary: "该请求基于陈旧修订。",
        sections,
        citations,
        revisionNote: "陈旧写入。",
      },
    )).rejects.toThrow("成果修订冲突");
  });

  it("keeps manual supplementation separate and pending review", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "content-manual";
    await engine.createSession(sessionId, true);
    let projection = await execute(
      engine,
      sessionId,
      "student-editor",
      "request_media_processing",
      {
        materialId: "material-visitor-sheet",
        planId: "document-source-extraction",
        requestId: "document-task",
      },
    );
    const task = projection.mediaProcessingTasks[0]!;
    for (const step of task.steps) {
      let state = await engine.getStateSnapshot(sessionId);
      await engine.startMediaProcessingStep({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        stepId: step.stepId,
        expectedStateVersion: state.stateVersion,
        workerId: "failing-worker",
        correlationId: `start-${step.stepId}`,
      });
      state = await engine.getStateSnapshot(sessionId);
      await engine.failMediaProcessingStep({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        stepId: step.stepId,
        expectedStateVersion: state.stateVersion,
        errorCode: "provider_timeout",
        correlationId: `fail-${step.stepId}`,
      });
    }
    let state = await engine.getStateSnapshot(sessionId);
    await engine.finalizeMediaProcessingTask({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      expectedStateVersion: state.stateVersion,
      correlationId: "finalize-failed",
    });

    projection = await execute(
      engine,
      sessionId,
      "student-editor",
      "supply_media_processing_result",
      {
        taskId: task.taskId,
        stepId: task.steps[0]!.stepId,
        summary: "人工查阅材料：客流统计需要按入口去重。",
        requestId: "manual-supply-1",
      },
    );
    const supplemented = projection.mediaProcessingTasks[0]!;
    expect(supplemented.status).toBe("partially_succeeded");
    expect(supplemented.steps[0]).toMatchObject({
      status: "manually_completed",
      output: {
        provider: "human-supplement",
        providerMode: "manual",
        trust: "manual_unverified",
        verificationStatus: "pending_review",
      },
    });
    expect(supplemented.steps[1]).toMatchObject({
      status: "failed",
      output: null,
    });

    const retried = await execute(
      engine,
      sessionId,
      "student-editor",
      "retry_media_processing",
      {
        taskId: task.taskId,
        requestId: "retry-remaining",
      },
    );
    expect(retried.mediaProcessingTasks[0]?.steps.map((step) => step.status)).toEqual([
      "manually_completed",
      "queued",
    ]);
  });
});

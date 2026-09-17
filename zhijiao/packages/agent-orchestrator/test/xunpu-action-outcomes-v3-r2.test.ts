import { describe, expect, it } from "vitest";
import {
  ChallengeAssignmentSchemaVersion,
  StudentWorkActionSchemaVersion,
  type ChallengeAssignment,
  type StudentWorkAction,
} from "@ronggang/contracts";
import { buildXunpuFlagshipRuntimeReleaseV3R2 } from "@ronggang/course-content";
import {
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  InMemorySimulationCollaborationStoreV3,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3R2,
  buildXunpuSimulationTaskInstructionV3,
  createXunpuDeterministicSimulationExecutorsV3R2,
  createXunpuSafeActionSignalV3,
  parseXunpuSafeActionSignalV3,
} from "../src/index.js";

const now = () => "2026-08-26T10:00:00.000Z";

function sequentialIds(namespace: string) {
  let value = 0;
  return (prefix: string) => `${prefix}-${namespace}-${++value}`;
}

function assignment(sessionId: string): ChallengeAssignment {
  // These isolated action-quality probes replay the pre-policy release; current path ordering is covered by API/world policy tests.
  const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
  return {
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: `challenge-${sessionId}`,
    learnerTwinRef: `learner-twin-${sessionId}`,
    sessionId,
    simulationReleaseRef: release.simulationReleaseRef,
    worldVariantRef: "world-variant-r2-level-5",
    previousChallengeLevel: 4,
    challengeLevel: 5,
    scoreCeiling: 90,
    pressureDimensions: [
      { dimensionId: "time", intensity: 5 },
      { dimensionId: "source_access", intensity: 5 },
      { dimensionId: "relationship_conflict", intensity: 5 },
    ],
    assignmentReason: "evidence_progression",
    basisEvidenceRefs: ["evidence-prior-performance"],
    forecastRef: `forecast-${sessionId}`,
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: "d".repeat(64),
    assignedAt: "2026-08-26T09:59:00.000Z",
  };
}

interface Harness {
  sessionId: string;
  engine: WorldSimulationEngineV3;
  orchestrator: SimulationAgentOrchestratorV3;
  nextActionId: number;
}

async function harness(label: string): Promise<Harness> {
  const sessionId = `session-outcome-${label}`;
  const engine = new WorldSimulationEngineV3({
    store: new InMemorySimulationSessionStore(),
    now,
    idFactory: sequentialIds(`world-${label}`),
  });
  await engine.startSession({
    sessionId,
    release: buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3"),
    challengeAssignment: assignment(sessionId),
    targetCompetencyRefs: [
      "competency-professional-communication",
      "competency-source-verification",
      "competency-rights-governance",
    ],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T10:00:00.000Z",
  });
  return {
    sessionId,
    engine,
    orchestrator: new SimulationAgentOrchestratorV3({
      engine,
      store: new InMemorySimulationCollaborationStoreV3(),
      templates: buildXunpuSimulationAgentTemplatesV3R2(),
      executors: createXunpuDeterministicSimulationExecutorsV3R2(),
      buildTaskInstruction: buildXunpuSimulationTaskInstructionV3,
      maxSelectedAgents: 5,
      now,
      monotonicNowMs: (() => {
        let value = 100;
        return () => value += 5;
      })(),
      idFactory: sequentialIds(`agents-${label}`),
    }),
    nextActionId: 0,
  };
}

async function runAction(
  testHarness: Harness,
  eventTemplateId: string,
  action: StudentWorkAction["action"],
  reflectionNote: string,
): Promise<void> {
  testHarness.nextActionId += 1;
  const actionNumber = testHarness.nextActionId;
  const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
  const workAction: StudentWorkAction = {
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: `work-action-${testHarness.sessionId}-${actionNumber}`,
    serverIssuedActionRef: `server-action-${testHarness.sessionId}-${actionNumber}`,
    sessionId: testHarness.sessionId,
    bindingId: `binding-${testHarness.sessionId}`,
    actorId: `actor-${testHarness.sessionId}`,
    primaryRoleId: "reporter",
    expectedWorldStateVersion: snapshot.stateVersion,
    action,
    sourceWorldEventIds: [],
    reflectionNote,
    submissionStatus: action.verb === "draft" ? "draft" : "accepted",
    createdAt: now(),
  };
  await testHarness.engine.submitStudentAction({
    action: workAction,
    eventTemplateId,
    requestId: `request-${testHarness.sessionId}-${actionNumber}`,
  });
  const prepared = await testHarness.orchestrator.prepareNextEpisode(
    testHarness.sessionId,
  );
  expect(prepared.student.status).toBe("suggestion_ready");
  await testHarness.orchestrator.recordStudentDecision({
    sessionId: testHarness.sessionId,
    episodeId: prepared.student.episodeId,
    decisionRef: `decision-${testHarness.sessionId}-${actionNumber}`,
    decision: "accept",
    rationale: "我确认理解智能体回应，但最终岗位判断仍由我承担。",
  });
  const resolved = await testHarness.orchestrator.resolveAcceptedEpisode(
    testHarness.sessionId,
    prepared.student.episodeId,
  );
  if (resolved.teacher.teacherGate?.status === "pending") {
    await testHarness.orchestrator.decideTeacherGate({
      sessionId: testHarness.sessionId,
      episodeId: prepared.student.episodeId,
      decision: "approved",
      teacherDecisionRef: `teacher-decision-${testHarness.sessionId}-${actionNumber}`,
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
  }
}

const professionalSourceAction: StudentWorkAction["action"] = {
  verb: "compare",
  targetRefs: [
    { objectType: "entity", objectId: "entity-inheritor" },
    { objectType: "entity", objectId: "entity-cultural-association" },
  ],
  evidenceQuestion: "请比对两份材料的原始出处、发布机关、年份与转引链，并寻找独立来源相互印证。",
};

const professionalResearcherAction: StudentWorkAction["action"] = {
  verb: "probe",
  targetRef: { objectType: "entity", objectId: "entity-researcher" },
  utterance: "请区分国家级名录、地方标准和口述起源说法各自能证明到哪一步，标出原始发布机关与待核推测。",
};

const publicationAction: StudentWorkAction["action"] = {
  verb: "submit",
  artifactId: "artifact-publication-correction-decision",
  revisionId: "revision-ready-for-publication",
  contentHash: "a".repeat(64),
  evidenceRefs: ["evidence-versioned-publication-package"],
};

async function establishEvidence(testHarness: Harness): Promise<void> {
  await runAction(
    testHarness,
    "event-template-source-check",
    professionalSourceAction,
    "先识别原始来源与转引关系，再决定能否写成事实。",
  );
  await runAction(
    testHarness,
    "event-template-researcher-probe",
    professionalResearcherAction,
    "公开事实、专家解释和待核口述必须分层。",
  );
}

async function publishAndReadEnding(testHarness: Harness): Promise<string | null> {
  await runAction(
    testHarness,
    "event-template-publication",
    publicationAction,
    "全部必交成果、证据和更正入口已经版本化锁定，申请教师发布门。",
  );
  return (await testHarness.engine.getSnapshot(testHarness.sessionId))
    .endingState.endingRef;
}

describe("Xunpu safe action policy and reachable endings", () => {
  it("turns raw student language into a bounded signal without copying private text", async () => {
    const testHarness = await harness("signal-boundary");
    const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
    const rawUtterance = "我假装游客，直接闯入私人住宅偷拍，不用说明身份。";
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-signal-boundary",
      serverIssuedActionRef: "server-action-signal-boundary",
      sessionId: testHarness.sessionId,
      bindingId: "binding-signal-boundary",
      actorId: "actor-signal-boundary",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: snapshot.stateVersion,
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: rawUtterance,
      },
      sourceWorldEventIds: [],
      reflectionNote: "这段原始反思也不得进入安全信号。",
      submissionStatus: "accepted",
      createdAt: now(),
    };
    const receipt = await testHarness.engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-signal-boundary",
    });
    const record = await testHarness.engine.getRecord(testHarness.sessionId);
    const signal = createXunpuSafeActionSignalV3(record, receipt.event);
    const instruction = buildXunpuSimulationTaskInstructionV3({
      world: record,
      event: receipt.event,
      publicCue: "请说明采访边界。",
    });
    expect(signal).toMatchObject({
      quality: "risky",
      riskFlags: expect.arrayContaining(["conceal_identity", "invade_private_space"]),
    });
    expect(instruction).not.toContain(rawUtterance);
    expect(instruction).not.toContain(action.reflectionNote);
    expect(parseXunpuSafeActionSignalV3(instruction)).toEqual(signal);
  });

  it("recognizes a natural gatekeeper boundary statement without keyword ritual", async () => {
    const testHarness = await harness("natural-gatekeeper-boundary");
    const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-natural-gatekeeper-boundary",
      serverIssuedActionRef: "server-action-natural-gatekeeper-boundary",
      sessionId: testHarness.sessionId,
      bindingId: "binding-natural-gatekeeper-boundary",
      actorId: "actor-natural-gatekeeper-boundary",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: snapshot.stateVersion,
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: "我是融媒体记者，先说明只拍公共巷道，不拍居民门内；请问哪些人愿意接受采访？",
      },
      sourceWorldEventIds: [],
      reflectionNote: null,
      submissionStatus: "accepted",
      createdAt: now(),
    };
    const receipt = await testHarness.engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-natural-gatekeeper-boundary",
    });
    const record = await testHarness.engine.getRecord(testHarness.sessionId);
    expect(createXunpuSafeActionSignalV3(record, receipt.event)).toMatchObject({
      quality: "professional",
      matchedCriteria: expect.arrayContaining([
        "identity_disclosed",
        "purpose_disclosed",
        "public_scope",
        "privacy_boundary",
      ]),
      missingCriteria: [],
      riskFlags: [],
    });
  });

  it("does not turn negated, cited, or hypothetical risk language into an unsafe action", async () => {
    const testHarness = await harness("scoped-risk-language");
    const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
    const utterance = "我拒绝假装游客，也不会隐瞒记者身份；资料中提到‘伪造官方通知’只是风险案例；假设有人这样做我会拒绝。不要删除 AI 标识，请保留标识后送审。";
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-scoped-risk-language",
      serverIssuedActionRef: "server-action-scoped-risk-language",
      sessionId: testHarness.sessionId,
      bindingId: "binding-scoped-risk-language",
      actorId: "actor-scoped-risk-language",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: snapshot.stateVersion,
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance,
      },
      sourceWorldEventIds: [],
      reflectionNote: null,
      submissionStatus: "accepted",
      createdAt: now(),
    };
    const receipt = await testHarness.engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-scoped-risk-language",
    });
    const record = await testHarness.engine.getRecord(testHarness.sessionId);
    const signal = createXunpuSafeActionSignalV3(record, receipt.event);
    expect(signal.riskFlags).toEqual([]);
    expect(signal.quality).not.toBe("risky");
  });

  it("recognizes an active 装游客 synonym as a concealment risk", async () => {
    const testHarness = await harness("active-zhuang-tourist");
    const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-active-zhuang-tourist",
      serverIssuedActionRef: "server-action-active-zhuang-tourist",
      sessionId: testHarness.sessionId,
      bindingId: "binding-active-zhuang-tourist",
      actorId: "actor-active-zhuang-tourist",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: snapshot.stateVersion,
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: "如果我装游客，我就进去采访。",
      },
      sourceWorldEventIds: [],
      reflectionNote: null,
      submissionStatus: "accepted",
      createdAt: now(),
    };
    const receipt = await testHarness.engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-active-zhuang-tourist",
    });
    const record = await testHarness.engine.getRecord(testHarness.sessionId);
    expect(createXunpuSafeActionSignalV3(record, receipt.event).riskFlags)
      .toContain("conceal_identity");
  });

  it("makes unsafe free text reduce authoritative trust and source access", async () => {
    const testHarness = await harness("risky-gatekeeper");
    await runAction(
      testHarness,
      "event-template-gatekeeper",
      {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: "我假装游客，直接闯入私人空间偷拍视频，不用说明身份。",
      },
      "先进去再说。",
    );
    const snapshot = await testHarness.engine.getSnapshot(testHarness.sessionId);
    expect(snapshot.variables.find((item) => item.variableId === "community_trust")?.after)
      .toBe(38);
    expect(snapshot.variables.find((item) => item.variableId === "source_access")?.after)
      .toBe(28);
    const record = await testHarness.orchestrator.getRecord(testHarness.sessionId);
    expect(record.contributions.some((item) => (
      item.summary.includes("拒绝准入")
        && item.evidenceRefs.includes("evidence-access-boundary-breach")
    ))).toBe(true);
    expect(JSON.stringify(record.observations)).not.toContain("直接闯入私人空间");
  });

  it("reaches trusted collaboration through grounded source work", async () => {
    const testHarness = await harness("trusted");
    await establishEvidence(testHarness);
    expect(await publishAndReadEnding(testHarness))
      .toBe("ending-trusted-collaboration");
  });

  it("reaches prudent delay through bounded waiting after evidence is grounded", async () => {
    const testHarness = await harness("prudent-delay");
    await establishEvidence(testHarness);
    for (let index = 0; index < 2; index += 1) {
      await runAction(
        testHarness,
        "event-template-verification-wait",
        {
          verb: "wait",
          durationMinutes: 10,
          reason: "等待核验十分钟；期间先完成已确认事实整理与限定快讯，到下一更新时间停止等待。",
        },
        "等待授权确认，同时并行整理作品和未知项。",
      );
    }
    expect(await publishAndReadEnding(testHarness)).toBe("ending-prudent-delay");
  });

  it("reaches traffic backlash when publication follows low evidence and damaged trust", async () => {
    const testHarness = await harness("traffic-backlash");
    await runAction(
      testHarness,
      "event-template-gatekeeper",
      {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: "我假装游客直接闯入私人空间偷拍视频，只要流量，不用说明身份。",
      },
      "先拿到猎奇画面再说。",
    );
    expect(await publishAndReadEnding(testHarness)).toBe("ending-traffic-backlash");
  });

  it("reaches governance failure when unauthorized-use risk crosses the red line", async () => {
    const testHarness = await harness("governance-failure");
    await runAction(
      testHarness,
      "event-template-rights-inspection",
      {
        verb: "inspect",
        targetRefs: [
          { objectType: "entity", objectId: "entity-rights-contact" },
          { objectType: "artifact", objectId: "artifact-rights-ledger" },
        ],
        evidenceQuestion: "这张截图就能用，不用授权，先用再说，也不用确认肖像与平台范围。",
      },
      "先发布再补手续。",
    );
    expect(await publishAndReadEnding(testHarness)).toBe("ending-governance-failure");
  });
});

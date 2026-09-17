import { describe, expect, it, vi } from "vitest";
import {
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
  WorldSimulationReleaseSchema,
  type EvidenceAssessmentDecisionV4,
} from "@ronggang/contracts";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  xunpuV4AdaptationVariants,
} from "@ronggang/course-content";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import type { FlagshipAssessmentRecordV4 } from "../src/flagship-assessment-v4.js";
import {
  InMemoryLearnerAdaptationStoreV4,
  LearnerAdaptationErrorV4,
  LearnerAdaptationServiceV4,
  deriveSecondSessionReleaseV4,
  type LearnerProxyModelV4,
} from "../src/learner-adaptation-v4.js";

const fixedNow = "2026-08-29T09:00:00.000Z";
const sourceSessionId = "session-adaptation-v4-source";
const learnerBindingId = "binding-adaptation-v4-student";
const learnerActorId = "student-reporter";
const learnerSubjectHash = "a".repeat(64);

function finalDecision(status: "provisional" | "final" = "final"):
EvidenceAssessmentDecisionV4 {
  const criteria = [
    ["criterion-fact-verification", 56],
    ["criterion-interview-consent", 72],
    ["criterion-editorial-judgment", 78],
    ["criterion-rights-governance", 75],
    ["criterion-multiplatform-production", 82],
    ["criterion-recovery-transfer", 68],
  ] as const;
  return {
    schemaVersion: "evidence-assessment-decision/4.0.0",
    assessmentDecisionId: `assessment-decision-${status}`,
    blindCaseRef: "blind-case-adaptation-v4",
    blindInputHash: "b".repeat(64),
    status,
    assessorMode: "deterministic_fallback",
    rubricReviewStatus: status === "final" ? "verified" : "pending_expert_review",
    criterionAssessments: criteria.map(([criterionId, score], index) => ({
      criterionId,
      evidenceStatus: "supported" as const,
      band: score >= 80 ? "high" as const : score >= 65 ? "medium" as const : "low" as const,
      score,
      confidence: 0.8,
      evidenceRefs: [`evidence-criterion-${index + 1}`],
      rationale: "该判断只使用结构化作品、行动、后果和证据引用。",
      surfaceSignalsUsed: false as const,
    })),
    sessionScore: 72,
    evidenceRefs: criteria.map((_, index) => `evidence-criterion-${index + 1}`),
    adviceAgentExcluded: true,
    challengeAppliedAfterBlindAssessment: true,
    challengeAdjustmentRef: "challenge-adjustment-adaptation-v4",
    teacherReview: status === "final"
      ? {
          status: "confirmed",
          teacherDecisionRef: "teacher-decision-adaptation-v4",
          rationale: "教师逐维核对同一证据后确认本轮最终评价。",
          reviewedAt: fixedNow,
        }
      : {
          status: "pending",
          teacherDecisionRef: null,
          rationale: null,
          reviewedAt: null,
        },
    generatedAt: fixedNow,
  };
}

function assessmentRecord(
  decision = finalDecision(),
  evidenceFacts: FlagshipAssessmentRecordV4["evidenceFacts"] = [],
): FlagshipAssessmentRecordV4 {
  return {
    sessionId: sourceSessionId,
    learnerBindingId,
    learnerActorId,
    learnerSubjectHash,
    evidenceFacts,
    decisionHistory: [{ sourceHash: "c".repeat(64), decision }],
  } as FlagshipAssessmentRecordV4;
}

function sourceWorld(release = buildXunpuFlagshipRuntimeReleaseV3R2()):
SimulationSessionRecord {
  return {
    sessionId: sourceSessionId,
    release,
    challengeAssignment: {
      challengeLevel: 4,
      scoreCeiling: 85,
    },
    currentSnapshot: {
      learningContext: { scaffoldingLevel: 1 },
    },
    studentActions: [],
  } as unknown as SimulationSessionRecord;
}

function runtime(input?: {
  decision?: EvidenceAssessmentDecisionV4;
  evidenceFacts?: FlagshipAssessmentRecordV4["evidenceFacts"];
  learnerProxyModel?: LearnerProxyModelV4;
  learnerProxyTimeoutMs?: number;
  learnerProxyBudgetMicros?: number;
}) {
  const assessment = assessmentRecord(
    input?.decision ?? finalDecision(),
    input?.evidenceFacts ?? [],
  );
  const worlds = new Map<string, SimulationSessionRecord>([
    [sourceSessionId, sourceWorld()],
  ]);
  const store = new InMemoryLearnerAdaptationStoreV4();
  const provision = vi.fn(async (request) => {
    worlds.set(request.challengeAssignment.sessionId, {
      sessionId: request.challengeAssignment.sessionId,
      release: request.release,
      challengeAssignment: request.challengeAssignment,
      studentActions: [],
    } as unknown as SimulationSessionRecord);
    return {
      learnerSubjectHash,
      membershipRef: "membership-adaptation-v4-second",
      bindingRef: "binding-adaptation-v4-second",
      courseReleaseRef: request.release.courseReleaseRef,
      scenarioReleaseRef: request.release.scenarioReleaseRef,
      simulationReleaseRef: request.release.simulationReleaseRef,
      sessionRef: request.challengeAssignment.sessionId,
      challengeAssignmentRef: request.challengeAssignment.challengeAssignmentId,
      provisionedAt: fixedNow,
    };
  });
  const service = new LearnerAdaptationServiceV4({
    assessment: {
      getAssessment: vi.fn(async () => assessment),
    },
    engine: {
      getRecord: vi.fn(async (sessionId: string) => {
        const record = worlds.get(sessionId);
        if (!record) throw new Error(`missing world ${sessionId}`);
        return record;
      }),
    },
    store,
    provisionSecondSession: provision,
    ...(input?.learnerProxyModel
      ? { learnerProxyModel: input.learnerProxyModel }
      : {}),
    ...(input?.learnerProxyTimeoutMs !== undefined
      ? { learnerProxyTimeoutMs: input.learnerProxyTimeoutMs }
      : {}),
    ...(input?.learnerProxyBudgetMicros !== undefined
      ? { learnerProxyBudgetMicros: input.learnerProxyBudgetMicros }
      : {}),
    now: () => fixedNow,
  });
  return { service, store, provision, worlds };
}

function proxyDraft(
  selectedVariantRef: "variant-xunpu-source-triangulation"
    | "variant-xunpu-consent-negotiation"
    | "variant-xunpu-deadline-service"
    | "variant-xunpu-editorial-independence" = "variant-xunpu-deadline-service",
) {
  const variants = [
    "variant-xunpu-source-triangulation",
    "variant-xunpu-consent-negotiation",
    "variant-xunpu-deadline-service",
    "variant-xunpu-editorial-independence",
  ] as const;
  return {
    growthTargetRefs: ["criterion-recovery-transfer"] as const,
    selectedVariantRef,
    candidates: variants.map((variantRef, index) => ({
      variantRef,
      predictedSuccessProbability: 0.55 + index * 0.05,
      predictedOverloadProbability: 0.35 - index * 0.04,
      predictedGrowthValue: variantRef === selectedVariantRef ? 0.86 : 0.55,
      rationale: variantRef === selectedVariantRef
        ? "该候选聚焦当前纠错与迁移证据的可观察缺口。"
        : "该候选仅保留为下一场反事实比较。",
    })),
    limitations: [
      "只依据已终裁的可观察岗位证据提出下一场训练假设。",
      "预测不进入本轮评分，也不能代替学生行动。",
    ],
  };
}

function liveProxyModel(output: unknown = proxyDraft()): LearnerProxyModelV4 & {
  propose: ReturnType<typeof vi.fn>;
} {
  return {
    propose: vi.fn(async () => ({
      output,
      providerId: "deepseek",
      modelId: "model-learner-proxy-test",
      traceRef: "trace-learner-proxy-test",
      latencyMs: 21,
      estimatedCostMicros: 321,
    })),
  };
}

describe("learner adaptation V4", () => {
  it("does not create a learner model before the evidence assessment is final", async () => {
    const learnerProxyModel = liveProxyModel();
    const { service, store } = runtime({
      decision: finalDecision("provisional"),
      learnerProxyModel,
    });
    await expect(service.getOrRefresh({
      sessionId: sourceSessionId,
      fallbackLearner: { bindingId: learnerBindingId, actorId: learnerActorId },
    })).resolves.toBeNull();
    await expect(store.load(sourceSessionId)).resolves.toBeNull();
    expect(learnerProxyModel.propose).not.toHaveBeenCalled();
    expect(service.projectView(null, "student")).toMatchObject({
      state: "evidence_required",
      learnerModel: null,
      proposal: null,
    });
  });

  it("lets the constrained learner agent compare all variants without receiving identity", async () => {
    const learnerProxyModel = liveProxyModel();
    const { service } = runtime({ learnerProxyModel });
    const record = await service.getOrRefresh({
      sessionId: sourceSessionId,
      fallbackLearner: { bindingId: learnerBindingId, actorId: learnerActorId },
    });
    expect(record?.forecast).toMatchObject({
      assessorMode: "independent_live_agent",
      selectedVariantRef: "variant-xunpu-deadline-service",
    });
    expect(record?.learnerTwin.growthTargetRefs).toEqual(["criterion-recovery-transfer"]);
    expect(record?.proxyRuns).toEqual([
      expect.objectContaining({
        mode: "independent_live_agent",
        fallbackReason: null,
        providerId: "deepseek",
      }),
    ]);
    const observation = learnerProxyModel.propose.mock.calls[0]![0];
    expect(observation.allowedVariants).toHaveLength(4);
    expect(observation.constraints).toMatchObject({
      evidenceEligibleForScore: false,
      canActForStudent: false,
      studentConsentRequired: true,
      teacherAuthorizationRequired: true,
    });
    const serializedObservation = JSON.stringify(observation);
    for (const forbidden of [
      learnerSubjectHash,
      learnerBindingId,
      learnerActorId,
      sourceSessionId,
      "studentId",
      "bindingId",
      "actorId",
      "prompt",
      "provider",
      "性别",
      "家庭收入",
    ]) {
      expect(serializedObservation).not.toContain(forbidden);
    }
    expect(JSON.stringify(service.projectView(record!, "student"))).not.toContain("proxyRuns");
    expect(JSON.stringify(service.projectView(record!, "teacher"))).not.toContain("trace-learner-proxy-test");
    expect(service.projectAdminCase(record!).proxyRuns[0]).toMatchObject({
      traceRef: "trace-learner-proxy-test",
      estimatedCostMicros: 321,
    });
  });

  it("keeps support, counterevidence and uncertainty explicit in the learner model", async () => {
    const decision = finalDecision();
    decision.criterionAssessments[0] = {
      ...decision.criterionAssessments[0]!,
      evidenceStatus: "mixed",
      evidenceRefs: ["evidence-source-supported", "evidence-source-refuted"],
    };
    decision.evidenceRefs = [
      ...decision.evidenceRefs.filter((reference) => reference !== "evidence-criterion-1"),
      "evidence-source-supported",
      "evidence-source-refuted",
    ];
    const evidenceFacts: FlagshipAssessmentRecordV4["evidenceFacts"] = [
      {
        evidenceRef: "evidence-source-supported",
        sourceKind: "world_consequence",
        evidenceCode: "cross_source_comparison",
        independenceKey: "independent-source-supported",
        sourceContentHash: "d".repeat(64),
      },
      {
        evidenceRef: "evidence-source-refuted",
        sourceKind: "world_consequence",
        evidenceCode: "unsupported_claim_detected",
        independenceKey: "independent-source-refuted",
        sourceContentHash: "e".repeat(64),
      },
      {
        evidenceRef: "evidence-source-refuted",
        sourceKind: "world_consequence",
        evidenceCode: "bounded_unknown",
        independenceKey: "independent-source-refuted-other-claim",
        sourceContentHash: "e".repeat(64),
      },
    ];
    const { service } = runtime({ decision, evidenceFacts });
    const record = await service.getOrRefresh({ sessionId: sourceSessionId });
    const criterion = record?.learnerTwin.criterionStates.find(
      (candidate) => candidate.criterionId === "criterion-fact-verification",
    );
    expect(criterion).toMatchObject({
      supportEvidenceRefs: ["evidence-source-supported"],
      counterEvidenceRefs: ["evidence-source-refuted"],
      uncertaintyDrivers: expect.arrayContaining(["mixed_evidence", "refuting_evidence"]),
    });
  });

  it("fails closed to deterministic inference when the model invents an ineligible target", async () => {
    const invalid = {
      ...proxyDraft("variant-xunpu-editorial-independence"),
      growthTargetRefs: ["criterion-multiplatform-production"],
    };
    const learnerProxyModel = liveProxyModel(invalid);
    const { service } = runtime({ learnerProxyModel });
    const record = await service.getOrRefresh({ sessionId: sourceSessionId });
    expect(record?.forecast).toMatchObject({
      assessorMode: "deterministic_fallback",
      selectedVariantRef: "variant-xunpu-source-triangulation",
    });
    expect(record?.proxyRuns[0]).toMatchObject({
      mode: "deterministic_fallback",
      fallbackReason: "model_invalid_output",
      providerId: "deepseek",
    });
  });

  it("bounds learner-agent timeout and zero-budget execution", async () => {
    const never = {
      propose: vi.fn(async () => new Promise<never>(() => undefined)),
    } satisfies LearnerProxyModelV4;
    const timed = runtime({ learnerProxyModel: never, learnerProxyTimeoutMs: 1 });
    const timedRecord = await timed.service.getOrRefresh({ sessionId: sourceSessionId });
    expect(timedRecord?.proxyRuns[0]?.fallbackReason).toBe("model_timeout");

    const blocked = liveProxyModel();
    const zeroBudget = runtime({ learnerProxyModel: blocked, learnerProxyBudgetMicros: 0 });
    const zeroRecord = await zeroBudget.service.getOrRefresh({ sessionId: sourceSessionId });
    expect(zeroRecord?.proxyRuns[0]?.fallbackReason).toBe("model_cost_exceeded");
    expect(blocked.propose).not.toHaveBeenCalled();
  });

  it("derives a real immutable world release with multiple executable changes", () => {
    const base = buildXunpuFlagshipRuntimeReleaseV3R2();
    const variant = xunpuV4AdaptationVariants.find(
      (candidate) => candidate.variantId === "variant-xunpu-source-triangulation",
    )!;
    const derived = deriveSecondSessionReleaseV4({
      baseRelease: base,
      variant,
      targetChallengeLevel: 4,
    });
    expect(WorldSimulationReleaseSchema.safeParse(derived.release).success).toBe(true);
    expect(derived.release.simulationReleaseRef.contentHash)
      .not.toBe(base.simulationReleaseRef.contentHash);
    expect(derived.release.expectedDurationMinutes).toBe(52);
    expect(derived.changedMechanics.map((item) => item.mechanicKind)).toEqual(
      expect.arrayContaining(["event_templates", "npc_resistance", "evidence_availability", "deadline_pattern"]),
    );
    expect(derived.changedMechanics.every((item) => item.beforeHash !== item.afterHash)).toBe(true);
    const target = derived.release.challengeVariants.find((item) => item.challengeLevel === 4)!;
    expect(target.worldVariantId).toBe(derived.selectedWorldVariantRef);
    expect(target.eventTemplateRefs).not.toEqual(
      base.challengeVariants.find((item) => item.challengeLevel === 4)!.eventTemplateRefs,
    );
    for (const event of derived.release.eventTemplates) {
      expect(event.challengeLevels.includes(4)).toBe(
        target.eventTemplateRefs.includes(event.eventTemplateId),
      );
    }
  });

  it("builds an evidence-only appealable proposal and hides identity from public views", async () => {
    const { service } = runtime();
    const record = await service.getOrRefresh({
      sessionId: sourceSessionId,
      fallbackLearner: { bindingId: learnerBindingId, actorId: learnerActorId },
    });
    expect(record?.handoff).toMatchObject({
      status: "proposed",
      proposal: {
        variantRef: "variant-xunpu-source-triangulation",
        sourceChallengeLevel: 4,
        targetChallengeLevel: 4,
        observationWindow: {
          policyVersion: "learner-calibration-v4/task-outcome-v1",
          startVirtualMinute: 0,
          endVirtualMinute: 52,
          minimumCommittedWorldEvents: 2,
        },
      },
    });
    if (!record) throw new Error("expected record");
    const view = service.projectView(record, "student");
    expect(view).toMatchObject({
      state: "proposed",
      boundaries: {
        immutablePersonalityLabelsForbidden: true,
        proxyCanActForStudent: false,
        proxyCanScoreStudent: false,
      },
      learnerModel: { evidenceBased: true, personalityDiagnosis: false },
    });
    const serialized = JSON.stringify(view);
    for (const forbidden of [learnerSubjectHash, learnerBindingId, learnerActorId, "prompt", "provider", "rawStudentUtterance"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("requires exact learner consent and teacher authorization before real provisioning", async () => {
    const { service, provision } = runtime();
    const proposed = await service.getOrRefresh({ sessionId: sourceSessionId });
    if (!proposed) throw new Error("expected proposal");
    await expect(service.authorizeAndProvision({
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      teacherPrincipalId: "principal-teacher",
      requestId: "request-authorize-without-consent",
      expectedHandoffId: proposed.handoff.handoffId,
    })).rejects.toMatchObject({ code: "consent_required" });
    expect(provision).not.toHaveBeenCalled();

    await expect(service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId: "binding-other-student",
      learnerActorId,
      requestId: "request-forged-consent",
      accepted: true,
    })).rejects.toMatchObject({ code: "access_denied" });
    const consented = await service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-valid-consent",
      accepted: true,
    });
    expect(consented.consent.status).toBe("accepted");
    const provisioned = await service.authorizeAndProvision({
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      teacherPrincipalId: "principal-teacher",
      requestId: "request-valid-authorization",
      expectedHandoffId: proposed.handoff.handoffId,
    });
    expect(provisioned.handoff.status).toBe("provisioned");
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision.mock.calls[0]![0].release.simulationReleaseRef.contentHash)
      .not.toBe(sourceWorld().release.simulationReleaseRef.contentHash);
  });

  it("keeps the second session closed when the learner declines the proposal", async () => {
    const { service, provision } = runtime();
    const proposed = await service.getOrRefresh({ sessionId: sourceSessionId });
    if (!proposed) throw new Error("expected proposal");
    const declined = await service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-decline-proposal",
      accepted: false,
    });
    expect(declined.consent.status).toBe("declined");
    await expect(service.authorizeAndProvision({
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      teacherPrincipalId: "principal-teacher",
      requestId: "request-authorize-declined",
      expectedHandoffId: proposed.handoff.handoffId,
    })).rejects.toMatchObject({ code: "consent_required" });
    expect(provision).not.toHaveBeenCalled();
  });

  it("resumes an interrupted provision with the exact authorization receipt", async () => {
    const { service, store, provision } = runtime();
    const proposed = await service.getOrRefresh({ sessionId: sourceSessionId });
    if (!proposed) throw new Error("expected proposal");
    await service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-consent-resumable",
      accepted: true,
    });
    provision.mockRejectedValueOnce(new Error("simulated process interruption"));
    const authorization = {
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      teacherPrincipalId: "principal-teacher",
      requestId: "request-authorize-resumable",
      expectedHandoffId: proposed.handoff.handoffId,
    };
    await expect(service.authorizeAndProvision(authorization))
      .rejects.toMatchObject({ code: "provisioning_failed" });
    expect((await store.load(sourceSessionId))?.handoff.status).toBe("authorized");

    const resumed = await service.authorizeAndProvision(authorization);
    expect(resumed.handoff.status).toBe("provisioned");
    expect(provision).toHaveBeenCalledTimes(2);
    expect(resumed.requestReceipts.filter((receipt) => (
      receipt.requestId === authorization.requestId
    ))).toHaveLength(1);
  });

  it("freezes provisioning while an appeal is open and detects replay substitution", async () => {
    const { service } = runtime();
    const proposed = await service.getOrRefresh({ sessionId: sourceSessionId });
    if (!proposed) throw new Error("expected proposal");
    const appealed = await service.requestAppeal({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-open-appeal",
      reason: "本轮录音证据没有完整进入能力判断，请教师按原始证据重新核对。",
    });
    expect(appealed.appeal.status).toBe("open");
    await expect(service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-consent-during-appeal",
      accepted: true,
    })).rejects.toMatchObject({ code: "appeal_open" });
    await expect(service.requestAppeal({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-open-appeal",
      reason: "用同一个请求号替换为另一段申诉文本，必须被拒绝。",
    })).rejects.toBeInstanceOf(LearnerAdaptationErrorV4);
    const resolved = await service.reviewAppeal({
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      requestId: "request-review-appeal",
      expectedAppealRef: appealed.appeal.appealRef!,
      resolution: "confirmed",
      reason: "已逐项复核原始证据引用，维持现有能力判断与训练靶点。",
    });
    expect(resolved.appeal).toMatchObject({ status: "resolved", resolution: "confirmed" });
  });

  it("calibrates only from accepted actions in the provisioned session and never scores them", async () => {
    const { service, worlds } = runtime();
    const proposed = await service.getOrRefresh({ sessionId: sourceSessionId });
    if (!proposed) throw new Error("expected proposal");
    const sourceCriterionScores = new Map(proposed.learnerTwin.criterionStates.map(
      (criterion) => [criterion.criterionId, criterion.score],
    ));
    const predicted = proposed.forecast.candidates.find(
      (candidate) => candidate.variantRef === proposed.forecast.selectedVariantRef,
    )!.predictedSuccessProbability;
    await service.recordConsent({
      sessionId: sourceSessionId,
      learnerBindingId,
      learnerActorId,
      requestId: "request-consent-calibration",
      accepted: true,
    });
    const provisioned = await service.authorizeAndProvision({
      sessionId: sourceSessionId,
      teacherActorId: "teacher-main",
      teacherPrincipalId: "principal-teacher",
      requestId: "request-authorize-calibration",
      expectedHandoffId: proposed.handoff.handoffId,
    });
    if (provisioned.handoff.status !== "provisioned") throw new Error("not provisioned");
    const second = worlds.get(provisioned.handoff.provision.sessionRef)!;
    second.studentActions = [
      StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: "work-action-second-session-compare",
        serverIssuedActionRef: "server-action-second-session-compare",
        sessionId: second.sessionId,
        bindingId: provisioned.handoff.provision.bindingRef,
        actorId: learnerActorId,
        primaryRoleId: "reporter",
        expectedWorldStateVersion: 0,
        action: {
          verb: "compare",
          targetRefs: [{ objectType: "entity", objectId: "entity-researcher" }],
          evidenceQuestion: "原始出处与转引是否支持同一个年份主张？",
        },
        sourceWorldEventIds: [],
        reflectionNote: "比较结果不足时主动降级主张，不等待系统代答。",
        submissionStatus: "accepted",
        createdAt: fixedNow,
      }),
      StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: "work-action-second-session-official",
        serverIssuedActionRef: "server-action-second-session-official",
        sessionId: second.sessionId,
        bindingId: provisioned.handoff.provision.bindingRef,
        actorId: learnerActorId,
        primaryRoleId: "reporter",
        expectedWorldStateVersion: 0,
        action: {
          verb: "ask",
          targetRef: { objectType: "entity", objectId: "entity-public-liaison" },
          utterance: "请确认公开数据的主体、统计时点和下一次更新时间。",
        },
        sourceWorldEventIds: [],
        reflectionNote: "把已知、未知和更新时间分开记录。",
        submissionStatus: "accepted",
        createdAt: fixedNow,
      }),
      StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: "work-action-second-session-wait",
        serverIssuedActionRef: "server-action-second-session-wait",
        sessionId: second.sessionId,
        bindingId: provisioned.handoff.provision.bindingRef,
        actorId: learnerActorId,
        primaryRoleId: "reporter",
        expectedWorldStateVersion: 1,
        action: {
          verb: "wait",
          durationMinutes: 10,
          reason: "等待官方汇总，同时先整理已确认服务信息。",
        },
        sourceWorldEventIds: [],
        reflectionNote: "等待有明确时限，期间并行整理稿件。",
        submissionStatus: "accepted",
        createdAt: fixedNow,
      }),
      StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: "work-action-second-session-draft",
        serverIssuedActionRef: "server-action-second-session-draft",
        sessionId: second.sessionId,
        bindingId: provisioned.handoff.provision.bindingRef,
        actorId: learnerActorId,
        primaryRoleId: "reporter",
        expectedWorldStateVersion: 2,
        action: {
          verb: "draft",
          artifactId: "artifact-multiplatform-package",
          revisionId: "revision-second-session-draft",
          parentRevisionId: null,
          contentHash: "d".repeat(64),
        },
        sourceWorldEventIds: [],
        reflectionNote: "快讯与深度稿分开，保留来源时点和未知项。",
        submissionStatus: "draft",
        createdAt: fixedNow,
      }),
      StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: "work-action-other-learner",
        serverIssuedActionRef: "server-action-other-learner",
        sessionId: second.sessionId,
        bindingId: "binding-other",
        actorId: "student-other",
        primaryRoleId: "reporter",
        expectedWorldStateVersion: 0,
        action: {
          verb: "compare",
          targetRefs: [{ objectType: "entity", objectId: "entity-researcher" }],
          evidenceQuestion: "其他学习者的行动是否会被错误归入本人的预测校准？",
        },
        sourceWorldEventIds: [],
        reflectionNote: "跨学习者证据必须隔离。",
        submissionStatus: "accepted",
        createdAt: fixedNow,
      }),
    ];
    const committedEvents = [
      ["event-second-session-compare", "student_compares_sources", "work-action-second-session-compare"],
      ["event-second-session-official", "student_requests_official_data", "work-action-second-session-official"],
      ["event-second-session-wait", "student_waits_for_verification", "work-action-second-session-wait"],
      ["event-second-session-draft", "student_drafts_story", "work-action-second-session-draft"],
    ].map(([eventId, eventType, sourceRef], index) => ({
      eventId,
      eventType,
      sourceKind: "student_action",
      sourceRef,
      sequence: index + 1,
      status: "committed",
      resolutionId: `resolution-${eventId}`,
    }));
    second.queue = committedEvents as never;
    second.consequences = committedEvents.map((event, index) => ({
      eventId: `consequence-${index + 1}`,
      sourceWorldEventId: event.eventId,
      resolutionId: event.resolutionId,
      evidenceIds: [`evidence-${index + 1}`],
    })) as never;
    second.resolutions = committedEvents.map((event, index) => ({
      resolutionId: event.resolutionId,
      sourceWorldEventId: event.eventId,
      status: "committed",
      teacherGate: null,
      variableDeltas: [],
      emittedWorldEventIds: [event.eventId],
      emittedEvidenceIds: [`evidence-${index + 1}`],
    })) as never;
    second.currentSnapshot = {
      stateVersion: committedEvents.length,
      virtualTime: { elapsedMinutes: 52 },
      endingState: { status: "active" },
      variables: second.release.variableDefinitions.map((variable) => ({
        variableId: variable.variableId,
        before: variable.initialValue,
        delta: variable.variableId === "evidence_confidence" ? 1 : 0,
        after: variable.initialValue + (variable.variableId === "evidence_confidence" ? 1 : 0),
      })),
      facts: [],
    } as never;
    const calibrated = await service.getOrRefresh({ sessionId: sourceSessionId });
    expect(calibrated?.handoff.status).toBe("calibration_completed");
    if (calibrated?.handoff.status !== "calibration_completed") throw new Error("not calibrated");
    expect(calibrated.handoff.calibration).toMatchObject({
      actualStudentActionRefs: [
        "work-action-second-session-compare",
        "work-action-second-session-official",
        "work-action-second-session-wait",
        "work-action-second-session-draft",
      ],
      forecastError: Number(Math.abs(predicted - 1).toFixed(3)),
      evidenceEligibleForScore: false,
      policyVersion: "learner-calibration-v4/task-outcome-v1",
      outcome: "success",
      observedBehaviorAlignment: 1,
      observationWindow: {
        startVirtualMinute: 0,
        endVirtualMinute: 52,
        closedBy: "window_elapsed",
      },
      evidence: expect.objectContaining({
        studentActionRefs: expect.arrayContaining([
          "work-action-second-session-compare",
          "work-action-second-session-draft",
        ]),
        committedWorldEventRefs: expect.arrayContaining([
          "event-second-session-compare",
          "event-second-session-draft",
        ]),
      }),
    });
    expect(calibrated.learnerTwin.calibrationCount).toBe(1);
    expect(service.projectView(calibrated, "student").handoff?.calibration).toMatchObject({
      policyVersion: "learner-calibration-v4/task-outcome-v1",
      outcome: "success",
      observedBehaviorAlignment: 1,
    });
    expect(calibrated.learnerTwin.calibrationHistory).toEqual([
      expect.objectContaining({
        predictedSuccessProbability: predicted,
        observedBehaviorAlignment: 1,
        absolutePredictionError: Number(Math.abs(predicted - 1).toFixed(3)),
        policyVersion: "learner-calibration-v4/task-outcome-v1",
        outcome: "success",
        observationEvidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(calibrated.forecast.revision).toBe(2);
    for (const criterion of calibrated.learnerTwin.criterionStates) {
      expect(criterion.score).toBe(sourceCriterionScores.get(criterion.criterionId));
    }
    const replayed = await service.getOrRefresh({ sessionId: sourceSessionId });
    expect(replayed?.recordRevision).toBe(calibrated.recordRevision);
    expect(replayed?.learnerTwin.calibrationCount).toBe(1);
    expect(replayed?.handoff).toEqual(calibrated.handoff);
  });
});

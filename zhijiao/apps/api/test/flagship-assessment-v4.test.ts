import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MediaWorkRevisionV4Schema,
  MediaWorkRevisionV4SchemaVersion,
  SimulationResolutionSchema,
  SimulationResolutionSchemaVersion,
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
} from "@ronggang/contracts";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  hashCanonical,
  xunpuFlagshipContentManifestV3,
  xunpuFlagshipContentV4,
  xunpuV4AssessmentCriteria,
} from "@ronggang/course-content";
import {
  EvidenceAssessmentRubricV4Schema,
  type WorkQualityModelV4,
} from "@ronggang/agent-orchestrator";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import {
  FlagshipAssessmentErrorV4,
  FlagshipEvidenceAssessmentServiceV4,
  InMemoryFlagshipAssessmentStoreV4,
  JsonFileFlagshipAssessmentStoreV4,
  currentFlagshipAssessmentDecisionV4,
} from "../src/flagship-assessment-v4.js";
import {
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import { flagshipContentReferenceV4Of } from "../src/flagship-experience-v4.js";
import type { FlagshipMultimodalQualityPreparerV4 } from "../src/flagship-multimodal-quality-v4.js";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";
import {
  BusinessOperationCoordinator,
  InMemoryBusinessOperationReceiptStore,
} from "../src/business-operation-receipt.js";

const bindingId = "binding-assessment-v4";
const actorId = "student-assessment-v4";
const principalId = "principal-assessment-v4";
const fixedNow = "2026-08-28T14:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const rubric = EvidenceAssessmentRubricV4Schema.parse({
  rubricVersion: "xunpu-evidence-rubric-v4-test-r1",
  rubricContentHash: hashCanonical(xunpuV4AssessmentCriteria),
  reviewStatus: "pending_expert_review",
  criteria: xunpuV4AssessmentCriteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    weight: criterion.weight,
    minimumIndependentEvidenceCount: criterion.minimumIndependentEvidenceCount,
  })),
});

const eventSpecs = [
  ["topic", "event-template-topic-brief", "editorial_independence", 3],
  ["commercial", "event-template-commercial-response", "editorial_independence", 5],
  ["gatekeeper", "event-template-gatekeeper", "community_trust", 4],
  ["community", "event-template-community-source", "community_trust", 5],
  ["source-check", "event-template-source-check", "evidence_confidence", 5],
  ["compare", "event-template-compare-sources", "evidence_confidence", 6],
  ["official", "event-template-official-request", "evidence_confidence", 3],
  ["rights", "event-template-rights-inspection", "copyright_risk", -6],
  ["alert", "event-template-limited-alert", "public_safety_risk", -7],
  ["wait", "event-template-verification-wait", "evidence_confidence", 2],
  ["correction", "event-template-correction", "correction_debt", -6],
] as const;

async function richWorld(sessionId: string): Promise<SimulationSessionRecord> {
  const runtime = await createV3WorldTestRuntime(sessionId);
  const base = await runtime.engine.getRecord(sessionId);
  const release = buildXunpuFlagshipRuntimeReleaseV3R2();
  const studentActions = eventSpecs.map(([suffix], index) => (
    StudentWorkActionSchema.parse({
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: `work-action-${suffix}`,
      serverIssuedActionRef: `server-action-${suffix}`,
      sessionId,
      bindingId,
      actorId,
      primaryRoleId: "reporter",
      expectedWorldStateVersion: index,
      action: {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-editor" },
        utterance: "我说明行动目标、边界、证据与取舍，并请现场角色针对缺口作出真实回应。",
      },
      sourceWorldEventIds: [],
      reflectionNote: "保留本次判断依据和可能的反证，等待世界后果后再决定是否修订。",
      submissionStatus: "accepted",
      createdAt: fixedNow,
    })
  ));
  const queue = eventSpecs.map(([suffix, eventTemplateId], index) => {
    const template = release.eventTemplates.find(
      (candidate) => candidate.eventTemplateId === eventTemplateId,
    );
    if (!template) throw new Error(`missing fixture template ${eventTemplateId}`);
    return {
      eventId: `world-event-${suffix}`,
      sessionId,
      eventTemplateId,
      eventType: template.eventType,
      sourceKind: "student_action" as const,
      sourceRef: `work-action-${suffix}`,
      requestId: `request-${suffix}`,
      requestHash: `${index}`.padStart(64, "a").slice(-64),
      enqueuedAtStateVersion: index,
      sequence: index + 1,
      notBeforeVirtualMinute: 0,
      affectedObjectRefs: structuredClone(template.affectedObjectRefs),
      status: "committed" as const,
      resolutionId: `resolution-${suffix}`,
      occurredAt: fixedNow,
    };
  });
  const resolutions = eventSpecs.map(([suffix, _eventTemplateId, variableId, delta], index) => (
    SimulationResolutionSchema.parse({
      schemaVersion: SimulationResolutionSchemaVersion,
      resolutionId: `resolution-${suffix}`,
      sessionId,
      sourceWorldEventId: `world-event-${suffix}`,
      dispatchPlanId: `dispatch-${suffix}`,
      resolutionProposalId: `proposal-${suffix}`,
      expectedWorldStateVersion: index,
      status: "committed",
      acceptedIntents: [{
        intentId: `intent-${suffix}`,
        agentTaskId: `task-${suffix}`,
        agentRunId: `run-${suffix}`,
        outputHash: `${index + 1}`.padStart(64, "b").slice(-64),
      }],
      skippedIntents: [],
      variableDeltas: [{ variableId, before: 20, delta, after: 20 + delta }],
      emittedWorldEventIds: [`consequence-${suffix}`],
      emittedEvidenceIds: [`evidence-${suffix}`],
      teacherGate: null,
      failure: null,
      committedAt: fixedNow,
      resolvedAt: fixedNow,
    })
  ));
  const consequences = eventSpecs.map(([suffix], index) => ({
    eventId: `consequence-${suffix}`,
    sessionId,
    resolutionId: `resolution-${suffix}`,
    sourceWorldEventId: `world-event-${suffix}`,
    publicSummary: `第 ${index + 1} 项岗位行动已经形成不可逆世界后果。`,
    evidenceIds: [`evidence-${suffix}`],
    resultingStateVersion: index + 1,
    occurredAt: fixedNow,
  }));
  return {
    ...base,
    release,
    challengeAssignment: {
      ...base.challengeAssignment,
      simulationReleaseRef: release.simulationReleaseRef,
    },
    recordRevision: base.recordRevision + eventSpecs.length,
    currentSnapshot: {
      ...base.currentSnapshot,
      simulationReleaseRef: release.simulationReleaseRef,
      stateVersion: eventSpecs.length,
    },
    queue,
    studentActions,
    resolutions,
    consequences,
    requestReceipts: queue.map((event) => ({
      requestId: event.requestId,
      requestHash: event.requestHash,
      eventId: event.eventId,
    })),
    nextEventSequence: queue.length + 1,
    updatedAt: fixedNow,
  };
}

function evidenceRefsOfWorld(world: SimulationSessionRecord): Set<string> {
  return new Set(world.consequences.flatMap((consequence) => [
    consequence.eventId,
    ...consequence.evidenceIds,
  ]));
}

function fieldsForArtifact(artifactId: string, revisionNumber: number) {
  const artifact = xunpuFlagshipContentManifestV3.artifacts.find(
    (candidate) => candidate.artifactId === artifactId,
  );
  if (!artifact) throw new Error(`missing fixture artifact ${artifactId}`);
  return artifact.editableFields.map((field) => ({
    fieldId: field.fieldId,
    content: `第${revisionNumber}版：这是一项由真实行动后果和证据引用支持的岗位记录。`.repeat(
      Math.ceil((field.minimumLength + 20) / 24),
    ).slice(0, Math.max(field.minimumLength + 8, 32)),
  }));
}

async function submittedWork(
  sessionId: string,
  world: SimulationSessionRecord,
  forgedEvidenceRef?: string,
  identityLeak = false,
) {
  const service = new FlagshipStudentWorkServiceV3({
    store: new InMemoryFlagshipStudentWorkStoreV3(),
    manifest: xunpuFlagshipContentManifestV3,
    now: () => fixedNow,
  });
  const allowedEvidenceRefs = evidenceRefsOfWorld(world);
  const challengeLevel = world.challengeAssignment.challengeLevel as 3 | 4 | 5 | 6 | 7;
  if (forgedEvidenceRef) allowedEvidenceRefs.add(forgedEvidenceRef);
  await service.getWorkspace({
    sessionId,
    bindingId,
    principalId,
    actorId,
    challengeLevel,
    evidenceCatalog: [],
  });
  const plans = [
    ["artifact-topic-brief", ["consequence-topic", "evidence-topic"]],
    ["artifact-interview-plan-log", ["consequence-gatekeeper", "consequence-community"]],
    ["artifact-source-matrix", [
      "evidence-source-check", "evidence-compare", "evidence-official",
    ]],
    ["artifact-rights-ledger", ["consequence-rights", "evidence-rights"]],
    ["artifact-publication-correction-decision", [
      "consequence-alert", "consequence-wait", "consequence-correction",
    ]],
    ["artifact-transfer-reflection", ["consequence-correction", "evidence-correction"]],
    ["artifact-multiplatform-script", ["evidence-source-check", "consequence-source-check"]],
  ] as const;
  for (const [artifactId, defaultEvidenceRefs] of plans) {
    const revisionCount = artifactId === "artifact-transfer-reflection" ? 2 : 1;
    for (let revisionNumber = 1; revisionNumber <= revisionCount; revisionNumber += 1) {
      const evidenceRefs = forgedEvidenceRef && artifactId === "artifact-source-matrix"
        ? [forgedEvidenceRef, "evidence-source-check"]
        : [...defaultEvidenceRefs];
      const workspace = await service.saveRevision({
        sessionId,
        bindingId,
        principalId,
        actorId,
        challengeLevel,
        artifactId,
        expectedRevisionNumber: revisionNumber - 1,
        requestId: `save-${artifactId}-${revisionNumber}`,
        fields: fieldsForArtifact(artifactId, revisionNumber).map((field, index) => ({
          ...field,
          content: identityLeak && index === 0
            ? `${field.content} 姓名：测试学生 手机号：13812345678 student@example.com`
            : field.content,
        })),
        evidenceRefs,
        revisionNote: revisionNumber === 1
          ? "依据世界后果保存首版"
          : "根据公开更正后果保留首版并形成实质修订",
        allowedEvidenceRefs,
      });
      if (revisionNumber === revisionCount) {
        const artifact = workspace.artifacts.find(
          (candidate) => candidate.artifactId === artifactId,
        )!;
        await service.submitRevision({
          sessionId,
          bindingId,
          principalId,
          actorId,
          challengeLevel,
          artifactId,
          revisionId: artifact.latestRevision!.revisionId,
          contentHash: artifact.latestRevision!.contentHash,
          requestId: `submit-${artifactId}`,
        });
      }
    }
  }
  return service;
}

function submittedMedia(sessionId: string, world: SimulationSessionRecord) {
  const disclosure = {
    explicitLabel: true as const,
    implicitMetadata: true as const,
    disclosureText: "项目原创教学仿真媒体，并保留显式与隐式 AI 标识。",
  };
  const sourceHashes = { image: "1", audio: "2", video: "3" } as const;
  const sourceAssets = (["image", "audio", "video"] as const).map((mediaKind) => ({
    assetRef: `source-${mediaKind}`,
    mediaKind,
    contentHash: sourceHashes[mediaKind].repeat(64),
    rightsReceiptRef: `rights-${mediaKind}`,
    rightsStatus: "cleared" as const,
    permittedUse: "simulated_publication" as const,
    personConsentMode: "not_applicable" as const,
    aiDisclosure: disclosure,
  }));
  const transformations = [
    {
      operationId: "operation-image",
      operationKind: "crop" as const,
      inputAssetRef: "source-image",
      outputAssetRef: "derived-image",
      operatorKind: "student" as const,
      rationale: "裁切到公共环境，不保留可识别私人信息。",
      region: { x: 0, y: 0, width: 1, height: 1 },
    },
    ...(["audio", "video"] as const).map((mediaKind) => ({
      operationId: `operation-${mediaKind}`,
      operationKind: "trim" as const,
      inputAssetRef: `source-${mediaKind}`,
      outputAssetRef: `derived-${mediaKind}`,
      operatorKind: "student" as const,
      rationale: "保留与核验事实一致的必要片段。",
      startMs: 0,
      endMs: 1_000,
    })),
  ];
  const derivedAssets = (["image", "audio", "video"] as const).map((mediaKind) => ({
    assetRef: `derived-${mediaKind}`,
    parentAssetRefs: [`source-${mediaKind}`],
    mediaKind,
    mimeType: mediaKind === "image"
      ? "image/png" as const
      : mediaKind === "audio"
        ? "audio/wav" as const
        : "video/mp4" as const,
    contentHash: mediaKind === "image" ? "d".repeat(64)
      : mediaKind === "audio" ? "e".repeat(64) : "f".repeat(64),
    byteLength: 128,
    width: mediaKind === "audio" ? null : 640,
    height: mediaKind === "audio" ? null : 360,
    durationMs: mediaKind === "image" ? null : 1_000,
    aiDisclosure: disclosure,
    createdAt: fixedNow,
  }));
  const revision = MediaWorkRevisionV4Schema.parse({
    schemaVersion: MediaWorkRevisionV4SchemaVersion,
    mediaRevisionId: "media-revision-submitted-v4",
    sessionId,
    bindingId,
    flagshipContentRef: flagshipContentReferenceV4Of(world.release),
    artifactRef: "artifact-multiplatform-package",
    revisionNumber: 1,
    parentRevisionRef: null,
    status: "submitted",
    sourceAssets,
    transformations,
    derivedAssets,
    rightsLedgerRefs: sourceAssets.map((asset) => asset.rightsReceiptRef),
    supportingEvidenceRefs: ["evidence-source-check"],
    studentEditorialRationale: "三种媒体形态共享同一事实边界，并逐项保留权利和生成标识。",
    contentHash: "9".repeat(64),
    createdAt: fixedNow,
  });
  return {
    schemaVersion: "flagship-media-workspace/4.0.0" as const,
    sessionId,
    bindingId,
    processingMode: "actual_file_transform" as const,
    catalog: [],
    revisions: [revision],
  };
}

async function serviceFixture(input: {
  sessionId: string;
  rubric?: typeof rubric;
  withWork?: boolean;
  withMedia?: boolean;
  forgedEvidenceRef?: string;
  store?: InMemoryFlagshipAssessmentStoreV4 | JsonFileFlagshipAssessmentStoreV4;
  workQualityModel?: WorkQualityModelV4;
  identityLeak?: boolean;
  businessOperations?: BusinessOperationCoordinator;
  afterAssessmentFinalized?: (input: {
    sessionId: string;
    assessmentDecisionId: string;
  }) => Promise<string>;
}) {
  const world = await richWorld(input.sessionId);
  const work = input.withWork === false
    ? { loadRecord: async () => null }
    : await submittedWork(
        input.sessionId,
        world,
        input.forgedEvidenceRef,
        input.identityLeak ?? false,
      );
  const media = input.withMedia === false
    ? {
        schemaVersion: "flagship-media-workspace/4.0.0" as const,
        sessionId: input.sessionId,
        bindingId,
        processingMode: "actual_file_transform" as const,
        catalog: [],
        revisions: [],
      }
    : submittedMedia(input.sessionId, world);
  const preview = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const previewHash = createHash("sha256").update(preview).digest("hex");
  const multimodalQualityPreparer: FlagshipMultimodalQualityPreparerV4 = {
    prepare: vi.fn(async ({ revisions }: Parameters<
      FlagshipMultimodalQualityPreparerV4["prepare"]
    >[0]) => ({
      status: revisions.length === 0 ? "not_applicable" as const : "ready" as const,
      inputs: revisions.flatMap((revision) => revision.derivedAssets.map((asset) => ({
        inputRef: `quality-input-${asset.assetRef}`,
        artifactRef: revision.artifactRef,
        revisionRef: revision.mediaRevisionId,
        sourceAssetRef: asset.assetRef,
        sourceAssetContentHash: asset.contentHash,
        representationKind: asset.mediaKind === "audio"
          ? "audio_spectrogram" as const
          : asset.mediaKind === "video"
            ? "video_keyframe" as const
            : "image_preview" as const,
        representationContentHash: previewHash,
        mimeType: "image/png" as const,
        contentBase64: preview.toString("base64"),
        timestampMs: asset.mediaKind === "video" ? 500 : null,
        technicalContext: `测试用真实文件表示：${asset.mediaKind}`,
      }))),
      limitations: ["测试只验证受约束媒体输入链，不代表专业视觉效度。"],
    })),
  };
  const service = new FlagshipEvidenceAssessmentServiceV4({
    engine: { getRecord: async () => structuredClone(world) },
    orchestrator: { loadRecord: async () => null },
    work,
    media: {
      getWorkspace: async () => structuredClone(media),
      readDerivedAsset: async () => {
        throw new Error("测试准备器不读取真实文件");
      },
    },
    store: input.store ?? new InMemoryFlagshipAssessmentStoreV4(),
    rubric: input.rubric ?? rubric,
    flagshipContentHash: xunpuFlagshipContentV4.contentHash,
    studentWorkManifestContentHash: xunpuFlagshipContentManifestV3.contentHash,
    publicKnowledgeEvidenceRefs: xunpuFlagshipContentManifestV3.sourceKnowledgeRefs
      .map((source) => source.knowledgeId),
    ...(input.workQualityModel ? { workQualityModel: input.workQualityModel } : {}),
    ...(input.workQualityModel ? { multimodalQualityPreparer } : {}),
    ...(input.businessOperations ? {
      businessOperations: input.businessOperations,
      afterAssessmentFinalized: input.afterAssessmentFinalized,
    } : {}),
    now: () => fixedNow,
  });
  return { service, world };
}

describe("FlagshipEvidenceAssessmentServiceV4", () => {
  it('allows full teacher review of submitted work when the model is unavailable and records the actual revisions',async()=>{
    const sessionId='session-work-manual-review';
    const workRubric=EvidenceAssessmentRubricV4Schema.parse({...rubric,workBasis:{courseTitle:'社区采访',assignment:'完成有明确来源范围的社区报道。',learningObjectives:['区分个人经验与整体结论'],criteria:rubric.criteria.map(item=>({criterionId:item.criterionId,artifactRefs:['artifact-topic-brief'],expectations:['审读已提交选题中的判断和范围。']}))}});
    const {service}=await serviceFixture({sessionId,rubric:workRubric});
    const initial=(await service.getAssessment({sessionId}))!,decision=currentFlagshipAssessmentDecisionV4(initial);
    expect(decision.status).toBe('insufficient_evidence');expect(decision.evidenceRefs).toEqual([]);
    const reviewed=await service.reviewAssessment({sessionId,expectedAssessmentDecisionId:decision.assessmentDecisionId,requestId:'manual-work-review',reviewerId:'teacher-assessment-v4',status:'revised',rubricApplicabilityConfirmed:true,reason:'逐维阅读已经提交的作品，保留明确的教学判断与原稿来源。',criterionRevisions:rubric.criteria.map(item=>({criterionId:item.criterionId,band:'medium',score:70,rationale:'作品区分了具体来源与未知范围，后续仍需补充核查安排。'}))});
    const final=currentFlagshipAssessmentDecisionV4(reviewed);
    expect(final.status).toBe('final');expect(final.sessionScore).toBe(70);
    const actualRefs=initial.blindInput.artifactRevisions.filter(item=>item.artifactRef==='artifact-topic-brief').map(item=>item.revisionRef);
    expect(actualRefs.length).toBeGreaterThan(0);expect(final.evidenceRefs).toEqual(actualRefs.sort());
    expect(final.criterionAssessments.every(item=>item.evidenceRefs.every(ref=>final.evidenceRefs.includes(ref)))).toBe(true);
  });
  it('retries a failed model assessment explicitly and does not repeat the same retry request',async()=>{
    let attempts=0;
    const model:WorkQualityModelV4={assess:async observation=>{
      if(++attempts===1)throw new Error('temporary provider failure');
      return {output:{judgments:observation.deterministicJudgments.map(item=>({criterionId:item.criterionId,band:item.maximumBand,
        score:item.maximumBand==='high'?84:item.maximumBand==='medium'?72:42,confidence:.7,evidenceRefs:item.evidenceRefs,rationale:'依据作品的具体表达和已经核对的材料形成判断，保留后续核查的范围。'})),limitations:['仍需教师复核本次作品。']},providerId:'test',modelId:'quality-test',traceRef:'trace-retry-test',latencyMs:10,estimatedCostMicros:10};
    }};
    const sessionId='session-assessment-explicit-retry';const {service}=await serviceFixture({sessionId,workQualityModel:model});
    const first=await service.getAssessment({sessionId});expect(first!.qualityRuns[0]!.fallbackReason).toBe('model_error');
    await service.getAssessment({sessionId});expect(attempts).toBe(1);
    const retried=await service.getAssessment({sessionId,retryRequestId:'retry-once'});
    expect(retried!.qualityRuns.at(-1)!.mode).toBe('independent_live_agent');expect(attempts).toBe(2);
    expect((await service.getAssessment({sessionId,retryRequestId:'retry-once'}))!.recordRevision).toBe(retried!.recordRevision);expect(attempts).toBe(2);
  });
  it("reads only a current stored assessment and never creates one during course aggregation", async () => {
    const sessionId = "assessment-read-only-projection";
    const { service, world } = await serviceFixture({ sessionId });
    expect(await service.loadCurrentAssessment({ sessionId })).toBeNull();
    const original = await service.getAssessment({ sessionId });
    expect(original).not.toBeNull();
    expect(await service.loadCurrentAssessment({ sessionId })).toEqual(original);
    world.recordRevision += 1;
    expect(await service.loadCurrentAssessment({ sessionId })).toEqual(original);
    world.resolutions[0]!.variableDeltas[0]!.delta += 1;
    world.resolutions[0]!.variableDeltas[0]!.after += 1;
    expect(await service.loadCurrentAssessment({ sessionId })).toBeNull();
  });

  it("fails closed before real work exists instead of turning completion into a score", async () => {
    const { service } = await serviceFixture({
      sessionId: "session-assessment-v4-empty",
      withWork: false,
      withMedia: false,
    });
    expect(await service.getAssessment({
      sessionId: "session-assessment-v4-empty",
      fallbackLearner: { bindingId, actorId },
    })).toBeNull();
    expect(service.projectView(null, "student")).toMatchObject({
      status: "not_ready",
      decision: null,
      teacherReviewAllowed: false,
      rubric: { externalExpertValidityEstablished: false },
    });
  });

  it("accepts a submitted real-media package as a work artifact without inventing a score", async () => {
    const sessionId = "session-assessment-v4-media-only";
    const { service } = await serviceFixture({
      sessionId,
      withWork: false,
      withMedia: true,
    });
    const record = await service.getAssessment({
      sessionId,
      fallbackLearner: { bindingId, actorId },
    });
    expect(record).not.toBeNull();
    expect(record!.blindInput.artifactRevisions).toEqual([
      expect.objectContaining({
        artifactRef: "artifact-multiplatform-package",
        revisionRef: "media-revision-submitted-v4",
      }),
    ]);
    expect(record!.blindInput.claimEvidenceLinks).toEqual([
      expect.objectContaining({
        claimRef: "media-revision-submitted-v4",
        evidenceRefs: ["rights-audio", "rights-image", "rights-video"],
      }),
    ]);
    expect(record!.evidenceFacts.filter((fact) => (
      fact.evidenceCode === "rights_receipt_linked"
    )).map((fact) => fact.evidenceRef).sort()).toEqual([
      "rights-audio",
      "rights-image",
      "rights-video",
    ]);
    expect(record!.blindJudgments.find((criterion) => (
      criterion.criterionId === "criterion-rights-governance"
    ))).toMatchObject({
      evidenceStatus: "supported",
      score: 88,
    });
    expect(currentFlagshipAssessmentDecisionV4(record!).status)
      .toBe("insufficient_evidence");
    expect(currentFlagshipAssessmentDecisionV4(record!).sessionScore).toBeNull();
  });

  it("publishes six provisional dimensions only from linked behavior, consequences and real media", async () => {
    const sessionId = "session-assessment-v4-rich";
    const { service } = await serviceFixture({ sessionId });
    const record = await service.getAssessment({
      sessionId,
      fallbackLearner: { bindingId, actorId },
    });
    expect(record).not.toBeNull();
    const decision = currentFlagshipAssessmentDecisionV4(record!);
    expect(decision.status).toBe("provisional");
    expect(decision.sessionScore).toBeGreaterThan(0);
    expect(decision.sessionScore).toBeLessThanOrEqual(
      record!.scoreCeiling,
    );
    expect(decision.criterionAssessments).toHaveLength(6);
    expect(decision.criterionAssessments.every((criterion) => (
      criterion.score !== null && criterion.surfaceSignalsUsed === false
    ))).toBe(true);
    expect(decision.adviceAgentExcluded).toBe(true);
    expect(record!.evidenceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceRef: "consequence-commercial",
        evidenceCode: "commercial_exchange_disclosed_or_rejected",
        sourceKind: "world_consequence",
      }),
    ]));
    expect(record!.blindInput.excludedContextFields).toEqual([
      "student_identity",
      "binding_id",
      "challenge_level",
      "agent_advice",
      "provider_and_model",
      "prompt_and_trace",
    ]);
    const studentView = service.projectView(record, "student");
    const serialized = JSON.stringify(studentView);
    expect(serialized).not.toContain(actorId);
    expect(serialized).not.toContain(bindingId);
    expect(serialized).not.toContain("evidenceFacts");
    expect(serialized).not.toContain('"surfaceSignals":');
  });

  it("uses deidentified submitted work for a bounded quality draft and keeps run details admin-only", async () => {
    const assess = vi.fn(async (observation: Parameters<WorkQualityModelV4["assess"]>[0]) => ({
      output: {
        judgments: observation.deterministicJudgments.map((judgment, index) => ({
          criterionId: judgment.criterionId,
          band: judgment.maximumBand,
          score: judgment.maximumBand === "high"
            ? 81 + index
            : judgment.maximumBand === "medium"
              ? 61 + index
              : 31 + index,
          confidence: Math.min(0.8, judgment.confidenceCeiling),
          evidenceRefs: judgment.evidenceRefs,
          rationale: "作品内容与该维真实岗位证据相互印证，但仍等待教师终裁。",
        })),
        limitations: ["这是去身份作品质量草稿，不是最终成绩。"],
      },
      providerId: "deepseek",
      modelId: "quality-model-service-test",
      traceRef: "trace-quality-service-test",
      latencyMs: 15,
      estimatedCostMicros: 500,
    }));
    const workQualityModel: WorkQualityModelV4 = { assess };
    const sessionId = "session-assessment-v4-live-quality";
    const { service } = await serviceFixture({
      sessionId,
      workQualityModel,
      identityLeak: true,
    });
    const record = await service.getAssessment({ sessionId });
    expect(currentFlagshipAssessmentDecisionV4(record!)).toMatchObject({
      status: "provisional",
      assessorMode: "independent_live_agent",
    });
    expect(record?.qualityRuns[0]).toMatchObject({
      mode: "independent_live_agent",
      providerId: "deepseek",
      traceRef: "trace-quality-service-test",
    });
    const observation = assess.mock.calls[0]![0];
    expect(observation.workArtifacts.length).toBeGreaterThan(0);
    expect(observation.mediaArtifacts).toEqual([
      expect.objectContaining({ artifactRef: "artifact-multiplatform-package" }),
    ]);
    expect(observation.mediaInputs).toHaveLength(3);
    const serializedObservation = JSON.stringify(observation);
    for (const forbidden of [
      bindingId,
      actorId,
      principalId,
      sessionId,
      "13812345678",
      "student@example.com",
      "测试学生",
      "scoreCeiling",
      '"surfaceSignals":',
    ]) {
      expect(serializedObservation).not.toContain(forbidden);
    }
    expect(serializedObservation).toContain("[身份字段已脱敏]");
    expect(serializedObservation).toContain("[邮箱已脱敏]");
    const studentView = JSON.stringify(service.projectView(record, "student"));
    expect(studentView).not.toContain("qualityRuns");
    expect(studentView).not.toContain("trace-quality-service-test");
    expect(service.projectAdminCase(record!).qualityRuns[0]).toMatchObject({
      modelId: "quality-model-service-test",
      estimatedCostMicros: 500,
      mediaObservation: {
        preparationStatus: "ready",
        preparedInputCount: 3,
        providerInvocationIncludedMedia: true,
      },
    });
  });

  it("does not let a submitted name, unrelated reference or absent media manufacture competency", async () => {
    const forged = await serviceFixture({
      sessionId: "session-assessment-v4-forged",
      forgedEvidenceRef: "evidence-browser-forged",
    });
    await expect(forged.service.getAssessment({
      sessionId: "session-assessment-v4-forged",
    })).rejects.toMatchObject({
      code: "source_drift",
    });

    const noMedia = await serviceFixture({
      sessionId: "session-assessment-v4-no-media",
      withMedia: false,
    });
    const record = await noMedia.service.getAssessment({
      sessionId: "session-assessment-v4-no-media",
    });
    expect(currentFlagshipAssessmentDecisionV4(record!).status)
      .toBe("insufficient_evidence");
    expect(currentFlagshipAssessmentDecisionV4(record!).sessionScore).toBeNull();
    expect(currentFlagshipAssessmentDecisionV4(record!).criterionAssessments.every(
      (criterion) => criterion.score === null && criterion.evidenceRefs.length === 0,
    )).toBe(true);
  });

  it("requires an explicit classroom applicability decision and keeps external validity unclaimed", async () => {
    const sessionId = "session-assessment-v4-review";
    const store = new InMemoryFlagshipAssessmentStoreV4();
    const businessOperations = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      () => fixedNow,
    );
    let learnerProjectionRefreshes = 0;
    const { service } = await serviceFixture({
      sessionId,
      store,
      businessOperations,
      afterAssessmentFinalized: async ({ assessmentDecisionId }) => {
        learnerProjectionRefreshes += 1;
        return `learner-projection-${assessmentDecisionId}`;
      },
    });
    const initial = (await service.getAssessment({ sessionId }))!;
    const decision = currentFlagshipAssessmentDecisionV4(initial);
    const reviewed = await service.reviewAssessment({
      sessionId,
      expectedAssessmentDecisionId: decision.assessmentDecisionId,
      requestId: "review-assessment-v4-confirm",
      reviewerId: "teacher-assessment-v4",
      status: "confirmed",
      rubricApplicabilityConfirmed: true,
      reason: "已按同一组盲化证据逐维复核，确认本班量规适用且不主张外部专家效度。",
      criterionRevisions: [],
    });
    const finalDecision = currentFlagshipAssessmentDecisionV4(reviewed);
    expect(finalDecision).toMatchObject({
      status: "final",
      rubricReviewStatus: "verified",
      teacherReview: { status: "confirmed" },
    });
    expect(reviewed.rubric.reviewStatus).toBe("pending_expert_review");
    expect(service.projectView(reviewed, "teacher").rubric).toEqual({
      version: rubric.rubricVersion,
      reviewStatus: "verified",
      classroomApplicabilityConfirmed: true,
      externalExpertValidityEstablished: false,
    });
    const replay = await service.reviewAssessment({
      sessionId,
      expectedAssessmentDecisionId: decision.assessmentDecisionId,
      requestId: "review-assessment-v4-confirm",
      reviewerId: "teacher-assessment-v4",
      status: "confirmed",
      rubricApplicabilityConfirmed: true,
      reason: "已按同一组盲化证据逐维复核，确认本班量规适用且不主张外部专家效度。",
      criterionRevisions: [],
    });
    expect(replay.recordRevision).toBe(reviewed.recordRevision);
    expect(learnerProjectionRefreshes).toBe(1);
    expect(await businessOperations.list()).toEqual([
      expect.objectContaining({
        operationKind: "finalize_assessment",
        phase: "completed",
        authorityCommitRef: finalDecision.assessmentDecisionId,
      }),
    ]);
    await expect(service.reviewAssessment({
      sessionId,
      expectedAssessmentDecisionId: finalDecision.assessmentDecisionId,
      requestId: "review-assessment-v4-confirm",
      reviewerId: "teacher-assessment-v4",
      status: "confirmed",
      rubricApplicabilityConfirmed: true,
      reason: "使用同一请求 ID 伪造不同内容，必须被拒绝。",
      criterionRevisions: [],
    })).rejects.toMatchObject({ code: "request_replay_conflict" });
  });

  it("survives JSON restart and rejects score-band manipulation", async () => {
    const sessionId = "session-assessment-v4-restart";
    const directory = await mkdtemp(resolve(tmpdir(), "ronggang-assessment-v4-"));
    temporaryDirectories.push(directory);
    const first = await serviceFixture({
      sessionId,
      store: new JsonFileFlagshipAssessmentStoreV4(directory),
    });
    const created = (await first.service.getAssessment({ sessionId }))!;
    const restarted = await serviceFixture({
      sessionId,
      store: new JsonFileFlagshipAssessmentStoreV4(directory),
    });
    const loaded = (await restarted.service.getAssessment({ sessionId }))!;
    expect(currentFlagshipAssessmentDecisionV4(loaded).assessmentDecisionId)
      .toBe(currentFlagshipAssessmentDecisionV4(created).assessmentDecisionId);
    const current = currentFlagshipAssessmentDecisionV4(loaded);
    await expect(restarted.service.reviewAssessment({
      sessionId,
      expectedAssessmentDecisionId: current.assessmentDecisionId,
      requestId: "review-assessment-v4-invalid-band",
      reviewerId: "teacher-assessment-v4",
      status: "revised",
      rubricApplicabilityConfirmed: true,
      reason: "试图把低档位写成高分，必须由服务端拒绝。",
      criterionRevisions: [{
        criterionId: "criterion-fact-verification",
        band: "low",
        score: 99,
        rationale: "档位与分数互相矛盾，不能形成可信教师终裁。",
      }],
    })).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import type { FieldInterviewActionV1 } from "@ronggang/contracts";
import { buildXunpuFlagshipRuntimeReleaseV3R2, hashCanonical, xunpuExplorationLesson, xunpuFlagshipContentManifestV3, xunpuFlagshipContentV4, xunpuFlagshipCourseProjection, xunpuV4AssessmentCriteria } from "@ronggang/course-content";
import { InMemorySimulationSessionStore, WorldSimulationEngineV3 } from "@ronggang/world-core";
import { EvidenceAssessmentRubricV4Schema } from "@ronggang/agent-orchestrator";
import { collectFlagshipWorldOutcomeSource } from "../src/flagship-course-outcome-projection.js";
import { FlagshipEvidenceAssessmentServiceV4, InMemoryFlagshipAssessmentStoreV4 } from "../src/flagship-assessment-v4.js";
import { FlagshipStudentWorkServiceV3, InMemoryFlagshipStudentWorkStoreV3 } from "../src/flagship-student-work-v3.js";
import { BusinessOperationCoordinator, InMemoryBusinessOperationReceiptStore } from "../src/business-operation-receipt.js";
import { resolveFieldEvidence } from "../src/field-evidence.js";
import { buildFlagshipTraceProjection } from "../src/trace-projection.js";
import { paginateSessionTrace } from "../src/trace-pagination.js";

const actor = { sessionId: "field-evidence-session", bindingId: "field-evidence-binding", actorId: "field-evidence-student", principalId: "field-evidence-principal", challengeLevel: 5 as const };
const now = () => "2026-09-11T00:00:00.000Z";

async function fixture() {
  const release = buildXunpuFlagshipRuntimeReleaseV3R2();
  const engine = new WorldSimulationEngineV3({ store: new InMemorySimulationSessionStore(), fieldLessons: [xunpuExplorationLesson], now });
  await engine.startSession({ sessionId: actor.sessionId, release, challengeAssignment: {
    schemaVersion: "challenge-assignment/3.0.0", challengeAssignmentId: "field-evidence-assignment", learnerTwinRef: "field-evidence-twin", sessionId: actor.sessionId,
    simulationReleaseRef: release.simulationReleaseRef, worldVariantRef: release.challengeVariants.find(variant => variant.challengeLevel === 5)!.worldVariantId,
    previousChallengeLevel: 4, challengeLevel: 5, scoreCeiling: 90, pressureDimensions: [{ dimensionId: "time", intensity: 5 }],
    assignmentReason: "evidence_progression", basisEvidenceRefs: ["previous-session-evidence"], forecastRef: "field-evidence-forecast", teacherOverride: null,
    policyVersion: "test/1.0.0", policyContentHash: "b".repeat(64), assignedAt: now(),
  }, targetCompetencyRefs: ["competency-source-verification"], scaffoldingLevel: 1 });
  let sequence = 0;
  const act = async (action: FieldInterviewActionV1) => engine.commitFieldInterview({ actorId: actor.actorId, lessonHash: xunpuExplorationLesson.contentHash,
    request: { schemaVersion: "field-interview-action/1.0.0", sessionId: actor.sessionId, bindingId: actor.bindingId, requestId: `field-evidence-${++sequence}`,
      expectedWorldStateVersion: (await engine.getRecord(actor.sessionId)).currentSnapshot.stateVersion, action } });
  const receipts = new InMemoryBusinessOperationReceiptStore();
  const coordinator = new BusinessOperationCoordinator(receipts, now);
  let interruptDelivery = false;
  const work: FlagshipStudentWorkServiceV3 = new FlagshipStudentWorkServiceV3({ store: new InMemoryFlagshipStudentWorkStoreV3(), manifest: xunpuFlagshipContentManifestV3, now,
    businessOperations: coordinator, afterSubmissionCommitted: async () => {
      if (interruptDelivery) throw new Error("injected projection outage");
      return (await assessment.getAssessment({ sessionId: actor.sessionId }))!.blindInput.blindCaseId;
    } });
  const assessment: FlagshipEvidenceAssessmentServiceV4 = new FlagshipEvidenceAssessmentServiceV4({ engine, work, orchestrator: { loadRecord: async () => null },
    media: { getWorkspace: async () => ({ schemaVersion: "flagship-media-workspace/4.0.0", sessionId: actor.sessionId, bindingId: actor.bindingId, processingMode: "actual_file_transform", catalog: [], revisions: [] }) },
    store: new InMemoryFlagshipAssessmentStoreV4(), rubric: EvidenceAssessmentRubricV4Schema.parse({ rubricVersion: "field-evidence-rubric", rubricContentHash: hashCanonical(xunpuV4AssessmentCriteria), reviewStatus: "pending_expert_review",
      criteria: xunpuV4AssessmentCriteria.map(criterion => ({ criterionId: criterion.criterionId, weight: criterion.weight, minimumIndependentEvidenceCount: criterion.minimumIndependentEvidenceCount })) }),
    flagshipContentHash: xunpuFlagshipContentV4.contentHash, studentWorkManifestContentHash: xunpuFlagshipContentManifestV3.contentHash,
    publicKnowledgeEvidenceRefs: xunpuFlagshipContentManifestV3.sourceKnowledgeRefs.map(source => source.knowledgeId), now });
  const save = async (refs: string[]) => {
    const artifact = xunpuFlagshipContentManifestV3.artifacts.find(item => item.artifactId === "artifact-topic-brief")!;
    await work.saveRevision({ ...actor, artifactId: artifact.artifactId, expectedRevisionNumber: 0, requestId: "field-work-save", revisionNote: "依据现场核对的材料形成选题，未证实内容保留为待核实。", evidenceRefs: refs, allowedEvidenceRefs: new Set(refs),
      fields: artifact.editableFields.map(field => ({ fieldId: field.fieldId, content: "区分公开资料、商户意见和待核实说法，说明面向游客的公共服务价值。".repeat(12).slice(0, field.minimumLength + 30) })) });
    const revision = (await work.loadRecord(actor.sessionId))!.revisions.at(-1)!;
    return { ...actor, artifactId: artifact.artifactId, revisionId: revision.revisionId, contentHash: revision.contentHash, requestId: "field-work-submit" };
  };
  return { engine, act, assessment, work, receipts, save, outage: (value: boolean) => { interruptDelivery = value; } };
}

describe("field evidence across work, course and assessment", () => {
  it("preserves source nature and rejects a changed owner, lesson or uncommitted reference", async () => {
    const { act, engine } = await fixture();
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    const world = await engine.getRecord(actor.sessionId);
    const sources = resolveFieldEvidence(world, actor);
    expect(sources.find(source => source.option.evidenceRef === "material-conflicting-claim")!.option.detail).toContain("待核实");
    expect(sources.every(source => /^[a-f0-9]{64}$/.test(source.sourceContentHash))).toBe(true);
    expect(() => resolveFieldEvidence(world, { ...actor, bindingId: "other-binding" })).toThrow("归属");
    const drift = structuredClone(world);
    drift.fieldInterview!.lessonRef.contentHash = "0".repeat(64);
    expect(() => resolveFieldEvidence(drift, actor)).toThrow("冻结课程");
    const missingEvent = structuredClone(world);
    missingEvent.fieldInterview!.events = [];
    expect(() => resolveFieldEvidence(missingEvent, actor)).toThrow("已提交事件");
    const trace = buildFlagshipTraceProjection(world, null);
    expect(trace.stateVersion).toBe(world.currentSnapshot.stateVersion);
    expect(trace.records.find(item => item.lane === "world")!.eventId).toBe(world.fieldInterview!.events[0]!.id);
    const firstPage = paginateSessionTrace(trace, { limit: 1 });
    const secondPage = paginateSessionTrace(trace, { cursor: firstPage.nextCursor!, limit: 1 });
    expect(firstPage.records[0]!.traceId).not.toBe(secondPage.records[0]!.traceId);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.hasMore).toBe(false);
  });
  it("projects actual questions from the authoritative record and excludes greetings and other students", async () => {
    const { act, engine } = await fixture();
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "陈老师您好" });
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    const record = await engine.getRecord(actor.sessionId);
    expect(record.studentActions).toHaveLength(0);
    const source = collectFlagshipWorldOutcomeSource(record, actor.actorId, xunpuFlagshipCourseProjection);
    expect(source.interviews).toHaveLength(1);
    expect(source.interviews[0]).toMatchObject({ actionId: record.fieldInterview!.turns[1]!.id, publicOutcome: record.fieldInterview!.turns[1]!.npcText });
    expect(collectFlagshipWorldOutcomeSource(record, "another-student", xunpuFlagshipCourseProjection).interviews).toEqual([]);
  });

  it("restores the same committed work receipt with acquired field references without fabricating a sufficient score", async () => {
    const { act, assessment, work, receipts, save, outage, engine } = await fixture();
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    const field = (await engine.getRecord(actor.sessionId)).fieldInterview!;
    const submission = await save([field.turns[0]!.id, ...field.materialIds]);
    outage(true);
    await expect(work.submitRevision(submission)).rejects.toMatchObject({ code: "recovery_required" });
    expect((await receipts.list())[0]).toMatchObject({ phase: "recovery_required" });
    await expect(work.recoverSubmissionProjection({ ...(await receipts.list())[0]!, requestHash: "0".repeat(64) })).rejects.toMatchObject({ code: "invalid_revision" });
    outage(false);
    await work.recoverSubmissionProjection((await receipts.list())[0]!);
    await work.submitRevision(submission);
    expect((await receipts.list())[0]).toMatchObject({ phase: "completed" });
    expect((await work.loadRecord(actor.sessionId))!.revisions).toHaveLength(1);
    const result = await assessment.getAssessment({ sessionId: actor.sessionId });
    expect(result).not.toBeNull();
    expect(result!.blindInput.behaviorEvidenceRefs).toContain(field.turns[0]!.id);
    expect(result!.blindInput.worldConsequenceRefs).toContain(field.events[0]!.id);
    expect(result!.rawWeightedScore).toBeNull();
    expect(result!.blindInput.claimEvidenceLinks[0]!.supportStatus).toBe("unresolved");
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "陈老师您好" });
    expect((await assessment.loadCurrentAssessment({ sessionId: actor.sessionId }))?.sourceHash).toBe(result!.sourceHash);
  });

  it("rejects a published but not acquired material instead of broadening the evidence allowlist", async () => {
    const { act, assessment, save, work } = await fixture();
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    await expect(work.submitRevision(await save(["material-expert-mail", "material-local-standard"]))).rejects.toMatchObject({ code: "recovery_required" });
    await expect(assessment.getAssessment({ sessionId: actor.sessionId })).rejects.toMatchObject({ code: "source_drift" });
  });
});

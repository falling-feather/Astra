import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { xunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import {
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
  JsonFileFlagshipStudentWorkStoreV3,
  type FlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import {
  BusinessOperationCoordinator,
  InMemoryBusinessOperationReceiptStore,
} from "../src/business-operation-receipt.js";

const actor = {
  sessionId: "session-workspace-v3",
  bindingId: "binding-student-workspace",
  principalId: "principal-student-workspace",
  actorId: "student-workspace",
  challengeLevel: 5 as const,
};
const evidenceCatalog = [
  {
    evidenceRef: "knowledge-source-one",
    kind: "knowledge" as const,
    label: "来源一",
    detail: "公开来源定位一",
    eventType: null,
  },
  {
    evidenceRef: "world-evidence-two",
    kind: "world_evidence" as const,
    label: "现场证据二",
    detail: "已结算的现场证据",
    eventType: "student_asks_community_source",
  },
];
const allowedEvidenceRefs = new Set(evidenceCatalog.map((item) => item.evidenceRef));
let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

function service(store: FlagshipStudentWorkStoreV3 = new InMemoryFlagshipStudentWorkStoreV3()) {
  return new FlagshipStudentWorkServiceV3({
    store,
    manifest: xunpuFlagshipContentManifestV3,
    now: () => "2026-08-26T08:00:00.000Z",
  });
}

function completeFields(artifactId: string, suffix: string) {
  const definition = xunpuFlagshipContentManifestV3.artifacts.find(
    (artifact) => artifact.artifactId === artifactId,
  )!;
  return definition.editableFields.map((field) => ({
    fieldId: field.fieldId,
    content: `${suffix}${"真实岗位内容".repeat(Math.ceil(field.minimumLength / 6) + 2)}`
      .slice(0, Math.max(field.minimumLength, 1)),
  }));
}

describe("FlagshipStudentWorkServiceV3", () => {
  it("projects an empty role-safe review without assigning the work to staff", async () => {
    const target = service();
    const review = await target.getReviewWorkspace({
      sessionId: actor.sessionId,
      challengeLevel: actor.challengeLevel,
    });
    expect(review.artifacts).toHaveLength(9);
    expect(review.artifacts.every((artifact) => artifact.status === "empty")).toBe(true);
    expect(review.completion).toEqual({
      requiredArtifactCount: 9,
      submittedRequiredCount: 0,
      readyForPublication: false,
    });
    expect(await target.loadRecord(actor.sessionId)).toBeNull();
    expect(JSON.stringify(review)).not.toContain("ownerPrincipalId");
  });

  it("creates nine real artifact shells and rejects forged evidence or stale revisions", async () => {
    const target = service();
    const workspace = await target.getWorkspace({ ...actor, evidenceCatalog });
    expect(workspace.artifacts).toHaveLength(9);
    expect(workspace.completion).toMatchObject({
      requiredArtifactCount: 9,
      submittedRequiredCount: 0,
      readyForPublication: false,
    });

    const definition = xunpuFlagshipContentManifestV3.artifacts[0]!;
    const fields = definition.editableFields.map((field, index) => ({
      fieldId: field.fieldId,
      content: index === 0 ? "这是学生真实写下的第一段草稿。" : "",
    }));
    await expect(target.saveRevision({
      ...actor,
      artifactId: definition.artifactId,
      expectedRevisionNumber: 0,
      requestId: "request-forged-evidence",
      fields,
      evidenceRefs: ["private-trace-evidence"],
      revisionNote: "尝试伪造证据",
      allowedEvidenceRefs,
    })).rejects.toMatchObject({ code: "invalid_revision" });

    await target.saveRevision({
      ...actor,
      artifactId: definition.artifactId,
      expectedRevisionNumber: 0,
      requestId: "request-first-real-revision",
      fields,
      evidenceRefs: ["knowledge-source-one"],
      revisionNote: "保存学生第一版",
      allowedEvidenceRefs,
    });
    await expect(target.saveRevision({
      ...actor,
      artifactId: definition.artifactId,
      expectedRevisionNumber: 0,
      requestId: "request-stale-revision",
      fields,
      evidenceRefs: ["knowledge-source-one"],
      revisionNote: "过期页面再次保存",
      allowedEvidenceRefs,
    })).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("is idempotent, locks a complete revision, and rejects drifted world references", async () => {
    const businessOperations = new BusinessOperationCoordinator(
      new InMemoryBusinessOperationReceiptStore(),
      () => "2026-08-26T08:00:01.000Z",
    );
    let assessmentProjectionRefreshes = 0;
    const target = new FlagshipStudentWorkServiceV3({
      store: new InMemoryFlagshipStudentWorkStoreV3(),
      manifest: xunpuFlagshipContentManifestV3,
      businessOperations,
      afterSubmissionCommitted: async ({ revisionId }) => {
        assessmentProjectionRefreshes += 1;
        return `assessment-projection-${revisionId}`;
      },
      now: () => "2026-08-26T08:00:00.000Z",
    });
    const artifactId = "artifact-feature-story";
    const firstFields = completeFields(artifactId, "第一版：");
    const secondFields = completeFields(artifactId, "第二版：");
    const firstInput = {
      ...actor,
      artifactId,
      expectedRevisionNumber: 0,
      requestId: "request-feature-r1",
      fields: firstFields,
      evidenceRefs: [...allowedEvidenceRefs],
      revisionNote: "形成完整初稿",
      allowedEvidenceRefs,
    };
    await target.saveRevision(firstInput);
    await target.saveRevision(firstInput);
    expect((await target.loadRecord(actor.sessionId))?.revisions).toHaveLength(1);
    await expect(target.saveRevision({
      ...firstInput,
      fields: secondFields,
    })).rejects.toMatchObject({ code: "request_replay_conflict" });

    await target.saveRevision({
      ...actor,
      artifactId,
      expectedRevisionNumber: 1,
      requestId: "request-feature-r2",
      fields: secondFields,
      evidenceRefs: [...allowedEvidenceRefs],
      revisionNote: "根据采访边界完成第二版",
      allowedEvidenceRefs,
    });
    const draft = await target.getWorkspace({ ...actor, evidenceCatalog });
    const feature = draft.artifacts.find((artifact) => artifact.artifactId === artifactId)!;
    expect(feature.mechanicalCompletion.mechanicalReady).toBe(true);
    const submitInput = {
      ...actor,
      artifactId,
      revisionId: feature.latestRevision!.revisionId,
      contentHash: feature.latestRevision!.contentHash,
      requestId: "request-submit-feature",
    };
    await target.submitRevision(submitInput);
    await target.submitRevision(submitInput);
    expect(assessmentProjectionRefreshes).toBe(1);
    expect(await businessOperations.list()).toEqual([
      expect.objectContaining({
        operationKind: "submit_work_revision",
        phase: "completed",
        authorityCommitRef: feature.latestRevision!.revisionId,
      }),
    ]);
    await target.assertWorldActionReference({
      ...actor,
      eventTemplateId: "event-template-draft-story",
      action: {
        verb: "draft",
        artifactId,
        revisionId: feature.latestRevision!.revisionId,
        parentRevisionId: feature.latestRevision!.parentRevisionId,
        contentHash: feature.latestRevision!.contentHash,
      },
    });
    await expect(target.assertWorldActionReference({
      ...actor,
      eventTemplateId: "event-template-publication",
      action: {
        verb: "submit",
        artifactId,
        revisionId: feature.latestRevision!.revisionId,
        contentHash: "f".repeat(64),
        evidenceRefs: feature.latestRevision!.evidenceRefs,
      },
    })).rejects.toMatchObject({ code: "reference_drift" });
  });

  it("restores the exact immutable revision chain from the atomic JSON store", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "flagship-work-v3-"));
    const first = service(new JsonFileFlagshipStudentWorkStoreV3(temporaryDirectory));
    const artifactId = "artifact-source-matrix";
    await first.saveRevision({
      ...actor,
      sessionId: "session-workspace-restart",
      artifactId,
      expectedRevisionNumber: 0,
      requestId: "request-persisted-r1",
      fields: completeFields(artifactId, "来源矩阵："),
      evidenceRefs: [...allowedEvidenceRefs],
      revisionNote: "写入磁盘的第一版",
      allowedEvidenceRefs,
    });
    const before = await first.loadRecord("session-workspace-restart");
    const restored = service(new JsonFileFlagshipStudentWorkStoreV3(temporaryDirectory));
    const after = await restored.loadRecord("session-workspace-restart");
    expect(after).toEqual(before);
    expect(after?.revisions[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

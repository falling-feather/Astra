import { describe, expect, it } from "vitest";
import { CourseReleaseSchema, courseReleaseReferenceOf } from "@ronggang/contracts";
import { xunpuContractCourseRelease, xunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import { xunpuFlagshipCourseProjection } from "@ronggang/course-content";
import { projectFlagshipCourseOutcome, type FlagshipWorldOutcomeSource } from "../src/flagship-course-outcome-projection.js";
import { FlagshipStudentWorkServiceV3, InMemoryFlagshipStudentWorkStoreV3 } from "../src/flagship-student-work-v3.js";

const actor = { sessionId: "course-projection-session", bindingId: "course-projection-binding", principalId: "course-projection-student", actorId: "student-reporter", challengeLevel: 4 as const };
const release = CourseReleaseSchema.parse(xunpuContractCourseRelease);
const now = "2026-09-07T04:00:00.000Z";
const evidenceRefs = release.sources.slice(0, 2).map((source) => `public-source:${source.sourceId}`);
const world: FlagshipWorldOutcomeSource = { sessionId: actor.sessionId, courseReleaseRef: courseReleaseReferenceOf(release), stateVersion: 0, ended: false, paused: false, occurredAt: now, interviews: [] };

async function setup() {
  const service = new FlagshipStudentWorkServiceV3({ store: new InMemoryFlagshipStudentWorkStoreV3(), manifest: xunpuFlagshipContentManifestV3, now: () => now });
  const project = async (options: Partial<Parameters<typeof projectFlagshipCourseOutcome>[0]> = {}) => projectFlagshipCourseOutcome({ ...actor, release, definition: xunpuFlagshipCourseProjection, manifest: xunpuFlagshipContentManifestV3, world, work: await service.loadRecord(actor.sessionId), review: null, ...options });
  const save = async (artifactId: string, revisionNumber = 0) => {
    const definition = xunpuFlagshipContentManifestV3.artifacts.find((item) => item.artifactId === artifactId)!;
    await service.saveRevision({ ...actor, artifactId, expectedRevisionNumber: revisionNumber, requestId: `save-${artifactId}-${revisionNumber}`, fields: definition.editableFields.map((field) => ({ fieldId: field.fieldId, content: `${revisionNumber}关于社区文化的真实采访记录与公开边界。`.repeat(30).slice(0, field.minimumLength + 2) })), evidenceRefs, allowedEvidenceRefs: new Set(evidenceRefs), revisionNote: "保存一份有来源依据的练习版本。" });
    return (await service.loadRecord(actor.sessionId))!.revisions.at(-1)!;
  };
  return { service, project, save };
}

describe("flagship authoritative course projection", () => {
  it("keeps empty training empty and distinguishes saved drafts from submitted chapter work", async () => {
    const { service, project, save } = await setup();
    expect((await project()).portfolioItems).toEqual([]);
    const revision = await save("artifact-topic-brief");
    const draft = await project();
    expect(draft.portfolioItems).toHaveLength(1);
    expect(draft.portfolioItems[0]).toMatchObject({ revisionId: revision.revisionId, contentHash: revision.contentHash, status: "draft" });
    expect(draft.completedChapterIds).toEqual([]);
    await service.submitRevision({ ...actor, artifactId: revision.artifactId, revisionId: revision.revisionId, contentHash: revision.contentHash, requestId: "submit-topic" });
    const submitted = await project();
    expect(submitted.completedChapterIds).toEqual(["xunpu-topic-brief"]);
    expect(submitted.portfolioItems[0]?.status).toBe("submitted");
    expect(submitted.evidence.every((item) => item.artifactRevisionRefs.includes(revision.revisionId))).toBe(true);
    const second = await save("artifact-topic-brief", 1);
    const revised = await project();
    expect(revised.completedChapterIds).toEqual([]);
    expect(revised.portfolioItems[0]).toMatchObject({ revisionId: second.revisionId, status: "draft" });
    expect((await service.loadRecord(actor.sessionId))?.revisions).toHaveLength(2);
  });

  it("rejects cross-student work and mismatched immutable course references", async () => {
    const { project, save } = await setup();
    await save("artifact-topic-brief");
    await expect(project({ principalId: "another-student" })).rejects.toThrow("其他学生");
    await expect(project({ world: { ...world, courseReleaseRef: { ...world.courseReleaseRef, contentHash: "0".repeat(64) } } })).rejects.toThrow("发布引用");
  });

  it("keeps actual field actions distinct from student-authored text and does not complete unsubmitted work", async () => {
    const { project } = await setup();
    const result = await project({ world: { ...world, interviews: [{ actionId: "field-interview-action", eventId: "field-interview-event", utterance: "您如何看待社区生活与游客拍摄的关系？", publicOutcome: "受访者说明了可以公开的话题范围。", occurredAt: now }] } });
    expect(result.portfolioItems[0]).toMatchObject({ origin: "server_process_record", chapterId: "xunpu-field-reporting" });
    expect(result.completedChapterIds).toEqual([]);
    expect(result.evidence[0]?.basis).toContain("可以公开的话题范围");
  });
});

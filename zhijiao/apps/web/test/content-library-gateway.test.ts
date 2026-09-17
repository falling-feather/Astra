import { describe, expect, it, vi } from "vitest";
import type { DemoAuthContext } from "../src/v2/models";
import {
  bytesToBase64,
  createHttpContentLibraryGateway,
} from "../src/v2/content-library-gateway";
import { courseReleaseSummaryFixture } from "./v2-student.fixture";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authFixture(): DemoAuthContext {
  return {
    profileId: "teacher-class-a",
    principal: {
      principalId: "principal-teacher-a",
      kind: "human",
      displayName: "蟳埔 A 班教师",
      status: "active",
      createdAt: "2026-08-09T01:00:00.000Z",
    },
    bindings: [],
    csrfToken: "csrf-teacher-a",
    expiresAt: "2099-08-09T01:00:00.000Z",
  };
}

describe("BE-007 content library gateway", () => {
  it("keeps staff status, preview, upload, index, recovery, and search on the real routes", async () => {
    const course = courseReleaseSummaryFixture();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      { courses: [course] },
      { sources: [{
        sourceId: "material-source-1",
        courseId: course.courseId,
        kind: "course_material",
        title: "课堂采访记录",
        publisher: "教师上传",
        canonicalUrl: null,
        rightsNote: "本课程教学使用",
        createdAt: "2026-09-07T01:00:00.000Z",
        updatedAt: "2026-09-07T01:00:00.000Z",
      }] },
      { jobs: [{
        jobId: "job-1",
        assetId: "asset-1",
        sourceRevisionId: "revision-raw-1",
        parsedRevisionId: "revision-parsed-1",
        kind: "parse_text",
        status: "succeeded",
        attemptCount: 1,
        errorCode: null,
        createdAt: "2026-09-07T01:00:00.000Z",
        updatedAt: "2026-09-07T01:00:01.000Z",
      }] },
      { revision: {
        revisionId: "revision-parsed-1",
        sourceId: "material-source-1",
        sourceVersion: "raw-1",
        sourceByteHash: "a".repeat(64),
        mimeType: "text/plain",
        byteSize: 12,
        objectKey: "content/material-source-1/raw-1",
        publicationDate: null,
        accessedAt: "2026-09-07T01:00:00.000Z",
        status: "current",
        fragments: [{
          fragmentId: "fragment-1",
          revisionId: "revision-parsed-1",
          ordinal: 0,
          text: "统计数据需要标明时间口径。",
          locator: { page: 1 },
          contentHash: "b".repeat(64),
          createdAt: "2026-09-07T01:00:00.000Z",
        }],
        createdAt: "2026-09-07T01:00:00.000Z",
        fragmentCount: 1,
      } },
      { material: {
        sourceId: "material-source-2",
        status: "completed",
        assetId: "asset-2",
        sourceByteHash: "c".repeat(64),
        rawRevisionId: "revision-raw-2",
        parsedRevisionId: "revision-parsed-2",
        indexing: { status: "ready", indexed: 1 },
        job: { jobId: "job-2", status: "succeeded", attemptCount: 1, errorCode: null },
        capabilityGaps: [{ code: "partial_text", message: "部分内容尚需人工核对" }],
      } },
      { indexing: { indexed: 1 } },
      { recovery: { resumed: 1, failed: 0 } },
      { result: {
        query: "统计口径",
        retrieverVersion: "hybrid/1",
        corpusVersion: "course/1",
        citations: [{
          citationId: "citation-1",
          sourceId: "material-source-1",
          sourceRevisionId: "revision-parsed-1",
          fragmentId: "fragment-1",
          title: "课堂采访记录",
          publisher: "教师上传",
          canonicalUrl: null,
          sourceVersion: "raw-1",
          sourceByteHash: "a".repeat(64),
          locator: { page: 1 },
          text: "统计数据需要标明时间口径。",
          knowledgeRevisionIds: [],
          claimIds: [],
          reviewStatus: "pending_expert_review",
          score: 0.91,
        }],
        gaps: [],
        conflicts: [],
      } },
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return response(responses.shift());
    });
    const gateway = createHttpContentLibraryGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });

    await expect(gateway.getCourses()).resolves.toEqual([course]);
    await expect(gateway.listSources(course.courseId)).resolves.toHaveLength(1);
    await expect(gateway.listJobs()).resolves.toHaveLength(1);
    await expect(gateway.getRevision("revision-parsed-1")).resolves.toMatchObject({ fragmentCount: 1 });
    await expect(gateway.uploadMaterial({
      courseId: course.courseId,
      sourceKey: "source-key-1",
      title: "课堂采访记录",
      kind: "course_material",
      fileName: "interview.txt",
      mimeType: "text/plain",
      contentBase64: "aGVsbG8=",
      rightsNote: "教师上传，仅限本课程教学使用",
      allowModelContext: false,
    })).resolves.toMatchObject({ indexing: { status: "ready", indexed: 1 }, capabilityGaps: [{ code: "partial_text", message: "部分内容尚需人工核对" }] });
    await expect(gateway.indexCourse(course.courseId, "revision-parsed-2")).resolves.toEqual({ indexed: 1 });
    await expect(gateway.resumeJobs(true)).resolves.toEqual({ resumed: 1, failed: 0 });
    await expect(gateway.search(course.courseId, "统计口径", 12)).resolves.toMatchObject({ citations: [{ fragmentId: "fragment-1" }] });

    expect(calls.map((call) => call.url)).toEqual([
      "http://api.local/api/courses",
      `http://api.local/api/content-library/sources?courseId=${encodeURIComponent(course.courseId)}`,
      "http://api.local/api/content-library/jobs",
      "http://api.local/api/content-library/revisions/revision-parsed-1",
      "http://api.local/api/content-library/materials",
      "http://api.local/api/content-library/index",
      "http://api.local/api/content-library/jobs/resume",
      "http://api.local/api/content-library/search",
    ]);
    expect(new Headers(calls[4]?.init?.headers).get("X-CSRF-Token")).toBe("csrf-teacher-a");
    expect(JSON.parse(String(calls[7]?.init?.body))).toEqual({
      courseId: course.courseId,
      query: "统计口径",
      limit: 12,
    });
  });

  it("encodes binary content without truncating bytes", () => {
    expect(bytesToBase64(new Uint8Array([0, 255, 16, 32]))).toBe("AP8QIA==");
  });

  it("reads optional case dossier and professional task packages without coupling them to search", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ result: {
        releaseId: "case-release-1",
        contentHash: "a".repeat(64),
        reviewStatus: "pending_expert_review",
        dossier: {
          dossierId: "dossier-1",
          caseBoundary: "全部为教学仿真",
          studentMaterials: [{
            materialId: "material-1",
            title: "首发版本",
            publicDescription: "可检查的学生材料",
            sourceRefs: [{ title: "来源标题", url: "https://example.com/source", locator: "第 3 页", publisher: "来源机构", sourceVersion: "2026" }],
            inspectableFields: ["版本号"],
            simulationBoundary: "教学仿真材料",
          }],
          scenarios: [{
            scenarioId: "scenario-1",
            title: "发布后回应",
            studentMaterialIds: ["material-1"],
            sourceClaimComparisons: [{ claim: "主张", supportedWording: "可支持表述", unsupportedExpansion: "不可扩张" }],
            conflicts: [{ title: "速度与语境", description: "存在取舍", competingValues: ["速度", "语境"] }],
            legalAlternativeRoutes: [{ label: "保留并更正", steps: ["核查", "更正"], tradeoff: "延迟发布" }],
            workRequirements: ["提交版本差异"],
            teacherObservationPoints: ["观察证据链"],
          }],
          teacherOnlyNotes: [{ scenarioId: "scenario-1", teacherOnlyNotes: ["不要提前给结论"] }],
        },
      } }))
      .mockResolvedValueOnce(response({ package: {
        packageId: "professional-media-reporter-training",
        title: "记者专业训练包",
        reviewBoundary: "待专业教师复核",
        tasks: [{
          taskId: "task-1",
          title: "建立来源地图",
          workflowPhase: "source",
          knowledgeIds: ["knowledge-1"],
          courseSectionRefs: ["xunpu-source-map"],
          artifacts: ["artifact-source-matrix"],
          rubricDimensions: ["criterion-fact-verification"],
          trainingRules: [{ ruleType: "course_training_design", statement: "保留待核状态" }],
        }],
      } }));
    const gateway = createHttpContentLibraryGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    const dossier = await gateway.getCaseDossier("course-xunpu-intangible-media");
    const taskPackage = await gateway.getProfessionalTasks("course-xunpu-intangible-media");
    expect(dossier?.dossier.studentMaterials[0]?.sourceRefs[0]?.locator).toBe("第 3 页");
    expect(dossier?.dossier.teacherOnlyNotes?.[0]?.teacherOnlyNotes).toEqual(["不要提前给结论"]);
    expect(taskPackage?.tasks[0]?.courseSectionRefs).toEqual(["xunpu-source-map"]);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "http://api.local/api/content-library/case-dossier?courseId=course-xunpu-intangible-media",
      "http://api.local/api/content-library/professional-tasks?courseId=course-xunpu-intangible-media",
    ]);
  });
});

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { TextEmbeddingProvider } from "@ronggang/context-engine";
import { createApp } from "../src/server.js";

const apps: FastifyInstance[] = [];
const directories: string[] = [];
const origin = "http://localhost:5173";
const courseId = "course-xunpu-intangible-media";
const modelVersion = "integration-test-vector/1.0.0";
const embeddings: TextEmbeddingProvider = {
  embedDocuments: async (texts) => ({ modelVersion, dimension: 2, vectors: texts.map(() => [1, 0]) }),
  embedQuery: async () => ({ modelVersion, dimension: 2, vector: [1, 0] }),
};

async function login(app: FastifyInstance, profileId: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/demo-session", headers: { origin }, payload: { profileId } });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = response.headers["set-cookie"];
  return { origin, cookie: (Array.isArray(cookie) ? cookie[0]! : cookie!).split(";")[0]!, "x-csrf-token": response.json().csrfToken as string };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}ganglian-content-http-`)) throw new Error("unexpected fixture directory");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("content library persistent HTTP integration", () => {
  it("persists actual material bytes/fragments/vectors, enforces identity, and restores the same result after restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ganglian-content-http-"));
    directories.push(dataDir);
    const app = await createApp({ dataDir, contentEmbeddings: embeddings });
    apps.push(app);
    const teacher = await login(app, "teacher-class-a");
    const student = await login(app, "student-unassigned");
    const unclaimedSearch = await app.inject({ method: "POST", url: "/api/content-library/search", headers: student, payload: { courseId, query: "名录" } });
    expect(unclaimedSearch.statusCode).toBe(403);
    for (const endpoint of ["case-dossier", "professional-tasks"]) {
      const unclaimed = await app.inject({ method: "GET", url: `/api/content-library/${endpoint}?courseId=${courseId}`, headers: student });
      expect(unclaimed.statusCode).toBe(403);
    }
    const detail = await app.inject({ method: "GET", url: `/api/courses/${courseId}`, headers: student });
    const claim = await app.inject({ method: "POST", url: "/api/course-enrollments", headers: student, payload: { courseReleaseId: detail.json().course.courseReleaseId } });
    expect(claim.statusCode, claim.body).toBe(200);
    const otherCourse = await app.inject({ method: "POST", url: "/api/content-library/search", headers: student, payload: { courseId: "course-village-super-multiplatform", query: "名录" } });
    expect(otherCourse.statusCode).toBe(403);
    const sources = await app.inject({ method: "GET", url: `/api/content-library/sources?courseId=${courseId}`, headers: teacher });
    expect(sources.statusCode, sources.body).toBe(200);
    expect(sources.json().sources.length).toBeGreaterThan(0);
    const denied = await app.inject({ method: "GET", url: `/api/content-library/sources?courseId=${courseId}`, headers: student });
    expect(denied.statusCode).toBe(403);
    const text = "采访须区分受访者亲历与转述；公开前核对姓名、时间、地点、授权范围。";
    const bytes = Buffer.from(text, "utf8");
    const payload = { courseId, sourceKey: "consent-notes", title: "采访资料教学测试", kind: "course_material", fileName: "consent-notes.txt", mimeType: "text/plain", contentBase64: bytes.toString("base64"), rightsNote: "项目原创测试资料，仅教学验证。", allowModelContext: true };
    const uploadDenied = await app.inject({ method: "POST", url: "/api/content-library/materials", headers: student, payload });
    expect(uploadDenied.statusCode).toBe(403);
    const forged = await app.inject({ method: "POST", url: "/api/content-library/materials", headers: teacher, payload: { ...payload, localFilePath: "C:/private.txt", grantedBy: "someone-else" } });
    expect(forged.statusCode).toBe(400);
    const uploaded = await app.inject({ method: "POST", url: "/api/content-library/materials", headers: teacher, payload });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const material = uploaded.json().material;
    expect(material).toMatchObject({ status: "completed", sourceByteHash: createHash("sha256").update(bytes).digest("hex"), indexing: { status: "ready", indexed: 1 } });
    const crossCourse = await app.inject({ method: "POST", url: "/api/content-library/index", headers: teacher,
      payload: { courseId: "course-village-super-multiplatform", revisionId: material.parsedRevisionId } });
    expect(crossCourse.statusCode, crossCourse.body).toBe(403);
    const missingRevision = await app.inject({ method: "POST", url: "/api/content-library/index", headers: teacher,
      payload: { courseId, revisionId: "source-revision-does-not-exist" } });
    expect(missingRevision.statusCode, missingRevision.body).toBe(400);
    expect(missingRevision.body).toContain("资料版本不存在");
    const validIndex = await app.inject({ method: "POST", url: "/api/content-library/index", headers: teacher,
      payload: { courseId, revisionId: material.parsedRevisionId } });
    expect(validIndex.statusCode, validIndex.body).toBe(200);
    const jobs = await app.inject({ method: "GET", url: "/api/content-library/jobs", headers: teacher });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().jobs).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: material.sourceId, sourceFileName: payload.fileName, sourceRevisionId: material.rawRevisionId })]));
    const blankText = await app.inject({ method: "POST", url: "/api/content-library/materials", headers: teacher,
      payload: { ...payload, sourceKey: "empty-teaching-notes", title: "空白资料测试", contentBase64: Buffer.from("   ").toString("base64") } });
    expect(blankText.statusCode, blankText.body).toBe(200);
    expect(blankText.json().material.status).toBe("failed");
    expect(blankText.json().material.capabilityGaps).toEqual(expect.arrayContaining([expect.objectContaining({ code: expect.any(String), message: expect.any(String) })]));
    const replay = await app.inject({ method: "POST", url: "/api/content-library/materials", headers: teacher, payload });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().material).toMatchObject({ status: "already_completed", assetId: material.assetId, parsedRevisionId: material.parsedRevisionId, job: { attemptCount: 1 } });
    const revision = await app.inject({ method: "GET", url: `/api/content-library/revisions/${material.parsedRevisionId}`, headers: teacher });
    expect(revision.statusCode, revision.body).toBe(200);
    expect(revision.json().revision).toMatchObject({ sourceByteHash: material.sourceByteHash, metadata: { representation: "parsed-source" }, fragments: [expect.objectContaining({ text })] });
    const query = { courseId, query: "采访授权范围", limit: 8 };
    const searched = await app.inject({ method: "POST", url: "/api/content-library/search", headers: student, payload: query });
    expect(searched.statusCode, searched.body).toBe(200);
    expect(searched.json().result.citations).toEqual(expect.arrayContaining([expect.objectContaining({ sourceRevisionId: material.parsedRevisionId, sourceByteHash: material.sourceByteHash, text })]));
    const forgedScope = await app.inject({ method: "POST", url: "/api/content-library/search", headers: student, payload: { ...query, subjectRef: "other-student", purpose: "audit" } });
    expect(forgedScope.statusCode).toBe(400);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = await createApp({ dataDir, contentEmbeddings: embeddings });
    apps.push(restarted);
    const restoredStudent = await login(restarted, "student-unassigned");
    const restored = await restarted.inject({ method: "POST", url: "/api/content-library/search", headers: restoredStudent, payload: query });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().result.citations).toEqual(searched.json().result.citations);
  }, 90_000);
});

import { describe, expect, it } from "vitest";
import { buildXunpuGroundedCollaborationRuntimeContentV4 } from "@ronggang/agent-orchestrator";
import { hashCanonical, xunpuCourseRelease, xunpuFlagshipContentV4 } from "@ronggang/course-content";
import type { TextEmbeddingProvider } from "@ronggang/context-engine";
import { ContentLibraryRuntime } from "../src/content-library-runtime.js";
import { SqlGroundedEvidencePorts } from "../src/content-grounded-retrieval.js";
import { InMemoryContentAddressedObjectStore } from "../src/local-object-store.js";

const content = buildXunpuGroundedCollaborationRuntimeContentV4({ content: xunpuFlagshipContentV4,
  baseKnowledge: xunpuCourseRelease.knowledgeRecords, addedKnowledge: xunpuFlagshipContentV4.addedKnowledgeRecords });
const courseId = "course-xunpu-intangible-media";
const courseReleaseRef = { courseId, releaseId: "test-registered-course-release", version: 1, contentHash: hashCanonical("test-course") };
const modelVersion = "sql-authorization-test-vector/1.0.0";
const embeddings: TextEmbeddingProvider = {
  embedDocuments: async (texts) => ({ modelVersion, dimension: 2, vectors: texts.map(() => [1, 0]) }),
  embedQuery: async () => ({ modelVersion, dimension: 2, vector: [1, 0] }),
};

describe("SQL grounding authorization and retrieval", () => {
  it("does not count two catalog aliases of one original URL as independent support", async () => {
    const runtime = new ContentLibraryRuntime({ objectStore: new InMemoryContentAddressedObjectStore(), assertCourse: () => {}, embeddings });
    try {
      const store = await runtime.store();
      const claim = content.claims.find((item) => item.claimRef === "claim-source-verification")!;
      for (const [index, knowledgeId] of claim.knowledgeRefs.entries()) {
        const sourceId = `test-alias-${index}`;
        await store.upsertSourceDocument({ sourceId, courseId, kind: "course_material", title: "同一文件的目录别名测试", canonicalUrl: `https://example.test/one-original#section-${index}` });
        const { revision } = await store.ingestSourceRevision({ sourceId, sourceVersion: "alias-test/1", sourceByteHash: null, mimeType: "text/plain", byteSize: 0,
          fragments: [{ ordinal: 0, text: "新闻资料应核实原始来源并保留更正记录。", locator: { label: "测试片段" } }] });
        await store.grantUsage({ sourceRevisionId: revision.revisionId, courseId, purpose: "model_context", scope: "course", grantedBy: "test-teacher" });
        await store.upsertKnowledgeRecord({ knowledgeId, courseId, title: "目录别名测试", teachingSummary: "新闻资料应核实原始来源并保留更正记录。",
          sourceRevisionId: revision.revisionId, metadata: { groundedClaimRelations: [{ claimRef: claim.claimRef, relation: "supports" }] } });
      }
      const ports = new SqlGroundedEvidencePorts({ runtime, content, loadCourseReference: async () => courseReleaseRef });
      const scope = { sessionId: "session-alias-test", courseReleaseRef, studentBindingHash: hashCanonical("alias-binding"), allowedObjectRefs: [content.knownObjectRefs[0]!],
        allowedClaimRefs: [claim.claimRef], allowedKnowledgeRefs: claim.knowledgeRefs, asOf: new Date().toISOString() };
      const authorization = await ports.authorize(scope);
      expect(authorization.allowedFragments).toHaveLength(2);
      expect(new Set(authorization.allowedFragments.map((fragment) => fragment.sourceDocumentRef)).size).toBe(1);
      const result = await ports.retrieve({ authorization, query: { queryId: "query-alias-test", episodeTemplateRef: content.episodes[0]!.episodeTemplateRef, moveKind: "proposal", queryText: "新闻资料应核实原始来源并保留更正记录。",
        claimRefs: scope.allowedClaimRefs, objectRefs: scope.allowedObjectRefs, evidenceKinds: claim.runtimeEvidenceKinds, evidenceRefs: [], evidenceSnapshotHash: hashCanonical([]), asOf: scope.asOf, maxResults: 8 } });
      expect(result.unresolvedClaimRefs).toContain(claim.claimRef);
    } finally { await runtime.close(); }
  }, 30_000);

  it("uses exact persisted fragments, refreshes revised knowledge and rejects revoked or foreign sources", async () => {
    const runtime = new ContentLibraryRuntime({ objectStore: new InMemoryContentAddressedObjectStore(), assertCourse: () => {}, embeddings });
    try {
      const store = await runtime.store();
      const ports = new SqlGroundedEvidencePorts({ runtime, content, loadCourseReference: async () => courseReleaseRef });
      const claim = content.claims[0]!;
      const input = { sessionId: "session-sql-grounding", courseReleaseRef, studentBindingHash: hashCanonical("binding"),
        allowedObjectRefs: [content.knownObjectRefs[0]!], allowedClaimRefs: [claim.claimRef], allowedKnowledgeRefs: [claim.knowledgeRefs[0]!], asOf: new Date().toISOString() };
      const original = await ports.authorize(input);
      expect(original.status).toBe("authorized");
      expect(original.allowedFragments.length).toBeGreaterThan(0);
      expect(original.allowedFragments[0]).toMatchObject({ sourceKind: "app_document", reviewStatus: "pending_expert_review" });
      expect(original.allowedFragments[0]?.locator).toContain("原件未入库");
      const query = { queryId: "query-sql-current", episodeTemplateRef: content.episodes[0]!.episodeTemplateRef, moveKind: "proposal" as const,
        queryText: original.allowedFragments[0]!.snippet, claimRefs: input.allowedClaimRefs, objectRefs: input.allowedObjectRefs,
        evidenceKinds: claim.runtimeEvidenceKinds, evidenceRefs: ["evidence-world-action"], evidenceSnapshotHash: hashCanonical("world-evidence"),
        asOf: new Date().toISOString(), maxResults: 8 };
      const retrieved = await ports.retrieve({ authorization: original, query });
      expect(retrieved.status).toBe("ok");
      expect(retrieved.unresolvedClaimRefs).toContain(claim.claimRef);
      expect(retrieved.citations[0]).toMatchObject({ fragmentRef: original.allowedFragments[0]!.fragmentRef, fragmentHash: original.allowedFragments[0]!.fragmentHash });
      await expect(ports.authorize({ ...input, courseReleaseRef: { ...courseReleaseRef, courseId: "foreign-course" } })).rejects.toThrow("课程版本不匹配");

      const sourceId = "source-curated-replacement";
      const updatedText = "补充名录核验记录：蟳埔女习俗于2008年列入第二批国家级非物质文化遗产名录，不能写成2007年已入选。";
      await store.upsertSourceDocument({ sourceId, courseId, kind: "course_material", title: "补充授权记录", rightsNote: "原创测试资料" });
      const { revision } = await store.ingestSourceRevision({ sourceId, sourceVersion: "test/2", sourceByteHash: hashCanonical(updatedText),
        mimeType: "text/plain", byteSize: Buffer.byteLength(updatedText), fragments: [{ ordinal: 0, text: updatedText, locator: { label: "测试原件第1段" } }] });
      const grant = await store.grantUsage({ sourceRevisionId: revision.revisionId, courseId, purpose: "model_context", scope: "course", grantedBy: "test-teacher" });
      await store.upsertKnowledgeRecord({ knowledgeId: input.allowedKnowledgeRefs[0]!, courseId, title: "授权知识修订", teachingSummary: updatedText,
        sourceRevisionId: revision.revisionId, sourceRefs: revision.fragments.map((fragment) => fragment.fragmentId), reviewStatus: "pending_expert_review" });
      expect((await ports.authorize({ ...input, asOf: new Date().toISOString() })).status).toBe("empty");
      await store.upsertKnowledgeRecord({ knowledgeId: input.allowedKnowledgeRefs[0]!, courseId, title: "授权知识修订", teachingSummary: updatedText,
        sourceRevisionId: revision.revisionId, sourceRefs: revision.fragments.map((fragment) => fragment.fragmentId), reviewStatus: "pending_expert_review",
        metadata: { groundedClaimRelations: [{ claimRef: claim.claimRef, relation: "supports" }] } });
      const updated = await ports.authorize({ ...input, asOf: new Date().toISOString() });
      expect(updated.authorizationHash).not.toBe(original.authorizationHash);
      expect(updated.allowedFragments).toHaveLength(1);
      expect(updated.allowedFragments[0]).toMatchObject({ sourceRevision: revision.revisionId, snippet: updatedText, sourceKind: "upload", sourceUrl: null });
      await expect(ports.retrieve({ authorization: original, query })).rejects.toThrow("授权已发生变化");
      const nextResult = await ports.retrieve({ authorization: updated, query: { ...query, queryText: updatedText, asOf: new Date().toISOString() } });
      expect(nextResult.citations).toHaveLength(1);
      expect(nextResult.citations[0]?.sourceRevision).toBe(revision.revisionId);
      await store.updateUsageGrantStatus({ grantId: grant.grantId, status: "revoked" });
      const revoked = await ports.authorize({ ...input, asOf: new Date().toISOString() });
      expect(revoked).toMatchObject({ status: "forbidden", allowedFragments: [], revokedClaimRefs: [claim.claimRef] });
      await expect(ports.retrieve({ authorization: updated, query })).rejects.toThrow("授权已发生变化");
    } finally { await runtime.close(); }
  }, 30_000);
});

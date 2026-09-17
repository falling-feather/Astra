import { describe, expect, it } from "vitest";
import { ContentLibraryRuntime } from "../src/content-library-runtime.js";
import { InMemoryContentAddressedObjectStore } from "../src/local-object-store.js";
import { applyFlagshipKnowledgeCurations, buildFlagshipKnowledgeCurations } from "../src/flagship-knowledge-curation.js";

describe("bundled independent source curation", () => {
  it("appends four traced knowledge revisions without changing original content or reviving revoked permission", async () => {
    const runtime = new ContentLibraryRuntime({ objectStore: new InMemoryContentAddressedObjectStore(), assertCourse: () => {} });
    try {
      const store = await runtime.store();
      const updates = buildFlagshipKnowledgeCurations();
      expect(updates).toHaveLength(4);
      for (const update of updates) {
        const first = await store.getKnowledge(update.record.knowledgeId, 1);
        const current = await store.getKnowledge(update.record.knowledgeId);
        expect(first?.contentHash).toBe(update.originalHash);
        expect(current?.contentHash).toBe(update.record.contentHash);
        expect(current?.revisionNumber).toBe(2);
        expect(current?.reviewStatus).toBe("pending_expert_review");
        expect((await store.getSourceRevision(current!.sourceRevisionId!))?.sourceByteHash).toBeNull();
      }
      const subject = updates[0]!;
      const current = (await store.getKnowledge(subject.record.knowledgeId))!;
      const grant = (await store.listUsageGrants({ sourceRevisionId: current.sourceRevisionId!, purpose: "model_context" }))[0]!;
      await store.updateUsageGrantStatus({ grantId: grant.grantId, status: "revoked" });
      await applyFlagshipKnowledgeCurations(store);
      expect((await store.getKnowledge(current.knowledgeId))?.revisionNumber).toBe(2);
      expect((await store.listUsageGrants({ sourceRevisionId: current.sourceRevisionId!, purpose: "model_context" }))[0]?.status).toBe("revoked");
      const teacher = await store.upsertKnowledgeRecord({ knowledgeId: current.knowledgeId, courseId: current.courseId,
        title: current.title, teachingSummary: "教师已补充本课程的核查说明，待重新确认引用关系。", sourceRevisionId: current.sourceRevisionId ?? null,
        reviewStatus: "pending_expert_review", metadata: { authoredBy: "teacher" } });
      await applyFlagshipKnowledgeCurations(store);
      expect((await store.getKnowledge(current.knowledgeId))?.contentHash).toBe(teacher.contentHash);
    } finally { await runtime.close(); }
  }, 30_000);
});

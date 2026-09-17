import {
  GroundedEvidenceAuthorizationV4Schema,
  type CourseReleaseReference,
  type GroundedEvidenceAuthorizationFragmentV4,
} from "@ronggang/contracts";
import {
  InMemoryGroundedRetrievalPortV4,
  buildXunpuGroundedCollaborationRuntimeContentV4,
  type GroundedEvidenceAuthorizationInputV4,
  type GroundedEvidenceAuthorizationResolverV4,
  type GroundedRetrievalPortInputV4,
  type GroundedRetrievalPortV4,
} from "@ronggang/agent-orchestrator";
import { hashCanonical } from "@ronggang/course-content";
import type { KnowledgeRevisionRecord, SourceFragmentRecord, SourceLocator, UsageGrantRecord } from "@ronggang/content-store";
import type { ContentLibraryRuntime } from "./content-library-runtime.js";
import { buildContentLibrarySeed } from "./content-library.js";
import { z } from "zod";

export const GroundedKnowledgeClaimRelationsSchema = z.array(z.object({
  claimRef: z.string().min(1).max(240), relation: z.enum(["supports", "refutes", "context"]),
}).strict()).max(16);
function claimRelations(knowledge: KnowledgeRevisionRecord) {
  return GroundedKnowledgeClaimRelationsSchema.parse(knowledge.metadata?.groundedClaimRelations ?? []);
}

type RuntimeContent = ReturnType<typeof buildXunpuGroundedCollaborationRuntimeContentV4>;
const sharedIndexer = { principalId: "course-content-runtime", role: "operator" as const };

function locatorText(locator: SourceLocator): string {
  return [locator.page ? `第 ${locator.page} 页` : null,
    locator.startMs !== undefined ? `${locator.startMs}—${locator.endMs ?? locator.startMs} 毫秒` : null,
    locator.startChar !== undefined ? `字符 ${locator.startChar}—${locator.endChar ?? locator.startChar}` : null,
    locator.label].filter(Boolean).join("；").slice(0, 500) || "已登记片段";
}

/** SQL decides access; the retrieval candidate cannot grant access to its own citations. */
export class SqlGroundedEvidencePorts implements GroundedEvidenceAuthorizationResolverV4, GroundedRetrievalPortV4 {
  readonly #indexed = new Set<string>();
  readonly #indexing = new Map<string, Promise<unknown>>();
  readonly #bundledHashes = new Map(buildContentLibrarySeed().map((seed) => [seed.knowledgeId, seed.contentHash]));
  constructor(private readonly options: {
    runtime: ContentLibraryRuntime;
    content: RuntimeContent;
    loadCourseReference(sessionId: string): Promise<CourseReleaseReference>;
    now?: () => string;
  }) {}

  async authorize(input: Readonly<GroundedEvidenceAuthorizationInputV4>) {
    const actual = await this.options.loadCourseReference(input.sessionId);
    if (hashCanonical(actual) !== hashCanonical(input.courseReleaseRef)) throw new Error("协作授权课程版本不匹配");
    const store = await this.options.runtime.store();
    const allowed = new Set(input.allowedKnowledgeRefs);
    const knowledge = (await Promise.all([...allowed].map((id) => store.getKnowledge(id))))
      .filter((item): item is KnowledgeRevisionRecord => item !== null && item.courseId === actual.courseId && item.reviewStatus !== "retired");
    const revisions = new Map((await Promise.all([...new Set(knowledge.flatMap((item) => item?.sourceRevisionId ? [item.sourceRevisionId] : []))]
      .map(async (id) => [id, await store.getSourceRevision(id)] as const))));
    const documents = new Map((await store.listSourceDocuments({ courseId: actual.courseId, limit: 200 })).map((document) => [document.sourceId, document]));
    const candidates = new Map<string, { knowledge: KnowledgeRevisionRecord; claims: RuntimeContent["claims"]; fragment: SourceFragmentRecord }>();
    const expired = new Set<string>();
    const revoked = new Set<string>();
    const applicableGrants = new Map<string, UsageGrantRecord[]>();
    for (const item of knowledge) {
      if (!item?.sourceRevisionId) continue;
      const revision = revisions.get(item.sourceRevisionId);
      if (!revision) continue;
      if (input.allowedSourceRevisionRefs?.length && !input.allowedSourceRevisionRefs.includes(revision.revisionId)) continue;
      const bundled = item.contentHash === this.#bundledHashes.get(item.knowledgeId);
      const relations = claimRelations(item);
      const claims = this.options.content.claims.filter((claim) => input.allowedClaimRefs.includes(claim.claimRef)
        && claim.knowledgeRefs.includes(item.knowledgeId) && (bundled || relations.some((relation) => relation.claimRef === claim.claimRef)));
      if (claims.length === 0) continue;
      const grants = (await store.listUsageGrants({ sourceRevisionId: revision.revisionId, purpose: "model_context" }))
        .filter((grant) => grant.courseId === actual.courseId && grant.subjectRef == null && (grant.scope === "course" || grant.scope === "public"));
      applicableGrants.set(revision.revisionId, grants);
      const current = grants.filter((grant) => grant.status === "active" && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(input.asOf)));
      if (!current.length) {
        for (const claim of claims) {
          if (grants.some((grant) => grant.status === "revoked")) revoked.add(claim.claimRef);
          if (grants.some((grant) => grant.status === "expired" || (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(input.asOf)))) expired.add(claim.claimRef);
        }
        continue;
      }
      const explicitRefs = new Set(item.sourceRefs ?? []);
      const ownFragments = revision.fragments.filter((fragment) => explicitRefs.has(fragment.fragmentId));
      for (const fragment of explicitRefs.size ? ownFragments : revision.fragments) candidates.set(fragment.fragmentId, { knowledge: item, claims, fragment });
    }
    const readable = await store.search({ query: "", courseId: actual.courseId, purpose: "model_context", subjectRef: null, allowedFragmentIds: new Set(candidates.keys()), limit: 200 });
    const fragments: GroundedEvidenceAuthorizationFragmentV4[] = [];
    for (const citation of readable.citations) {
      const candidate = candidates.get(citation.fragmentId);
      if (!candidate || !citation.knowledgeRevisionIds.includes(candidate.knowledge.knowledgeRevisionId)) continue;
      const revision = revisions.get(citation.sourceRevisionId);
      if (!revision) continue;
      const document = documents.get(revision.sourceId);
      const grants = applicableGrants.get(revision.revisionId)!.filter((grant) => grant.status === "active" && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(input.asOf)));
      const summaryOnly = revision.sourceByteHash === null;
      const canonicalUrl = document?.canonicalUrl ? new URL(document.canonicalUrl) : null;
      if (canonicalUrl) canonicalUrl.hash = "";
      const originalIdentity = canonicalUrl ? `url:${canonicalUrl.toString()}`
        : revision.sourceByteHash ? `bytes:${revision.sourceByteHash}` : `source:${revision.sourceId}`;
      fragments.push({
        knowledgeRef: candidate.knowledge.knowledgeId, sourceDocumentRef: `sql-source-${hashCanonical(originalIdentity).slice(0, 32)}`,
        sourceRevision: revision.revisionId, fragmentRef: citation.fragmentId, fragmentHash: candidate.fragment.contentHash,
        sourceRef: revision.revisionId, sourceKind: summaryOnly ? "app_document" : document?.canonicalUrl ? "external_url" : "upload",
        sourceUrl: document?.canonicalUrl ?? null,
        sourceTitle: `${summaryOnly ? "教学转译｜" : ""}${document?.title ?? citation.title}`.slice(0, 240),
        snippet: candidate.fragment.text.slice(0, 2_000),
        locator: `${summaryOnly ? "教学改写，原件未入库；" : ""}${locatorText(candidate.fragment.locator)}`.slice(0, 500),
        objectRefs: [...input.allowedObjectRefs], supportsClaimRefs: candidate.claims.map((claim) => claim.claimRef),
        evidenceKinds: [...new Set(candidate.claims.flatMap((claim) => claim.runtimeEvidenceKinds))],
        reviewStatus: candidate.knowledge.reviewStatus === "verified" ? "verified" : "pending_expert_review",
        effectiveAt: revision.createdAt,
        expiresAt: grants.some((grant) => !grant.expiresAt) ? null : grants.map((grant) => grant.expiresAt!).sort().at(-1)!,
        revokedAt: null,
      });
    }
    const status = fragments.length ? "authorized" as const : revoked.size || expired.size ? "forbidden" as const : "empty" as const;
    const base = { sessionId: input.sessionId, courseReleaseRef: actual, studentBindingHash: input.studentBindingHash,
      purpose: "grounded_collaboration" as const, audience: "agent" as const,
      allowedObjectRefs: [...input.allowedObjectRefs], allowedClaimRefs: [...input.allowedClaimRefs],
      allowedKnowledgeRefs: [...input.allowedKnowledgeRefs], allowedSourceRevisionRefs: [...input.allowedSourceRevisionRefs ?? []],
      allowedFragments: fragments.sort((a, b) => a.fragmentRef.localeCompare(b.fragmentRef)).slice(0, 64),
      expiredClaimRefs: [...expired].sort(), revokedClaimRefs: [...revoked].sort(),
      grantedAt: (this.options.now ?? (() => new Date().toISOString()))(), expiresAt: null,
      status, failureReason: status === "authorized" ? null : "当前资料没有可用于本项判断的有效授权片段；新修订须由教师关联引用关系。" };
    return GroundedEvidenceAuthorizationV4Schema.parse({ schemaVersion: "grounded-evidence-authorization/4.0.0", ...base,
      authorizationHash: hashCanonical({ ...base, grantedAt: null, knowledgeRevisions: knowledge.map((item) => [item.knowledgeId, item.contentHash]).sort() }) });
  }

  async retrieve(input: Readonly<GroundedRetrievalPortInputV4>) {
    const { authorization, query } = input;
    const current = await this.authorize({ ...authorization, asOf: query.asOf });
    if (current.authorizationHash !== authorization.authorizationHash) throw new Error("检索前授权已发生变化，请刷新协作");
    const indexKey = hashCanonical(current.allowedFragments.map((fragment) => [fragment.fragmentRef, fragment.fragmentHash]));
    if (current.status === "authorized" && !this.#indexed.has(indexKey)) {
      const operation = this.#indexing.get(indexKey) ?? (async () => {
        const store = await this.options.runtime.store();
        const rows = await store.search({ query: "", courseId: current.courseReleaseRef.courseId, purpose: "model_context", subjectRef: null, allowedFragmentIds: new Set(current.allowedFragments.map((f) => f.fragmentRef)), limit: 200 });
        await this.options.runtime.indexFragments(rows.citations.map((row) => ({ fragmentId: row.fragmentId, text: row.text })), sharedIndexer);
        this.#indexed.add(indexKey);
      })();
      this.#indexing.set(indexKey, operation);
      try { await operation; } finally { this.#indexing.delete(indexKey); }
    }
    const result = current.status === "authorized" ? await this.options.runtime.retrieve(sharedIndexer, { query: query.queryText, courseId: current.courseReleaseRef.courseId, purpose: "model_context", subjectRef: null, allowedFragmentIds: new Set(current.allowedFragments.map((f) => f.fragmentRef)), limit: query.maxResults }) : null;
    const approved = new Map(current.allowedFragments.map((fragment) => [fragment.fragmentRef, fragment]));
    const store = await this.options.runtime.store();
    const currentKnowledge = new Map(await Promise.all([...new Set(current.allowedFragments.map((fragment) => fragment.knowledgeRef))]
      .map(async (id) => [id, await store.getKnowledge(id)] as const)));
    const citations = (result?.citations ?? []).flatMap((row) => {
      const fragment = approved.get(row.fragmentId);
      if (!fragment) return [];
      const knowledge = currentKnowledge.get(fragment.knowledgeRef)!;
      const relations = claimRelations(knowledge!).filter((relation) => fragment.supportsClaimRefs.includes(relation.claimRef));
      const stance = result!.conflicts.some((conflict) => conflict.refuting.includes(row.fragmentId)) || relations.some((relation) => relation.relation === "refutes")
        ? "refutes" as const : relations.length && !relations.some((relation) => relation.relation === "supports") ? "context" as const : "supports" as const;
      return [{ ...fragment, stance }];
    });
    return new InMemoryGroundedRetrievalPortV4({ citations,
      minimumIndependentSupport: Object.fromEntries(this.options.content.claims.map((claim) => [claim.claimRef, claim.minimumIndependentSupportCount])),
      ...(this.options.now ? { now: this.options.now } : {}) }).retrieve(input);
  }
}

import { createHash } from "node:crypto";
import {
  GroundedRetrievalAuthorizationScopeV4Schema,
  GroundedEvidenceAuthorizationV4Schema,
  GroundedEvidenceAuthorizationFragmentV4Schema,
  GroundedRetrievalCitationV4Schema,
  GroundedRetrievalQueryV4Schema,
  GroundedRetrievalResultV4Schema,
  type GroundedRetrievalAuthorizationScopeV4,
  type GroundedRetrievalCitationV4,
  type GroundedRetrievalQueryV4,
  type GroundedRetrievalResultV4,
  type GroundedEvidenceAuthorizationV4,
  type GroundedEvidenceAuthorizationFragmentV4,
} from "@ronggang/contracts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export interface GroundedRetrievalPortInputV4 {
  readonly authorization: GroundedRetrievalAuthorizationScopeV4;
  readonly query: GroundedRetrievalQueryV4;
}

export interface GroundedRetrievalPortV4 {
  retrieve(
    input: Readonly<GroundedRetrievalPortInputV4>,
  ): Promise<GroundedRetrievalResultV4>;
}

export interface GroundedEvidenceAuthorizationInputV4 {
  readonly sessionId: string;
  readonly courseReleaseRef: GroundedEvidenceAuthorizationV4["courseReleaseRef"];
  readonly studentBindingHash: string;
  readonly allowedObjectRefs: readonly string[];
  readonly allowedClaimRefs: readonly string[];
  readonly allowedKnowledgeRefs: readonly string[];
  readonly allowedSourceRevisionRefs?: readonly string[];
  readonly asOf: string;
}

export interface GroundedEvidenceAuthorizationResolverV4 {
  authorize(
    input: Readonly<GroundedEvidenceAuthorizationInputV4>,
  ): Promise<GroundedEvidenceAuthorizationV4>;
}

export interface InMemoryGroundedEvidenceAuthorizationResolverV4Options {
  readonly courseReleaseRef: GroundedEvidenceAuthorizationV4["courseReleaseRef"];
  readonly fragments: readonly GroundedEvidenceAuthorizationFragmentV4[];
  readonly now?: () => string;
}

export class InMemoryGroundedEvidenceAuthorizationResolverV4
  implements GroundedEvidenceAuthorizationResolverV4 {
  readonly #courseReleaseRef: GroundedEvidenceAuthorizationV4["courseReleaseRef"];
  readonly #fragments: readonly GroundedEvidenceAuthorizationFragmentV4[];
  readonly #now: () => string;

  constructor(options: InMemoryGroundedEvidenceAuthorizationResolverV4Options) {
    this.#courseReleaseRef = structuredClone(options.courseReleaseRef);
    this.#fragments = options.fragments.map((fragment) => (
      GroundedEvidenceAuthorizationFragmentV4Schema.parse(fragment)
    ));
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async authorize(
    input: Readonly<GroundedEvidenceAuthorizationInputV4>,
  ): Promise<GroundedEvidenceAuthorizationV4> {
    const allowedObjects = new Set(input.allowedObjectRefs);
    const allowedClaims = new Set(input.allowedClaimRefs);
    const allowedKnowledge = new Set(input.allowedKnowledgeRefs);
    const allowedRevisions = new Set(input.allowedSourceRevisionRefs ?? []);
    const asOf = Date.parse(input.asOf);
    const expiredClaimRefs = new Set<string>();
    const revokedClaimRefs = new Set<string>();
    const courseMatch = input.courseReleaseRef.courseId === this.#courseReleaseRef.courseId
      && input.courseReleaseRef.releaseId === this.#courseReleaseRef.releaseId
      && input.courseReleaseRef.version === this.#courseReleaseRef.version
      && input.courseReleaseRef.contentHash === this.#courseReleaseRef.contentHash;
    const fragments = this.#fragments.filter((fragment) => {
      if (fragment.knowledgeRef === ""
        || !allowedKnowledge.has(fragment.knowledgeRef)
        || !fragment.supportsClaimRefs.some((claimRef) => allowedClaims.has(claimRef))
        || !fragment.objectRefs.some((objectRef) => allowedObjects.has(objectRef))
        || (allowedRevisions.size > 0 && !allowedRevisions.has(fragment.sourceRevision))
        || Date.parse(fragment.effectiveAt) > asOf) return false;
      if (fragment.expiresAt !== null && Date.parse(fragment.expiresAt) <= asOf) {
        for (const claimRef of fragment.supportsClaimRefs) expiredClaimRefs.add(claimRef);
        return false;
      }
      if (fragment.revokedAt !== null && Date.parse(fragment.revokedAt) <= asOf) {
        for (const claimRef of fragment.supportsClaimRefs) revokedClaimRefs.add(claimRef);
        return false;
      }
      return true;
    });
    const authorizedFragments = courseMatch ? fragments : [];
    const status = authorizedFragments.length > 0 ? "authorized" as const : "empty" as const;
    const failureReason = status === "authorized"
      ? null
      : courseMatch
        ? "当前用途授权和有效 source revision 没有共同可用片段"
        : "course release 与受信任授权解析器不一致";
    const base = {
      sessionId: input.sessionId,
      courseReleaseRef: this.#courseReleaseRef,
      studentBindingHash: input.studentBindingHash,
      purpose: "grounded_collaboration" as const,
      audience: "agent" as const,
      allowedObjectRefs: [...new Set(input.allowedObjectRefs)],
      allowedClaimRefs: [...new Set(input.allowedClaimRefs)],
      allowedKnowledgeRefs: [...new Set(input.allowedKnowledgeRefs)],
      allowedSourceRevisionRefs: [...new Set(input.allowedSourceRevisionRefs ?? [])],
      allowedFragments: authorizedFragments,
      expiredClaimRefs: [...expiredClaimRefs],
      revokedClaimRefs: [...revokedClaimRefs],
      grantedAt: this.#now(),
      expiresAt: null,
      status,
      failureReason,
    };
    const authorizationFingerprint = { ...base, grantedAt: null };
    return GroundedEvidenceAuthorizationV4Schema.parse({
      schemaVersion: "grounded-evidence-authorization/4.0.0",
      ...base,
      authorizationHash: hash(authorizationFingerprint),
    });
  }
}

export interface InMemoryGroundedRetrievalPortV4Options {
  readonly citations: readonly GroundedRetrievalCitationV4[];
  readonly minimumIndependentSupport?: Readonly<Record<string, number>>;
  readonly now?: () => string;
}

/**
 * A synchronized, deterministic port for tests and local deterministic runs.
 * It performs the same authorization, revision, expiry and revocation checks
 * expected from the future SQL adapter, but never claims to be database-backed.
 */
export class InMemoryGroundedRetrievalPortV4 implements GroundedRetrievalPortV4 {
  readonly #citations: readonly GroundedRetrievalCitationV4[];
  readonly #minimumIndependentSupport: Readonly<Record<string, number>>;
  readonly #now: () => string;

  constructor(options: InMemoryGroundedRetrievalPortV4Options) {
    this.#minimumIndependentSupport = { ...options.minimumIndependentSupport };
    this.#citations = options.citations.map((citation) => (
      GroundedRetrievalCitationV4Schema.parse(citation)
    ));
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async retrieve(
    input: Readonly<GroundedRetrievalPortInputV4>,
  ): Promise<GroundedRetrievalResultV4> {
    const authorization = GroundedRetrievalAuthorizationScopeV4Schema.parse(
      input.authorization,
    );
    const query = GroundedRetrievalQueryV4Schema.parse(input.query);
    const queryHash = hash({
      authorization: { ...authorization, grantedAt: null },
      query: { ...query, asOf: null },
    });
    const asOf = Date.parse(query.asOf);
    const allowedObjects = new Set(authorization.allowedObjectRefs);
    const allowedClaims = new Set(authorization.allowedClaimRefs);
    const allowedKnowledge = new Set(authorization.allowedKnowledgeRefs);
    const allowedRevisions = new Set(authorization.allowedSourceRevisionRefs);
    const authorizedFragments = new Map(
      authorization.allowedFragments.map((fragment) => [fragment.fragmentRef, fragment]),
    );
    const expiredClaimRefs = new Set<string>(authorization.expiredClaimRefs);
    const revokedClaimRefs = new Set<string>(authorization.revokedClaimRefs);
    const candidates = this.#citations.filter((citation) => {
      if (!citation.supportsClaimRefs.some((claimRef) => (
        query.claimRefs.includes(claimRef) && allowedClaims.has(claimRef)
      ))) return false;
      const authorized = authorizedFragments.get(citation.fragmentRef);
      if (!authorized
        || authorized.knowledgeRef !== citation.knowledgeRef
        || authorized.sourceRevision !== citation.sourceRevision
        || authorized.fragmentHash !== citation.fragmentHash
        || authorized.sourceRef !== citation.sourceRef
        || authorized.sourceKind !== citation.sourceKind
        || authorized.sourceUrl !== citation.sourceUrl
        || authorized.sourceTitle !== citation.sourceTitle
        || authorized.snippet !== citation.snippet
        || authorized.reviewStatus !== citation.reviewStatus
        || authorized.effectiveAt !== citation.effectiveAt
        || authorized.expiresAt !== citation.expiresAt
        || authorized.revokedAt !== citation.revokedAt
        || authorized.locator !== citation.locator) return false;
      if (!citation.objectRefs.some((objectRef) => (
        query.objectRefs.includes(objectRef) && allowedObjects.has(objectRef)
      ))) return false;
      if (!allowedKnowledge.has(citation.knowledgeRef)) return false;
      if (allowedRevisions.size > 0 && !allowedRevisions.has(citation.sourceRevision)) {
        return false;
      }
      if (citation.effectiveAt && Date.parse(citation.effectiveAt) > asOf) return false;
      if (citation.expiresAt && Date.parse(citation.expiresAt) <= asOf) {
        for (const claimRef of citation.supportsClaimRefs) expiredClaimRefs.add(claimRef);
        return false;
      }
      if (citation.revokedAt && Date.parse(citation.revokedAt) <= asOf) {
        for (const claimRef of citation.supportsClaimRefs) revokedClaimRefs.add(claimRef);
        return false;
      }
      if (query.evidenceKinds.length > 0 && !citation.evidenceKinds.some((kind) => (
        query.evidenceKinds.includes(kind)
      ))) return false;
      return true;
    }).slice(0, query.maxResults);
    const unresolvedClaimRefs = query.claimRefs.filter((claimRef) => (
      new Set(candidates.filter((citation) => citation.stance === "supports" && citation.supportsClaimRefs.includes(claimRef))
        .map((citation) => citation.sourceDocumentRef)).size < (this.#minimumIndependentSupport[claimRef] ?? 1)
    ));
    const conflictRefs = query.claimRefs.filter((claimRef) => {
      const stances = new Set(candidates
        .filter((citation) => citation.supportsClaimRefs.includes(claimRef))
        .map((citation) => citation.stance));
      return stances.has("refutes");
    });
    const retrievedAt = this.#now();
    const status = candidates.length > 0 ? "ok" as const : "empty" as const;
    const failureReason = status === "ok"
      ? null
      : "授权范围内没有当前有效、可定位的片段";
    const resultHash = hash({
      queryHash,
      authorizationHash: authorization.authorizationHash,
      citations: candidates,
      unresolvedClaimRefs,
      conflictRefs,
      expiredClaimRefs: [...expiredClaimRefs],
      revokedClaimRefs: [...revokedClaimRefs],
      status,
    });
    return GroundedRetrievalResultV4Schema.parse({
      schemaVersion: "grounded-retrieval/4.0.0",
      status,
      queryHash,
      resultHash,
      authorizationHash: authorization.authorizationHash,
      citations: candidates,
      unresolvedClaimRefs,
      conflictRefs,
      expiredClaimRefs: [...expiredClaimRefs],
      revokedClaimRefs: [...revokedClaimRefs],
      retrievedAt,
      failureReason,
    });
  }
}

export interface GroundedRetrievalRuntimeContentV4Input {
  readonly knownObjectRefs: readonly string[];
  readonly knowledge: ReadonlyArray<{
    knowledgeRef: string;
    sourceTitle: string;
    sourceUrl: string;
    locator: string;
    teachingSummary: string;
    sourceContentHash: string;
    reviewStatus: "pending_expert_review" | "verified";
  }>;
  readonly claims: ReadonlyArray<{
    claimRef: string;
    knowledgeRefs: readonly string[];
    runtimeEvidenceKinds: readonly string[];
    minimumIndependentSupportCount?: number;
  }>;
}

export function createInMemoryGroundedEvidenceAuthorizationResolverV4(
  input: GroundedRetrievalRuntimeContentV4Input & {
    readonly courseReleaseRef: GroundedEvidenceAuthorizationV4["courseReleaseRef"];
  },
  options: Pick<InMemoryGroundedEvidenceAuthorizationResolverV4Options, "now"> = {},
): InMemoryGroundedEvidenceAuthorizationResolverV4 {
  const fragments = input.knowledge.map((knowledge) => {
    const claims = input.claims.filter((claim) => (
      claim.knowledgeRefs.includes(knowledge.knowledgeRef)
    ));
    return {
      knowledgeRef: knowledge.knowledgeRef,
      sourceDocumentRef: `source-document-${knowledge.knowledgeRef}`,
      sourceRevision: `source-revision-${knowledge.knowledgeRef}`,
      fragmentRef: `source-fragment-${knowledge.knowledgeRef}`,
      fragmentHash: knowledge.sourceContentHash,
      sourceRef: `source-ref-${knowledge.knowledgeRef}`,
      sourceKind: "external_url" as const,
      sourceUrl: knowledge.sourceUrl,
      sourceTitle: knowledge.sourceTitle,
      snippet: knowledge.teachingSummary,
      locator: knowledge.locator,
      objectRefs: [...input.knownObjectRefs],
      supportsClaimRefs: claims.map((claim) => claim.claimRef),
      evidenceKinds: [...new Set(claims.flatMap((claim) => claim.runtimeEvidenceKinds))],
      reviewStatus: knowledge.reviewStatus,
      effectiveAt: new Date(0).toISOString(),
      expiresAt: null,
      revokedAt: null,
    };
  }).filter((fragment) => fragment.supportsClaimRefs.length > 0);
  return new InMemoryGroundedEvidenceAuthorizationResolverV4({
    courseReleaseRef: input.courseReleaseRef,
    fragments,
    ...options,
  });
}

/** Builds the explicit in-memory mirror of the current public knowledge input. */
export function createInMemoryGroundedRetrievalPortV4(
  input: GroundedRetrievalRuntimeContentV4Input,
  options: Pick<InMemoryGroundedRetrievalPortV4Options, "now"> = {},
): InMemoryGroundedRetrievalPortV4 {
  const citations = input.knowledge.map((knowledge) => {
    const claims = input.claims.filter((claim) => (
      claim.knowledgeRefs.includes(knowledge.knowledgeRef)
    ));
    return {
      knowledgeRef: knowledge.knowledgeRef,
      sourceDocumentRef: `source-document-${knowledge.knowledgeRef}`,
      sourceRevision: `source-revision-${knowledge.knowledgeRef}`,
      fragmentRef: `source-fragment-${knowledge.knowledgeRef}`,
      fragmentHash: knowledge.sourceContentHash,
      sourceRef: `source-ref-${knowledge.knowledgeRef}`,
      sourceKind: "external_url" as const,
      sourceTitle: knowledge.sourceTitle,
      sourceUrl: knowledge.sourceUrl,
      snippet: knowledge.teachingSummary,
      locator: knowledge.locator,
      objectRefs: [...input.knownObjectRefs],
      supportsClaimRefs: claims.map((claim) => claim.claimRef),
      evidenceKinds: [...new Set(claims.flatMap((claim) => claim.runtimeEvidenceKinds))],
      stance: "supports" as const,
      reviewStatus: knowledge.reviewStatus,
      effectiveAt: new Date(0).toISOString(),
      expiresAt: null,
      revokedAt: null,
    };
  }).filter((citation) => citation.supportsClaimRefs.length > 0);
  return new InMemoryGroundedRetrievalPortV4({ ...options, citations,
    minimumIndependentSupport: Object.fromEntries(input.claims.map((claim) => [claim.claimRef, claim.minimumIndependentSupportCount ?? 1])),
  });
}

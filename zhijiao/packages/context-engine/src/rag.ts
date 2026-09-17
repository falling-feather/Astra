import {
  AccessPolicyVersion,
  RagResultSchema,
  type AccessSubject,
  type Evidence,
  type RagChunk,
  type RagResult,
  type WorldFact,
} from "@ronggang/contracts";
import { authorizeResource } from "./access.js";
import { hashContent } from "./canonical.js";

export const RetrieverVersion = "lexical-rag/1.0.0" as const;

const normalize = (value: string): string[] => {
  const segments = value.toLowerCase().split(/[\s，。；、：！？,.!?;:()（）]+/u).filter(Boolean);
  const terms = segments.flatMap((segment) => {
    if (!/[\p{Script=Han}]/u.test(segment) || segment.length < 3) return [segment];
    return [segment, ...Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2))];
  });
  return [...new Set(terms)];
};

function scoreChunk(chunk: RagChunk, terms: string[]): number {
  const haystack = `${chunk.title} ${chunk.content} ${chunk.competencyId} ${chunk.ruleDomain}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? Math.max(1, term.length) : 0), 0);
}

export interface RagSearchBackend {
  search(input: {
    query: string;
    candidates: readonly RagChunk[];
    limit: number;
  }): Promise<readonly RagChunk[]> | readonly RagChunk[];
}

export class LexicalRagBackend implements RagSearchBackend {
  search(input: {
    query: string;
    candidates: readonly RagChunk[];
    limit: number;
  }): readonly RagChunk[] {
    const terms = normalize(input.query);
    return input.candidates
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
      .filter(({ score }) => score > 0 || terms.length === 0)
      .sort((left, right) => right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId))
      .slice(0, input.limit)
      .map(({ chunk }) => chunk);
  }
}

export interface AuthorizedRagInput {
  query: string;
  subject: AccessSubject;
  nodeId: string;
  stateVersion: number;
  chunks: readonly RagChunk[];
  facts: readonly WorldFact[];
  evidence: readonly Evidence[];
  transient?: readonly string[];
  limit?: number;
}

export class AuthorizedRagRetriever {
  readonly #backend: RagSearchBackend;

  constructor(backend: RagSearchBackend = new LexicalRagBackend()) {
    this.#backend = backend;
  }

  async retrieve(input: AuthorizedRagInput): Promise<RagResult> {
    let preRejectedCount = 0;
    const preAuthorized = input.chunks.filter((chunk) => {
      const allowed = (
        chunk.status === "active"
        && chunk.courseId === input.subject.courseId
        && (chunk.nodeId === null || chunk.nodeId === input.nodeId)
        && authorizeResource(input.subject, chunk.audience).allowed
        && hashContent(chunk.content) === chunk.contentHash
      );
      if (!allowed) preRejectedCount += 1;
      return allowed;
    });
    const canonicalById = new Map(preAuthorized.map((chunk) => [chunk.chunkId, chunk]));
    const backendResults = await this.#backend.search({
      query: input.query,
      candidates: preAuthorized,
      limit: input.limit ?? 4,
    });
    let postRejectedCount = 0;
    const seen = new Set<string>();
    const retrieved = backendResults.flatMap((candidate) => {
      const canonical = canonicalById.get(candidate.chunkId);
      const allowed = (
        canonical
        && !seen.has(canonical.chunkId)
        && canonical.contentHash === candidate.contentHash
        && canonical.version === candidate.version
        && canonical.corpusVersion === candidate.corpusVersion
        && hashContent(candidate.content) === candidate.contentHash
        && authorizeResource(input.subject, candidate.audience).allowed
      );
      if (!allowed) {
        postRejectedCount += 1;
        return [];
      }
      seen.add(canonical.chunkId);
      return [canonical];
    }).slice(0, input.limit ?? 4);
    const corpusVersion = retrieved[0]?.corpusVersion
      ?? preAuthorized[0]?.corpusVersion
      ?? input.chunks[0]?.corpusVersion
      ?? "empty-corpus/1";

    return RagResultSchema.parse({
      query: input.query,
      actorId: input.subject.actorId,
      roleId: input.subject.roleId,
      teamId: input.subject.teamId,
      stateVersion: input.stateVersion,
      policyVersion: AccessPolicyVersion,
      retrieverVersion: RetrieverVersion,
      corpusVersion,
      layers: {
        fixed: [
          "只采用经审核的权威事实",
          "角色不得越权改写世界状态",
          "结论必须带来源引用",
        ],
        state: input.facts
          .filter((fact) => fact.status === "verified" || fact.status === "disputed")
          .map((fact) => `${fact.factId}: ${fact.statement}`),
        retrieved,
        evidence: input.evidence
          .slice(-6)
          .map((item) => `${item.evidenceId}: ${item.action}｜${item.basis}`),
        transient: [...(input.transient ?? [])],
      },
      citations: retrieved.map((chunk) => ({
        chunkId: chunk.chunkId,
        source: chunk.source,
        version: chunk.version,
        contentHash: chunk.contentHash,
      })),
      acl: { preRejectedCount, postRejectedCount },
    });
  }
}

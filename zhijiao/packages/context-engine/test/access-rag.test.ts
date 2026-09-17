import type {
  AccessSubject,
  RagChunk,
  ResourceAudience,
  RoleContract,
} from "@ronggang/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  AuthorizedRagRetriever,
  authorizeResource,
  createAccessSubject,
  createResourceAudience,
  hashContent,
  type RagSearchBackend,
} from "../src/index.js";

const courseId = "course-converged-media-practice";
const sessionId = "session-data-001";
const sessionEpoch = "epoch-1";

function role(input: Partial<RoleContract> & Pick<RoleContract, "agentId" | "roleId" | "teamId">): RoleContract {
  return {
    agentId: input.agentId,
    actorKind: input.actorKind ?? "agent",
    roleId: input.roleId,
    displayName: input.agentId,
    purpose: "test",
    teamId: input.teamId,
    visibleScopes: input.visibleScopes ?? ["public_world", "assigned_team", "role_private"],
    privateScopes: input.privateScopes ?? [`actor:${input.agentId}`],
    allowedIntents: [],
    deniedActions: [],
    toolPolicy: input.toolPolicy ?? ["memory.read.own"],
    tokenBudget: 4_000,
    memoryPolicy: {
      readOwn: true,
      writeOwn: false,
      auditReadable: true,
      retention: "session_epoch",
      maxEntries: 50,
    },
  };
}

function subject(input: Partial<RoleContract> & Pick<RoleContract, "agentId" | "roleId" | "teamId">): AccessSubject {
  return createAccessSubject({
    role: role(input),
    sessionId,
    sessionEpoch,
    courseId,
    purpose: "runtime",
  });
}

function audience(input: Partial<ResourceAudience> & Pick<ResourceAudience, "scopes">): ResourceAudience {
  return createResourceAudience({
    scopes: input.scopes,
    courseId,
    sessionId,
    sessionEpoch,
    teamIds: input.teamIds ?? [],
    roleIds: input.roleIds ?? [],
    actorIds: input.actorIds ?? [],
    privateNamespaces: input.privateNamespaces ?? [],
    auditReadable: input.auditReadable ?? false,
  });
}

function chunk(input: {
  chunkId: string;
  content: string;
  audience: ResourceAudience;
  roleId?: RagChunk["roleId"];
}): RagChunk {
  return {
    chunkId: input.chunkId,
    domain: "scenario",
    title: input.chunkId,
    content: input.content,
    courseId,
    nodeId: "source",
    roleId: input.roleId ?? null,
    competencyId: "C-FACT-01",
    ruleDomain: "journalism",
    mediaType: "text",
    source: `source:${input.chunkId}`,
    version: "1",
    visibility: input.audience.scopes[0]!,
    contentHash: hashContent(input.content),
    corpusVersion: "demo-corpus/1",
    status: "active",
    audience: input.audience,
  };
}

describe("resource access policy", () => {
  it("allows the assigned team and denies another team", () => {
    const resource = audience({ scopes: ["assigned_team"], teamIds: ["team-a"] });
    expect(authorizeResource(subject({
      agentId: "agent-a",
      roleId: "reporter",
      teamId: "team-a",
    }), resource).allowed).toBe(true);
    expect(authorizeResource(subject({
      agentId: "agent-b",
      roleId: "reporter",
      teamId: "team-b",
    }), resource)).toMatchObject({ allowed: false, reason: "scope_denied" });
  });

  it("fails closed for role_private without actor or namespace and isolates same-role actors", () => {
    const emptyPrivate = audience({
      scopes: ["role_private"],
      roleIds: ["reporter"],
      teamIds: ["team-a"],
    });
    expect(authorizeResource(subject({
      agentId: "reporter-a",
      roleId: "reporter",
      teamId: "team-a",
    }), emptyPrivate)).toMatchObject({ allowed: false, reason: "private_namespace_denied" });

    const owned = audience({
      scopes: ["role_private"],
      roleIds: ["reporter"],
      teamIds: ["team-a"],
      actorIds: ["reporter-a"],
    });
    expect(authorizeResource(subject({
      agentId: "reporter-a",
      roleId: "reporter",
      teamId: "team-a",
    }), owned).allowed).toBe(true);
    expect(authorizeResource(subject({
      agentId: "reporter-b",
      roleId: "reporter",
      teamId: "team-a",
    }), owned)).toMatchObject({ allowed: false, reason: "actor_denied" });
  });

  it("requires an explicit audit purpose and capability", () => {
    const privateAudit = audience({
      scopes: ["role_private", "audit_only"],
      teamIds: ["team-a"],
      actorIds: ["reporter-a"],
      auditReadable: true,
    });
    const teacherRole = role({
      agentId: "teacher-main",
      roleId: "teacher",
      teamId: "team-a",
      actorKind: "teacher",
      visibleScopes: ["public_world", "assigned_team", "teacher_only", "audit_only"],
      toolPolicy: ["read_all"],
    });
    const ordinaryTeacher = createAccessSubject({
      role: teacherRole,
      sessionId,
      sessionEpoch,
      courseId,
      purpose: "runtime",
    });
    const auditor = createAccessSubject({
      role: teacherRole,
      sessionId,
      sessionEpoch,
      courseId,
      purpose: "audit",
    });
    expect(authorizeResource(ordinaryTeacher, privateAudit).allowed).toBe(false);
    expect(authorizeResource(auditor, privateAudit).allowed).toBe(true);
  });
});

describe("authorized RAG", () => {
  it("never sends unauthorized chunks to scoring and rejects a malicious post-result", async () => {
    const actor = subject({
      agentId: "fact-a",
      roleId: "fact_checker",
      teamId: "team-a",
    });
    const allowed = chunk({
      chunkId: "allowed",
      content: "入口去重表确认有效客流为12,600人次。",
      audience: audience({ scopes: ["assigned_team"], teamIds: ["team-a"] }),
    });
    const otherTeam = chunk({
      chunkId: "other-team",
      content: "另一团队私有统计。",
      audience: audience({ scopes: ["assigned_team"], teamIds: ["team-b"] }),
    });
    const search = vi.fn<RagSearchBackend["search"]>(({ candidates }) => [candidates[0]!, otherTeam]);
    const retriever = new AuthorizedRagRetriever({ search });
    const result = await retriever.retrieve({
      query: "入口去重",
      subject: actor,
      nodeId: "source",
      stateVersion: 7,
      chunks: [allowed, otherTeam],
      facts: [],
      evidence: [],
    });

    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0].candidates.map((item) => item.chunkId)).toEqual(["allowed"]);
    expect(result.layers.retrieved.map((item) => item.chunkId)).toEqual(["allowed"]);
    expect(result.citations.map((item) => item.chunkId)).toEqual(["allowed"]);
    expect(result.acl).toEqual({ preRejectedCount: 1, postRejectedCount: 1 });
  });
});

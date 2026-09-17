import type {
  AccessSubject,
  RagChunk,
  RoleContract,
} from "@ronggang/contracts";
import { describe, expect, it } from "vitest";
import {
  InMemoryRoleMemoryStore,
  RoleMemoryService,
  VersionedContextAssembler,
  createAccessSubject,
  createResourceAudience,
  createRoleMemoryDelta,
  hashContent,
  hashValue,
  roleMemoryNamespace,
} from "../src/index.js";

const courseId = "course-converged-media-practice";

function subject(agentId: string, roleId: RoleContract["roleId"]): AccessSubject {
  const role: RoleContract = {
    agentId,
    actorKind: "agent",
    roleId,
    displayName: agentId,
    purpose: "test",
    teamId: "team-a",
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${agentId}`],
    allowedIntents: [],
    deniedActions: [],
    toolPolicy: ["memory.read.own", "memory.write.own"],
    tokenBudget: 200,
  };
  return createAccessSubject({
    role,
    sessionId: "session-context",
    sessionEpoch: "epoch-1",
    courseId,
    purpose: "runtime",
  });
}

function ragChunk(input: {
  chunkId: string;
  content: string;
  actor: AccessSubject;
}): RagChunk {
  const audience = createResourceAudience({
    scopes: ["assigned_team"],
    courseId,
    sessionId: input.actor.sessionId,
    sessionEpoch: input.actor.sessionEpoch,
    teamIds: [input.actor.teamId],
  });
  return {
    chunkId: input.chunkId,
    domain: "scenario",
    title: input.chunkId,
    content: input.content,
    courseId,
    nodeId: "source",
    roleId: null,
    competencyId: "C-FACT-01",
    ruleDomain: "journalism",
    mediaType: "text",
    source: `source:${input.chunkId}`,
    version: "1",
    visibility: "assigned_team",
    contentHash: hashContent(input.content),
    corpusVersion: "demo-corpus/1",
    status: "active",
    audience,
  };
}

describe("versioned context assembler", () => {
  it("assembles all six layers, clips whole references, and keeps citations equal to prompt items", async () => {
    const actor = subject("agent-fact-a", "fact_checker");
    const store = new InMemoryRoleMemoryStore();
    const memory = new RoleMemoryService(store);
    const namespace = roleMemoryNamespace({
      sessionId: actor.sessionId,
      sessionEpoch: actor.sessionEpoch,
      teamId: actor.teamId,
      actorId: actor.actorId,
    });
    await memory.append(actor, createRoleMemoryDelta({
      deltaId: "delta-context-1",
      idempotencyKey: "memory-context-1",
      sessionId: actor.sessionId,
      sessionEpoch: actor.sessionEpoch,
      sceneId: "scenario-local-tourism-media-v0.1",
      namespace,
      ownerActorId: actor.actorId,
      ownerRoleId: actor.roleId,
      ownerTeamId: actor.teamId,
      authorActorId: actor.actorId,
      operation: "remember",
      memoryId: "risk-1",
      kind: "risk",
      content: "旧快报可能混入跨入口重复计数。",
      sourceEventIds: ["event-1"],
      revision: 1,
      previousDeltaHash: null,
      createdAt: "2026-07-25T01:00:00.000Z",
      auditReadable: true,
    }));
    const chunks = [
      ragChunk({
        actor,
        chunkId: "chunk-a",
        content: `入口去重规则：${"甲".repeat(120)}`,
      }),
      ragChunk({
        actor,
        chunkId: "chunk-b",
        content: `入口去重来源：${"乙".repeat(120)}`,
      }),
    ];
    const sharedAudience = createResourceAudience({
      scopes: ["assigned_team"],
      courseId,
      sessionId: actor.sessionId,
      sessionEpoch: actor.sessionEpoch,
      teamIds: [actor.teamId],
      auditReadable: true,
    });
    const result = await new VersionedContextAssembler({ memory }).assemble({
      subject: actor,
      scenarioVersion: "0.4.1",
      query: "入口去重",
      nodeId: "source",
      stateVersion: 8,
      tokenBudget: 200,
      chunks,
      facts: [{
        factId: "fact-1",
        domain: "audience",
        statement: "初版快报为18,000人次。",
        status: "verified",
        sourceRefs: ["material-sheet"],
        version: "1",
        visibility: "assigned_team",
        audience: sharedAudience,
      }],
      evidence: [{
        evidenceId: "evidence-1",
        sessionId: actor.sessionId,
        nodeId: "source",
        actorId: actor.actorId,
        action: "检查快报",
        basis: "发现去重口径未说明",
        materialRefs: ["material-sheet"],
        eventRefs: ["event-1"],
        observationRefs: [],
        artifactRevisionRefs: [],
        processingTaskRefs: [],
        createdAt: "2026-07-25T01:01:00.000Z",
        visibility: ["assigned_team"],
        audience: sharedAudience,
      }],
      transient: [{
        itemId: "trigger:event-1",
        content: "本轮观察：快报包含入口重复汇总。",
        source: "event-1",
        version: "8",
        audience: sharedAudience,
      }],
      fixed: ["Observation 不能自动成为权威事实。"],
      assembledAt: "2026-07-25T01:02:00.000Z",
    });

    expect(result.context.fixed.length).toBeGreaterThan(0);
    expect(result.context.state).toHaveLength(1);
    expect(result.context.retrieved).toHaveLength(1);
    expect(result.context.evidence).toHaveLength(1);
    expect(result.context.privateMemory[0]?.content).toContain("重复计数");
    expect(result.context.transient).toHaveLength(1);
    expect(result.manifest.includedCitationRefs).toEqual(
      result.context.retrieved.map((item) => item.itemId),
    );
    expect(result.manifest.droppedItems.some((item) => item.layer === "retrieved")).toBe(true);
    expect(result.manifest.contextHash).toBe(hashValue(result.context));
  });

  it("gives same-role different actors distinct private-memory layers", async () => {
    const first = subject("agent-reporter-a", "reporter");
    const second = subject("agent-reporter-b", "reporter");
    const store = new InMemoryRoleMemoryStore();
    const memory = new RoleMemoryService(store);
    for (const [actor, content] of [[first, "记者 A 的私有采访承诺"], [second, "记者 B 的私有采访承诺"]] as const) {
      await memory.append(actor, createRoleMemoryDelta({
        deltaId: `delta-${actor.actorId}`,
        idempotencyKey: `memory-${actor.actorId}`,
        sessionId: actor.sessionId,
        sessionEpoch: actor.sessionEpoch,
        sceneId: "scenario-local-tourism-media-v0.1",
        namespace: roleMemoryNamespace({
          sessionId: actor.sessionId,
          sessionEpoch: actor.sessionEpoch,
          teamId: actor.teamId,
          actorId: actor.actorId,
        }),
        ownerActorId: actor.actorId,
        ownerRoleId: actor.roleId,
        ownerTeamId: actor.teamId,
        authorActorId: actor.actorId,
        operation: "remember",
        memoryId: "commitment",
        kind: "commitment",
        content,
        sourceEventIds: ["event-1"],
        revision: 1,
        previousDeltaHash: null,
        createdAt: "2026-07-25T01:00:00.000Z",
        auditReadable: true,
      }));
    }
    const assembler = new VersionedContextAssembler({ memory });
    const base = {
      scenarioVersion: "0.4.1",
      query: "采访承诺",
      nodeId: "source",
      stateVersion: 1,
      tokenBudget: 400,
      chunks: [],
      facts: [],
      evidence: [],
      assembledAt: "2026-07-25T01:02:00.000Z",
    };
    const firstContext = await assembler.assemble({ ...base, subject: first });
    const secondContext = await assembler.assemble({ ...base, subject: second });

    expect(firstContext.context.privateMemory[0]?.content).toContain("记者 A");
    expect(secondContext.context.privateMemory[0]?.content).toContain("记者 B");
    expect(firstContext.manifest.memorySnapshotHash).not.toBe(secondContext.manifest.memorySnapshotHash);
  });
});

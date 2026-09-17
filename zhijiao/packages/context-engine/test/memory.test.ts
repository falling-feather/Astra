import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AccessSubject, RoleContract } from "@ronggang/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryRoleMemoryStore,
  JsonlRoleMemoryStore,
  RoleMemoryAccessError,
  RoleMemoryService,
  buildRoleMemoryIntegrityManifest,
  createAccessSubject,
  createRoleMemoryDelta,
  projectRoleMemory,
  roleMemoryNamespace,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

function role(input: {
  agentId: string;
  roleId: RoleContract["roleId"];
  teamId: string;
  actorKind?: RoleContract["actorKind"];
  toolPolicy?: string[];
}): RoleContract {
  return {
    agentId: input.agentId,
    actorKind: input.actorKind ?? "agent",
    roleId: input.roleId,
    displayName: input.agentId,
    purpose: "test",
    teamId: input.teamId,
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents: [],
    deniedActions: [],
    toolPolicy: input.toolPolicy ?? ["memory.read.own", "memory.write.own"],
    tokenBudget: 4_000,
  };
}

function subject(input: {
  agentId: string;
  roleId: RoleContract["roleId"];
  teamId: string;
  epoch?: string;
  actorKind?: RoleContract["actorKind"];
  toolPolicy?: string[];
  purpose?: AccessSubject["purpose"];
}): AccessSubject {
  return createAccessSubject({
    role: role(input),
    sessionId: "session-memory",
    sessionEpoch: input.epoch ?? "epoch-1",
    courseId: "course-converged-media-practice",
    purpose: input.purpose ?? "runtime",
  });
}

function firstDelta(
  owner: AccessSubject,
  content = "尚需核对入口去重口径。",
  auditReadable = true,
) {
  return createRoleMemoryDelta({
    deltaId: "delta-1",
    idempotencyKey: `${owner.sessionEpoch}:${owner.actorId}:memory-1:1`,
    sessionId: owner.sessionId,
    sessionEpoch: owner.sessionEpoch,
    sceneId: "scenario-local-tourism-media-v0.1",
    namespace: roleMemoryNamespace({
      sessionId: owner.sessionId,
      sessionEpoch: owner.sessionEpoch,
      teamId: owner.teamId,
      actorId: owner.actorId,
    }),
    ownerActorId: owner.actorId,
    ownerRoleId: owner.roleId,
    ownerTeamId: owner.teamId,
    authorActorId: owner.actorId,
    operation: "remember",
    memoryId: "memory-1",
    kind: "episodic",
    content,
    sourceEventIds: ["event-session-started"],
    revision: 1,
    previousDeltaHash: null,
    createdAt: "2026-07-25T01:00:00.000Z",
    auditReadable,
  });
}

describe("role private memory", () => {
  it("appends idempotently and deterministically rebuilds the same snapshot without a model", async () => {
    const owner = subject({
      agentId: "agent-fact-a",
      roleId: "fact_checker",
      teamId: "team-a",
    });
    const store = new InMemoryRoleMemoryStore();
    const service = new RoleMemoryService(store);
    const delta = firstDelta(owner);

    expect((await service.append(owner, delta)).duplicate).toBe(false);
    expect((await service.append(owner, delta)).duplicate).toBe(true);
    const first = await service.read(owner);
    const second = projectRoleMemory({
      sessionId: owner.sessionId,
      sessionEpoch: owner.sessionEpoch,
      namespace: first.namespace,
      deltas: await store.load(owner.sessionId),
    });

    expect(first.entries).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.snapshotHash).toBe(first.snapshotHash);
  });

  it("denies cross-actor and old-epoch reads while allowing explicit teacher audit", async () => {
    const owner = subject({
      agentId: "agent-reporter-a",
      roleId: "reporter",
      teamId: "team-a",
    });
    const other = subject({
      agentId: "agent-reporter-b",
      roleId: "reporter",
      teamId: "team-a",
    });
    const nextEpoch = subject({
      agentId: "agent-reporter-a",
      roleId: "reporter",
      teamId: "team-a",
      epoch: "epoch-2",
    });
    const store = new InMemoryRoleMemoryStore();
    const service = new RoleMemoryService(store);
    await service.append(owner, firstDelta(owner));
    const namespace = roleMemoryNamespace({
      sessionId: owner.sessionId,
      sessionEpoch: owner.sessionEpoch,
      teamId: owner.teamId,
      actorId: owner.actorId,
    });

    await expect(service.read(other, { namespace })).rejects.toBeInstanceOf(RoleMemoryAccessError);
    await expect(service.read(nextEpoch, { namespace })).rejects.toBeInstanceOf(RoleMemoryAccessError);

    const auditor = subject({
      agentId: "teacher-main",
      roleId: "teacher",
      teamId: "team-a",
      actorKind: "teacher",
      toolPolicy: ["read_all"],
      purpose: "audit",
    });
    const audited = await service.read(auditor, {
      namespace,
      ownerActorId: owner.actorId,
      ownerRoleId: owner.roleId,
      ownerTeamId: owner.teamId,
    });
    expect(audited.entries[0]?.content).toContain("入口去重");
  });

  it("survives JSONL reload and keeps private content out of unrelated state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-memory-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "role-memory.jsonl");
    const owner = subject({
      agentId: "agent-fact-a",
      roleId: "fact_checker",
      teamId: "team-a",
    });
    const firstStore = new JsonlRoleMemoryStore(path);
    await new RoleMemoryService(firstStore).append(owner, firstDelta(owner, "仅属于事实核查员的风险记忆。"));
    const reloaded = await new RoleMemoryService(new JsonlRoleMemoryStore(path)).read(owner);

    expect(reloaded.entries[0]?.content).toBe("仅属于事实核查员的风险记忆。");
    expect((await readFile(path, "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("builds the same privacy-preserving integrity root from memory and JSONL stores", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-memory-integrity-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "role-memory.jsonl");
    const owner = subject({
      agentId: "agent-private-canary",
      roleId: "fact_checker",
      teamId: "team-secret-canary",
    });
    const delta = firstDelta(owner, "PRIVATE-MEMORY-CONTENT-CANARY");
    const memory = new InMemoryRoleMemoryStore();
    const jsonl = new JsonlRoleMemoryStore(path);
    await memory.append(delta);
    await jsonl.append(delta);

    const fromMemory = buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      await memory.load(owner.sessionId),
    );
    const fromJsonl = buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      await jsonl.load(owner.sessionId),
    );
    expect(fromJsonl).toEqual(fromMemory);
    expect(fromMemory).toMatchObject({
      deltaCount: 1,
      epochCount: 1,
      namespaceCount: 1,
      memoryCount: 1,
    });
    const serialized = JSON.stringify(fromMemory);
    expect(serialized).not.toContain("PRIVATE-MEMORY-CONTENT-CANARY");
    expect(serialized).not.toContain("agent-private-canary");
    expect(serialized).not.toContain("team-secret-canary");
    expect(serialized).not.toContain(owner.actorId);
    expect(serialized).not.toContain(delta.namespace);
  });

  it("commits audit-hidden deltas without exposing their private identifiers", () => {
    const owner = subject({
      agentId: "agent-hidden-canary",
      roleId: "fact_checker",
      teamId: "team-hidden-canary",
    });
    const visible = firstDelta(owner, "same-body", true);
    const hidden = firstDelta(owner, "same-body", false);
    const visibleManifest = buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      [visible],
    );
    const hiddenManifest = buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      [hidden],
    );

    expect(hiddenManifest.deltaCount).toBe(1);
    expect(hiddenManifest.deltaCommitments).toHaveLength(1);
    expect(hiddenManifest.deltaCommitments)
      .not.toEqual(visibleManifest.deltaCommitments);
    expect(hiddenManifest.manifestHash).not.toBe(visibleManifest.manifestHash);
    const serialized = JSON.stringify(hiddenManifest);
    expect(serialized).not.toContain("agent-hidden-canary");
    expect(serialized).not.toContain("team-hidden-canary");
    expect(serialized).not.toContain(hidden.namespace);
  });

  it("rejects private-memory body tampering and broken revision chains", () => {
    const owner = subject({
      agentId: "agent-fact-a",
      roleId: "fact_checker",
      teamId: "team-a",
    });
    const first = firstDelta(owner);
    expect(() => buildRoleMemoryIntegrityManifest(owner.sessionId, [{
      ...first,
      content: "被改写但没有更新哈希的正文",
    }])).toThrow(/哈希不匹配/u);

    const {
      schemaVersion: _schemaVersion,
      policyVersion: _policyVersion,
      deltaHash: _deltaHash,
      ...firstInput
    } = first;
    const skipped = createRoleMemoryDelta({
      ...firstInput,
      deltaId: "delta-skipped",
      idempotencyKey: "memory-skipped-revision",
      operation: "supersede",
      content: "跳过第一版",
      revision: 2,
      previousDeltaHash: first.deltaHash,
      createdAt: "2026-07-25T01:01:00.000Z",
    });
    expect(() => buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      [skipped],
    )).toThrow(/修订号不连续/u);
  });

  it("rejects a manifest input that mixes deltas from another session", () => {
    const owner = subject({
      agentId: "agent-fact-a",
      roleId: "fact_checker",
      teamId: "team-a",
    });
    const first = firstDelta(owner);
    const {
      schemaVersion: _schemaVersion,
      policyVersion: _policyVersion,
      deltaHash: _deltaHash,
      ...firstInput
    } = first;
    const foreign = createRoleMemoryDelta({
      ...firstInput,
      deltaId: "delta-foreign",
      idempotencyKey: "foreign-session-delta",
      sessionId: "session-foreign",
      namespace: "session:session-foreign/epoch:epoch-1/team:team-a/actor:agent-fact-a",
    });

    expect(() => buildRoleMemoryIntegrityManifest(
      owner.sessionId,
      [first, foreign],
    )).toThrow(/混入其他会话/u);
  });
});

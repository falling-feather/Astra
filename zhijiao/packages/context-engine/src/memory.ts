import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AccessPolicyVersion,
  RoleMemoryDeltaSchema,
  RoleMemoryEntrySchema,
  RoleMemoryIntegrityManifestSchema,
  RoleMemoryIntegritySchemaVersion,
  RoleMemorySchemaVersion,
  RoleMemorySnapshotSchema,
  type AccessSubject,
  type RoleMemoryDelta,
  type RoleMemoryEntry,
  type RoleMemoryIntegrityManifest,
  type RoleMemorySnapshot,
} from "@ronggang/contracts";
import { z } from "zod";
import { roleMemoryNamespace } from "./access.js";
import { hashContent, hashValue } from "./canonical.js";

export class RoleMemoryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleMemoryAccessError";
  }
}

export interface RoleMemoryStore {
  append(delta: RoleMemoryDelta): Promise<{ delta: RoleMemoryDelta; duplicate: boolean }>;
  load(sessionId: string): Promise<RoleMemoryDelta[]>;
}

export function createRoleMemoryDelta(
  input: Omit<RoleMemoryDelta, "schemaVersion" | "policyVersion" | "deltaHash">,
): RoleMemoryDelta {
  const canonical = {
    schemaVersion: RoleMemorySchemaVersion,
    policyVersion: AccessPolicyVersion,
    ...input,
  };
  return RoleMemoryDeltaSchema.parse({
    ...canonical,
    deltaHash: hashValue(canonical),
  });
}

export class InMemoryRoleMemoryStore implements RoleMemoryStore {
  readonly #deltas: RoleMemoryDelta[] = [];

  constructor(initial: readonly RoleMemoryDelta[] = []) {
    for (const delta of initial) this.#appendCanonical(RoleMemoryDeltaSchema.parse(delta));
  }

  #appendCanonical(delta: RoleMemoryDelta): { delta: RoleMemoryDelta; duplicate: boolean } {
    const duplicate = this.#deltas.find((candidate) => candidate.idempotencyKey === delta.idempotencyKey);
    if (duplicate) {
      if (duplicate.deltaHash !== delta.deltaHash) {
        throw new Error(`角色记忆幂等键冲突：${delta.idempotencyKey}`);
      }
      return { delta: structuredClone(duplicate), duplicate: true };
    }
    if (this.#deltas.some((candidate) => candidate.deltaId === delta.deltaId)) {
      throw new Error(`角色记忆增量 ID 重复：${delta.deltaId}`);
    }
    this.#deltas.push(structuredClone(delta));
    return { delta: structuredClone(delta), duplicate: false };
  }

  async append(rawDelta: RoleMemoryDelta): Promise<{ delta: RoleMemoryDelta; duplicate: boolean }> {
    return this.#appendCanonical(RoleMemoryDeltaSchema.parse(rawDelta));
  }

  async load(sessionId: string): Promise<RoleMemoryDelta[]> {
    return structuredClone(this.#deltas.filter((delta) => delta.sessionId === sessionId));
  }
}

const MemoryFrameSchema = z.object({
  kind: z.literal("role_memory_delta"),
  formatVersion: z.literal(1),
  sequence: z.number().int().positive(),
  delta: RoleMemoryDeltaSchema,
}).strict();
type MemoryFrame = z.infer<typeof MemoryFrameSchema>;

async function appendAndSync(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function truncateAndSync(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const memoryStoreLocks = new Map<string, Promise<void>>();

export class JsonlRoleMemoryStore implements RoleMemoryStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = memoryStoreLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    memoryStoreLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (memoryStoreLocks.get(this.#path) === next) memoryStoreLocks.delete(this.#path);
    }
  }

  async #readFrames(): Promise<MemoryFrame[]> {
    let content: string;
    try {
      content = await readFile(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const frames: MemoryFrame[] = [];
    let repaired = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      try {
        const frame = MemoryFrameSchema.parse(JSON.parse(line));
        const expected = (frames.at(-1)?.sequence ?? 0) + 1;
        if (frame.sequence !== expected) throw new Error(`角色记忆日志序号不连续：${expected} -> ${frame.sequence}`);
        frames.push(frame);
      } catch (error) {
        if (index === lines.length - 1 && !content.endsWith("\n")) {
          const prefix = content.slice(0, content.lastIndexOf(line));
          await truncateAndSync(this.#path, Buffer.byteLength(prefix, "utf8"));
          repaired = true;
          break;
        }
        throw new Error(`角色记忆日志第 ${index + 1} 行损坏`, { cause: error });
      }
    }
    if (content.length > 0 && !content.endsWith("\n") && !repaired) {
      await appendAndSync(this.#path, "\n");
    }
    return frames;
  }

  async append(rawDelta: RoleMemoryDelta): Promise<{ delta: RoleMemoryDelta; duplicate: boolean }> {
    const delta = RoleMemoryDeltaSchema.parse(rawDelta);
    return this.#withLock(async () => {
      const frames = await this.#readFrames();
      const duplicate = frames.find((frame) => frame.delta.idempotencyKey === delta.idempotencyKey);
      if (duplicate) {
        if (duplicate.delta.deltaHash !== delta.deltaHash) {
          throw new Error(`角色记忆幂等键冲突：${delta.idempotencyKey}`);
        }
        return { delta: duplicate.delta, duplicate: true };
      }
      if (frames.some((frame) => frame.delta.deltaId === delta.deltaId)) {
        throw new Error(`角色记忆增量 ID 重复：${delta.deltaId}`);
      }
      const frame = MemoryFrameSchema.parse({
        kind: "role_memory_delta",
        formatVersion: 1,
        sequence: frames.length + 1,
        delta,
      });
      await appendAndSync(this.#path, `${JSON.stringify(frame)}\n`);
      return { delta, duplicate: false };
    });
  }

  async load(sessionId: string): Promise<RoleMemoryDelta[]> {
    return this.#withLock(async () => (
      (await this.#readFrames())
        .map((frame) => frame.delta)
        .filter((delta) => delta.sessionId === sessionId)
    ));
  }
}

function assertDeltaHash(delta: RoleMemoryDelta): void {
  const { deltaHash: _deltaHash, ...canonical } = delta;
  if (hashValue(canonical) !== delta.deltaHash) {
    throw new Error(`角色记忆增量哈希不匹配：${delta.deltaId}`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Builds a hash-only integrity root across every epoch and private namespace
 * in one session. The returned manifest deliberately contains no namespace,
 * actor, team, memory identifier, source identifier, or memory body.
 */
export function buildRoleMemoryIntegrityManifest(
  sessionId: string,
  rawDeltas: readonly RoleMemoryDelta[],
): RoleMemoryIntegrityManifest {
  const parsedDeltas = rawDeltas.map((delta) => (
    RoleMemoryDeltaSchema.parse(delta)
  ));
  const foreignDelta = parsedDeltas.find((delta) => (
    delta.sessionId !== sessionId
  ));
  if (foreignDelta) {
    throw new Error(
      `角色记忆完整性输入混入其他会话：${foreignDelta.deltaId}`,
    );
  }
  const deltas = parsedDeltas.sort((left, right) => (
      compareText(left.sessionEpoch, right.sessionEpoch)
      || compareText(left.namespace, right.namespace)
      || compareText(left.memoryId, right.memoryId)
      || left.revision - right.revision
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.deltaId, right.deltaId)
    ));
  const deltaIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const groups = new Map<string, RoleMemoryDelta[]>();
  const epochs = new Set<string>();
  const namespaces = new Set<string>();
  const memories = new Set<string>();

  for (const delta of deltas) {
    assertDeltaHash(delta);
    if (deltaIds.has(delta.deltaId)) {
      throw new Error(`角色记忆完整性发现重复增量 ID：${delta.deltaId}`);
    }
    if (idempotencyKeys.has(delta.idempotencyKey)) {
      throw new Error(`角色记忆完整性发现重复幂等键：${delta.idempotencyKey}`);
    }
    deltaIds.add(delta.deltaId);
    idempotencyKeys.add(delta.idempotencyKey);
    epochs.add(delta.sessionEpoch);
    namespaces.add(`${delta.sessionEpoch}\0${delta.namespace}`);
    memories.add(
      `${delta.sessionEpoch}\0${delta.namespace}\0${delta.memoryId}`,
    );
    const groupKey = `${delta.sessionEpoch}\0${delta.namespace}`;
    const group = groups.get(groupKey) ?? [];
    group.push(delta);
    groups.set(groupKey, group);
  }

  const projectionHashes = [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, group]) => {
      const first = group[0]!;
      return projectRoleMemory({
        sessionId,
        sessionEpoch: first.sessionEpoch,
        namespace: first.namespace,
        deltas: group,
      }).snapshotHash;
    })
    .sort(compareText);
  const progress = deltas.map((delta) => ({
    createdAt: delta.createdAt,
    deltaId: delta.deltaId,
    memoryId: delta.memoryId,
    operation: delta.operation,
    revision: delta.revision,
    sessionEpoch: delta.sessionEpoch,
  }));
  const sessionBindingHash = hashValue({ sessionId });
  const deltaCommitments = deltas.map((delta) => hashValue({
    domain: "ronggang.role-memory-delta-commitment.v1",
    sessionBindingHash,
    deltaHash: delta.deltaHash,
  })).sort(compareText);
  const base = {
    schemaVersion: RoleMemoryIntegritySchemaVersion,
    roleMemorySchemaVersion: RoleMemorySchemaVersion,
    policyVersion: AccessPolicyVersion,
    sessionBindingHash,
    epochCount: epochs.size,
    namespaceCount: namespaces.size,
    memoryCount: memories.size,
    deltaCount: deltas.length,
    deltaCommitments,
    progressAnchorHash: hashValue(progress),
    journalHash: hashValue(deltas),
    projectionRootHash: hashValue(projectionHashes),
  };
  return RoleMemoryIntegrityManifestSchema.parse({
    ...base,
    manifestHash: hashValue(base),
  });
}

export function projectRoleMemory(input: {
  sessionId: string;
  sessionEpoch: string;
  namespace: string;
  deltas: readonly RoleMemoryDelta[];
}): RoleMemorySnapshot {
  const matching = input.deltas
    .map((delta) => RoleMemoryDeltaSchema.parse(delta))
    .filter((delta) => (
      delta.sessionId === input.sessionId
      && delta.sessionEpoch === input.sessionEpoch
      && delta.namespace === input.namespace
    ))
    .sort((left, right) => (
      left.revision - right.revision
      || Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.deltaId.localeCompare(right.deltaId)
    ));
  const entries = new Map<string, RoleMemoryEntry>();
  for (const delta of matching) {
    assertDeltaHash(delta);
    const previous = entries.get(delta.memoryId);
    const expectedRevision = (previous?.revision ?? 0) + 1;
    if (delta.revision !== expectedRevision) {
      throw new Error(`角色记忆修订号不连续：${delta.memoryId}/${delta.revision}`);
    }
    if (delta.previousDeltaHash !== (previous?.lastDeltaHash ?? null)) {
      throw new Error(`角色记忆哈希链不连续：${delta.memoryId}/${delta.deltaId}`);
    }
    if (delta.operation !== "remember" && !previous) {
      throw new Error(`角色记忆更新缺少前序：${delta.memoryId}`);
    }
    const entry = RoleMemoryEntrySchema.parse({
      memoryId: delta.memoryId,
      namespace: delta.namespace,
      ownerActorId: delta.ownerActorId,
      ownerRoleId: delta.ownerRoleId,
      ownerTeamId: delta.ownerTeamId,
      kind: delta.kind,
      content: delta.content,
      contentHash: hashContent(delta.content),
      sourceEventIds: delta.sourceEventIds,
      revision: delta.revision,
      status: delta.operation === "forget" ? "forgotten" : "active",
      lastDeltaId: delta.deltaId,
      lastDeltaHash: delta.deltaHash,
      createdAt: previous?.createdAt ?? delta.createdAt,
      updatedAt: delta.createdAt,
      auditReadable: delta.auditReadable,
    });
    entries.set(delta.memoryId, entry);
  }
  const ordered = [...entries.values()].sort((left, right) => left.memoryId.localeCompare(right.memoryId));
  const snapshotBase = {
    schemaVersion: RoleMemorySchemaVersion,
    policyVersion: AccessPolicyVersion,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    namespace: input.namespace,
    projectionVersion: matching.length,
    entries: ordered,
  };
  return RoleMemorySnapshotSchema.parse({
    ...snapshotBase,
    snapshotHash: hashValue(snapshotBase),
  });
}

export class RoleMemoryService {
  readonly #store: RoleMemoryStore;

  constructor(store: RoleMemoryStore) {
    this.#store = store;
  }

  async append(subject: AccessSubject, rawDelta: RoleMemoryDelta): Promise<{ delta: RoleMemoryDelta; duplicate: boolean }> {
    const delta = RoleMemoryDeltaSchema.parse(rawDelta);
    assertDeltaHash(delta);
    const ownNamespace = roleMemoryNamespace({
      sessionId: subject.sessionId,
      sessionEpoch: subject.sessionEpoch,
      teamId: subject.teamId,
      actorId: subject.actorId,
    });
    const sameBoundary = (
      delta.sessionId === subject.sessionId
      && delta.sessionEpoch === subject.sessionEpoch
      && delta.ownerTeamId === subject.teamId
      && delta.ownerActorId === subject.actorId
      && delta.ownerRoleId === subject.roleId
      && delta.namespace === ownNamespace
      && delta.authorActorId === subject.actorId
    );
    const selfWrite = sameBoundary && subject.capabilities.includes("memory.write.own");
    const seedWrite = (
      subject.actorKind === "system"
      && subject.capabilities.includes("memory.seed")
      && delta.authorActorId === subject.actorId
    );
    const auditWrite = (
      subject.purpose === "audit"
      && subject.capabilities.includes("memory.audit.write")
      && delta.authorActorId === subject.actorId
    );
    if (!selfWrite && !seedWrite && !auditWrite) {
      throw new RoleMemoryAccessError("当前主体无权写入该角色私有记忆命名空间");
    }
    return this.#store.append(delta);
  }

  async read(subject: AccessSubject, input: {
    ownerActorId?: string;
    ownerRoleId?: RoleMemoryDelta["ownerRoleId"];
    ownerTeamId?: string;
    namespace?: string;
  } = {}): Promise<RoleMemorySnapshot> {
    const namespace = input.namespace ?? roleMemoryNamespace({
      sessionId: subject.sessionId,
      sessionEpoch: subject.sessionEpoch,
      teamId: subject.teamId,
      actorId: subject.actorId,
    });
    const ownRead = (
      namespace === roleMemoryNamespace({
        sessionId: subject.sessionId,
        sessionEpoch: subject.sessionEpoch,
        teamId: subject.teamId,
        actorId: subject.actorId,
      })
      && subject.capabilities.includes("memory.read.own")
    );
    const auditRead = subject.purpose === "audit" && subject.capabilities.includes("audit.read");
    if (!ownRead && !auditRead) {
      throw new RoleMemoryAccessError("当前主体无权读取该角色私有记忆命名空间");
    }
    const snapshot = projectRoleMemory({
      sessionId: subject.sessionId,
      sessionEpoch: subject.sessionEpoch,
      namespace,
      deltas: await this.#store.load(subject.sessionId),
    });
    if (auditRead) {
      const visibleEntries = snapshot.entries.filter((entry) => (
        entry.auditReadable
        && (input.ownerActorId === undefined || entry.ownerActorId === input.ownerActorId)
        && (input.ownerRoleId === undefined || entry.ownerRoleId === input.ownerRoleId)
        && (input.ownerTeamId === undefined || entry.ownerTeamId === input.ownerTeamId)
      ));
      const base = { ...snapshot, entries: visibleEntries };
      const { snapshotHash: _snapshotHash, ...withoutHash } = base;
      return RoleMemorySnapshotSchema.parse({
        ...withoutHash,
        snapshotHash: hashValue(withoutHash),
      });
    }
    return snapshot;
  }
}

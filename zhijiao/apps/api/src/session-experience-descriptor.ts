import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  DefaultSessionExperienceEntryRoute,
  SessionExperienceDescriptorSchema,
  SessionExperienceDescriptorSchemaVersion,
  sessionExperienceCapabilities,
  type CourseReleaseReference,
  type ScenarioReleaseReference,
  type SessionExperienceDescriptor,
  type SessionExperienceGeneration,
} from "@ronggang/contracts";

export type SessionExperienceDescriptorErrorCode =
  | "not_found"
  | "immutable_conflict"
  | "version_hash_drift"
  | "runtime_generation_drift";

export class SessionExperienceDescriptorError extends Error {
  constructor(
    readonly code: SessionExperienceDescriptorErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SessionExperienceDescriptorError";
  }
}

export interface SessionExperienceRuntimeSnapshot {
  sessionId: string;
  courseReleaseRef: CourseReleaseReference | null;
  scenarioReleaseRef: ScenarioReleaseReference;
  experienceGeneration: SessionExperienceGeneration;
}

export interface SessionExperienceDescriptorStore {
  get(sessionId: string): Promise<SessionExperienceDescriptor | null>;
  list(): Promise<SessionExperienceDescriptor[]>;
  create(
    descriptor: SessionExperienceDescriptor,
  ): Promise<"created" | "exists" | "conflict">;
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone(descriptor: SessionExperienceDescriptor): SessionExperienceDescriptor {
  return structuredClone(descriptor);
}

export class InMemorySessionExperienceDescriptorStore
implements SessionExperienceDescriptorStore {
  readonly #records = new Map<string, SessionExperienceDescriptor>();

  async get(sessionId: string): Promise<SessionExperienceDescriptor | null> {
    const descriptor = this.#records.get(sessionId);
    return descriptor ? clone(descriptor) : null;
  }

  async list(): Promise<SessionExperienceDescriptor[]> {
    return [...this.#records.values()]
      .toSorted((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map(clone);
  }

  async create(
    input: SessionExperienceDescriptor,
  ): Promise<"created" | "exists" | "conflict"> {
    const descriptor = SessionExperienceDescriptorSchema.parse(input);
    const existing = this.#records.get(descriptor.sessionId);
    if (existing) return equivalent(existing, descriptor) ? "exists" : "conflict";
    this.#records.set(descriptor.sessionId, clone(descriptor));
    return "created";
  }
}

const descriptorFrameSchema = z.object({
  kind: z.literal("session_experience_descriptor_created"),
  formatVersion: z.literal(1),
  descriptor: SessionExperienceDescriptorSchema,
}).strict();

const pathLocks = new Map<string, Promise<void>>();

async function readDescriptorFrames(path: string): Promise<SessionExperienceDescriptor[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];
  if (body.at(-1) !== 0x0a) {
    throw new Error("会话体验描述日志末尾帧不完整，拒绝恢复");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch (error) {
    throw new Error("会话体验描述日志不是有效 UTF-8", { cause: error });
  }
  const lines = text.split("\n");
  lines.pop();
  const records = new Map<string, SessionExperienceDescriptor>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`会话体验描述日志第 ${index + 1} 行为空帧`);
    }
    let descriptor: SessionExperienceDescriptor;
    try {
      descriptor = descriptorFrameSchema.parse(JSON.parse(line)).descriptor;
    } catch (error) {
      throw new Error(`会话体验描述日志第 ${index + 1} 行损坏`, { cause: error });
    }
    const existing = records.get(descriptor.sessionId);
    if (existing && !equivalent(existing, descriptor)) {
      throw new Error(`会话 ${descriptor.sessionId} 存在冲突的冻结体验描述`);
    }
    records.set(descriptor.sessionId, descriptor);
  }
  return [...records.values()];
}

export class JsonlSessionExperienceDescriptorStore
implements SessionExperienceDescriptorStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    pathLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (pathLocks.get(this.#path) === next) pathLocks.delete(this.#path);
    }
  }

  get(sessionId: string): Promise<SessionExperienceDescriptor | null> {
    return this.#withLock(async () => {
      const descriptor = (await readDescriptorFrames(this.#path)).find(
        (candidate) => candidate.sessionId === sessionId,
      );
      return descriptor ? clone(descriptor) : null;
    });
  }

  list(): Promise<SessionExperienceDescriptor[]> {
    return this.#withLock(async () => (await readDescriptorFrames(this.#path))
      .toSorted((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map(clone));
  }

  create(
    input: SessionExperienceDescriptor,
  ): Promise<"created" | "exists" | "conflict"> {
    const descriptor = SessionExperienceDescriptorSchema.parse(input);
    return this.#withLock(async () => {
      const existing = (await readDescriptorFrames(this.#path)).find(
        (candidate) => candidate.sessionId === descriptor.sessionId,
      );
      if (existing) return equivalent(existing, descriptor) ? "exists" : "conflict";
      await mkdir(dirname(this.#path), { recursive: true });
      const handle = await open(this.#path, "a");
      try {
        const frame = descriptorFrameSchema.parse({
          kind: "session_experience_descriptor_created",
          formatVersion: 1,
          descriptor,
        });
        await handle.writeFile(`${JSON.stringify(frame)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return "created";
    });
  }
}

function assertRuntimeMatches(
  descriptor: SessionExperienceDescriptor,
  snapshot: SessionExperienceRuntimeSnapshot,
): void {
  if (descriptor.sessionId !== snapshot.sessionId) {
    throw new SessionExperienceDescriptorError(
      "version_hash_drift",
      "会话体验描述与权威运行时的会话引用不一致",
      { descriptorSessionId: descriptor.sessionId, runtimeSessionId: snapshot.sessionId },
    );
  }
  if (!equivalent(descriptor.courseReleaseRef, snapshot.courseReleaseRef)
    || !equivalent(descriptor.scenarioReleaseRef, snapshot.scenarioReleaseRef)) {
    throw new SessionExperienceDescriptorError(
      "version_hash_drift",
      "会话体验描述与权威课程或情境发布引用发生漂移",
      {
        expectedCourseReleaseRef: descriptor.courseReleaseRef,
        actualCourseReleaseRef: snapshot.courseReleaseRef,
        expectedScenarioReleaseRef: descriptor.scenarioReleaseRef,
        actualScenarioReleaseRef: snapshot.scenarioReleaseRef,
      },
    );
  }
  if (descriptor.experienceGeneration !== snapshot.experienceGeneration) {
    throw new SessionExperienceDescriptorError(
      "runtime_generation_drift",
      "冻结体验代际与服务端组合根不一致",
      {
        expected: descriptor.experienceGeneration,
        actual: snapshot.experienceGeneration,
      },
    );
  }
}

export class SessionExperienceDescriptorService {
  constructor(
    readonly store: SessionExperienceDescriptorStore,
    readonly readRuntimeSnapshot: (
      sessionId: string,
    ) => Promise<SessionExperienceRuntimeSnapshot>,
  ) {}

  async freeze(
    input: SessionExperienceDescriptor,
  ): Promise<SessionExperienceDescriptor> {
    const descriptor = SessionExperienceDescriptorSchema.parse(input);
    assertRuntimeMatches(
      descriptor,
      await this.readRuntimeSnapshot(descriptor.sessionId),
    );
    const result = await this.store.create(descriptor);
    if (result === "conflict") {
      throw new SessionExperienceDescriptorError(
        "immutable_conflict",
        "该会话已经冻结另一份体验描述，拒绝覆盖",
        { sessionId: descriptor.sessionId },
      );
    }
    return clone(descriptor);
  }

  async get(sessionId: string): Promise<SessionExperienceDescriptor> {
    const descriptor = await this.store.get(sessionId);
    if (!descriptor) {
      throw new SessionExperienceDescriptorError(
        "not_found",
        "训练会话尚未冻结体验描述",
        { sessionId },
      );
    }
    assertRuntimeMatches(descriptor, await this.readRuntimeSnapshot(sessionId));
    return clone(descriptor);
  }

  async audit(): Promise<void> {
    for (const descriptor of await this.store.list()) {
      assertRuntimeMatches(
        descriptor,
        await this.readRuntimeSnapshot(descriptor.sessionId),
      );
    }
  }
}

export function buildSessionExperienceDescriptor(input: {
  sessionId: string;
  courseReleaseRef: CourseReleaseReference | null;
  scenarioReleaseRef: ScenarioReleaseReference;
  experienceGeneration: SessionExperienceGeneration;
  compatibility?: "current" | "historical";
  frozenAt: string;
}): SessionExperienceDescriptor {
  const descriptorId = `experience-${createHash("sha256")
    .update(JSON.stringify({
      sessionId: input.sessionId,
      courseReleaseRef: input.courseReleaseRef,
      scenarioReleaseRef: input.scenarioReleaseRef,
      experienceGeneration: input.experienceGeneration,
    }))
    .digest("hex")
    .slice(0, 24)}`;
  return SessionExperienceDescriptorSchema.parse({
    schemaVersion: SessionExperienceDescriptorSchemaVersion,
    descriptorId,
    sessionId: input.sessionId,
    courseReleaseRef: input.courseReleaseRef,
    scenarioReleaseRef: input.scenarioReleaseRef,
    experienceGeneration: input.experienceGeneration,
    capabilities: sessionExperienceCapabilities(input.experienceGeneration),
    entryRoute: DefaultSessionExperienceEntryRoute,
    compatibility: input.compatibility ?? "current",
    frozenAt: input.frozenAt,
  });
}

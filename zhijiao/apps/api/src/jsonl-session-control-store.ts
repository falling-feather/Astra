import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  InMemorySessionControlStore,
  type Classroom,
  type MembershipScope,
  type SessionControlStore,
  type SessionMembership,
  type SessionScope,
  type SessionStatusTransitionInput,
  type TeamInstance,
  type TeamScope,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import { z } from "zod";

const IsoDateSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "expected an ISO-compatible date",
);

const ClassroomSchema = z.object({
  classroomId: z.string().min(1),
  courseId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "archived"]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
}).strict();

const TeamInstanceSchema = z.object({
  teamId: z.string().min(1),
  classroomId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "archived"]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
}).strict();

const TrainingSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  classroomId: z.string().min(1),
  teamId: z.string().min(1),
  releaseId: z.string().min(1),
  status: z.enum([
    "provisioning",
    "active",
    "paused",
    "completed",
    "recovery_failed",
  ]),
  statusVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestedBy: z.string().min(1),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  activatedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  lastRecoveryErrorCode: z.string().nullable(),
  requiresExplicitStudentMembership: z.boolean().optional(),
}).strict();

const SessionMembershipSchema = z.object({
  membershipId: z.string().min(1),
  principalId: z.string().min(1),
  classroomId: z.string().min(1),
  teamId: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
  role: z.enum(["teacher", "student"]),
  actorId: z.string().min(1),
  status: z.enum(["active", "revoked"]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  revokedAt: IsoDateSchema.nullable(),
}).strict();

const SessionStatusTransitionInputSchema = z.object({
  sessionId: z.string().min(1),
  expectedStatus: z.enum([
    "provisioning",
    "active",
    "paused",
    "completed",
    "recovery_failed",
  ]),
  expectedStatusVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nextStatus: z.enum([
    "provisioning",
    "active",
    "paused",
    "completed",
    "recovery_failed",
  ]),
  updatedAt: IsoDateSchema,
  recoveryErrorCode: z.string().nullable().optional(),
}).strict();

const SessionControlFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("classroom_put"),
    record: ClassroomSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("team_put"),
    record: TeamInstanceSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("session_created"),
    requestId: z.string().min(1),
    record: TrainingSessionRecordSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("session_status_changed"),
    input: SessionStatusTransitionInputSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("membership_put"),
    record: SessionMembershipSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("membership_revoked"),
    membershipId: z.string().min(1),
    revokedAt: IsoDateSchema,
  }).strict(),
]);

type SessionControlFrame = z.infer<typeof SessionControlFrameSchema>;

const pathLocks = new Map<string, Promise<void>>();
const pathRevisions = new Map<string, number>();

export interface JsonlSessionControlStoreDiagnostics {
  fullReplayCount: number;
  replayedFrameCount: number;
  cacheHitCount: number;
}

async function appendAndSync(path: string, frame: SessionControlFrame): Promise<void> {
  const parsed = SessionControlFrameSchema.parse(frame);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendNewlineAndSync(path: string): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile("\n", "utf8");
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

function parseFrame(line: string, lineNumber: number): SessionControlFrame {
  try {
    return SessionControlFrameSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new Error(`会话控制日志第 ${lineNumber} 行损坏`, { cause: error });
  }
}

function decodeUtf8(bytes: Uint8Array, lineNumber: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`会话控制日志第 ${lineNumber} 行损坏：不是有效 UTF-8`, {
      cause: error,
    });
  }
}

async function readFrames(path: string): Promise<SessionControlFrame[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];

  const frames: SessionControlFrame[] = [];
  let lineStart = 0;
  let lineNumber = 1;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && body[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = decodeUtf8(body.subarray(lineStart, lineEnd), lineNumber);
    if (line.length === 0) {
      throw new Error(`会话控制日志第 ${lineNumber} 行损坏：不允许空帧`);
    }
    frames.push(parseFrame(line, lineNumber));
    lineStart = index + 1;
    lineNumber += 1;
  }

  if (lineStart === body.length) return frames;

  let tailFrame: SessionControlFrame;
  try {
    const tail = decodeUtf8(body.subarray(lineStart), lineNumber);
    tailFrame = parseFrame(tail, lineNumber);
  } catch {
    await truncateAndSync(path, lineStart);
    return frames;
  }
  frames.push(tailFrame);
  await appendNewlineAndSync(path);
  return frames;
}

async function replayFrame(
  store: InMemorySessionControlStore,
  frame: SessionControlFrame,
): Promise<void> {
  switch (frame.kind) {
    case "classroom_put":
      await store.putClassroom(frame.record);
      return;
    case "team_put":
      await store.putTeam(frame.record);
      return;
    case "session_created": {
      const { requiresExplicitStudentMembership, ...record } = frame.record;
      await store.createSession({
        ...record,
        ...(requiresExplicitStudentMembership !== undefined ? { requiresExplicitStudentMembership } : {}),
      }, frame.requestId);
      return;
    }
    case "session_status_changed":
      await store.compareAndSetSessionStatus({
        sessionId: frame.input.sessionId,
        expectedStatus: frame.input.expectedStatus,
        expectedStatusVersion: frame.input.expectedStatusVersion,
        nextStatus: frame.input.nextStatus,
        updatedAt: frame.input.updatedAt,
        ...(frame.input.recoveryErrorCode !== undefined
          ? { recoveryErrorCode: frame.input.recoveryErrorCode }
          : {}),
      });
      return;
    case "membership_put":
      await store.putMembership(frame.record);
      return;
    case "membership_revoked":
      await store.revokeMembership(frame.membershipId, frame.revokedAt);
  }
}

/**
 * Append-only JSONL adapter for the session-control port.
 *
 * Every mutation is recorded as a validated operation frame and replayed through
 * the in-memory reference implementation on open. A process-wide path lock makes
 * separate adapter instances observe one serial history. Frames are fsync'ed
 * before a successful mutation is returned.
 */
export class JsonlSessionControlStore implements SessionControlStore {
  readonly #path: string;
  #cachedStore: InMemorySessionControlStore | null = null;
  #cachedRevision = -1;
  readonly #diagnostics: JsonlSessionControlStoreDiagnostics = {
    fullReplayCount: 0,
    replayedFrameCount: 0,
    cacheHitCount: 0,
  };

  constructor(path: string) {
    this.#path = resolve(path);
  }

  getDiagnostics(): JsonlSessionControlStoreDiagnostics {
    return { ...this.#diagnostics };
  }

  putClassroom(record: Classroom): Promise<Classroom> {
    return this.withStore(async (store) => {
      const result = await store.putClassroom(record);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "classroom_put",
        record,
      });
      return result;
    }, true);
  }

  getClassroom(classroomId: string): Promise<Classroom | null> {
    return this.withStore((store) => store.getClassroom(classroomId));
  }

  listClassrooms(): Promise<Classroom[]> {
    return this.withStore((store) => store.listClassrooms());
  }

  putTeam(record: TeamInstance): Promise<TeamInstance> {
    return this.withStore(async (store) => {
      const result = await store.putTeam(record);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "team_put",
        record,
      });
      return result;
    }, true);
  }

  getTeam(teamId: string): Promise<TeamInstance | null> {
    return this.withStore((store) => store.getTeam(teamId));
  }

  listTeams(scope?: TeamScope): Promise<TeamInstance[]> {
    return this.withStore((store) => store.listTeams(scope));
  }

  createSession(
    record: TrainingSessionRecord,
    requestId: string,
  ): Promise<TrainingSessionRecord> {
    return this.withStore(async (store) => {
      const result = await store.createSession(record, requestId);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "session_created",
        requestId,
        record,
      });
      return result;
    }, true);
  }

  getSession(sessionId: string): Promise<TrainingSessionRecord | null> {
    return this.withStore((store) => store.getSession(sessionId));
  }

  listSessions(scope?: SessionScope): Promise<TrainingSessionRecord[]> {
    return this.withStore((store) => store.listSessions(scope));
  }

  compareAndSetSessionStatus(
    input: SessionStatusTransitionInput,
  ): Promise<TrainingSessionRecord> {
    return this.withStore(async (store) => {
      const result = await store.compareAndSetSessionStatus(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "session_status_changed",
        input,
      });
      return result;
    }, true);
  }

  listRecoverableSessions(
    scope?: Omit<SessionScope, "statuses">,
  ): Promise<TrainingSessionRecord[]> {
    return this.withStore((store) => store.listRecoverableSessions(scope));
  }

  putMembership(record: SessionMembership): Promise<SessionMembership> {
    return this.withStore(async (store) => {
      const result = await store.putMembership(record);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "membership_put",
        record,
      });
      return result;
    }, true);
  }

  getMembership(membershipId: string): Promise<SessionMembership | null> {
    return this.withStore((store) => store.getMembership(membershipId));
  }

  listMemberships(scope?: MembershipScope): Promise<SessionMembership[]> {
    return this.withStore((store) => store.listMemberships(scope));
  }

  revokeMembership(membershipId: string, revokedAt: string): Promise<SessionMembership> {
    return this.withStore(async (store) => {
      const result = await store.revokeMembership(membershipId, revokedAt);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "membership_revoked",
        membershipId,
        revokedAt,
      });
      return result;
    }, true);
  }

  private async loadStore(): Promise<InMemorySessionControlStore> {
    const frames = await readFrames(this.#path);
    const store = new InMemorySessionControlStore();
    for (const frame of frames) {
      await replayFrame(store, frame);
    }
    this.#diagnostics.fullReplayCount += 1;
    this.#diagnostics.replayedFrameCount += frames.length;
    return store;
  }

  private async withStore<T>(
    operation: (store: InMemorySessionControlStore) => Promise<T>,
    mutation = false,
  ): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    const run = async (): Promise<T> => {
      const revision = pathRevisions.get(this.#path) ?? 0;
      let store = this.#cachedStore;
      if (!store || this.#cachedRevision !== revision) {
        store = await this.loadStore();
        this.#cachedStore = store;
        this.#cachedRevision = revision;
      } else {
        this.#diagnostics.cacheHitCount += 1;
      }
      try {
        const value = await operation(store);
        if (mutation) {
          const nextRevision = revision + 1;
          pathRevisions.set(this.#path, nextRevision);
          this.#cachedRevision = nextRevision;
        }
        return value;
      } catch (error) {
        if (mutation) {
          // A failed fsync may leave a torn tail. Discard the speculative
          // in-memory mutation and advance the process-local generation so
          // every adapter reloads/repairs disk before its next operation.
          this.#cachedStore = null;
          this.#cachedRevision = -1;
          pathRevisions.set(this.#path, revision + 1);
        }
        throw error;
      }
    };
    const result = previous.then(
      run,
      run,
    );
    const next = result.then(() => undefined, () => undefined);
    pathLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (pathLocks.get(this.#path) === next) pathLocks.delete(this.#path);
    }
  }
}

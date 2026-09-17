import {
  RoleMemoryIntegrityManifestSchema,
} from "@ronggang/contracts";
import type {
  AgentTask,
  DeadLetterRecord,
  DispatchAttempt,
  OutboxRecord,
  RoleMemoryIntegrityManifest,
  ScenarioPackageRef,
  SessionTraceProjection,
  StateProjection,
  WorldEvent,
} from "@ronggang/contracts";
import type {
  MediaProcessingWorkAttempt,
  MediaProcessingWorkItem,
} from "@ronggang/media-processing";
import { z } from "zod";
import {
  SessionControlError,
  computeRecoveryCheckpointPayloadHash,
  createRecoveryCheckpoint,
  type RecoveryCheckpoint,
  type RecoveryCheckpointCatalog,
  type RecoveryCheckpointPayload,
  type TrainingSessionRecord,
} from "@ronggang/session-control";

export const SESSION_RECOVERY_INTEGRITY_SCHEMA =
  "ronggang.session-recovery-integrity.v2" as const;
const LEGACY_SESSION_RECOVERY_INTEGRITY_SCHEMA =
  "ronggang.session-recovery-integrity.v1" as const;
const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const legacyCountsSchema = z.object({
  events: z.number().int().nonnegative(),
  outbox: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  deadLetters: z.number().int().nonnegative(),
  mediaWorkItems: z.number().int().nonnegative(),
  mediaAttempts: z.number().int().nonnegative(),
  traceRecords: z.number().int().nonnegative(),
  traceLinks: z.number().int().nonnegative(),
}).strict();
const legacyComponentHashesSchema = z.object({
  session: integrityHashSchema,
  scenarioRelease: integrityHashSchema,
  worldEvents: integrityHashSchema,
  outbox: integrityHashSchema,
  tasks: integrityHashSchema,
  attempts: integrityHashSchema,
  deadLetters: integrityHashSchema,
  mediaWorkItems: integrityHashSchema,
  mediaAttempts: integrityHashSchema,
  teacherProjection: integrityHashSchema,
  teacherTrace: integrityHashSchema,
}).strict();
const legacyIntegrityPayloadSchema = z.object({
  schema: z.literal(LEGACY_SESSION_RECOVERY_INTEGRITY_SCHEMA),
  sessionId: z.string().min(1),
  anchorHash: integrityHashSchema,
  sessionStatusVersion: z.number().int().nonnegative(),
  worldStateVersion: z.number().int().nonnegative(),
  sessionEpoch: z.string().min(1),
  counts: legacyCountsSchema,
  componentHashes: legacyComponentHashesSchema,
}).strict();
const currentIntegrityPayloadSchema = legacyIntegrityPayloadSchema.extend({
  schema: z.literal(SESSION_RECOVERY_INTEGRITY_SCHEMA),
  counts: legacyCountsSchema.extend({
    roleMemoryDeltas: z.number().int().nonnegative(),
    referencedObjects: z.number().int().nonnegative(),
  }).strict(),
  componentHashes: legacyComponentHashesSchema.extend({
    roleMemory: integrityHashSchema,
    referencedObjects: integrityHashSchema,
  }).strict(),
  progressCommitments: z.object({
    roleMemory: z.array(integrityHashSchema),
    referencedObjects: z.array(integrityHashSchema),
  }).strict(),
}).strict();

export interface ReferencedObjectIntegrity {
  count: number;
  commitments: string[];
  integrityHash: string;
}

export type RecoveryCheckpointObservationStatus =
  | "missing"
  | "verified"
  | "stale"
  | "mismatch";

export interface SessionRecoveryIntegrityPayload {
  schema: typeof SESSION_RECOVERY_INTEGRITY_SCHEMA;
  sessionId: string;
  anchorHash: string;
  sessionStatusVersion: number;
  worldStateVersion: number;
  sessionEpoch: string;
  counts: {
    events: number;
    outbox: number;
    tasks: number;
    attempts: number;
    deadLetters: number;
    mediaWorkItems: number;
    mediaAttempts: number;
    traceRecords: number;
    traceLinks: number;
    roleMemoryDeltas: number;
    referencedObjects: number;
  };
  componentHashes: {
    session: string;
    scenarioRelease: string;
    worldEvents: string;
    outbox: string;
    tasks: string;
    attempts: string;
    deadLetters: string;
    mediaWorkItems: string;
    mediaAttempts: string;
    teacherProjection: string;
    teacherTrace: string;
    roleMemory: string;
    referencedObjects: string;
  };
  progressCommitments: {
    roleMemory: string[];
    referencedObjects: string[];
  };
}

export interface SessionRecoveryCaptureInput {
  session: TrainingSessionRecord;
  scenarioRelease: ScenarioPackageRef;
  projection: StateProjection;
  events: readonly WorldEvent[];
  outboxRecords: readonly OutboxRecord[];
  tasks: readonly AgentTask[];
  attempts: readonly DispatchAttempt[];
  deadLetters: readonly DeadLetterRecord[];
  mediaWorkItems: readonly MediaProcessingWorkItem[];
  mediaAttempts: readonly MediaProcessingWorkAttempt[];
  trace: SessionTraceProjection;
  roleMemoryIntegrity: RoleMemoryIntegrityManifest;
  referencedObjectIntegrity: ReferencedObjectIntegrity;
}

export interface RecoveryCheckpointObservation {
  status: RecoveryCheckpointObservationStatus;
  sessionId: string;
  checkedAt: string;
  checkpointCreatedAt: string | null;
  sourceRevision: number | null;
  sourceSequence: number | null;
  worldStateVersion: number;
  payloadHash: string;
  checkpointPayloadHash: string | null;
}

export interface RecoveryCheckpointHealthSummary {
  total: number;
  missing: number;
  verified: number;
  stale: number;
  mismatch: number;
  latestVerifiedAt: string | null;
}

export interface SessionRecoveryCheckpointCoordinatorOptions {
  catalog: RecoveryCheckpointCatalog;
  capture: (sessionId: string) => Promise<SessionRecoveryIntegrityPayload>;
  now?: () => string;
  stableReadAttempts?: number;
}

function compareString(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function jsonValue(value: unknown): RecoveryCheckpointPayload {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new SessionControlError(
      "checkpoint_invalid",
      "恢复检查点包含不可序列化的数据",
    );
  }
  return JSON.parse(serialized) as RecoveryCheckpointPayload;
}

function hash(value: unknown): string {
  return computeRecoveryCheckpointPayloadHash(jsonValue(value));
}

function sortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareString(key(left), key(right)));
}

function isCanonicalCommitmentSet(values: readonly string[]): boolean {
  return values.every((value, index) => (
    index === 0 || values[index - 1]! < value
  ));
}

function isCommitmentSubset(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  const currentSet = new Set(current);
  return previous.every((commitment) => currentSet.has(commitment));
}

export function buildStableProjectionPayload(
  projection: StateProjection,
): RecoveryCheckpointPayload {
  const {
    messageId: _messageId,
    correlationId: _correlationId,
    timestamp: _timestamp,
    // The guide is derived entirely from the immutable scenario release and
    // is already covered by scenario.contentHash. Omitting it keeps the
    // projection commitment compatible with pre-guide V0.7.0 checkpoints.
    courseGuide: _courseGuide,
    ...state
  } = projection;
  return jsonValue(state);
}

function anchorFor(input: SessionRecoveryCaptureInput): RecoveryCheckpointPayload {
  return jsonValue({
    sessionStatusVersion: input.session.statusVersion,
    world: input.events.map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      stateVersion: event.stateVersion,
      timestamp: event.timestamp,
    })),
    outbox: sortBy(input.outboxRecords, (record) => record.outboxId).map(
      (record) => ({
        outboxId: record.outboxId,
        eventId: record.eventId,
        status: record.status,
        attempts: record.attempts,
        availableAt: record.availableAt,
        deliveredAt: record.deliveredAt,
      }),
    ),
    tasks: sortBy(input.tasks, (task) => task.taskId).map((task) => ({
      taskId: task.taskId,
      status: task.status,
      attempts: task.attempts,
      availableAt: task.availableAt,
      completedAt: task.completedAt,
      lastErrorCode: task.lastErrorCode,
    })),
    attempts: sortBy(input.attempts, (attempt) => attempt.attemptId).map(
      (attempt) => ({
        attemptId: attempt.attemptId,
        taskId: attempt.taskId,
        outcome: attempt.outcome,
        completedAt: attempt.completedAt,
      }),
    ),
    deadLetters: sortBy(
      input.deadLetters,
      (record) => record.deadLetterId,
    ).map((record) => ({
      deadLetterId: record.deadLetterId,
      taskId: record.taskId,
      reasonCode: record.reasonCode,
      createdAt: record.createdAt,
    })),
    mediaWorkItems: sortBy(
      input.mediaWorkItems,
      (item) => item.workItemId,
    ).map((item) => ({
      workItemId: item.workItemId,
      taskId: item.taskId,
      stepId: item.stepId,
      status: item.status,
      attemptNumber: item.attemptNumber,
      claimCount: item.claimCount,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      lastErrorCode: item.lastErrorCode,
    })),
    mediaAttempts: sortBy(
      input.mediaAttempts,
      (attempt) => attempt.attemptId,
    ).map((attempt) => ({
      attemptId: attempt.attemptId,
      workItemId: attempt.workItemId,
      outcome: attempt.outcome,
      completedAt: attempt.completedAt,
    })),
  });
}

function tracePayload(trace: SessionTraceProjection): RecoveryCheckpointPayload {
  return jsonValue({
    sessionId: trace.sessionId,
    stateVersion: trace.stateVersion,
    records: sortBy(trace.records, (record) => record.traceId),
    links: sortBy(trace.links, (link) => link.linkId),
    summary: trace.summary,
  });
}

export function buildSessionRecoveryIntegrityPayload(
  input: SessionRecoveryCaptureInput,
): SessionRecoveryIntegrityPayload {
  const roleMemoryIntegrity = RoleMemoryIntegrityManifestSchema.parse(
    input.roleMemoryIntegrity,
  );
  const {
    manifestHash: _manifestHash,
    ...roleMemoryManifestBase
  } = roleMemoryIntegrity;
  if (hash(roleMemoryManifestBase) !== roleMemoryIntegrity.manifestHash) {
    throw new SessionControlError(
      "checkpoint_invalid",
      "角色私有记忆完整性清单自身哈希不匹配",
      { controlSessionId: input.session.sessionId },
    );
  }
  if (
    roleMemoryIntegrity.deltaCommitments.length
      !== roleMemoryIntegrity.deltaCount
    || !isCanonicalCommitmentSet(roleMemoryIntegrity.deltaCommitments)
    || input.referencedObjectIntegrity.commitments.length
      !== input.referencedObjectIntegrity.count
    || !isCanonicalCommitmentSet(
      input.referencedObjectIntegrity.commitments,
    )
  ) {
    throw new SessionControlError(
      "checkpoint_invalid",
      "记忆或对象完整性成员承诺不是规范唯一集合",
      { controlSessionId: input.session.sessionId },
    );
  }
  if (input.session.sessionId !== input.projection.sessionId) {
    throw new SessionControlError(
      "checkpoint_session_mismatch",
      "控制面会话与世界投影会话不一致",
      {
        controlSessionId: input.session.sessionId,
        projectionSessionId: input.projection.sessionId,
      },
    );
  }
  if (input.trace.sessionId !== input.session.sessionId) {
    throw new SessionControlError(
      "checkpoint_session_mismatch",
      "控制面会话与追踪投影会话不一致",
      {
        controlSessionId: input.session.sessionId,
        traceSessionId: input.trace.sessionId,
      },
    );
  }
  if (
    roleMemoryIntegrity.sessionBindingHash
    !== hash({ sessionId: input.session.sessionId })
  ) {
    throw new SessionControlError(
      "checkpoint_session_mismatch",
      "控制面会话与角色私有记忆完整性绑定不一致",
      { controlSessionId: input.session.sessionId },
    );
  }
  const lastStateVersion = input.events.at(-1)?.stateVersion ?? 0;
  if (
    lastStateVersion !== input.projection.stateVersion
    || input.trace.stateVersion !== input.projection.stateVersion
  ) {
    throw new SessionControlError(
      "checkpoint_source_conflict",
      "世界日志、角色投影与追踪投影没有落在同一状态版本",
      {
        eventStateVersion: lastStateVersion,
        projectionStateVersion: input.projection.stateVersion,
        traceStateVersion: input.trace.stateVersion,
      },
    );
  }

  const events = [...input.events];
  const outboxRecords = sortBy(input.outboxRecords, (record) => record.outboxId);
  const tasks = sortBy(input.tasks, (task) => task.taskId);
  const attempts = sortBy(input.attempts, (attempt) => attempt.attemptId);
  const deadLetters = sortBy(
    input.deadLetters,
    (record) => record.deadLetterId,
  );
  const mediaWorkItems = sortBy(
    input.mediaWorkItems,
    (item) => item.workItemId,
  );
  const mediaAttempts = sortBy(
    input.mediaAttempts,
    (attempt) => attempt.attemptId,
  );

  return {
    schema: SESSION_RECOVERY_INTEGRITY_SCHEMA,
    sessionId: input.session.sessionId,
    anchorHash: hash(anchorFor(input)),
    sessionStatusVersion: input.session.statusVersion,
    worldStateVersion: input.projection.stateVersion,
    sessionEpoch: input.projection.sessionEpoch,
    counts: {
      events: events.length,
      outbox: outboxRecords.length,
      tasks: tasks.length,
      attempts: attempts.length,
      deadLetters: deadLetters.length,
      mediaWorkItems: mediaWorkItems.length,
      mediaAttempts: mediaAttempts.length,
      traceRecords: input.trace.records.length,
      traceLinks: input.trace.links.length,
      roleMemoryDeltas: roleMemoryIntegrity.deltaCount,
      referencedObjects: input.referencedObjectIntegrity.count,
    },
    componentHashes: {
      session: hash(input.session),
      scenarioRelease: hash(input.scenarioRelease),
      worldEvents: hash(events),
      outbox: hash(outboxRecords),
      tasks: hash(tasks),
      attempts: hash(attempts),
      deadLetters: hash(deadLetters),
      mediaWorkItems: hash(mediaWorkItems),
      mediaAttempts: hash(mediaAttempts),
      teacherProjection: hash(buildStableProjectionPayload(input.projection)),
      teacherTrace: hash(tracePayload(input.trace)),
      roleMemory: roleMemoryIntegrity.manifestHash,
      referencedObjects: input.referencedObjectIntegrity.integrityHash,
    },
    progressCommitments: {
      roleMemory: [...roleMemoryIntegrity.deltaCommitments],
      referencedObjects: [
        ...input.referencedObjectIntegrity.commitments,
      ],
    },
  };
}

interface LegacySessionRecoveryIntegrityPayload {
  schema: typeof LEGACY_SESSION_RECOVERY_INTEGRITY_SCHEMA;
  sessionId: string;
  anchorHash: string;
  sessionStatusVersion: number;
  worldStateVersion: number;
  sessionEpoch: string;
  counts: Omit<
    SessionRecoveryIntegrityPayload["counts"],
    "roleMemoryDeltas" | "referencedObjects"
  >;
  componentHashes: Omit<
    SessionRecoveryIntegrityPayload["componentHashes"],
    "roleMemory" | "referencedObjects"
  >;
}

function legacyCompatiblePayload(
  current: SessionRecoveryIntegrityPayload,
): LegacySessionRecoveryIntegrityPayload {
  const {
    roleMemoryDeltas: _roleMemoryDeltas,
    referencedObjects: _referencedObjects,
    ...counts
  } = current.counts;
  const {
    roleMemory: _roleMemory,
    referencedObjects: _referencedObjectHash,
    ...componentHashes
  } = current.componentHashes;
  return {
    schema: LEGACY_SESSION_RECOVERY_INTEGRITY_SCHEMA,
    sessionId: current.sessionId,
    anchorHash: current.anchorHash,
    sessionStatusVersion: current.sessionStatusVersion,
    worldStateVersion: current.worldStateVersion,
    sessionEpoch: current.sessionEpoch,
    counts,
    componentHashes,
  };
}

function parseIntegrityPayload(
  value: RecoveryCheckpointPayload,
):
  | z.infer<typeof currentIntegrityPayloadSchema>
  | z.infer<typeof legacyIntegrityPayloadSchema>
  | null {
  const current = currentIntegrityPayloadSchema.safeParse(value);
  const legacy = current.success
    ? null
    : legacyIntegrityPayloadSchema.safeParse(value);
  const candidate = current.success
    ? current.data
    : legacy?.success
      ? legacy.data
      : null;
  if (!candidate) return null;
  return candidate;
}

function observation(
  status: RecoveryCheckpointObservationStatus,
  sessionId: string,
  checkedAt: string,
  current: SessionRecoveryIntegrityPayload,
  checkpoint: RecoveryCheckpoint | null,
): RecoveryCheckpointObservation {
  return {
    status,
    sessionId,
    checkedAt,
    checkpointCreatedAt: checkpoint?.createdAt ?? null,
    sourceRevision: checkpoint?.sourceRevision ?? null,
    sourceSequence: checkpoint?.sourceSequence ?? null,
    worldStateVersion: current.worldStateVersion,
    payloadHash: hash(current),
    checkpointPayloadHash: checkpoint?.payloadHash ?? null,
  };
}

export function classifyRecoveryCheckpoint(
  checkpoint: RecoveryCheckpoint | null,
  current: SessionRecoveryIntegrityPayload,
  checkedAt: string,
): RecoveryCheckpointObservation {
  if (!checkpoint) {
    return observation("missing", current.sessionId, checkedAt, current, null);
  }
  if (checkpoint.sessionId !== current.sessionId) {
    throw new SessionControlError(
      "checkpoint_session_mismatch",
      "恢复检查点属于其他会话",
      {
        actualSessionId: checkpoint.sessionId,
        expectedSessionId: current.sessionId,
      },
    );
  }
  const currentHash = hash(current);
  if (checkpoint.payloadHash === currentHash) {
    return observation(
      "verified",
      current.sessionId,
      checkedAt,
      current,
      checkpoint,
    );
  }
  const previous = parseIntegrityPayload(checkpoint.payload);
  if (!previous) {
    return observation(
      "mismatch",
      current.sessionId,
      checkedAt,
      current,
      checkpoint,
    );
  }
  if (
    previous.schema === LEGACY_SESSION_RECOVERY_INTEGRITY_SCHEMA
    && checkpoint.payloadHash === hash(legacyCompatiblePayload(current))
  ) {
    return observation(
      "stale",
      current.sessionId,
      checkedAt,
      current,
      checkpoint,
    );
  }
  if (
    previous.schema === SESSION_RECOVERY_INTEGRITY_SCHEMA
    && previous.anchorHash !== current.anchorHash
    && (
      !isCanonicalCommitmentSet(
        previous.progressCommitments.roleMemory,
      )
      || !isCanonicalCommitmentSet(
        previous.progressCommitments.referencedObjects,
      )
      || !isCommitmentSubset(
        previous.progressCommitments.roleMemory,
        current.progressCommitments.roleMemory,
      )
      || !isCommitmentSubset(
        previous.progressCommitments.referencedObjects,
        current.progressCommitments.referencedObjects,
      )
    )
  ) {
    return observation(
      "mismatch",
      current.sessionId,
      checkedAt,
      current,
      checkpoint,
    );
  }
  return observation(
    previous.anchorHash === current.anchorHash ? "mismatch" : "stale",
    current.sessionId,
    checkedAt,
    current,
    checkpoint,
  );
}

export class SessionRecoveryCheckpointCoordinator {
  readonly #catalog: RecoveryCheckpointCatalog;
  readonly #capture: (
    sessionId: string,
  ) => Promise<SessionRecoveryIntegrityPayload>;
  readonly #now: () => string;
  readonly #stableReadAttempts: number;
  readonly #observations = new Map<string, RecoveryCheckpointObservation>();

  constructor(options: SessionRecoveryCheckpointCoordinatorOptions) {
    this.#catalog = options.catalog;
    this.#capture = options.capture;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#stableReadAttempts = Math.max(
      2,
      Math.min(10, Math.floor(options.stableReadAttempts ?? 3)),
    );
  }

  getObservation(sessionId: string): RecoveryCheckpointObservation | null {
    const value = this.#observations.get(sessionId);
    return value ? structuredClone(value) : null;
  }

  summarize(sessionIds: readonly string[]): RecoveryCheckpointHealthSummary {
    const summary: RecoveryCheckpointHealthSummary = {
      total: 0,
      missing: 0,
      verified: 0,
      stale: 0,
      mismatch: 0,
      latestVerifiedAt: null,
    };
    for (const sessionId of [...new Set(sessionIds)].sort(compareString)) {
      summary.total += 1;
      const current = this.#observations.get(sessionId);
      const status = current?.status ?? "missing";
      summary[status] += 1;
      if (
        status === "verified"
        && current?.checkedAt
        && (
          summary.latestVerifiedAt === null
          || Date.parse(current.checkedAt) > Date.parse(summary.latestVerifiedAt)
        )
      ) {
        summary.latestVerifiedAt = current.checkedAt;
      }
    }
    return summary;
  }

  async inspect(sessionId: string): Promise<RecoveryCheckpointObservation> {
    const [checkpoint, current] = await Promise.all([
      this.#catalog.loadLatest(sessionId),
      this.captureStable(sessionId),
    ]);
    this.assertSourceNotRegressed(sessionId, checkpoint, current);
    const result = classifyRecoveryCheckpoint(
      checkpoint,
      current,
      this.#now(),
    );
    this.#observations.set(sessionId, result);
    return structuredClone(result);
  }

  async record(sessionId: string): Promise<RecoveryCheckpointObservation> {
    const current = await this.captureStable(sessionId);
    const latest = await this.#catalog.loadLatest(sessionId);
    this.assertSourceNotRegressed(sessionId, latest, current);
    const checkedAt = this.#now();
    const classified = classifyRecoveryCheckpoint(latest, current, checkedAt);
    if (classified.status === "verified") {
      this.#observations.set(sessionId, classified);
      return structuredClone(classified);
    }
    if (classified.status === "mismatch") {
      this.#observations.set(sessionId, classified);
      throw new SessionControlError(
        "checkpoint_tampered",
        "检查点锚点未变化，但恢复内容哈希已变化",
        {
          sessionId,
          checkpointPayloadHash: classified.checkpointPayloadHash,
          currentPayloadHash: classified.payloadHash,
        },
      );
    }
    const sourceSequence = (latest?.sourceSequence ?? -1) + 1;
    if (!Number.isSafeInteger(sourceSequence)) {
      throw new SessionControlError(
        "checkpoint_source_conflict",
        "恢复检查点序号超出安全整数范围",
        { sessionId },
      );
    }
    const saved = await this.#catalog.save(createRecoveryCheckpoint({
      sessionId,
      sourceRevision: current.sessionStatusVersion,
      sourceSequence,
      createdAt: checkedAt,
      payload: current,
    }));
    const result = classifyRecoveryCheckpoint(
      saved,
      current,
      this.#now(),
    );
    this.#observations.set(sessionId, result);
    return structuredClone(result);
  }

  private assertSourceNotRegressed(
    sessionId: string,
    checkpoint: RecoveryCheckpoint | null,
    current: SessionRecoveryIntegrityPayload,
  ): void {
    if (
      !checkpoint
      || current.sessionStatusVersion >= checkpoint.sourceRevision
    ) {
      return;
    }
    throw new SessionControlError(
      "checkpoint_source_conflict",
      "控制面状态版本早于最后一个已验证检查点",
      {
        sessionId,
        currentStatusVersion: current.sessionStatusVersion,
        checkpointStatusVersion: checkpoint.sourceRevision,
      },
    );
  }

  private async captureStable(
    sessionId: string,
  ): Promise<SessionRecoveryIntegrityPayload> {
    let previous: SessionRecoveryIntegrityPayload | null = null;
    let previousHash: string | null = null;
    for (let attempt = 0; attempt < this.#stableReadAttempts; attempt += 1) {
      const current = await this.#capture(sessionId);
      const currentHash = hash(current);
      if (previous && previousHash === currentHash) return current;
      previous = current;
      previousHash = currentHash;
    }
    throw new SessionControlError(
      "checkpoint_source_conflict",
      "在线检查点读取期间会话持续变化，请稍后重试",
      {
        sessionId,
        stableReadAttempts: this.#stableReadAttempts,
      },
    );
  }
}

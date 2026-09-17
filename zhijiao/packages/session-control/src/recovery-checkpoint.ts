import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { SessionControlError } from "./errors.js";

export const RECOVERY_CHECKPOINT_SCHEMA = "ronggang.session-recovery-checkpoint";
export const RECOVERY_CHECKPOINT_VERSION = 1;
export const RECOVERY_CHECKPOINT_HASH_ALGORITHM = "sha256";

export type RecoveryCheckpointPayload =
  | null
  | boolean
  | number
  | string
  | RecoveryCheckpointPayload[]
  | { [key: string]: RecoveryCheckpointPayload };

export interface RecoveryCheckpoint {
  schema: typeof RECOVERY_CHECKPOINT_SCHEMA;
  version: typeof RECOVERY_CHECKPOINT_VERSION;
  sessionId: string;
  sourceRevision: number;
  sourceSequence: number;
  createdAt: string;
  payload: RecoveryCheckpointPayload;
  payloadHash: string;
}

export interface CreateRecoveryCheckpointInput {
  sessionId: string;
  sourceRevision: number;
  sourceSequence: number;
  createdAt: string;
  payload: unknown;
}

export interface RecoveryCheckpointCatalog {
  save(checkpoint: unknown): Promise<RecoveryCheckpoint>;
  loadLatest(sessionId: string): Promise<RecoveryCheckpoint | null>;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CHECKPOINT_FILE_PATTERN =
  /^([a-f0-9]{64})-r(\d{16})-s(\d{16})-([a-f0-9]{64})\.checkpoint\.json$/u;
const REQUIRED_CHECKPOINT_KEYS = [
  "createdAt",
  "payload",
  "payloadHash",
  "schema",
  "sessionId",
  "sourceRevision",
  "sourceSequence",
  "version",
] as const;
const pathLocks = new Map<string, Promise<void>>();

function checkpointError(
  code:
    | "checkpoint_invalid"
    | "checkpoint_tampered"
    | "checkpoint_session_mismatch"
    | "checkpoint_version_unsupported"
    | "checkpoint_source_conflict"
    | "checkpoint_io_error",
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): SessionControlError {
  return new SessionControlError(code, message, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizePayload(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): RecoveryCheckpointPayload {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw checkpointError(
        "checkpoint_invalid",
        `Checkpoint payload contains a non-finite number at ${path}.`,
        { path },
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw checkpointError(
      "checkpoint_invalid",
      `Checkpoint payload contains a non-JSON value at ${path}.`,
      { path, valueType: typeof value },
    );
  }
  if (ancestors.has(value)) {
    throw checkpointError(
      "checkpoint_invalid",
      `Checkpoint payload contains a cycle at ${path}.`,
      { path },
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const normalized: RecoveryCheckpointPayload[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw checkpointError(
            "checkpoint_invalid",
            `Checkpoint payload contains a sparse array entry at ${path}[${index}].`,
            { path: `${path}[${index}]` },
          );
        }
        normalized.push(normalizePayload(value[index], `${path}[${index}]`, ancestors));
      }
      return normalized;
    }
    if (!isPlainObject(value)) {
      throw checkpointError(
        "checkpoint_invalid",
        `Checkpoint payload contains a non-plain object at ${path}.`,
        { path },
      );
    }

    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (symbolKeys.length > 0) {
      throw checkpointError(
        "checkpoint_invalid",
        `Checkpoint payload contains symbol keys at ${path}.`,
        { path },
      );
    }
    const entries = Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [
        key,
        normalizePayload(value[key], `${path}.${key}`, ancestors),
      ] as const);
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

function normalizedPayload(value: unknown): RecoveryCheckpointPayload {
  return normalizePayload(value, "$", new WeakSet<object>());
}

function canonicalPayloadJson(value: unknown): string {
  return JSON.stringify(normalizedPayload(value));
}

function canonicalCheckpointJson(checkpoint: RecoveryCheckpoint): string {
  return JSON.stringify({
    createdAt: checkpoint.createdAt,
    payload: checkpoint.payload,
    payloadHash: checkpoint.payloadHash,
    schema: checkpoint.schema,
    sessionId: checkpoint.sessionId,
    sourceRevision: checkpoint.sourceRevision,
    sourceSequence: checkpoint.sourceSequence,
    version: checkpoint.version,
  });
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw checkpointError(
      "checkpoint_invalid",
      `Checkpoint ${field} must be a non-empty string.`,
      { field },
    );
  }
}

function assertSourceNumber(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw checkpointError(
      "checkpoint_invalid",
      `Checkpoint ${field} must be a non-negative safe integer.`,
      { field, value },
    );
  }
}

function assertCreatedAt(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw checkpointError(
      "checkpoint_invalid",
      "Checkpoint createdAt must be a canonical ISO-8601 instant.",
      { field: "createdAt", value },
    );
  }
}

function assertExactCheckpointKeys(value: Record<string, unknown>): void {
  const keys = Object.keys(value).sort();
  const expected = [...REQUIRED_CHECKPOINT_KEYS].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    throw checkpointError(
      "checkpoint_invalid",
      "Checkpoint envelope has missing or unsupported fields.",
      { actualKeys: keys, expectedKeys: expected },
    );
  }
}

export function computeRecoveryCheckpointPayloadHash(payload: unknown): string {
  return createHash(RECOVERY_CHECKPOINT_HASH_ALGORITHM)
    .update(canonicalPayloadJson(payload), "utf8")
    .digest("hex");
}

export function createRecoveryCheckpoint(
  input: CreateRecoveryCheckpointInput,
): RecoveryCheckpoint {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertSourceNumber(input.sourceRevision, "sourceRevision");
  assertSourceNumber(input.sourceSequence, "sourceSequence");
  assertCreatedAt(input.createdAt);
  const payload = normalizedPayload(input.payload);
  return {
    schema: RECOVERY_CHECKPOINT_SCHEMA,
    version: RECOVERY_CHECKPOINT_VERSION,
    sessionId: input.sessionId,
    sourceRevision: input.sourceRevision,
    sourceSequence: input.sourceSequence,
    createdAt: input.createdAt,
    payload,
    payloadHash: computeRecoveryCheckpointPayloadHash(payload),
  };
}

export function verifyRecoveryCheckpoint(
  value: unknown,
  expectedSessionId?: string,
): RecoveryCheckpoint {
  if (!isPlainObject(value)) {
    throw checkpointError(
      "checkpoint_invalid",
      "Checkpoint must be a plain JSON object.",
    );
  }
  if (value.schema !== RECOVERY_CHECKPOINT_SCHEMA) {
    throw checkpointError(
      "checkpoint_invalid",
      "Checkpoint schema is not recognized.",
      { actualSchema: value.schema, expectedSchema: RECOVERY_CHECKPOINT_SCHEMA },
    );
  }
  if (value.version !== RECOVERY_CHECKPOINT_VERSION) {
    throw checkpointError(
      "checkpoint_version_unsupported",
      "Checkpoint version is not supported.",
      { actualVersion: value.version, supportedVersion: RECOVERY_CHECKPOINT_VERSION },
    );
  }
  assertExactCheckpointKeys(value);
  assertNonEmptyString(value.sessionId, "sessionId");
  if (expectedSessionId !== undefined && value.sessionId !== expectedSessionId) {
    throw checkpointError(
      "checkpoint_session_mismatch",
      "Checkpoint belongs to a different session.",
      { actualSessionId: value.sessionId, expectedSessionId },
    );
  }
  assertSourceNumber(value.sourceRevision, "sourceRevision");
  assertSourceNumber(value.sourceSequence, "sourceSequence");
  assertCreatedAt(value.createdAt);
  if (typeof value.payloadHash !== "string" || !HASH_PATTERN.test(value.payloadHash)) {
    throw checkpointError(
      "checkpoint_invalid",
      "Checkpoint payloadHash must be a lowercase SHA-256 digest.",
      { field: "payloadHash" },
    );
  }
  const payload = normalizedPayload(value.payload);
  const actualHash = computeRecoveryCheckpointPayloadHash(payload);
  if (actualHash !== value.payloadHash) {
    throw checkpointError(
      "checkpoint_tampered",
      "Checkpoint payload hash verification failed.",
      { actualHash, expectedHash: value.payloadHash },
    );
  }
  return {
    schema: RECOVERY_CHECKPOINT_SCHEMA,
    version: RECOVERY_CHECKPOINT_VERSION,
    sessionId: value.sessionId,
    sourceRevision: value.sourceRevision,
    sourceSequence: value.sourceSequence,
    createdAt: value.createdAt,
    payload,
    payloadHash: value.payloadHash,
  };
}

function sessionFingerprint(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

function checkpointFileName(checkpoint: RecoveryCheckpoint): string {
  return [
    sessionFingerprint(checkpoint.sessionId),
    `r${checkpoint.sourceRevision.toString().padStart(16, "0")}`,
    `s${checkpoint.sourceSequence.toString().padStart(16, "0")}`,
    checkpoint.payloadHash,
  ].join("-") + ".checkpoint.json";
}

function compareSource(
  left: Pick<RecoveryCheckpoint, "sourceRevision" | "sourceSequence">,
  right: Pick<RecoveryCheckpoint, "sourceRevision" | "sourceSequence">,
): number {
  if (left.sourceRevision !== right.sourceRevision) {
    return left.sourceRevision - right.sourceRevision;
  }
  return left.sourceSequence - right.sourceSequence;
}

async function withPathLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = pathLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prior.then(() => current);
  pathLocks.set(key, chain);
  await prior;
  try {
    return await operation();
  } finally {
    release?.();
    if (pathLocks.get(key) === chain) pathLocks.delete(key);
  }
}

async function syncDirectoryEntryBestEffort(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (
      ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export class LocalRecoveryCheckpointCatalog implements RecoveryCheckpointCatalog {
  constructor(private readonly directory: string) {
    if (directory.trim().length === 0) {
      throw checkpointError(
        "checkpoint_invalid",
        "Checkpoint directory must be non-empty.",
      );
    }
  }

  async write(input: CreateRecoveryCheckpointInput): Promise<RecoveryCheckpoint> {
    return this.save(createRecoveryCheckpoint(input));
  }

  async save(value: unknown): Promise<RecoveryCheckpoint> {
    const checkpoint = verifyRecoveryCheckpoint(value);
    return withPathLock(
      `${this.directory}\0${checkpoint.sessionId}`,
      async () => this.saveUnlocked(checkpoint),
    );
  }

  async loadLatest(sessionId: string): Promise<RecoveryCheckpoint | null> {
    assertNonEmptyString(sessionId, "sessionId");
    return withPathLock(
      `${this.directory}\0${sessionId}`,
      async () => this.loadLatestUnlocked(sessionId),
    );
  }

  private async saveUnlocked(
    checkpoint: RecoveryCheckpoint,
  ): Promise<RecoveryCheckpoint> {
    await this.ensureDirectory();
    const existing = await this.loadLatestUnlocked(checkpoint.sessionId);
    if (existing) {
      const sourceOrder = compareSource(checkpoint, existing);
      if (sourceOrder < 0) {
        throw checkpointError(
          "checkpoint_source_conflict",
          "Checkpoint source is older than the latest verified checkpoint.",
          {
            actualRevision: checkpoint.sourceRevision,
            actualSequence: checkpoint.sourceSequence,
            latestRevision: existing.sourceRevision,
            latestSequence: existing.sourceSequence,
          },
        );
      }
      if (sourceOrder === 0) {
        if (checkpoint.payloadHash === existing.payloadHash) return existing;
        throw checkpointError(
          "checkpoint_source_conflict",
          "Checkpoint source already has different verified content.",
          {
            sourceRevision: checkpoint.sourceRevision,
            sourceSequence: checkpoint.sourceSequence,
            actualHash: checkpoint.payloadHash,
            existingHash: existing.payloadHash,
          },
        );
      }
    }

    const finalPath = join(this.directory, checkpointFileName(checkpoint));
    const temporaryPath = join(
      this.directory,
      `.tmp-${sessionFingerprint(checkpoint.sessionId)}-${randomUUID()}`,
    );
    let temporaryCreated = false;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(`${canonicalCheckpointJson(checkpoint)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      const staged = await this.readAndVerify(temporaryPath, checkpoint.sessionId);
      if (
        staged.payloadHash !== checkpoint.payloadHash
        || compareSource(staged, checkpoint) !== 0
      ) {
        throw checkpointError(
          "checkpoint_tampered",
          "Staged checkpoint does not match the intended checkpoint.",
        );
      }
      await rename(temporaryPath, finalPath);
      await syncDirectoryEntryBestEffort(this.directory);
      temporaryCreated = false;
      return staged;
    } catch (error) {
      if (error instanceof SessionControlError) throw error;
      throw checkpointError(
        "checkpoint_io_error",
        "Could not persist recovery checkpoint.",
        {
          cause: error instanceof Error ? error.message : String(error),
          sessionId: checkpoint.sessionId,
        },
      );
    } finally {
      if (temporaryCreated) await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async loadLatestUnlocked(
    sessionId: string,
  ): Promise<RecoveryCheckpoint | null> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw checkpointError(
        "checkpoint_io_error",
        "Could not inspect recovery checkpoint directory.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    const fingerprint = sessionFingerprint(sessionId);
    const candidates = names.filter((name) => name.startsWith(`${fingerprint}-`));
    let latest: RecoveryCheckpoint | null = null;
    for (const name of candidates) {
      const match = CHECKPOINT_FILE_PATTERN.exec(name);
      if (!match || match[1] !== fingerprint) {
        throw checkpointError(
          "checkpoint_tampered",
          "Checkpoint filename metadata is invalid.",
          { fileName: name, sessionId },
        );
      }
      const checkpoint = await this.readAndVerify(join(this.directory, name), sessionId);
      const fileRevision = Number(match[2]);
      const fileSequence = Number(match[3]);
      const fileHash = match[4];
      if (
        checkpoint.sourceRevision !== fileRevision
        || checkpoint.sourceSequence !== fileSequence
        || checkpoint.payloadHash !== fileHash
      ) {
        throw checkpointError(
          "checkpoint_tampered",
          "Checkpoint filename and envelope metadata do not match.",
          { fileName: name, sessionId },
        );
      }
      if (!latest) {
        latest = checkpoint;
        continue;
      }
      const sourceOrder = compareSource(checkpoint, latest);
      if (sourceOrder > 0) {
        latest = checkpoint;
      } else if (
        sourceOrder === 0
        && checkpoint.payloadHash !== latest.payloadHash
      ) {
        throw checkpointError(
          "checkpoint_source_conflict",
          "Multiple payloads claim the same checkpoint source.",
          {
            sessionId,
            sourceRevision: checkpoint.sourceRevision,
            sourceSequence: checkpoint.sourceSequence,
          },
        );
      }
    }
    return latest;
  }

  private async readAndVerify(
    path: string,
    expectedSessionId: string,
  ): Promise<RecoveryCheckpoint> {
    try {
      const content = await readFile(path, "utf8");
      return verifyRecoveryCheckpoint(JSON.parse(content), expectedSessionId);
    } catch (error) {
      if (error instanceof SessionControlError) throw error;
      if (error instanceof SyntaxError) {
        throw checkpointError(
          "checkpoint_tampered",
          "Checkpoint file is not valid JSON.",
          { path },
        );
      }
      throw checkpointError(
        "checkpoint_io_error",
        "Could not read recovery checkpoint.",
        {
          cause: error instanceof Error ? error.message : String(error),
          path,
        },
      );
    }
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true });
      await syncDirectoryEntryBestEffort(dirname(this.directory));
    } catch (error) {
      throw checkpointError(
        "checkpoint_io_error",
        "Could not create recovery checkpoint directory.",
        {
          cause: error instanceof Error ? error.message : String(error),
          directory: this.directory,
        },
      );
    }
  }
}

import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  BusinessOperationReceiptSchema,
  BusinessOperationReceiptSchemaVersion,
  type BusinessOperationKind,
  type BusinessOperationOutboxStep,
  type BusinessOperationReceipt,
  type BusinessOperationScope,
} from "@ronggang/contracts";

export type BusinessOperationErrorCode =
  | "not_found"
  | "request_replay_conflict"
  | "definition_drift"
  | "authority_required"
  | "recovery_required"
  | "revision_conflict";

export class BusinessOperationError extends Error {
  constructor(
    readonly code: BusinessOperationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = "BusinessOperationError";
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export interface BusinessOperationReceiptStore {
  get(operationId: string): Promise<BusinessOperationReceipt | null>;
  list(): Promise<BusinessOperationReceipt[]>;
  create(
    receipt: BusinessOperationReceipt,
  ): Promise<"created" | "exists" | "conflict">;
  compareAndSet(
    operationId: string,
    expectedRevision: number,
    next: BusinessOperationReceipt,
  ): Promise<void>;
}

export interface CommitBusinessOperationInput {
  operationKind: BusinessOperationKind;
  requestId: string;
  requestHash: string;
  scope: BusinessOperationScope;
  outboxSteps: BusinessOperationOutboxStep[];
  requestedAt?: string;
}

export interface BusinessOperationAuthorityResult {
  commitRef: string;
}

export interface BusinessOperationOutboxResult {
  resultRef: string;
}

export type BusinessOperationOutboxHandlers = Partial<Record<
  BusinessOperationOutboxStep,
  () => Promise<BusinessOperationOutboxResult>
>>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function computeBusinessOperationRequestHash(value: unknown): string {
  return hash(value);
}

export function businessOperationId(input: Pick<
  CommitBusinessOperationInput,
  "operationKind" | "requestId" | "scope"
>): string {
  return `business-op-${hash({
    operationKind: input.operationKind,
    requestId: input.requestId,
    scope: input.scope,
  }).slice(0, 24)}`;
}

function outboxId(
  operationId: string,
  step: BusinessOperationOutboxStep,
): string {
  return `business-outbox-${hash({ operationId, step }).slice(0, 24)}`;
}

function clone(receipt: BusinessOperationReceipt): BusinessOperationReceipt {
  return structuredClone(receipt);
}

function stableDefinition(receipt: BusinessOperationReceipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    operationId: receipt.operationId,
    operationKind: receipt.operationKind,
    requestId: receipt.requestId,
    requestHash: receipt.requestHash,
    scope: receipt.scope,
    outbox: receipt.outbox.map((item) => ({
      outboxId: item.outboxId,
      step: item.step,
    })),
  };
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertTransition(
  current: BusinessOperationReceipt,
  input: BusinessOperationReceipt,
): BusinessOperationReceipt {
  const next = BusinessOperationReceiptSchema.parse(input);
  if (next.operationId !== current.operationId
    || next.revision !== current.revision + 1
    || next.createdAt !== current.createdAt
    || !equivalent(stableDefinition(current), stableDefinition(next))) {
    throw new BusinessOperationError(
      "revision_conflict",
      "业务收据后继修订改变了冻结请求或没有连续递增",
      { operationId: current.operationId },
    );
  }
  if (current.phase === "completed") {
    throw new BusinessOperationError(
      "revision_conflict",
      "已完成业务收据不可继续改写",
      { operationId: current.operationId },
    );
  }
  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
    throw new BusinessOperationError(
      "revision_conflict",
      "业务收据时间不可倒退",
      { operationId: current.operationId },
    );
  }
  if (current.authorityCommitRef !== null && (
    next.authorityCommitRef !== current.authorityCommitRef
    || next.authorityCommittedAt !== current.authorityCommittedAt
  )) {
    throw new BusinessOperationError(
      "revision_conflict",
      "权威提交引用不可撤销或替换",
      { operationId: current.operationId },
    );
  }
  for (const currentItem of current.outbox) {
    const nextItem = next.outbox.find(
      (candidate) => candidate.outboxId === currentItem.outboxId,
    )!;
    if (nextItem.attempts < currentItem.attempts) {
      throw new BusinessOperationError(
        "revision_conflict",
        "Outbox 尝试次数不可倒退",
        { operationId: current.operationId, outboxId: currentItem.outboxId },
      );
    }
    if (currentItem.status === "delivered" && !equivalent(currentItem, nextItem)) {
      throw new BusinessOperationError(
        "revision_conflict",
        "已投递 Outbox 不可撤销或替换",
        { operationId: current.operationId, outboxId: currentItem.outboxId },
      );
    }
  }
  return next;
}

export class InMemoryBusinessOperationReceiptStore
implements BusinessOperationReceiptStore {
  readonly #records = new Map<string, BusinessOperationReceipt>();

  async get(operationId: string): Promise<BusinessOperationReceipt | null> {
    const receipt = this.#records.get(operationId);
    return receipt ? clone(receipt) : null;
  }

  async list(): Promise<BusinessOperationReceipt[]> {
    return [...this.#records.values()]
      .toSorted((left, right) => left.operationId.localeCompare(right.operationId))
      .map(clone);
  }

  async create(
    input: BusinessOperationReceipt,
  ): Promise<"created" | "exists" | "conflict"> {
    const receipt = BusinessOperationReceiptSchema.parse(input);
    const current = this.#records.get(receipt.operationId);
    if (current) {
      return equivalent(stableDefinition(current), stableDefinition(receipt))
        ? "exists"
        : "conflict";
    }
    this.#records.set(receipt.operationId, clone(receipt));
    return "created";
  }

  async compareAndSet(
    operationId: string,
    expectedRevision: number,
    input: BusinessOperationReceipt,
  ): Promise<void> {
    const current = this.#records.get(operationId);
    if (!current || current.revision !== expectedRevision) {
      throw new BusinessOperationError(
        "revision_conflict",
        "业务收据已被并发更新",
        { operationId, expectedRevision },
      );
    }
    this.#records.set(operationId, clone(assertTransition(current, input)));
  }
}

const createdFrameSchema = z.object({
  kind: z.literal("business_operation_created"),
  formatVersion: z.literal(1),
  receipt: BusinessOperationReceiptSchema,
}).strict();
const revisedFrameSchema = z.object({
  kind: z.literal("business_operation_revised"),
  formatVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  receipt: BusinessOperationReceiptSchema,
}).strict();
const frameSchema = z.discriminatedUnion("kind", [
  createdFrameSchema,
  revisedFrameSchema,
]);

const pathLocks = new Map<string, Promise<void>>();

async function readFrames(path: string): Promise<Map<string, BusinessOperationReceipt>> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  if (body.length === 0) return new Map();
  if (body.at(-1) !== 0x0a) {
    throw new Error("业务操作收据日志末尾帧不完整，拒绝恢复");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch (error) {
    throw new Error("业务操作收据日志不是有效 UTF-8", { cause: error });
  }
  const lines = text.split("\n");
  lines.pop();
  const records = new Map<string, BusinessOperationReceipt>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`业务操作收据日志第 ${index + 1} 行为空帧`);
    }
    let frame: z.infer<typeof frameSchema>;
    try {
      frame = frameSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`业务操作收据日志第 ${index + 1} 行损坏`, { cause: error });
    }
    const receipt = frame.receipt;
    const current = records.get(receipt.operationId);
    if (frame.kind === "business_operation_created") {
      if (receipt.revision !== 0 || current) {
        throw new Error(`业务操作创建帧冲突：${receipt.operationId}`);
      }
      records.set(receipt.operationId, receipt);
      continue;
    }
    if (!current || current.revision !== frame.expectedRevision) {
      throw new Error(`业务操作修订帧缺少连续前序：${receipt.operationId}`);
    }
    records.set(receipt.operationId, assertTransition(current, receipt));
  }
  return records;
}

export class JsonlBusinessOperationReceiptStore
implements BusinessOperationReceiptStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    pathLocks.set(this.#path, tail);
    try {
      return await result;
    } finally {
      if (pathLocks.get(this.#path) === tail) pathLocks.delete(this.#path);
    }
  }

  get(operationId: string): Promise<BusinessOperationReceipt | null> {
    return this.#withLock(async () => {
      const receipt = (await readFrames(this.#path)).get(operationId);
      return receipt ? clone(receipt) : null;
    });
  }

  list(): Promise<BusinessOperationReceipt[]> {
    return this.#withLock(async () => [...(await readFrames(this.#path)).values()]
      .toSorted((left, right) => left.operationId.localeCompare(right.operationId))
      .map(clone));
  }

  create(
    input: BusinessOperationReceipt,
  ): Promise<"created" | "exists" | "conflict"> {
    const receipt = BusinessOperationReceiptSchema.parse(input);
    return this.#withLock(async () => {
      const current = (await readFrames(this.#path)).get(receipt.operationId);
      if (current) {
        return equivalent(stableDefinition(current), stableDefinition(receipt))
          ? "exists"
          : "conflict";
      }
      await this.#append(createdFrameSchema.parse({
        kind: "business_operation_created",
        formatVersion: 1,
        receipt,
      }));
      return "created";
    });
  }

  compareAndSet(
    operationId: string,
    expectedRevision: number,
    input: BusinessOperationReceipt,
  ): Promise<void> {
    return this.#withLock(async () => {
      const current = (await readFrames(this.#path)).get(operationId);
      if (!current || current.revision !== expectedRevision) {
        throw new BusinessOperationError(
          "revision_conflict",
          "业务收据已被并发更新",
          { operationId, expectedRevision },
        );
      }
      const receipt = assertTransition(current, input);
      await this.#append(revisedFrameSchema.parse({
        kind: "business_operation_revised",
        formatVersion: 1,
        expectedRevision,
        receipt,
      }));
    });
  }

  async #append(frame: z.infer<typeof frameSchema>): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const handle = await open(this.#path, "a");
    try {
      await handle.writeFile(`${JSON.stringify(frame)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
    if (/^[a-z][a-z0-9_]{0,79}$/u.test(code)) return code;
  }
  if (error instanceof Error) {
    const name = error.name.replace(/error$/iu, "").replace(/[^a-z0-9]+/giu, "_")
      .replace(/^_+|_+$/gu, "").toLowerCase();
    if (/^[a-z][a-z0-9_]{0,79}$/u.test(name)) return name;
  }
  return "operation_failed";
}

function receiptDefinition(input: CommitBusinessOperationInput): BusinessOperationReceipt {
  const operationId = businessOperationId(input);
  const timestamp = input.requestedAt ?? new Date().toISOString();
  return BusinessOperationReceiptSchema.parse({
    schemaVersion: BusinessOperationReceiptSchemaVersion,
    operationId,
    operationKind: input.operationKind,
    requestId: input.requestId,
    requestHash: input.requestHash,
    scope: input.scope,
    phase: "requested",
    revision: 0,
    authorityCommitRef: null,
    authorityCommittedAt: null,
    outbox: input.outboxSteps.map((step) => ({
      outboxId: outboxId(operationId, step),
      step,
      status: "pending",
      attempts: 0,
      resultRef: null,
      lastErrorCode: null,
      deliveredAt: null,
      updatedAt: timestamp,
    })),
    recovery: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

export class BusinessOperationCoordinator {
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    readonly store: BusinessOperationReceiptStore,
    readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get(operationId: string): Promise<BusinessOperationReceipt | null> {
    return this.store.get(operationId);
  }

  list(): Promise<BusinessOperationReceipt[]> {
    return this.store.list();
  }

  async audit(): Promise<void> {
    await this.store.list();
  }

  async commitAuthority(
    input: CommitBusinessOperationInput,
    commit: () => Promise<BusinessOperationAuthorityResult>,
  ): Promise<BusinessOperationReceipt> {
    const definition = receiptDefinition({
      ...input,
      requestedAt: input.requestedAt ?? this.now(),
    });
    return this.#serialized(definition.operationId, async () => {
      const created = await this.store.create(definition);
      if (created === "conflict") {
        throw new BusinessOperationError(
          "request_replay_conflict",
          "同一业务操作 ID 已冻结不同请求载荷",
          { operationId: definition.operationId },
        );
      }
      let receipt = await this.store.get(definition.operationId);
      if (!receipt) {
        throw new BusinessOperationError(
          "not_found",
          "业务操作请求已登记但无法读取",
          { operationId: definition.operationId },
        );
      }
      if (!equivalent(stableDefinition(receipt), stableDefinition(definition))) {
        throw new BusinessOperationError(
          "request_replay_conflict",
          "相同请求 ID 不得承载不同载荷或 Outbox 定义",
          { operationId: definition.operationId },
        );
      }
      if (receipt.authorityCommitRef !== null) return receipt;
      let result: BusinessOperationAuthorityResult;
      try {
        result = await commit();
      } catch (error) {
        const failedAt = this.#timestamp(receipt.updatedAt);
        const failed = BusinessOperationReceiptSchema.parse({
          ...receipt,
          phase: "recovery_required",
          revision: receipt.revision + 1,
          recovery: {
            reasonCode: failureCode(error),
            failedAt,
            nextSafeAction: "retry_authority",
          },
          updatedAt: failedAt,
        });
        await this.store.compareAndSet(
          receipt.operationId,
          receipt.revision,
          failed,
        );
        throw new BusinessOperationError(
          "recovery_required",
          "权威业务写入未取得完成回执，可使用同一请求安全恢复",
          { operationId: receipt.operationId },
          error,
        );
      }
      const committedAt = this.#timestamp(receipt.updatedAt);
      const next = BusinessOperationReceiptSchema.parse({
        ...receipt,
        phase: "authority_committed",
        revision: receipt.revision + 1,
        authorityCommitRef: result.commitRef,
        authorityCommittedAt: committedAt,
        recovery: null,
        updatedAt: committedAt,
      });
      await this.store.compareAndSet(
        receipt.operationId,
        receipt.revision,
        next,
      );
      return next;
    });
  }

  async deliverOutbox(
    operationId: string,
    handlers: BusinessOperationOutboxHandlers,
  ): Promise<BusinessOperationReceipt> {
    return this.#serialized(operationId, async () => {
      let receipt = await this.store.get(operationId);
      if (!receipt) {
        throw new BusinessOperationError(
          "not_found",
          "业务操作收据不存在",
          { operationId },
        );
      }
      if (receipt.phase === "completed") return receipt;
      if (receipt.authorityCommitRef === null) {
        throw new BusinessOperationError(
          "authority_required",
          "权威业务写入尚未完成，不能提前投递投影",
          { operationId },
        );
      }
      for (const item of receipt.outbox) {
        if (item.status === "delivered") continue;
        const handler = handlers[item.step];
        if (!handler) {
          throw new BusinessOperationError(
            "definition_drift",
            "恢复程序缺少冻结 Outbox 步骤处理器",
            { operationId, step: item.step },
          );
        }
        let result: BusinessOperationOutboxResult;
        try {
          result = await handler();
        } catch (error) {
          const failedAt = this.#timestamp(receipt.updatedAt);
          const failed = BusinessOperationReceiptSchema.parse({
            ...receipt,
            phase: "recovery_required",
            revision: receipt.revision + 1,
            outbox: receipt.outbox.map((candidate) => (
              candidate.outboxId === item.outboxId
                ? {
                    ...candidate,
                    attempts: candidate.attempts + 1,
                    lastErrorCode: failureCode(error),
                    updatedAt: failedAt,
                  }
                : candidate
            )),
            recovery: {
              reasonCode: failureCode(error),
              failedAt,
              nextSafeAction: "resume_outbox",
            },
            updatedAt: failedAt,
          });
          await this.store.compareAndSet(
            receipt.operationId,
            receipt.revision,
            failed,
          );
          throw new BusinessOperationError(
            "recovery_required",
            "权威写入已保留，但非权威投影尚未全部补齐",
            { operationId, step: item.step },
            error,
          );
        }
        const deliveredAt = this.#timestamp(receipt.updatedAt);
        const nextOutbox = receipt.outbox.map((candidate) => (
          candidate.outboxId === item.outboxId
            ? {
                ...candidate,
                status: "delivered" as const,
                attempts: candidate.attempts + 1,
                resultRef: result.resultRef,
                lastErrorCode: null,
                deliveredAt,
                updatedAt: deliveredAt,
              }
            : candidate
        ));
        const hasPending = nextOutbox.some(
          (candidate) => candidate.status === "pending",
        );
        const next = BusinessOperationReceiptSchema.parse({
          ...receipt,
          phase: hasPending ? "projections_pending" : "completed",
          revision: receipt.revision + 1,
          outbox: nextOutbox,
          recovery: null,
          updatedAt: deliveredAt,
          completedAt: hasPending ? null : deliveredAt,
        });
        await this.store.compareAndSet(
          receipt.operationId,
          receipt.revision,
          next,
        );
        receipt = next;
      }
      if (receipt.phase === "completed") return receipt;
      const completedAt = this.#timestamp(receipt.updatedAt);
      const completed = BusinessOperationReceiptSchema.parse({
        ...receipt,
        phase: "completed",
        revision: receipt.revision + 1,
        recovery: null,
        updatedAt: completedAt,
        completedAt,
      });
      await this.store.compareAndSet(
        receipt.operationId,
        receipt.revision,
        completed,
      );
      return completed;
    });
  }

  async execute(
    input: CommitBusinessOperationInput,
    commit: () => Promise<BusinessOperationAuthorityResult>,
    handlers: BusinessOperationOutboxHandlers,
  ): Promise<BusinessOperationReceipt> {
    const committed = await this.commitAuthority(input, commit);
    return this.deliverOutbox(committed.operationId, handlers);
  }

  #timestamp(previous: string): string {
    const current = this.now();
    return Date.parse(current) < Date.parse(previous) ? previous : current;
  }

  async #serialized<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(operationId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const tail = previous.then(() => current);
    this.#locks.set(operationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(operationId) === tail) this.#locks.delete(operationId);
    }
  }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { FieldInterviewSpeechDecisionV1Schema, ModelInvocationTraceSchema, V2ContentHashSchema, V2IdentifierSchema } from "@ronggang/contracts";

const id = V2IdentifierSchema;
export const FieldModelExecutionSchema = ModelInvocationTraceSchema.pick({ provider: true, model: true, mode: true, attempts: true });
export type FieldModelExecution = z.infer<typeof FieldModelExecutionSchema>;
export const FieldModelAttemptSchema = z.object({
  attemptId: id, sessionId: id, actorId: id, bindingId: id, requestId: id, requestHash: V2ContentHashSchema,
  lessonHash: V2ContentHashSchema, inputHash: V2ContentHashSchema, outputHash: V2ContentHashSchema.nullable(),
  status: z.enum(["started", "succeeded", "failed", "interrupted", "legacy"]),
  called: z.boolean().nullable(),
  execution: FieldModelExecutionSchema.optional(),
  reservedCostMicros: z.number().int().nonnegative(), costMicros: z.number().int().nonnegative().nullable(),
  traceRef: id.nullable(), failureCode: z.string().max(100).nullable(),
  decision: FieldInterviewSpeechDecisionV1Schema.nullable(),
  retrievedCitationIds: z.array(z.string().min(1).max(240)).max(12),
  commitStatus: z.enum(["pending", "committed", "rejected"]), eventId: id.nullable(), commitFailureCode: z.string().max(100).nullable(),
  startedAt: z.string().datetime(), settledAt: z.string().datetime().nullable(), updatedAt: z.string().datetime(),
}).strict().superRefine((attempt, context) => {
  if ((attempt.commitStatus === "committed") !== (attempt.eventId !== null)) context.addIssue({ code: "custom", message: "模型尝试的世界提交状态与事件引用不一致" });
  if (attempt.status === "succeeded" && (!attempt.decision || !attempt.outputHash || !attempt.settledAt)) context.addIssue({ code: "custom", message: "成功模型尝试缺少候选与结算引用" });
});
export type FieldModelAttempt = z.infer<typeof FieldModelAttemptSchema>;

const LedgerSchema = z.object({
  schemaVersion: z.literal("field-model-attempts/1.0.0"), sessionId: id, revision: z.number().int().nonnegative(), attempts: z.array(FieldModelAttemptSchema),
}).strict().superRefine((ledger, context) => {
  if (ledger.attempts.some(attempt => attempt.sessionId !== ledger.sessionId)
    || new Set(ledger.attempts.map(attempt => attempt.attemptId)).size !== ledger.attempts.length
    || new Set(ledger.attempts.map(attempt => attempt.requestId)).size !== ledger.attempts.length) {
    context.addIssue({ code: "custom", message: "模型调用账本存在跨场记录或重复请求" });
  }
});
export type FieldModelLedger = z.infer<typeof LedgerSchema>;
export const emptyFieldModelLedger = (sessionId: string): FieldModelLedger => ({ schemaVersion: "field-model-attempts/1.0.0", sessionId, revision: 0, attempts: [] });

export interface FieldModelAttemptStore {
  load(sessionId: string): Promise<FieldModelLedger>;
  list(): Promise<FieldModelLedger[]>;
  save(ledger: FieldModelLedger, expectedRevision: number): Promise<void>;
}

function successor(ledger: FieldModelLedger, current: FieldModelLedger, expectedRevision: number): FieldModelLedger {
  const next = LedgerSchema.parse(ledger);
  if (current.sessionId !== next.sessionId || current.revision !== expectedRevision || next.revision !== expectedRevision + 1) throw new Error("模型调用账本修订冲突");
  for (const attempt of current.attempts) {
    const replacement = next.attempts.find(item => item.attemptId === attempt.attemptId);
    if (!replacement || replacement.requestHash !== attempt.requestHash || replacement.actorId !== attempt.actorId
      || replacement.bindingId !== attempt.bindingId || replacement.requestId !== attempt.requestId || replacement.lessonHash !== attempt.lessonHash
      || replacement.inputHash !== attempt.inputHash || replacement.reservedCostMicros !== attempt.reservedCostMicros
      || replacement.startedAt !== attempt.startedAt || (attempt.commitStatus === "committed" && replacement.eventId !== attempt.eventId)) {
      throw new Error("不能删除或改变已记录模型尝试的来源");
    }
    if (attempt.status !== "started" && (replacement.status !== attempt.status || replacement.inputHash !== attempt.inputHash
      || replacement.outputHash !== attempt.outputHash || replacement.costMicros !== attempt.costMicros || replacement.called !== attempt.called
      || replacement.traceRef !== attempt.traceRef || JSON.stringify(replacement.decision) !== JSON.stringify(attempt.decision)
      || JSON.stringify(replacement.execution) !== JSON.stringify(attempt.execution))) {
      throw new Error("不能改写已结算模型尝试的调用结果");
    }
  }
  return next;
}

export class InMemoryFieldModelAttemptStore implements FieldModelAttemptStore {
  readonly #ledgers = new Map<string, FieldModelLedger>();
  async load(sessionId: string): Promise<FieldModelLedger> { return structuredClone(this.#ledgers.get(sessionId) ?? emptyFieldModelLedger(sessionId)); }
  async list(): Promise<FieldModelLedger[]> { return structuredClone([...this.#ledgers.values()]); }
  async save(ledger: FieldModelLedger, expectedRevision: number): Promise<void> {
    const next = successor(ledger, await this.load(ledger.sessionId), expectedRevision);
    this.#ledgers.set(ledger.sessionId, structuredClone(next));
  }
}

/** The API data-directory lease and the service's session queue own the single writer. */
export class JsonFileFieldModelAttemptStore implements FieldModelAttemptStore {
  constructor(private readonly directory: string) {}
  #path(sessionId: string): string { return resolve(this.directory, `${createHash("sha256").update(sessionId).digest("hex")}.json`); }
  async load(sessionId: string): Promise<FieldModelLedger> {
    try {
      const ledger = LedgerSchema.parse(JSON.parse(await readFile(this.#path(sessionId), "utf8")));
      if (ledger.sessionId !== sessionId) throw new Error("模型调用账本与场次不一致");
      return ledger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFieldModelLedger(sessionId);
      throw error;
    }
  }
  async save(ledger: FieldModelLedger, expectedRevision: number): Promise<void> {
    const next = successor(ledger, await this.load(ledger.sessionId), expectedRevision);
    await mkdir(this.directory, { recursive: true });
    const path = this.#path(ledger.sessionId), temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx");
    try { await file.writeFile(`${JSON.stringify(next)}\n`, "utf8"); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary); throw error; }
  }
  async list(): Promise<FieldModelLedger[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).map(async name => {
      const ledger = LedgerSchema.parse(JSON.parse(await readFile(resolve(this.directory, name), "utf8")));
      if (this.#path(ledger.sessionId) !== resolve(this.directory, name)) throw new Error("模型调用账本文件与场次不一致");
      return ledger;
    }));
  }
}

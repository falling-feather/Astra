import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  V2ContentHashSchema,
  V2IdentifierSchema,
  type StudentWorkAction,
  type BusinessOperationReceipt,
  WorkSupplementV3Schema, WorkSupplementSelectionV3Schema,
  type WorkSupplementSelectionV3, type SubmittedStudentNoteV1,
} from "@ronggang/contracts";
import type {
  XunpuFlagshipArtifactV3,
  XunpuFlagshipContentManifestV3,
} from "@ronggang/course-content";
import type {
  BusinessOperationCoordinator,
  CommitBusinessOperationInput,
} from "./business-operation-receipt.js";

export const FlagshipStudentWorkRecordVersion =
  "flagship-student-work-record/3.0.0" as const;
export const FlagshipStudentWorkspaceViewVersion =
  "flagship-student-workspace/3.0.0" as const;
export const FlagshipWorkReviewViewVersion =
  "flagship-work-review/3.0.0" as const;

const TimestampSchema = z.string().datetime();
export const ChallengeLevelSchema = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
]);

const WorkFieldSchema = z.object({
  fieldId: V2IdentifierSchema,
  content: z.string().max(20_000),
}).strict();

const WorkRevisionSchema = z.object({
  revisionId: V2IdentifierSchema,
  artifactId: V2IdentifierSchema,
  revisionNumber: z.number().int().positive(),
  parentRevisionId: V2IdentifierSchema.nullable(),
  fields: z.array(WorkFieldSchema).min(1).max(24),
  evidenceRefs: z.array(V2IdentifierSchema).max(48),
  revisionNote: z.string().trim().min(1).max(600),
  contentHash: V2ContentHashSchema,
  createdAt: TimestampSchema,
}).strict();

const WorkArtifactSchema = z.object({
  artifactId: V2IdentifierSchema,
  status: z.enum(["empty", "draft", "submitted"]),
  latestRevisionId: V2IdentifierSchema.nullable(),
  revisionCount: z.number().int().nonnegative(),
  submittedRevisionId: V2IdentifierSchema.nullable(),
  updatedAt: TimestampSchema,
}).strict();

const WorkRequestReceiptSchema = z.object({
  requestId: V2IdentifierSchema,
  operation: z.enum(["save_revision", "submit_revision"]),
  requestHash: V2ContentHashSchema,
  artifactId: V2IdentifierSchema,
  resultRevisionId: V2IdentifierSchema,
  createdAt: TimestampSchema,
}).strict();

const FlagshipStudentWorkRecordSchema = z.object({
  recordVersion: z.literal(FlagshipStudentWorkRecordVersion),
  recordRevision: z.number().int().nonnegative(),
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  ownerPrincipalId: V2IdentifierSchema,
  actorId: V2IdentifierSchema,
  challengeLevel: ChallengeLevelSchema,
  manifestId: V2IdentifierSchema,
  manifestContentHash: V2ContentHashSchema,
  artifacts: z.array(WorkArtifactSchema).min(1).max(32),
  revisions: z.array(WorkRevisionSchema).max(512),
  supplements: z.array(WorkSupplementV3Schema).max(512).optional(),
  requestReceipts: z.array(WorkRequestReceiptSchema).max(1_024),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  for (const [index, supplement] of (record.supplements ?? []).entries()) {
    const { contentHash, ...body } = supplement;
    if (contentHash && contentHash !== hash(body)) context.addIssue({ code: "custom", path: ["supplements",index], message: "已提交附件的内容校验失败" });
  }
  const artifactIds = record.artifacts.map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "作品 ID 重复" });
  }
  const revisionIds = record.revisions.map((revision) => revision.revisionId);
  if (new Set(revisionIds).size !== revisionIds.length) {
    context.addIssue({ code: "custom", path: ["revisions"], message: "作品版本 ID 重复" });
  }
  const receiptIds = record.requestReceipts.map((receipt) => receipt.requestId);
  if (new Set(receiptIds).size !== receiptIds.length) {
    context.addIssue({ code: "custom", path: ["requestReceipts"], message: "请求回执 ID 重复" });
  }
  const revisionsByArtifact = new Map<string, typeof record.revisions>();
  for (const revision of record.revisions) {
    if (!artifactIds.includes(revision.artifactId)) {
      context.addIssue({
        code: "custom",
        path: ["revisions"],
        message: `作品版本引用了未知作品：${revision.artifactId}`,
      });
    }
    const revisions = revisionsByArtifact.get(revision.artifactId) ?? [];
    revisions.push(revision);
    revisionsByArtifact.set(revision.artifactId, revisions);
  }
  for (const [index, artifact] of record.artifacts.entries()) {
    const revisions = (revisionsByArtifact.get(artifact.artifactId) ?? [])
      .sort((left, right) => left.revisionNumber - right.revisionNumber);
    if (artifact.revisionCount !== revisions.length) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", index, "revisionCount"],
        message: "作品版本计数与版本记录不一致",
      });
    }
    if (revisions.some((revision, revisionIndex) => (
      revision.revisionNumber !== revisionIndex + 1
      || revision.parentRevisionId !== (revisionIndex === 0
        ? null
        : revisions[revisionIndex - 1]!.revisionId)
    ))) {
      context.addIssue({
        code: "custom",
        path: ["revisions"],
        message: `作品版本链不连续：${artifact.artifactId}`,
      });
    }
    const latest = revisions.at(-1) ?? null;
    if (artifact.latestRevisionId !== (latest?.revisionId ?? null)) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", index, "latestRevisionId"],
        message: "作品最新版本引用不一致",
      });
    }
    if (artifact.status === "empty" && revisions.length > 0) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "status"], message: "已有版本的作品不得为空" });
    }
    if ((artifact.status === "submitted") !== (artifact.submittedRevisionId !== null)) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "submittedRevisionId"], message: "送审状态与冻结版本不一致" });
    }
    if (artifact.submittedRevisionId !== null
      && artifact.submittedRevisionId !== artifact.latestRevisionId) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "submittedRevisionId"], message: "只能送审最新作品版本" });
    }
  }
});

export type FlagshipStudentWorkRecordV3 = z.infer<
  typeof FlagshipStudentWorkRecordSchema
>;
export type FlagshipWorkRevisionV3 = z.infer<typeof WorkRevisionSchema>;

export interface FlagshipEvidenceOptionV3 {
  evidenceRef: string;
  kind: "knowledge" | "world_event" | "world_evidence";
  label: string;
  detail: string;
  eventType: string | null;
}

export interface SaveFlagshipWorkRevisionInputV3 {
  sessionId: string;
  bindingId: string;
  principalId: string;
  actorId: string;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  artifactId: string;
  expectedRevisionNumber: number;
  requestId: string;
  fields: Array<{ fieldId: string; content: string }>;
  evidenceRefs: string[];
  revisionNote: string;
  allowedEvidenceRefs: ReadonlySet<string>;
}

export interface SubmitFlagshipWorkRevisionInputV3 {
  sessionId: string;
  bindingId: string;
  principalId: string;
  actorId: string;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  artifactId: string;
  revisionId: string;
  contentHash: string;
  requestId: string;
  supplement?: WorkSupplementSelectionV3;
}

export interface FlagshipStudentWorkStoreV3 {
  create(record: FlagshipStudentWorkRecordV3): Promise<void>;
  load(sessionId: string): Promise<FlagshipStudentWorkRecordV3 | null>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipStudentWorkRecordV3,
  ): Promise<void>;
}

export class FlagshipStudentWorkErrorV3 extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "access_denied"
      | "manifest_drift"
      | "revision_conflict"
      | "request_replay_conflict"
      | "invalid_revision"
      | "not_ready"
      | "reference_drift",
    message: string,
  ) {
    super(message);
    this.name = "FlagshipStudentWorkErrorV3";
  }
}

export class InMemoryFlagshipStudentWorkStoreV3
implements FlagshipStudentWorkStoreV3 {
  readonly #records = new Map<string, FlagshipStudentWorkRecordV3>();

  async create(record: FlagshipStudentWorkRecordV3): Promise<void> {
    const parsed = FlagshipStudentWorkRecordSchema.parse(record);
    if (this.#records.has(parsed.sessionId)) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品记录已经存在",
      );
    }
    this.#records.set(parsed.sessionId, structuredClone(parsed));
  }

  async load(sessionId: string): Promise<FlagshipStudentWorkRecordV3 | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipStudentWorkRecordV3,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品记录已被其他操作更新",
      );
    }
    const parsed = FlagshipStudentWorkRecordSchema.parse(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品 CAS 后继版本非法",
      );
    }
    this.#records.set(sessionId, structuredClone(parsed));
  }
}

function sessionFileName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export class JsonFileFlagshipStudentWorkStoreV3
implements FlagshipStudentWorkStoreV3 {
  constructor(private readonly directory: string) {}

  async create(record: FlagshipStudentWorkRecordV3): Promise<void> {
    const parsed = FlagshipStudentWorkRecordSchema.parse(record);
    if (await this.load(parsed.sessionId)) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品记录已经存在",
      );
    }
    await this.#write(parsed);
  }

  async load(sessionId: string): Promise<FlagshipStudentWorkRecordV3 | null> {
    let text: string;
    try {
      text = await readFile(this.#pathFor(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = FlagshipStudentWorkRecordSchema.parse(JSON.parse(text));
    if (parsed.sessionId !== sessionId) {
      throw new FlagshipStudentWorkErrorV3(
        "reference_drift",
        "旗舰作品记录文件与会话不一致",
      );
    }
    return parsed;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipStudentWorkRecordV3,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品记录已被其他操作更新",
      );
    }
    const parsed = FlagshipStudentWorkRecordSchema.parse(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipStudentWorkErrorV3(
        "revision_conflict",
        "旗舰作品 CAS 后继版本非法",
      );
    }
    await this.#write(parsed);
  }

  #pathFor(sessionId: string): string {
    return resolve(this.directory, sessionFileName(sessionId));
  }

  async #write(record: FlagshipStudentWorkRecordV3): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.sessionId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
      renamed = true;
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function stableRevisionId(sessionId: string, artifactId: string, requestId: string): string {
  return `work-revision-${hash({ sessionId, artifactId, requestId }).slice(0, 24)}`;
}

function artifactCompletion(
  definition: XunpuFlagshipArtifactV3,
  artifact: FlagshipStudentWorkRecordV3["artifacts"][number],
  revision: FlagshipWorkRevisionV3 | null,
) {
  const missingFields = definition.editableFields.flatMap((field) => {
    const content = revision?.fields.find((item) => item.fieldId === field.fieldId)
      ?.content.trim() ?? "";
    return content.length < field.minimumLength ? [field.label] : [];
  });
  // Source selection and version counts are not substitutes for the quality of the submitted work.
  const minimumEvidenceCount = 0;
  const evidenceReady = true;
  const revisionReady = true;
  return {
    mechanicalReady: missingFields.length === 0 && evidenceReady && revisionReady,
    missingFields,
    evidenceReady,
    minimumEvidenceCount,
    revisionReady,
  };
}

export type FlagshipWorkDefinitionV3 = Pick<XunpuFlagshipContentManifestV3, "manifestId" | "contentHash" | "title" | "expectedDurationMinutes" | "artifacts">;

export class FlagshipStudentWorkServiceV3 {
  readonly #locks = new Map<string, Promise<void>>();
  readonly #manifests = new Map<string, FlagshipWorkDefinitionV3>();

  constructor(private readonly options: {
    store: FlagshipStudentWorkStoreV3;
    manifest: FlagshipWorkDefinitionV3;
    resolveManifest?: (sessionId: string) => Promise<FlagshipWorkDefinitionV3>;
    selectedNotes?: (input: { sessionId: string; principalId: string; noteIds: string[]; notebookRevision: number }) => Promise<SubmittedStudentNoteV1[]>;
    businessOperations?: Pick<
      BusinessOperationCoordinator,
      "commitAuthority" | "deliverOutbox"
    >;
    afterSubmissionCommitted?: (input: {
      sessionId: string;
      artifactId: string;
      revisionId: string;
    }) => Promise<string>;
    now?: () => string;
  }) {
    this.#manifests.set(options.manifest.contentHash, options.manifest);
  }

  async getWorkspace(input: {
    sessionId: string;
    bindingId: string;
    principalId: string;
    actorId: string;
    challengeLevel: 3 | 4 | 5 | 6 | 7;
    evidenceCatalog: FlagshipEvidenceOptionV3[];
  }) {
    const record = await this.#withLock(input.sessionId, () => this.#loadOrCreate(input));
    return this.#project(record, input.evidenceCatalog);
  }

  async saveRevision(input: SaveFlagshipWorkRevisionInputV3) {
    return this.#withLock(input.sessionId, async () => {
      const record = await this.#loadOrCreate(input);
      const definition = this.#definition(input.artifactId, record);
      const artifactIndex = record.artifacts.findIndex(
        (artifact) => artifact.artifactId === input.artifactId,
      );
      const artifact = record.artifacts[artifactIndex]!;
      const requestPayload = {
        operation: "save_revision",
        artifactId: input.artifactId,
        expectedRevisionNumber: input.expectedRevisionNumber,
        fields: input.fields,
        evidenceRefs: input.evidenceRefs,
        revisionNote: input.revisionNote,
      };
      const requestHash = hash(requestPayload);
      const replay = this.#replay(record, input.requestId, requestHash, "save_revision");
      if (replay) return this.#project(record, []);
      if (artifact.revisionCount !== input.expectedRevisionNumber) {
        throw new FlagshipStudentWorkErrorV3(
          "revision_conflict",
          `作品已更新：期望 R${input.expectedRevisionNumber}，当前 R${artifact.revisionCount}`,
        );
      }
      const fieldIds = input.fields.map((field) => field.fieldId);
      const expectedFieldIds = definition.editableFields.map((field) => field.fieldId);
      if (new Set(fieldIds).size !== fieldIds.length
        || [...fieldIds].sort().join("\u0000") !== [...expectedFieldIds].sort().join("\u0000")) {
        throw new FlagshipStudentWorkErrorV3(
          "invalid_revision",
          "作品字段必须与服务端发布模板完全一致",
        );
      }
      const fields = definition.editableFields.map((field) => {
        const content = input.fields.find((item) => item.fieldId === field.fieldId)!
          .content.trim();
        if (content.length > field.maximumLength) {
          throw new FlagshipStudentWorkErrorV3(
            "invalid_revision",
            `${field.label}超过 ${field.maximumLength} 字限制`,
          );
        }
        return { fieldId: field.fieldId, content };
      });
      if (fields.every((field) => field.content.length === 0)) {
        throw new FlagshipStudentWorkErrorV3(
          "invalid_revision",
          "至少填写一个真实作品字段后才能保存版本",
        );
      }
      const evidenceRefs = [...new Set(input.evidenceRefs)].sort();
      if (evidenceRefs.length !== input.evidenceRefs.length
        || evidenceRefs.some((reference) => !input.allowedEvidenceRefs.has(reference))) {
        throw new FlagshipStudentWorkErrorV3(
          "invalid_revision",
          "作品引用了当前学生不可见或重复的证据",
        );
      }
      const contentHash = hash({ artifactId: input.artifactId, fields, evidenceRefs });
      const previous = artifact.latestRevisionId === null
        ? null
        : record.revisions.find((revision) => revision.revisionId === artifact.latestRevisionId)!;
      if (previous?.contentHash === contentHash) {
        throw new FlagshipStudentWorkErrorV3(
          "invalid_revision",
          "作品内容与证据没有变化，无需制造空版本",
        );
      }
      const timestamp = this.#now();
      const revision = WorkRevisionSchema.parse({
        revisionId: stableRevisionId(input.sessionId, input.artifactId, input.requestId),
        artifactId: input.artifactId,
        revisionNumber: artifact.revisionCount + 1,
        parentRevisionId: artifact.latestRevisionId,
        fields,
        evidenceRefs,
        revisionNote: input.revisionNote,
        contentHash,
        createdAt: timestamp,
      });
      const next = FlagshipStudentWorkRecordSchema.parse({
        ...record,
        recordRevision: record.recordRevision + 1,
        artifacts: record.artifacts.map((candidate, index) => index === artifactIndex
          ? {
              ...candidate,
              status: "draft",
              latestRevisionId: revision.revisionId,
              revisionCount: revision.revisionNumber,
              submittedRevisionId: null,
              updatedAt: timestamp,
            }
          : candidate),
        revisions: [...record.revisions, revision],
        requestReceipts: [...record.requestReceipts, {
          requestId: input.requestId,
          operation: "save_revision",
          requestHash,
          artifactId: input.artifactId,
          resultRevisionId: revision.revisionId,
          createdAt: timestamp,
        }],
        updatedAt: timestamp,
      });
      await this.options.store.compareAndSet(
        input.sessionId,
        record.recordRevision,
        next,
      );
      return this.#project(next, []);
    });
  }

  async submitRevision(input: SubmitFlagshipWorkRevisionInputV3) {
    const outcome = await this.#withLock(input.sessionId, async () => {
      const record = await this.#loadOrCreate(input);
      const definition = this.#definition(input.artifactId, record);
      const artifactIndex = record.artifacts.findIndex(
        (artifact) => artifact.artifactId === input.artifactId,
      );
      const artifact = record.artifacts[artifactIndex]!;
      const requestHash = hash({
        operation: "submit_revision",
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        contentHash: input.contentHash,
        ...(input.supplement ? { supplement: input.supplement } : {}),
      });
      const replay = this.#replay(record, input.requestId, requestHash, "submit_revision");
      const operationInput: CommitBusinessOperationInput = {
        operationKind: "submit_work_revision",
        requestId: input.requestId,
        requestHash,
        scope: {
          sourceSessionId: input.sessionId,
          targetSessionId: null,
          artifactId: input.artifactId,
        },
        outboxSteps: ["refresh_assessment_projection"],
      };
      if (replay) {
        const operation = this.options.businessOperations
          ? await this.options.businessOperations.commitAuthority(
              operationInput,
              async () => ({ commitRef: replay.resultRevisionId }),
            )
          : null;
        return {
          workspace: this.#project(record, []),
          operationId: operation?.operationId ?? null,
          revisionId: replay.resultRevisionId,
        };
      }
      const revision = record.revisions.find(
        (candidate) => candidate.revisionId === input.revisionId,
      );
      if (!revision
        || revision.artifactId !== input.artifactId
        || revision.revisionId !== artifact.latestRevisionId
        || revision.contentHash !== input.contentHash) {
        throw new FlagshipStudentWorkErrorV3(
          "reference_drift",
          "只能送审当前服务端保存的最新作品版本",
        );
      }
      const completion = artifactCompletion(definition, artifact, revision);
      if (!completion.mechanicalReady) {
        throw new FlagshipStudentWorkErrorV3(
          "not_ready",
          `作品尚未通过机械送审门：${[
            ...completion.missingFields,
            ...(completion.evidenceReady ? [] : [`至少 ${completion.minimumEvidenceCount} 条证据`]),
            ...(completion.revisionReady ? [] : ["专题稿至少两个真实版本"]),
          ].join("、")}`,
        );
      }
      const timestamp = this.#now();
      if (artifact.status === "submitted") throw new FlagshipStudentWorkErrorV3("invalid_revision", "该作品版本已送审，附件随提交冻结；修改作品后可再次送审。");
      const selection = WorkSupplementSelectionV3Schema.parse(input.supplement ?? { noteIds: [], photos: [] });
      for (const photo of selection.photos) {
        const bytes = Buffer.from(photo.dataUrl.slice(photo.dataUrl.indexOf(",") + 1), "base64");
        const valid = photo.dataUrl.startsWith("data:image/png") ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : photo.dataUrl.startsWith("data:image/jpeg") ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
        if (!valid || bytes.length > 2_000_000) throw new FlagshipStudentWorkErrorV3("invalid_revision", "笔记照片必须为不超过 2MB 的 PNG、JPEG 或 WebP 图片。");
      }
      if (selection.noteIds.length && !this.options.selectedNotes) throw new FlagshipStudentWorkErrorV3("invalid_revision", "当前运行环境未启用笔记附件。");
      const notes = selection.noteIds.length ? await this.options.selectedNotes!({ sessionId: input.sessionId, principalId: input.principalId, noteIds: selection.noteIds, notebookRevision: selection.notebookRevision! }) : [];
      const supplement = { revisionId: revision.revisionId, notes, photos: selection.photos, submittedAt: timestamp };
      const next = FlagshipStudentWorkRecordSchema.parse({
        ...record,
        recordRevision: record.recordRevision + 1,
        supplements: [...(record.supplements ?? []), { ...supplement, contentHash: hash(supplement) }],
        artifacts: record.artifacts.map((candidate, index) => index === artifactIndex
          ? {
              ...candidate,
              status: "submitted",
              submittedRevisionId: revision.revisionId,
              updatedAt: timestamp,
            }
          : candidate),
        requestReceipts: [...record.requestReceipts, {
          requestId: input.requestId,
          operation: "submit_revision",
          requestHash,
          artifactId: input.artifactId,
          resultRevisionId: revision.revisionId,
          createdAt: timestamp,
        }],
        updatedAt: timestamp,
      });
      const operation = this.options.businessOperations
        ? await this.options.businessOperations.commitAuthority(
            operationInput,
            async () => {
              await this.options.store.compareAndSet(
                input.sessionId,
                record.recordRevision,
                next,
              );
              return { commitRef: revision.revisionId };
            },
          )
        : null;
      if (!this.options.businessOperations) {
        await this.options.store.compareAndSet(
          input.sessionId,
          record.recordRevision,
          next,
        );
      }
      return {
        workspace: this.#project(next, []),
        operationId: operation?.operationId ?? null,
        revisionId: revision.revisionId,
      };
    });
    if (outcome.operationId !== null) {
      await this.#deliverSubmissionProjection(outcome.operationId, {
        sessionId: input.sessionId, artifactId: input.artifactId, revisionId: outcome.revisionId,
      });
    }
    return outcome.workspace;
  }

  /** Resume only a previously committed revision; no student action or new work is synthesized. */
  async recoverSubmissionProjection(operation: BusinessOperationReceipt): Promise<void> {
    if (operation.operationKind !== "submit_work_revision" || !operation.authorityCommitRef || !operation.scope.artifactId) {
      throw new FlagshipStudentWorkErrorV3("invalid_revision", "恢复需要已有作品权威提交");
    }
    const record = await this.options.store.load(operation.scope.sourceSessionId);
    const receipt = record?.requestReceipts.find(item => item.requestId === operation.requestId && item.operation === "submit_revision");
    if (!receipt || receipt.requestHash !== operation.requestHash || receipt.artifactId !== operation.scope.artifactId || receipt.resultRevisionId !== operation.authorityCommitRef
      || !record!.revisions.some(item => item.revisionId === receipt.resultRevisionId && item.artifactId === receipt.artifactId)) {
      throw new FlagshipStudentWorkErrorV3("invalid_revision", "恢复收据与已提交作品不一致，保留原记录");
    }
    await this.#deliverSubmissionProjection(operation.operationId, {
      sessionId: operation.scope.sourceSessionId, artifactId: receipt.artifactId, revisionId: receipt.resultRevisionId,
    });
  }

  async #deliverSubmissionProjection(operationId: string, input: { sessionId: string; artifactId: string; revisionId: string }): Promise<void> {
    if (!this.options.businessOperations) throw new FlagshipStudentWorkErrorV3("not_ready", "业务恢复协调器尚未装配");
    await this.options.businessOperations.deliverOutbox(
        operationId,
        {
          refresh_assessment_projection: async () => {
            const refresh = this.options.afterSubmissionCommitted;
            if (!refresh) {
              throw new FlagshipStudentWorkErrorV3(
                "not_ready",
                "作品送审投影处理器尚未完成装配",
              );
            }
            return { resultRef: await refresh(input) };
          },
        },
      );
  }

  async assertWorldActionReference(input: {
    sessionId: string;
    bindingId: string;
    principalId: string;
    actorId: string;
    challengeLevel: 3 | 4 | 5 | 6 | 7;
    eventTemplateId: string;
    action: StudentWorkAction["action"];
  }): Promise<void> {
    const action = input.action;
    if (action.verb !== "draft" && action.verb !== "submit") return;
    const record = await this.#withLock(input.sessionId, () => this.#loadOrCreate(input));
    const expectedArtifact = ({
      "event-template-draft-story": "artifact-feature-story",
      "event-template-publication": "artifact-feature-story",
      "event-template-limited-alert": "artifact-multiplatform-script",
      "event-template-correction": "artifact-publication-correction-decision",
    } as Record<string, string>)[input.eventTemplateId];
    if (!expectedArtifact || action.artifactId !== expectedArtifact) {
      throw new FlagshipStudentWorkErrorV3(
        "reference_drift",
        "当前世界行动与作品类型不一致",
      );
    }
    const artifact = record.artifacts.find(
      (candidate) => candidate.artifactId === action.artifactId,
    );
    const revision = record.revisions.find(
      (candidate) => candidate.revisionId === action.revisionId,
    );
    if (!artifact || !revision
      || artifact.latestRevisionId !== revision.revisionId
      || revision.contentHash !== action.contentHash) {
      throw new FlagshipStudentWorkErrorV3(
        "reference_drift",
        "世界行动引用的作品版本或内容哈希已漂移",
      );
    }
    if (action.verb === "draft") {
      if (input.eventTemplateId !== "event-template-draft-story") {
        throw new FlagshipStudentWorkErrorV3("reference_drift", "草稿行动只能进入专题稿审阅事件");
      }
      return;
    }
    if (artifact.status !== "submitted"
      || artifact.submittedRevisionId !== revision.revisionId
      || action.evidenceRefs.some((reference) => !revision.evidenceRefs.includes(reference))) {
      throw new FlagshipStudentWorkErrorV3(
        "not_ready",
        "世界提交必须引用已锁定送审的最新版本及其真实证据",
      );
    }
    if (input.eventTemplateId === "event-template-publication") {
      const completion = this.#completion(record);
      if (!completion.readyForPublication) {
        throw new FlagshipStudentWorkErrorV3(
          "not_ready",
          `发布门尚缺：${completion.blockingArtifactTitles.join("、")}`,
        );
      }
    }
  }

  async loadRecord(sessionId: string): Promise<FlagshipStudentWorkRecordV3 | null> {
    return this.options.store.load(sessionId);
  }
  async submittedWorks(sessionId: string) {
    const record = await this.options.store.load(sessionId);
    if (!record) return { sessionId, works: [] };
    await this.manifestForSession(sessionId,record);
    const receipts = new Map(record.requestReceipts.filter(receipt => receipt.operation === "submit_revision").map(receipt => [receipt.artifactId, receipt]));
    return { sessionId, works: [...receipts.values()].map(receipt => {
      const revision = record.revisions.find(revision => revision.revisionId === receipt.resultRevisionId)!;
      const definition = this.#definition(receipt.artifactId, record);
      return { artifactId: receipt.artifactId, title: definition.title, revisionNumber: revision.revisionNumber,
        fields: revision.fields.map(field => ({ label: definition.editableFields.find(item => item.fieldId === field.fieldId)?.label ?? field.fieldId, content: field.content })),
        supplement: record.supplements?.find(supplement => supplement.revisionId === revision.revisionId) ?? null, submittedAt: receipt.createdAt };
    }) };
  }

  async getReviewWorkspace(input: {
    sessionId: string;
    challengeLevel: 3 | 4 | 5 | 6 | 7;
  }) {
    const record = await this.options.store.load(input.sessionId);
    const manifest = await this.manifestForSession(input.sessionId,record);
    if (record && (
      record.challengeLevel !== input.challengeLevel
      || record.manifestId !== manifest.manifestId
      || record.manifestContentHash !== manifest.contentHash
    )) {
      throw new FlagshipStudentWorkErrorV3(
        "manifest_drift",
        "旗舰作品与当前内容或挑战发布版不一致",
      );
    }
    const required = manifest.artifacts.filter((definition) => (
      definition.requiredAtChallengeLevels.includes(input.challengeLevel)
    ));
    const artifactRecord = (artifactId: string) => record?.artifacts.find(
      (artifact) => artifact.artifactId === artifactId,
    ) ?? null;
    const latestRevision = (artifact: FlagshipStudentWorkRecordV3["artifacts"][number] | null) => (
      !record || artifact?.latestRevisionId === null || artifact === null
        ? null
        : record.revisions.find(
            (revision) => revision.revisionId === artifact.latestRevisionId,
          ) ?? null
    );
    const submittedRequiredCount = required.filter((definition) => (
      artifactRecord(definition.artifactId)?.status === "submitted"
    )).length;
    return {
      schemaVersion: FlagshipWorkReviewViewVersion,
      sessionId: input.sessionId,
      challengeLevel: input.challengeLevel,
      manifest: {
        manifestId: manifest.manifestId,
        contentHash: manifest.contentHash,
        title: manifest.title,
      },
      completion: {
        requiredArtifactCount: required.length,
        submittedRequiredCount,
        readyForPublication: submittedRequiredCount === required.length,
      },
      artifacts: manifest.artifacts.map((definition) => {
        const artifact = artifactRecord(definition.artifactId);
        const revision = latestRevision(artifact);
        return {
          artifactId: definition.artifactId,
          title: definition.title,
          artifactKind: definition.artifactKind,
          required: definition.requiredAtChallengeLevels.includes(input.challengeLevel),
          status: artifact?.status ?? "empty",
          revisionCount: artifact?.revisionCount ?? 0,
          submittedRevisionId: artifact?.submittedRevisionId ?? null,
          submittedSupplement: record?.supplements?.find(item => item.revisionId === artifact?.submittedRevisionId) ?? null,
          latestRevision: revision ? structuredClone(revision) : null,
          mechanicalCompletion: artifact
            ? artifactCompletion(definition, artifact, revision)
            : {
                mechanicalReady: false,
                missingFields: definition.editableFields.map((field) => field.label),
                evidenceReady: true,
                minimumEvidenceCount: 0,
                revisionReady: true,
              },
          updatedAt: artifact?.updatedAt ?? null,
        };
      }),
      updatedAt: record?.updatedAt ?? null,
    };
  }

  async manifestForSession(sessionId: string, expected?: FlagshipStudentWorkRecordV3 | null): Promise<FlagshipWorkDefinitionV3> {
    const manifest = await this.options.resolveManifest?.(sessionId) ?? this.options.manifest;
    if (expected && (expected.sessionId !== sessionId || expected.manifestId !== manifest.manifestId || expected.manifestContentHash !== manifest.contentHash))
      throw new FlagshipStudentWorkErrorV3("manifest_drift", "作品与开课时冻结的成果计划不一致");
    this.#manifests.set(manifest.contentHash,manifest); return manifest;
  }
  #manifest(record: FlagshipStudentWorkRecordV3): FlagshipWorkDefinitionV3 {
    const manifest = this.#manifests.get(record.manifestContentHash);
    if (!manifest) throw new FlagshipStudentWorkErrorV3("manifest_drift", "作品的冻结成果计划尚未装载");
    return manifest;
  }
  #definition(artifactId: string, record: FlagshipStudentWorkRecordV3): XunpuFlagshipArtifactV3 {
    const definition = this.#manifest(record).artifacts.find(artifact => artifact.artifactId === artifactId);
    if (!definition) {
      throw new FlagshipStudentWorkErrorV3("not_found", `未知旗舰作品：${artifactId}`);
    }
    return definition;
  }

  #now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  async #loadOrCreate(input: {
    sessionId: string;
    bindingId: string;
    principalId: string;
    actorId: string;
    challengeLevel: 3 | 4 | 5 | 6 | 7;
  }): Promise<FlagshipStudentWorkRecordV3> {
    const current = await this.options.store.load(input.sessionId);
    const manifest = await this.manifestForSession(input.sessionId,current);
    if (current) {
      if (current.ownerPrincipalId !== input.principalId
        || current.actorId !== input.actorId) {
        throw new FlagshipStudentWorkErrorV3("access_denied", "旗舰作品不属于当前学生记者");
      }
      if (current.challengeLevel !== input.challengeLevel
        || current.manifestId !== manifest.manifestId
        || current.manifestContentHash !== manifest.contentHash) {
        throw new FlagshipStudentWorkErrorV3("manifest_drift", "旗舰作品与当前内容或挑战发布版不一致");
      }
      return current;
    }
    const timestamp = this.#now();
    const created = FlagshipStudentWorkRecordSchema.parse({
      recordVersion: FlagshipStudentWorkRecordVersion,
      recordRevision: 0,
      sessionId: input.sessionId,
      bindingId: input.bindingId,
      ownerPrincipalId: input.principalId,
      actorId: input.actorId,
      challengeLevel: input.challengeLevel,
      manifestId: manifest.manifestId,
      manifestContentHash: manifest.contentHash,
      artifacts: manifest.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        status: "empty",
        latestRevisionId: null,
        revisionCount: 0,
        submittedRevisionId: null,
        updatedAt: timestamp,
      })),
      revisions: [],
      requestReceipts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      await this.options.store.create(created);
      return created;
    } catch (error) {
      if (!(error instanceof FlagshipStudentWorkErrorV3)
        || error.code !== "revision_conflict") throw error;
      const raced = await this.options.store.load(input.sessionId);
      if (!raced) throw error;
      return this.#loadOrCreate(input);
    }
  }

  #replay(
    record: FlagshipStudentWorkRecordV3,
    requestId: string,
    requestHash: string,
    operation: "save_revision" | "submit_revision",
  ) {
    const receipt = record.requestReceipts.find((candidate) => candidate.requestId === requestId);
    if (!receipt) return null;
    if (receipt.requestHash !== requestHash || receipt.operation !== operation) {
      throw new FlagshipStudentWorkErrorV3(
        "request_replay_conflict",
        "同一请求 ID 不得承载不同作品操作",
      );
    }
    return receipt;
  }

  #completion(record: FlagshipStudentWorkRecordV3) {
    const required = this.#manifest(record).artifacts.filter((definition) => (
      definition.requiredAtChallengeLevels.includes(record.challengeLevel)
    ));
    const blockingArtifactTitles: string[] = [];
    for (const definition of required) {
      const artifact = record.artifacts.find((item) => item.artifactId === definition.artifactId)!;
      if (artifact.status !== "submitted") blockingArtifactTitles.push(definition.title);
    }
    return {
      requiredArtifactCount: required.length,
      submittedRequiredCount: required.length - blockingArtifactTitles.length,
      readyForPublication: blockingArtifactTitles.length === 0,
      blockingArtifactTitles,
    };
  }

  #project(
    record: FlagshipStudentWorkRecordV3,
    evidenceCatalog: FlagshipEvidenceOptionV3[],
  ) {
    return {
      schemaVersion: FlagshipStudentWorkspaceViewVersion,
      sessionId: record.sessionId,
      challengeLevel: record.challengeLevel,
      manifest: {
        manifestId: record.manifestId,
        contentHash: record.manifestContentHash,
        title: this.#manifest(record).title,
        expectedDurationMinutes: this.#manifest(record).expectedDurationMinutes,
      },
      completion: this.#completion(record),
      evidenceCatalog: structuredClone(evidenceCatalog),
      artifacts: this.#manifest(record).artifacts.map((definition) => {
        const artifact = record.artifacts.find((item) => item.artifactId === definition.artifactId)!;
        const latestRevision = artifact.latestRevisionId === null
          ? null
          : record.revisions.find((revision) => revision.revisionId === artifact.latestRevisionId)!;
        return {
          artifactId: definition.artifactId,
          title: definition.title,
          artifactKind: definition.artifactKind,
          required: definition.requiredAtChallengeLevels.includes(record.challengeLevel),
          conflictDomainRefs: [...definition.conflictDomainRefs],
          editableFields: structuredClone(definition.editableFields),
          completionChecks: [...definition.completionChecks],
          evidenceRequirements: [...definition.evidenceRequirements],
          status: artifact.status,
          revisionCount: artifact.revisionCount,
          latestRevision: latestRevision ? structuredClone(latestRevision) : null,
          submittedSupplement: record.supplements?.find(item => item.revisionId === artifact.submittedRevisionId) ?? null,
          mechanicalCompletion: artifactCompletion(definition, artifact, latestRevision),
          updatedAt: artifact.updatedAt,
        };
      }),
      updatedAt: record.updatedAt,
    };
  }

  async #withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const queued = previous.then(() => current);
    this.#locks.set(sessionId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(sessionId) === queued) this.#locks.delete(sessionId);
    }
  }
}

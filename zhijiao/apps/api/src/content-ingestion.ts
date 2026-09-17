import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export type ContentIngestionKind =
  | "official"
  | "course_material"
  | "interview"
  | "user_upload"
  | "web_capture"
  | "simulation";

export type SupportedUploadMimeType =
  | "application/pdf"
  | "text/plain"
  | "image/jpeg"
  | "image/png"
  | "audio/mpeg"
  | "audio/wav"
  | "video/mp4";

export type ContentIngestionPurpose = "teaching" | "retrieval" | "model_context" | "publication" | "audit";

export interface ContentIngestionAuthorizationRequest {
  action: "source_write" | "processing_write" | "source_read";
  sourceId: string;
  courseId?: string | null;
  subjectRef?: string | null;
  purpose?: ContentIngestionPurpose;
}

export type ContentIngestionAuthorize = (
  request: ContentIngestionAuthorizationRequest,
) => boolean | Promise<boolean>;

export interface ContentIngestionObjectStore {
  put(input: {
    sessionId: string;
    bytes: Buffer;
    contentHash: string;
  }): Promise<{ sourceRef: string; contentHash: string; sizeBytes: number }>;
  get?(sourceRef: string): Promise<Buffer>;
  read?(sourceRef: string): Promise<Buffer>;
}

export interface ContentIngestionFragment {
  ordinal: number;
  text: string;
  locator: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ContentIngestionProcessorResult {
  processorVersion: string;
  fragments: ContentIngestionFragment[];
  metadata: Record<string, unknown>;
  capabilityGaps: Array<{ code: string; message: string }>;
}

export interface ContentIngestionProcessor {
  /** Bump when processing code or configuration changes; binds idempotency before execution. */
  readonly processorId?: string;
  process(input: {
    kind: "document" | "image" | "audio" | "video";
    mimeType: string;
    filePath: string;
    signal?: AbortSignal | undefined;
  }): Promise<ContentIngestionProcessorResult>;
}

export interface ContentIngestionStorePort {
  upsertSourceDocument(input: {
    sourceId: string;
    courseId?: string | null;
    kind: ContentIngestionKind;
    title: string;
    publisher?: string | null;
    canonicalUrl?: string | null;
    rightsNote?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  ingestSourceRevision(input: {
    sourceId: string;
    sourceVersion: string;
    sourceByteHash: string | null;
    mimeType: string;
    byteSize: number;
    objectKey?: string | null;
    publicationDate?: string | null;
    accessedAt?: string;
    status?: "current" | "historical" | "failed";
    metadata?: Record<string, unknown>;
    fragments: ReadonlyArray<{
      fragmentId?: string;
      ordinal: number;
      text: string;
      locator: Record<string, unknown>;
      contentHash?: string;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<{
    document: unknown;
    revision: {
      revisionId: string;
      sourceVersion: string;
      sourceByteHash: string | null;
      fragments: Array<{ fragmentId: string; ordinal: number }>;
    };
    fragments: Array<{ fragmentId: string; ordinal: number }>;
    idempotent: boolean;
  }>;
  createAsset(input: {
    assetId?: string;
    sourceRevisionId?: string | null;
    courseId?: string | null;
    objectKey: string;
    assetKind: "document" | "image" | "audio" | "video" | "other";
    mimeType: string;
    byteSize: number;
    sourceByteHash: string;
    metadata?: Record<string, unknown>;
    rightsStatus?: "unknown" | "pending" | "granted" | "restricted" | "revoked";
    aiDisclosure?: "not_applicable" | "declared" | "missing";
  }): Promise<{ assetId: string; objectKey: string; sourceByteHash: string }>;
  getAsset?(assetId: string): Promise<{
    assetId: string;
    objectKey: string;
    sourceRevisionId?: string | null;
    mimeType: string;
    byteSize: number;
    sourceByteHash: string;
    metadata?: Record<string, unknown>;
  } | null>;
  createProcessingJob(input: {
    jobId?: string;
    assetId: string;
    sourceRevisionId: string;
    kind: "parse_text" | "parse_pdf" | "ocr" | "asr";
    provider?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ContentProcessingJob>;
  updateProcessingJob(input: {
    jobId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    errorCode?: string | null;
    outputMetadata?: Record<string, unknown> | null;
    incrementAttempt?: boolean;
  }): Promise<ContentProcessingJob>;
  listProcessingJobs(input?: {
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    limit?: number;
  }): Promise<ContentProcessingJob[]>;
  grantUsage(input: {
    grantId?: string;
    sourceRevisionId?: string | null;
    assetId?: string | null;
    courseId?: string | null;
    purpose: ContentIngestionPurpose;
    scope: "course" | "session" | "role" | "public";
    subjectRef?: string | null;
    grantedBy: string;
    status?: "active" | "expired" | "revoked";
    expiresAt?: string | null;
    note?: string | null;
  }): Promise<unknown>;
}

export interface ContentProcessingJob {
  jobId: string;
  assetId: string;
  sourceRevisionId: string;
  kind: "parse_text" | "parse_pdf" | "ocr" | "asr";
  idempotencyKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attemptCount: number;
  errorCode: string | null;
  outputMetadata: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface ContentIngestionInput {
  sourceId: string;
  courseId?: string | null;
  kind: ContentIngestionKind;
  title: string;
  publisher?: string | null;
  canonicalUrl?: string | null;
  rightsNote?: string | null;
  fileName: string;
  mimeType: SupportedUploadMimeType;
  bytes?: Buffer;
  localFilePath?: string;
  sourceVersion?: string;
  publicationDate?: string | null;
  storageSessionId: string;
  purpose?: ContentIngestionPurpose;
  scope?: "course" | "session" | "role" | "public";
  subjectRef?: string | null;
  grantedBy: string;
  signal?: AbortSignal | undefined;
}

export interface ContentIngestionResult {
  status: "completed" | "failed" | "cancelled" | "already_completed";
  asset: { assetId: string; objectKey: string; sourceByteHash: string };
  rawRevisionId: string;
  parsedRevisionId?: string;
  job: ContentProcessingJob;
  capabilityGaps: Array<{ code: string; message: string }>;
}

export class ContentIngestionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ContentIngestionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeUpload(
  bytes: Buffer,
  mimeType: SupportedUploadMimeType,
  fileName: string,
): void {
  const normalizedName = fileName.trim();
  const extension = extname(normalizedName).toLowerCase();
  const allowedExtensions: Record<SupportedUploadMimeType, readonly string[]> = {
    "application/pdf": [".pdf"],
    "text/plain": [".txt", ".md"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "audio/mpeg": [".mp3"],
    "audio/wav": [".wav"],
    "video/mp4": [".mp4"],
  };
  if (
    !normalizedName
    || normalizedName.length > 160
    || basename(normalizedName) !== normalizedName
    || !allowedExtensions[mimeType].includes(extension)
    || bytes.length === 0
  ) throw new ContentIngestionError("unsafe_upload", "资料文件名、扩展名或正文不符合导入约束");
  let valid = true;
  if (mimeType === "application/pdf") valid = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") valid = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "audio/wav") valid = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mimeType === "audio/mpeg") valid = bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  if (mimeType === "video/mp4") valid = bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mimeType === "text/plain") {
    try {
      if (bytes.includes(0)) throw new Error("binary");
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new ContentIngestionError("mime_signature_mismatch", "资料正文与声明 MIME 类型不匹配");
}

function mediaKindForMime(mimeType: string): "document" | "image" | "audio" | "video" {
  if (mimeType === "application/pdf" || mimeType === "text/plain") return "document";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  throw new ContentIngestionError("unsupported_media_type", `不支持的资料 MIME 类型：${mimeType}`);
}

function processingKindForMime(mimeType: string): "parse_text" | "parse_pdf" | "ocr" | "asr" {
  if (mimeType === "application/pdf") return "parse_pdf";
  if (mimeType === "text/plain") return "parse_text";
  if (mimeType.startsWith("image/")) return "ocr";
  return "asr";
}

function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof ContentIngestionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "cancelled", message: error.message, retryable: true };
  }
  return {
    code: "ingestion_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function abortError(): Error {
  const error = new Error("内容摄入已取消");
  error.name = "AbortError";
  return error;
}

type AttemptHistoryEvent = {
  attempt: number;
  status: "running" | "retry_requested" | "completed" | "failed" | "cancelled";
  code?: string;
  at: string;
};

function attemptHistory(outputMetadata: Record<string, unknown> | null | undefined): AttemptHistoryEvent[] {
  const raw = outputMetadata?.attemptHistory;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AttemptHistoryEvent => (
    !!item && typeof item === "object"
    && typeof (item as Record<string, unknown>).attempt === "number"
    && typeof (item as Record<string, unknown>).status === "string"
    && typeof (item as Record<string, unknown>).at === "string"
  ));
}

function withAttemptEvent(
  outputMetadata: Record<string, unknown> | null | undefined,
  event: AttemptHistoryEvent,
): Record<string, unknown> {
  return {
    ...(outputMetadata ?? {}),
    attemptHistory: [...attemptHistory(outputMetadata), event],
  };
}

function runCommand(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const onAbort = () => {
      child.kill();
      finishError(abortError());
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finishError(error));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new ContentIngestionError(
          "local_tool_failed",
          `${command} exited with ${code}: ${stderr.trim() || "no stderr"}`,
          true,
        ));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function runPythonWorker(input: {
  executable: string;
  workerPath: string;
  kind: "pdf" | "image" | "asr";
  path: string;
  modelName: string;
  modelDir: string;
  signal?: AbortSignal | undefined;
}): Promise<ContentIngestionProcessorResult> {
  const result = await runCommand(input.executable, [
    input.workerPath,
    "--kind", input.kind,
    "--path", input.path,
    "--model-name", input.modelName,
    "--model-dir", input.modelDir,
  ], input.signal);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new ContentIngestionError("worker_invalid_output", `Python worker output is not JSON: ${result.stdout.slice(0, 300)}`, true);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ContentIngestionError("worker_invalid_output", "Python worker returned a non-object result", true);
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.ok === false) {
    const error = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : {};
    throw new ContentIngestionError(
      typeof error.code === "string" ? error.code : "worker_failed",
      typeof error.message === "string" ? error.message : "Python worker failed",
      error.retryable !== false,
    );
  }
  return {
    processorVersion: `python-worker/${input.kind}/1.0.2-utf8-paragraph`,
    fragments: Array.isArray(raw.fragments) ? raw.fragments as ContentIngestionFragment[] : [],
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Record<string, unknown> : {},
    capabilityGaps: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter((item): item is { code: string; message: string } => (
        !!item && typeof item === "object"
        && typeof (item as Record<string, unknown>).code === "string"
        && typeof (item as Record<string, unknown>).message === "string"
      ))
      : [],
  };
}

export class LocalContentIngestionProcessor implements ContentIngestionProcessor {
  readonly processorId: string;
  readonly #pythonExecutable: string;
  readonly #workerPath: string;
  readonly #modelName: string;
  readonly #modelDir: string;

  constructor(options: {
    pythonExecutable?: string;
    workerPath?: string;
    modelName?: string;
    modelDir?: string;
  } = {}) {
    this.#pythonExecutable = options.pythonExecutable
      ?? process.env.RONGGANG_CONTENT_PYTHON
      ?? "python";
    this.#workerPath = resolve(
      options.workerPath ?? join(process.cwd(), "packages/media-processing/worker/content_ingestion_worker.py"),
    );
    this.#modelName = options.modelName ?? "tiny";
    this.#modelDir = resolve(options.modelDir ?? join(process.cwd(), ".local/be007-models"));
    this.processorId = `local-content-worker/1.0.2-utf8-paragraph:${this.#modelName}`;
  }

  async process(input: {
    kind: "document" | "image" | "audio" | "video";
    mimeType: string;
    filePath: string;
    signal?: AbortSignal | undefined;
  }): Promise<ContentIngestionProcessorResult> {
    if (input.kind === "document" && input.mimeType === "text/plain") {
      const text = (await readFile(input.filePath, "utf8")).trim();
      return {
        processorVersion: "node-text/1.0.0",
        fragments: text ? [{ ordinal: 0, text, locator: { startChar: 0, endChar: text.length, label: "全文" }, metadata: { representation: "extracted-source" } }] : [],
        metadata: { representation: "extracted-source" },
        capabilityGaps: text ? [] : [{ code: "empty_text", message: "文本文件没有可解析正文" }],
      };
    }
    if (input.kind === "document") {
      return runPythonWorker({
        executable: this.#pythonExecutable,
        workerPath: this.#workerPath,
        kind: "pdf",
        path: input.filePath,
        modelName: this.#modelName,
        modelDir: this.#modelDir,
        signal: input.signal,
      });
    }
    if (input.kind === "image") {
      return runPythonWorker({
        executable: this.#pythonExecutable,
        workerPath: this.#workerPath,
        kind: "image",
        path: input.filePath,
        modelName: this.#modelName,
        modelDir: this.#modelDir,
        signal: input.signal,
      });
    }

    let audioPath = input.filePath;
    let temporaryDirectory: string | null = null;
    let videoMetadata: Record<string, unknown> = {};
    try {
      if (input.kind === "video") {
        const probe = await runCommand("ffprobe", [
          "-v", "error",
          "-show_entries", "stream=codec_type,duration:format=duration",
          "-of", "json",
          input.filePath,
        ], input.signal);
        const parsed = JSON.parse(probe.stdout) as {
          streams?: Array<{ codec_type?: string; duration?: string }>;
          format?: { duration?: string };
        };
        const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
        if (!audio) {
          return {
            processorVersion: "ffprobe/video/1.0.0",
            fragments: [{
              ordinal: 0,
              text: `视频元数据：时长 ${parsed.format?.duration ?? "unknown"} 秒；未发现音轨。`,
              locator: { startMs: 0, endMs: Number(parsed.format?.duration ?? 0) * 1000, label: "视频全片" },
              metadata: { representation: "metadata-only", asr: "no_audio_stream" },
            }],
            metadata: { ...videoMetadata, duration: parsed.format?.duration ?? null, hasAudio: false },
            capabilityGaps: [{ code: "audio_stream_missing", message: "视频没有可供 ASR 处理的音轨" }],
          };
        }
        temporaryDirectory = await mkdtemp(join(tmpdir(), "ronggang-be007-video-"));
        audioPath = join(temporaryDirectory, "audio.wav");
        await runCommand("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", input.filePath,
          "-map", "0:a:0",
          "-ac", "1", "-ar", "16000",
          audioPath,
        ], input.signal);
        videoMetadata = {
          duration: parsed.format?.duration ?? null,
          audioCodecDuration: audio.duration ?? null,
          extractedAudio: true,
        };
      }
      const result = await runPythonWorker({
        executable: this.#pythonExecutable,
        workerPath: this.#workerPath,
        kind: "asr",
        path: audioPath,
        modelName: this.#modelName,
        modelDir: this.#modelDir,
        signal: input.signal,
      });
      return {
        ...result,
        metadata: { ...videoMetadata, ...result.metadata },
      };
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export interface ContentIngestionServiceOptions {
  store: ContentIngestionStorePort;
  objectStore: ContentIngestionObjectStore;
  authorize: ContentIngestionAuthorize;
  processor?: ContentIngestionProcessor;
  now?: () => string;
}

export function createContentIngestionService(
  options: ContentIngestionServiceOptions,
): ContentIngestionService {
  return new ContentIngestionService(options);
}

export interface ContentIngestionAuthorizeInput {
  action: "source_write" | "processing_write" | "source_read";
  sourceId: string;
  courseId?: string | null;
  subjectRef?: string | null;
  purpose?: ContentIngestionPurpose;
}

export class ContentIngestionService {
  readonly #store: ContentIngestionStorePort;
  readonly #objectStore: ContentIngestionObjectStore;
  readonly #authorize: ContentIngestionAuthorize;
  readonly #processor: ContentIngestionProcessor;
  readonly #now: () => string;

  constructor(options: ContentIngestionServiceOptions) {
    this.#store = options.store;
    this.#objectStore = options.objectStore;
    this.#authorize = options.authorize;
    this.#processor = options.processor ?? new LocalContentIngestionProcessor();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** HTTP composition should call this bytes-only entry point; localFilePath remains worker/test-only. */
  async ingestBytes(input: ContentIngestionInput & { bytes: Buffer }): Promise<ContentIngestionResult> {
    return this.ingest(input);
  }

  async ingest(input: ContentIngestionInput): Promise<ContentIngestionResult> {
    await this.#assertAuthorized({
      action: "source_write",
      sourceId: input.sourceId,
      courseId: input.courseId ?? null,
      subjectRef: input.subjectRef ?? null,
      purpose: input.purpose ?? "teaching",
    });
    const bytes = input.bytes ?? await this.#readLocalInput(input);
    assertSafeUpload(bytes, input.mimeType, input.fileName);
    const contentHash = sha256(bytes);
    const storage = await this.#objectStore.put({
      sessionId: input.storageSessionId,
      bytes,
      contentHash,
    });
    if (storage.contentHash !== contentHash || storage.sizeBytes !== bytes.length) {
      throw new ContentIngestionError("object_store_commit_mismatch", "对象存储未确认原件 hash 或大小", true);
    }
    await this.#store.upsertSourceDocument({
      sourceId: input.sourceId,
      courseId: input.courseId ?? null,
      kind: input.kind,
      title: input.title,
      publisher: input.publisher ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      rightsNote: input.rightsNote ?? null,
      metadata: {
        ingestion: "BE-007",
        fileName: input.fileName,
        representation: "original-bytes",
      },
    });
    const originalVersion = input.sourceVersion ?? `original-${contentHash.slice(0, 16)}`;
    const rawRevisionResult = await this.#store.ingestSourceRevision({
      sourceId: input.sourceId,
      sourceVersion: originalVersion,
      sourceByteHash: contentHash,
      mimeType: input.mimeType,
      byteSize: bytes.length,
      objectKey: storage.sourceRef,
      publicationDate: input.publicationDate ?? null,
      accessedAt: this.#now(),
      status: "current",
      metadata: {
        ingestion: "BE-007",
        fileName: input.fileName,
        representation: "original-bytes",
        objectRef: storage.sourceRef,
      },
      fragments: [],
    });
    const asset = await this.#store.createAsset({
      sourceRevisionId: rawRevisionResult.revision.revisionId,
      courseId: input.courseId ?? null,
      objectKey: storage.sourceRef,
      assetKind: mediaKindForMime(input.mimeType),
      mimeType: input.mimeType,
      byteSize: bytes.length,
      sourceByteHash: contentHash,
      metadata: { fileName: input.fileName, representation: "original-bytes" },
      rightsStatus: "pending",
      aiDisclosure: "not_applicable",
    });
    const job = await this.#store.createProcessingJob({
      assetId: asset.assetId,
      sourceRevisionId: rawRevisionResult.revision.revisionId,
      kind: processingKindForMime(input.mimeType),
      provider: this.#processor.processorId ?? "custom-content-worker/1.0.0",
      idempotencyKey: `be007:${input.sourceId}:${originalVersion}:${contentHash}:${this.#processor.processorId ?? "custom-content-worker/1.0.0"}`,
      metadata: {
        sourceId: input.sourceId,
        sourceVersion: originalVersion,
        fileName: input.fileName,
        mimeType: input.mimeType,
        storageSessionId: input.storageSessionId,
        objectRef: storage.sourceRef,
        courseId: input.courseId ?? null,
        purpose: input.purpose ?? "teaching",
        scope: input.scope ?? "course",
        subjectRef: input.subjectRef ?? null,
        grantedBy: input.grantedBy,
        processorId: this.#processor.processorId ?? "custom-content-worker/1.0.0",
      },
    });
    if (job.status === "succeeded") {
      return {
        status: "already_completed",
        asset,
        rawRevisionId: rawRevisionResult.revision.revisionId,
        job,
        capabilityGaps: [],
      };
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "ronggang-be007-input-"));
    const filePath = join(temporaryDirectory, input.fileName);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    try {
      return await this.#runJob({
        job,
        filePath,
        mimeType: input.mimeType,
        sourceId: input.sourceId,
        rawRevisionId: rawRevisionResult.revision.revisionId,
        rawVersion: originalVersion,
        contentHash,
        byteSize: bytes.length,
        objectKey: storage.sourceRef,
        courseId: input.courseId ?? null,
        purpose: input.purpose ?? "teaching",
        scope: input.scope ?? "course",
        subjectRef: input.subjectRef ?? null,
        grantedBy: input.grantedBy,
        signal: input.signal,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async recoverRunningJobs(): Promise<number> {
    const running = await this.#store.listProcessingJobs({ status: "running", limit: 200 });
    for (const job of running) {
      await this.#store.updateProcessingJob({
        jobId: job.jobId,
        status: "queued",
        errorCode: "worker_restarted",
      });
    }
    return running.length;
  }

  /** Recover jobs after a process restart and actually resume them from stored bytes. */
  async resumePendingJobs(input: {
    includeFailed?: boolean;
    limit?: number;
    signal?: AbortSignal | undefined;
  } = {}): Promise<ContentProcessingJob[]> {
    await this.recoverRunningJobs();
    const jobs = await this.#store.listProcessingJobs({ limit: input.limit ?? 200 });
    const candidates = jobs.filter((job) => (
      job.status === "queued" || (input.includeFailed === true && job.status === "failed")
    ));
    const finished: ContentProcessingJob[] = [];
    for (const job of candidates) {
      if (input.signal?.aborted) break;
      const metadata = job.metadata ?? {};
      try {
        if (!this.#store.getAsset) throw new ContentIngestionError("resume_store_incomplete", "内容库没有 getAsset 恢复端口");
        const asset = await this.#store.getAsset(job.assetId);
        if (!asset) throw new ContentIngestionError("asset_missing", `恢复找不到素材：${job.assetId}`);
        const sourceId = typeof metadata.sourceId === "string" ? metadata.sourceId : "";
        if (!sourceId) throw new ContentIngestionError("resume_metadata_missing", "处理任务缺少 sourceId，不能安全恢复");
        await this.#assertAuthorized({
          action: "processing_write",
          sourceId,
          courseId: typeof metadata.courseId === "string" ? metadata.courseId : null,
          subjectRef: typeof metadata.subjectRef === "string" ? metadata.subjectRef : null,
          purpose: typeof metadata.purpose === "string" ? metadata.purpose as ContentIngestionPurpose : "teaching",
        });
        const bytes = await this.#readStoredObject(asset.objectKey);
        const actualHash = sha256(bytes);
        if (actualHash !== asset.sourceByteHash) {
          throw new ContentIngestionError("source_hash_mismatch", `恢复读取原件 hash 不匹配：${asset.objectKey}`);
        }
        const temporaryDirectory = await mkdtemp(join(tmpdir(), "ronggang-be007-resume-"));
        const fileName = typeof metadata.fileName === "string" && metadata.fileName
          ? basename(metadata.fileName)
          : `${asset.assetId}${extname(asset.objectKey) || ".bin"}`;
        const filePath = join(temporaryDirectory, fileName);
        await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
        try {
          const result = await this.#runJob({
            job,
            filePath,
            mimeType: asset.mimeType,
            sourceId,
            rawRevisionId: job.sourceRevisionId,
            rawVersion: typeof metadata.sourceVersion === "string" ? metadata.sourceVersion : `recovered-${job.sourceRevisionId}`,
            contentHash: asset.sourceByteHash,
            byteSize: bytes.length,
            objectKey: asset.objectKey,
            courseId: typeof metadata.courseId === "string" ? metadata.courseId : null,
            purpose: typeof metadata.purpose === "string" ? metadata.purpose as ContentIngestionPurpose : "teaching",
            scope: typeof metadata.scope === "string" ? metadata.scope as "course" | "session" | "role" | "public" : "course",
            subjectRef: typeof metadata.subjectRef === "string" ? metadata.subjectRef : null,
            grantedBy: typeof metadata.grantedBy === "string" ? metadata.grantedBy : "be007-recovery",
            signal: input.signal,
          });
          finished.push(result.job);
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      } catch (error) {
        const safe = safeError(error);
        finished.push(await this.#store.updateProcessingJob({
          jobId: job.jobId,
          status: safe.code === "cancelled" ? "cancelled" : "failed",
          errorCode: safe.code,
          outputMetadata: { message: safe.message, retryable: safe.retryable },
        }));
      }
    }
    return finished;
  }

  async #runJob(input: {
    job: ContentProcessingJob;
    filePath: string;
    mimeType: string;
    sourceId: string;
    rawRevisionId: string;
    rawVersion: string;
    contentHash: string;
    byteSize: number;
    objectKey: string;
    courseId?: string | null;
    purpose: ContentIngestionPurpose;
    scope: "course" | "session" | "role" | "public";
    subjectRef?: string | null;
    grantedBy: string;
    signal?: AbortSignal | undefined;
  }): Promise<ContentIngestionResult> {
    const kind = mediaKindForMime(input.mimeType);
    let jobForRun = input.job;
    if (jobForRun.status === "cancelled") {
      jobForRun = await this.#store.updateProcessingJob({
        jobId: jobForRun.jobId,
        status: "queued",
        errorCode: "retry_requested",
        outputMetadata: withAttemptEvent(jobForRun.outputMetadata, {
          attempt: jobForRun.attemptCount,
          status: "retry_requested",
          code: "retry_requested",
          at: this.#now(),
        }),
      });
    }
    const running = await this.#store.updateProcessingJob({
      jobId: jobForRun.jobId,
      status: "running",
      incrementAttempt: true,
      outputMetadata: withAttemptEvent(jobForRun.outputMetadata, {
        attempt: jobForRun.attemptCount + 1,
        status: "running",
        at: this.#now(),
      }),
    });
    try {
      if (input.signal?.aborted) throw abortError();
      const processed = await this.#processor.process({
        kind,
        mimeType: input.mimeType,
        filePath: input.filePath,
        signal: input.signal,
      });
      if (input.signal?.aborted) throw abortError();
      if (processed.capabilityGaps.length > 0 && processed.fragments.length === 0) {
        const gap = processed.capabilityGaps[0]!;
        const failed = await this.#store.updateProcessingJob({
          jobId: running.jobId,
          status: "failed",
          errorCode: gap.code,
          outputMetadata: {
            ...withAttemptEvent(running.outputMetadata, {
              attempt: running.attemptCount,
              status: "failed",
              code: gap.code,
              at: this.#now(),
            }),
            capabilityGaps: processed.capabilityGaps,
            processorVersion: processed.processorVersion,
          },
        });
        return {
          status: "failed",
          asset: { assetId: input.job.assetId, objectKey: input.objectKey, sourceByteHash: input.contentHash },
          rawRevisionId: input.rawRevisionId,
          job: failed,
          capabilityGaps: processed.capabilityGaps,
        };
      }
      const parsedVersion = `${input.rawVersion}:processed:${processed.processorVersion}`;
      const parsed = await this.#store.ingestSourceRevision({
        sourceId: input.sourceId,
        sourceVersion: parsedVersion,
        sourceByteHash: input.contentHash,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        objectKey: input.objectKey,
        accessedAt: this.#now(),
        status: "current",
        metadata: {
          ingestion: "BE-007",
          derivedFromRevisionId: input.rawRevisionId,
          processorMetadata: processed.metadata,
          representation: "parsed-source",
          processorVersion: processed.processorVersion,
          capabilityGaps: processed.capabilityGaps,
        },
        fragments: processed.fragments,
      });
      await this.#store.grantUsage({
        sourceRevisionId: parsed.revision.revisionId,
        assetId: input.job.assetId,
        courseId: input.courseId ?? null,
        purpose: input.purpose,
        scope: input.scope,
        subjectRef: input.subjectRef ?? null,
        grantedBy: input.grantedBy,
        status: "active",
        note: processed.capabilityGaps.length > 0
          ? `处理完成但存在能力缺口：${processed.capabilityGaps.map((gap) => gap.code).join(",")}`
          : "BE-007 local processing",
      });
      const finished = await this.#store.updateProcessingJob({
        jobId: running.jobId,
        status: "succeeded",
        outputMetadata: {
          ...(running.outputMetadata ?? {}),
          parsedRevisionId: parsed.revision.revisionId,
          fragmentCount: parsed.fragments.length,
          processorVersion: processed.processorVersion,
          capabilityGaps: processed.capabilityGaps,
          attemptHistory: [...attemptHistory(running.outputMetadata), {
            attempt: running.attemptCount,
            status: "completed",
            at: this.#now(),
          }],
        },
      });
      return {
        status: "completed",
        asset: { assetId: input.job.assetId, objectKey: input.objectKey, sourceByteHash: input.contentHash },
        rawRevisionId: input.rawRevisionId,
        parsedRevisionId: parsed.revision.revisionId,
        job: finished,
        capabilityGaps: processed.capabilityGaps,
      };
    } catch (error) {
      const safe = safeError(error);
      const status = safe.code === "cancelled" ? "cancelled" : "failed";
      const failed = await this.#store.updateProcessingJob({
        jobId: running.jobId,
        status,
        errorCode: safe.code,
        outputMetadata: {
          ...(running.outputMetadata ?? {}),
          message: safe.message,
          retryable: safe.retryable,
          attemptHistory: [...attemptHistory(running.outputMetadata), {
            attempt: running.attemptCount,
            status,
            code: safe.code,
            at: this.#now(),
          }],
        },
      });
      return {
        status,
        asset: { assetId: input.job.assetId, objectKey: input.objectKey, sourceByteHash: input.contentHash },
        rawRevisionId: input.rawRevisionId,
        job: failed,
        capabilityGaps: [{ code: safe.code, message: safe.message }],
      };
    }
  }

  async #readStoredObject(sourceRef: string): Promise<Buffer> {
    const reader = this.#objectStore.get ?? this.#objectStore.read;
    if (!reader) throw new ContentIngestionError("object_store_read_missing", "对象存储没有读取端口");
    return reader.call(this.#objectStore, sourceRef);
  }

  async #readLocalInput(input: ContentIngestionInput): Promise<Buffer> {
    if (!input.localFilePath) {
      throw new ContentIngestionError("input_missing", "必须提供 bytes 或明确的 localFilePath");
    }
    const path = resolve(input.localFilePath);
    const bytes = await readFile(path);
    if (!bytes.length) throw new ContentIngestionError("input_empty", "本地资料为空");
    return bytes;
  }

  async #assertAuthorized(input: ContentIngestionAuthorizationRequest): Promise<void> {
    if (!(await this.#authorize(input))) {
      throw new ContentIngestionError("authorization_denied", `资料摄入授权被拒绝：${input.sourceId}`);
    }
  }
}

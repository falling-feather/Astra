import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  AgentRunTraceSchema,
  CandidateEventSchema,
  GovernanceFindingSchema,
  MaterialSchema,
  MediaProcessingOutputSchema,
  MediaProcessingTaskSchema,
  ObservationSchema,
  RoleMessageSchema,
  WorldFactSchema,
  type Material,
  type ScenarioPackage,
  type StateProjection,
  type WorldEvent,
} from "@ronggang/contracts";
import type {
  MediaProcessingWorkItem,
} from "@ronggang/media-processing";
import { syncDirectoryEntry } from "./local-data-directory-lease.js";

const mimeDefinitions = {
  "text/plain": {
    mediaType: "text",
    extensions: [".txt", ".md"],
  },
  "application/pdf": {
    mediaType: "document",
    extensions: [".pdf"],
  },
  "image/jpeg": {
    mediaType: "image",
    extensions: [".jpg", ".jpeg"],
  },
  "image/png": {
    mediaType: "image",
    extensions: [".png"],
  },
  "audio/mpeg": {
    mediaType: "audio",
    extensions: [".mp3"],
  },
  "audio/wav": {
    mediaType: "audio",
    extensions: [".wav"],
  },
  "video/mp4": {
    mediaType: "video",
    extensions: [".mp4"],
  },
} as const satisfies Record<string, {
  mediaType: Material["mediaType"];
  extensions: readonly string[];
}>;

export type SupportedUploadMimeType = keyof typeof mimeDefinitions;

export const supportedUploadMimeTypes = Object.keys(
  mimeDefinitions,
) as SupportedUploadMimeType[];

export interface StoredObject {
  contentHash: string;
  sizeBytes: number;
  sourceRef: string;
}

export interface ObjectStore {
  put(input: {
    sessionId: string;
    bytes: Buffer;
    contentHash: string;
  }): Promise<StoredObject>;
  get?(sourceRef: string): Promise<Buffer>;
}

export function parseObjectSourceRef(
  sourceRef: string,
): { sessionId: string; contentHash: string } {
  const match = /^object:\/\/([a-zA-Z0-9_-]{1,80})\/([a-f0-9]{64})$/u.exec(
    sourceRef,
  );
  if (!match?.[1] || !match[2]) {
    throw new Error("对象存储引用无效");
  }
  return { sessionId: match[1], contentHash: match[2] };
}

/**
 * Extracts only contract-declared reference fields. Free-form bodies, event
 * summaries, prompts and arbitrary payload strings are deliberately excluded:
 * a user typing `object://...` must never turn into a durable object edge.
 */
export function collectRecoveryObjectSourceRefs(input: {
  scenario: ScenarioPackage;
  projection: StateProjection;
  mediaWorkItems: readonly MediaProcessingWorkItem[];
  events: readonly WorldEvent[];
}): string[] {
  const eventReferences: string[] = [];
  for (const event of input.events) {
    if (event.eventType === "material_registered") {
      eventReferences.push(
        MaterialSchema.parse(event.payload.material).sourceRef,
      );
    } else if (event.eventType === "material_observed") {
      eventReferences.push(
        ObservationSchema.parse(event.payload.observation).sourceRef,
      );
    } else if (event.eventType === "media_processing_requested") {
      const task = MediaProcessingTaskSchema.parse(event.payload.task);
      eventReferences.push(
        task.inputRef,
        ...task.steps.flatMap((step) => (
          step.output ? [step.output.sourceRef] : []
        )),
      );
    } else if (
      event.eventType === "media_processing_step_completed"
      || event.eventType === "media_processing_manual_supplied"
    ) {
      eventReferences.push(
        MediaProcessingOutputSchema.parse(event.payload.output).sourceRef,
      );
    } else if (
      event.eventType === "world_fact_confirmed"
      || event.eventType === "world_fact_updated"
    ) {
      eventReferences.push(
        ...WorldFactSchema.parse(event.payload.fact).sourceRefs,
      );
    } else if (
      event.eventType === "agent_message_posted"
      || event.eventType === "role_message_posted"
    ) {
      eventReferences.push(
        ...RoleMessageSchema.parse(event.payload.message).sourceRefs,
      );
    } else if (event.eventType === "candidate_event_proposed") {
      eventReferences.push(
        ...CandidateEventSchema.parse(event.payload.candidate).sourceRefs,
      );
    } else if (event.eventType === "governance_review_arbitrated") {
      const findings = Array.isArray(event.payload.findings)
        ? event.payload.findings
        : [];
      for (const finding of findings) {
        eventReferences.push(
          GovernanceFindingSchema.parse(finding).sourceRef,
        );
      }
    } else if (event.eventType === "agent_run_recorded") {
      const trace = AgentRunTraceSchema.parse(event.payload.trace);
      if (trace.contextManifest) {
        const manifestItems = [
          ...Object.values(trace.contextManifest.layers).flat(),
          ...trace.contextManifest.droppedItems,
        ];
        for (const item of manifestItems) {
          eventReferences.push(
            ...item.sourceRefs.map((sourceRef) => sourceRef.source),
          );
        }
      }
    }
  }
  const candidates = [
    ...input.scenario.materials.map((material) => material.sourceRef),
    ...(input.scenario.directorEventTemplates ?? [])
      .flatMap((template) => template.sourceRefs),
    ...input.projection.materials.map((material) => material.sourceRef),
    ...input.projection.mediaProcessingTasks.flatMap((task) => [
      task.inputRef,
      ...task.steps.flatMap((step) => (
        step.output ? [step.output.sourceRef] : []
      )),
    ]),
    ...input.projection.governanceFindings.map((finding) => finding.sourceRef),
    ...input.projection.facts.flatMap((fact) => fact.sourceRefs),
    ...input.projection.roleMessages.flatMap((message) => message.sourceRefs),
    ...input.projection.pendingCandidates.flatMap(
      (candidate) => candidate.sourceRefs,
    ),
    ...input.projection.candidateHistory.flatMap(
      (candidate) => candidate.sourceRefs,
    ),
    ...input.mediaWorkItems.map((item) => item.inputRef),
    ...eventReferences,
  ];
  return [...new Set(candidates.filter((sourceRef) => (
    sourceRef.startsWith("object://")
  )))].sort();
}

function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export async function inspectReferencedObjectIntegrity(input: {
  objectStore: ObjectStore;
  sessionId: string;
  sourceRefs: readonly string[];
}): Promise<{
  count: number;
  commitments: string[];
  integrityHash: string;
}> {
  const sorted = [...new Set(input.sourceRefs)].sort();
  const descriptors: {
    referenceHash: string;
    contentHash: string;
    sizeBytes: number;
  }[] = [];
  for (const sourceRef of sorted) {
    const parsed = parseObjectSourceRef(sourceRef);
    if (parsed.sessionId !== input.sessionId) {
      throw new Error("恢复完整性发现跨会话对象引用");
    }
    if (!input.objectStore.get) {
      throw new Error("当前对象存储不能验证恢复引用");
    }
    const bytes = await input.objectStore.get(sourceRef);
    const contentHash = sha256(bytes);
    if (contentHash !== parsed.contentHash) {
      throw new Error("恢复完整性对象正文哈希不匹配");
    }
    descriptors.push({
      referenceHash: sha256(Buffer.from(sourceRef, "utf8")),
      contentHash,
      sizeBytes: bytes.length,
    });
  }
  return {
    count: descriptors.length,
    commitments: descriptors.map((descriptor) => sha256Json({
      domain: "ronggang.referenced-object-commitment.v1",
      descriptor,
    })).sort(),
    integrityHash: sha256Json(descriptors),
  };
}

export class InMemoryContentAddressedObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Buffer>();

  async put(input: {
    sessionId: string;
    bytes: Buffer;
    contentHash: string;
  }): Promise<StoredObject> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(input.sessionId)) {
      throw new Error("对象存储会话标识不安全");
    }
    if (sha256(input.bytes) !== input.contentHash) {
      throw new Error("对象存储内容哈希不匹配");
    }
    const key = `${input.sessionId}:${input.contentHash}`;
    const existing = this.#objects.get(key);
    if (existing && !existing.equals(input.bytes)) {
      throw new Error("相同内容哈希已绑定不同内容");
    }
    this.#objects.set(key, Buffer.from(input.bytes));
    return {
      contentHash: input.contentHash,
      sizeBytes: input.bytes.length,
      sourceRef: `object://${input.sessionId}/${input.contentHash}`,
    };
  }

  async get(sourceRef: string): Promise<Buffer> {
    const { sessionId, contentHash } = parseObjectSourceRef(sourceRef);
    const bytes = this.#objects.get(`${sessionId}:${contentHash}`);
    if (!bytes) throw new Error("对象存储内容不存在");
    if (sha256(bytes) !== contentHash) {
      throw new Error("对象存储读取哈希不匹配");
    }
    return Buffer.from(bytes);
  }

  count(): number {
    return this.#objects.size;
  }
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function mediaTypeForMime(
  mimeType: string,
): Material["mediaType"] | null {
  return mimeDefinitions[mimeType as SupportedUploadMimeType]?.mediaType
    ?? null;
}

export function assertSafeUpload(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): asserts mimeType is SupportedUploadMimeType {
  const definition = mimeDefinitions[
    mimeType as SupportedUploadMimeType
  ];
  if (!definition) throw new Error("不支持的上传 MIME 类型");
  const normalizedName = fileName.trim();
  if (
    !normalizedName
    || normalizedName.length > 160
    || basename(normalizedName) !== normalizedName
    || normalizedName.includes("/")
    || normalizedName.includes("\\")
  ) {
    throw new Error("上传文件名不安全");
  }
  const extension = extname(normalizedName).toLowerCase();
  if (!definition.extensions.includes(
    extension as never,
  )) {
    throw new Error("上传文件扩展名与 MIME 类型不匹配");
  }
  if (bytes.length === 0) throw new Error("上传文件不能为空");

  let signatureValid = true;
  if (mimeType === "application/pdf") {
    signatureValid = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  } else if (mimeType === "image/png") {
    signatureValid = bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  } else if (mimeType === "image/jpeg") {
    signatureValid = bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  } else if (mimeType === "audio/wav") {
    signatureValid = bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  } else if (mimeType === "audio/mpeg") {
    signatureValid = bytes.subarray(0, 3).toString("ascii") === "ID3"
      || (
        bytes.length >= 2
        && bytes[0] === 0xff
        && (bytes[1]! & 0xe0) === 0xe0
      );
  } else if (mimeType === "video/mp4") {
    signatureValid = bytes.subarray(4, 8).toString("ascii") === "ftyp";
  } else if (mimeType === "text/plain") {
    try {
      if (bytes.includes(0)) throw new Error("binary");
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      signatureValid = false;
    }
  }
  if (!signatureValid) {
    throw new Error("上传文件内容与声明的 MIME 类型不匹配");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

async function assertPhysicalDirectory(
  root: string,
  directory: string,
): Promise<{ rootRealPath: string; directoryRealPath: string }> {
  const [rootInfo, directoryInfo] = await Promise.all([
    lstat(root),
    lstat(directory),
  ]);
  if (
    !rootInfo.isDirectory()
    || rootInfo.isSymbolicLink()
    || !directoryInfo.isDirectory()
    || directoryInfo.isSymbolicLink()
  ) {
    throw new Error("对象存储目录不得是符号链接或非目录");
  }
  const [rootRealPath, directoryRealPath] = await Promise.all([
    realpath(root),
    realpath(directory),
  ]);
  if (
    rootRealPath !== directoryRealPath
    && !isWithin(rootRealPath, directoryRealPath)
  ) {
    throw new Error("对象存储物理目录越界");
  }
  await chmod(rootRealPath, 0o700);
  if (directoryRealPath !== rootRealPath) {
    await chmod(directoryRealPath, 0o700);
  }
  return { rootRealPath, directoryRealPath };
}

async function assertOpenedFileStillAtPath(
  directoryRealPath: string,
  path: string,
  opened: Stats,
): Promise<void> {
  const pathInfo = await lstat(path);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
    throw new Error("对象存储正文不得是符号链接或非普通文件");
  }
  if (pathInfo.dev !== opened.dev || pathInfo.ino !== opened.ino) {
    throw new Error("对象存储正文路径在读取期间发生替换");
  }
  const physicalPath = await realpath(path);
  if (!isWithin(directoryRealPath, physicalPath)) {
    throw new Error("对象存储正文物理路径越界");
  }
}

async function readPhysicalObjectFile(
  root: string,
  sessionDir: string,
  path: string,
): Promise<Buffer> {
  const { directoryRealPath } = await assertPhysicalDirectory(root, sessionDir);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new Error("对象存储正文不是普通文件");
    }
    await assertOpenedFileStillAtPath(directoryRealPath, path, opened);
    await handle.chmod(0o600);
    const bytes = await handle.readFile();
    const afterRead = await handle.stat();
    if (
      afterRead.dev !== opened.dev
      || afterRead.ino !== opened.ino
      || afterRead.size !== bytes.length
    ) {
      throw new Error("对象存储正文在读取期间发生变化");
    }
    const currentDirectory = await assertPhysicalDirectory(root, sessionDir);
    await assertOpenedFileStillAtPath(
      currentDirectory.directoryRealPath,
      path,
      opened,
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

export class LocalContentAddressedObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(input: {
    sessionId: string;
    bytes: Buffer;
    contentHash: string;
  }): Promise<StoredObject> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(input.sessionId)) {
      throw new Error("对象存储会话标识不安全");
    }
    if (!/^[a-f0-9]{64}$/u.test(input.contentHash)) {
      throw new Error("对象存储内容哈希无效");
    }
    if (sha256(input.bytes) !== input.contentHash) {
      throw new Error("对象存储内容哈希不匹配");
    }
    const sessionDir = resolve(this.#root, input.sessionId);
    const finalPath = resolve(sessionDir, `${input.contentHash}.blob`);
    if (
      !isWithin(this.#root, sessionDir)
      || !isWithin(sessionDir, finalPath)
    ) {
      throw new Error("对象存储路径越界");
    }
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await assertPhysicalDirectory(this.#root, this.#root);
    try {
      await mkdir(sessionDir, { recursive: false, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertPhysicalDirectory(this.#root, sessionDir);
    await syncDirectoryEntry(dirname(this.#root));
    await syncDirectoryEntry(dirname(sessionDir));
    try {
      const current = await readPhysicalObjectFile(
        this.#root,
        sessionDir,
        finalPath,
      );
      if (
        current.length !== input.bytes.length
        || sha256(current) !== input.contentHash
      ) {
        throw new Error("相同内容哈希已绑定不同对象正文");
      }
      return {
        contentHash: input.contentHash,
        sizeBytes: input.bytes.length,
        sourceRef: `object://${input.sessionId}/${input.contentHash}`,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporaryPath = resolve(
      sessionDir,
      `${input.contentHash}.${crypto.randomUUID()}.tmp`,
    );
    if (!isWithin(sessionDir, temporaryPath)) {
      throw new Error("对象存储临时路径越界");
    }
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const opened = await handle.stat();
      await assertOpenedFileStillAtPath(
        (await assertPhysicalDirectory(this.#root, sessionDir))
          .directoryRealPath,
        temporaryPath,
        opened,
      );
      await handle.writeFile(input.bytes);
      await handle.sync();
      const afterWrite = await handle.stat();
      if (afterWrite.size !== input.bytes.length) {
        throw new Error("对象存储临时正文写入不完整");
      }
      await assertOpenedFileStillAtPath(
        (await assertPhysicalDirectory(this.#root, sessionDir))
          .directoryRealPath,
        temporaryPath,
        afterWrite,
      );
    } finally {
      await handle.close();
    }
    try {
      await assertPhysicalDirectory(this.#root, sessionDir);
      await link(temporaryPath, finalPath);
      const installed = await readPhysicalObjectFile(
        this.#root,
        sessionDir,
        finalPath,
      );
      if (
        installed.length !== input.bytes.length
        || sha256(installed) !== input.contentHash
      ) {
        throw new Error("对象存储发布后的正文哈希不匹配");
      }
      await unlink(temporaryPath);
      await syncDirectoryEntry(sessionDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      const current = await readPhysicalObjectFile(
        this.#root,
        sessionDir,
        finalPath,
      );
      await unlink(temporaryPath).catch(() => undefined);
      if (
        current.length !== input.bytes.length
        || sha256(current) !== input.contentHash
      ) {
        throw new Error("相同内容哈希已绑定不同对象正文");
      }
    }
    return {
      contentHash: input.contentHash,
      sizeBytes: input.bytes.length,
      sourceRef: `object://${input.sessionId}/${input.contentHash}`,
    };
  }

  async get(sourceRef: string): Promise<Buffer> {
    const { sessionId, contentHash } = parseObjectSourceRef(sourceRef);
    const sessionDir = resolve(this.#root, sessionId);
    const finalPath = resolve(sessionDir, `${contentHash}.blob`);
    if (
      !isWithin(this.#root, sessionDir)
      || !isWithin(sessionDir, finalPath)
    ) {
      throw new Error("对象存储路径越界");
    }
    const bytes = await readPhysicalObjectFile(
      this.#root,
      sessionDir,
      finalPath,
    );
    if (sha256(bytes) !== contentHash) {
      throw new Error("对象存储读取哈希不匹配");
    }
    return bytes;
  }
}

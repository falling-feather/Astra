import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import {embedPngTeachingDisclosure,TeachingMediaDisclosureText} from '@ronggang/media-processing';
import {
  MediaWorkRevisionV4Schema,
  MediaWorkRevisionV4SchemaVersion,
  type FlagshipContentReferenceV4,
  type MediaTransformationV4,
  type MediaWorkRevisionV4,
} from "@ronggang/contracts";
import {
  xunpuFlagshipContentV4,
  type XunpuFlagshipContentV4,
  type XunpuMediaAssetV4,
} from "@ronggang/course-content";

const execFileAsync = promisify(execFile);

export const FlagshipMediaWorkspaceV4SchemaVersion =
  "flagship-media-workspace/4.0.0" as const;

type MediaKindV4 = MediaWorkRevisionV4["sourceAssets"][number]["mediaKind"];
type DerivedMediaAssetV4 = MediaWorkRevisionV4["derivedAssets"][number];

export interface FlagshipMediaCatalogItemV4 {
  assetRef: string;
  title: string;
  mediaKind: MediaKindV4;
  publicPath: string;
  contentHash: string;
  rightsReceiptRef: string;
  rightsStatus: "cleared" | "limited" | "withdrawn";
  permittedUse: "teaching_preview" | "classroom_submission" | "simulated_publication";
  personConsentMode: "not_applicable" | "simulated_character" | "explicit_receipt";
  aiDisclosure: {
    explicitLabel: true;
    implicitMetadata: true;
    disclosureText: string;
  };
  sourceFactBoundary: string;
  transformable: boolean;
}

export interface FlagshipMediaWorkspaceV4 {
  schemaVersion: typeof FlagshipMediaWorkspaceV4SchemaVersion;
  sessionId: string;
  bindingId: string;
  processingMode: "actual_file_transform";
  catalog: FlagshipMediaCatalogItemV4[];
  revisions: MediaWorkRevisionV4[];
}

export type MediaRevisionOperationInputV4 =
  | {
      operationKind: "crop";
      inputAssetRef: string;
      region: { x: number; y: number; width: number; height: number };
      rationale: string;
    }
  | {
      operationKind: "trim";
      inputAssetRef: string;
      startMs: number;
      endMs: number;
      rationale: string;
    }
  | {
      operationKind: "redact";
      inputAssetRef: string;
      region: { x: number; y: number; width: number; height: number };
      redactionKind: "mask" | "mute" | "remove_metadata";
      rationale: string;
    }
  | {
      operationKind: "replace";
      inputAssetRef: string;
      replacementAssetRef: string;
      replacementReason:
        | "consent_withdrawn"
        | "rights_scope_mismatch"
        | "fact_risk"
        | "editorial_choice";
      rationale: string;
    };

export interface CreateFlagshipMediaRevisionV4Input {
  sessionId: string;
  bindingId: string;
  artifactRef: string;
  requestId: string;
  expectedRevisionNumber: number;
  status: "draft" | "locked" | "submitted";
  sourceAssetRefs: string[];
  operations: MediaRevisionOperationInputV4[];
  supportingEvidenceRefs: string[];
  studentEditorialRationale: string;
}

interface StoredMediaRevisionV4 {
  requestId: string;
  requestHash: string;
  revision: MediaWorkRevisionV4;
}

export interface FlagshipMediaRevisionStoreV4 {
  load(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
  }): Promise<StoredMediaRevisionV4[]>;
  save(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
    expectedRevisionNumber: number;
    record: StoredMediaRevisionV4;
  }): Promise<void>;
  findDerivedAsset(input: {
    sessionId: string;
    bindingId: string;
    assetRef: string;
  }): Promise<DerivedMediaAssetV4 | null>;
}

export class FlagshipMediaRevisionConflictV4 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlagshipMediaRevisionConflictV4";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function storeKey(input: {
  sessionId: string;
  bindingId: string;
  artifactRef: string;
}): string {
  return `${input.sessionId}\u0000${input.bindingId}\u0000${input.artifactRef}`;
}

function validateStored(value: unknown): StoredMediaRevisionV4 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("V4 媒体存储记录必须为对象");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "string"
    || typeof record.requestHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.requestHash)) {
    throw new Error("V4 媒体存储请求收据非法");
  }
  return {
    requestId: record.requestId,
    requestHash: record.requestHash,
    revision: MediaWorkRevisionV4Schema.parse(record.revision),
  };
}

export class InMemoryFlagshipMediaRevisionStoreV4
implements FlagshipMediaRevisionStoreV4 {
  readonly #records = new Map<string, StoredMediaRevisionV4[]>();

  async load(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
  }): Promise<StoredMediaRevisionV4[]> {
    return structuredClone(this.#records.get(storeKey(input)) ?? []);
  }

  async save(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
    expectedRevisionNumber: number;
    record: StoredMediaRevisionV4;
  }): Promise<void> {
    const key = storeKey(input);
    const current = this.#records.get(key) ?? [];
    if (current.length !== input.expectedRevisionNumber) {
      throw new FlagshipMediaRevisionConflictV4("媒体修订基于过期版本");
    }
    this.#records.set(key, [...current, validateStored(input.record)]);
  }

  async findDerivedAsset(input: {
    sessionId: string;
    bindingId: string;
    assetRef: string;
  }): Promise<DerivedMediaAssetV4 | null> {
    for (const records of this.#records.values()) {
      for (const record of records) {
        if (record.revision.sessionId !== input.sessionId
          || record.revision.bindingId !== input.bindingId) continue;
        const asset = record.revision.derivedAssets.find(
          (item) => item.assetRef === input.assetRef,
        );
        if (asset) return structuredClone(asset);
      }
    }
    return null;
  }
}

export class JsonFileFlagshipMediaRevisionStoreV4
implements FlagshipMediaRevisionStoreV4 {
  constructor(private readonly directory: string) {}

  async load(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
  }): Promise<StoredMediaRevisionV4[]> {
    try {
      const parsed = JSON.parse(await readFile(this.#path(input), "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("V4 媒体存储文件必须为数组");
      return parsed.map(validateStored);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
    expectedRevisionNumber: number;
    record: StoredMediaRevisionV4;
  }): Promise<void> {
    const current = await this.load(input);
    if (current.length !== input.expectedRevisionNumber) {
      throw new FlagshipMediaRevisionConflictV4("媒体修订基于过期版本");
    }
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(input);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify([...current, validateStored(input.record)], null, 2)}\n`, "utf8");
      await file.sync();
      await file.close();
      await rename(temporary, target);
      renamed = true;
    } finally {
      await file.close().catch(() => undefined);
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }

  async findDerivedAsset(input: {
    sessionId: string;
    bindingId: string;
    assetRef: string;
  }): Promise<DerivedMediaAssetV4 | null> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      const parsed = JSON.parse(await readFile(resolve(this.directory, file), "utf8")) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed.map(validateStored)) {
        if (item.revision.sessionId !== input.sessionId
          || item.revision.bindingId !== input.bindingId) continue;
        const asset = item.revision.derivedAssets.find(
          (candidate) => candidate.assetRef === input.assetRef,
        );
        if (asset) return structuredClone(asset);
      }
    }
    return null;
  }

  #path(input: {
    sessionId: string;
    bindingId: string;
    artifactRef: string;
  }): string {
    return resolve(this.directory, `${hash(storeKey(input))}.json`);
  }
}

interface ProbedMedia {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

function mediaKind(asset: XunpuMediaAssetV4): MediaKindV4 {
  if (asset.assetKind === "source_image") return "image";
  if (asset.assetKind === "synthetic_capture") return "synthetic_capture";
  if (asset.assetKind === "audio") return "audio";
  if (asset.assetKind === "video") return "video";
  throw new Error(`该资产不是学生源媒体：${asset.assetId}`);
}

function mimeFor(path: string, kind: MediaKindV4): DerivedMediaAssetV4["mimeType"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".mp4") return "video/mp4";
  throw new Error(`不支持的 V4 媒体扩展名：${extension} (${kind})`);
}

function assetFileName(asset: XunpuMediaAssetV4): string {
  return basename(asset.plannedRelativePath.replaceAll("\\", "/"));
}

function sourceRights(asset: XunpuMediaAssetV4) {
  const limited = [
    "asset-photo-tourist-close-01",
    "asset-photo-shop-sample-01",
    "asset-video-tourist-close-01",
  ].includes(asset.assetId);
  return {
    rightsReceiptRef: `rights-receipt-${asset.assetId}`,
    rightsStatus: limited ? "limited" as const : "cleared" as const,
    permittedUse: limited ? "teaching_preview" as const : "simulated_publication" as const,
  };
}

function sourceDisclosure() {
  return {
    explicitLabel: true as const,
    implicitMetadata: true as const,
    disclosureText: "项目原创生成或制作的教学仿真媒体；不能作为现实现场事实的证明。",
  };
}

function catalogItem(asset: XunpuMediaAssetV4): FlagshipMediaCatalogItemV4 {
  if (!asset.contentHash || asset.productionStatus !== "ready") {
    throw new Error(`媒体资产未就绪：${asset.assetId}`);
  }
  const rights = sourceRights(asset);
  return {
    assetRef: asset.assetId,
    title: asset.title,
    mediaKind: mediaKind(asset),
    publicPath: `/assets/flagship-world/v4/${assetFileName(asset)}`,
    contentHash: asset.contentHash,
    ...rights,
    personConsentMode: asset.personConsentMode,
    aiDisclosure: sourceDisclosure(),
    sourceFactBoundary: asset.sourceFactBoundary,
    transformable: asset.assetKind !== "synthetic_capture",
  };
}

export interface FlagshipMediaServiceV4Options {
  store: FlagshipMediaRevisionStoreV4;
  flagshipContentRef: FlagshipContentReferenceV4;
  assetDirectory: string;
  outputDirectory: string;
  content?: XunpuFlagshipContentV4;
  ffmpegPath?: string;
  ffprobePath?: string;
  now?: () => Date;
  resolvePublishedAssets?: (sessionId:string) => Promise<Array<{item:FlagshipMediaCatalogItemV4;sourcePath:string}> | null>;
}

export class FlagshipMediaServiceV4 {
  readonly #store: FlagshipMediaRevisionStoreV4;
  readonly #contentRef: FlagshipContentReferenceV4;
  readonly #content: XunpuFlagshipContentV4;
  readonly #assetDirectory: string;
  readonly #outputDirectory: string;
  readonly #ffmpegPath: string;
  readonly #ffprobePath: string;
  readonly #now: () => Date;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #resolvePublishedAssets: FlagshipMediaServiceV4Options['resolvePublishedAssets'];

  constructor(options: FlagshipMediaServiceV4Options) {
    this.#resolvePublishedAssets=options.resolvePublishedAssets;
    this.#store = options.store;
    this.#contentRef = structuredClone(options.flagshipContentRef);
    this.#content = options.content ?? xunpuFlagshipContentV4;
    this.#assetDirectory = options.assetDirectory;
    this.#outputDirectory = options.outputDirectory;
    this.#ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.#ffprobePath = options.ffprobePath ?? "ffprobe";
    this.#now = options.now ?? (() => new Date());
  }

  async getWorkspace(input: {
    sessionId: string;
    bindingId: string;
    artifactRef?: string;
  }): Promise<FlagshipMediaWorkspaceV4> {
    const artifactRef = input.artifactRef ?? "artifact-multiplatform-package";
    const records = await this.#store.load({ ...input, artifactRef });
    const published=await this.#resolvePublishedAssets?.(input.sessionId);
    return {
      schemaVersion: FlagshipMediaWorkspaceV4SchemaVersion,
      sessionId: input.sessionId,
      bindingId: input.bindingId,
      processingMode: "actual_file_transform",
      catalog: published ? published.map(asset=>structuredClone(asset.item)) : this.#catalog(),
      revisions: records.map((record) => structuredClone(record.revision)),
    };
  }

  async createRevision(
    input: CreateFlagshipMediaRevisionV4Input,
  ): Promise<FlagshipMediaWorkspaceV4> {
    return this.#serialized(storeKey(input), async () => {
      const requestHash = hash(input);
      const current = await this.#store.load(input);
      const replay = current.find((record) => record.requestId === input.requestId);
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new FlagshipMediaRevisionConflictV4("媒体请求 ID 已被不同内容占用");
        }
        return this.getWorkspace(input);
      }
      if (current.length !== input.expectedRevisionNumber) {
        throw new FlagshipMediaRevisionConflictV4("媒体修订基于过期版本");
      }
      if (input.sourceAssetRefs.length === 0 || input.sourceAssetRefs.length > 12) {
        throw new Error("源媒体数量必须为 1—12");
      }
      if (input.operations.length === 0 || input.operations.length > 20) {
        throw new Error("每个媒体修订必须包含 1—20 个真实处理动作");
      }
      if (new Set(input.sourceAssetRefs).size !== input.sourceAssetRefs.length) {
        throw new Error("源媒体引用不得重复");
      }
      const published=await this.#resolvePublishedAssets?.(input.sessionId);
      const catalog=published ? published.map(asset=>asset.item) : this.#catalog();
      const sourceAssets = input.sourceAssetRefs.map((assetRef) => {
        const selected = catalog.find((item) => item.assetRef === assetRef);
        if (!selected || !selected.transformable) {
          throw new Error(`源媒体不存在或不可处理：${assetRef}`);
        }
        return {
          assetRef: selected.assetRef,
          mediaKind: selected.mediaKind,
          contentHash: selected.contentHash,
          rightsReceiptRef: selected.rightsReceiptRef,
          rightsStatus: selected.rightsStatus,
          permittedUse: selected.permittedUse,
          personConsentMode: selected.personConsentMode,
          aiDisclosure: selected.aiDisclosure,
        };
      });
      const paths = new Map<string, { path: string; kind: MediaKindV4; parentRefs: string[] }>();
      for (const source of sourceAssets) {
        const sourcePath = published ? published.find(asset=>asset.item.assetRef===source.assetRef)!.sourcePath
          : resolve(this.#assetDirectory, assetFileName(this.#sourceDefinition(source.assetRef)));
        const actualHash = await fileHash(sourcePath);
        if (actualHash !== source.contentHash) {
          throw new Error(`源媒体字节与发布台账漂移：${source.assetRef}`);
        }
        paths.set(source.assetRef, {
          path: sourcePath,
          kind: source.mediaKind,
          parentRefs: [source.assetRef],
        });
      }
      await mkdir(this.#outputDirectory, { recursive: true });
      const transformations: MediaTransformationV4[] = [];
      const derivedAssets: DerivedMediaAssetV4[] = [];
      for (const [index, operation] of input.operations.entries()) {
        const source = paths.get(operation.inputAssetRef);
        if (!source) throw new Error(`媒体处理输入尚未登记：${operation.inputAssetRef}`);
        const outputAssetRef = stableId("derived-media", {
          sessionId: input.sessionId,
          bindingId: input.bindingId,
          requestId: input.requestId,
          index,
          operation,
        });
        const extension = extname(source.path).toLowerCase();
        const outputPath = resolve(this.#outputDirectory, `${outputAssetRef}${extension}`);
        const operationId = stableId("media-operation", { outputAssetRef, index });
        let parentRefs = [...source.parentRefs];
        if (operation.operationKind === "replace") {
          const replacement = paths.get(operation.replacementAssetRef);
          if (!replacement || replacement.kind !== source.kind) {
            throw new Error("替换素材必须已登记且与输入媒体类型一致");
          }
          await copyFile(replacement.path, outputPath);
          parentRefs = [...new Set([...parentRefs, ...replacement.parentRefs])];
          transformations.push({
            operationId,
            operationKind: "replace",
            inputAssetRef: operation.inputAssetRef,
            outputAssetRef,
            operatorKind: "student",
            rationale: operation.rationale,
            replacementAssetRef: operation.replacementAssetRef,
            replacementReason: operation.replacementReason,
          });
        } else {
          await this.#transform(source.path, outputPath, source.kind, operation);
          if (operation.operationKind === "crop") {
            transformations.push({
              operationId,
              operationKind: "crop",
              inputAssetRef: operation.inputAssetRef,
              outputAssetRef,
              operatorKind: "student",
              rationale: operation.rationale,
              region: operation.region,
            });
          } else if (operation.operationKind === "trim") {
            transformations.push({
              operationId,
              operationKind: "trim",
              inputAssetRef: operation.inputAssetRef,
              outputAssetRef,
              operatorKind: "student",
              rationale: operation.rationale,
              startMs: operation.startMs,
              endMs: operation.endMs,
            });
          } else {
            transformations.push({
              operationId,
              operationKind: "redact",
              inputAssetRef: operation.inputAssetRef,
              outputAssetRef,
              operatorKind: "student",
              rationale: operation.rationale,
              region: operation.region,
              redactionKind: operation.redactionKind,
            });
          }
        }
        await this.#preserveDisclosure(outputPath,source.kind);
        const metadata = await this.#probe(outputPath, source.kind);
        const file = await stat(outputPath);
        const derived: DerivedMediaAssetV4 = {
          assetRef: outputAssetRef,
          parentAssetRefs: parentRefs,
          mediaKind: source.kind,
          mimeType: mimeFor(outputPath, source.kind),
          contentHash: await fileHash(outputPath),
          byteLength: file.size,
          width: metadata.width,
          height: metadata.height,
          durationMs: metadata.durationMs,
          aiDisclosure: sourceDisclosure(),
          createdAt: this.#now().toISOString(),
        };
        derivedAssets.push(derived);
        paths.set(outputAssetRef, {
          path: outputPath,
          kind: source.kind,
          parentRefs: [outputAssetRef],
        });
      }
      const revisionNumber = current.length + 1;
      const draft = {
        schemaVersion: MediaWorkRevisionV4SchemaVersion,
        mediaRevisionId: stableId("media-revision", {
          sessionId: input.sessionId,
          bindingId: input.bindingId,
          artifactRef: input.artifactRef,
          revisionNumber,
          requestHash,
        }),
        sessionId: input.sessionId,
        bindingId: input.bindingId,
        flagshipContentRef: this.#contentRef,
        artifactRef: input.artifactRef,
        revisionNumber,
        parentRevisionRef: current.at(-1)?.revision.mediaRevisionId ?? null,
        status: input.status,
        submissionPolicy:'selected_media/3.0.0' as const,
        sourceAssets,
        transformations,
        derivedAssets,
        rightsLedgerRefs: sourceAssets.map((asset) => asset.rightsReceiptRef),
        supportingEvidenceRefs: [...new Set(input.supportingEvidenceRefs)],
        studentEditorialRationale: input.studentEditorialRationale,
        createdAt: this.#now().toISOString(),
      };
      const revision = MediaWorkRevisionV4Schema.parse({
        ...draft,
        contentHash: hash(draft),
      });
      await this.#store.save({
        sessionId: input.sessionId,
        bindingId: input.bindingId,
        artifactRef: input.artifactRef,
        expectedRevisionNumber: input.expectedRevisionNumber,
        record: { requestId: input.requestId, requestHash, revision },
      });
      return this.getWorkspace(input);
    });
  }

  async readDerivedAsset(input: {
    sessionId: string;
    bindingId: string;
    assetRef: string;
  }): Promise<{
    mimeType: string;
    contentHash: string;
    bytes: Buffer;
  }> {
    const asset = await this.#store.findDerivedAsset(input);
    if (!asset) throw new Error("派生媒体不存在");
    const extension = asset.mimeType === "image/png"
      ? ".png"
      : asset.mimeType === "image/svg+xml"
        ? ".svg"
        : asset.mimeType === "audio/wav"
          ? ".wav"
          : asset.mimeType === "audio/mpeg"
            ? ".mp3"
            : ".mp4";
    const path = resolve(this.#outputDirectory, `${asset.assetRef}${extension}`);
    const bytes = await readFile(path);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== asset.contentHash) {
      throw new Error("派生媒体字节与修订收据漂移");
    }
    return { mimeType: asset.mimeType, contentHash: asset.contentHash, bytes };
  }

  #catalog(): FlagshipMediaCatalogItemV4[] {
    return this.#content.mediaAssets
      .filter((asset) => ["source_image", "audio", "video", "synthetic_capture"]
        .includes(asset.assetKind))
      .filter((asset) => asset.productionStatus === "ready" && asset.contentHash !== null)
      .map(catalogItem);
  }

  async #preserveDisclosure(path:string,kind:MediaKindV4):Promise<void>{
    if(kind==='image'){await embedPngTeachingDisclosure(path);return;}
    if(kind!=='audio'&&kind!=='video')return;
    const extension=extname(path),temporary=`${path.slice(0,-extension.length)}.${randomUUID()}.disclosure${extension}`;
    try{
      await execFileAsync(this.#ffmpegPath,['-y','-i',path,'-map','0','-map_metadata','0','-metadata',`comment=${TeachingMediaDisclosureText}`,'-c','copy',temporary],{windowsHide:true});
      await rename(temporary,path);
    }finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
  }

  #sourceDefinition(assetRef: string): XunpuMediaAssetV4 {
    const asset = this.#content.mediaAssets.find((item) => item.assetId === assetRef);
    if (!asset) throw new Error(`媒体发布台账无该资产：${assetRef}`);
    return asset;
  }

  async #transform(
    inputPath: string,
    outputPath: string,
    kind: MediaKindV4,
    operation: Exclude<MediaRevisionOperationInputV4, { operationKind: "replace" }>,
  ): Promise<void> {
    if (operation.operationKind === "crop") {
      if (!(["image", "video"] as MediaKindV4[]).includes(kind)) {
        throw new Error("裁切只适用于图像或视频");
      }
      const { x, y, width, height } = operation.region;
      const filter = `crop=iw*${width}:ih*${height}:iw*${x}:ih*${y}`;
      const args = ["-y", "-i", inputPath, "-vf", filter];
      if (kind === "image") args.push("-frames:v", "1");
      else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac");
      args.push(outputPath);
      await execFileAsync(this.#ffmpegPath, args, { windowsHide: true });
      return;
    }
    if (operation.operationKind === "trim") {
      if (!(["audio", "video"] as MediaKindV4[]).includes(kind)) {
        throw new Error("时间裁切只适用于音频或视频");
      }
      if (operation.endMs <= operation.startMs) throw new Error("裁切结束时间必须晚于开始时间");
      const args = [
        "-y",
        "-ss", (operation.startMs / 1_000).toFixed(3),
        "-to", (operation.endMs / 1_000).toFixed(3),
        "-i", inputPath,
      ];
      if (kind === "audio") args.push("-c:a", extname(outputPath) === ".wav" ? "pcm_s16le" : "libmp3lame");
      else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac");
      args.push(outputPath);
      await execFileAsync(this.#ffmpegPath, args, { windowsHide: true });
      return;
    }
    if (operation.redactionKind === "mute") {
      if (!(["audio", "video"] as MediaKindV4[]).includes(kind)) {
        throw new Error("静音只适用于音频或视频");
      }
      const args = ["-y", "-i", inputPath, "-af", "volume=0"];
      if (kind === "video") args.push("-c:v", "copy", "-c:a", "aac");
      else args.push("-c:a", extname(outputPath) === ".wav" ? "pcm_s16le" : "libmp3lame");
      args.push(outputPath);
      await execFileAsync(this.#ffmpegPath, args, { windowsHide: true });
      return;
    }
    if (operation.redactionKind === "remove_metadata") {
      await execFileAsync(this.#ffmpegPath, [
        "-y", "-i", inputPath, "-map_metadata", "-1", "-c", "copy", outputPath,
      ], { windowsHide: true });
      return;
    }
    if (!(["image", "video"] as MediaKindV4[]).includes(kind)) {
      throw new Error("区域遮挡只适用于图像或视频");
    }
    const { x, y, width, height } = operation.region;
    const filter = `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${width}:h=ih*${height}:color=black@1:t=fill`;
    const args = ["-y", "-i", inputPath, "-vf", filter];
    if (kind === "image") args.push("-frames:v", "1");
    else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac");
    args.push(outputPath);
    await execFileAsync(this.#ffmpegPath, args, { windowsHide: true });
  }

  async #probe(path: string, kind: MediaKindV4): Promise<ProbedMedia> {
    const { stdout } = await execFileAsync(this.#ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,width,height,duration",
      "-of", "json",
      path,
    ], { windowsHide: true });
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
      }>;
      format?: { duration?: string };
    };
    const visual = parsed.streams?.find((stream) => stream.codec_type === "video");
    const timed = parsed.streams?.find((stream) => (
      stream.codec_type === "audio" || stream.codec_type === "video"
    ));
    const duration = Number(timed?.duration ?? parsed.format?.duration ?? 0);
    return {
      width: kind === "image" || kind === "video" || kind === "synthetic_capture"
        ? visual?.width ?? null
        : null,
      height: kind === "image" || kind === "video" || kind === "synthetic_capture"
        ? visual?.height ?? null
        : null,
      durationMs: kind === "audio" || kind === "video"
        ? Math.max(1, Math.round(duration * 1_000))
        : null,
    };
  }

  async #serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const chained = previous.then(() => current);
    this.#locks.set(key, chained);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#locks.get(key) === chained) this.#locks.delete(key);
    }
  }
}

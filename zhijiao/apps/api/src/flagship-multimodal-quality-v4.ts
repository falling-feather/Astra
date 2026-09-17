import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { MediaWorkRevisionV4 } from "@ronggang/contracts";
import {
  WorkQualityMediaInputV4Schema,
  type WorkQualityMediaInputV4,
  type WorkQualityMediaPreparationStatusV4,
} from "@ronggang/agent-orchestrator";

const execFileAsync = promisify(execFile);

type DerivedAssetV4 = MediaWorkRevisionV4["derivedAssets"][number];

export interface PreparedWorkQualityMediaInputsV4 {
  status: WorkQualityMediaPreparationStatusV4;
  inputs: WorkQualityMediaInputV4[];
  limitations: string[];
}

export interface MultimodalQualityAssetReaderV4 {
  readDerivedAsset(input: {
    sessionId: string;
    bindingId: string;
    assetRef: string;
  }): Promise<{
    mimeType: string;
    contentHash: string;
    bytes: Buffer;
  }>;
}

export interface FlagshipMultimodalQualityPreparerV4 {
  prepare(input: {
    revisions: MediaWorkRevisionV4[];
    reader: MultimodalQualityAssetReaderV4;
  }): Promise<PreparedWorkQualityMediaInputsV4>;
}

export class MultimodalMediaIntegrityErrorV4 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultimodalMediaIntegrityErrorV4";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)}`;
}

function extensionFor(mimeType: string): string {
  return ({
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/svg+xml": ".svg",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
  } as Record<string, string>)[mimeType] ?? ".bin";
}

function eligible(revision: MediaWorkRevisionV4): boolean {
  return revision.status === "submitted"
    && revision.sourceAssets.every((asset) => (
      asset.rightsStatus !== "withdrawn"
      && ["classroom_submission", "simulated_publication"].includes(asset.permittedUse)
      && asset.aiDisclosure.explicitLabel
      && asset.aiDisclosure.implicitMetadata
    ))
    && revision.derivedAssets.every((asset) => (
      asset.aiDisclosure.explicitLabel && asset.aiDisclosure.implicitMetadata
    ));
}

function technicalContext(asset: DerivedAssetV4, detail: string): string {
  const geometry = asset.width !== null && asset.height !== null
    ? `${asset.width}×${asset.height}`
    : "无画面尺寸";
  const duration = asset.durationMs === null
    ? "非时长媒体"
    : `时长 ${asset.durationMs}ms`;
  return `${asset.mediaKind}；${geometry}；${duration}；${detail}`.slice(0, 600);
}

function frameTimes(durationMs: number | null): number[] {
  if (durationMs === null || durationMs <= 1) return [0];
  return [...new Set([0.2, 0.5, 0.8].map((ratio) => (
    Math.max(0, Math.min(durationMs - 1, Math.round(durationMs * ratio)))
  )))];
}

function safeAssetFileStem(assetRef: string): string {
  // V2 identifiers may legitimately contain route-like separators. Never use a
  // business identifier as a filesystem segment; bind temporary filenames to
  // its digest so a forged `../` value cannot escape the owned temp directory.
  return stableId("asset", assetRef);
}

export class FfmpegMultimodalQualityPreparerV4
implements FlagshipMultimodalQualityPreparerV4 {
  readonly #ffmpegPath: string;
  readonly #maximumInputs: number;
  readonly #operationTimeoutMs: number;

  constructor(options: {
    ffmpegPath?: string;
    maximumInputs?: number;
    operationTimeoutMs?: number;
  } = {}) {
    this.#ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.#maximumInputs = Math.max(1, Math.min(12, options.maximumInputs ?? 12));
    this.#operationTimeoutMs = Math.max(
      1_000,
      Math.min(60_000, options.operationTimeoutMs ?? 15_000),
    );
  }

  async prepare(input: {
    revisions: MediaWorkRevisionV4[];
    reader: MultimodalQualityAssetReaderV4;
  }): Promise<PreparedWorkQualityMediaInputsV4> {
    if (input.revisions.length === 0) {
      return { status: "not_applicable", inputs: [], limitations: [] };
    }
    if (input.revisions.some((revision) => !eligible(revision))) {
      return {
        status: "not_eligible",
        inputs: [],
        limitations: ["至少一项送审媒体未通过用途、权利或 AI 显隐式标识门，模型未读取文件。"],
      };
    }

    const expectedAssets = input.revisions.flatMap((revision) => (
      revision.derivedAssets.map((asset) => ({ revision, asset }))
    ));
    const directory = await mkdtemp(join(tmpdir(), "ronggang-v4-media-observe-"));
    const prepared: WorkQualityMediaInputV4[] = [];
    const observedAssetRefs = new Set<string>();
    const limitations: string[] = [];
    try {
      for (const [assetIndex, item] of expectedAssets.entries()) {
        if (prepared.length >= this.#maximumInputs) {
          limitations.push("实际派生媒体数量超过单次视觉观察上限，剩余媒体未进入供应方请求。");
          break;
        }
        const loaded = await input.reader.readDerivedAsset({
          sessionId: item.revision.sessionId,
          bindingId: item.revision.bindingId,
          assetRef: item.asset.assetRef,
        });
        if (loaded.contentHash !== item.asset.contentHash
          || sha256(loaded.bytes) !== item.asset.contentHash
          || loaded.bytes.length !== item.asset.byteLength
          || loaded.mimeType !== item.asset.mimeType) {
          throw new MultimodalMediaIntegrityErrorV4(
            `派生媒体字节、类型或哈希漂移：${item.asset.assetRef}`,
          );
        }
        const sourcePath = resolve(
          directory,
          `source-${assetIndex}${extensionFor(item.asset.mimeType)}`,
        );
        await writeFile(sourcePath, loaded.bytes, { flag: "wx" });
        try {
          const assetInputs = await this.#prepareAsset({
            revision: item.revision,
            asset: item.asset,
            sourcePath,
            directory,
            availableSlots: this.#maximumInputs - prepared.length,
          });
          if (assetInputs.length > 0) observedAssetRefs.add(item.asset.assetRef);
          prepared.push(...assetInputs);
          if (item.asset.mediaKind === "audio") {
            limitations.push("音频仅提供真实频谱与电平摘要；当前未装配可授权 ASR，因此不生成或猜测语义转写。");
          }
          if (item.asset.mediaKind === "video") {
            limitations.push("视频按冻结时间点抽取关键帧；连续运动与伴音语义不由静帧观察替代。");
          }
        } catch (error) {
          if (error instanceof MultimodalMediaIntegrityErrorV4) throw error;
          limitations.push(`派生媒体 ${item.asset.assetRef} 无法生成受约束观察表示。`);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const uniqueLimitations = [...new Set(limitations)].slice(0, 8);
    const ready = expectedAssets.every(({ asset }) => observedAssetRefs.has(asset.assetRef));
    return {
      status: ready ? "ready" : "incomplete",
      inputs: prepared,
      limitations: uniqueLimitations,
    };
  }

  async #prepareAsset(input: {
    revision: MediaWorkRevisionV4;
    asset: DerivedAssetV4;
    sourcePath: string;
    directory: string;
    availableSlots: number;
  }): Promise<WorkQualityMediaInputV4[]> {
    if (input.availableSlots <= 0) return [];
    const fileStem = safeAssetFileStem(input.asset.assetRef);
    if (input.asset.mediaKind === "image"
      || input.asset.mediaKind === "synthetic_capture") {
      const outputPath = resolve(input.directory, `${fileStem}-preview.png`);
      await this.#exec([
        "-y", "-i", input.sourcePath,
        "-vf", "scale=512:-2:force_original_aspect_ratio=decrease",
        "-frames:v", "1", outputPath,
      ]);
      return [await this.#inputOf({
        revision: input.revision,
        asset: input.asset,
        path: outputPath,
        representationKind: "image_preview",
        timestampMs: null,
        technicalContext: technicalContext(input.asset, "降采样图像预览，最长边不超过 512px"),
      })];
    }
    if (input.asset.mediaKind === "audio") {
      const outputPath = resolve(input.directory, `${fileStem}-spectrum.png`);
      const acoustic = await this.#acousticSummary(input.sourcePath);
      await this.#exec([
        "-y", "-i", input.sourcePath,
        "-lavfi", "showspectrumpic=s=512x256:legend=disabled:color=viridis",
        "-frames:v", "1", outputPath,
      ]);
      return [await this.#inputOf({
        revision: input.revision,
        asset: input.asset,
        path: outputPath,
        representationKind: "audio_spectrogram",
        timestampMs: null,
        technicalContext: technicalContext(input.asset, acoustic),
      })];
    }
    const times = frameTimes(input.asset.durationMs).slice(0, input.availableSlots);
    const outputs: WorkQualityMediaInputV4[] = [];
    for (const [index, timestampMs] of times.entries()) {
      const outputPath = resolve(
        input.directory,
        `${fileStem}-frame-${index}.png`,
      );
      await this.#exec([
        "-y", "-ss", (timestampMs / 1_000).toFixed(3), "-i", input.sourcePath,
        "-vf", "scale=512:-2:force_original_aspect_ratio=decrease",
        "-frames:v", "1", outputPath,
      ]);
      outputs.push(await this.#inputOf({
        revision: input.revision,
        asset: input.asset,
        path: outputPath,
        representationKind: "video_keyframe",
        timestampMs,
        technicalContext: technicalContext(
          input.asset,
          `视频关键帧，冻结时间点 ${timestampMs}ms，最长边不超过 512px`,
        ),
      }));
    }
    return outputs;
  }

  async #inputOf(input: {
    revision: MediaWorkRevisionV4;
    asset: DerivedAssetV4;
    path: string;
    representationKind: WorkQualityMediaInputV4["representationKind"];
    timestampMs: number | null;
    technicalContext: string;
  }): Promise<WorkQualityMediaInputV4> {
    const bytes = await readFile(input.path);
    const representationContentHash = sha256(bytes);
    return WorkQualityMediaInputV4Schema.parse({
      inputRef: stableId("media-observation-input-v4", {
        revisionRef: input.revision.mediaRevisionId,
        sourceAssetRef: input.asset.assetRef,
        representationKind: input.representationKind,
        timestampMs: input.timestampMs,
        representationContentHash,
      }),
      artifactRef: input.revision.artifactRef,
      revisionRef: input.revision.mediaRevisionId,
      sourceAssetRef: input.asset.assetRef,
      sourceAssetContentHash: input.asset.contentHash,
      representationKind: input.representationKind,
      representationContentHash,
      mimeType: "image/png",
      contentBase64: bytes.toString("base64"),
      timestampMs: input.timestampMs,
      technicalContext: input.technicalContext,
    });
  }

  async #acousticSummary(sourcePath: string): Promise<string> {
    try {
      const { stderr } = await execFileAsync(this.#ffmpegPath, [
        "-nostdin", "-hide_banner", "-i", sourcePath,
        "-af", "volumedetect", "-f", "null", "-",
      ], {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        timeout: this.#operationTimeoutMs,
      });
      const mean = /mean_volume:\s*(-?[\d.]+) dB/iu.exec(stderr)?.[1] ?? "unknown";
      const maximum = /max_volume:\s*(-?[\d.]+) dB/iu.exec(stderr)?.[1] ?? "unknown";
      return `真实声学摘要：平均电平 ${mean}dB，峰值 ${maximum}dB；无语义转写`;
    } catch {
      return "真实频谱可用；电平摘要不可用；无语义转写";
    }
  }

  async #exec(args: string[]): Promise<void> {
    await execFileAsync(this.#ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", ...args,
    ], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: this.#operationTimeoutMs,
    });
  }
}

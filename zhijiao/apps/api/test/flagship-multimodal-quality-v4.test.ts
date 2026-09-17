import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlagshipContentReferenceV4SchemaVersion,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import { xunpuFlagshipContentV4 } from "@ronggang/course-content";
import {
  FlagshipMediaServiceV4,
  InMemoryFlagshipMediaRevisionStoreV4,
} from "../src/flagship-media-v4.js";
import { FfmpegMultimodalQualityPreparerV4 } from "../src/flagship-multimodal-quality-v4.js";

const temporaryDirectories: string[] = [];
const assetDirectory = fileURLToPath(new URL(
  "../../web/public/assets/flagship-world/v4/",
  import.meta.url,
));
const contentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: xunpuFlagshipContentV4.courseId,
    releaseId: "course-multimodal-quality-v4",
    version: 4,
    contentHash: "a".repeat(64),
  },
  scenarioReleaseRef: {
    scenarioId: xunpuFlagshipContentV4.scenarioId,
    version: "4.0.0",
    contentHash: "b".repeat(64),
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-multimodal-quality-v4",
    version: 4,
    contentHash: "c".repeat(64),
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function submittedPackage() {
  const outputDirectory = await mkdtemp(resolve(tmpdir(), "ronggang-quality-media-"));
  temporaryDirectories.push(outputDirectory);
  const service = new FlagshipMediaServiceV4({
    store: new InMemoryFlagshipMediaRevisionStoreV4(),
    flagshipContentRef: contentRef,
    assetDirectory,
    outputDirectory,
    now: () => new Date("2026-09-01T06:00:00.000Z"),
  });
  const workspace = await service.createRevision({
    sessionId: "session-multimodal-quality-v4",
    bindingId: "binding-multimodal-quality-v4",
    artifactRef: "artifact-multiplatform-package",
    requestId: "request-multimodal-quality-v4",
    expectedRevisionNumber: 0,
    status: "submitted",
    sourceAssetRefs: [
      "asset-photo-alley-overview-01",
      "asset-audio-ambience-01",
      "asset-video-alley-broll-01",
    ],
    operations: [
      {
        operationKind: "crop",
        inputAssetRef: "asset-photo-alley-overview-01",
        region: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        rationale: "保留公共巷道主体并裁去无关边缘。",
      },
      {
        operationKind: "trim",
        inputAssetRef: "asset-audio-ambience-01",
        startMs: 0,
        endMs: 1_000,
        rationale: "保留一秒环境声用于多平台质量观察。",
      },
      {
        operationKind: "trim",
        inputAssetRef: "asset-video-alley-broll-01",
        startMs: 0,
        endMs: 1_000,
        rationale: "保留一秒巷口画面用于关键帧观察。",
      },
    ],
    supportingEvidenceRefs: ["evidence-public-alley-boundary"],
    studentEditorialRationale: "三种媒体均使用项目原创素材并保留真实派生版本。",
  });
  return { service, revision: workspace.revisions[0]! };
}

describe("V4 actual-file multimodal quality preparation", () => {
  it("turns image, audio and video bytes into bounded vision inputs with stable hashes", async () => {
    const { service, revision } = await submittedPackage();
    const prepared = await new FfmpegMultimodalQualityPreparerV4().prepare({
      revisions: [revision],
      reader: service,
    });

    expect(prepared.status).toBe("ready");
    expect(prepared.inputs.map((input) => input.representationKind)).toEqual([
      "image_preview",
      "audio_spectrogram",
      "video_keyframe",
      "video_keyframe",
      "video_keyframe",
    ]);
    expect(new Set(prepared.inputs.map((input) => input.sourceAssetRef)).size).toBe(3);
    for (const input of prepared.inputs) {
      const bytes = Buffer.from(input.contentBase64, "base64");
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(createHash("sha256").update(bytes).digest("hex"))
        .toBe(input.representationContentHash);
      expect(input.mimeType).toBe("image/png");
    }
    expect(prepared.limitations.join(" ")).toContain("不生成或猜测语义转写");
    expect(prepared.limitations.join(" ")).toContain("关键帧");
  }, 30_000);

  it("does not read any file when submitted usage rights are ineligible", async () => {
    const { revision } = await submittedPackage();
    const ineligible = structuredClone(revision);
    ineligible.sourceAssets[0]!.permittedUse = "teaching_preview";
    const readDerivedAsset = vi.fn(async () => {
      throw new Error("must not read");
    });
    const prepared = await new FfmpegMultimodalQualityPreparerV4().prepare({
      revisions: [ineligible],
      reader: { readDerivedAsset },
    });

    expect(prepared).toMatchObject({
      status: "not_eligible",
      inputs: [],
    });
    expect(readDerivedAsset).not.toHaveBeenCalled();
  }, 30_000);

  it("never treats a route-like business asset reference as a temporary path", async () => {
    const { service, revision } = await submittedPackage();
    const routeLikeRef = "asset/../../outside-owned-temp-directory";
    const originalRef = revision.derivedAssets[0]!.assetRef;
    revision.derivedAssets[0]!.assetRef = routeLikeRef;

    const prepared = await new FfmpegMultimodalQualityPreparerV4().prepare({
      revisions: [revision],
      reader: {
        readDerivedAsset: (input) => service.readDerivedAsset({
          ...input,
          assetRef: input.assetRef === routeLikeRef ? originalRef : input.assetRef,
        }),
      },
    });

    expect(prepared.status).toBe("ready");
    expect(prepared.inputs.some((input) => input.sourceAssetRef === routeLikeRef))
      .toBe(true);
  }, 30_000);
});

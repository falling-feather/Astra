import { describe, expect, it } from "vitest";
import {
  ModelInvocationRequestSchema,
  MultimodalQualityObservationV4Schema,
  MultimodalQualityObservationV4SchemaVersion,
} from "../src/index.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function observation() {
  return {
    schemaVersion: MultimodalQualityObservationV4SchemaVersion,
    preparationStatus: "ready" as const,
    expectedAssetCount: 1,
    representations: [{
      inputRef: "media-input-preview-1",
      artifactRef: "artifact-package-1",
      revisionRef: "revision-package-1",
      sourceAssetRef: "asset-preview-1",
      sourceAssetContentHash: "a".repeat(64),
      representationKind: "image_preview" as const,
      representationContentHash: "b".repeat(64),
      mimeType: "image/png" as const,
      contentBase64: png,
      timestampMs: null,
      technicalContext: "降采样图像预览，最长边不超过 512px。",
    }],
    limitations: [],
  };
}

describe("MultimodalQualityObservation/4.0.0", () => {
  it("accepts a hash-bound, rights-prepared visual representation", () => {
    expect(MultimodalQualityObservationV4Schema.parse(observation()))
      .toEqual(observation());
  });

  it("rejects schema drift and unknown fields", () => {
    expect(MultimodalQualityObservationV4Schema.safeParse({
      ...observation(),
      schemaVersion: "multimodal-quality-observation/4.0.1",
    }).success).toBe(false);
    expect(MultimodalQualityObservationV4Schema.safeParse({
      ...observation(),
      provider: "deepseek",
    }).success).toBe(false);
  });

  it("forbids media bytes after the rights gate reports ineligible", () => {
    expect(MultimodalQualityObservationV4Schema.safeParse({
      ...observation(),
      preparationStatus: "not_eligible",
    }).success).toBe(false);
  });

  it("requires a timestamp only for frozen video keyframes", () => {
    expect(MultimodalQualityObservationV4Schema.safeParse({
      ...observation(),
      representations: [{
        ...observation().representations[0],
        representationKind: "video_keyframe",
        timestampMs: null,
      }],
    }).success).toBe(false);
  });

  it("rejects an aggregate image payload above the invocation budget", () => {
    const encoded = "A".repeat(1_800_000);
    expect(MultimodalQualityObservationV4Schema.safeParse({
      ...observation(),
      expectedAssetCount: 7,
      representations: Array.from({ length: 7 }, (_, index) => ({
        ...observation().representations[0],
        inputRef: `media-input-large-${index}`,
        contentBase64: encoded,
      })),
    }).success).toBe(false);
  });

  it("applies the same aggregate budget at the provider invocation boundary", () => {
    const encoded = "A".repeat(1_800_000);
    expect(ModelInvocationRequestSchema.safeParse({
      invocationId: "invoke-multimodal-budget",
      profileId: "deepseek-vision-test",
      taskKind: "vision_budget_test",
      systemPrompt: "Return JSON only.",
      userPrompt: "Inspect all attached images.",
      imageInputs: Array.from({ length: 7 }, (_, index) => ({
        inputRef: `provider-image-large-${index}`,
        sourceContentHash: "a".repeat(64),
        representationContentHash: "b".repeat(64),
        mimeType: "image/png",
        contentBase64: encoded,
        detail: "low",
      })),
      outputContractId: "vision-budget-test/1.0.0",
      outputMode: "json_object",
      temperature: 0,
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    }).success).toBe(false);
  });
});

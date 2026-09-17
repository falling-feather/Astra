import { z } from "zod";
import { V2ContentHashSchema, V2IdentifierSchema } from "./course-learning.js";

export const MultimodalQualityObservationV4SchemaVersion =
  "multimodal-quality-observation/4.0.0" as const;

const NonEmptyTextSchema = z.string().trim().min(1);

export const MultimodalQualityRepresentationV4Schema = z.object({
  inputRef: V2IdentifierSchema,
  artifactRef: V2IdentifierSchema,
  revisionRef: V2IdentifierSchema,
  sourceAssetRef: V2IdentifierSchema,
  sourceAssetContentHash: V2ContentHashSchema,
  representationKind: z.enum([
    "image_preview",
    "audio_spectrogram",
    "video_keyframe",
  ]),
  representationContentHash: V2ContentHashSchema,
  mimeType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  contentBase64: z.string()
    .min(4)
    .max(2_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  timestampMs: z.number().int().nonnegative().nullable(),
  technicalContext: NonEmptyTextSchema.max(600),
}).strict().superRefine((representation, context) => {
  if ((representation.representationKind === "video_keyframe")
    !== (representation.timestampMs !== null)) {
    context.addIssue({
      code: "custom",
      path: ["timestampMs"],
      message: "只有视频关键帧必须携带冻结时间点",
    });
  }
});
export type MultimodalQualityRepresentationV4 = z.infer<
  typeof MultimodalQualityRepresentationV4Schema
>;

export const MultimodalQualityObservationV4Schema = z.object({
  schemaVersion: z.literal(MultimodalQualityObservationV4SchemaVersion),
  preparationStatus: z.enum([
    "not_applicable",
    "ready",
    "incomplete",
    "not_eligible",
  ]),
  expectedAssetCount: z.number().int().min(0).max(24),
  representations: z.array(MultimodalQualityRepresentationV4Schema).max(12),
  limitations: z.array(NonEmptyTextSchema.max(600)).max(8),
}).strict().superRefine((observation, context) => {
  const refs = observation.representations.map((item) => item.inputRef);
  if (new Set(refs).size !== refs.length) {
    context.addIssue({
      code: "custom",
      path: ["representations"],
      message: "多模态观察表示引用必须唯一",
    });
  }
  if (observation.representations.reduce(
    (total, item) => total + item.contentBase64.length,
    0,
  ) > 12_000_000) {
    context.addIssue({
      code: "custom",
      path: ["representations"],
      message: "单次多模态观察的编码媒体总量不得超过 12000000 字符",
    });
  }
  if (observation.preparationStatus === "not_applicable"
    && (observation.expectedAssetCount !== 0 || observation.representations.length !== 0)) {
    context.addIssue({
      code: "custom",
      path: ["preparationStatus"],
      message: "无媒体场景不得携带预期资产或观察表示",
    });
  }
  if (observation.preparationStatus === "not_eligible"
    && observation.representations.length !== 0) {
    context.addIssue({
      code: "custom",
      path: ["representations"],
      message: "未通过权利门时不得读取或携带媒体表示",
    });
  }
  if (["ready", "incomplete", "not_eligible"].includes(observation.preparationStatus)
    && observation.expectedAssetCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["expectedAssetCount"],
      message: "存在媒体准备状态时必须有预期资产",
    });
  }
  if (observation.preparationStatus === "ready"
    && observation.representations.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["representations"],
      message: "就绪观察必须包含实际媒体表示",
    });
  }
});
export type MultimodalQualityObservationV4 = z.infer<
  typeof MultimodalQualityObservationV4Schema
>;

export const ModelInvocationImageInputSchema = z.object({
  inputRef: V2IdentifierSchema,
  sourceContentHash: V2ContentHashSchema,
  representationContentHash: V2ContentHashSchema,
  mimeType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  contentBase64: z.string()
    .min(4)
    .max(2_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  detail: z.enum(["low", "high", "original", "auto"]),
}).strict();
export type ModelInvocationImageInput = z.infer<
  typeof ModelInvocationImageInputSchema
>;

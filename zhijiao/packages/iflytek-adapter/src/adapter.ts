import {
  AdapterHealthSchema,
  ObservationSchema,
  createMessageMeta,
  type AdapterCapability,
  type AdapterHealth,
  type Material,
  type Observation,
} from "@ronggang/contracts";
import { iflytekCapabilityCatalog } from "./catalog.js";

export type IflytekMode = "mock" | "live";

export interface IflytekEnvironment {
  [key: string]: string | undefined;
}

export interface CapabilityExecutionInput {
  sourceRef: string;
  mediaType: Material["mediaType"];
  prompt: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CapabilityExecutionOutput {
  summary: string;
  extracted: Record<string, unknown>;
  confidence: number;
  providerRequestId?: string;
}

export interface IflytekCapabilityHandler {
  capability: AdapterCapability;
  execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionOutput>;
}

export interface ExecuteCapabilityInput extends CapabilityExecutionInput {
  capability: AdapterCapability;
}

export interface ObserveMaterialInput {
  sessionId: string;
  sceneId: string;
  actorId: string;
  correlationId: string;
  material: Material;
  prompt?: string;
}

export interface InitialAssessmentInput {
  evidenceSummaries: string[];
  rubric: Array<{ label: string; weight: number; rule: string }>;
}

export interface InitialAssessmentOutput {
  score: number;
  reasons: string[];
  confidence: number;
  modelVersion: string;
  providerMode: IflytekMode;
}

export class IflytekAdapterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IflytekAdapterConfigurationError";
  }
}

function capabilityForMaterial(mediaType: Material["mediaType"]): AdapterCapability {
  if (mediaType === "audio") return "asr";
  if (mediaType === "document") return "ocr";
  if (mediaType === "image") return "image_understanding";
  if (mediaType === "video") return "video_moderation";
  return "xingchen_agent";
}

export class UnifiedIflytekAdapter {
  readonly provider = "iflytek";
  readonly mode: IflytekMode;
  readonly #environment: IflytekEnvironment;
  readonly #handlers: Map<AdapterCapability, IflytekCapabilityHandler>;
  readonly #mockHandlers: Map<AdapterCapability, IflytekCapabilityHandler>;

  constructor(options: {
    mode?: IflytekMode;
    environment?: IflytekEnvironment;
    handlers?: IflytekCapabilityHandler[];
    mockHandlers?: IflytekCapabilityHandler[];
  } = {}) {
    this.#environment = options.environment ?? process.env;
    this.mode = options.mode ?? (this.#environment.IFLYTEK_MODE === "live" ? "live" : "mock");
    this.#handlers = new Map((options.handlers ?? []).map((handler) => [handler.capability, handler]));
    this.#mockHandlers = new Map(
      (options.mockHandlers ?? []).map((handler) => [handler.capability, handler]),
    );
  }

  health(): AdapterHealth {
    return AdapterHealthSchema.parse({
      provider: "iflytek",
      mode: this.mode,
      capabilities: iflytekCapabilityCatalog.map((definition) => {
        const endpoint = this.#environment[definition.endpointEnv] ?? null;
        const credentialsReady = definition.credentialEnvs.every((name) => Boolean(this.#environment[name]));
        const liveReady = credentialsReady && Boolean(endpoint) && this.#handlers.has(definition.capability);
        return {
          capability: definition.capability,
          available: this.mode === "mock" || liveReady,
          configured: credentialsReady && Boolean(endpoint),
          endpoint,
        };
      }),
    });
  }

  catalog() {
    return iflytekCapabilityCatalog.map((definition) => ({
      ...definition,
      credentialEnvs: [...definition.credentialEnvs],
    }));
  }

  async executeCapability(
    input: ExecuteCapabilityInput,
  ): Promise<CapabilityExecutionOutput> {
    const executionInput: CapabilityExecutionInput = {
      sourceRef: input.sourceRef,
      mediaType: input.mediaType,
      prompt: input.prompt,
      idempotencyKey: input.idempotencyKey,
      metadata: structuredClone(input.metadata),
      ...(input.timeoutMs === undefined
        ? {}
        : { timeoutMs: input.timeoutMs }),
      ...(input.signal === undefined
        ? {}
        : { signal: input.signal }),
    };
    if (this.mode === "mock") {
      const handler = this.#mockHandlers.get(input.capability);
      return handler
        ? handler.execute(executionInput)
        : this.mockCapability(input.capability, executionInput);
    }
    return this.executeLive(input.capability, executionInput);
  }

  async observeMaterial(input: ObserveMaterialInput): Promise<Observation> {
    const capability = capabilityForMaterial(input.material.mediaType);
    const output = await this.executeCapability({
      capability,
      sourceRef: input.material.sourceRef,
      mediaType: input.material.mediaType,
      prompt: input.prompt
        ?? "提取可核验事实、版权信号与潜在风险；不要把推断写成事实。",
      idempotencyKey: `observe:${input.correlationId}:${input.material.materialId}:${input.material.version}`,
      metadata: {
        materialId: input.material.materialId,
        materialVersion: input.material.version,
      },
    });
    return ObservationSchema.parse({
      ...createMessageMeta({
        sessionId: input.sessionId,
        sceneId: input.sceneId,
        actorId: input.actorId,
        correlationId: input.correlationId,
      }),
      kind: "Observation",
      observationId: `observation-${crypto.randomUUID()}`,
      materialId: input.material.materialId,
      mediaType: input.material.mediaType,
      provider: `iflytek:${capability}`,
      providerMode: this.mode,
      summary: output.summary,
      extracted: {
        ...output.extracted,
        capability,
        ...(output.providerRequestId ? { providerRequestId: output.providerRequestId } : {}),
      },
      sourceRef: input.material.sourceRef,
      confidence: output.confidence,
    });
  }

  async createInitialAssessment(input: InitialAssessmentInput): Promise<InitialAssessmentOutput> {
    if (this.mode === "mock") {
      const coverage = Math.min(1, input.evidenceSummaries.length / Math.max(1, input.rubric.length));
      return {
        score: Math.round(82 + coverage * 14),
        reasons: ["关键动作均附带过程证据", "建议教师复核版权替换后的跨平台表达"],
        confidence: 0.82,
        modelVersion: "iflytek-adapter/mock-assessor-0.1",
        providerMode: "mock",
      };
    }
    const output = await this.executeCapability({
      capability: "xingchen_agent",
      sourceRef: "session://evidence",
      mediaType: "text",
      prompt: "依据量规和证据生成0-100分初评，只返回可解释结果，不形成最终成绩。",
      idempotencyKey: `assessment:${crypto.randomUUID()}`,
      metadata: {
        evidenceSummaries: input.evidenceSummaries,
        rubric: input.rubric,
      },
    });
    const score = typeof output.extracted.score === "number" ? output.extracted.score : 0;
    const reasons = Array.isArray(output.extracted.reasons) ? output.extracted.reasons.map(String) : [output.summary];
    return { score: Math.max(0, Math.min(100, score)), reasons, confidence: output.confidence, modelVersion: "iflytek:xingchen/live", providerMode: "live" };
  }

  private async executeLive(capability: AdapterCapability, input: CapabilityExecutionInput): Promise<CapabilityExecutionOutput> {
    const definition = iflytekCapabilityCatalog.find((item) => item.capability === capability);
    if (!definition) {
      throw new IflytekAdapterConfigurationError(`未知讯飞能力：${capability}`);
    }
    const endpoint = this.#environment[definition.endpointEnv];
    const missingCredentials = definition.credentialEnvs.filter(
      (name) => !this.#environment[name],
    );
    const handler = this.#handlers.get(capability);
    if (!endpoint || missingCredentials.length > 0 || !handler) {
      const missingParts = [
        ...(!endpoint ? ["endpoint"] : []),
        ...(missingCredentials.length > 0 ? ["credentials"] : []),
        ...(!handler ? ["handler"] : []),
      ];
      throw new IflytekAdapterConfigurationError(
        `${definition.label}尚未就绪（缺少 ${missingParts.join("、")}）；请按 ${definition.authStrategy} 方式完成服务端接入。`,
      );
    }
    return handler.execute(input);
  }

  private mockCapability(
    capability: AdapterCapability,
    input: CapabilityExecutionInput,
  ): CapabilityExecutionOutput {
    if (input.signal?.aborted) {
      const error = new Error("科大讯飞能力调用已取消");
      error.name = "AbortError";
      throw error;
    }
    const governanceDomain = typeof input.metadata.governanceDomain === "string"
      ? input.metadata.governanceDomain
      : null;
    if (
      governanceDomain === "fact"
      || governanceDomain === "copyright"
      || governanceDomain === "content_safety"
      || governanceDomain === "platform_rule"
    ) {
      const recommendation = {
        fact: "review",
        copyright: "revise",
        content_safety: "allow",
        platform_rule: "allow",
      }[governanceDomain];
      const label = {
        fact: "事实一致性",
        copyright: "版权范围",
        content_safety: "内容安全",
        platform_rule: "平台规则",
      }[governanceDomain];
      return {
        summary: `${label}专业分支已完成 Mock 发现；结论为 ${recommendation}，只形成待教师复核的 GovernanceFinding。`,
        extracted: {
          recommendation,
          riskLabels: recommendation === "allow"
            ? []
            : [`${governanceDomain}_${recommendation}`],
          governanceDomain,
          sourceRef: input.sourceRef,
        },
        confidence: recommendation === "allow" ? 0.91 : 0.78,
      };
    }
    if (capability === "image_understanding") {
      return {
        summary: "图像显示江南水乡非遗市集与密集人流；图像不能独立证明客流总量。",
        extracted: {
          scene: "江南水乡非遗市集",
          crowdDensity: "high",
          readableBranding: false,
        },
        confidence: 0.88,
      };
    }
    if (capability === "ocr") {
      return {
        summary: "文档文字已提取；数值、来源和授权边界仍需与权威世界事实交叉核验。",
        extracted: {
          text: "活动时间：周六 09:00—20:30；采访与发布须遵循现场授权边界。",
          sourceRef: input.sourceRef,
        },
        confidence: 0.93,
      };
    }
    if (capability === "asr") {
      return {
        summary: "音频已形成带不确定标记的采访转写，尚未经过受访者或教师复核。",
        extracted: {
          transcript: "我们希望报道把手艺和真实工作过程讲清楚。",
          uncertainSegments: [],
        },
        confidence: 0.9,
      };
    }
    if (
      capability === "text_moderation"
      || capability === "image_moderation"
      || capability === "video_moderation"
    ) {
      return {
        summary: "模拟合规检查未发现阻断级风险；版权、隐私和事实表述仍需岗位复核。",
        extracted: {
          decision: "review_required",
          riskLabels: ["copyright_review", "fact_wording_review"],
        },
        confidence: 0.86,
      };
    }
    if (capability === "rag") {
      return {
        summary: "已检索与固定材料直接相关的参考片段；引用时必须保留来源与版本。",
        extracted: { matches: [], sourceRef: input.sourceRef },
        confidence: 0.8,
      };
    }
    return {
      summary: "材料已由本地模拟适配器结构化，输出仅作为观察，不直接写入权威世界事实。",
      extracted: {
        sourceRef: input.sourceRef,
        mediaType: input.mediaType,
      },
      confidence: 0.8,
    };
  }
}

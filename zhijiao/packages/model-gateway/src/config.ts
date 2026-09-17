export type ModelGatewayConfig =
  | {
    provider: "deterministic";
    profileId: string;
    timeoutMs: number;
    maxRetries: number;
  }
  | {
    provider: "deepseek";
    profileId: string;
    timeoutMs: number;
    maxRetries: number;
    baseUrl: string;
    apiKey: string;
    model: string;
    visionModel: string | null;
  }
  | {
    provider: "iflytek_xingchen";
    profileId: string;
    timeoutMs: number;
    maxRetries: number;
    endpoint: string;
    token: string;
    workflowId: string;
  };

export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ModelConfigurationError(`${label} 必须是正整数`);
  }
  return parsed;
}

function nonnegativeInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) {
    throw new ModelConfigurationError(`${label} 必须是 0—2 的整数`);
  }
  return parsed;
}

function required(environment: NodeJS.ProcessEnv, key: string, provider: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new ModelConfigurationError(`${provider} 已启用，但服务端环境缺少 ${key}`);
  return value;
}

function validUrl(value: string, label: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new ModelConfigurationError(`${label} 必须是有效 URL`);
  }
}

export function readModelGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ModelGatewayConfig {
  const provider = environment.MODEL_PROVIDER?.trim() || "deterministic";
  const profileId = environment.MODEL_PROFILE_ID?.trim() || `${provider}-development`;
  const timeoutMs = positiveInteger(environment.MODEL_TIMEOUT_MS, 20_000, "MODEL_TIMEOUT_MS");
  const maxRetries = nonnegativeInteger(environment.MODEL_MAX_RETRIES, 1, "MODEL_MAX_RETRIES");

  if (provider === "deterministic") {
    return { provider, profileId, timeoutMs, maxRetries };
  }
  if (provider === "deepseek") {
    return {
      provider,
      profileId,
      timeoutMs,
      maxRetries,
      baseUrl: validUrl(environment.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com", "DEEPSEEK_BASE_URL"),
      apiKey: required(environment, "DEEPSEEK_API_KEY", "DeepSeek"),
      model: environment.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
      visionModel: environment.DEEPSEEK_VISION_MODEL?.trim()
        || null,
    };
  }
  if (provider === "iflytek_xingchen") {
    return {
      provider,
      profileId,
      timeoutMs,
      maxRetries,
      endpoint: validUrl(required(environment, "IFLYTEK_XINGCHEN_ENDPOINT", "科大讯飞星辰"), "IFLYTEK_XINGCHEN_ENDPOINT"),
      token: required(environment, "IFLYTEK_XINGCHEN_TOKEN", "科大讯飞星辰"),
      workflowId: required(environment, "IFLYTEK_XINGCHEN_WORKFLOW_ID", "科大讯飞星辰"),
    };
  }
  throw new ModelConfigurationError(`MODEL_PROVIDER 不受支持：${provider}`);
}

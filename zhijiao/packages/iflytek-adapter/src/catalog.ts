import type { AdapterCapability } from "@ronggang/contracts";

export interface IflytekCapabilityDefinition {
  capability: AdapterCapability;
  label: string;
  authStrategy: "bearer" | "hmac-sha1" | "hmac-sha256" | "signed-request";
  endpointEnv: string;
  credentialEnvs: string[];
  officialDocUrl: string;
}

export const iflytekCapabilityCatalog: IflytekCapabilityDefinition[] = [
  {
    capability: "xingchen_agent",
    label: "讯飞星辰智能体/工作流",
    authStrategy: "bearer",
    endpointEnv: "IFLYTEK_XINGCHEN_ENDPOINT",
    credentialEnvs: ["IFLYTEK_XINGCHEN_TOKEN", "IFLYTEK_XINGCHEN_WORKFLOW_ID"],
    officialDocUrl: "https://www.xfyun.cn/doc/spark/Agent04-API%E6%8E%A5%E5%85%A5.html",
  },
  {
    capability: "rag",
    label: "星辰知识库检索",
    authStrategy: "bearer",
    endpointEnv: "IFLYTEK_RAG_ENDPOINT",
    credentialEnvs: ["IFLYTEK_XINGCHEN_TOKEN", "IFLYTEK_RAG_KNOWLEDGE_ID"],
    officialDocUrl: "https://www.xfyun.cn/doc/spark/Agent01-%E5%B9%B3%E5%8F%B0%E4%BB%8B%E7%BB%8D.html",
  },
  {
    capability: "asr",
    label: "大模型语音转写",
    authStrategy: "hmac-sha1",
    endpointEnv: "IFLYTEK_ASR_ENDPOINT",
    credentialEnvs: ["IFLYTEK_ASR_APP_ID", "IFLYTEK_ASR_API_KEY", "IFLYTEK_ASR_API_SECRET"],
    officialDocUrl: "https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html",
  },
  {
    capability: "ocr",
    label: "大模型文档识别 OCR",
    authStrategy: "hmac-sha256",
    endpointEnv: "IFLYTEK_OCR_ENDPOINT",
    credentialEnvs: ["IFLYTEK_OCR_APP_ID", "IFLYTEK_OCR_API_KEY", "IFLYTEK_OCR_API_SECRET"],
    officialDocUrl: "https://www.xfyun.cn/doc/words/OCRforLLM/API.html",
  },
  {
    capability: "image_understanding",
    label: "图片理解",
    authStrategy: "signed-request",
    endpointEnv: "IFLYTEK_IMAGE_ENDPOINT",
    credentialEnvs: ["IFLYTEK_IMAGE_APP_ID", "IFLYTEK_IMAGE_API_KEY", "IFLYTEK_IMAGE_API_SECRET"],
    officialDocUrl: "https://www.xfyun.cn/doc/spark/ImageUnderstanding.html",
  },
  {
    capability: "text_moderation",
    label: "文本合规审核",
    authStrategy: "hmac-sha1",
    endpointEnv: "IFLYTEK_TEXT_MODERATION_ENDPOINT",
    credentialEnvs: ["IFLYTEK_MODERATION_APP_ID", "IFLYTEK_MODERATION_API_KEY", "IFLYTEK_MODERATION_API_SECRET"],
    officialDocUrl: "https://www.xfyun.cn/doc/nlp/TextModeration/API.html",
  },
  ...(["image_moderation", "video_moderation"] as const).map((capability) => ({
    capability,
    label: capability === "image_moderation" ? "图片合规审核" : "视频合规审核",
    authStrategy: "signed-request" as const,
    endpointEnv: `IFLYTEK_${capability.toUpperCase()}_ENDPOINT`,
    credentialEnvs: ["IFLYTEK_MODERATION_APP_ID", "IFLYTEK_MODERATION_API_KEY", "IFLYTEK_MODERATION_API_SECRET"],
    officialDocUrl: "https://www.xfyun.cn/doc/nlp/VideoModeration/API.html",
  })),
];

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { SimulationAgentTemplateV3 } from "@ronggang/agent-runtime";
import {
  AdminGroundedCollaborationEpisodeV4Schema,
  AdminGroundedBusinessMoveV4Schema,
  GroundedAgentCollaborationEpisodeV4SchemaVersion,
  StudentGroundedCollaborationEpisodeV4Schema,
  TeacherGroundedBusinessMoveV4Schema,
  TeacherGroundedCollaborationEpisodeV4Schema,
  FlagshipContentReferenceV4Schema,
  GroundedCollaborationPlanV4Schema,
  GroundedEvidenceAuthorizationV4Schema,
  GroundedRetrievalResultV4Schema,
  type AdminGroundedBusinessMoveV4,
  type AdminGroundedCollaborationEpisodeV4,
  type FlagshipContentReferenceV4,
  type GroundedKnowledgeCitationV4,
  type GroundedCollaborationPlanV4,
  type GroundedEvidenceAuthorizationV4,
  type GroundedRetrievalQueryV4,
  type GroundedRetrievalResultV4,
  type StudentGroundedCollaborationEpisodeV4,
  type TeacherGroundedBusinessMoveV4,
  type TeacherGroundedCollaborationEpisodeV4,
} from "@ronggang/contracts";
import { z } from "zod";
import {
  GroundedCollaborationRecordNotFoundError,
  GroundedCollaborationStoreConflictError,
  type GroundedCollaborationStoreV4,
} from "./grounded-collaboration-v4-store.js";
import {
  GroundedCollaborationRecordV4Version,
  validateGroundedCollaborationRecordV4,
  type GroundedAgentIntentRecordV4,
  type GroundedAgentObservationRecordV4,
  type GroundedAgentRunRecordV4,
  type GroundedAgentTaskRecordV4,
  type GroundedCollaborationFailureV4,
  type GroundedCollaborationPolicyV4,
  type GroundedCollaborationRecordV4,
  type GroundedCollaborationRequestSnapshotV4,
  type GroundedEvidenceSnapshotV4,
  type GroundedMovePositionV4,
  type GroundedWorldConsequenceReceiptV4,
} from "./grounded-collaboration-v4-types.js";
import { buildXunpuSimulationAgentTemplatesV3R2 } from "./xunpu-simulation-agents-v3.js";
import type {
  GroundedRetrievalPortInputV4,
  GroundedRetrievalPortV4,
  GroundedEvidenceAuthorizationInputV4,
  GroundedEvidenceAuthorizationResolverV4,
} from "./grounded-retrieval-v4.js";

export const XunpuGroundedCollaborationRuntimeV4Version =
  "xunpu-grounded-collaboration-runtime/4.0.0" as const;

export interface GroundedRuntimeKnowledgeV4 {
  knowledgeRef: string;
  title: string;
  sourceTitle: string;
  sourceUrl: string;
  locator: string;
  teachingSummary: string;
  sourceContentHash: string;
  reviewStatus: "pending_expert_review" | "verified";
}

export interface GroundedRuntimeClaimV4 {
  claimRef: string;
  allowedWording: string;
  knowledgeRefs: string[];
  runtimeEvidenceKinds: string[];
  prohibitedExpansion: string;
  minimumIndependentSupportCount: number;
}

export interface GroundedRuntimeEpisodeTemplateV4 {
  episodeTemplateRef: string;
  groundedClaimRefs: string[];
  failureClosedWhen: string[];
}

export interface GroundedCollaborationRuntimeContentV4 {
  contentSchemaVersion: string;
  contentHash: string;
  knownObjectRefs: string[];
  knowledge: GroundedRuntimeKnowledgeV4[];
  claims: GroundedRuntimeClaimV4[];
  episodes: GroundedRuntimeEpisodeTemplateV4[];
}

export interface BaseKnowledgeInputV4 {
  knowledgeId: string;
  teachingSummary: string;
  contentHash: string;
  reviewStatus: "pending_expert_review" | "verified" | "retired";
  source: {
    title: string;
    url: string;
    locator: string;
  };
}

export interface AddedKnowledgeInputV4 {
  knowledgeId: string;
  title: string;
  teachingSummary: string;
  sourceTitle: string;
  url: string;
  locator: string;
  contentHash: string;
  reviewStatus: "pending_expert_review" | "verified";
}

export interface XunpuGroundedContentInputV4 {
  schemaVersion: string;
  contentHash: string;
  locations: ReadonlyArray<{ locationId: string }>;
  worldObjects: ReadonlyArray<{ objectId: string }>;
  variables: ReadonlyArray<{ variableId: string }>;
  cast: ReadonlyArray<{ entityId: string }>;
  artifacts: ReadonlyArray<{ artifactId: string }>;
  mediaAssets: ReadonlyArray<{ assetId: string }>;
  groundedClaims: ReadonlyArray<{
    claimId: string;
    allowedWording: string;
    knowledgeRefs: string[];
    runtimeEvidenceKinds: string[];
    prohibitedExpansion: string;
    minimumIndependentSupportCount: number;
  }>;
  agentEpisodes: ReadonlyArray<{
    episodeTemplateId: string;
    groundedClaimRefs: string[];
    failureClosedWhen: string[];
  }>;
}

export interface GroundedCollaborationModelInputV4 {
  runtimeVersion: typeof XunpuGroundedCollaborationRuntimeV4Version;
  episodeTemplateRef: string;
  moveKind: AdminGroundedBusinessMoveV4["moveKind"];
  expectedPosition: GroundedMovePositionV4;
  professionalRoleId: string;
  affectedObjectRefs: string[];
  allowedClaims: Array<{
    claimRef: string;
    allowedWording: string;
    prohibitedExpansion: string;
  }>;
  allowedKnowledge: Array<{
    knowledgeRef: string;
    sourceTitle: string;
    sourceDocumentRef?: string;
    sourceRevision?: string;
    fragmentRef?: string;
    fragmentHash?: string;
    snippet?: string;
    locator: string;
    teachingSummary: string;
    stance: GroundedKnowledgeCitationV4["stance"];
    reviewStatus: "pending_expert_review" | "verified";
    expiresAt?: string | null;
    revokedAt?: string | null;
  }>;
  evidenceRefs: string[];
  predecessorSafeSummaries: string[];
  approvedSafeSummary: string;
  approvedRationale: string;
  remainingBudgetMicros: number;
}

export interface GroundedCollaborationModelRunV4 {
  output: unknown;
  providerId: string;
  modelId: string;
  traceRef: string;
  latencyMs: number;
  estimatedCostMicros: number;
}

export interface GroundedCollaborationModelV4 {
  run(
    input: Readonly<GroundedCollaborationModelInputV4>,
  ): Promise<GroundedCollaborationModelRunV4>;
}

export interface GroundedCollaborationServiceV4Options {
  store: GroundedCollaborationStoreV4;
  content: GroundedCollaborationRuntimeContentV4;
  flagshipContentRef: FlagshipContentReferenceV4;
  decisionSecret: string;
  worldAuthoritySecret: string;
  getCurrentWorldStateVersion: (sessionId: string) => Promise<number>;
  model?: GroundedCollaborationModelV4;
  retrieval?: GroundedRetrievalPortV4;
  authorizationResolver?: GroundedEvidenceAuthorizationResolverV4;
  groundingMode?: "legacy" | "retrieval";
  topology?: readonly SimulationAgentTemplateV3[];
  now?: () => string;
}

export interface StartGroundedCollaborationEpisodeV4Input {
  episodeId: string;
  sessionId: string;
  studentBindingId: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  episodeTemplateRef: string;
  sourceWorldStateVersion: number;
  triggerEventRef: string;
  affectedObjectRefs: string[];
  claimRefs: string[];
  evidence: GroundedEvidenceSnapshotV4[];
  policy?: GroundedCollaborationPolicyV4;
  maximumSelectedAgents?: number;
  executionBudgetMicros?: number;
}

export interface RecordGroundedSuggestionDecisionV4Input {
  episodeId: string;
  bindingId: string;
  decisionRef: string;
  decision: "accept" | "request_evidence" | "reject";
  rationale: string;
  decidedAt: string;
  decisionToken: string;
}

export interface GroundedWorldConsequencePayloadV4 {
  receiptRef: string;
  episodeId: string;
  sourceWorldStateVersion: number;
  resultingWorldStateVersion: number;
  worldConsequenceRef: string;
  worldEventContentHash: string;
  committedAt: string;
}

export interface RecordGroundedWorldConsequenceV4Input
extends GroundedWorldConsequencePayloadV4 {
  authorityToken: string;
}

export interface GroundedCollaborationAblationObservationV4 {
  policy: GroundedCollaborationPolicyV4;
  requestHash: string;
  maximumSelectedAgents: number;
  executionBudgetMicros: number;
  status: "joint_proposal_ready" | "failed";
  selectedCount: number;
  moveCount: number;
  knowledgeCitationCount: number;
  evidenceCoverage: number;
  unauthorizedWorldWriteCount: 0;
  totalLatencyMs: number;
  totalEstimatedCostMicros: number;
  failureReasonCode: GroundedCollaborationFailureV4["reasonCode"] | null;
}

interface MoveRecipeV4 {
  moveKind: AdminGroundedBusinessMoveV4["moveKind"];
  agentTemplateRef: string;
  position: GroundedMovePositionV4;
  safeSummary: string;
  rationale: string;
}

interface EpisodeRecipeV4 {
  episodeTemplateRef: string;
  riskLevel: "medium" | "high";
  affectedAgentRefs: string[];
  moves: readonly MoveRecipeV4[];
  publicSummary: string;
  recommendedActionRefs: string[];
  requiresTeacherGate: boolean;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
const hashPattern = /^[a-f0-9]{64}$/u;

const episodeRecipes: readonly EpisodeRecipeV4[] = [
  {
    episodeTemplateRef: "episode-source-year-challenge",
    riskLevel: "medium",
    affectedAgentRefs: ["agent-template-researcher"],
    moves: [
      {
        moveKind: "proposal",
        agentTemplateRef: "agent-template-editor",
        position: "propose",
        safeSummary: "先把冲突年份降为待核主张，分别登记原始机关、转引链和拟采用措辞。",
        rationale: "责任编辑先保护作品事实边界，但不替学生决定是否保留该主张。",
      },
      {
        moveKind: "challenge",
        agentTemplateRef: "agent-template-fact-checker",
        position: "challenge",
        safeSummary: "现有转引不足以支撑确定年份；必须回到公开名录与地方标准的精确定位。",
        rationale: "质疑保留原提案，不用平均意见掩盖来源层级冲突。",
      },
      {
        moveKind: "evidence_request",
        agentTemplateRef: "agent-template-researcher",
        position: "needs_evidence",
        safeSummary: "请补齐两项原始定位、页面版本和各自能支持的最窄表述。",
        rationale: "研究者只请求可定位材料，不凭身份为网络说法背书。",
      },
      {
        moveKind: "revision",
        agentTemplateRef: "agent-template-editor",
        position: "revise",
        safeSummary: "把稿件改为可由名录和标准共同支持的限定表述，并删除无法定位的起源推断。",
        rationale: "修订逐项回应质疑和补证请求，保留原始错误与修改痕迹。",
      },
      {
        moveKind: "joint_proposal",
        agentTemplateRef: "agent-template-teaching-director",
        position: "joint",
        safeSummary: "先完成双来源比较表，再决定采用限定年份、降级为观点或删除。",
        rationale: "联合提案保留学生的三种合法选择，教师只在风险门上终裁。",
      },
    ],
    publicSummary: "先比较公开名录与地方标准的原始定位，再由学生选择限定表述、观点化或删除。",
    recommendedActionRefs: [
      "action-compare-primary-locators",
      "action-revise-year-wording",
    ],
    requiresTeacherGate: false,
  },
  {
    episodeTemplateRef: "episode-media-rights-challenge",
    riskLevel: "high",
    affectedAgentRefs: ["agent-template-rights-contact"],
    moves: [
      {
        moveKind: "proposal",
        agentTemplateRef: "agent-template-editor",
        position: "propose",
        safeSummary: "先保留报道结构，但把人物近景从待发布序列隔离并标记权利状态未知。",
        rationale: "编辑价值不能覆盖作者、肖像、个人信息与平台用途边界。",
      },
      {
        moveKind: "challenge",
        agentTemplateRef: "agent-template-governance",
        position: "challenge",
        safeSummary: "水印、课堂预览同意和新闻题材都不能单独证明公开短视频许可。",
        rationale: "版权与肖像治理分别质疑权属、人物同意、期限、平台和 AI 标识。",
      },
      {
        moveKind: "evidence_request",
        agentTemplateRef: "agent-template-rights-contact",
        position: "needs_evidence",
        safeSummary: "请补作者许可、人物公开范围、撤回时间与当前作品版本；任一缺失都需替换或裁切。",
        rationale: "权利联络人只确认真实回执，不代权利人补造授权。",
      },
      {
        moveKind: "revision",
        agentTemplateRef: "agent-template-platform",
        position: "revise",
        safeSummary: "从公开视频版本移除未获许可近景，保留宽景或手部素材，并同步显式与隐式 AI 标识。",
        rationale: "平台修订形成新版本而非静默覆盖，撤回前后记录继续可追溯。",
      },
      {
        moveKind: "joint_proposal",
        agentTemplateRef: "agent-template-teaching-director",
        position: "joint",
        safeSummary: "优先替换或裁切；只有新回执覆盖具体平台、期限和用途时才重新纳入近景。",
        rationale: "高风险联合提案进入教师门，智能体不能自行发布。",
      },
    ],
    publicSummary: "隔离未获公开许可的近景，完成替换/裁切或补齐具体范围回执后再提交教师门。",
    recommendedActionRefs: [
      "action-replace-closeup",
      "action-record-rights-scope",
    ],
    requiresTeacherGate: true,
  },
  {
    episodeTemplateRef: "episode-breaking-rumor-challenge",
    riskLevel: "high",
    affectedAgentRefs: ["agent-template-public-liaison"],
    moves: [
      {
        moveKind: "proposal",
        agentTemplateRef: "agent-template-scene-director",
        position: "propose",
        safeSummary: "把群聊截图作为待核线索，并开放等待、限定性服务更新或拒绝公开三条路径。",
        rationale: "情境导演只提出时效压力，不把截图内容写成世界事实。",
      },
      {
        moveKind: "challenge",
        agentTemplateRef: "agent-template-fact-checker",
        position: "challenge",
        safeSummary: "截图缺少主体、时间和位置，无法支撑“现场已封闭”的确定判断。",
        rationale: "事实核查保留未知项，不用传播热度替代来源。",
      },
      {
        moveKind: "evidence_request",
        agentTemplateRef: "agent-template-public-liaison",
        position: "needs_evidence",
        safeSummary: "请等待公开回执或取得可定位现场确认，并分别记录已确认与仍未知事项。",
        rationale: "公共联络只给公开材料和下一回执窗口，不提前生成未汇总口径。",
      },
      {
        moveKind: "revision",
        agentTemplateRef: "agent-template-content-safety",
        position: "revise",
        safeSummary: "如需即时发布，只写可验证的服务信息、核验时间和未知项，不复述未经确认的封闭结论。",
        rationale: "修订同时控制公共安全误导和过度传播风险。",
      },
      {
        moveKind: "joint_proposal",
        agentTemplateRef: "agent-template-editor",
        position: "joint",
        safeSummary: "优先等待回执；确需发布时采用限定性服务更新，并预设下一次更新或更正节点。",
        rationale: "联合提案把时效、事实和可更正性并列呈现，最终发布仍需教师门。",
      },
    ],
    publicSummary: "群聊截图只作线索；等待公开回执，或发布带核验时间、未知项和更新承诺的限定性服务信息。",
    recommendedActionRefs: [
      "action-request-official-receipt",
      "action-publish-limited-service-update",
    ],
    requiresTeacherGate: true,
  },
] as const;

const fixedTeam = [
  "agent-template-editor",
  "agent-template-fact-checker",
  "agent-template-governance",
  "agent-template-platform",
  "agent-template-teaching-director",
] as const;

const ModelCandidateSchema = z.object({
  position: z.enum(["propose", "challenge", "needs_evidence", "revise", "joint"]),
  safeSummary: z.string().trim().min(1).max(900),
  rationale: z.string().trim().min(1).max(1_200),
  groundedClaimRefs: z.array(z.string().regex(idPattern)).min(1).max(16),
  knowledgeRefs: z.array(z.string().regex(idPattern)).min(1).max(16),
  evidenceRefs: z.array(z.string().regex(idPattern)).min(1).max(32),
}).strict();

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

function canonicalString(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function hmac(secret: string, prefix: string, value: unknown): string {
  return `${prefix}_${createHmac("sha256", secret)
    .update(canonicalString(value))
    .digest("base64url")}`;
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertRuntime(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4 知识协作运行失败：${message}`);
}

export class GroundedEvidenceAuthorizationChangedError extends Error {
  constructor() {
    super("来源授权已变化，请先用新授权和新证据调用 resumeEpisodeWithEvidence");
    this.name = "GroundedEvidenceAuthorizationChangedError";
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalString([...left].sort()) === canonicalString([...right].sort());
}

const privateModelTextPattern = /(?:system\s*prompt|系统提示词|prompt|trace|token|api[ _-]?key|供应方|模型内部|私有记忆|agent[ _-]?(?:task|run)|binding(?:id)?|session(?:id)?)/iu;
const unsafeExpansionPattern = /(?:可以|可直接).{0,6}(?:跳过|忽略|绕过).{0,12}(?:核查|补证|授权|许可|标识|更正|教师门|直接发布)|(?:无需|不必|跳过|忽略|免于).{0,12}(?:核查|补证|授权|许可|标识|更正|教师门|直接发布)|(?:永久|实时|唯一|所有人|任意|无限).{0,12}(?:排名|客流|数据|起源|实践|许可|使用|同意)/u;

function normalizedMeaningTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = value.toLocaleLowerCase("zh-CN");
  for (const match of normalized.matchAll(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu)) {
    const token = match[0];
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) {
        tokens.add(token.slice(index, index + 2));
      }
    } else {
      tokens.add(token);
    }
  }
  return tokens;
}

function meaningOverlap(candidate: string, support: string): number {
  const candidateTokens = normalizedMeaningTokens(candidate);
  if (candidateTokens.size === 0) return 0;
  const supportTokens = normalizedMeaningTokens(support);
  let overlap = 0;
  for (const token of candidateTokens) {
    if (supportTokens.has(token)) overlap += 1;
  }
  return overlap / candidateTokens.size;
}

function numericClaims(value: string): Set<string> {
  return new Set([...value.matchAll(/\d+(?:\.\d+)?%?/gu)].map((match) => match[0]));
}

function containsUnsupportedIdentifiers(
  value: string,
  allowedRefs: ReadonlySet<string>,
): boolean {
  const identifiers = [...value.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/giu)]
    .map((match) => match[0]);
  return identifiers.some((identifier) => !allowedRefs.has(identifier));
}

function violatesProhibitedExpansion(
  value: string,
  prohibitedExpansions: readonly string[],
): boolean {
  const normalizedValue = value.replaceAll(/\s+/gu, "");
  return prohibitedExpansions.some((prohibition) => {
    const normalizedProhibition = prohibition.replaceAll(/\s+/gu, "");
    if (normalizedValue.includes(normalizedProhibition)) return false;
    const core = normalizedProhibition
      .replace(/^不得(?:写成|把|以|外推为|推断)?/u, "")
      .replace(/[。；]/gu, "");
    return core.length >= 4 && meaningOverlap(core, normalizedValue) >= 0.7;
  });
}

function groundedCandidateIsSupported(input: {
  candidate: z.infer<typeof ModelCandidateSchema>;
  modelInput: GroundedCollaborationModelInputV4;
  expectedClaimRefs: readonly string[];
  expectedKnowledgeRefs: readonly string[];
  expectedEvidenceRefs: readonly string[];
}): boolean {
  const combined = `${input.candidate.safeSummary}\n${input.candidate.rationale}`;
  const supportText = [
    input.modelInput.approvedSafeSummary,
    input.modelInput.approvedRationale,
    ...input.modelInput.predecessorSafeSummaries,
    ...input.modelInput.allowedClaims.flatMap((claim) => [claim.allowedWording]),
    ...input.modelInput.allowedKnowledge
      .filter((knowledge) => knowledge.stance === "supports")
      .flatMap((knowledge) => [
        knowledge.sourceTitle,
        knowledge.sourceRevision ?? "",
        knowledge.fragmentRef ?? "",
        knowledge.fragmentHash ?? "",
        knowledge.snippet ?? "",
        knowledge.locator,
        knowledge.teachingSummary,
      ]),
  ].join("\n");
  const allowedNumbers = numericClaims(supportText);
  const candidateNumbers = numericClaims(combined);
  const allowedRefs = new Set([
    input.modelInput.episodeTemplateRef,
    ...input.modelInput.affectedObjectRefs,
    ...input.expectedClaimRefs,
    ...input.expectedKnowledgeRefs,
    ...input.expectedEvidenceRefs,
    ...input.modelInput.allowedKnowledge.flatMap((knowledge) => [
      knowledge.sourceDocumentRef ?? "",
      knowledge.sourceRevision ?? "",
      knowledge.fragmentRef ?? "",
      knowledge.fragmentHash ?? "",
    ]),
  ]);
  return input.candidate.position === input.modelInput.expectedPosition
    && sameSet(input.candidate.groundedClaimRefs, input.expectedClaimRefs)
    && sameSet(input.candidate.knowledgeRefs, input.expectedKnowledgeRefs)
    && sameSet(input.candidate.evidenceRefs, input.expectedEvidenceRefs)
    && meaningOverlap(
      input.candidate.safeSummary,
      `${input.modelInput.approvedSafeSummary}\n${supportText}`,
    ) >= 0.18
    && meaningOverlap(
      input.candidate.rationale,
      `${input.modelInput.approvedRationale}\n${supportText}`,
    ) >= 0.14
    && [...candidateNumbers].every((number) => allowedNumbers.has(number))
    && !privateModelTextPattern.test(combined)
    && !unsafeExpansionPattern.test(combined)
    && !containsUnsupportedIdentifiers(combined, allowedRefs)
    && !violatesProhibitedExpansion(
      combined,
      input.modelInput.allowedClaims.map((claim) => claim.prohibitedExpansion),
    );
}

function recipeFor(episodeTemplateRef: string): EpisodeRecipeV4 {
  const recipe = episodeRecipes.find((candidate) => (
    candidate.episodeTemplateRef === episodeTemplateRef
  ));
  assertRuntime(recipe !== undefined, `没有冻结协作配方：${episodeTemplateRef}`);
  return recipe;
}

export function buildXunpuGroundedCollaborationRuntimeContentV4(input: {
  content: XunpuGroundedContentInputV4;
  baseKnowledge: readonly BaseKnowledgeInputV4[];
  addedKnowledge: readonly AddedKnowledgeInputV4[];
}): GroundedCollaborationRuntimeContentV4 {
  const knowledge: GroundedRuntimeKnowledgeV4[] = [
    ...input.baseKnowledge.filter((record) => record.reviewStatus !== "retired").map((record) => ({
      knowledgeRef: record.knowledgeId,
      title: record.source.title,
      sourceTitle: record.source.title,
      sourceUrl: record.source.url,
      locator: record.source.locator,
      teachingSummary: record.teachingSummary,
      sourceContentHash: record.contentHash,
      reviewStatus: record.reviewStatus as "pending_expert_review" | "verified",
    })),
    ...input.addedKnowledge.map((record) => ({
      knowledgeRef: record.knowledgeId,
      title: record.title,
      sourceTitle: record.sourceTitle,
      sourceUrl: record.url,
      locator: record.locator,
      teachingSummary: record.teachingSummary,
      sourceContentHash: record.contentHash,
      reviewStatus: record.reviewStatus,
    })),
  ];
  assertRuntime(
    knowledge.length === new Set(knowledge.map((record) => record.knowledgeRef)).size,
    "知识 ID 重复",
  );
  for (const record of knowledge) {
    assertRuntime(record.sourceUrl.startsWith("https://"), `知识来源不是 HTTPS：${record.knowledgeRef}`);
    assertRuntime(hashPattern.test(record.sourceContentHash), `知识哈希非法：${record.knowledgeRef}`);
    assertRuntime(record.locator.trim().length > 0, `知识缺少 locator：${record.knowledgeRef}`);
  }
  const knowledgeRefs = new Set(knowledge.map((record) => record.knowledgeRef));
  const claims = input.content.groundedClaims.map((claim) => ({
    claimRef: claim.claimId,
    allowedWording: claim.allowedWording,
    knowledgeRefs: [...claim.knowledgeRefs],
    runtimeEvidenceKinds: [...claim.runtimeEvidenceKinds],
    prohibitedExpansion: claim.prohibitedExpansion,
    minimumIndependentSupportCount: claim.minimumIndependentSupportCount,
  }));
  for (const claim of claims) {
    assertRuntime(
      claim.knowledgeRefs.every((reference) => knowledgeRefs.has(reference)),
      `Claim 引用未知或退役知识：${claim.claimRef}`,
    );
    assertRuntime(
      claim.knowledgeRefs.length >= claim.minimumIndependentSupportCount,
      `Claim 来源数量不足：${claim.claimRef}`,
    );
  }
  const claimRefs = new Set(claims.map((claim) => claim.claimRef));
  const episodes = input.content.agentEpisodes.map((episode) => ({
    episodeTemplateRef: episode.episodeTemplateId,
    groundedClaimRefs: [...episode.groundedClaimRefs],
    failureClosedWhen: [...episode.failureClosedWhen],
  }));
  for (const episode of episodes) {
    recipeFor(episode.episodeTemplateRef);
    assertRuntime(
      episode.groundedClaimRefs.every((reference) => claimRefs.has(reference)),
      `Episode 引用未知 Claim：${episode.episodeTemplateRef}`,
    );
  }
  return {
    contentSchemaVersion: input.content.schemaVersion,
    contentHash: input.content.contentHash,
    knownObjectRefs: unique([
      ...input.content.locations.map((item) => item.locationId),
      ...input.content.worldObjects.map((item) => item.objectId),
      ...input.content.variables.map((item) => item.variableId),
      ...input.content.cast.map((item) => item.entityId),
      ...input.content.artifacts.map((item) => item.artifactId),
      ...input.content.mediaAssets.map((item) => item.assetId),
    ]),
    knowledge,
    claims,
    episodes,
  };
}

function assertTopology(topology: readonly SimulationAgentTemplateV3[]): void {
  assertRuntime(topology.length === 14, "V4 协作拓扑必须保持十四个候选智能体");
  assertRuntime(new Set(topology.map((item) => item.agentTemplateId)).size === 14, "拓扑模板重复");
  assertRuntime(new Set(topology.map((item) => item.groupId)).size === 6, "V4 协作拓扑必须保持六组");
  const known = new Set(topology.map((item) => item.agentTemplateId));
  for (const recipe of episodeRecipes) {
    assertRuntime(
      recipe.moves.every((move) => known.has(move.agentTemplateRef)),
      `协作配方引用未知智能体：${recipe.episodeTemplateRef}`,
    );
  }
}

export function recomputeGroundedDispatchV4(input: {
  topology: readonly SimulationAgentTemplateV3[];
  episodeTemplateRef: string;
  policy: GroundedCollaborationPolicyV4;
  maximumSelectedAgents: number;
  plan?: GroundedCollaborationPlanV4;
}): TeacherGroundedCollaborationEpisodeV4["dispatchDecisions"] {
  assertTopology(input.topology);
  assertRuntime(
    Number.isInteger(input.maximumSelectedAgents)
      && input.maximumSelectedAgents >= 1
      && input.maximumSelectedAgents <= 5,
    "智能体选择预算非法",
  );
  const recipe = recipeFor(input.episodeTemplateRef);
  const required = unique((input.plan?.steps ?? recipe.moves).map((move) => move.agentTemplateRef));
  const selected = input.policy === "affected_set"
    ? required.slice(0, input.maximumSelectedAgents)
    : input.policy === "fixed_team"
      ? fixedTeam.slice(0, input.maximumSelectedAgents)
      : required.slice(0, 1);
  const selectedSet = new Set(selected);
  const requiredSet = new Set(required);
  const affectedSet = new Set(recipe.affectedAgentRefs);
  return input.topology.map((template) => {
    const selectedThis = selectedSet.has(template.agentTemplateId);
    if (selectedThis) {
      return {
        agentTemplateRef: template.agentTemplateId,
        professionalRoleId: template.professionalRoleId,
        decision: "selected" as const,
        reasonCode: affectedSet.has(template.agentTemplateId)
          ? "affected_object_match" as const
          : "claim_domain_match" as const,
        businessReason: affectedSet.has(template.agentTemplateId)
          ? "该角色直接管理本次受影响对象，必须参与当前业务判断。"
          : "该角色负责本次 Claim 的提案、质疑、补证、修订或联合收口。",
      };
    }
    const omittedRequired = requiredSet.has(template.agentTemplateId);
    return {
      agentTemplateRef: template.agentTemplateId,
      professionalRoleId: template.professionalRoleId,
      decision: "skipped" as const,
      reasonCode: !template.enabled
        ? "disabled" as const
        : !template.available
          ? "unavailable" as const
          : omittedRequired
            ? "budget_limit" as const
            : "not_affected" as const,
      businessReason: omittedRequired
        ? "当前对照策略或选择预算未保留该必要能力，后续五步链可能因此失败关闭。"
        : "当前事件既不改变该角色负责的对象，也不命中其 Claim 职责。",
    };
  });
}

function citationsForClaims(
  content: GroundedCollaborationRuntimeContentV4,
  claimRefs: readonly string[],
): GroundedKnowledgeCitationV4[] {
  const claims = claimRefs.map((claimRef) => {
    const claim = content.claims.find((candidate) => candidate.claimRef === claimRef);
    assertRuntime(claim !== undefined, `Claim 不存在：${claimRef}`);
    return claim;
  });
  const knowledgeRefs = unique(claims.flatMap((claim) => claim.knowledgeRefs));
  return knowledgeRefs.map((knowledgeRef) => {
    const record = content.knowledge.find((candidate) => (
      candidate.knowledgeRef === knowledgeRef
    ));
    assertRuntime(record !== undefined, `知识不存在：${knowledgeRef}`);
    return {
      knowledgeRef,
      sourceTitle: record.sourceTitle,
      sourceUrl: record.sourceUrl,
      locator: record.locator,
      sourceContentHash: record.sourceContentHash,
      reviewStatus: record.reviewStatus,
      supportsClaimRefs: claims.filter((claim) => (
        claim.knowledgeRefs.includes(knowledgeRef)
      )).map((claim) => claim.claimRef),
      stance: "supports",
    };
  });
}

function groundingFailure(
  content: GroundedCollaborationRuntimeContentV4,
  template: GroundedRuntimeEpisodeTemplateV4,
  input: StartGroundedCollaborationEpisodeV4Input,
): string | null {
  if (!sameSet(template.groundedClaimRefs, input.claimRefs)) {
    return "请求 Claim 与冻结 Episode 不一致";
  }
  if (input.evidence.length === 0) return "本轮没有真实证据";
  for (const claimRef of template.groundedClaimRefs) {
    const claim = content.claims.find((candidate) => candidate.claimRef === claimRef);
    if (!claim) return `Claim 不存在：${claimRef}`;
    const citations = citationsForClaims(content, [claimRef]);
    if (citations.length < claim.minimumIndependentSupportCount) {
      return `Claim 来源不足：${claimRef}`;
    }
    if (!input.evidence.some((evidence) => (
      claim.runtimeEvidenceKinds.includes(evidence.evidenceKind)
    ))) {
      return `Claim 缺少运行证据：${claimRef}`;
    }
  }
  return null;
}

function claimsForRetrieval(
  input: StartGroundedCollaborationEpisodeV4Input,
  content: GroundedCollaborationRuntimeContentV4,
): GroundedRuntimeClaimV4[] {
  return input.claimRefs.map((claimRef) => content.claims.find((claim) => (
    claim.claimRef === claimRef
  ))).filter((claim): claim is GroundedRuntimeClaimV4 => claim !== undefined);
}

function retrievalAuthorizationInputFor(
  input: StartGroundedCollaborationEpisodeV4Input,
  content: GroundedCollaborationRuntimeContentV4,
  flagshipContentRef: FlagshipContentReferenceV4,
  now: string,
): GroundedEvidenceAuthorizationInputV4 {
  const claims = claimsForRetrieval(input, content);
  return {
    sessionId: input.sessionId,
    courseReleaseRef: flagshipContentRef.courseReleaseRef,
    studentBindingHash: hash({
      sessionId: input.sessionId,
      bindingId: input.studentBindingId,
    }),
    allowedObjectRefs: [...input.affectedObjectRefs],
    allowedClaimRefs: [...input.claimRefs],
    allowedKnowledgeRefs: unique(claims.flatMap((claim) => claim.knowledgeRefs)),
    allowedSourceRevisionRefs: [],
    asOf: now,
  };
}

function retrievalQueryFor(
  input: StartGroundedCollaborationEpisodeV4Input,
  content: GroundedCollaborationRuntimeContentV4,
  moveKind: AdminGroundedBusinessMoveV4["moveKind"],
  now: string,
): GroundedRetrievalQueryV4 {
  const claims = claimsForRetrieval(input, content);
  return {
    queryId: stableId("grounded-query", {
      episodeId: input.episodeId,
      moveKind,
      claimRefs: input.claimRefs,
      objectRefs: input.affectedObjectRefs,
    }),
    episodeTemplateRef: input.episodeTemplateRef,
    moveKind,
    queryText: claims.map((claim) => claim.allowedWording).join("；").slice(0, 2_000),
      claimRefs: [...input.claimRefs],
      objectRefs: [...input.affectedObjectRefs],
      evidenceKinds: unique(claims.flatMap((claim) => claim.runtimeEvidenceKinds)),
      evidenceRefs: input.evidence.map((evidence) => evidence.evidenceRef),
      evidenceSnapshotHash: hash(input.evidence),
      asOf: now,
    maxResults: 16,
  };
}

function dynamicPlanFor(input: {
  recipe: EpisodeRecipeV4;
  retrieval: GroundedRetrievalResultV4;
}): GroundedCollaborationPlanV4 {
  const { recipe, retrieval } = input;
  const conflict = retrieval.conflictRefs.length > 0;
  const revoked = retrieval.revokedClaimRefs.length > 0;
  const missing = retrieval.unresolvedClaimRefs.length > 0;
  const baseSteps = conflict || revoked
    ? [...recipe.moves]
    : missing
      ? [recipe.moves[0]!, recipe.moves[2]!, recipe.moves.at(-1)!]
      : [recipe.moves[0]!, recipe.moves[1]!, recipe.moves.at(-1)!];
  const sourceNote = retrieval.citations.slice(0, 2).map((citation) => (
    `${citation.sourceTitle}（${citation.locator}）`
  )).join("、");
  const state = revoked
    ? "revoked_evidence" as const
    : conflict
      ? "conflicted" as const
      : missing
        ? "missing_evidence" as const
        : "sufficient" as const;
  const stateNote = revoked
    ? "检索结果包含已撤回片段，不能把旧材料当作当前授权。"
    : conflict
      ? "当前授权片段存在相互冲突的立场，协作必须保留分歧。"
      : missing
        ? `仍缺少 ${retrieval.unresolvedClaimRefs.join("、")} 的可定位材料。`
        : `当前片段支持继续判断：${sourceNote || "已有授权材料"}。`;
  const steps = baseSteps.map((step, index) => ({
    stepId: stableId("grounded-plan-step", {
      retrievalResultHash: retrieval.resultHash,
      index,
      moveKind: step.moveKind,
      agentTemplateRef: step.agentTemplateRef,
    }),
    moveKind: step.moveKind,
    agentTemplateRef: step.agentTemplateRef,
    position: step.position,
    safeSummary: `${step.safeSummary} ${stateNote}`.slice(0, 900),
    rationale: `${step.rationale} 本步依据：${sourceNote || "当前授权检索结果"}。`.slice(0, 1_200),
    stopCondition: step.moveKind === "evidence_request"
      ? "request_evidence" as const
      : step.moveKind === "revision"
        ? "revise" as const
        : step.moveKind === "joint_proposal"
          ? "joint" as const
          : "continue" as const,
  }));
  return GroundedCollaborationPlanV4Schema.parse({
    schemaVersion: "grounded-retrieval/4.0.0",
    planId: stableId("grounded-plan", {
      episodeTemplateRef: recipe.episodeTemplateRef,
      retrievalQueryHash: retrieval.queryHash,
      retrievalResultHash: retrieval.resultHash,
    }),
    retrievalQueryHash: retrieval.queryHash,
    retrievalResultHash: retrieval.resultHash,
    steps,
    unresolvedClaimRefs: [...retrieval.unresolvedClaimRefs],
    conflictRefs: [...retrieval.conflictRefs],
    plannerState: state,
    publicSummary: `${recipe.publicSummary} ${stateNote}`.slice(0, 1_000),
    recommendedActionRefs: conflict || revoked
      ? [...recipe.recommendedActionRefs]
      : [recipe.recommendedActionRefs[0]!],
  });
}

function citationsFromRetrieval(
  retrieval: GroundedRetrievalResultV4,
): GroundedKnowledgeCitationV4[] {
  return retrieval.citations.map((citation) => ({
    knowledgeRef: citation.knowledgeRef,
    sourceTitle: citation.sourceTitle,
    sourceUrl: citation.sourceUrl,
    sourceRef: citation.sourceRef,
    sourceKind: citation.sourceKind,
    locator: citation.locator,
    sourceContentHash: citation.fragmentHash,
    reviewStatus: citation.reviewStatus,
    supportsClaimRefs: [...citation.supportsClaimRefs],
    stance: citation.stance,
    ...(citation.snippet ? { snippet: citation.snippet } : {}),
    ...(citation.sourceDocumentRef ? { sourceDocumentRef: citation.sourceDocumentRef } : {}),
    ...(citation.fragmentRef ? { fragmentRef: citation.fragmentRef } : {}),
    ...(citation.sourceRevision ? { sourceRevision: citation.sourceRevision } : {}),
    ...(citation.fragmentHash ? { fragmentHash: citation.fragmentHash } : {}),
    ...(citation.expiresAt === null ? {} : { expiresAt: citation.expiresAt }),
    ...(citation.revokedAt === null ? {} : { revokedAt: citation.revokedAt }),
  }));
}

function assertRetrievalAuthorized(
  retrieval: GroundedRetrievalResultV4,
  authorization: GroundedEvidenceAuthorizationV4,
): void {
  const allowed = new Map(authorization.allowedFragments.map((fragment) => (
    [fragment.fragmentRef, fragment]
  )));
  for (const citation of retrieval.citations) {
    const fragment = allowed.get(citation.fragmentRef);
    assertRuntime(fragment !== undefined, `检索返回未授权片段：${citation.fragmentRef}`);
    assertRuntime(fragment.knowledgeRef === citation.knowledgeRef, "知识引用授权漂移");
    assertRuntime(fragment.sourceDocumentRef === citation.sourceDocumentRef, "来源文档授权漂移");
    assertRuntime(fragment.sourceRevision === citation.sourceRevision, "来源版本授权漂移");
    assertRuntime(fragment.fragmentHash === citation.fragmentHash, "片段哈希授权漂移");
    assertRuntime(fragment.sourceRef === citation.sourceRef, "来源稳定引用授权漂移");
    assertRuntime(fragment.sourceKind === citation.sourceKind, "来源类型授权漂移");
    assertRuntime(fragment.sourceUrl === citation.sourceUrl, "来源 URL 授权漂移");
    assertRuntime(fragment.sourceTitle === citation.sourceTitle, "来源标题授权漂移");
    assertRuntime(fragment.snippet === citation.snippet, "来源短引授权漂移");
    assertRuntime(fragment.locator === citation.locator, "来源定位授权漂移");
    assertRuntime(fragment.reviewStatus === citation.reviewStatus, "来源复核状态授权漂移");
    assertRuntime(fragment.effectiveAt === citation.effectiveAt, "来源生效时间授权漂移");
    assertRuntime(fragment.expiresAt === citation.expiresAt, "来源有效期授权漂移");
    assertRuntime(fragment.revokedAt === citation.revokedAt, "来源撤回状态授权漂移");
    assertRuntime(sameSet(fragment.objectRefs, citation.objectRefs), "来源对象授权漂移");
    assertRuntime(sameSet(fragment.supportsClaimRefs, citation.supportsClaimRefs), "来源 Claim 授权漂移");
    assertRuntime(sameSet(fragment.evidenceKinds, citation.evidenceKinds), "来源证据类型授权漂移");
  }
}

function assertMoveCitationsAuthorized(
  citations: readonly GroundedKnowledgeCitationV4[],
  authorization: GroundedEvidenceAuthorizationV4,
): void {
  const allowed = new Map(authorization.allowedFragments.map((fragment) => (
    [fragment.fragmentRef, fragment]
  )));
  for (const citation of citations) {
    const fragment = allowed.get(citation.fragmentRef ?? citation.knowledgeRef);
    assertRuntime(fragment !== undefined, "历史动作引用了当前授权之外的片段");
    assertRuntime(fragment.knowledgeRef === citation.knowledgeRef, "历史动作知识授权漂移");
    assertRuntime(citation.sourceDocumentRef === fragment.sourceDocumentRef, "历史动作来源文档漂移");
    assertRuntime(citation.sourceRevision === fragment.sourceRevision, "历史动作来源版本漂移");
    assertRuntime(citation.fragmentHash === fragment.fragmentHash, "历史动作片段哈希漂移");
    assertRuntime(citation.sourceRef === fragment.sourceRef, "历史动作稳定来源引用漂移");
    assertRuntime(citation.sourceKind === fragment.sourceKind, "历史动作来源类型漂移");
    assertRuntime(citation.sourceUrl === fragment.sourceUrl, "历史动作来源 URL 漂移");
    assertRuntime(citation.sourceTitle === fragment.sourceTitle, "历史动作来源标题漂移");
    assertRuntime(citation.snippet === fragment.snippet, "历史动作短引漂移");
    assertRuntime(citation.locator === fragment.locator, "历史动作来源定位漂移");
    assertRuntime(citation.reviewStatus === fragment.reviewStatus, "历史动作复核状态漂移");
    assertRuntime((citation.expiresAt ?? null) === fragment.expiresAt, "历史动作有效期漂移");
    assertRuntime((citation.revokedAt ?? null) === fragment.revokedAt, "历史动作撤回状态漂移");
  }
}

function mergeEvidenceSnapshots(
  existing: readonly GroundedEvidenceSnapshotV4[],
  incoming: readonly GroundedEvidenceSnapshotV4[],
): { evidence: GroundedEvidenceSnapshotV4[]; addedRefs: string[] } {
  const byRef = new Map(existing.map((item) => [item.evidenceRef, item]));
  const addedRefs: string[] = [];
  for (const item of incoming) {
    const previous = byRef.get(item.evidenceRef);
    if (previous) {
      assertRuntime(canonicalString(previous) === canonicalString(item), `证据引用 ${item.evidenceRef} 载荷漂移`);
      continue;
    }
    byRef.set(item.evidenceRef, structuredClone(item));
    addedRefs.push(item.evidenceRef);
  }
  return { evidence: [...byRef.values()], addedRefs };
}

function mergePlanWithExistingMoves(
  plan: GroundedCollaborationPlanV4,
  record: GroundedCollaborationRecordV4,
): GroundedCollaborationPlanV4 {
  const prefix: GroundedCollaborationPlanV4["steps"] = record.moves.map((move, index) => {
    const intent = record.intents[index]!;
    return {
      stepId: `history-step-${move.moveId}`,
      moveKind: move.moveKind,
      agentTemplateRef: move.agentTemplateRef,
      position: intent.position,
      safeSummary: move.safeSummary,
      rationale: move.rationale,
      stopCondition: "continue" as const,
    };
  });
  const completedKinds = new Set(record.moves.map((move) => move.moveKind));
  const remaining = plan.steps.filter((step) => (
    step.moveKind === "joint_proposal"
      && record.status === "joint_proposal_ready"
  ) || !completedKinds.has(step.moveKind));
  const steps = [...prefix, ...remaining];
  if ((plan.plannerState === "missing_evidence" || plan.plannerState === "revoked_evidence")
    && steps.at(-1)?.moveKind !== "joint_proposal") {
    steps.push(plan.steps.at(-1)!);
  }
  if (plan.plannerState === "missing_evidence" || plan.plannerState === "revoked_evidence") {
    const evidenceIndex = steps.findIndex((step) => step.moveKind === "evidence_request");
    if (evidenceIndex >= 0) {
      steps[evidenceIndex] = { ...steps[evidenceIndex]!, stopCondition: "request_evidence" };
    }
  }
  return GroundedCollaborationPlanV4Schema.parse({ ...plan, steps });
}

function refreshPlanForUnavailableEvidence(input: {
  recipe: EpisodeRecipeV4;
  record: GroundedCollaborationRecordV4;
  retrieval: GroundedRetrievalResultV4;
}): GroundedCollaborationPlanV4 {
  const prefix: GroundedCollaborationPlanV4["steps"] = input.record.moves.map((move, index) => ({
    stepId: `history-step-${move.moveId}`,
    moveKind: move.moveKind,
    agentTemplateRef: move.agentTemplateRef,
    position: input.record.intents[index]!.position,
    safeSummary: move.safeSummary,
    rationale: move.rationale,
    stopCondition: "continue" as const,
  }));
  const steps = [...prefix];
  if (!steps.some((step) => step.moveKind === "evidence_request")) {
    const evidenceStep = input.recipe.moves.find((step) => step.moveKind === "evidence_request")!;
    steps.push({
      stepId: stableId("grounded-refresh-evidence-step", input.retrieval.resultHash),
      moveKind: evidenceStep.moveKind,
      agentTemplateRef: evidenceStep.agentTemplateRef,
      position: evidenceStep.position,
      safeSummary: `${evidenceStep.safeSummary} 当前授权片段已失效或不可用，请补充新的 source revision。`.slice(0, 900),
      rationale: `${evidenceStep.rationale} 现有授权 tuple 未能提供可用材料。`.slice(0, 1_200),
      stopCondition: "request_evidence" as const,
    });
  } else {
    const evidenceIndex = steps.findIndex((step) => step.moveKind === "evidence_request");
    steps[evidenceIndex] = { ...steps[evidenceIndex]!, stopCondition: "request_evidence" };
  }
  if (input.record.status === "joint_proposal_ready"
    || !steps.some((step) => step.moveKind === "joint_proposal")) {
    const jointStep = input.recipe.moves.at(-1)!;
    steps.push({
      ...jointStep,
      stepId: stableId("grounded-refresh-joint-step", input.retrieval.resultHash),
      stopCondition: "joint" as const,
    });
  }
  return GroundedCollaborationPlanV4Schema.parse({
    schemaVersion: "grounded-retrieval/4.0.0",
    planId: stableId("grounded-refresh-plan", input.retrieval.resultHash),
    retrievalQueryHash: input.retrieval.queryHash,
    retrievalResultHash: input.retrieval.resultHash,
    steps,
    unresolvedClaimRefs: [...input.retrieval.unresolvedClaimRefs],
    conflictRefs: [...input.retrieval.conflictRefs],
    plannerState: input.retrieval.revokedClaimRefs.length > 0
      || input.retrieval.expiredClaimRefs.length > 0
      ? "revoked_evidence"
      : "missing_evidence",
    publicSummary: "当前授权片段已过期、撤回或不可用；协作停在补证，未生成新的联合建议。",
    recommendedActionRefs: [...input.recipe.recommendedActionRefs],
  });
}

function executionSummary(record: GroundedCollaborationRecordV4) {
  const modes = new Set(record.runs.map((run) => run.executionMode));
  return {
    executionMode: modes.size === 0 || (modes.size === 1 && modes.has("deterministic_demo"))
      ? "deterministic_demo" as const
      : modes.size === 1
        ? "live" as const
        : "mixed" as const,
    selectedCount: record.dispatchDecisions.filter((decision) => (
      decision.decision === "selected"
    )).length,
    skippedCount: record.dispatchDecisions.filter((decision) => (
      decision.decision === "skipped"
    )).length,
    totalLatencyMs: record.runs.reduce((sum, run) => sum + run.latencyMs, 0),
    totalEstimatedCostMicros: record.runs.reduce(
      (sum, run) => sum + run.estimatedCostMicros,
      0,
    ),
  };
}

function publicBusinessStatus(record: GroundedCollaborationRecordV4) {
  if (record.status === "failed") return "failed" as const;
  if (record.status === "in_progress") return "in_progress" as const;
  return "joint_proposal_ready" as const;
}

function teacherMoves(record: GroundedCollaborationRecordV4): TeacherGroundedBusinessMoveV4[] {
  return record.moves.map((move) => {
    const { execution: _execution, ...businessMove } = move;
    return TeacherGroundedBusinessMoveV4Schema.parse(businessMove);
  });
}

export function projectGroundedCollaborationForAdminV4(
  record: GroundedCollaborationRecordV4,
): AdminGroundedCollaborationEpisodeV4 {
  return AdminGroundedCollaborationEpisodeV4Schema.parse({
    schemaVersion: GroundedAgentCollaborationEpisodeV4SchemaVersion,
    episodeId: record.episodeId,
    sessionId: record.sessionId,
    flagshipContentRef: record.flagshipContentRef,
    sourceWorldStateVersion: record.request.sourceWorldStateVersion,
    triggerEventRef: record.request.triggerEventRef,
    affectedObjectRefs: record.request.affectedObjectRefs,
    generatedAt: record.updatedAt,
    audience: "admin",
    status: publicBusinessStatus(record),
    dispatchDecisions: record.dispatchDecisions,
    moves: record.moves,
    jointProposal: record.jointProposal,
    failure: record.failure,
    writeDisposition: record.status === "failed" ? "zero_write" : "proposal_only",
    executionSummary: executionSummary(record),
  });
}

export function projectGroundedCollaborationForTeacherV4(
  record: GroundedCollaborationRecordV4,
): TeacherGroundedCollaborationEpisodeV4 {
  return TeacherGroundedCollaborationEpisodeV4Schema.parse({
    schemaVersion: GroundedAgentCollaborationEpisodeV4SchemaVersion,
    episodeId: record.episodeId,
    sessionId: record.sessionId,
    flagshipContentRef: record.flagshipContentRef,
    sourceWorldStateVersion: record.request.sourceWorldStateVersion,
    triggerEventRef: record.request.triggerEventRef,
    affectedObjectRefs: record.request.affectedObjectRefs,
    generatedAt: record.updatedAt,
    audience: "teacher",
    status: publicBusinessStatus(record),
    dispatchDecisions: record.dispatchDecisions,
    moves: teacherMoves(record),
    jointProposal: record.jointProposal,
    failure: record.failure,
    writeDisposition: record.status === "failed" ? "zero_write" : "proposal_only",
  });
}

export function projectGroundedCollaborationForStudentV4(
  record: GroundedCollaborationRecordV4,
): StudentGroundedCollaborationEpisodeV4 {
  const retrieval = record.request.retrieval;
  const unavailable = retrieval?.status === "unavailable" || retrieval?.status === "forbidden";
  const messages = (refs: readonly string[] | undefined, description: string) => refs?.length ? [`${refs.length} 项${description}`] : [];
  const shared = {
    schemaVersion: GroundedAgentCollaborationEpisodeV4SchemaVersion,
    episodeId: record.episodeId,
    sessionId: record.sessionId,
    flagshipContentRef: record.flagshipContentRef,
    sourceWorldStateVersion: record.request.sourceWorldStateVersion,
    triggerEventRef: record.request.triggerEventRef,
    affectedObjectRefs: record.request.affectedObjectRefs,
    generatedAt: record.updatedAt,
    audience: "student" as const,
    evidenceState: {
      status: unavailable ? "unavailable" : record.status === "in_progress" ? "needs_evidence" : "ready",
      gaps: messages(retrieval?.unresolvedClaimRefs, "判断尚缺少可用来源，请核对材料的完整性与适用范围。"),
      conflicts: messages(retrieval?.conflictRefs, "判断存在相互冲突的材料，需要保留对照并补充核验。"),
      expired: messages(retrieval?.expiredClaimRefs, "判断涉及已过期的资料授权，需要更新来源。"),
      revoked: messages(retrieval?.revokedClaimRefs, "判断涉及已撤销的资料授权，当前不能采用。"),
      reason: retrieval?.status === "unavailable" ? "资料检索暂时不可用，本轮协作已保留，请稍后重试。"
        : retrieval?.status === "forbidden" ? "当前资料缺少有效引用关系或使用授权，请教师核对后继续。"
          : record.status === "in_progress" ? "当前证据尚不足以完成协作，请补充资料后继续。" : null,
      authorizationExpiresAt: record.request.evidenceAuthorization?.expiresAt ?? null,
    },
  };
  if (record.status === "failed") {
    return StudentGroundedCollaborationEpisodeV4Schema.parse({
      ...shared,
      status: "failed",
      suggestion: null,
      studentDecision: null,
      worldConsequenceRef: null,
      failure: {
        reasonCode: record.failure!.reasonCode === "move_sequence_incomplete"
          ? "agent_execution_failed"
          : record.failure!.reasonCode,
        safeMessage: record.failure!.safeMessage,
      },
    });
  }
  if (record.status === "in_progress") {
    return StudentGroundedCollaborationEpisodeV4Schema.parse({
      ...shared,
      status: "waiting",
      suggestion: null,
      studentDecision: null,
      worldConsequenceRef: null,
      failure: null,
    });
  }
  const approved = record.request.evidenceAuthorization?.allowedFragments;
  const citations = [...new Map(record.moves.flatMap((move) => move.knowledgeCitations)
    .filter((citation) => !approved || approved.some((fragment) => fragment.fragmentRef === citation.fragmentRef
      && fragment.sourceRevision === citation.sourceRevision && fragment.fragmentHash === citation.fragmentHash))
    .map((citation) => [`${citation.knowledgeRef}:${citation.fragmentRef ?? citation.sourceContentHash}`, citation])).values()].slice(0, 6);
  return StudentGroundedCollaborationEpisodeV4Schema.parse({
    ...shared,
    status: record.status === "completed"
      ? "completed"
      : record.status === "student_decided"
        ? "decided"
        : "suggestion_ready",
    suggestion: {
      suggestionId: stableId("suggestion", record.jointProposal!.jointProposalId),
      sourceJointProposalRef: record.jointProposal!.jointProposalId,
      professionalRole: "责任编辑协作建议",
      summary: record.jointProposal!.publicSummary,
      rationale: "建议来自本轮已完成的专业协作与来源核验；你仍可采纳、要求补证或拒绝。",
      knowledgeCitations: citations,
      recommendedActionRefs: record.jointProposal!.recommendedActionRefs.slice(0, 4),
      riskLevel: record.jointProposal!.riskLevel,
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: record.studentDecision
      ? {
          decisionRef: record.studentDecision.decisionRef,
          decision: record.studentDecision.decision,
          rationale: record.studentDecision.rationale,
          rationaleSource: record.studentDecision.rationaleSource ?? "legacy_unspecified",
          decidedAt: record.studentDecision.decidedAt,
        }
      : null,
    worldConsequenceRef: record.worldConsequence?.worldConsequenceRef ?? null,
    failure: null,
  });
}

export function issueGroundedSuggestionDecisionTokenV4(input: {
  secret: string;
  episodeId: string;
  sessionId: string;
  bindingId: string;
  jointProposalContentHash: string;
}): string {
  assertRuntime(input.secret.length >= 32, "学生决定密钥至少需要 32 个字符");
  return hmac(input.secret, "groundeddecision", {
    episodeId: input.episodeId,
    sessionId: input.sessionId,
    bindingId: input.bindingId,
    jointProposalContentHash: input.jointProposalContentHash,
  });
}

export function issueGroundedWorldConsequenceTokenV4(
  secret: string,
  payload: GroundedWorldConsequencePayloadV4,
): string {
  assertRuntime(secret.length >= 32, "世界后果密钥至少需要 32 个字符");
  return hmac(secret, "groundedworld", payload);
}

function validateIdentifier(value: string, label: string): void {
  assertRuntime(idPattern.test(value), `${label}非法`);
}

function validateEvidence(
  evidence: readonly GroundedEvidenceSnapshotV4[],
  knownObjectRefs: ReadonlySet<string>,
): void {
  assertRuntime(evidence.length > 0 && evidence.length <= 32, "真实证据数量非法");
  assertRuntime(
    new Set(evidence.map((item) => item.evidenceRef)).size === evidence.length,
    "真实证据引用重复",
  );
  for (const item of evidence) {
    validateIdentifier(item.evidenceRef, "证据引用");
    validateIdentifier(item.evidenceKind, "证据类型");
    assertRuntime(hashPattern.test(item.contentHash), "证据内容哈希非法");
    assertRuntime(item.objectRefs.length > 0, "证据必须绑定业务对象");
    assertRuntime(
      item.objectRefs.every((reference) => knownObjectRefs.has(reference)),
      `证据引用未知对象：${item.evidenceRef}`,
    );
  }
}

function failure(
  reasonCode: GroundedCollaborationFailureV4["reasonCode"],
  safeMessage: string,
  failedMoveRef: string | null = null,
): GroundedCollaborationFailureV4 {
  return { reasonCode, safeMessage, failedMoveRef };
}

interface ExecutedMoveV4 {
  task: GroundedAgentTaskRecordV4;
  observation: GroundedAgentObservationRecordV4;
  run: GroundedAgentRunRecordV4;
  intent: GroundedAgentIntentRecordV4;
  move: AdminGroundedBusinessMoveV4;
}

export class XunpuGroundedCollaborationServiceV4 {
  readonly #store: GroundedCollaborationStoreV4;
  readonly #content: GroundedCollaborationRuntimeContentV4;
  readonly #flagshipContentRef: FlagshipContentReferenceV4;
  readonly #decisionSecret: string;
  readonly #worldAuthoritySecret: string;
  readonly #getCurrentWorldStateVersion: (sessionId: string) => Promise<number>;
  readonly #model: GroundedCollaborationModelV4 | undefined;
  readonly #retrieval: GroundedRetrievalPortV4 | undefined;
  readonly #authorizationResolver: GroundedEvidenceAuthorizationResolverV4 | undefined;
  readonly #groundingMode: "legacy" | "retrieval";
  readonly #topology: readonly SimulationAgentTemplateV3[];
  readonly #now: () => string;
  readonly #active = new Map<string, {
    requestHash: string;
    operation: Promise<GroundedCollaborationRecordV4>;
  }>();

  constructor(options: GroundedCollaborationServiceV4Options) {
    assertRuntime(options.decisionSecret.length >= 32, "学生决定密钥至少需要 32 个字符");
    assertRuntime(options.worldAuthoritySecret.length >= 32, "世界后果密钥至少需要 32 个字符");
    this.#store = options.store;
    this.#content = structuredClone(options.content);
    this.#flagshipContentRef = FlagshipContentReferenceV4Schema.parse(
      options.flagshipContentRef,
    );
    assertRuntime(
      this.#flagshipContentRef.contentHash === this.#content.contentHash
        && this.#flagshipContentRef.contentSchemaVersion
          === this.#content.contentSchemaVersion,
      "运行内容与旗舰内容引用漂移",
    );
    this.#decisionSecret = options.decisionSecret;
    this.#worldAuthoritySecret = options.worldAuthoritySecret;
    this.#getCurrentWorldStateVersion = options.getCurrentWorldStateVersion;
    this.#model = options.model;
    this.#retrieval = options.retrieval;
    this.#authorizationResolver = options.authorizationResolver;
    this.#groundingMode = options.groundingMode ?? "retrieval";
    this.#topology = structuredClone(
      options.topology ?? buildXunpuSimulationAgentTemplatesV3R2(),
    );
    assertTopology(this.#topology);
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get topology(): readonly SimulationAgentTemplateV3[] {
    return structuredClone(this.#topology);
  }

  async getRecord(episodeId: string): Promise<GroundedCollaborationRecordV4> {
    const record = await this.#store.load(episodeId);
    if (!record) throw new GroundedCollaborationRecordNotFoundError(episodeId);
    this.#assertRecordContent(record);
    return record;
  }

  async startEpisode(
    input: StartGroundedCollaborationEpisodeV4Input,
  ): Promise<GroundedCollaborationRecordV4> {
    const concurrentRequestHash = hash({
      ...input,
      policy: input.policy ?? "affected_set",
      maximumSelectedAgents: input.maximumSelectedAgents ?? 5,
      executionBudgetMicros: input.executionBudgetMicros ?? 0,
    });
    const active = this.#active.get(input.episodeId);
    if (active) {
      assertRuntime(
        active.requestHash === concurrentRequestHash,
        "同一进行中 Episode ID 被用于不同请求",
      );
      return active.operation;
    }
    const operation = this.#startEpisodeUnlocked(input);
    this.#active.set(input.episodeId, {
      requestHash: concurrentRequestHash,
      operation,
    });
    try {
      return await operation;
    } finally {
      if (this.#active.get(input.episodeId)?.operation === operation) {
        this.#active.delete(input.episodeId);
      }
    }
  }

  async resumeEpisodeWithEvidence(
    input: StartGroundedCollaborationEpisodeV4Input,
  ): Promise<GroundedCollaborationRecordV4> {
    assertRuntime(this.#groundingMode === "retrieval", "补证恢复必须使用 retrieval 模式");
    const existing = await this.getRecord(input.episodeId);
    assertRuntime(existing.sessionId === input.sessionId, "补证恢复会话漂移");
    assertRuntime(existing.request.episodeTemplateRef === input.episodeTemplateRef, "补证恢复 Episode 模板漂移");
    assertRuntime(existing.request.triggerEventRef === input.triggerEventRef, "补证恢复触发事件漂移");
    assertRuntime(existing.request.sourceWorldStateVersion === input.sourceWorldStateVersion, "补证恢复世界版本漂移");
    assertRuntime(sameSet(existing.request.affectedObjectRefs, input.affectedObjectRefs), "补证恢复对象范围漂移");
    assertRuntime(sameSet(existing.request.claimRefs, input.claimRefs), "补证恢复 Claim 范围漂移");
    assertRuntime(
      existing.request.studentBindingHash === hash({
        sessionId: input.sessionId,
        bindingId: input.studentBindingId,
      }),
      "补证恢复学生绑定漂移",
    );
    assertRuntime(
      canonicalString(existing.flagshipContentRef) === canonicalString(input.flagshipContentRef),
      "补证恢复内容引用漂移",
    );
    const merged = mergeEvidenceSnapshots(existing.request.evidence, input.evidence);
    if (existing.status !== "in_progress"
      && !(existing.status === "joint_proposal_ready" && existing.studentDecision === null)) {
      assertRuntime(
        canonicalString(merged.evidence) === canonicalString(existing.request.evidence),
        "已结束 Episode 不能追加新证据",
      );
      return existing;
    }
    const effectiveInput: StartGroundedCollaborationEpisodeV4Input = {
      ...input,
      evidence: merged.evidence,
      policy: existing.request.policy,
      maximumSelectedAgents: existing.request.maximumSelectedAgents,
      executionBudgetMicros: existing.request.executionBudgetMicros,
    };
    return this.#startEpisodeUnlocked(effectiveInput, {
      refreshFrom: existing,
      addedEvidenceRefs: merged.addedRefs,
    });
  }

  async #startEpisodeUnlocked(
    input: StartGroundedCollaborationEpisodeV4Input,
    refresh?: {
      refreshFrom: GroundedCollaborationRecordV4;
      addedEvidenceRefs: string[];
    },
  ): Promise<GroundedCollaborationRecordV4> {
    const recipe = recipeFor(input.episodeTemplateRef);
    const template = this.#content.episodes.find((candidate) => (
      candidate.episodeTemplateRef === input.episodeTemplateRef
    ));
    assertRuntime(template !== undefined, "协作 Episode 不在内容发布中");
    validateIdentifier(input.episodeId, "Episode ID");
    validateIdentifier(input.sessionId, "会话 ID");
    validateIdentifier(input.studentBindingId, "学生绑定 ID");
    validateIdentifier(input.triggerEventRef, "触发事件引用");
    assertRuntime(
      Number.isInteger(input.sourceWorldStateVersion)
        && input.sourceWorldStateVersion >= 0,
      "来源世界版本非法",
    );
    const parsedContentRef = FlagshipContentReferenceV4Schema.parse(
      input.flagshipContentRef,
    );
    assertRuntime(
      canonicalString(parsedContentRef) === canonicalString(this.#flagshipContentRef),
      "请求旗舰内容引用漂移",
    );
    const knownObjects = new Set(this.#content.knownObjectRefs);
    assertRuntime(
      input.affectedObjectRefs.length > 0
        && input.affectedObjectRefs.length <= 24
        && input.affectedObjectRefs.every((reference) => knownObjects.has(reference)),
      "受影响对象为空、过多或不属于发布内容",
    );
    assertRuntime(
      new Set(input.affectedObjectRefs).size === input.affectedObjectRefs.length,
      "受影响对象重复",
    );
    assertRuntime(
      input.claimRefs.length > 0
        && new Set(input.claimRefs).size === input.claimRefs.length
        && input.claimRefs.every((reference) => this.#content.claims.some(
          (claim) => claim.claimRef === reference,
        )),
      "Claim 为空、重复或不属于发布内容",
    );
    validateEvidence(input.evidence, knownObjects);
    assertRuntime(
      input.evidence.every((evidence) => evidence.objectRefs.some((reference) => (
        input.affectedObjectRefs.includes(reference)
      ))),
      "真实证据必须命中本轮受影响对象",
    );
    const policy = input.policy ?? "affected_set";
    const maximumSelectedAgents = input.maximumSelectedAgents ?? 5;
    const executionBudgetMicros = input.executionBudgetMicros ?? 0;
    assertRuntime(
      Number.isInteger(executionBudgetMicros) && executionBudgetMicros >= 0,
      "执行成本预算非法",
    );
    let retrieval: GroundedRetrievalResultV4 | undefined;
    let evidenceAuthorization: GroundedEvidenceAuthorizationV4 | undefined;
    if (this.#groundingMode === "retrieval") {
      const unavailableResult = (
        failureReason: string,
        authorizationHash = hash({ episodeId: input.episodeId, purpose: "grounded_collaboration" }),
        status: "unavailable" | "forbidden" = "unavailable",
        expiredClaimRefs: readonly string[] = [],
        revokedClaimRefs: readonly string[] = [],
      ) => GroundedRetrievalResultV4Schema.parse({
        schemaVersion: "grounded-retrieval/4.0.0",
        status,
        queryHash: hash({ episodeId: input.episodeId, purpose: "grounded_collaboration" }),
        resultHash: hash({ episodeId: input.episodeId, status: "unavailable", failureReason }),
        authorizationHash,
        citations: [],
        unresolvedClaimRefs: [...input.claimRefs],
        conflictRefs: [],
        expiredClaimRefs: [...expiredClaimRefs],
        revokedClaimRefs: [...revokedClaimRefs],
        retrievedAt: this.#now(),
        failureReason,
      });
      const authorizationInput = retrievalAuthorizationInputFor(
        input,
        this.#content,
        this.#flagshipContentRef,
        this.#now(),
      );
      const unavailableAuthorization = (failureReason: string) => {
        const base = {
          schemaVersion: "grounded-evidence-authorization/4.0.0" as const,
          status: "empty" as const,
          sessionId: authorizationInput.sessionId,
          courseReleaseRef: authorizationInput.courseReleaseRef,
          studentBindingHash: authorizationInput.studentBindingHash,
          purpose: "grounded_collaboration" as const,
          audience: "agent" as const,
          allowedObjectRefs: [...authorizationInput.allowedObjectRefs],
          allowedClaimRefs: [...authorizationInput.allowedClaimRefs],
          allowedKnowledgeRefs: [...authorizationInput.allowedKnowledgeRefs],
          allowedSourceRevisionRefs: [...(authorizationInput.allowedSourceRevisionRefs ?? [])],
          allowedFragments: [],
          expiredClaimRefs: [],
          revokedClaimRefs: [],
          grantedAt: this.#now(),
          expiresAt: null,
          failureReason,
        };
        return GroundedEvidenceAuthorizationV4Schema.parse({
          ...base,
          authorizationHash: hash({ ...base, grantedAt: null }),
        });
      };
      if (!this.#authorizationResolver) {
        evidenceAuthorization = unavailableAuthorization(
          "未注入 GroundedEvidenceAuthorizationResolverV4",
        );
        retrieval = unavailableResult(
          evidenceAuthorization.failureReason ?? "授权解析器不可用",
          evidenceAuthorization.authorizationHash,
          "forbidden",
        );
      } else if (!this.#retrieval) {
        retrieval = unavailableResult("未注入 GroundedRetrievalPortV4");
      } else {
        try {
          evidenceAuthorization = GroundedEvidenceAuthorizationV4Schema.parse(
            await this.#authorizationResolver.authorize(authorizationInput),
          );
          if (evidenceAuthorization.status !== "authorized") {
            retrieval = unavailableResult(
              evidenceAuthorization.failureReason ?? "当前授权没有可用片段",
              evidenceAuthorization.authorizationHash,
              "forbidden",
              evidenceAuthorization.expiredClaimRefs,
              evidenceAuthorization.revokedClaimRefs,
            );
          } else {
            const query = retrievalQueryFor(
              input,
              this.#content,
              recipe.moves[0]!.moveKind,
              this.#now(),
            );
            const result = GroundedRetrievalResultV4Schema.parse(
              await this.#retrieval.retrieve({
                authorization: evidenceAuthorization,
                query,
              }),
            );
            assertRetrievalAuthorized(result, evidenceAuthorization);
            if (result.authorizationHash !== evidenceAuthorization.authorizationHash) {
              retrieval = unavailableResult(
                "检索结果没有绑定可信授权范围",
                evidenceAuthorization.authorizationHash,
              );
            } else {
              retrieval = result;
            }
          }
        } catch {
          if (!evidenceAuthorization) {
            evidenceAuthorization = unavailableAuthorization("授权解析器未返回合法结果");
          }
          retrieval = unavailableResult(
            "检索端口未返回符合合同的结果",
            evidenceAuthorization.authorizationHash,
          );
        }
      }
    }
    let activePlan = retrieval?.status === "ok" && retrieval.citations.length > 0
      ? dynamicPlanFor({ recipe, retrieval })
      : undefined;
    let dispatchDecisions = recomputeGroundedDispatchV4({
      topology: this.#topology,
      episodeTemplateRef: input.episodeTemplateRef,
      policy,
      maximumSelectedAgents,
      ...(activePlan ? { plan: activePlan } : {}),
    });
    const request: GroundedCollaborationRequestSnapshotV4 = {
      requestHash: hash({
        sessionId: input.sessionId,
        studentBindingHash: hash({
          sessionId: input.sessionId,
          bindingId: input.studentBindingId,
        }),
        flagshipContentRef: parsedContentRef,
        episodeTemplateRef: input.episodeTemplateRef,
        sourceWorldStateVersion: input.sourceWorldStateVersion,
        triggerEventRef: input.triggerEventRef,
        affectedObjectRefs: input.affectedObjectRefs,
        claimRefs: input.claimRefs,
        evidence: input.evidence,
        riskLevel: recipe.riskLevel,
        policy,
        maximumSelectedAgents,
        executionBudgetMicros,
        ...(retrieval ? {
          retrievalFingerprint: {
            queryHash: retrieval.queryHash,
            resultHash: retrieval.resultHash,
            authorizationHash: retrieval.authorizationHash,
          },
        } : {}),
        ...(evidenceAuthorization
          ? { evidenceAuthorizationHash: evidenceAuthorization.authorizationHash }
          : {}),
      }),
      studentBindingHash: hash({
        sessionId: input.sessionId,
        bindingId: input.studentBindingId,
      }),
      episodeTemplateRef: input.episodeTemplateRef,
      sourceWorldStateVersion: input.sourceWorldStateVersion,
      triggerEventRef: input.triggerEventRef,
      affectedObjectRefs: [...input.affectedObjectRefs],
      claimRefs: [...input.claimRefs],
      evidence: structuredClone(input.evidence),
      riskLevel: recipe.riskLevel,
      policy,
      maximumSelectedAgents,
      executionBudgetMicros,
      ...(retrieval ? { retrieval } : {}),
      ...(evidenceAuthorization ? { evidenceAuthorization } : {}),
    };
    const existing = await this.#store.load(input.episodeId);
    if (existing) {
      this.#assertRecordContent(existing);
      if (refresh?.refreshFrom) {
        if (existing.request.requestHash !== request.requestHash) {
          assertRuntime(retrieval !== undefined, "补证恢复缺少检索快照");
          activePlan = retrieval.status === "ok" && retrieval.citations.length > 0
            ? mergePlanWithExistingMoves(activePlan!, existing)
            : refreshPlanForUnavailableEvidence({ recipe, record: existing, retrieval });
          dispatchDecisions = recomputeGroundedDispatchV4({
            topology: this.#topology,
            episodeTemplateRef: input.episodeTemplateRef,
            policy,
            maximumSelectedAgents,
            plan: activePlan,
          });
          const refreshRecord = {
            refreshId: stableId("grounded-refresh", {
              episodeId: input.episodeId,
              previousRequestHash: existing.request.requestHash,
              nextRequestHash: request.requestHash,
            }),
            previousRequestHash: existing.request.requestHash,
            previousRetrieval: existing.request.retrieval ?? null,
            previousAuthorization: existing.request.evidenceAuthorization ?? null,
            previousPlan: existing.plan ?? null,
            addedEvidenceRefs: [...refresh.addedEvidenceRefs],
            refreshedAt: this.#now(),
          };
          await this.#mutate(input.episodeId, (latest) => {
            latest.request = request;
            latest.dispatchDecisions = dispatchDecisions;
            latest.refreshHistory = [...(latest.refreshHistory ?? []), refreshRecord];
            if (activePlan) latest.plan = activePlan;
            if (latest.status === "joint_proposal_ready") {
              latest.status = "in_progress";
              latest.jointProposal = null;
              latest.failure = null;
              latest.studentDecision = null;
            }
            return latest;
          });
          if (retrieval.status !== "ok") {
            return this.getRecord(input.episodeId);
          }
        } else if (activePlan) {
          activePlan = mergePlanWithExistingMoves(activePlan, existing);
        }
      } else {
        assertRuntime(
          existing.request.requestHash === request.requestHash,
          "同一 Episode ID 被用于不同请求",
        );
      }
    } else {
      const currentWorldStateVersion = await this.#getCurrentWorldStateVersion(
        input.sessionId,
      );
      const groundingError = groundingFailure(this.#content, template, input);
      const initialFailure = currentWorldStateVersion !== input.sourceWorldStateVersion
        ? failure(
            "version_hash_drift",
            "世界版本已经变化，本轮协作没有读取旧状态或形成建议。",
          )
        : groundingError
          ? failure(
              "knowledge_not_grounded",
              `知识或运行证据不足：${groundingError}。`,
            )
          : null;
      const now = this.#now();
      const record = validateGroundedCollaborationRecordV4({
        recordVersion: GroundedCollaborationRecordV4Version,
        recordRevision: 0,
        episodeId: input.episodeId,
        sessionId: input.sessionId,
        flagshipContentRef: parsedContentRef,
        request,
        ...(activePlan ? { plan: activePlan } : {}),
        dispatchDecisions,
        tasks: [],
        observations: [],
        runs: [],
        intents: [],
        moves: [],
        jointProposal: null,
        status: initialFailure ? "failed" : "in_progress",
        failure: initialFailure,
        studentDecision: null,
        worldConsequence: null,
        createdAt: now,
        updatedAt: now,
      });
      try {
        await this.#store.create(record);
      } catch (error) {
        if (!(error instanceof GroundedCollaborationStoreConflictError)) throw error;
        const raced = await this.getRecord(input.episodeId);
        assertRuntime(
          raced.request.requestHash === request.requestHash,
          "并发 Episode 请求不一致",
        );
      }
    }

    // Missing, expired or unavailable sources pause this same episode. No citation or move is fabricated.
    if (retrieval && retrieval.status !== "ok") return this.getRecord(input.episodeId);
    const plannedMoveCount = activePlan?.steps.length ?? recipe.moves.length;
    for (let moveIndex = 0; moveIndex < plannedMoveCount; moveIndex += 1) {
      let record = await this.getRecord(input.episodeId);
      if (record.status !== "in_progress") return record;
      if (record.moves.length > moveIndex) continue;
      const plannedStep = activePlan?.steps[moveIndex];
      const previousStep = moveIndex > 0 ? activePlan?.steps[moveIndex - 1] : undefined;
      if (previousStep?.stopCondition === "request_evidence"
        || previousStep?.stopCondition === "stop") {
        return record;
      }
      const currentWorldStateVersion = await this.#getCurrentWorldStateVersion(
        record.sessionId,
      );
      if (currentWorldStateVersion !== record.request.sourceWorldStateVersion) {
        return this.#failRecord(
          record.episodeId,
          failure(
            "version_hash_drift",
            "协作运行期间世界版本发生变化，未完成动作和联合建议均已关闭。",
            stableId("move", { episodeId: record.episodeId, moveIndex }),
          ),
        );
      }
      const moveRecipe = activePlan?.steps[moveIndex] ?? recipe.moves[moveIndex]!;
      const selected = record.dispatchDecisions.some((decision) => (
        decision.agentTemplateRef === moveRecipe.agentTemplateRef
          && decision.decision === "selected"
      ));
      if (!selected) {
        return this.#failRecord(
          record.episodeId,
          failure(
            "move_sequence_incomplete",
            "当前对照策略缺少完成下一专业动作所需的智能体，协作链按规则失败关闭。",
            stableId("move", { episodeId: record.episodeId, moveIndex }),
          ),
        );
      }
      let executed: ExecutedMoveV4;
      try {
        executed = await this.#executeMove(record, moveRecipe, moveIndex);
      } catch {
        return this.#failRecord(
          record.episodeId,
          failure(
            "agent_execution_failed",
            "智能体执行未形成合法、可接地的结构化动作，本轮保持零世界写回。",
            stableId("move", { episodeId: record.episodeId, moveIndex }),
          ),
        );
      }
      record = await this.#mutate(record.episodeId, (latest) => {
        if (latest.status !== "in_progress" || latest.moves.length > moveIndex) {
          return latest;
        }
        assertRuntime(latest.moves.length === moveIndex, "协作动作出现非连续写入");
        latest.tasks.push(executed.task);
        latest.observations.push(executed.observation);
        latest.runs.push(executed.run);
        latest.intents.push(executed.intent);
        latest.moves.push(executed.move);
        return latest;
      });
      if (record.status !== "in_progress") return record;
      if (plannedStep?.stopCondition === "request_evidence"
        || plannedStep?.stopCondition === "stop") {
        return record;
      }
    }
    return this.#finalize(input.episodeId, recipe);
  }

  async #executeMove(
    record: GroundedCollaborationRecordV4,
    recipe: MoveRecipeV4,
    moveIndex: number,
  ): Promise<ExecutedMoveV4> {
    const template = this.#topology.find((candidate) => (
      candidate.agentTemplateId === recipe.agentTemplateRef
    ));
    assertRuntime(template !== undefined, "执行智能体不在拓扑中");
    const moveId = stableId("move", { episodeId: record.episodeId, moveIndex });
    const agentTaskRef = stableId("agent-task", moveId);
    const observationRef = stableId("observation", agentTaskRef);
    const agentRunRef = stableId("agent-run", agentTaskRef);
    const intentRef = stableId("intent", agentTaskRef);
    const predecessorMoveRefs = record.moves.map((move) => move.moveId);
    const evidenceRefs = record.request.evidence.map((item) => item.evidenceRef);
    const allowedCitations = record.request.retrieval?.status === "ok"
      ? citationsFromRetrieval(record.request.retrieval)
      : citationsForClaims(
          this.#content,
          record.request.claimRefs,
        );
    const allowedKnowledgeRefs = allowedCitations.map((citation) => (
      citation.knowledgeRef
    ));
    const observation: GroundedAgentObservationRecordV4 = {
      observationRef,
      agentTaskRef,
      sourceWorldStateVersion: record.request.sourceWorldStateVersion,
      affectedObjectRefs: [...record.request.affectedObjectRefs],
      groundedClaimRefs: [...record.request.claimRefs],
      knowledgeRefs: allowedKnowledgeRefs,
      evidenceRefs,
      predecessorMoveRefs,
      inputHash: hash({
        sourceWorldStateVersion: record.request.sourceWorldStateVersion,
        affectedObjectRefs: record.request.affectedObjectRefs,
        groundedClaimRefs: record.request.claimRefs,
        knowledgeRefs: allowedKnowledgeRefs,
        evidence: record.request.evidence,
        retrieval: record.request.retrieval ?? null,
        predecessorMoveRefs,
      }),
      ...(record.request.evidenceAuthorization
        ? { authorizationHash: record.request.evidenceAuthorization.authorizationHash }
        : {}),
      ...(record.request.retrieval
        ? { retrievalResultHash: record.request.retrieval.resultHash }
        : {}),
    };
    const startedAt = this.#now();
    const spent = record.runs.reduce(
      (sum, run) => sum + run.estimatedCostMicros,
      0,
    );
    const remainingBudgetMicros = Math.max(
      0,
      record.request.executionBudgetMicros - spent,
    );
    let safeSummary = recipe.safeSummary;
    let rationale = recipe.rationale;
    let executionMode: GroundedAgentRunRecordV4["executionMode"] =
      "deterministic_demo";
    let providerId: string | null = null;
    let modelId: string | null = null;
    let traceRef = stableId("trace", agentRunRef);
    let latencyMs = 0;
    let estimatedCostMicros = 0;
    let fallbackReason: GroundedAgentRunRecordV4["fallbackReason"] =
      this.#model
        ? remainingBudgetMicros > 0
          ? null
          : "budget_exhausted"
        : "model_unavailable";
    if (this.#model && remainingBudgetMicros > 0) {
      try {
        const modelInput: GroundedCollaborationModelInputV4 = {
          runtimeVersion: XunpuGroundedCollaborationRuntimeV4Version,
          episodeTemplateRef: record.request.episodeTemplateRef,
          moveKind: recipe.moveKind,
          expectedPosition: recipe.position,
          professionalRoleId: template.professionalRoleId,
          affectedObjectRefs: record.request.affectedObjectRefs,
          allowedClaims: record.request.claimRefs.map((claimRef) => {
            const claim = this.#content.claims.find((candidate) => (
              candidate.claimRef === claimRef
            ))!;
            return {
              claimRef,
              allowedWording: claim.allowedWording,
              prohibitedExpansion: claim.prohibitedExpansion,
            };
          }),
          allowedKnowledge: allowedCitations.map((citation) => {
            const knowledge = this.#content.knowledge.find((candidate) => (
              candidate.knowledgeRef === citation.knowledgeRef
            ));
            return {
              knowledgeRef: citation.knowledgeRef,
              sourceTitle: citation.sourceTitle,
              fragmentRef: citation.knowledgeRef,
              fragmentHash: citation.fragmentHash ?? citation.sourceContentHash,
              locator: citation.locator,
              teachingSummary: citation.snippet ?? knowledge?.teachingSummary ?? citation.locator,
              stance: citation.stance,
              reviewStatus: citation.reviewStatus,
              ...(citation.sourceRevision ? { sourceRevision: citation.sourceRevision } : {}),
              ...(citation.sourceDocumentRef ? { sourceDocumentRef: citation.sourceDocumentRef } : {}),
              ...(citation.fragmentRef ? { fragmentRef: citation.fragmentRef } : {}),
              ...(citation.snippet ? { snippet: citation.snippet } : {}),
              ...(citation.expiresAt === undefined ? {} : { expiresAt: citation.expiresAt }),
              ...(citation.revokedAt === undefined ? {} : { revokedAt: citation.revokedAt }),
            };
          }),
          evidenceRefs,
          predecessorSafeSummaries: record.moves.map((move) => move.safeSummary),
          approvedSafeSummary: recipe.safeSummary,
          approvedRationale: recipe.rationale,
          remainingBudgetMicros,
        };
        const modelRun = await this.#model.run(modelInput);
        const candidate = ModelCandidateSchema.parse(modelRun.output);
        const grounded = groundedCandidateIsSupported({
          candidate,
          modelInput,
          expectedClaimRefs: record.request.claimRefs,
          expectedKnowledgeRefs: allowedKnowledgeRefs,
          expectedEvidenceRefs: evidenceRefs,
        })
          && modelRun.estimatedCostMicros >= 0
          && modelRun.estimatedCostMicros <= remainingBudgetMicros
          && Number.isInteger(modelRun.estimatedCostMicros)
          && Number.isInteger(modelRun.latencyMs)
          && modelRun.latencyMs >= 0
          && idPattern.test(modelRun.traceRef)
          && modelRun.providerId.trim().length > 0
          && modelRun.modelId.trim().length > 0;
        if (grounded) {
          safeSummary = candidate.safeSummary;
          rationale = candidate.rationale;
          executionMode = "live";
          providerId = modelRun.providerId;
          modelId = modelRun.modelId;
          traceRef = modelRun.traceRef;
          latencyMs = modelRun.latencyMs;
          estimatedCostMicros = modelRun.estimatedCostMicros;
          fallbackReason = null;
        } else {
          fallbackReason = "model_ungrounded";
        }
      } catch (error) {
        fallbackReason = error instanceof z.ZodError
          ? "model_invalid"
          : "model_failed";
      }
    }
    const completedAt = this.#now();
    const outputHash = hash({
      moveId,
      moveKind: recipe.moveKind,
      agentTemplateRef: recipe.agentTemplateRef,
      professionalRoleId: template.professionalRoleId,
      safeSummary,
      rationale,
      groundedClaimRefs: record.request.claimRefs,
      knowledgeRefs: allowedKnowledgeRefs,
      evidenceRefs,
      predecessorMoveRefs,
      position: recipe.position,
    });
    const promptTemplateRef = `prompt-template-grounded-${recipe.moveKind}-v4`;
    const run: GroundedAgentRunRecordV4 = {
      agentRunRef,
      agentTaskRef,
      observationRef,
      intentRef,
      status: executionMode === "live"
        || fallbackReason === "model_unavailable"
        || fallbackReason === "budget_exhausted"
        ? "completed"
        : "degraded",
      executionMode,
      providerId,
      modelId,
      promptTemplateRef,
      traceRef,
      latencyMs,
      estimatedCostMicros,
      fallbackReason,
      outputHash,
      startedAt,
      completedAt,
    };
    const task: GroundedAgentTaskRecordV4 = {
      agentTaskRef,
      episodeId: record.episodeId,
      moveIndex,
      moveKind: recipe.moveKind,
      agentTemplateRef: recipe.agentTemplateRef,
      professionalRoleId: template.professionalRoleId,
      status: "completed",
      idempotencyKey: hash({
        episodeId: record.episodeId,
        requestHash: record.request.requestHash,
        moveIndex,
      }),
      observationRef,
      createdAt: startedAt,
      completedAt,
    };
    const intent: GroundedAgentIntentRecordV4 = {
      intentRef,
      agentTaskRef,
      observationRef,
      moveId,
      position: recipe.position,
      groundedClaimRefs: [...record.request.claimRefs],
      knowledgeRefs: allowedKnowledgeRefs,
      evidenceRefs,
      predecessorMoveRefs,
      outputHash,
      authority: "proposal_only",
    };
    const move = AdminGroundedBusinessMoveV4Schema.parse({
      moveId,
      moveKind: recipe.moveKind,
      agentTemplateRef: recipe.agentTemplateRef,
      professionalRoleId: template.professionalRoleId,
      safeSummary,
      rationale,
      groundedClaimRefs: record.request.claimRefs,
      knowledgeCitations: allowedCitations,
      evidenceRefs,
      predecessorMoveRefs,
      outputHash,
      execution: {
        agentTaskRef,
        agentRunRef,
        observationRef,
        intentRef,
        executionMode,
        providerId,
        modelId,
        promptTemplateRef,
        traceRef,
        latencyMs,
        estimatedCostMicros,
      },
    });
    return { task, observation, run, intent, move };
  }

  async #finalize(
    episodeId: string,
    recipe: EpisodeRecipeV4,
  ): Promise<GroundedCollaborationRecordV4> {
    return this.#mutate(episodeId, (record) => {
      if (record.status !== "in_progress") return record;
      const plannedSteps = record.plan?.steps ?? recipe.moves;
      assertRuntime(record.moves.length === plannedSteps.length, "当前协作计划尚未完成");
      const proposalDraft = {
        jointProposalId: stableId("joint-proposal", {
          episodeId,
          requestHash: record.request.requestHash,
        }),
        sourceMoveRefs: record.moves.map((move) => move.moveId),
        publicSummary: record.plan?.publicSummary ?? recipe.publicSummary,
        recommendedActionRefs: record.plan
          ? [...record.plan.recommendedActionRefs]
          : [...recipe.recommendedActionRefs],
        groundedClaimRefs: [...record.request.claimRefs],
        evidenceRefs: record.request.evidence.map((item) => item.evidenceRef),
        riskLevel: recipe.riskLevel,
        requiresTeacherGate: recipe.requiresTeacherGate,
        authority: "proposal_only" as const,
      };
      record.jointProposal = {
        ...proposalDraft,
        contentHash: hash(proposalDraft),
      };
      record.status = "joint_proposal_ready";
      return record;
    });
  }

  async #failRecord(
    episodeId: string,
    failed: GroundedCollaborationFailureV4,
  ): Promise<GroundedCollaborationRecordV4> {
    return this.#mutate(episodeId, (record) => {
      if (record.status !== "in_progress") return record;
      record.status = "failed";
      record.failure = failed;
      record.jointProposal = null;
      return record;
    });
  }

  async #mutate(
    episodeId: string,
    mutate: (record: GroundedCollaborationRecordV4) => GroundedCollaborationRecordV4,
  ): Promise<GroundedCollaborationRecordV4> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.getRecord(episodeId);
      const draft = mutate(structuredClone(current));
      if (canonicalString(draft) === canonicalString(current)) return current;
      draft.recordRevision = current.recordRevision + 1;
      draft.updatedAt = this.#now();
      const parsed = validateGroundedCollaborationRecordV4(draft);
      this.#assertRecordContent(parsed);
      try {
        await this.#store.compareAndSet(
          episodeId,
          current.recordRevision,
          parsed,
        );
        return parsed;
      } catch (error) {
        if (!(error instanceof GroundedCollaborationStoreConflictError)
          || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("V4 知识协作 CAS 重试耗尽");
  }

  async issueStudentDecisionToken(
    episodeId: string,
    bindingId: string,
  ): Promise<string> {
    validateIdentifier(bindingId, "学生绑定 ID");
    const record = await this.getRecord(episodeId);
    assertRuntime(record.jointProposal !== null, "联合提案尚未形成");
    await this.#assertCurrentEvidenceAuthorization(record);
    assertRuntime(
      record.request.studentBindingHash === hash({
        sessionId: record.sessionId,
        bindingId,
      }),
      "学生绑定与协作 Episode 不一致",
    );
    return issueGroundedSuggestionDecisionTokenV4({
      secret: this.#decisionSecret,
      episodeId,
      sessionId: record.sessionId,
      bindingId,
      jointProposalContentHash: record.jointProposal.contentHash,
    });
  }

  async recordStudentDecision(
    input: RecordGroundedSuggestionDecisionV4Input,
  ): Promise<StudentGroundedCollaborationEpisodeV4> {
    validateIdentifier(input.bindingId, "学生绑定 ID");
    validateIdentifier(input.decisionRef, "学生决定引用");
    assertRuntime(input.rationale.trim().length > 0 && input.rationale.length <= 800, "学生决定理由非法");
    assertRuntime(Number.isFinite(Date.parse(input.decidedAt)), "学生决定时间非法");
    const record = await this.getRecord(input.episodeId);
    assertRuntime(record.jointProposal !== null, "联合提案尚未形成");
    await this.#assertCurrentEvidenceAuthorization(record);
    assertRuntime(
      record.request.studentBindingHash === hash({
        sessionId: record.sessionId,
        bindingId: input.bindingId,
      }),
      "学生绑定与协作 Episode 不一致",
    );
    const expectedToken = issueGroundedSuggestionDecisionTokenV4({
      secret: this.#decisionSecret,
      episodeId: record.episodeId,
      sessionId: record.sessionId,
      bindingId: input.bindingId,
      jointProposalContentHash: record.jointProposal.contentHash,
    });
    assertRuntime(tokensMatch(input.decisionToken, expectedToken), "学生决定令牌无效");
    const requestHash = hash({
      episodeId: input.episodeId,
      bindingId: input.bindingId,
      decisionRef: input.decisionRef,
      decision: input.decision,
      rationale: input.rationale,
      decidedAt: input.decidedAt,
    });
    const updated = await this.#mutate(input.episodeId, (latest) => {
      assertRuntime(
        ["joint_proposal_ready", "student_decided", "completed"].includes(latest.status),
        "当前 Episode 不接受学生决定",
      );
      if (latest.studentDecision) {
        assertRuntime(
          latest.studentDecision.requestHash === requestHash,
          "同一 Episode 已记录不同学生决定",
        );
        return latest;
      }
      latest.studentDecision = {
        bindingHash: hash({
          episodeId: latest.episodeId,
          bindingId: input.bindingId,
        }),
        decisionRef: input.decisionRef,
        decision: input.decision,
        rationale: input.rationale,
        rationaleSource: "student_submitted",
        decidedAt: input.decidedAt,
        requestHash,
      };
      latest.status = "student_decided";
      return latest;
    });
    return projectGroundedCollaborationForStudentV4(updated);
  }

  async #assertCurrentEvidenceAuthorization(
    record: GroundedCollaborationRecordV4,
  ): Promise<void> {
    const previous = record.request.evidenceAuthorization;
    if (!previous) return;
    assertRuntime(
      this.#authorizationResolver !== undefined,
      "当前来源授权无法重核验，请先刷新协作证据",
    );
    const current = GroundedEvidenceAuthorizationV4Schema.parse(
      await this.#authorizationResolver.authorize({
        sessionId: record.sessionId,
        courseReleaseRef: previous.courseReleaseRef,
        studentBindingHash: record.request.studentBindingHash,
        allowedObjectRefs: previous.allowedObjectRefs,
        allowedClaimRefs: previous.allowedClaimRefs,
        allowedKnowledgeRefs: previous.allowedKnowledgeRefs,
        allowedSourceRevisionRefs: previous.allowedSourceRevisionRefs,
        asOf: this.#now(),
      }),
    );
    if (current.status !== "authorized" || current.authorizationHash !== previous.authorizationHash) {
      throw new GroundedEvidenceAuthorizationChangedError();
    }
  }

  async recordWorldConsequence(
    input: RecordGroundedWorldConsequenceV4Input,
  ): Promise<StudentGroundedCollaborationEpisodeV4> {
    const { authorityToken, ...payload } = input;
    const expectedToken = issueGroundedWorldConsequenceTokenV4(
      this.#worldAuthoritySecret,
      payload,
    );
    assertRuntime(tokensMatch(authorityToken, expectedToken), "世界后果权威令牌无效");
    validateIdentifier(payload.receiptRef, "世界后果收据引用");
    validateIdentifier(payload.worldConsequenceRef, "世界后果引用");
    assertRuntime(hashPattern.test(payload.worldEventContentHash), "世界事件内容哈希非法");
    assertRuntime(Number.isFinite(Date.parse(payload.committedAt)), "世界后果提交时间非法");
    assertRuntime(
      payload.resultingWorldStateVersion === payload.sourceWorldStateVersion + 1,
      "世界后果版本必须单步前进",
    );
    const currentWorldStateVersion = await this.#getCurrentWorldStateVersion(
      (await this.getRecord(payload.episodeId)).sessionId,
    );
    assertRuntime(
      currentWorldStateVersion === payload.resultingWorldStateVersion,
      "世界后果收据与当前权威版本不一致",
    );
    const payloadHash = hash(payload);
    const updated = await this.#mutate(payload.episodeId, (record) => {
      assertRuntime(record.studentDecision !== null, "学生尚未作出真实决定");
      assertRuntime(
        payload.sourceWorldStateVersion === record.request.sourceWorldStateVersion,
        "世界后果来源版本与协作 Episode 不一致",
      );
      if (record.worldConsequence) {
        assertRuntime(record.worldConsequence.payloadHash === payloadHash, "同一 Episode 已绑定不同世界后果");
        return record;
      }
      const receipt: GroundedWorldConsequenceReceiptV4 = {
        receiptRef: payload.receiptRef,
        sourceWorldStateVersion: payload.sourceWorldStateVersion,
        resultingWorldStateVersion: payload.resultingWorldStateVersion,
        worldConsequenceRef: payload.worldConsequenceRef,
        worldEventContentHash: payload.worldEventContentHash,
        committedAt: payload.committedAt,
        payloadHash,
      };
      record.worldConsequence = receipt;
      record.status = "completed";
      return record;
    });
    return projectGroundedCollaborationForStudentV4(updated);
  }

  async getStudentEpisode(
    episodeId: string,
  ): Promise<StudentGroundedCollaborationEpisodeV4> {
    return projectGroundedCollaborationForStudentV4(
      await this.getRecord(episodeId),
    );
  }

  async getTeacherEpisode(
    episodeId: string,
  ): Promise<TeacherGroundedCollaborationEpisodeV4> {
    return projectGroundedCollaborationForTeacherV4(
      await this.getRecord(episodeId),
    );
  }

  async getAdminEpisode(
    episodeId: string,
  ): Promise<AdminGroundedCollaborationEpisodeV4> {
    return projectGroundedCollaborationForAdminV4(
      await this.getRecord(episodeId),
    );
  }

  #assertRecordContent(record: GroundedCollaborationRecordV4): void {
    assertRuntime(
      canonicalString(record.flagshipContentRef)
        === canonicalString(this.#flagshipContentRef),
      "记录旗舰内容引用漂移",
    );
    const recomputed = recomputeGroundedDispatchV4({
      topology: this.#topology,
      episodeTemplateRef: record.request.episodeTemplateRef,
      policy: record.request.policy,
      maximumSelectedAgents: record.request.maximumSelectedAgents,
      ...(record.plan ? { plan: record.plan } : {}),
    });
    assertRuntime(
      canonicalString(recomputed) === canonicalString(record.dispatchDecisions),
      "记录调度决定不可复算",
    );
    const currentAuthorization = record.request.evidenceAuthorization;
    const historicalAuthorizations = (record.refreshHistory ?? [])
      .map((refresh) => refresh.previousAuthorization)
      .filter((authorization): authorization is GroundedEvidenceAuthorizationV4 => (
        authorization !== null
      ));
    for (const [index, move] of record.moves.entries()) {
      const observation = record.observations[index];
      const allowedKnowledge = new Set(observation?.knowledgeRefs ?? []);
      assertRuntime(
        move.knowledgeCitations.every((citation) => (
          allowedKnowledge.has(citation.knowledgeRef)
        )),
        "记录动作使用了其生成快照之外的知识",
      );
      if (observation?.authorizationHash) {
        const authorization = [currentAuthorization, ...historicalAuthorizations]
          .find((candidate) => candidate?.authorizationHash === observation.authorizationHash);
        assertRuntime(authorization !== undefined, "记录动作缺少其生成时的授权快照");
        assertMoveCitationsAuthorized(move.knowledgeCitations, authorization);
      }
    }
  }
}

export function observeGroundedCollaborationAblationV4(
  record: GroundedCollaborationRecordV4,
): GroundedCollaborationAblationObservationV4 {
  const citations = unique(record.moves.flatMap((move) => (
    move.knowledgeCitations.map((citation) => citation.knowledgeRef)
  )));
  const evidenceRefs = new Set(record.request.evidence.map((item) => item.evidenceRef));
  const usedEvidenceRefs = new Set(record.moves.flatMap((move) => move.evidenceRefs));
  return {
    policy: record.request.policy,
    requestHash: hash({
      sessionId: record.sessionId,
      flagshipContentRef: record.flagshipContentRef,
      episodeTemplateRef: record.request.episodeTemplateRef,
      sourceWorldStateVersion: record.request.sourceWorldStateVersion,
      triggerEventRef: record.request.triggerEventRef,
      affectedObjectRefs: record.request.affectedObjectRefs,
      claimRefs: record.request.claimRefs,
      evidence: record.request.evidence,
      riskLevel: record.request.riskLevel,
    }),
    maximumSelectedAgents: record.request.maximumSelectedAgents,
    executionBudgetMicros: record.request.executionBudgetMicros,
    status: record.status === "failed" ? "failed" : "joint_proposal_ready",
    selectedCount: record.dispatchDecisions.filter((decision) => (
      decision.decision === "selected"
    )).length,
    moveCount: record.moves.length,
    knowledgeCitationCount: citations.length,
    evidenceCoverage: evidenceRefs.size === 0
      ? 0
      : [...evidenceRefs].filter((reference) => usedEvidenceRefs.has(reference)).length
        / evidenceRefs.size,
    unauthorizedWorldWriteCount: 0,
    totalLatencyMs: record.runs.reduce((sum, run) => sum + run.latencyMs, 0),
    totalEstimatedCostMicros: record.runs.reduce(
      (sum, run) => sum + run.estimatedCostMicros,
      0,
    ),
    failureReasonCode: record.failure?.reasonCode ?? null,
  };
}

import { createHash, createHmac } from "node:crypto";
import {
  FlagshipContentReferenceV4Schema,
  SemanticActionDecisionV4Schema,
  SemanticActionDecisionV4SchemaVersion,
  SemanticActionRequestV4Schema,
  type FlagshipContentReferenceV4,
  type SemanticActionDecisionV4,
  type SemanticActionRequestV4,
  type SemanticActionVerbV4,
} from "@ronggang/contracts";
import {
  hasAffirmedNaturalLanguageMatchV4,
  hasNaturalLanguageIntentMatchV4,
} from "@ronggang/world-core";
import { z } from "zod";

export const XunpuSemanticActionRuntimeV4Version =
  "xunpu-semantic-action-runtime/4.0.0" as const;

export const XunpuSemanticIntentV4Schema = z.enum([
  "observe",
  "ask",
  "probe",
  "inspect",
  "compare",
  "cite",
  "negotiate",
  "record",
  "import_media",
  "transcribe",
  "annotate",
  "replace",
  "draft",
  "save_revision",
  "request_advice",
  "request_evidence",
  "accept_advice",
  "reject_advice",
  "wait",
  "escalate",
  "submit_gate",
  "publish",
  "correct",
  "request_pause",
]);
export type XunpuSemanticIntentV4 = z.infer<
  typeof XunpuSemanticIntentV4Schema
>;

export type XunpuSemanticOutcomeV4 =
  | "accepted"
  | "clarification_required"
  | "refused";

export interface XunpuSemanticSampleRuntimeV4 {
  sampleId: string;
  worldStateRef: string;
  utterance: string;
  expectedIntent: XunpuSemanticIntentV4 | null;
  expectedOutcome: XunpuSemanticOutcomeV4;
  expectedTargetRefs: string[];
  riskRefs: string[];
  allowedRuleRefs: string[];
  rationale: string;
  blindSplit: "train" | "validation" | "test";
}

export interface SemanticActionSelectionV4 {
  selectionToken: string;
  displayKind: "world_object" | "npc" | "material" | "artifact";
  objectType: "entity" | "location" | "material" | "artifact" | "source";
  objectId: string;
  label: string;
  consequenceHint: string;
  selectionRole: "target" | "material";
  allowedIntents: XunpuSemanticIntentV4[];
}

export interface SemanticActionWindowV4 {
  sessionId: string;
  bindingId: string;
  actionWindowRef: string;
  actionWindowHash: string;
  worldStateVersion: number;
  worldStateRef: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  availableSelections: SemanticActionSelectionV4[];
  implicitTargetSelections: SemanticActionSelectionV4[];
  allowedIntents: XunpuSemanticIntentV4[];
  expiresAt: string;
}

export interface IssueSemanticActionSelectionV4Input {
  secret: string;
  sessionId: string;
  bindingId: string;
  actionWindowRef: string;
  worldStateVersion: number;
  displayKind: SemanticActionSelectionV4["displayKind"];
  objectType: SemanticActionSelectionV4["objectType"];
  objectId: string;
  label: string;
  consequenceHint: string;
  selectionRole: SemanticActionSelectionV4["selectionRole"];
  allowedIntents: XunpuSemanticIntentV4[];
}

export interface SemanticActionModelInputV4 {
  runtimeVersion: typeof XunpuSemanticActionRuntimeV4Version;
  worldStateRef: string;
  utterance: string;
  selectedObjects: Array<{
    objectId: string;
    objectType: SemanticActionSelectionV4["objectType"];
    label: string;
    selectionRole: SemanticActionSelectionV4["selectionRole"];
    allowedIntents: XunpuSemanticIntentV4[];
  }>;
  allowedIntents: XunpuSemanticIntentV4[];
}

export interface SemanticActionParserModelV4 {
  parse(input: Readonly<SemanticActionModelInputV4>): Promise<unknown>;
}

export interface DeterministicSemanticClassificationV4 {
  outcome: XunpuSemanticOutcomeV4;
  intent: XunpuSemanticIntentV4 | null;
  confidence: number;
  rationale: string;
  riskRefs: string[];
  matchedSampleRefs: string[];
  ambiguityCode:
    | "missing_target"
    | "multiple_targets"
    | "missing_material"
    | "unclear_intent"
    | "state_dependent_choice"
    | null;
  refusalReasonCode:
    | "unsafe_or_illegal"
    | "forged_authority"
    | "privacy_boundary"
    | "outside_role_scope"
    | "stale_action_window"
    | "unauthorized_reference"
    | "unsupported_operation"
    | null;
}

export interface SemanticActionRuntimeDiagnosticsV4 {
  runtimeVersion: typeof XunpuSemanticActionRuntimeV4Version;
  parserMode: "live_model" | "deterministic_fallback";
  internalIntent: XunpuSemanticIntentV4 | null;
  matchedSampleRefs: string[];
  riskRefs: string[];
  fallbackReason: "model_unavailable" | "model_failed" | "model_invalid" | null;
  trainingSampleCount: number;
  blindSamplesConsumed: 0;
}

export interface SemanticActionRuntimeResultV4 {
  decision: SemanticActionDecisionV4;
  /** Server-side receipt. Never project this object to student or teacher clients. */
  diagnostics: SemanticActionRuntimeDiagnosticsV4;
}

export interface SemanticActionServiceV4Options {
  selectionSecret: string;
  samples: readonly XunpuSemanticSampleRuntimeV4[];
  model?: SemanticActionParserModelV4;
  now?: () => Date;
}

const ModelCandidateSchema = z.object({
  outcome: z.enum(["accepted", "clarification_required", "refused"]),
  intent: XunpuSemanticIntentV4Schema.nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(800),
  targetObjectIds: z.array(z.string().trim().min(1)).max(8),
  materialObjectIds: z.array(z.string().trim().min(1)).max(8),
  riskRefs: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/u)).max(12),
  ambiguityCode: z.enum([
    "missing_target",
    "multiple_targets",
    "missing_material",
    "unclear_intent",
    "state_dependent_choice",
  ]).nullable(),
  refusalReasonCode: z.enum([
    "unsafe_or_illegal",
    "forged_authority",
    "privacy_boundary",
    "outside_role_scope",
    "unauthorized_reference",
    "unsupported_operation",
  ]).nullable(),
}).strict();

type ModelCandidate = z.infer<typeof ModelCandidateSchema>;

interface SafetyPolicy {
  pattern: RegExp;
  riskRefs: string[];
  reasonCode: NonNullable<DeterministicSemanticClassificationV4["refusalReasonCode"]>;
  safeMessage: string;
  recoveryHint: string | null;
}

const safetyPolicies: SafetyPolicy[] = [
  {
    pattern: /(?:假装|冒充|伪装(?:成|为)?|装(?:作|成)?).{0,12}(?:游客|居民)|(?:偷拍|偷录|闯入|混进去).{0,16}(?:别|不).{0,8}(?:记录|留痕)|(?:直接|继续|仍然|照常|准备|打算|将要|会|要|就)?(?:偷拍|偷录|闯入|混进去)(?:.{0,12}(?:居民|私人空间|门内|住处|素材|拍摄))?/u,
    riskRefs: ["privacy_breach", "deceptive_access"],
    reasonCode: "privacy_boundary",
    safeMessage: "不能通过隐瞒身份、闯入私人空间或偷拍来获取材料。",
    recoveryHint: "请说明记者身份、采访用途和公共拍摄范围，再向现场人物申请许可。",
  },
  {
    pattern: /(?:不愿|拒绝|撤回|撤销|不再同意|不同意).{0,16}(?:授权.{0,8})?(?:继续录|继续拍|继续发|照常发|继续推流)|(?:剪得|改得).{0,12}(?:像|好像).{0,8}(?:同意|答应)/u,
    riskRefs: ["consent_breach", "deceptive_editing", "consent_withdrawal_ignored"],
    reasonCode: "privacy_boundary",
    safeMessage: "人物拒绝或撤回授权后，不能继续记录、传播或通过剪辑伪造同意。",
    recoveryHint: "请停止相关素材使用，核对用途范围，并选择脱敏、替换或重新取得授权。",
  },
  {
    pattern: /(?:没说过|未说过|不存在).{0,16}(?:细节|引语|经历).{0,16}(?:刺激|默认|写入)|(?:编|虚构|捏造).{0,12}(?:故事|经历|引语|家庭)/u,
    riskRefs: ["fabricated_prompt", "interview_manipulation", "fabricated_quote", "fabricated_biography"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "不能编造人物经历、引语或用虚假细节诱导受访者默认。",
    recoveryHint: "请改为开放式追问，并只记录受访者实际表达和可核来源。",
  },
  {
    pattern: /(?:模型|AI).{0,12}(?:补|编|生成).{0,16}(?:出处|来源|定位|回执)|(?:伪造|捏造|编造).{0,16}(?:官方|部门|主任|回执|通知)|(?:官方|部门|主任).{0,12}(?:回执|通知).{0,8}(?:编|伪造|捏造|造一份)/iu,
    riskRefs: ["fabricated_source", "hallucinated_locator", "forged_authoritative_receipt"],
    reasonCode: "forged_authority",
    safeMessage: "不能伪造权威来源、定位、回执或主管部门通知。",
    recoveryHint: "请联系公开信息联络员，或将该主张保留为待核线索。",
  },
  {
    pattern: /(?:删|去掉|移除|隐藏).{0,16}(?:AI|人工智能).{0,8}(?:标识|标签|元数据)|(?:AI|人工智能).{0,8}(?:标识|标签|元数据).{0,16}(?:删掉|移除|隐藏)|(?:别让|不让).{0,8}(?:观众|用户).{0,8}(?:发现|知道).{0,8}(?:AI|生成)/iu,
    riskRefs: ["ai_label_removal"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "不能删除生成式内容的显式标识或机器可读元数据。",
    recoveryHint: "请补齐显式标签和元数据后再提交平台预检。",
  },
  {
    pattern: /(?:答应|同意|接受|保证).{0,20}(?:(?:标题|正文|版面).{0,8}(?:植入|突出商家)|(?:换|交换).{0,8}(?:素材|曝光))|(?:标题|正文|版面).{0,8}(?:植入|突出商家).{0,16}(?:不要|不).{0,8}(?:写进|记录).{0,8}(?:台账|披露)/u,
    riskRefs: ["undisclosed_commercial_exchange"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "不能隐瞒以曝光换素材的商业交换或让利益方控制标题与正文。",
    recoveryHint: "请拒绝编辑条件；如保留商户素材，必须披露来源并独立判断。",
  },
  {
    pattern: /(?:不签|不同意).{0,10}(?:不能|不让).{0,12}(?:参加|进入|体验)|(?:逼|强迫|威胁).{0,10}(?:同意|签|公开)/u,
    riskRefs: ["coerced_consent"],
    reasonCode: "privacy_boundary",
    safeMessage: "不能通过服务、活动资格或其他压力强迫人物同意公开。",
    recoveryHint: "请提供拒绝、匿名、局部公开或退出等真实可选项。",
  },
  {
    pattern: /(?:不经过|绕过|跳过).{0,12}(?:教师门|教师审核|发布门)|(?:直接|立即).{0,8}(?:全平台|公开发布).{0,8}(?:不审核|不核验)?/u,
    riskRefs: ["teacher_gate_bypass"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "高风险作品不能绕过教师发布门直接公开。",
    recoveryHint: "请提交明确作品版本及事实、权利和未知项证据，进入教师门。",
  },
  {
    pattern: /(?:覆盖|删掉).{0,10}(?:旧版|原版本)|(?:别|不).{0,8}(?:看到|保留).{0,8}(?:改过|修订|记录)/u,
    riskRefs: ["silent_edit"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "不能静默覆盖旧版或隐藏公开更正记录。",
    recoveryHint: "请保留旧版本，创建新修订并公开说明差异与依据。",
  },
  {
    pattern: /(?:删掉|屏蔽|压下).{0,12}(?:投诉|质疑).{0,16}(?:照常|继续).{0,8}(?:推流|发布|传播)/u,
    riskRefs: ["complaint_suppression", "consent_withdrawal_ignored"],
    reasonCode: "privacy_boundary",
    safeMessage: "不能压制权利投诉后继续传播相关素材。",
    recoveryHint: "请暂停相关版本，核验投诉依据并形成可追溯的处理与更正。",
  },
  {
    pattern: /(?:另一个|其他).{0,8}(?:学生|同学).{0,12}(?:采访|作品|记录|数据)|(?:跨学生|别人的).{0,10}(?:证据|记录)/u,
    riskRefs: ["cross_student_data"],
    reasonCode: "unauthorized_reference",
    safeMessage: "不能读取其他学生的私有采访记录、作品或学习证据。",
    recoveryHint: "请使用本会话已授权的公开来源和自己的证据。",
  },
  {
    pattern: /(?:没告诉我|未公开|私下).{0,10}(?:压力|记忆|计划|秘密)|(?:NPC|人物).{0,8}(?:私有记忆|内部状态)/iu,
    riskRefs: ["private_memory_leak"],
    reasonCode: "outside_role_scope",
    safeMessage: "不能向学生暴露人物智能体的私有记忆、压力或未公开计划。",
    recoveryHint: "请通过现场提问、观察和公开证据理解人物立场。",
  },
  {
    pattern: /(?:系统|模型).{0,8}(?:Prompt|提示词|Trace|追踪|私有上下文)|(?:完整|原始).{0,8}(?:Prompt|Trace|技术日志)/iu,
    riskRefs: ["technical_trace_leak"],
    reasonCode: "outside_role_scope",
    safeMessage: "学生无权读取系统 Prompt、原始 Trace 或私有执行上下文。",
    recoveryHint: "你可以请求当前建议的公开依据、反证和业务理由。",
  },
  {
    pattern: /(?:管理员|教师).{0,8}(?:身份|权限).{0,10}(?:切给|给我|提升)|(?:给我|切给我).{0,8}(?:管理员|教师).{0,8}(?:身份|权限)|(?:自己|直接).{0,8}(?:改|写).{0,8}(?:世界变量|权威状态|可信度)/u,
    riskRefs: ["role_escalation", "world_write_bypass"],
    reasonCode: "outside_role_scope",
    safeMessage: "不能提升浏览器角色或直接修改权威世界变量。",
    recoveryHint: "请以学生记者行动提交候选，由世界规则与教师门结算后果。",
  },
  {
    pattern: /(?:跳过|忽略).{0,8}(?:授权|同意).{0,8}(?:和|、).{0,8}(?:核验|查证).{0,16}(?:公开|发布)|(?:所有素材).{0,8}(?:立即|马上).{0,8}(?:公开|发布)/u,
    riskRefs: ["teacher_gate_bypass", "rights_breach", "unverified_publication"],
    reasonCode: "unsafe_or_illegal",
    safeMessage: "不能跳过权利确认和事实核验后批量公开素材。",
    recoveryHint: "请逐项核对来源、权利、未知项与教师门，再选择发布或暂缓。",
  },
];

interface IntentRule {
  intent: XunpuSemanticIntentV4;
  patterns: Array<{ pattern: RegExp; weight: number }>;
}

const intentRules: IntentRule[] = [
  { intent: "request_pause", patterns: [
    { pattern: /(?:暂停|停一下|先停).{0,8}(?:世界|时钟|现场|推进)/u, weight: 8 },
  ] },
  { intent: "correct", patterns: [
    { pattern: /(?:公开更正|更正说明|修正错误|年份错误|投诉成立|下架).{0,20}(?:旧版|新版|重建|链接|通知)?/u, weight: 7 },
    { pattern: /(?:错误|投诉).{0,14}(?:R1|R2|版本|发布)/iu, weight: 4 },
    { pattern: /(?:旧版|原版本).{0,12}(?:覆盖|隐藏|不保留)|(?:投诉).{0,12}(?:删掉|照常推流)/u, weight: 7 },
  ] },
  { intent: "reject_advice", patterns: [
    { pattern: /(?:拒绝|不采纳|不执行).{0,16}(?:AI|智能体|建议|标题|套餐|植入)/iu, weight: 8 },
    { pattern: /(?:不写|不放).{0,8}(?:套餐|商家|植入).{0,16}(?:但|改为|可以)/u, weight: 6 },
  ] },
  { intent: "request_evidence", patterns: [
    { pattern: /(?:展示|给出|说明|查看).{0,10}(?:依据|反证|来源).{0,16}(?:再决定|再判断|为什么)/u, weight: 8 },
    { pattern: /(?:建议).{0,10}(?:依据|证据|反证)/u, weight: 6 },
  ] },
  { intent: "submit_gate", patterns: [
    { pattern: /(?:提交|送审).{0,12}(?:R\d|版本|作品)?.{0,8}(?:教师|发布门|审核)/iu, weight: 8 },
    { pattern: /(?:暂缓|暂停).{0,8}(?:正式发布|上线).{0,12}(?:内部预览|待核)/u, weight: 6 },
    { pattern: /(?:可以|能否).{0,4}(?:发|发布|上线).{0,3}(?:吗|了)/u, weight: 4 },
    { pattern: /(?:保留|补齐|维持).{0,12}(?:(?:AI|人工智能).{0,8})?(?:标识|标签|元数据).{0,20}(?:送审|提交|审核|预检)/iu, weight: 9 },
    { pattern: /(?:送审|提交).{0,12}(?:标识|标签|元数据)/iu, weight: 7 },
  ] },
  { intent: "publish", patterns: [
    { pattern: /(?:全平台|公开|正式).{0,6}(?:发布|上线|推流)|(?:发布|上线|推流).{0,6}(?:作品|视频|图文|快讯)/u, weight: 6 },
    { pattern: /(?:保留作品|维持判断).{0,12}(?:公开|来源|理由)/u, weight: 5 },
    { pattern: /(?:删除|删掉|去掉|移除).{0,10}(?:AI|人工智能).{0,8}(?:标识|标签|元数据).{0,12}(?:发布|上线|推流)/iu, weight: 9 },
    { pattern: /(?:撤回|撤销|不同意).{0,12}(?:授权.{0,6})?(?:继续发|照常发|继续推流)|(?:不经过|绕过|跳过).{0,10}(?:教师门|授权|核验).{0,12}(?:发布|公开)/u, weight: 8 },
    { pattern: /(?:删掉|压下|屏蔽).{0,10}(?:投诉|质疑).{0,14}(?:推流|发布|上线)/u, weight: 10 },
  ] },
  { intent: "save_revision", patterns: [
    { pattern: /(?:保存|生成|建立|形成).{0,10}(?:R1|R2|新版本|修订)|(?:R1|R2|旧版|原版).{0,16}(?:不覆盖|链接|修订|更新)/iu, weight: 8 },
    { pattern: /(?:改成|改为|删除|删去).{0,16}(?:正文|稿件|主张|数字|待核)/u, weight: 5 },
    { pattern: /(?:正文).{0,8}(?:删除|删去).{0,20}(?:保留|写明)|(?:改成待核|标成待核).{0,12}(?:不进|不写|正文)/u, weight: 8 },
    { pattern: /(?:问题).{0,8}(?:处理|修好).{0,8}(?:上线|发布)/u, weight: 7 },
    { pattern: /(?:AI 标识|平台).{0,10}(?:补|更新|重新提交)/iu, weight: 5 },
  ] },
  { intent: "replace", patterns: [
    { pattern: /(?:替换|换成|改用|移除|删掉).{0,18}(?:画面|镜头|素材|近景|宽景|手部)/u, weight: 7 },
    { pattern: /(?:静音|打码|脱敏|裁掉).{0,12}(?:姓名|人脸|门牌|声音|近景)?/u, weight: 7 },
    { pattern: /(?:镜头|素材).{0,12}(?:删除|停用|替代)/u, weight: 5 },
    { pattern: /(?:不再同意|撤回).{0,16}(?:使用|改用).{0,12}(?:环境|宽景|手部|无识别)/u, weight: 8 },
    { pattern: /(?:删|去掉).{0,12}(?:AI|人工智能).{0,8}(?:标识|元数据)/iu, weight: 8 },
  ] },
  { intent: "annotate", patterns: [
    { pattern: /(?:记入|写入|标成|标记|登记|设为|注明|披露).{0,16}(?:台账|计划|待确认|待核|状态|来源|许可|范围)/u, weight: 7 },
    { pattern: /(?:保留).{0,10}(?:来源状态|训练记录|决定记录)/u, weight: 5 },
    { pattern: /(?:只写成|限定为).{0,18}(?:页面|统计|来源).{0,12}(?:不外推|不代表)/u, weight: 8 },
    { pattern: /(?:显式标识|隐式标识|元数据|公开许可状态).{0,18}(?:加|检查|记录|设为)/u, weight: 8 },
    { pattern: /(?:标失效|已失效).{0,14}(?:保留|状态|训练|不作为)/u, weight: 8 },
    { pattern: /(?:只有|只同意).{0,12}(?:线下|课堂|预览).{0,12}(?:许可|公开|使用)|(?:许可状态).{0,10}(?:设为|记录为)/u, weight: 9 },
  ] },
  { intent: "cite", patterns: [
    { pattern: /(?:连到|关联|链接).{0,12}(?:时间码|录音|来源|同意|证据|定位)/u, weight: 7 },
    { pattern: /(?:我要|准备|正文|稿件|主张|引语).{0,8}(?:引用|引述).{0,12}(?:来源|证据|录音|时间码|定位)/u, weight: 7 },
  ] },
  { intent: "transcribe", patterns: [
    { pattern: /(?:转写|转录).{0,10}(?:录音|音频|时间码)/u, weight: 7 },
  ] },
  { intent: "record", patterns: [
    { pattern: /(?:开始|停止|继续|记录一段|录一段).{0,8}(?:录音|录像|环境声|拍摄)|(?:录音|拍摄).{0,14}(?:用途|范围|公开|许可)/u, weight: 6 },
    { pattern: /(?:不愿说|拒绝).{0,10}(?:继续录|继续拍)|(?:剪得|改得).{0,10}(?:像|好像).{0,6}(?:同意|答应)/u, weight: 8 },
  ] },
  { intent: "compare", patterns: [
    { pattern: /(?:比对|对照|比较|相互印证|互相引用|来源冲突|年份冲突)/u, weight: 7 },
    { pattern: /(?:哪个|哪份).{0,8}(?:更权威|可信|准确)|(?:两份|多份).{0,10}(?:来源|材料|文件)/u, weight: 6 },
  ] },
  { intent: "probe", patterns: [
    { pattern: /(?:能否|可以|请).{0,8}(?:分别|具体|举一个|举例|说说).{0,20}(?:经历|例子|行为|影响|变化)/u, weight: 7 },
    { pattern: /(?:个人看法|亲历|前后|矛盾|为什么).{0,18}(?:资料|依据|例子|看法|不一)?/u, weight: 5 },
    { pattern: /(?:追问|深挖|进一步问|各自能证明|证据层级)/u, weight: 5 },
    { pattern: /(?:个人看法).{0,16}(?:公开资料|一起核对)|(?:统计时点).{0,12}(?:下次更新时间|可确认)|(?:没说过的细节).{0,12}(?:刺激|默认)/u, weight: 8 },
    { pattern: /(?:再追问|问她为什么).{0,12}(?:深一点|前后不一)?/u, weight: 7 },
    { pattern: /(?:继续问|追问).{0,12}(?:谁拍摄|谁拍的|谁出现在|创作者|权利人)/u, weight: 9 },
  ] },
  { intent: "inspect", patterns: [
    { pattern: /(?:核对|核验|查证|检查|溯源|查看).{0,18}(?:来源|出处|权利|授权|数字|网页|回执|录音|原始|时间码)?/u, weight: 6 },
    { pattern: /(?:这个|该|这条|这图).{0,12}(?:能不能用|可以用|能用|是真的吗|出处|来源)/u, weight: 5 },
    { pattern: /(?:原始出处|发布机关|页码|条款|文号|权利状态)/u, weight: 5 },
    { pattern: /(?:最感人).{0,8}(?:那段|录音)|(?:系统|模型).{0,8}(?:Prompt|Trace|提示词|追踪)|(?:私人压力|另一个学生).{0,12}(?:记录|证据|数据)/iu, weight: 8 },
  ] },
  { intent: "negotiate", patterns: [
    { pattern: /(?:承诺|协商|谈妥|底线|交换条件|替代方案|重新取得授权)/u, weight: 6 },
    { pattern: /(?:如果|若).{0,24}(?:我会|就|可以|能否)|(?:只允许|只同意|不同意).{0,18}(?:但|改为|可以)/u, weight: 5 },
    { pattern: /(?:能否|是否可以|可不可以).{0,14}(?:联系|进入|记录|公开|使用|提供)/u, weight: 5 },
    { pattern: /(?:匿名|删掉|只保留概括|撤回|拒答).{0,16}(?:希望|选择|范围|还是)|(?:进去再说|后面会解释)/u, weight: 8 },
    { pattern: /(?:多给点好处|不签就不能|逼她同意|标题植入).{0,12}(?:同意|公开|台账)?/u, weight: 8 },
    { pattern: /(?:记录|录一段).{0,16}(?:是否可以|能否|可不可以)|(?:问清|确认).{0,12}(?:公众号|短视频|平台).{0,12}(?:期限|范围)/u, weight: 9 },
    { pattern: /(?:如果|若).{0,12}(?:近景|声音|人物).{0,10}(?:不方便|不同意|撤回).{0,18}(?:改用|换成|替代)/u, weight: 9 },
    { pattern: /(?:说明|告知).{0,10}(?:采访|报道).{0,6}(?:用途|范围).{0,18}(?:匿名|不公开|选择|同意)/u, weight: 9 },
  ] },
  { intent: "wait", patterns: [
    { pattern: /(?:等待|再等|暂缓).{0,12}(?:分钟|回执|核验|授权|确认|数据)/u, weight: 6 },
    { pattern: /(?:超过|限时).{0,8}(?:分钟|时限).{0,12}(?:删|放弃|不再)/u, weight: 4 },
    { pattern: /(?:三|3|五|5|十|10)分钟后.{0,18}(?:回复|更新)|(?:下一次更新|下次更新).{0,10}(?:时间|写明)/u, weight: 7 },
  ] },
  { intent: "escalate", patterns: [
    { pattern: /(?:向|联系|提交给).{0,8}(?:教师|责任编辑|主管部门|公共联络员).{0,12}(?:说明|升级|判断|核实)/u, weight: 6 },
  ] },
  { intent: "draft", patterns: [
    { pattern: /(?:写|撰写|生成|起草|改写).{0,14}(?:标题|导语|正文|摘要|字幕|快讯|稿件|故事|版本)/u, weight: 6 },
    { pattern: /(?:标题|导语|正文|摘要|字幕|快讯|稿子).{0,18}(?:写|保留|删除|共用|分段|高级)/u, weight: 5 },
    { pattern: /(?:图文摘要).{0,12}(?:短视频字幕|同一组|共用)|(?:核心主张).{0,12}(?:支持证据|反证|记录)/u, weight: 8 },
    { pattern: /(?:编|编造|虚构|捏造|伪造).{0,10}(?:故事|引语|经历|来源|出处|回执|通知)|(?:部门|主任|官方).{0,10}(?:回执|通知).{0,8}(?:编|编造|伪造|捏造|造一份)/u, weight: 8 },
  ] },
  { intent: "ask", patterns: [
    { pattern: /(?:请问|想问|询问|问一下|复述|确认一下|对吗|愿意|您希望)/u, weight: 4 },
    { pattern: /(?:请问|想问|询问|请您|麻烦您).{0,24}(?:讲|说|回忆|介绍).{0,18}(?:经历|故事|变化|看法)/u, weight: 9 },
    { pattern: /(?:请问|想问|询问).{0,32}(?:哪些|是否).{0,12}(?:可以公开|可以引用|可以录音|可以拍摄|愿意公开)/u, weight: 9 },
    { pattern: /(?:说明|告知).{0,12}(?:身份|用途|范围).{0,16}(?:询问|请问|确认)/u, weight: 5 },
    { pattern: /(?:申请|请求|希望).{0,10}(?:采访|联系受访者|公开采访|进行采访)|(?:说明身份).{0,12}(?:申请|请求).{0,10}(?:采访|联系)/u, weight: 8 },
    { pattern: /(?:我是|作为).{0,16}(?:学生记者|融媒体记者|记者).{0,24}(?:采访目的|报道用途|报道目标)/u, weight: 8 },
    { pattern: /(?:采访目的|报道用途|报道目标).{0,32}(?:了解|采访|报道|核实)/u, weight: 6 },
    { pattern: /(?:我改问|改为问).{0,8}(?:您|你).{0,12}(?:如何|什么)|(?:那个人|里面的人).{0,12}(?:问|刚才的事)|(?:她刚才).{0,10}(?:同意|答应).{0,4}(?:吗|吧)/u, weight: 8 },
    { pattern: /(?:不让您猜|不用猜).{0,16}(?:回来|再).{0,8}(?:核对|确认)/u, weight: 9 },
  ] },
  { intent: "observe", patterns: [
    { pattern: /(?:先|我想).{0,6}(?:观察|看看|留意|记录).{0,16}(?:人流|环境|入口|标识|现场)/u, weight: 6 },
  ] },
];

const ambiguousPatterns: Array<{
  pattern: RegExp;
  code: NonNullable<DeterministicSemanticClassificationV4["ambiguityCode"]>;
  rationale: string;
}> = [
  {
    pattern: /(?:把它|那个人|里面的人|问问她|她刚才|这个数字|这句话).{0,18}(?:处理|问|同意|能不能用|是真的吗|刚才的事)/u,
    code: "missing_target",
    rationale: "行动使用了无法绑定到当前授权对象的指代，需要先确认人物、材料或主张。",
  },
  {
    pattern: /(?:所有东西|哪个更权威|最感人的那段|再追问深一点|问她为什么前后不一)/u,
    code: "missing_target",
    rationale: "范围或对象过于笼统，不能形成可执行且可追溯的岗位行动。",
  },
  {
    pattern: /(?:高级一点|处理一下|谈妥|给我做个视频|多给点好处)/u,
    code: "unclear_intent",
    rationale: "目标缺少具体对象、标准、底线或交付约束，需要学生作出真实选择。",
  },
  {
    pattern: /(?:可以发了吗|能发了吗|先发后改还是|发还是等|你看着办)/u,
    code: "state_dependent_choice",
    rationale: "发布、暂缓或更正涉及互斥后果，系统不能替学生作价值判断。",
  },
  {
    pattern: /(?:网上都在用|教学).{0,12}(?:也能用|版权应该没问题)|(?:打个码|一点点私人地方).{0,8}(?:就行|没事|应该)/u,
    code: "missing_material",
    rationale: "仅凭常见使用、教学目的或模糊处理不能确定权利与隐私边界。",
  },
  {
    pattern: /(?:先让我进去再说|后面会解释|都靠旅拍赚钱)/u,
    code: "unclear_intent",
    rationale: "身份、对象、范围或概括边界不足，需先形成专业且可执行的提问。",
  },
];

const canonicalVerbByIntent: Record<XunpuSemanticIntentV4, SemanticActionVerbV4> = {
  observe: "observe",
  ask: "ask",
  probe: "probe",
  inspect: "inspect",
  compare: "compare",
  cite: "draft",
  negotiate: "negotiate",
  record: "observe",
  import_media: "draft",
  transcribe: "inspect",
  annotate: "draft",
  replace: "draft",
  draft: "draft",
  save_revision: "draft",
  request_advice: "inspect",
  request_evidence: "inspect",
  accept_advice: "submit",
  reject_advice: "compare",
  wait: "wait",
  escalate: "escalate",
  submit_gate: "submit",
  publish: "submit",
  correct: "submit",
  request_pause: "escalate",
};

const criteriaByIntent: Record<XunpuSemanticIntentV4, string[]> = {
  observe: ["criterion-editorial-judgment"],
  ask: ["criterion-interview-consent", "criterion-editorial-judgment"],
  probe: ["criterion-fact-verification", "criterion-interview-consent"],
  inspect: ["criterion-fact-verification"],
  compare: ["criterion-fact-verification", "criterion-editorial-judgment"],
  cite: ["criterion-fact-verification"],
  negotiate: ["criterion-interview-consent", "criterion-editorial-judgment"],
  record: ["criterion-interview-consent", "criterion-rights-governance"],
  import_media: ["criterion-rights-governance", "criterion-multiplatform-production"],
  transcribe: ["criterion-fact-verification", "criterion-multiplatform-production"],
  annotate: ["criterion-fact-verification", "criterion-rights-governance"],
  replace: ["criterion-rights-governance", "criterion-multiplatform-production"],
  draft: ["criterion-editorial-judgment", "criterion-multiplatform-production"],
  save_revision: ["criterion-editorial-judgment", "criterion-recovery-transfer"],
  request_advice: ["criterion-editorial-judgment"],
  request_evidence: ["criterion-fact-verification"],
  accept_advice: ["criterion-editorial-judgment"],
  reject_advice: ["criterion-editorial-judgment"],
  wait: ["criterion-editorial-judgment"],
  escalate: ["criterion-recovery-transfer"],
  submit_gate: ["criterion-editorial-judgment", "criterion-rights-governance"],
  publish: ["criterion-editorial-judgment", "criterion-rights-governance"],
  correct: ["criterion-fact-verification", "criterion-recovery-transfer"],
  request_pause: ["criterion-recovery-transfer"],
};

const gateIntents = new Set<XunpuSemanticIntentV4>([
  "escalate",
  "submit_gate",
  "publish",
  "correct",
  "request_pause",
]);

function normalizeText(input: string): string {
  return input.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/gu, "");
}

function grams(input: string): Set<string> {
  const normalized = normalizeText(input).replace(/[\p{P}\p{S}]/gu, "");
  const result = new Set<string>();
  for (const width of [1, 2, 3]) {
    for (let index = 0; index <= normalized.length - width; index += 1) {
      result.add(normalized.slice(index, index + width));
    }
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
  let intersection = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (leftGrams.size + rightGrams.size);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function hmacToken(secret: string, scope: unknown, prefix: string): string {
  const digest = createHmac("sha256", secret)
    .update(stableJson(scope))
    .digest("base64url");
  return `${prefix}_${digest}`;
}

function selectionTokenScope(
  input: Omit<IssueSemanticActionSelectionV4Input, "secret" | "label" | "consequenceHint" | "allowedIntents">,
): unknown {
  return {
    version: XunpuSemanticActionRuntimeV4Version,
    sessionId: input.sessionId,
    bindingId: input.bindingId,
    actionWindowRef: input.actionWindowRef,
    worldStateVersion: input.worldStateVersion,
    displayKind: input.displayKind,
    objectType: input.objectType,
    objectId: input.objectId,
    selectionRole: input.selectionRole,
  };
}

export function issueSemanticActionSelectionV4(
  input: IssueSemanticActionSelectionV4Input,
): SemanticActionSelectionV4 {
  if (input.secret.length < 32) {
    throw new Error("语义行动选择令牌密钥至少需要 32 个字符");
  }
  if (new Set(input.allowedIntents).size !== input.allowedIntents.length) {
    throw new Error("语义行动选择的允许意图必须唯一");
  }
  return {
    selectionToken: hmacToken(input.secret, selectionTokenScope(input), "sel"),
    displayKind: input.displayKind,
    objectType: input.objectType,
    objectId: input.objectId,
    label: input.label,
    consequenceHint: input.consequenceHint,
    selectionRole: input.selectionRole,
    allowedIntents: [...input.allowedIntents],
  };
}

function safetyMatch(utterance: string): SafetyPolicy | null {
  return safetyPolicies.find((policy) => (
    hasAffirmedNaturalLanguageMatchV4(utterance, policy.pattern)
  )) ?? null;
}

function ambiguityMatch(utterance: string): typeof ambiguousPatterns[number] | null {
  return ambiguousPatterns.find((policy) => (
    hasNaturalLanguageIntentMatchV4(utterance, policy.pattern)
  )) ?? null;
}

function missingTargetRationale(intent: XunpuSemanticIntentV4 | null): string {
  if (intent === "ask" || intent === "probe" || intent === "negotiate") {
    return "请指定要采访、追问或协商的人物，并说明希望确认的议题或边界。";
  }
  if (intent === "inspect" || intent === "compare" || intent === "cite"
    || intent === "transcribe" || intent === "request_evidence") {
    return "请指定要核验的材料、来源或作品版本，并说明要确认的主张或定位。";
  }
  if (intent === "draft" || intent === "save_revision" || intent === "replace"
    || intent === "annotate" || intent === "import_media") {
    return "请指定要处理的作品版本或素材，并说明要形成的修订结果。";
  }
  if (intent === "submit_gate" || intent === "publish" || intent === "correct") {
    return "请指定要送审、发布或更正的作品版本，并说明提交范围。";
  }
  if (intent === "observe") {
    return "请指定要观察的现场人物、位置或材料。";
  }
  return "行动方向可以理解，但尚未绑定当前世界中的人物、材料或作品对象。";
}

function rankedSamples(
  utterance: string,
  worldStateRef: string,
  samples: readonly XunpuSemanticSampleRuntimeV4[],
): Array<{ sample: XunpuSemanticSampleRuntimeV4; similarity: number }> {
  return samples
    .filter((sample) => sample.worldStateRef === worldStateRef)
    .map((sample) => ({ sample, similarity: diceSimilarity(utterance, sample.utterance) }))
    .sort((left, right) => (
      right.similarity - left.similarity
      || left.sample.sampleId.localeCompare(right.sample.sampleId)
    ))
    .slice(0, 5);
}

function inferIntent(
  utterance: string,
  worldStateRef: string,
  allowedIntents: readonly XunpuSemanticIntentV4[],
  samples: readonly XunpuSemanticSampleRuntimeV4[],
): {
  intent: XunpuSemanticIntentV4 | null;
  confidence: number;
  matchedSampleRefs: string[];
} {
  const allowed = new Set(allowedIntents);
  const scores = new Map<XunpuSemanticIntentV4, number>();
  for (const rule of intentRules) {
    if (!allowed.has(rule.intent)) continue;
    let score = 0;
    for (const weightedPattern of rule.patterns) {
      if (hasNaturalLanguageIntentMatchV4(utterance, weightedPattern.pattern)) {
        score += weightedPattern.weight;
      }
    }
    if (score > 0) scores.set(rule.intent, score);
  }
  const nearest = rankedSamples(utterance, worldStateRef, samples);
  for (const { sample, similarity } of nearest) {
    if (!sample.expectedIntent || !allowed.has(sample.expectedIntent)) continue;
    if (similarity < 0.12) continue;
    scores.set(
      sample.expectedIntent,
      (scores.get(sample.expectedIntent) ?? 0) + (similarity * 3),
    );
  }
  const ranking = [...scores.entries()].sort((left, right) => (
    right[1] - left[1] || left[0].localeCompare(right[0])
  ));
  const winner = ranking[0];
  if (!winner) {
    return {
      intent: null,
      confidence: 0,
      matchedSampleRefs: nearest.filter(({ similarity }) => similarity >= 0.2)
        .map(({ sample }) => sample.sampleId),
    };
  }
  const runnerUp = ranking[1]?.[1] ?? 0;
  const lexicalConfidence = Math.min(0.98, 0.5 + (winner[1] / 20));
  const marginConfidence = Math.min(1, Math.max(0, (winner[1] - runnerUp) / 8));
  return {
    intent: winner[0],
    confidence: Number((lexicalConfidence * 0.7 + marginConfidence * 0.3).toFixed(3)),
    matchedSampleRefs: nearest.filter(({ similarity }) => similarity >= 0.2)
      .map(({ sample }) => sample.sampleId),
  };
}

export function classifyXunpuSemanticActionV4(input: {
  utterance: string;
  worldStateRef: string;
  selectedObjectCount: number;
  implicitTargetCount: number;
  allowedIntents: readonly XunpuSemanticIntentV4[];
  trainingSamples: readonly XunpuSemanticSampleRuntimeV4[];
}): DeterministicSemanticClassificationV4 {
  const trainingSamples = input.trainingSamples.filter(
    (sample) => sample.blindSplit === "train",
  );
  const safety = safetyMatch(input.utterance);
  const inferred = inferIntent(
    input.utterance,
    input.worldStateRef,
    input.allowedIntents,
    trainingSamples,
  );
  if (safety) {
    return {
      outcome: "refused",
      intent: inferred.intent,
      confidence: 1,
      rationale: safety.safeMessage,
      riskRefs: [...safety.riskRefs],
      matchedSampleRefs: inferred.matchedSampleRefs,
      ambiguityCode: null,
      refusalReasonCode: safety.reasonCode,
    };
  }
  const ambiguity = ambiguityMatch(input.utterance);
  if (ambiguity) {
    return {
      outcome: "clarification_required",
      intent: inferred.intent,
      confidence: Math.max(0.5, inferred.confidence),
      rationale: ambiguity.rationale,
      riskRefs: [],
      matchedSampleRefs: inferred.matchedSampleRefs,
      ambiguityCode: ambiguity.code,
      refusalReasonCode: null,
    };
  }
  if (!inferred.intent || inferred.confidence < 0.52) {
    return {
      outcome: "clarification_required",
      intent: inferred.intent,
      confidence: inferred.confidence,
      rationale: "当前表达无法稳定确定岗位意图，请补充要处理的人物、材料和预期结果。",
      riskRefs: [],
      matchedSampleRefs: inferred.matchedSampleRefs,
      ambiguityCode: "unclear_intent",
      refusalReasonCode: null,
    };
  }
  if (input.selectedObjectCount + input.implicitTargetCount === 0) {
    return {
      outcome: "clarification_required",
      intent: inferred.intent,
      confidence: inferred.confidence,
      rationale: missingTargetRationale(inferred.intent),
      riskRefs: [],
      matchedSampleRefs: inferred.matchedSampleRefs,
      ambiguityCode: "missing_target",
      refusalReasonCode: null,
    };
  }
  return {
    outcome: "accepted",
    intent: inferred.intent,
    confidence: inferred.confidence,
    rationale: "行动已解析为当前世界允许的岗位意图，并绑定到服务端授权对象。",
    riskRefs: [],
    matchedSampleRefs: inferred.matchedSampleRefs,
    ambiguityCode: null,
    refusalReasonCode: null,
  };
}

function recoveryForSafety(policy: SafetyPolicy | null): string | null {
  return policy?.recoveryHint ?? "请改为当前学生记者职责内、可核验且尊重权利边界的行动。";
}

function publicRef(selection: SemanticActionSelectionV4) {
  return {
    objectType: selection.objectType,
    objectId: selection.objectId,
    sourceSelectionTokenHash: hash(selection.selectionToken),
  };
}

function uniqueSelections(
  selections: readonly SemanticActionSelectionV4[],
): SemanticActionSelectionV4[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = `${selection.objectType}:${selection.objectId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelCandidateIsGrounded(
  candidate: ModelCandidate,
  available: readonly SemanticActionSelectionV4[],
  implicit: readonly SemanticActionSelectionV4[],
  allowedIntents: readonly XunpuSemanticIntentV4[],
): boolean {
  if (candidate.intent && !allowedIntents.includes(candidate.intent)) return false;
  const targetIds = new Set(
    [...available, ...implicit].filter((item) => item.selectionRole === "target")
      .map((item) => item.objectId),
  );
  const materialIds = new Set(
    available.filter((item) => item.selectionRole === "material")
      .map((item) => item.objectId),
  );
  return candidate.targetObjectIds.every((id) => targetIds.has(id))
    && candidate.materialObjectIds.every((id) => materialIds.has(id));
}

function candidateClassification(
  candidate: ModelCandidate,
): DeterministicSemanticClassificationV4 {
  return {
    outcome: candidate.outcome,
    intent: candidate.intent,
    confidence: candidate.confidence,
    rationale: candidate.rationale,
    riskRefs: [...candidate.riskRefs],
    matchedSampleRefs: [],
    ambiguityCode: candidate.outcome === "clarification_required"
      ? candidate.ambiguityCode ?? "unclear_intent"
      : null,
    refusalReasonCode: candidate.outcome === "refused"
      ? candidate.refusalReasonCode ?? "unsupported_operation"
      : null,
  };
}

function chooseSelectionsForModel(
  candidate: ModelCandidate,
  selected: readonly SemanticActionSelectionV4[],
  implicit: readonly SemanticActionSelectionV4[],
): { targets: SemanticActionSelectionV4[]; materials: SemanticActionSelectionV4[] } {
  const allTargets = uniqueSelections([
    ...selected.filter((item) => item.selectionRole === "target"),
    ...implicit,
  ]);
  const targetIds = new Set(candidate.targetObjectIds);
  const materialIds = new Set(candidate.materialObjectIds);
  return {
    targets: candidate.targetObjectIds.length > 0
      ? allTargets.filter((item) => targetIds.has(item.objectId))
      : allTargets,
    materials: selected.filter((item) => (
      item.selectionRole === "material" && materialIds.has(item.objectId)
    )),
  };
}

export class XunpuSemanticActionServiceV4 {
  readonly #secret: string;
  readonly #trainingSamples: XunpuSemanticSampleRuntimeV4[];
  readonly #model: SemanticActionParserModelV4 | null;
  readonly #now: () => Date;

  constructor(options: SemanticActionServiceV4Options) {
    if (options.selectionSecret.length < 32) {
      throw new Error("语义行动运行时密钥至少需要 32 个字符");
    }
    this.#secret = options.selectionSecret;
    this.#trainingSamples = options.samples.filter(
      (sample) => sample.blindSplit === "train",
    ).map((sample) => ({ ...sample }));
    this.#model = options.model ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  get trainingSampleCount(): number {
    return this.#trainingSamples.length;
  }

  async decide(
    requestInput: SemanticActionRequestV4,
    windowInput: SemanticActionWindowV4,
  ): Promise<SemanticActionRuntimeResultV4> {
    const request = SemanticActionRequestV4Schema.parse(requestInput);
    const contentRef = FlagshipContentReferenceV4Schema.parse(
      windowInput.flagshipContentRef,
    );
    const now = this.#now();
    const payloadHash = hash(request);
    const shared = {
      schemaVersion: SemanticActionDecisionV4SchemaVersion,
      decisionId: stableId("semantic-decision", {
        requestId: request.requestId,
        payloadHash,
        stateVersion: windowInput.worldStateVersion,
      }),
      requestId: request.requestId,
      sessionId: request.sessionId,
      bindingId: request.bindingId,
      flagshipContentRef: contentRef,
      sourceWorldStateVersion: windowInput.worldStateVersion,
      requestPayloadHash: payloadHash,
      decidedAt: now.toISOString(),
    } as const;
    const baseDiagnostics = {
      runtimeVersion: XunpuSemanticActionRuntimeV4Version,
      trainingSampleCount: this.#trainingSamples.length,
      blindSamplesConsumed: 0 as const,
    };

    const stale = request.sessionId !== windowInput.sessionId
      || request.bindingId !== windowInput.bindingId
      || request.actionWindowRef !== windowInput.actionWindowRef
      || request.actionWindowHash !== windowInput.actionWindowHash
      || request.expectedWorldStateVersion !== windowInput.worldStateVersion
      || now.getTime() > Date.parse(windowInput.expiresAt);
    if (stale) {
      const decision = SemanticActionDecisionV4Schema.parse({
        ...shared,
        parserMode: "deterministic_fallback",
        confidence: 1,
        status: "refused",
        canonicalAction: null,
        clarification: null,
        refusal: {
          reasonCode: "stale_action_window",
          safeMessage: "当前行动窗口、对象或世界版本已经变化，本次输入未写入世界。",
          recoveryHint: "请刷新当前现场，重新选择人物或材料后提交。",
        },
        writeDisposition: "zero_write",
      });
      return {
        decision,
        diagnostics: {
          ...baseDiagnostics,
          parserMode: "deterministic_fallback",
          internalIntent: null,
          matchedSampleRefs: [],
          riskRefs: [],
          fallbackReason: "model_unavailable",
        },
      };
    }

    const availableByToken = new Map(
      windowInput.availableSelections.map((selection) => [
        selection.selectionToken,
        selection,
      ]),
    );
    const selected: SemanticActionSelectionV4[] = [];
    let unauthorized = false;
    for (const clientSelection of request.selections) {
      const selection = availableByToken.get(clientSelection.selectionToken);
      if (!selection
        || selection.displayKind !== clientSelection.displayKind
        || selection.selectionToken !== hmacToken(
          this.#secret,
          selectionTokenScope({
            sessionId: windowInput.sessionId,
            bindingId: windowInput.bindingId,
            actionWindowRef: windowInput.actionWindowRef,
            worldStateVersion: windowInput.worldStateVersion,
            displayKind: selection.displayKind,
            objectType: selection.objectType,
            objectId: selection.objectId,
            selectionRole: selection.selectionRole,
          }),
          "sel",
        )) {
        unauthorized = true;
        break;
      }
      selected.push(selection);
    }
    if (unauthorized) {
      const decision = SemanticActionDecisionV4Schema.parse({
        ...shared,
        parserMode: "deterministic_fallback",
        confidence: 1,
        status: "refused",
        canonicalAction: null,
        clarification: null,
        refusal: {
          reasonCode: "unauthorized_reference",
          safeMessage: "提交的人物或材料引用不是当前行动窗口签发的对象，本次输入未写入世界。",
          recoveryHint: "请只使用当前现场显示并由服务端签发的对象选择。",
        },
        writeDisposition: "zero_write",
      });
      return {
        decision,
        diagnostics: {
          ...baseDiagnostics,
          parserMode: "deterministic_fallback",
          internalIntent: null,
          matchedSampleRefs: [],
          riskRefs: [],
          fallbackReason: "model_unavailable",
        },
      };
    }

    const safety = safetyMatch(request.utterance);
    let parserMode: "live_model" | "deterministic_fallback" =
      "deterministic_fallback";
    let fallbackReason: SemanticActionRuntimeDiagnosticsV4["fallbackReason"] =
      this.#model ? null : "model_unavailable";
    let modelCandidate: ModelCandidate | null = null;
    if (!safety && this.#model) {
      try {
        const raw = await this.#model.parse({
          runtimeVersion: XunpuSemanticActionRuntimeV4Version,
          worldStateRef: windowInput.worldStateRef,
          utterance: request.utterance,
          selectedObjects: selected.map((selection) => ({
            objectId: selection.objectId,
            objectType: selection.objectType,
            label: selection.label,
            selectionRole: selection.selectionRole,
            allowedIntents: [...selection.allowedIntents],
          })),
          allowedIntents: [...windowInput.allowedIntents],
        });
        const parsed = ModelCandidateSchema.safeParse(raw);
        if (parsed.success && modelCandidateIsGrounded(
          parsed.data,
          selected,
          windowInput.implicitTargetSelections,
          windowInput.allowedIntents,
        )) {
          modelCandidate = parsed.data;
          parserMode = "live_model";
        } else {
          fallbackReason = "model_invalid";
        }
      } catch {
        fallbackReason = "model_failed";
      }
    }

    let classification = modelCandidate
      ? candidateClassification(modelCandidate)
      : classifyXunpuSemanticActionV4({
          utterance: request.utterance,
          worldStateRef: windowInput.worldStateRef,
          selectedObjectCount: selected.length,
          implicitTargetCount: windowInput.implicitTargetSelections.length,
          allowedIntents: windowInput.allowedIntents,
          trainingSamples: this.#trainingSamples,
        });
    if (safety) {
      classification = {
        outcome: "refused",
        intent: classification.intent,
        confidence: 1,
        rationale: safety.safeMessage,
        riskRefs: [...safety.riskRefs],
        matchedSampleRefs: classification.matchedSampleRefs,
        ambiguityCode: null,
        refusalReasonCode: safety.reasonCode,
      };
      parserMode = "deterministic_fallback";
    }
    if (classification.outcome === "accepted"
      && (!classification.intent || classification.confidence < 0.52)) {
      classification = {
        ...classification,
        outcome: "clarification_required",
        ambiguityCode: "unclear_intent",
        refusalReasonCode: null,
        rationale: "模型候选置信度不足，系统未代替学生决定具体岗位行动。",
      };
      parserMode = "deterministic_fallback";
      fallbackReason = fallbackReason ?? "model_invalid";
    }

    const diagnostics: SemanticActionRuntimeDiagnosticsV4 = {
      ...baseDiagnostics,
      parserMode,
      internalIntent: classification.intent,
      matchedSampleRefs: [...classification.matchedSampleRefs],
      riskRefs: [...classification.riskRefs],
      fallbackReason,
    };

    if (classification.outcome === "refused") {
      const policy = safety;
      return {
        decision: SemanticActionDecisionV4Schema.parse({
          ...shared,
          parserMode,
          confidence: classification.confidence,
          status: "refused",
          canonicalAction: null,
          clarification: null,
          refusal: {
            reasonCode: classification.refusalReasonCode ?? "unsupported_operation",
            safeMessage: classification.rationale,
            recoveryHint: recoveryForSafety(policy),
          },
          writeDisposition: "zero_write",
        }),
        diagnostics,
      };
    }

    if (classification.outcome === "clarification_required") {
      const choicesFromSelections = uniqueSelections([
        ...selected,
        ...windowInput.availableSelections,
      ]).slice(0, 4).map((selection) => ({
        choiceToken: hmacToken(this.#secret, {
          requestId: request.requestId,
          payloadHash,
          objectId: selection.objectId,
          worldStateVersion: windowInput.worldStateVersion,
        }, "choice"),
        label: selection.label,
        consequenceHint: selection.consequenceHint,
      }));
      const fallbackChoices = [
        {
          choiceToken: hmacToken(this.#secret, {
            requestId: request.requestId,
            choice: "describe-target",
          }, "choice"),
          label: "补充人物或材料",
          consequenceHint: "明确要处理的世界对象后再解析，不改变当前世界。",
        },
        {
          choiceToken: hmacToken(this.#secret, {
            requestId: request.requestId,
            choice: "describe-outcome",
          }, "choice"),
          label: "补充预期结果",
          consequenceHint: "说明想获得信息、协商边界还是提交作品，不替你作决定。",
        },
      ];
      const choices = choicesFromSelections.length >= 2
        ? choicesFromSelections
        : fallbackChoices;
      return {
        decision: SemanticActionDecisionV4Schema.parse({
          ...shared,
          parserMode,
          confidence: classification.confidence,
          status: "clarification_required",
          canonicalAction: null,
          clarification: {
            prompt: classification.rationale,
            ambiguityCode: classification.ambiguityCode ?? "unclear_intent",
            choices,
            expiresAt: new Date(now.getTime() + (5 * 60_000)).toISOString(),
          },
          refusal: null,
          writeDisposition: "zero_write",
        }),
        diagnostics,
      };
    }

    const intent = classification.intent;
    if (!intent) {
      throw new Error("accepted 语义行动缺少内部意图");
    }
    const modelSelections = modelCandidate
      ? chooseSelectionsForModel(
          modelCandidate,
          selected,
          windowInput.implicitTargetSelections,
        )
      : {
          targets: uniqueSelections([
            ...selected.filter((item) => item.selectionRole === "target"),
            ...windowInput.implicitTargetSelections,
          ]),
          materials: uniqueSelections(
            selected.filter((item) => item.selectionRole === "material"),
          ),
        };
    if (modelSelections.targets.length === 0) {
      throw new Error("accepted 语义行动必须解析出至少一个服务端授权对象");
    }
    return {
      decision: SemanticActionDecisionV4Schema.parse({
        ...shared,
        parserMode,
        confidence: classification.confidence,
        status: "accepted",
        canonicalAction: {
          actionId: stableId("semantic-action", {
            requestId: request.requestId,
            payloadHash,
            intent,
            targetIds: modelSelections.targets.map((item) => item.objectId),
          }),
          verb: canonicalVerbByIntent[intent],
          targetRefs: modelSelections.targets.map(publicRef),
          materialRefs: modelSelections.materials.map(publicRef),
          intentSummary: classification.rationale,
          professionalCriteriaRefs: criteriaByIntent[intent],
          riskRefs: classification.riskRefs,
          requiresTeacherGate: gateIntents.has(intent),
          authorizationCheck: "service_verified",
          authority: "proposal_only",
        },
        clarification: null,
        refusal: null,
        writeDisposition: "candidate_only",
      }),
      diagnostics,
    };
  }
}

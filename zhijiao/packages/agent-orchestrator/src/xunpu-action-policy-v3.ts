import type { StudentWorkAction } from "@ronggang/contracts";
import type {
  SimulationQueuedEvent,
  SimulationSessionRecord,
} from "@ronggang/world-core";
import {
  hasAffirmedNaturalLanguageMatchV4,
} from "@ronggang/world-core";

export const XunpuSafeActionSignalSchemaVersion =
  "xunpu-safe-action-signal/1.0.0" as const;

export type XunpuActionQualityV3 =
  | "professional"
  | "incomplete"
  | "risky"
  | "not_applicable";

export interface XunpuSafeActionSignalV3 {
  schemaVersion: typeof XunpuSafeActionSignalSchemaVersion;
  eventType: string;
  actionVerb: StudentWorkAction["action"]["verb"] | "world_event";
  quality: XunpuActionQualityV3;
  matchedCriteria: string[];
  missingCriteria: string[];
  riskFlags: string[];
  evidenceReferenceCount: number;
  worldIndicators: Record<string, number>;
  remainingMinutes: number;
}

export interface BuildXunpuSimulationTaskInstructionV3Input {
  world: SimulationSessionRecord;
  event: SimulationQueuedEvent;
  publicCue: string;
}

const signalMarker = "\n[SAFE_ACTION_SIGNAL_V1]";
const safeIdPattern = /^[a-z][a-z0-9_-]{0,63}$/u;

interface Criterion {
  id: string;
  pattern: RegExp;
}

interface EventPolicy {
  criteria: Criterion[];
  professionalMinimum: number;
}

const eventPolicies: Record<string, EventPolicy> = {
  student_asks_gatekeeper: {
    criteria: [
      { id: "identity_disclosed", pattern: /(?:学生记者|融媒体记者|记者身份|我是.{0,8}记者)/u },
      { id: "purpose_disclosed", pattern: /(?:采访目的|报道用途|了解|采访对象|公开采访|愿意接受采访|采访谁|哪些人.{0,8}采访)/u },
      { id: "public_scope", pattern: /(?:公共(?:区域|空间|巷道|院落)|拍摄范围|采访范围|拍摄边界|不进入|只拍|不拍.{0,8}(?:门内|室内|住处|民居))/u },
      { id: "privacy_boundary", pattern: /(?:私人|隐私|未成年|拒答|撤回|同意|居民门内|家门内|住处|民居室内)/u },
    ],
    professionalMinimum: 3,
  },
  student_asks_inheritor: {
    criteria: [
      { id: "cultural_subject", pattern: /(?:文化主体|蟳埔女|社区主体|女性主体)/u },
      { id: "cultural_context", pattern: /(?:文化语境|习俗|劳动|历史|传承|生活)/u },
      { id: "anti_exoticization", pattern: /(?:不想只|不只|避免猎奇|不是.{0,12}(?:网红|好看|头饰))/u },
      { id: "open_question", pattern: /(?:为什么|如何|什么|您认为|请谈)/u },
    ],
    professionalMinimum: 3,
  },
  student_inspects_source: {
    criteria: [
      { id: "primary_source", pattern: /(?:原始出处|原始来源|发布机关|原文件)/u },
      { id: "source_locator", pattern: /(?:年份|页码|条款|定位|文号)/u },
      { id: "independent_corroboration", pattern: /(?:独立来源|相互印证|两份|并列|比对)/u },
      { id: "citation_chain", pattern: /(?:转引|转载|引用链|溯源)/u },
    ],
    professionalMinimum: 3,
  },
  student_observes_editorial_brief: {
    criteria: [
      { id: "public_value", pattern: /(?:公共价值|公众问题|报道价值)/u },
      { id: "audience_defined", pattern: /(?:受众|观众|用户)/u },
      { id: "cultural_subject", pattern: /(?:文化主体|社区主体|蟳埔女)/u },
      { id: "abandonment_boundary", pattern: /(?:放弃条件|不采用|暂缓|边界)/u },
      { id: "time_budget", pattern: /(?:时间预算|截稿|发布窗口|分钟)/u },
    ],
    professionalMinimum: 3,
  },
  student_asks_community_source: {
    criteria: [
      { id: "purpose_disclosed", pattern: /(?:报道用途|采访用途|公开报道|说明用途)/u },
      { id: "anonymity_option", pattern: /(?:匿名|化名|不具名)/u },
      { id: "private_scope", pattern: /(?:家庭|住址|私人|未成年|孩子)/u },
      { id: "withdrawal_right", pattern: /(?:撤回|删题|拒答|不同意|确认同意)/u },
    ],
    professionalMinimum: 3,
  },
  student_resolves_commercial_exchange: {
    criteria: [
      { id: "authorization_separated", pattern: /(?:素材授权|授权范围|授权与.{0,8}(?:曝光|植入|标题)|授权.{0,8}分开)/u },
      { id: "editorial_control_retained", pattern: /(?:(?:标题|首图|选题|版面).{0,12}(?:编辑判断|编辑决定|不交换|不承诺|不能保证)|拒绝.{0,12}(?:植入|套餐|曝光))/u },
      { id: "relationship_disclosed", pattern: /(?:披露|标注|注明).{0,12}(?:素材提供方|商户|合作关系|来源)/u },
      { id: "lawful_alternative", pattern: /(?:有限合作|替代素材|自采素材|只接受授权|不使用素材|另找素材)/u },
    ],
    professionalMinimum: 3,
  },
  student_probes_researcher: {
    criteria: [
      { id: "evidence_layers", pattern: /(?:来源层级|各自能证明|证据层级|区分)/u },
      { id: "primary_records", pattern: /(?:国家级名录|地方标准|原始|发布机关)/u },
      { id: "oral_history_boundary", pattern: /(?:口述|传说|推测|起源说法)/u },
      { id: "fact_uncertainty", pattern: /(?:待核|不能确定|置信|事实与)/u },
    ],
    professionalMinimum: 3,
  },
  student_compares_sources: {
    criteria: [
      { id: "primary_records", pattern: /(?:国务院|国家级名录|地方标准|原始发布)/u },
      { id: "publisher_and_date", pattern: /(?:发布主体|发布机关|年份|时点)/u },
      { id: "source_locator", pattern: /(?:原始定位|页码|条款|文号|链接)/u },
      { id: "citation_chain", pattern: /(?:转引|转载|引用链|互相引用)/u },
    ],
    professionalMinimum: 3,
  },
  student_requests_official_data: {
    criteria: [
      { id: "official_subject", pattern: /(?:公开材料|公开值|确认主体|文旅|部门)/u },
      { id: "timestamp", pattern: /(?:时点|时间|截至|更新时间)/u },
      { id: "statistical_scope", pattern: /(?:口径|范围|统计)/u },
      { id: "uncertainty_disclosed", pattern: /(?:待核|汇总|未知|不能提前|尚未)/u },
    ],
    professionalMinimum: 3,
  },
  student_inspects_rights: {
    criteria: [
      { id: "author_identified", pattern: /(?:作者|创作者|摄影者|原文件)/u },
      { id: "portrait_consent", pattern: /(?:肖像|人物同意|出镜同意)/u },
      { id: "purpose_scope", pattern: /(?:用途|使用范围|商业使用)/u },
      { id: "platform_scope", pattern: /(?:平台|短视频|图文|跨平台)/u },
      { id: "duration_scope", pattern: /(?:期限|有效期|时间范围)/u },
      { id: "derivative_scope", pattern: /(?:二次剪辑|改编|再传播)/u },
      { id: "replacement_plan", pattern: /(?:替换|停用|限用途|重新授权)/u },
    ],
    professionalMinimum: 4,
  },
  student_submits_limited_alert: {
    criteria: [
      { id: "authority_named", pattern: /(?:权威|部门|确认主体|发布主体)/u },
      { id: "timestamp", pattern: /(?:时点|截至|时间|何时)/u },
      { id: "location_scope", pattern: /(?:位置|区域|巷口|范围)/u },
      { id: "unknowns_disclosed", pattern: /(?:未知|待核|尚未确认|仍在核实)/u },
    ],
    professionalMinimum: 3,
  },
  student_submits_correction: {
    criteria: [
      { id: "visible_correction", pattern: /(?:公开更正|公开说明|下架)/u },
      { id: "version_preserved", pattern: /(?:原版本|版本差异|修订记录)/u },
      { id: "evidence_basis", pattern: /(?:依据|证据|来源)/u },
      { id: "accountability", pattern: /(?:责任|回应|致歉|更正入口)/u },
    ],
    professionalMinimum: 3,
  },
  student_waits_for_verification: {
    criteria: [
      { id: "verification_reason", pattern: /(?:等待核验|等待授权|等待确认|补证)/u },
      { id: "bounded_delay", pattern: /(?:十分钟|10分钟|明确时限|下一更新时间)/u },
      { id: "interim_plan", pattern: /(?:先完成|并行|期间|暂缓发布|限定快讯)/u },
    ],
    professionalMinimum: 2,
  },
};

const riskPatterns: Criterion[] = [
  { id: "conceal_identity", pattern: /(?:(?:假装|冒充|伪装(?:成|为)?|装(?:作|成)?).{0,12}(?:游客|居民)|隐瞒记者身份|(?:不|不必|无需|不用|不要)说明身份)/iu },
  { id: "invade_private_space", pattern: /(?:直接闯入|偷拍视频|偷拍|偷录|闯入|混进去|不管隐私)/u },
  { id: "skip_verification", pattern: /(?:不用核验|无需核验|网上都这么说|直接当事实)/u },
  { id: "ignore_rights", pattern: /(?:不用授权|无需授权|截图就能用|先用再说)/u },
  { id: "traffic_first", pattern: /(?:标题党|流量密码|越夸张越好|只要流量)/u },
  { id: "commercial_exchange", pattern: /(?:保证植入|版面换素材|标题突出商家|答应.{0,10}(?:套餐|曝光)|素材换.{0,8}(?:标题|首图|植入))/u },
  { id: "hide_uncertainty", pattern: /(?:删掉未知|假装已确认|编一个数字|先发再核)/u },
  { id: "consent_withdrawal_ignored", pattern: /(?:不愿|拒绝|撤回|撤销|不再同意|不同意).{0,16}(?:授权.{0,8})?(?:继续录|继续拍|继续发|照常发|继续推流)/u },
  { id: "fabricate_authority", pattern: /(?:伪造|捏造|编造).{0,16}(?:官方|部门|主任|回执|通知)|(?:官方|部门|主任).{0,12}(?:回执|通知).{0,8}(?:伪造|捏造|编造)/u },
  { id: "ai_label_removal", pattern: /(?:删|去掉|移除|隐藏).{0,16}(?:AI|人工智能).{0,8}(?:标识|标签|元数据)|(?:AI|人工智能).{0,8}(?:标识|标签|元数据).{0,16}(?:删掉|移除|隐藏)/iu },
  { id: "teacher_gate_bypass", pattern: /(?:不经过|绕过|跳过).{0,12}(?:教师门|教师审核|发布门)|(?:直接|立即).{0,8}(?:全平台|公开发布).{0,8}(?:不审核|不核验)?/u },
  { id: "silent_edit", pattern: /(?:覆盖|删掉).{0,10}(?:旧版|原版本)|(?:别|不).{0,8}(?:看到|保留).{0,8}(?:改过|修订|记录)/u },
];

function actionText(action: StudentWorkAction): string {
  const reflection = action.reflectionNote ?? "";
  switch (action.action.verb) {
    case "observe":
      return `${action.action.observationFocus} ${reflection}`;
    case "ask":
    case "probe":
    case "negotiate":
      return `${action.action.utterance} ${reflection}`;
    case "inspect":
    case "compare":
      return `${action.action.evidenceQuestion} ${reflection}`;
    case "wait":
      return `${action.action.reason} ${reflection}`;
    case "escalate":
      return `${action.action.reason} ${reflection}`;
    case "draft":
    case "submit":
      return reflection;
  }
}

function evidenceReferenceCount(action: StudentWorkAction): number {
  if (action.action.verb === "submit" || action.action.verb === "escalate") {
    return action.action.evidenceRefs.length;
  }
  if (action.action.verb === "inspect" || action.action.verb === "compare") {
    return action.action.targetRefs.length;
  }
  return action.sourceWorldEventIds.length;
}

function assessAction(
  eventType: string,
  action: StudentWorkAction,
): Pick<XunpuSafeActionSignalV3,
  "quality" | "matchedCriteria" | "missingCriteria" | "riskFlags"
> {
  if (action.action.verb === "draft" || action.action.verb === "submit") {
    return {
      quality: "professional",
      matchedCriteria: ["versioned_artifact_reference"],
      missingCriteria: [],
      riskFlags: [],
    };
  }
  const text = actionText(action).normalize("NFKC");
  const policy = eventPolicies[eventType];
  const riskFlags = riskPatterns
    .filter((criterion) => hasAffirmedNaturalLanguageMatchV4(text, criterion.pattern))
    .map((criterion) => criterion.id);
  const matchedCriteria = policy?.criteria
    // Criteria patterns describe the professional boundary itself (for
    // example, "不拍居民门内"); unlike risk patterns, their negation is
    // often the evidence of a safe choice and must not be stripped.
    .filter((criterion) => criterion.pattern.test(text))
    .map((criterion) => criterion.id) ?? [];
  const missingCriteria = policy?.criteria
    .filter((criterion) => !matchedCriteria.includes(criterion.id))
    .map((criterion) => criterion.id) ?? [];
  return {
    quality: riskFlags.length > 0
      ? "risky"
      : policy && matchedCriteria.length >= policy.professionalMinimum
        ? "professional"
        : "incomplete",
    matchedCriteria,
    missingCriteria,
    riskFlags,
  };
}

function worldIndicators(record: SimulationSessionRecord): Record<string, number> {
  return Object.fromEntries(record.currentSnapshot.variables.map((variable) => [
    variable.variableId,
    variable.after,
  ]));
}

export function createXunpuSafeActionSignalV3(
  world: SimulationSessionRecord,
  event: SimulationQueuedEvent,
): XunpuSafeActionSignalV3 {
  const action = event.sourceKind === "student_action"
    ? world.studentActions.find((candidate) => candidate.workActionId === event.sourceRef)
      ?? null
    : null;
  const assessment = action
    ? assessAction(event.eventType, action)
    : {
        quality: "not_applicable" as const,
        matchedCriteria: [],
        missingCriteria: [],
        riskFlags: [],
      };
  return {
    schemaVersion: XunpuSafeActionSignalSchemaVersion,
    eventType: event.eventType,
    actionVerb: action?.action.verb ?? "world_event",
    ...assessment,
    evidenceReferenceCount: action ? evidenceReferenceCount(action) : 0,
    worldIndicators: worldIndicators(world),
    remainingMinutes: world.currentSnapshot.virtualTime.remainingMinutes,
  };
}

export function buildXunpuSimulationTaskInstructionV3(
  input: BuildXunpuSimulationTaskInstructionV3Input,
): string {
  const signal = createXunpuSafeActionSignalV3(input.world, input.event);
  const instruction = `${input.publicCue}${signalMarker}${JSON.stringify(signal)}`;
  if (instruction.length > 1_200) {
    throw new Error("蟳埔安全行动信号超出 AgentObservation 上限");
  }
  return instruction;
}

function isSafeStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => (
    typeof item === "string" && safeIdPattern.test(item)
  ));
}

export function parseXunpuSafeActionSignalV3(
  instruction: string,
): XunpuSafeActionSignalV3 | null {
  const markerIndex = instruction.lastIndexOf(signalMarker);
  if (markerIndex < 0) return null;
  try {
    const candidate = JSON.parse(
      instruction.slice(markerIndex + signalMarker.length),
    ) as Partial<XunpuSafeActionSignalV3>;
    if (candidate.schemaVersion !== XunpuSafeActionSignalSchemaVersion
      || typeof candidate.eventType !== "string"
      || !safeIdPattern.test(candidate.eventType)
      || !["observe", "ask", "probe", "negotiate", "inspect", "compare",
        "draft", "wait", "escalate", "submit", "world_event"].includes(
        candidate.actionVerb ?? "",
      )
      || !["professional", "incomplete", "risky", "not_applicable"].includes(
        candidate.quality ?? "",
      )
      || !isSafeStringArray(candidate.matchedCriteria)
      || !isSafeStringArray(candidate.missingCriteria)
      || !isSafeStringArray(candidate.riskFlags)
      || typeof candidate.evidenceReferenceCount !== "number"
      || !Number.isInteger(candidate.evidenceReferenceCount)
      || candidate.evidenceReferenceCount < 0
      || typeof candidate.remainingMinutes !== "number"
      || !Number.isFinite(candidate.remainingMinutes)
      || !candidate.worldIndicators
      || typeof candidate.worldIndicators !== "object"
      || Object.entries(candidate.worldIndicators).some(([key, value]) => (
        !safeIdPattern.test(key) || typeof value !== "number" || !Number.isFinite(value)
      ))) {
      return null;
    }
    return candidate as XunpuSafeActionSignalV3;
  } catch {
    return null;
  }
}

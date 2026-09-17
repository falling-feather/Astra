import type { XunpuExperienceActV4 } from "./types.js";

/**
 * The five acts are a pacing contract, not a linear wizard. Interview,
 * verification and rights work may be reordered inside an act, but the world
 * must still expose a coherent professional objective and an observable exit.
 */
export const xunpuV4ExperienceActs: XunpuExperienceActV4[] = [
  {
    actId: "act-brief-and-entry",
    title: "接单与进入真实现场",
    startMinute: 0,
    endMinute: 8,
    primaryObjective: "读懂编辑工单，提出公共价值角度，并以记者身份协商现场边界。",
    requiredBeatRefs: ["beat-editorial-brief", "beat-access", "beat-purpose"],
    requiredArtifactRefs: ["artifact-topic-brief"],
    decisionPressure: "先进入现场还是先补齐角度；快速进入不能以隐瞒身份或越界拍摄为代价。",
    completionSignal: "学生形成可解释选题，并取得公共观察、受控引荐或无记录背景沟通中的一种合法入口。",
  },
  {
    actId: "act-interview-and-trust",
    title: "采访、观察与关系建立",
    startMinute: 8,
    endMinute: 20,
    primaryObjective: "在社区主体、技艺观察和商业采访之间取舍，取得可确认引语与现场证据。",
    requiredBeatRefs: ["beat-commercial", "beat-source-conflict"],
    requiredArtifactRefs: ["artifact-interview-plan-log", "artifact-source-matrix"],
    decisionPressure: "深访、技艺画面和现成商业素材不能同时无成本获得；人物会记住承诺和越界。",
    completionSignal: "至少一段关键人物对话达成承诺，采访记录明确个人经验、观察事实与公开来源的边界。",
  },
  {
    actId: "act-conflict-and-verification",
    title: "来源、权利与突发冲突",
    startMinute: 20,
    endMinute: 34,
    primaryObjective: "处理统计等待、素材撤回和群聊传言，区分已知、未知、许可与可发布范围。",
    requiredBeatRefs: ["beat-data-wait", "beat-rights", "beat-rumor"],
    requiredArtifactRefs: ["artifact-fact-check-sheet", "artifact-rights-ledger"],
    decisionPressure: "等待会消耗窗口，限定发布会牺牲吸引力，替换素材会增加制作成本；三者均可能是专业选择。",
    completionSignal: "高风险主张和素材都有证据状态、处理决定与恢复路径，未核信息没有进入正式写入。",
  },
  {
    actId: "act-production-and-gate",
    title: "制作、预检与教师门",
    startMinute: 34,
    endMinute: 48,
    primaryObjective: "把事实、引语、素材、标识和平台适配编成可追溯 R1，并决定提交、补证或暂缓。",
    requiredBeatRefs: ["beat-deadline", "beat-precheck", "beat-publication"],
    requiredArtifactRefs: ["artifact-feature-story", "artifact-multiplatform-package"],
    decisionPressure: "首轮窗口收窄；画面完成度、来源完整度与权利状态可能互相冲突，教师门不会替学生选答案。",
    completionSignal: "作品版本、引用、权利回执和发布理由一致，或学生明确暂缓并说明再次提交条件。",
  },
  {
    actId: "act-consequence-and-transfer",
    title: "传播后果、纠错与迁移",
    startMinute: 48,
    endMinute: 55,
    primaryObjective: "面对社区、权利人、公共联络和平台回应，选择更正、下架重建或有依据维持判断。",
    requiredBeatRefs: ["beat-consequence", "beat-recovery", "beat-transfer"],
    requiredArtifactRefs: ["artifact-publication-correction-decision", "artifact-transfer-reflection"],
    decisionPressure: "承认错误会损失短期触达，维持判断必须公开证据；静默覆盖和归责 AI 均不构成恢复。",
    completionSignal: "版本链和责任说明完整，世界后果被处理或明确保留为未结债务，并形成下一场可执行策略。",
  },
];

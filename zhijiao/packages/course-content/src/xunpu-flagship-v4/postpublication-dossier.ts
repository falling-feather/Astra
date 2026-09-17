import { deepFreeze } from "../canonical.js";
import { xunpuCourseRelease } from "../xunpu-course.js";
import { xunpuV4AddedKnowledgeRecords } from "./knowledge.js";

export interface XunpuPostPublicationSourceRefV4 {
  knowledgeId: string;
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  locator: string;
  sourceVersion: string;
}

export interface XunpuPostPublicationStudentMaterialV4 {
  materialId: string;
  materialKind:
    | "published_video_record"
    | "full_interview_record"
    | "person_scope_note"
    | "platform_receipt"
    | "rights_ledger"
    | "metrics_snapshot"
    | "source_packet";
  title: string;
  publicDescription: string;
  sourceRefs: readonly XunpuPostPublicationSourceRefV4[];
  inspectableFields: readonly string[];
  simulationBoundary: "教学仿真材料，不映射真实个人或真实平台后台";
}

export interface XunpuPostPublicationClaimComparisonV4 {
  comparisonId: string;
  claim: string;
  sourceRefs: readonly XunpuPostPublicationSourceRefV4[];
  supportedWording: string;
  unsupportedExpansion: string;
  studentCheck: string;
}

export interface XunpuPostPublicationConflictV4 {
  conflictId: string;
  title: string;
  description: string;
  competingValues: readonly [string, string];
}

export interface XunpuPostPublicationRouteV4 {
  routeId: string;
  label: string;
  steps: readonly string[];
  tradeoff: string;
}

export interface XunpuPostPublicationScenarioV4 {
  scenarioId: string;
  title: string;
  studentMaterialIds: readonly string[];
  sourceClaimComparisons: readonly XunpuPostPublicationClaimComparisonV4[];
  conflicts: readonly XunpuPostPublicationConflictV4[];
  legalAlternativeRoutes: readonly XunpuPostPublicationRouteV4[];
  workRequirements: readonly string[];
  teacherObservationPoints: readonly string[];
}

export interface XunpuPostPublicationTeacherOnlyNoteV4 {
  scenarioId: string;
  teacherOnlyNotes: readonly string[];
}

export interface XunpuPostPublicationCaseDossierV4 {
  dossierId: "dossier-xunpu-postpublication-context-v1";
  sourcePatternRef: "manifest-xunpu-flagship-v4";
  caseBoundary: "全部人物、采访、平台反馈、数字与结果均为教学仿真";
  studentMaterials: readonly XunpuPostPublicationStudentMaterialV4[];
  scenarios: readonly XunpuPostPublicationScenarioV4[];
  teacherOnlyNotes: readonly XunpuPostPublicationTeacherOnlyNoteV4[];
}

function sourceRef(knowledgeId: string): XunpuPostPublicationSourceRefV4 {
  const contractRecord = xunpuCourseRelease.knowledgeRecords.find((candidate) => (
    candidate.knowledgeId === knowledgeId
  ));
  if (contractRecord) {
    return {
      knowledgeId: contractRecord.knowledgeId,
      sourceId: contractRecord.source.sourceId,
      title: contractRecord.source.title,
      publisher: contractRecord.source.publisher,
      url: contractRecord.source.url,
      locator: contractRecord.source.locator,
      sourceVersion: contractRecord.source.sourceVersion,
    };
  }
  const addedRecord = xunpuV4AddedKnowledgeRecords.find((candidate) => (
    candidate.knowledgeId === knowledgeId
  ));
  if (!addedRecord) throw new Error(`蟳埔发布后 dossier 引用未知知识：${knowledgeId}`);
  return {
    knowledgeId: addedRecord.knowledgeId,
    sourceId: `${addedRecord.knowledgeId}:source`,
    title: addedRecord.sourceTitle,
    publisher: addedRecord.publisher,
    url: addedRecord.url,
    locator: addedRecord.locator,
    sourceVersion: addedRecord.sourceVersion,
  };
}

function material(input: {
  materialId: string;
  materialKind: XunpuPostPublicationStudentMaterialV4["materialKind"];
  title: string;
  publicDescription: string;
  knowledgeIds: readonly string[];
  inspectableFields: readonly string[];
}): XunpuPostPublicationStudentMaterialV4 {
  return {
    materialId: input.materialId,
    materialKind: input.materialKind,
    title: input.title,
    publicDescription: input.publicDescription,
    sourceRefs: input.knowledgeIds.map(sourceRef),
    inspectableFields: [...input.inspectableFields],
    simulationBoundary: "教学仿真材料，不映射真实个人或真实平台后台",
  };
}

export const xunpuV4PostPublicationCaseDossier = deepFreeze({
  dossierId: "dossier-xunpu-postpublication-context-v1",
  sourcePatternRef: "manifest-xunpu-flagship-v4",
  caseBoundary: "全部人物、采访、平台反馈、数字与结果均为教学仿真",
  studentMaterials: [
    material({
      materialId: "xunpu-postpublication-material-published-cut",
      materialKind: "published_video_record",
      title: "首发短视频版本与时间线",
      publicDescription: "仿真首发版本保留一句逐字准确引语，但删去前后社区互助语境；学生可查看片段时间码、标题、字幕和发布时点。",
      knowledgeIds: ["xunpu-k036-source-interview-correction", "xunpu-k023-integrated-production-workflow"],
      inspectableFields: ["版本号", "片段时间码", "标题与字幕", "发布时间", "已公开内容"],
    }),
    material({
      materialId: "xunpu-postpublication-material-full-interview",
      materialKind: "full_interview_record",
      title: "完整采访记录与人物语境说明",
      publicDescription: "仿真完整记录包含引语前后关于劳动、社区互助和个人经验边界的说明；学生可并排标记保留、删减和待确认内容。",
      knowledgeIds: ["xunpu-k036-source-interview-correction", "xunpu-k003-cultural-respect"],
      inspectableFields: ["完整转写定位", "说话人", "前后语境", "个人经验边界", "可公开范围"],
    }),
    material({
      materialId: "xunpu-postpublication-material-platform-feedback",
      materialKind: "platform_receipt",
      title: "平台互动窗口与编辑反馈",
      publicDescription: "仿真平台反馈显示首发后短窗口互动上升，并建议维持高留存片段；该反馈不包含人物授权或完整采访判断。",
      knowledgeIds: ["xunpu-k010-online-reach-attribution", "xunpu-k011-case-evaluation-frame"],
      inspectableFields: ["统计时间窗", "指标定义", "平台建议", "未覆盖的授权与语境字段"],
    }),
    material({
      materialId: "xunpu-postpublication-material-scope-note",
      materialKind: "person_scope_note",
      title: "仿真受访者公开范围意见",
      publicDescription: "仿真受访者同意补回公共语境，但不同意公开家庭、住址或未成年人信息；意见可撤回且不自动覆盖旧版本。",
      knowledgeIds: ["xunpu-k025-portrait-consent", "xunpu-k026-news-use-necessary-scope", "xunpu-k030-consent-withdrawal"],
      inspectableFields: ["同意对象", "用途", "平台", "期限", "撤回入口", "不得公开内容"],
    }),
    material({
      materialId: "xunpu-postpublication-material-rights-ledger",
      materialKind: "rights_ledger",
      title: "近景与声音素材权利台账",
      publicDescription: "仿真台账显示一段近景只有线下展示许可，声音与短视频二次剪辑范围尚未明确；水印和转发链接只作为线索。",
      knowledgeIds: ["xunpu-k027-voice-protection", "xunpu-k031-photo-copyright-permission", "xunpu-k032-watermark-not-license"],
      inspectableFields: ["作者/权利人", "人物许可", "平台", "用途", "期限", "二次剪辑", "回执状态"],
    }),
    material({
      materialId: "xunpu-postpublication-material-cross-platform-receipts",
      materialKind: "platform_receipt",
      title: "三端修订与通知回执",
      publicDescription: "仿真客户端、短视频和直播预告分别返回可追加、需重剪和需版本说明的处理结果；学生可查看每端责任人和下一检查时间。",
      knowledgeIds: ["xunpu-k023-integrated-production-workflow", "xunpu-k024-all-media-job-loop", "xunpu-k033-ai-explicit-label"],
      inspectableFields: ["端别", "版本差异", "通知状态", "平台回执", "下一检查时间"],
    }),
    material({
      materialId: "xunpu-postpublication-material-source-challenge",
      materialKind: "source_packet",
      title: "年份主张与统计时点来源包",
      publicDescription: "仿真来源包把公开名录、地方标准、网络转引和统计时点并列，要求学生区分原始定位、历史材料和当前可确认范围。",
      knowledgeIds: ["xunpu-k018-network-claim-needs-verification", "xunpu-k012-yearly-statistics-not-interchangeable", "xunpu-k036-source-interview-correction"],
      inspectableFields: ["发布主体", "发布日期", "原始定位", "转引关系", "统计时点", "可支持表述"],
    }),
    material({
      materialId: "xunpu-postpublication-material-impact-snapshot",
      materialKind: "metrics_snapshot",
      title: "回应后影响与旧链接传播快照",
      publicDescription: "仿真快照显示修订后短视频播放量下降、客户端阅读完成率上升，旧链接仍有少量扩散；统计窗口和版本不能直接排名。",
      knowledgeIds: ["xunpu-k010-online-reach-attribution", "xunpu-k011-case-evaluation-frame", "xunpu-k012-yearly-statistics-not-interchangeable"],
      inspectableFields: ["版本", "统计窗口", "分母", "触达", "完成率", "反馈类别", "旧链接状态"],
    }),
  ],
  scenarios: [
    {
      scenarioId: "xunpu-postpublication-scenario-context-triage",
      title: "原句准确但语境失真的首发回应",
      studentMaterialIds: [
        "xunpu-postpublication-material-published-cut",
        "xunpu-postpublication-material-full-interview",
        "xunpu-postpublication-material-platform-feedback",
      ],
      sourceClaimComparisons: [
        {
          comparisonId: "comparison-context-quote",
          claim: "首发视频中的引语是否被捏造？",
          sourceRefs: [sourceRef("xunpu-k036-source-interview-correction")],
          supportedWording: "完整采访与首发片段逐字一致；可以说引语准确。",
          unsupportedExpansion: "不能因此说剪辑完整呈现了人物语境或社区共同意见。",
          studentCheck: "并排标记引语前后内容、删减点和人物经验边界。",
        },
        {
          comparisonId: "comparison-context-feedback",
          claim: "互动上涨是否证明首发版本表达成功？",
          sourceRefs: [sourceRef("xunpu-k010-online-reach-attribution"), sourceRef("xunpu-k011-case-evaluation-frame")],
          supportedWording: "互动数据只能说明特定统计窗口中的传播反馈。",
          unsupportedExpansion: "不能把互动量当作语境准确、文化主体认可或人物授权证明。",
          studentCheck: "记录数据窗口、分母和未覆盖的采访/权利字段。",
        },
      ],
      conflicts: [
        {
          conflictId: "conflict-context-vs-retention",
          title: "语境完整与首发留存",
          description: "补回社区互助语境可能降低短视频留存，但维持只展示情绪的剪辑会放大主体缺失。",
          competingValues: ["人物语境与社区主体", "首发时效与短窗口留存"],
        },
        {
          conflictId: "conflict-quote-accuracy-vs-framing",
          title: "逐字准确与整体 framing",
          description: "原句准确不自动消除剪辑选择造成的误导风险，回应必须保留这两个判断。",
          competingValues: ["不虚构事实错误", "不掩盖语境失真"],
        },
      ],
      legalAlternativeRoutes: [
        {
          routeId: "route-context-note",
          label: "补充语境说明并保留原版",
          steps: ["保留首发版本", "补回完整采访定位", "公开说明删减与补充原因", "通知受访者并开放反馈"],
          tradeoff: "版本责任透明，但需要占用编辑和平台更新窗口。",
        },
        {
          routeId: "route-context-recut",
          label: "重剪并同步差异表",
          steps: ["标记原剪辑问题", "恢复必要语境", "生成新版本", "向各平台提交差异与检查时间"],
          tradeoff: "语境更完整，但短期触达和制作时效可能下降。",
        },
        {
          routeId: "route-context-maintain",
          label: "有依据维持并公开回应",
          steps: ["核对完整采访", "说明为何事实与语境均可接受", "保留人物反馈", "设置后续复核入口"],
          tradeoff: "避免不必要改写，但需要承担更高的公开解释责任。",
        },
      ],
      workRequirements: [
        "首发版本与完整采访逐段对照表",
        "事实错误、语境失真、权利与平台反馈四类判断",
        "回应路径、人物通知、版本责任和下一次检查时间",
      ],
      teacherObservationPoints: [
        "学生是否保留原句准确与语境失真的双重判断",
        "学生是否把互动数据与事实/主体认可分开",
        "学生是否保留不同合理回应而非追求唯一话术",
      ],
    },
    {
      scenarioId: "xunpu-postpublication-scenario-withdrawal",
      title: "近景与声音范围变化后的跨平台修订",
      studentMaterialIds: [
        "xunpu-postpublication-material-scope-note",
        "xunpu-postpublication-material-rights-ledger",
        "xunpu-postpublication-material-cross-platform-receipts",
      ],
      sourceClaimComparisons: [
        {
          comparisonId: "comparison-withdrawal-scope",
          claim: "人物同意采访是否等于同意所有平台和二次剪辑？",
          sourceRefs: [sourceRef("xunpu-k025-portrait-consent"), sourceRef("xunpu-k030-consent-withdrawal")],
          supportedWording: "同意应结合具体用途、平台、期限和可撤回范围记录。",
          unsupportedExpansion: "不能把一次口头同意扩张成所有近景、声音和跨平台二次使用。",
          studentCheck: "逐项填写人物、素材、平台、用途、期限和撤回状态。",
        },
        {
          comparisonId: "comparison-watermark-permission",
          claim: "素材上的水印或转发链接是否足以公开使用？",
          sourceRefs: [sourceRef("xunpu-k031-photo-copyright-permission"), sourceRef("xunpu-k032-watermark-not-license")],
          supportedWording: "水印和链接可作为线索，权利人与许可范围仍需核验。",
          unsupportedExpansion: "不能用水印替代作者、人物、平台和二次剪辑许可。",
          studentCheck: "决定限用、替换、重新协商或停止公开，并保留回执。",
        },
      ],
      conflicts: [
        {
          conflictId: "conflict-scope-vs-completeness",
          title: "人物撤回与作品完整度",
          description: "撤回近景或声音会降低成片完整度，但继续公开会越过具体授权范围。",
          competingValues: ["人物自主与权利范围", "作品完整度与传播效果"],
        },
        {
          conflictId: "conflict-platform-vs-person",
          title: "平台可用与人物许可",
          description: "平台允许上传不等于人物或摄影作品已授权；跨平台版本必须分别核对。",
          competingValues: ["渠道交付与时效", "人物许可与版本责任"],
        },
      ],
      legalAlternativeRoutes: [
        {
          routeId: "route-withdrawal-replace",
          label: "替换近景并保留版本说明",
          steps: ["停止受影响版本继续扩散", "选择有范围回执的替代镜头", "更新三端差异表", "通知人物并记录检查时间"],
          tradeoff: "权利风险较低，但画面连贯性和制作时间会受影响。",
        },
        {
          routeId: "route-withdrawal-limit",
          label: "限用途或限平台重新协商",
          steps: ["列出原许可与现用途差异", "取得具体范围回执", "仅保留被允许的平台版本", "设置到期与撤回检查"],
          tradeoff: "可保留部分素材价值，但传播范围和维护成本更复杂。",
        },
        {
          routeId: "route-withdrawal-takedown",
          label: "下架并重新建立权利链",
          steps: ["阻断受影响版本", "保留旧版本和撤回记录", "重新协商人物与作品权利", "经教师门后重新发布"],
          tradeoff: "最能控制不可逆风险，但会损失当前窗口和已有触达。",
        },
      ],
      workRequirements: [
        "人物与摄影作品权利分开登记",
        "受影响版本、传播渠道和撤回时间可回指",
        "替换/限用/下架路径与人物通知回执完整",
      ],
      teacherObservationPoints: [
        "学生是否把人物肖像、声音和摄影作品权利分开",
        "学生是否把平台可上传与人物可公开范围分开",
        "学生是否保留撤回前版本而不静默覆盖",
      ],
    },
    {
      scenarioId: "xunpu-postpublication-scenario-source-and-impact",
      title: "来源挑战、平台压力与回应后影响",
      studentMaterialIds: [
        "xunpu-postpublication-material-source-challenge",
        "xunpu-postpublication-material-impact-snapshot",
        "xunpu-postpublication-material-cross-platform-receipts",
      ],
      sourceClaimComparisons: [
        {
          comparisonId: "comparison-source-chain",
          claim: "网络转引和历史材料能否直接支撑当前标题？",
          sourceRefs: [sourceRef("xunpu-k018-network-claim-needs-verification"), sourceRef("xunpu-k036-source-interview-correction")],
          supportedWording: "网络线索需回到原始来源、相关方采访和多方核实。",
          unsupportedExpansion: "不能把转引、热搜或模型回答当作当前事实确认。",
          studentCheck: "记录发布主体、日期、原始定位和主张边界。",
        },
        {
          comparisonId: "comparison-impact-window",
          claim: "修订后播放量下降是否说明回应失败？",
          sourceRefs: [sourceRef("xunpu-k010-online-reach-attribution"), sourceRef("xunpu-k012-yearly-statistics-not-interchangeable")],
          supportedWording: "影响结论必须带版本、时间窗、分母和指标定义。",
          unsupportedExpansion: "不能用单一播放量宣称事实、语境或职业能力成功。",
          studentCheck: "分开解释触达、完成率、人物反馈、旧链接和更正负担。",
        },
      ],
      conflicts: [
        {
          conflictId: "conflict-source-vs-speed",
          title: "来源完整与回应时效",
          description: "补齐原始定位和历史时点可能错过平台窗口，但未经核实的标题会扩大更正成本。",
          competingValues: ["来源链完整与可复核", "回应速度与即时触达"],
        },
        {
          conflictId: "conflict-impact-vs-quality",
          title: "传播指标与语境质量",
          description: "修订版本可能降低短期播放却改善人物反馈；复盘需保留这类不可化约的取舍。",
          competingValues: ["传播影响与可见触达", "语境完整与长期信任"],
        },
      ],
      legalAlternativeRoutes: [
        {
          routeId: "route-source-note",
          label: "公开来源清单并维持限定表述",
          steps: ["补充原始定位", "删除超出证据的绝对化词", "保留版本差异", "设置后续来源复核时间"],
          tradeoff: "事实边界最透明，但标题和传播吸引力可能下降。",
        },
        {
          routeId: "route-source-correction",
          label: "公开更正并同步旧链接处置",
          steps: ["保留旧版本", "说明错误或过度扩张部分", "跨平台同步修订", "通知受影响主体并跟踪旧链接"],
          tradeoff: "责任链清楚，但需要持续维护多个渠道和回应窗口。",
        },
        {
          routeId: "route-source-hold",
          label: "暂缓公开并等待必要核验",
          steps: ["标记已知与未知", "记录下一更新时间", "并行准备限定版本", "核验完成后重新决定发布"],
          tradeoff: "降低误导风险，但会承担窗口、资源和公共信息延迟成本。",
        },
      ],
      workRequirements: [
        "来源/主张对照表含原始定位、时点和不可支持扩张",
        "修订前后版本、平台回执、旧链接和人物反馈可追溯",
        "按指标口径解释回应影响并提出下一轮验证假设",
      ],
      teacherObservationPoints: [
        "学生是否能把传播指标与来源、语境、权利判断分开",
        "学生是否在速度压力下保留已知/未知和下一更新时间",
        "学生是否能说明合法替代路径的机会成本而非寻找唯一答案",
      ],
    },
  ],
  teacherOnlyNotes: [
    {
      scenarioId: "xunpu-postpublication-scenario-context-triage",
      teacherOnlyNotes: [
        "不要提前告诉学生引语逐字准确；观察其是否主动完成完整采访与首发版本对照。",
        "若学生把互动数据当语境证据，教师只追问统计窗口和缺失字段，不直接给出结论。",
      ],
    },
    {
      scenarioId: "xunpu-postpublication-scenario-withdrawal",
      teacherOnlyNotes: [
        "教师观察人物授权、摄影作品许可、声音范围和跨平台版本是否被分开记录。",
        "任何下架或替换路径都应保留撤回前版本，不以安全结局抹去初始判断。",
      ],
    },
    {
      scenarioId: "xunpu-postpublication-scenario-source-and-impact",
      teacherOnlyNotes: [
        "教师复核学生是否能同时承认修订后的传播下降与语境质量改善，不用单一指标裁决。",
        "真实专业效果与教学仿真结果分开记录；本 dossier 不生成外部教学效果结论。",
      ],
    },
  ],
}) satisfies XunpuPostPublicationCaseDossierV4;

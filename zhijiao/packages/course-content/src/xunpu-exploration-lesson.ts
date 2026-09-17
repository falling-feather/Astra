import { deepFreeze, hashCanonical } from "./canonical.js";
import { CharacterWorkflowV3Schema, FieldWorkPlanV3Schema, type FieldWorkPlanV3, type CharacterWorkflowV3, type CharacterBlueprintV3 } from "@ronggang/contracts";

export interface ExplorationTopic {
  id: string; title: string; keywords: string[]; response: string; materialIds: string[];
}
export interface ExplorationPerson {
  id: string; name: string; role: string; nodeId: string;
  activity: string; goal: string; unknown: string; greeting: string; clarification: string;
  topics: ExplorationTopic[]; requiresFlag: string | null; remoteContact: boolean;
  onSiteUntilMinute?: number | null;
  appearance?: CharacterBlueprintV3["appearance"];
  social?: { supportsContact: boolean; initialTrust: number; contactThreshold: number; referralThreshold: number; referralTargets: string[]; refusal: string };
  personality?: string;
  workflow?: CharacterWorkflowV3;
}
export interface ExplorationChoice {
  id: string; npcId: string; label: string; keywords: string[]; response: string;
  requires: string[]; excludes: string[]; minutes: number;
  effect: "flag" | "appointment" | "promise" | "remind" | "absence";
  flags: string[]; materialIds: string[]; delayMinutes: number; targetNpcId: string | null;
  exclusiveGroup: string | null;
}
export interface ExplorationMaterial {
  id: string; title: string; nodeId: string | null; kind: "public_source" | "simulation";
  description: string; body: string; sourceUrl: string | null; locator: string;
  knowledgeRefs: string[]; requires: string[];
  evidenceStatus?: "public_source" | "scenario_record" | "unverified_claim" | "reference_guide" | "case_example";
}
export interface ExplorationLesson {
  lessonId: string; version: string; contentHash: string; title: string; assignment: string;
  initialNodeId: string;
  nodes: Array<{ id: string; title: string; description: string; requiresFlag: string | null; travelMinutes: number;
    image?: string; imageAtlas?: { columns: number; rows: number; index: number }; map?: { x: number; y: number }; exits?: Array<{ targetId: string; x: number; y: number }>; lockedHint?: string }>;
  people: ExplorationPerson[]; choices: ExplorationChoice[]; materials: ExplorationMaterial[];
  bystanders: Array<{ id: string; name: string; nodeId: string; activity: string; response: string }>;
  strategies: Array<{ id: string; title: string; question: string; materialIds: string[]; evidenceNpcIds: string[]; flag: string | null }>;
  region?: { id: string; title: string };
  socialLearning?: boolean;
  workPlan?: FieldWorkPlanV3;
  mediaAssets?: Array<{assetId:string;title:string;publicPath:string;contentHash:string;sourceFactBoundary:string}>;
  adaptedFromLessonHash?:string;
}

const ALLEY = "loc-oyster-alley-gate", COURT = "loc-community-courtyard", SERVICE = "loc-waterfront-service-point";
const WORKSHOP = "loc-zanhuawei-workshop", SHOP = "loc-merchant-storefront", MOBILE = "loc-mobile-edit-bay", DESK = "loc-newsroom-desk";
const LIN = "entity-gatekeeper", AHUAN = "entity-community-source", HUANG = "entity-inheritor", CHEN = "entity-researcher";
const WU = "entity-shopkeeper", CAI = "entity-public-liaison", XU = "entity-rights-contact", ZHOU = "entity-tourist";
const EDITOR = "entity-editor", QIAO = "entity-platform-duty";
const STANDARD = "https://scjgj.quanzhou.gov.cn/xxgk/zfxxgk/fdzdgknr/ywgz/202407/P020240722394947013233.pdf";
const topic = (id: string, title: string, keywords: string[], response: string, ...materialIds: string[]): ExplorationTopic => ({ id, title, keywords, response, materialIds });
function person(id: string, name: string, role: string, nodeId: string, activity: string, goal: string, unknown: string, greeting: string, clarification: string, topics: ExplorationTopic[], requiresFlag: string | null = null): ExplorationPerson {
  return { id, name, role, nodeId, activity, goal, unknown, greeting, clarification, topics, requiresFlag, remoteContact: id !== AHUAN };
}
function choice(id: string, npcId: string, label: string, keywords: string[], response: string, options: Partial<Omit<ExplorationChoice, "id" | "npcId" | "label" | "keywords" | "response">> = {}): ExplorationChoice {
  return { id, npcId, label, keywords, response, requires: [], excludes: [], minutes: 1, effect: "flag", flags: [], materialIds: [], delayMinutes: 0, targetNpcId: null, exclusiveGroup: null, ...options };
}

const draft: Omit<ExplorationLesson, "contentHash"> = {
  lessonId: "xunpu-open-interview", version: "1.2.0", title: "簪花之外：一次社区采编委托",
  assignment: "发现一个值得报道的社区问题。你可以从生活、技艺、经营或公共服务切入，采访、核验并用自己的材料完成报道。",
  initialNodeId: ALLEY,
  bystanders: [
    { id: "entity-passing-worker", name: "搬运中的工作人员", nodeId: ALLEY, activity: "正忙着把物品搬进去", response: "对不起，我这会儿手上腾不开。想问路可以看看旁边的公示栏，或者问问林师傅。" },
    { id: "entity-hurried-visitor", name: "赶路的游客", nodeId: SHOP, activity: "正赶着去下一处", response: "不好意思，我现在赶时间。你可以问问旁边那位游客，她可能方便聊。" },
  ],
  nodes: [
    { id: ALLEY, title: "巷口", description: "公示栏、来往行人和院门都可以成为线索。先看哪里，由你决定。", requiresFlag: null, travelMinutes: 1 },
    { id: COURT, title: "居民小院", description: "这里仍是住户生活的地方。进入、交谈和录制分别征求同意。", requiresFlag: "courtyard-access", travelMinutes: 1 },
    { id: SERVICE, title: "资料联络点", description: "查看公开资料，向蔡主任询问信息时点，或用手机约研究者。", requiresFlag: null, travelMinutes: 1 },
    { id: WORKSHOP, title: "簪花工坊", description: "黄老师正在安排教学。可先发消息问观摩时间，不必通过巷口引荐。", requiresFlag: "workshop-invited", travelMinutes: 2 },
    { id: SHOP, title: "沿街店铺", description: "公开营业的店铺。可以了解服务、采访经营者，也可以谢绝素材合作。", requiresFlag: null, travelMinutes: 1 },
    { id: MOBILE, title: "移动编辑台", description: "随时停下来整理线索、比较来源和调整选题。", requiresFlag: null, travelMinutes: 0 },
    { id: DESK, title: "编辑部", description: "与编辑商量报道和发布，保留你自己的取舍及版本。", requiresFlag: null, travelMinutes: 1 },
  ],
  people: [
    person(LIN, "林师傅", "现场秩序协调者", ALLEY, "留意巷口进出，等工坊来取两箱体验材料", "让正常采访与住户生活都能顺利进行", "不了解技艺起源，也不能代居民同意录制。", "你好。是来逛逛，还是想找人聊聊？", "你想先看看公共区域，还是希望我替你问问有没有居民方便交谈？", [
      topic("lin-directions", "公共区域怎么走", ["哪里", "去哪", "问路", "公示", "看看", "观察", "附近"], "旁边是公示栏，沿街店铺和资料联络点也对外开放。里面的小院还有人生活，先别直接进去。", "material-notice-board"),
      topic("lin-daily", "巷口平时在忙什么", ["日常", "平时", "工作", "忙什么", "生活"], "我一边给游客指路，一边得给来取材料的人留出通道。阿环在小院整理今天体验活动用的两箱材料。来拍照的人想停一停，赶着办事的人想过得去，这都是这条巷子里眼前的事。", "material-public-observation"),
      topic("lin-purpose", "还没确定采访选题", ["选题", "想法", "实习", "记者", "学校", "采访", "报道"], "还没想好也正常。你可以先看公示，再听听游客和商户的说法。如果想找居民，我可以帮你问，但愿不愿意聊由她自己决定。"),
      topic("lin-boundary", "遇到不愿被记录的人怎么办", ["怎样拒绝", "拒绝这种做法", "拒绝偷拍", "不同意拍摄", "拒绝拍摄", "怎么尊重", "记录边界"], "有人不愿意，就先停下录制，说明你是谁、想怎么用，再问她愿意公开到什么范围。我只能协调见面，不能替她答应。你也可以用文字或不识别人物的公共环境画面，别拿引荐当成拍脸的许可。"),
    ]),
    person(AHUAN, "阿环", "社区受访者", COURT, "按清单分装体验材料，稍后要离开一会儿", "希望报道也看见日常劳动，而不只是一张造型照片", "只能讲自己的经历，不代表整个社区。", "你好，你就是林师傅刚才说的同学吧？我手上还有点活，可以边做边聊。", "你更想了解我一天怎么安排，还是游客来以后有什么变化？", [
      topic("ahuan-daily", "日常劳动与安排", ["一天", "日常", "平时", "忙", "劳动", "生活", "故事"], "我正在核今天的材料，一共准备12份，分成两箱，每箱6份。花篮好看，点数、分装这些事却不怎么上镜。12份是准备量，不能就说已经来了12个人。要写我的生活，也把这些忙碌放进去吧。", "material-resident-account"),
      topic("ahuan-tourism", "游客带来的变化", ["游客", "变化", "影响", "生意", "拍照"], "有人来，大家有了更多交流和做生意的机会。可刚才我还在核材料，就有人问能不能先放下东西站好拍一张。我不是不欢迎人来，只希望别人先问问我现在方不方便。你也听听游客和商户怎么想。", "material-resident-account"),
      topic("ahuan-quote", "核对引语的语境", ["意思", "原话", "引用", "核对", "语境", "不喜欢", "完整"], "我不是说不欢迎游客。我在意的是，报道能不能把‘欢迎交流’和‘正在生活’这两件事都保留下来。请把这层意思放在那句话附近。", "material-full-interview"),
    ], "resident-introduced"),
    person(HUANG, "黄老师", "簪花技艺教学者", WORKSHOP, "准备下一轮示范，检查学员使用的工具", "让学生看懂过程，也别耽误学员练习", "工序经验不能自动证明历史起源或名录层级。", "你好，今天想看制作过程，还是问问我怎么带学员？", "可以选一个细节问：准备、盘发、装饰，或者学员练习。", [
      topic("huang-process", "看懂技艺过程", ["步骤", "工序", "过程", "怎么做", "盘发", "工具", "技艺"], "先别急着只拍完成的造型。可以沿材料准备、盘发、装饰、成型去观察，再用地方标准核对名称。镜头最好说明一个动作为什么放在前后两步之间。", "material-craft-process", "material-local-standard"),
      topic("huang-teaching", "学员怎样学习", ["学员", "教学", "传承", "学习", "练习"], "今天准备了12个体验位，但这只是计划，还没有统计实际到场人数。我先示范一个完整步骤，再让学员做一次、改一次。你若只拍完成的样子，就看不到他们在哪一步需要反复练习。", "material-workshop-notes"),
      topic("huang-context", "日常与展示有什么区别", ["日常", "节日", "展示", "摆拍", "区别"], "地方标准对不同使用语境有说明，不能把一种展示造型当成唯一日常样式。具体到一个人的选择，还是请她自己解释。", "material-local-standard"),
    ]),
    person(CHEN, "陈老师", "非遗研究者", SERVICE, "处理另一项工作，可先通过手机约时间", "帮助记者分清材料能证明什么", "没有调查过的现状不作定论，不替任何来源兜底。", "你好。我可以帮你辨析一个具体问题，你现在手上有什么材料？", "把想核实的那句话、来源和日期发给我，会比一个很大的‘讲讲文化’更容易讨论。", [
      topic("chen-evidence", "原文与转引怎么比较", ["来源", "原文", "证据", "名录", "国家级", "标准", "年份", "起源"], "先把‘习俗项目的名录身份’和‘具体技艺的描述’分开。每个判断回到它自己的原文；转引说得再肯定，也不替原始出处增加证据。", "material-local-standard", "material-conflicting-claim"),
      topic("chen-scope", "研究者能确认的范围", ["保证", "确定", "证明", "权威", "所有", "真实"], "我可以说明判断的方法，但不能凭一次谈话证明整个社区的现状。需要问当事人的问题，请保留他们的个人视角。", "material-source-method"),
      topic("chen-alternative", "资料未到时怎么办", ["没收到", "替代", "自己查", "来不及", "等待", "怎么办"], "你可以先打开原文核对能确认的部分，把还缺的材料单独记下。不必为了等我一封邮件停下全部采访，也不要替空缺编一个答案。", "material-source-method"),
    ]),
    person(WU, "吴姐", "沿街商户", SHOP, "给下一位顾客说明服务，整理可展示的样片", "希望手艺和经营被认真呈现，也希望有人关注店铺", "只了解自己的经营，样片涉及的作者与人物还要另核。", "你好，要了解服务，还是做采访？我现在能抽一点时间。", "你想问顾客需求、经营变化，还是我们提供的样片？", [
      topic("wu-business", "经营者的一天", ["经营", "生意", "一天", "顾客", "游客", "服务", "变化"], "今天预约表上有3组，两组已经结束，还有一组待到店确认。有人只想体验造型，有人还要摄影，不能把所有来问的人都算成买了套餐。你可以先看服务说明，再问问顾客实际想要什么。", "material-shop-service"),
      topic("wu-offer", "好看的样片从哪来", ["素材", "样片", "视频", "高清", "照片", "合作"], "我可以让你看两个样片镜头：一个是在店里整理造型，一个是公共街区的远景。我希望报道能留个店名。不过拍摄者只答应给店里展示，记者转发、人物公开范围还没谈过。你可以先核清，也可以只采访、不用片子。", "material-commercial-offer"),
      topic("wu-position", "不使用素材仍可采访", ["观点", "采访", "看法", "独立", "不使用", "不接受"], "不用样片也可以谈。你可以把我作为经营者来采访，说明我自己的立场；我不要求你把我的话当成所有人的结论。", "material-shop-service"),
    ]),
    person(CAI, "蔡主任", "公共信息联络员", SERVICE, "核对咨询记录和手中的公告版本", "让信息准确并且能帮助实际使用者", "不能用旧公告证明今天的全部情况，也不能代表其他部门承诺。", "你好，你是想查一份公告，还是反映观察到的具体问题？", "先说清哪条信息、哪一天、什么范围，我看看能给你核到哪一层。", [
      topic("cai-notice", "核对公告版本", ["公告", "公示", "日期", "版本", "开放", "封闭", "更新"], "这张指引是活动公共信息联络组发的，写清了公共区域和住户空间，却漏了现场咨询的结束时点。我正在核值班安排，确认后补一份回执。先别把“现场咨询结束”写成“整个街区关闭”。", "material-service-update"),
      topic("cai-transport", "公共服务和交通", ["交通", "公交", "出行", "路线", "停车", "方便", "服务"], "游客好找、居民好用和运行成本不一定总是同一个问题。可以先读公开答复，再分别询问使用者。具体到当前班次，还需向实际服务渠道确认。", "material-public-service"),
      topic("cai-statistics", "数字适用于哪个时点", ["人数", "数字", "统计", "流量", "多少", "数据"], "请把‘一次观察’‘报道截至当时’和‘全年统计’分开。我不能给你一个未经确认的实时总数；可以把已知范围写清，缺的部分继续核实。", "material-dated-report"),
    ]),
    person(XU, "许老师", "素材权利联络人", MOBILE, "核对文件提供者和对应的使用说明", "让署名与约定的使用范围真正落实", "不能因为有水印或有人转发，就替全部权利作保证。", "你好，先把具体文件和打算怎么使用告诉我。", "这是你自己采集的，还是别人提供的？准备在哪些平台呈现？", [
      topic("xu-license", "核对具体使用范围", ["作者", "授权", "许可", "范围", "平台", "期限", "水印"], "应围绕这个文件核对提供者、作者、人物与约定用途。水印只是线索，不是完整许可。本课的材料说明可以帮你列出仍待确认的项。", "material-license-note"),
      topic("xu-alternative", "选择替代素材", ["替代", "不用", "重拍", "环境", "匿名", "遮挡"], "可以不用那份素材，改采环境或重新协商记录方式。替代也要服务于报道，不要只为了省事删掉所有能说明问题的内容。", "material-alternative-shots"),
      topic("xu-revision", "使用范围变化后修订", ["撤回", "变更", "修订", "删除", "更正", "声音"], "先定位哪些版本用了相关画面或声音，再按本次约定处理。保存旧版、修改理由和通知记录，避免一个平台改了，另一个还在传播。", "material-revision-receipts"),
    ]),
    person(ZHOU, "周女士", "游客受访者", SHOP, "准备继续逛街，也想弄清去下一处的路线", "希望体验被准确讲述，不被一句话代表全部游客", "一次旅行经验不能代表整体服务质量或社区意见。", "你好，我一会儿要继续走，可以简单聊两句。", "你想听这次出行的体验，还是想确认镜头里可以留下什么？", [
      topic("zhou-service", "这次出行的体验", ["体验", "出行", "指引", "问路", "服务", "方便", "游客"], "我和朋友只是想看看工坊的示范，还没有买摄影套餐。刚才看见店外的造型照片，我一度以为参观也得先消费，所以来问路。这是我这一次的理解，不一定是别人也遇到的问题。", "material-tourist-account"),
      topic("zhou-image", "镜头与个人表达", ["拍", "镜头", "照片", "声音", "肖像", "记录"], "我可以讲讲刚才的经历，但这次不想把自己的近景放进成片。你可以记文字、拍环境，准备引用哪一句再让我看看。我一会儿还要和朋友会合。", "material-alternative-shots"),
      topic("zhou-context", "核对本人的观点", ["意思", "原话", "引用", "确认", "全部", "感受"], "请保留‘我这一次’这个前提。我的感受是线索，你还需要别的证据来支持更大的判断。", "material-tourist-account"),
    ]),
    person(EDITOR, "陈编辑", "责任编辑", DESK, "安排本次报道并查看学生交来的线索", "有价值、可核验、按时交付，也让实习记者独立作决定", "没有采集到的引语和数据不能替学生生成。", "到了现场了？先找一个你真想弄明白的问题，不必照着别人走。", "可以从生活、技艺、经营或公共服务选一个切口。你现在发现了什么？", [
      topic("editor-angle", "还没有好选题", ["选题", "不知道", "没想好", "写什么", "方向", "角度"], "先把一个具体的人、现象或疑问记下来，再问它对读者有什么用。可以先看公示栏，或分别短访游客与经营者。你不需要一进门就交出完整标题。", "material-editor-brief"),
      topic("editor-deadline", "材料不足怎样交付", ["来不及", "时间", "截止", "不够", "缺", "失约", "没收到"], "先区分哪些内容已有证据。可以缩小题目、做带时点的限定说明，也可以提出延后深入稿的理由。不要把缺口补成确定事实。", "material-editor-brief"),
      topic("editor-review", "怎样解释编辑选择", ["标题", "判断", "独立", "稿", "修订", "建议"], "让我看到你实际选了哪些材料、舍弃什么、为什么。只要证据与表达相称，不同报道策略都可能成立。你仍要自己写出作品。", "material-source-method"),
    ]),
    person(QIAO, "乔安", "融媒体平台值守", DESK, "检查待发版本与发布后的反馈", "按时发布，也让内容问题能被定位和处理", "不能预言真实播放量，也不能用平台热度替代事实。", "你好，想讨论发布形式，还是处理已经收到的反馈？", "具体到哪一个版本、哪段内容？我先和你核对这个。", [
      topic("qiao-format", "选择传播形式", ["平台", "形式", "短视频", "图文", "受众", "发布"], "先看读者需要知道什么，再选图文或视频的表达。标题不能比证据更肯定；不同平台的版本也要能追到同一份材料。", "material-platform-brief"),
      topic("qiao-feedback", "原话准确但语境被误解", ["反馈", "质疑", "语境", "误解", "断章", "评论"], "先回看完整记录。可能是事实错了，也可能是剪辑省掉了必要语境。补说明、重剪或有依据地维持判断，都需要说明原因。", "material-context-feedback", "material-full-interview"),
      topic("qiao-correction", "保留修订与通知", ["更正", "修订", "旧版", "通知", "更新", "撤回"], "请标明改了哪一处、为什么改、哪些平台需要同步。保留旧版不意味着继续传播已确认有问题的版本。", "material-revision-receipts"),
    ]),
  ],
  choices: [
    choice("lin-public-edge", LIN, "协商只在小院公共边缘观察", ["只在公共", "公共边缘", "不进入住户", "只观察小院"], "可以在约好的公共边缘观察，不进入住户内部。这不等于居民已经同意采访。", { flags: ["courtyard-access", "public-observation-agreed"] }),
    choice("lin-introduction", LIN, "请林师傅联系愿意交谈的居民", ["引荐", "介绍居民", "联系居民", "找居民", "帮我问"], "我替你问过了，阿环愿意先听你的问题。你可以去小院找她，录制和公开范围还要与她本人确认。", { flags: ["courtyard-access", "resident-introduced"] }),
    choice("huang-invitation", HUANG, "预约工坊观摩", ["观摩", "参观工坊", "看教学", "去工坊", "预约"], "可以过来观摩这一轮。拍学员前先单独问，来不及长谈的话，我们先看一个完整步骤。", { flags: ["workshop-invited"] }),
    choice("chen-appointment", CHEN, "约五分钟后在资料点见面", ["预约", "约时间", "几点", "见面", "什么时候方便"], "我五分钟后到资料联络点，能留六分钟。你可以先去调查，到点我会给你消息；临时改计划也告诉我。", { effect: "appointment", targetNpcId: CHEN, delayMinutes: 5, flags: ["expert-appointment"] }),
    choice("chen-cancel", CHEN, "取消约见并改用公开资料", ["取消预约", "取消见面", "不等了"], "好的，这次约见取消。你可以用已取得的原文核验，并记下仍有疑问的地方。", { requires: ["expert-appointment"], flags: ["expert-cancelled"], materialIds: ["material-source-method"] }),
    choice("chen-mail", CHEN, "请陈老师稍后发送资料", ["发邮件", "发到邮箱", "发送资料", "资料发给", "把资料发", "寄给"], "我答应五分钟内把资料说明发到你的工作邮箱。你先继续采访；收到以后请核对原文和使用范围。", { effect: "promise", delayMinutes: 5, materialIds: ["material-expert-mail"] }),
    choice("chen-remind", CHEN, "催办尚未收到的邮件", ["催办", "催一下", "还没收到", "没有收到", "忘记发", "提醒您"], "抱歉，刚才被别的事打断，确实还没有发。我这就补发，两分钟内到；你也可以继续自行查证。", { effect: "remind", delayMinutes: 2, requires: ["expert-mail-overdue"], excludes: ["expert-mail-reminded"], flags: ["expert-mail-reminded"] }),
    choice("ahuan-scope", AHUAN, "约定以文字和环境画面记录", ["文字记录", "匿名", "不拍近景", "不拍你的脸", "只记文字"], "可以先按这个方式记。准备公开引用的原话，再让我核对上下文。", { flags: ["resident-text-scope"], materialIds: ["material-resident-consent"] }),
    choice("ahuan-story", AHUAN, "继续追问具体经历", ["具体经历", "讲个例子", "一次经历", "能举个例", "最近一次"], "刚才我核第二箱材料，数到一半被喊去拍照，回来只好重新核。不是多大矛盾，但前后要花时间。对了，我一会儿得去处理件事，没聊完可以约着继续。", { requires: ["resident-introduced"], effect: "absence", targetNpcId: AHUAN, delayMinutes: 6, materialIds: ["material-resident-account"], flags: ["resident-story-heard"], excludes: ["resident-story-heard"], minutes: 2 }),
    choice("ahuan-followup", AHUAN, "留言约好回来后继续采访", ["回来再聊", "回来继续", "等你回来", "约好继续", "续访"], "好，我回来给你发消息。刚才没问完的问题保留着，不用从头再说。", { requires: ["resident-story-heard"], flags: ["resident-followup"] }),
    choice("wu-limited", WU, "核清范围并披露后有限使用", ["限定许可", "有限使用", "披露合作", "说明提供关系"], "可以，我们按确认的范围谈。作品角度由你决定；你还需要核对作者、人物与平台用途。", { flags: ["commercial-limited-use"], materialIds: ["material-commercial-offer", "material-license-note"], minutes: 2 }),
    choice("wu-self-shoot", WU, "样片只作线索，自己采集", ["自行拍", "自己采集", "自己拍", "只作线索", "不复制"], "明白，你自己采集。我可以解释这份样片拍的是什么，但不会把它当成你已经拿到的素材许可。", { flags: ["commercial-self-shoot"], materialIds: ["material-alternative-shots"] }),
    choice("wu-interview-only", WU, "谢绝样片，只采访经营观点", ["拒绝素材", "谢绝样片", "只采访", "不用样片"], "可以，只谈我的经营看法。你也去找其他人核对，不必为了拿片子接受我希望的标题。", { flags: ["commercial-interview-only"], materialIds: ["material-shop-service"] }),
    choice("zhou-no-closeup", ZHOU, "尊重拒绝，改用不识别个人的画面", ["不拍近景", "环境画面", "接受拒绝", "替代镜头"], "谢谢理解。可以记录我这次的体验，公开引语前再确认，近景这次就不使用。", { flags: ["alternative-framing"], materialIds: ["material-alternative-shots"] }),
    choice("qiao-context", QIAO, "补充语境并解释修订", ["补充语境", "重新剪辑", "补充说明", "重剪"], "保留原记录和修订说明，把缺少的上下文补上，再检查各平台版本。", { flags: ["context-revised"], materialIds: ["material-revision-receipts"] }),
    choice("qiao-maintain", QIAO, "依据原记录维持判断并回应", ["维持判断", "公开依据", "说明证据", "保留判断"], "可以，但要清楚指出支持这项判断的记录，也让不同意见有准确的呈现。我们保留你这次解释供复核。", { flags: ["context-maintained"], materialIds: ["material-context-feedback"] }),
    choice("qiao-hold", QIAO, "暂缓有争议的片段，继续核验", ["暂缓", "先不发布", "继续核验", "等待确认"], "先把争议片段从这次待发版本中单独标出，保留你决定暂缓的理由和下一步核验。", { flags: ["context-held"], materialIds: ["material-context-feedback"] }),
  ],
  materials: [
    { id: "material-notice-board", title: "巷口公示栏", nodeId: ALLEY, kind: "simulation", description: "一个可先观察的公共入口", body: "社区文化体验活动 · 现场指引 v1\n发布方：活动公共信息联络组\n适用范围：本次模拟采访场次\n沿街店铺与资料联络点可公开咨询；居民小院须先协商进入范围。工坊正在筹备一轮体验示范，可通过工作手机联系黄老师。\n联络方式：工作手机 → 蔡主任。\n待核事项：纸面指引没有写明现场咨询的结束时点，请向联络员确认。", sourceUrl: null, locator: "本课仿真公告v1；不是现实通行规定", knowledgeRefs: ["xunpu-k016-interview-consent-and-custom"], requires: [] },
    { id: "material-public-observation", title: "公共环境观察提示", nodeId: ALLEY, kind: "simulation", description: "看见现象，还需要确定问题", body: "场景观察记录：巷口一侧是公示栏，另一侧有通向沿街店铺的公共路线。工作人员正在等待领取两箱活动材料，游客会在入口停留问路。\n可以继续调查：路标是否让人误以为参观工坊必须先购买摄影服务？停留拍照与搬运材料是否争用同一段通道？\n观察提示不等于已经完成调查，应补充当事人的说法。", sourceUrl: null, locator: "教学观察提示，不是已经采集的现场数据", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-local-standard", title: "簪花围技艺地方标准原文", nodeId: SERVICE, kind: "public_source", description: "可定位的正式公开来源", body: "DB3505/T 16—2024涉及习俗中的技艺流程、部件和保护传播。核对时将习俗名称、具体技艺与个人选择分开。原文PDF第5—6页可用于范围与流程，第19—20页涉及保护传承。", sourceUrl: STANDARD, locator: "正式PDF第5—6、19—20页；教学摘编，阅读原文确认", knowledgeRefs: ["xunpu-k002-custom-and-zanhuawei-definition", "xunpu-k004-technique-sequence", "xunpu-k007-transmission-and-public-communication"], requires: [] },
    { id: "material-conflicting-claim", title: "一份说得过满的旅行介绍", nodeId: SERVICE, kind: "simulation", description: "需要核对的转引，不是权威答案", body: "一份待核的旅行介绍写道：“簪花围在2024年正式入选国家级非遗，同年又成为十大文旅经济创新案例。”\n核验提示：这句话把名录身份、技艺标准发布日期与文旅案例入选混在一起。请分别找到各自的文件，决定哪些部分能保留、哪些应限定或更正。\n这是教学编写的混合主张，不对应某一家真实媒体。", sourceUrl: null, locator: "教学编写的待核主张", knowledgeRefs: ["xunpu-k001-heritage-status-boundary", "xunpu-k018-network-claim-needs-verification"], requires: [] },
    { id: "material-resident-account", title: "阿环的个人经历摘记", nodeId: null, kind: "simulation", description: "合成受访者讲述，保留个人范围", body: "阿环正在整理本次体验活动的12份材料，分成两箱，每箱6份。她提到点数被拍照邀请打断后需要重数，希望报道也保留这些不显眼的劳动。\n12份是材料准备量，不是实际到场人数。她欢迎交流，但不愿随时放下工作配合镜头。引语和记录方式以你与她的实际对话为准。", sourceUrl: null, locator: "教学人物讲述；不是实际居民采访", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-full-interview", title: "个人讲述的完整语境", nodeId: null, kind: "simulation", description: "用于核对节选是否改变意思", body: "完整语境示例：“有人来，多了交流和机会。我在点第二箱材料时被喊去拍照，回来得重新数。我不是不欢迎游客，只希望先问问我现在方不方便。”\n若只剪出“不想配合拍摄”，会省掉欢迎交流和正在工作的前提。该示例用于对照，学生自己的原话记录以本场对话为准。", sourceUrl: null, locator: "发布后案例教学材料，不替代学生实际采访", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-craft-process", title: "技艺观察顺序卡", nodeId: WORKSHOP, kind: "public_source", description: "镜头服务于过程理解", body: "先定位材料准备、盘发、装饰、成型之间的顺序，再选择能说明一个步骤的画面。不要把效果展示当成已经记录完整制作过程。", sourceUrl: STANDARD, locator: "正式PDF第6页，第5章；教学观察转译", knowledgeRefs: ["xunpu-k004-technique-sequence"], requires: [] },
    { id: "material-workshop-notes", title: "本轮工坊教学安排", nodeId: WORKSHOP, kind: "simulation", description: "在观摩和问答之间分配时间", body: "活动筹备单：计划设置12个体验位，对应12份材料包；实际到场人数尚未登记。黄老师安排“示范一个完整步骤 → 学员练习 → 个别修改”。\n记者可选完整观摩或短访，进入前先约好；拍摄学员须另行协商。清单只证明准备计划，不能当作实际参加人数统计。", sourceUrl: null, locator: "合成工坊安排", knowledgeRefs: ["xunpu-k007-transmission-and-public-communication", "xunpu-k016-interview-consent-and-custom"], requires: [] },
    { id: "material-shop-service", title: "商户的服务说明", nodeId: SHOP, kind: "simulation", description: "经营者视角需要对照其他信源", body: "店铺服务说明：造型体验与摄影服务分开说明，询问不等于购买。当前预约表有3组记录，其中2组标为已结束，1组待到店确认。\n这些是本次场景的模拟经营记录，不能推算当天营收、整个社区游客量或现实商家价格。可向游客核对其实际需求。", sourceUrl: null, locator: "仿真服务说明，无真实商家指代", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-commercial-offer", title: "商户样片合作说明", nodeId: null, kind: "simulation", description: "三个合理取舍都需要理由", body: "样片合作便笺：吴姐愿提供“店内整理造型”和“公共街区远景”两个镜头供查看，并希望报道封面体现店名。现有说明只涉及店内展示，拍摄者身份、人物范围及记者跨平台使用尚待确认。\n可选择核清范围并披露后有限合作、自行采集，或只采访经营观点。查看样片不等于取得发布许可。", sourceUrl: null, locator: "复用旗舰商业灰度取舍的教学情境", knowledgeRefs: ["xunpu-k013-logo-is-rights-bearing-asset", "xunpu-k021-photography-permission"], requires: [] },
    { id: "material-license-note", title: "本次素材使用核对单", nodeId: MOBILE, kind: "simulation", description: "许可针对具体文件与用途", body: "样片核对单：\n提供方：吴姐；原用途：店内展示。\n作者身份：待确认；画面人物公开范围：待确认；记者使用的平台、期限及改编方式：尚未约定。\n本单记录缺口，不授予任何使用许可。学生自采素材应另按实际文件和本人约定登记。", sourceUrl: null, locator: "教学核对模板；不自动授予素材许可", knowledgeRefs: ["xunpu-k016-interview-consent-and-custom", "xunpu-k021-photography-permission"], requires: [] },
    { id: "material-resident-consent", title: "阿环的本场文字记录约定", nodeId: null, kind: "simulation", description: "本人确认后的本场范围，不代表所有素材许可", body: "本场采访约定：阿环同意先以文字和不识别人物的环境画面记录这次交流。准备公开引用的原话，仍须与她核对上下文。\n约定不包括拍摄她的面部、录制她的声音或任意平台传播，也不代表其他居民同意。具体学生、回合和确认时间以本场已提交的安排记录为准。\n这是教学人物的仿真约定，不是现实居民的授权文件。", sourceUrl: null, locator: "本场阿环已确认安排回合；教学仿真", knowledgeRefs: ["xunpu-k016-interview-consent-and-custom", "xunpu-k021-photography-permission"], requires: ["resident-text-scope"] },
    { id: "material-alternative-shots", title: "替代镜头方案", nodeId: null, kind: "simulation", description: "受到限制后仍然可以完成报道", body: "根据本次约定，考虑不识别个人的环境、工具和步骤画面，或经确认的文字。替代应保留说明问题所需的信息，不能因为不用人物近景就编造别的经历。", sourceUrl: null, locator: "教学制作提示", knowledgeRefs: ["xunpu-k016-interview-consent-and-custom", "xunpu-k023-integrated-production-workflow"], requires: [] },
    { id: "material-public-service", title: "旅游交通与居民出行的公开答复", nodeId: SERVICE, kind: "public_source", description: "带日期的服务资料", body: "泉州市交通运输局2025年5月22日答复讨论了旅游接驳、居民基本出行、需求和成本。它可提供问题背景，不能替代今天的班次查询。采访时可分别询问游客和实际服务者。", sourceUrl: "https://jtj.quanzhou.gov.cn/zfxxgkzl/xxgkml/rddbjy/rdjy/202506/t20250603_3176070.htm", locator: "泉交函〔2025〕119号，基本情况与有关建议；教学摘要", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-service-update", title: "公示版本核对回执", nodeId: null, kind: "simulation", description: "保留旧版、时点和确认范围", body: "活动公共信息联络组 · 补充回执 v2\n确认事项：本次场景前20分钟可在资料联络点现场咨询；之后改由蔡主任通过工作消息回复。\n沿街公共路线与资料查阅继续开放。这项变化不代表整个街区关闭，也不改变进入居民小院须另行协商的条件。\n本回执补充v1未说明的咨询时段，两个版本均应保留；不对应现实社区的通行安排。", sourceUrl: null, locator: "教学回执，不是现实部门公文", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-dated-report", title: "文旅报道中的统计时点", nodeId: SERVICE, kind: "public_source", description: "报道截至当时，不能当作实时总量", body: "福建省文化和旅游厅页面标注2024年11月30日。文中的‘今年以来’有报道时点，不能改写为完整全年，也不能当作当前实时数据。传播量与独立到访人数不是同一口径。", sourceUrl: "https://wlt.fujian.gov.cn/wldt/btdt/202412/t20241209_6589570.htm", locator: "官方页面，2024-11-30；教学摘要", knowledgeRefs: ["xunpu-k009-2024-visitor-statistics", "xunpu-k010-online-reach-attribution", "xunpu-k012-yearly-statistics-not-interchangeable"], requires: [] },
    { id: "material-tourist-account", title: "周女士的这一次出行", nodeId: null, kind: "simulation", description: "一次体验是线索，不是整体调查", body: "周女士和朋友想看工坊示范，还没有购买摄影套餐。她看到造型宣传照片后，曾以为参观要先消费，随后在公共街区问路。\n这是一个模拟游客的具体经历。是否普遍如此，尚需其他访谈和公开指引支持；不能写成“所有游客都被误导”。", sourceUrl: null, locator: "教学人物经历，不是游客调查数据", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-source-method", title: "把一句话拆成可核验的主张", nodeId: SERVICE, kind: "simulation", description: "独立查证的方法卡", body: "写下准备使用的判断，逐项记录谁说的、依据是什么、适用于哪个时点和范围。个人观点、公开事实与未确认推测分别处理；没有原件时记下缺口，不自动补全。", sourceUrl: null, locator: "教学方法转译", knowledgeRefs: ["xunpu-k014-source-status-over-topic-match", "xunpu-k018-network-claim-needs-verification"], requires: [] },
    { id: "material-expert-mail", title: "陈老师补发的资料说明", nodeId: null, kind: "simulation", description: "只有邮件实际送达后才可收入采访本", body: "同学你好，抱歉刚才忘记发送。\n名录文件中的项目是“蟳埔女习俗”，国务院第二批国家级非遗名录通知为国发〔2008〕19号；2024年的地方标准具体说明簪花围技艺，不能把标准年份写成新入选年份。文旅创新案例的入选又是另一件事。\n请分别核对原文与适用范围，并保留居民讲述的个人视角。", sourceUrl: STANDARD, locator: "合成研究者邮件，附正式标准链接", knowledgeRefs: ["xunpu-k002-custom-and-zanhuawei-definition", "xunpu-k014-source-status-over-topic-match"], requires: ["expert-mail-delivered"] },
    { id: "material-editor-brief", title: "编辑委托：寻找簪花之外的故事", nodeId: DESK, kind: "simulation", description: "共同任务，允许不同合理切入", body: "为准备来访的读者或关注社区生活的人完成一次有依据的报道。可以从生活、技艺、经营或服务出发。提交自己的内容与所用证据，说明没解决的问题和取舍。", sourceUrl: null, locator: "本课编辑委托", knowledgeRefs: ["xunpu-k017-multiple-perspectives"], requires: [] },
    { id: "material-platform-brief", title: "本课平台发布提示", nodeId: DESK, kind: "simulation", description: "让形式、受众和证据相称", body: "根据受众选择形式；让标题和画面与实际证据一致，保留素材版本与必要标识。此提示不提供真实推荐算法或播放量预测。", sourceUrl: null, locator: "教学平台规则", knowledgeRefs: ["xunpu-k020-republication-traceability", "xunpu-k023-integrated-production-workflow"], requires: [] },
    { id: "material-context-feedback", title: "发布后：原话没错，语境呢", nodeId: null, kind: "simulation", description: "事实错误和表达不足分别处理", body: "案例质疑：节选只保留‘不想配合拍摄’，省掉了欢迎交流及正在做事的前提。可回看全记录后补充语境、以充分依据维持判断，或暂缓争议片段继续核验。", sourceUrl: null, locator: "复用发布后语境案例；不是当前学生已经发布的事实", knowledgeRefs: ["xunpu-k017-multiple-perspectives", "xunpu-k019-correction-is-part-of-workflow"], requires: [] },
    { id: "material-revision-receipts", title: "跨平台修订记录示例", nodeId: DESK, kind: "simulation", description: "旧版、修改原因和通知要能对应", body: "示例记录包含原版、修改片段、修改理由和不同平台的通知状态。学生实际作品的修订另由工作台保存；查看本示例不算已经完成更正。", sourceUrl: null, locator: "发布后案例教学示例", knowledgeRefs: ["xunpu-k019-correction-is-part-of-workflow", "xunpu-k020-republication-traceability"], requires: [] },
  ],
  strategies: [
    { id: "community-life", title: "社区日常", question: "报道怎样同时看见来访交流与日常劳动？", materialIds: ["material-resident-account", "material-local-standard"], evidenceNpcIds: [AHUAN], flag: null },
    { id: "craft-process", title: "技艺过程", question: "一个完整的制作步骤怎样被准确呈现？", materialIds: ["material-craft-process", "material-workshop-notes"], evidenceNpcIds: [HUANG], flag: null },
    { id: "culture-explainer", title: "文化解释", question: "旅行介绍中的哪些判断能被原文支持？", materialIds: ["material-local-standard", "material-conflicting-claim"], evidenceNpcIds: [CHEN], flag: null },
    { id: "visitor-service", title: "游客服务", question: "一次出行体验提示了什么可核验的服务问题？", materialIds: ["material-tourist-account", "material-public-service"], evidenceNpcIds: [ZHOU, CAI], flag: null },
    { id: "shared-street", title: "共同使用的街区", question: "游客便利与日常出行有哪些不同需要？", materialIds: ["material-public-observation", "material-public-service"], evidenceNpcIds: [LIN, ZHOU], flag: null },
    { id: "business-voice", title: "经营者视角", question: "不用商业样片，能否说明经营者在做什么？", materialIds: ["material-shop-service", "material-tourist-account"], evidenceNpcIds: [WU], flag: "commercial-interview-only" },
    { id: "transparent-cooperation", title: "透明素材合作", question: "如何让素材合作与编辑判断各有清楚边界？", materialIds: ["material-commercial-offer", "material-license-note"], evidenceNpcIds: [WU, XU], flag: "commercial-limited-use" },
    { id: "alternative-framing", title: "替代镜头", question: "近景被拒绝后，怎样保留报道的信息价值？", materialIds: ["material-alternative-shots", "material-tourist-account"], evidenceNpcIds: [ZHOU, XU], flag: "alternative-framing" },
    { id: "parallel-research", title: "先约后查", question: "怎样在等候约见时完成其他核验？", materialIds: ["material-local-standard", "material-source-method"], evidenceNpcIds: [CHEN], flag: "expert-met" },
    { id: "missed-mail", title: "失约后的查证", question: "资料没有按时到，报道可以怎样继续？", materialIds: ["material-local-standard", "material-source-method"], evidenceNpcIds: [CHEN], flag: "expert-mail-overdue" },
    { id: "topic-pivot", title: "采访中途转向", question: "最初的问题做不下去时，怎样找到可完成的切口？", materialIds: ["material-notice-board", "material-editor-brief"], evidenceNpcIds: [EDITOR, CAI], flag: "topic-revised" },
    { id: "context-recovery", title: "语境修订", question: "如何区别事实错误、表达不足与有依据的编辑判断？", materialIds: ["material-full-interview", "material-context-feedback"], evidenceNpcIds: [AHUAN, QIAO], flag: null },
  ],
};

for (const choice of draft.choices) {
  if (["wu-limited", "wu-self-shoot", "wu-interview-only"].includes(choice.id)) choice.exclusiveGroup = "commercial-material-policy";
  if (["qiao-context", "qiao-maintain", "qiao-hold"].includes(choice.id)) choice.exclusiveGroup = "context-response-policy";
}
for (const actor of draft.people) actor.onSiteUntilMinute = actor.id === CAI ? 20 : null;
const records = new Set(["material-notice-board", "material-public-observation", "material-resident-account", "material-resident-consent", "material-workshop-notes", "material-shop-service", "material-commercial-offer", "material-license-note", "material-service-update", "material-tourist-account", "material-expert-mail"]);
const cases = new Set(["material-full-interview", "material-context-feedback", "material-revision-receipts"]);
for (const material of draft.materials) {
  material.evidenceStatus = material.kind === "public_source" ? "public_source" : material.id === "material-conflicting-claim" ? "unverified_claim"
    : records.has(material.id) ? "scenario_record" : cases.has(material.id) ? "case_example" : "reference_guide";
  if (material.id === "material-expert-mail") {
    material.sourceUrl = "https://zwgk.mct.gov.cn/zfxxgkml/fwzwhyc/202012/t20201210_918992.html";
    material.locator = "研究者整理的名录通知定位；技艺地方标准可在资料栏对照";
    material.knowledgeRefs = ["xunpu-k001-heritage-status-boundary", "xunpu-k002-custom-and-zanhuawei-definition", "xunpu-k014-source-status-over-topic-match"];
  }
}
export const xunpuExplorationLesson: ExplorationLesson = deepFreeze({ ...draft, contentHash: hashCanonical(draft) });

export function validateExplorationLesson(lesson: ExplorationLesson): string[] {
  const errors: string[] = [];
  if(lesson.adaptedFromLessonHash&&!/^[a-f0-9]{64}$/u.test(lesson.adaptedFromLessonHash))errors.push('后续训练的基础课程引用无效');
  const { contentHash, ...body } = lesson;
  if (hashCanonical(body) !== contentHash) errors.push("课程内容哈希不一致");
  if (lesson.workPlan) {
    const parsed = FieldWorkPlanV3Schema.safeParse(lesson.workPlan);
    if (!parsed.success) errors.push("课程成果计划不完整");
    else { const { contentHash: hash, ...plan } = parsed.data; if (hashCanonical(plan) !== hash) errors.push("课程成果计划哈希不一致"); }
  }
  if (lesson.mediaAssets) {
    if (new Set(lesson.mediaAssets.map(asset=>asset.assetId)).size!==lesson.mediaAssets.length) errors.push('课程媒体编号重复');
    for(const asset of lesson.mediaAssets)if(!/^\/assets\/v3\/[a-z0-9-]+\.png$/u.test(asset.publicPath)||!/^[a-f0-9]{64}$/u.test(asset.contentHash)||!asset.sourceFactBoundary)errors.push(`课程媒体引用无效：${asset.assetId}`);
  }
  const nodes = new Set(lesson.nodes.map(node => node.id));
  const people = new Set(lesson.people.map(person => person.id));
  const materials = new Set(lesson.materials.map(material => material.id));
  const flags = new Set([...lesson.choices.flatMap(item => item.flags), "expert-mail-overdue", "expert-mail-delivered", "topic-revised", "expert-met",
    ...(lesson.socialLearning ? [...lesson.nodes.map(node=>`known-node:${node.id}`),...lesson.people.map(person=>`referred:${person.id}`),...lesson.materials.map(material=>`acquired-material:${material.id}`)] : [])]);
  for (const [label, ids] of [["nodes", lesson.nodes.map(x => x.id)], ["people", lesson.people.map(x => x.id)], ["materials", lesson.materials.map(x => x.id)], ["choices", lesson.choices.map(x => x.id)], ["strategies", lesson.strategies.map(x => x.id)]] as const) {
    if (new Set(ids).size !== ids.length) errors.push(`${label}存在重复ID`);
  }
  const checkMaterials = (ids: string[]) => ids.forEach(id => { if (!materials.has(id)) errors.push(`未知材料：${id}`); });
  if (!nodes.has(lesson.initialNodeId)) errors.push("起点不存在");
  for (const node of lesson.nodes) if (node.requiresFlag && !flags.has(node.requiresFlag)) errors.push(`不可满足的区域条件：${node.requiresFlag}`);
  if (lesson.socialLearning) {
    for (const node of lesson.nodes) {
      if (!node.image || !node.map || !node.exits?.length) errors.push(`地点缺少画面、地图或出口：${node.id}`);
      if (node.imageAtlas && (!Number.isInteger(node.imageAtlas.columns) || node.imageAtlas.columns < 1 || !Number.isInteger(node.imageAtlas.rows) || node.imageAtlas.rows < 1
        || !Number.isInteger(node.imageAtlas.index) || node.imageAtlas.index < 0 || node.imageAtlas.index >= node.imageAtlas.columns * node.imageAtlas.rows)) errors.push(`地点图集配置无效：${node.id}`);
      for (const exit of node.exits ?? []) if (!nodes.has(exit.targetId) || !Number.isFinite(exit.x) || !Number.isFinite(exit.y) || exit.x<0 || exit.x>1 || exit.y<0 || exit.y>1) errors.push(`地点出口配置无效：${node.id}`);
    }
    const reached=new Set([lesson.initialNodeId]);
    for(let previous=-1;previous!==reached.size;){previous=reached.size;for(const node of lesson.nodes)if(reached.has(node.id))for(const exit of node.exits??[])reached.add(exit.targetId);}
    if(lesson.nodes.some(node=>!reached.has(node.id)))errors.push("存在无法从起点到达的地点");
  }
  for (const person of lesson.bystanders) if (!nodes.has(person.nodeId) || people.has(person.id)) errors.push(`程序人物位置或ID无效：${person.id}`);
  for (const person of lesson.people) {
    if (!nodes.has(person.nodeId)) errors.push(`人物位置不存在：${person.id}`);
    if (person.requiresFlag && !flags.has(person.requiresFlag)) errors.push(`不可满足的人物条件：${person.requiresFlag}`);
    if (new Set(person.topics.map(topic => topic.id)).size !== person.topics.length) errors.push(`人物话题重复：${person.id}`);
    person.topics.forEach(topic => checkMaterials(topic.materialIds));
    if (person.onSiteUntilMinute != null && (!Number.isInteger(person.onSiteUntilMinute) || person.onSiteUntilMinute < 1)) errors.push(`人物现场时段无效：${person.id}`);
    if (person.workflow && !CharacterWorkflowV3Schema.safeParse(person.workflow).success) errors.push(`人物流程配置无效：${person.id}`);
    if (person.social?.referralTargets.some(id=>!people.has(id))) errors.push(`人物引荐对象不存在：${person.id}`);
    const appearance=person.appearance;
    if (appearance && ((!Number.isFinite(appearance.x) || appearance.x<0 || appearance.x>1) || (!Number.isFinite(appearance.y) || appearance.y<0 || appearance.y>1.2) || (!Number.isFinite(appearance.height) || appearance.height<.1 || appearance.height>1.2)
      || (appearance.atlas && (appearance.atlas.index<0 || appearance.atlas.index>=appearance.atlas.columns*appearance.atlas.rows)))) errors.push(`人物画面配置无效：${person.id}`);
  }
  for (const choice of lesson.choices) {
    if (!people.has(choice.npcId)) errors.push(`选择人物不存在：${choice.id}`);
    if (choice.targetNpcId && !people.has(choice.targetNpcId)) errors.push(`选择目标不存在：${choice.id}`);
    for (const flag of [...choice.requires, ...choice.excludes]) if (!flags.has(flag)) errors.push(`选择条件不存在：${flag}`);
    checkMaterials(choice.materialIds);
  }
  for (const material of lesson.materials) {
    if (material.nodeId && !nodes.has(material.nodeId)) errors.push(`材料位置不存在：${material.id}`);
    if (material.kind === "public_source" && !material.sourceUrl?.startsWith("https://")) errors.push(`公开材料缺少来源：${material.id}`);
    for (const flag of material.requires) if (!flags.has(flag)) errors.push(`材料条件不存在：${flag}`);
  }
  for (const strategy of lesson.strategies) {
    checkMaterials(strategy.materialIds);
    if (strategy.evidenceNpcIds.some(id => !people.has(id))) errors.push(`路线人物不存在：${strategy.id}`);
    if (strategy.flag && !flags.has(strategy.flag)) errors.push(`路线条件不存在：${strategy.flag}`);
  }
  return errors;
}

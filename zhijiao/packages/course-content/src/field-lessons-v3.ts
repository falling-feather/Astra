import {addCourseArcV3} from "./field-course-arcs-v3.js";
import { hashCanonical, deepFreeze } from "./canonical.js";
import { xunpuExplorationLesson, type ExplorationLesson, type ExplorationPerson, type ExplorationMaterial } from "./xunpu-exploration-lesson.js";
import { courseRegionAssignments } from "./course-regions.js";
import { fieldWorkPlansV3 } from "./field-work-plans-v3.js";
import { regionNodesV3, type FieldRegionIdV3 } from "./region-scenes-v3.js";
import { buildRegionCastV3 } from "./region-cast-v3.js";
import { xunpuAdditionalCastV3 } from "./xunpu-cast-v3.js";
import { rongjiangAdditionalCastV3 } from "./rongjiang-cast-v3.js";
import { qinglanAdditionalCastV3 } from "./qinglan-cast-v3.js";
import { fieldPathsV3 } from "./field-paths-v3.js";
import { fieldSourceLibraryV3 } from "./field-source-library-v3.js";
import { fieldMediaAssetsV3 } from "./field-media-v3.js";

export { createDefaultCharacterWorkflowV3 as defaultCharacterWorkflow } from "@ronggang/contracts";
import { createDefaultCharacterWorkflowV3 as defaultCharacterWorkflow } from "@ronggang/contracts";

const appearance = (region: string, index: number, x: number): NonNullable<ExplorationPerson["appearance"]> => ({
  image: `/assets/v3/${region}-actors.png`, x, y: .9, height: .58, atlas: { columns: 3, rows: 1, index },
});
const finish = (body: Omit<ExplorationLesson, "contentHash">): ExplorationLesson => deepFreeze({ ...body, contentHash: hashCanonical(body) });
const sourceUrl = "https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548141306012.pdf";

function modernXunpu(): ExplorationLesson {
  const { contentHash: _hash, ...body } = structuredClone(xunpuExplorationLesson);
  body.lessonId = "field-xunpu-v3"; body.version = "3.0.0-preview.2";
  body.region = { id: "xunpu", title: "蟳埔社区" }; body.socialLearning = true;
  body.bystanders = [];
  body.nodes = regionNodesV3('xunpu');
  body.people = body.people.map(person => ({ ...person,
    social: { supportsContact: person.remoteContact, initialTrust: person.id === "entity-researcher" ? 10 : 30, contactThreshold: 25, referralThreshold: 35,
      referralTargets: person.id === "entity-gatekeeper" ? ["entity-shopkeeper", "entity-researcher"] : person.id === "entity-researcher" ? ["entity-inheritor", "entity-public-liaison"] : [],
      refusal: "我不在私人联络列表里添加采访者，不过你仍可以在现场提出具体问题，或通过公开资料继续调查。" },
    personality: person.goal, workflow: defaultCharacterWorkflow(),
    ...(person.id === "entity-inheritor" ? { appearance: appearance("xunpu", 0, .38) } : person.id === "entity-shopkeeper" ? { appearance: appearance("xunpu", 1, .58) }
      : person.id === "entity-rights-contact" ? { appearance: appearance("xunpu", 2, .52) } : {}),
  }));
  const legacyCast=['entity-gatekeeper','entity-community-source','entity-researcher'];
  body.people=body.people.map(person=>{const index=legacyCast.indexOf(person.id);return index<0?person:{...person,
    appearance:{image:'/assets/node-world/characters.png',x:index===0?.30:.43,y:.92,height:.62,atlas:{columns:4,rows:1,index}}};});
  const secondAtlas = ["entity-public-liaison", "entity-tourist", "entity-editor", "entity-platform-duty"];
  body.people = body.people.map(person => { const index = secondAtlas.indexOf(person.id); return index < 0 ? person : { ...person,
    appearance: { image: "/assets/v3/xunpu-actors-02.png", x: index === 0 ? .26 : index === 1 ? .29 : index === 2 ? .4 : .7,
      y: .9, height: .58, atlas: { columns: 4, rows: 1, index } } }; });
  const liaison = body.people.find(person => person.id === "entity-public-liaison")!;
  const notice = liaison.topics.find(topic => topic.id === "cai-notice")!;
  notice.response = "这份回执已经核对了本场咨询窗口的结束时间，但不能把咨询结束写成整个街区关闭。请把原公示和这次回执放在一起看，向游客说明已经确认的范围。";
  return finish(body);
}

function material(id: string, title: string, nodeId: string, body: string, professional = false): ExplorationMaterial {
  return { id, title, nodeId, body, description: professional ? "可按需阅读的岗位方法说明。" : "本课已编排的现场材料，记录适用时点与范围。",
    kind: professional ? "public_source" : "simulation", sourceUrl: professional ? sourceUrl : null,
    locator: professional ? "融媒体技术与运营专业教学标准，融媒体制作发布实战相关要求；本材料为教学转译" : "本场教学仿真资料，不能当作现实统计",
    knowledgeRefs: [], requires: [], evidenceStatus: professional ? "reference_guide" : "scenario_record" };
}
function cast(region: string, id: string, name: string, role: string, nodeId: string, index: number, goal: string,
  topics: Array<{ title: string; keywords: string[]; response: string; materialId: string }>, referrals: string[]): ExplorationPerson {
  return { id, name, role, nodeId, goal, unknown: "没有亲历或没有资料支持的情况，不作为已确认事实。", activity: goal,
    greeting: `你好，我是${name}。${goal}，你想具体了解哪一件事？`, clarification: "你可以说说具体对象、时点或打算怎样使用这份信息，我再看看能回答到哪一步。",
    topics: topics.map((topic, i) => ({ id: `${id}-topic-${i + 1}`, title: topic.title, keywords: topic.keywords, response: topic.response, materialIds: [topic.materialId] })),
    requiresFlag: null, remoteContact: true, personality: goal, appearance: appearance(region, index, index === 0 ? .32 : index === 1 ? .62 : .43),
    social: { supportsContact: index !== 2, initialTrust: index === 2 ? 10 : 30, contactThreshold: 25, referralThreshold: 35,
      referralTargets: referrals, refusal: "我不添加私人好友，但愿意在工作现场讨论有依据的具体问题。" }, workflow: defaultCharacterWorkflow() };
}

function regionalLesson(region: "rongjiang" | "qinglan", courseId: string, title: string, assignment: string): ExplorationLesson {
  const stadium = region === "rongjiang", prefix = stadium ? "rg" : "ql";
  const entry = `${prefix}-entry`, working = `${prefix}-working`, community = `${prefix}-community`, desk = `${prefix}-desk`;
  const nodes = regionNodesV3(region);
  const schedule = `${prefix}-schedule`, statement = `${prefix}-statement`, boundary = `${prefix}-boundary`, method = `${prefix}-method`;
  const materials = stadium ? [
    material(schedule, "本场赛程与更正记录", entry, "教学情境：赛前计划安排4支队伍参与下午场，其中1支队伍到场时间需要再次确认。计划表不是实际到场记录，比分也应注明比赛与确认时点。"),
    material(statement, "球员的完整采访记录", working, "教学情境：球员愿意谈训练和团队配合，不希望把一句失落的话截成对某位队友的指责。节选时应保留前后问题和使用语境。"),
    material(boundary, "现场拍摄与采访约定", community, "教学情境：公共区域的记录与人物近景使用分别协商；工作人员只负责自己值守的区域，不能替所有人承诺许可。"),
    material(method, "多平台报道与核验方法", desk, "从目标受众需要组织内容，核对采访和素材来源；不同平台可以改变篇幅与形式，关键事实和适用条件保持一致。", true),
  ] : [
    material(schedule, "服务公告与值班回执", entry, "教学情境：当前已确认暂停的是一段步道，不是整个景区。接下来是否开放，须依新发布的检查结论；天气预警不等于自动产生闭园或复开命令。"),
    material(statement, "视觉素材来源说明", working, "教学情境：一组图片由制作人员提供，包含现场照片和AI辅助生成画面。文件存在不等于许可范围完整，应逐项核对作者、生成属性和约定用途。"),
    material(boundary, "现场观察与使用范围", community, "教学情境：联络员只确认其检查过的范围；无法核实的路段保持未知。报道服务于公众的信息判断，不把仿真地图当作现实出行指引。"),
    material(method, "服务信息与内容更新方法", desk, "对照已确认来源、适用区域与更新时间组织信息。更新时定位受影响的平台和旧版本，保留更正缘由，不用新的措辞掩盖未核实内容。", true),
  ];
  const a = `${prefix}-liaison`, b = `${prefix}-practitioner`, c = `${prefix}-specialist`;
  const people = stadium ? [
    cast(region, a, "罗晓禾", "社区赛事志愿者", entry, 0, "把咨询信息说清楚，也照顾到不同来访者", [
      { title: "计划与实际到场", keywords: ["赛程", "安排", "队伍", "人数", "到场"], response: "表上有4支队伍是计划，其中1支还在确认到场时间。你可以先记录已经确认的队伍，再核下一次更新，别直接把计划写成实际到场。", materialId: schedule },
      { title: "来访者真正需要什么", keywords: ["观众", "游客", "咨询", "服务", "指引"], response: "有人想知道比赛几点开始，有人关心出入口和休息位置。先明确服务谁，再决定快讯该放哪些信息，不能只追一个热闹镜头。", materialId: schedule },
      { title: "怎样请人协助", keywords: ["帮助", "准备", "采访", "联系", "工作"], response: "带着具体问题会更好沟通。我能说明自己负责的工作，其他岗位的情况还需要找本人核实。", materialId: boundary },
    ], [b, c]),
    cast(region, b, "杨启明", "村队球员", working, 1, "认真准备比赛，希望报道看见团队合作", [
      { title: "比赛之前的训练", keywords: ["训练", "准备", "配合", "团队"], response: "我们练习的是整支队伍的配合。一个人进球，也有前面几个人的跑动和传球，报道时别把所有原因归到一个人身上。", materialId: statement },
      { title: "怎样使用我的话", keywords: ["原话", "引用", "剪辑", "语境", "失落"], response: "我可以谈自己的感受，但请保留你当时问的问题。我说有些遗憾，是在谈自己的处理，不是在指责某个队友。", materialId: statement },
      { title: "镜头和公开范围", keywords: ["拍摄", "镜头", "记录", "许可", "平台"], response: "场边谈话可以先记文字。若要用个人近景和声音，先说明放在哪、怎样剪，不把我同意这一次采访理解成任何用途都可以。", materialId: boundary },
    ], [c]),
    cast(region, c, "韦承安", "赛事解说与资料协调员", community, 2, "把事实、观察和个人判断分开", [
      { title: "比分与统计时点", keywords: ["比分", "数字", "统计", "确认", "时点"], response: "请对应具体比赛和确认时点看比分。预测、赛中记录和最终确认是不同状态，别把一张中途截图当成最终结论。", materialId: schedule },
      { title: "回应公众质疑", keywords: ["质疑", "回应", "更正", "核查", "错误"], response: "先找到受到质疑的具体表述，回看原采访和当前确认材料，再决定哪些地方应补充、更正或保留未知。", materialId: method },
      { title: "不同平台的表达", keywords: ["平台", "短视频", "图文", "标题", "传播"], response: "可以调整长短和画面结构，但同一件事的关键事实不能在不同平台互相打架。标题也不能省掉决定含义的条件。", materialId: method },
    ], [a]),
  ] : [
    cast(region, a, "沈书宁", "游客服务协调员", entry, 0, "向游客说明已经确认的信息，及时补上变化", [
      { title: "公告确认了什么", keywords: ["公告", "关闭", "开放", "步道", "范围"], response: "目前确认暂停的是公告里标明的一段步道，不能扩大成整个景区关闭。其余区域也不能凭这张公告就断言都安全开放，要看各自的确认信息。", materialId: schedule },
      { title: "不同人的信息需要", keywords: ["游客", "受众", "服务", "出行", "帮助"], response: "有人还没出发，有人已经在服务中心。信息应该先交代适用对象和区域，再告诉大家怎样获得后续确认。", materialId: schedule },
      { title: "更新怎样通知", keywords: ["更新", "通知", "变化", "联系", "确认"], response: "记录发布主体和更新时间，说明哪些信息被替换。没有新确认时可以明确说还在等待，不能为了显得及时补一个结论。", materialId: method },
    ], [b, c]),
    cast(region, b, "程予川", "文旅视觉内容制作人", working, 1, "让作品表达有吸引力，也说清素材从哪来", [
      { title: "这组画面怎么来的", keywords: ["图片", "素材", "来源", "生成", "AI"], response: "这组里有现场照片，也有AI辅助生成的画面。我们要分别说明生成属性和使用条件，不能把生成画面写成当日现场拍摄。", materialId: statement },
      { title: "可用不等于任意用", keywords: ["许可", "授权", "平台", "用途", "版权"], response: "先核对这一个文件的作者和约定用途。对方发给我看，不等于答应所有平台发布；不清楚的范围要继续问或换素材。", materialId: statement },
      { title: "怎样调整作品", keywords: ["替代", "修改", "更正", "设计", "表达"], response: "可以换用自己有条件记录的画面，也可以调整表达形式。选择要服务于内容目标，不能只为了省步骤把重要事实藏掉。", materialId: method },
    ], [a, c]),
    cast(region, c, "何远山", "步道巡护联络员", community, 2, "只对已经检查过的区域和时点作出说明", [
      { title: "现场看到了什么", keywords: ["现场", "观察", "检查", "区域", "情况"], response: "我只说明本次检查覆盖的范围。没有走到、没有确认的地方，我会明确说不知道，不能拿局部观察替整个景区作结论。", materialId: boundary },
      { title: "预警与处置的关系", keywords: ["预警", "暴雨", "闭园", "复开", "决定"], response: "预警提供风险信息，具体处置还需要相应管理主体确认。记者应核对是谁作出的决定、适用哪里、什么时候更新。", materialId: schedule },
      { title: "已有信息需要更正", keywords: ["谣言", "传言", "核验", "更正", "回应"], response: "把待核说法、目前已经确认的部分和仍然未知的部分分开。更正也要给读者说明依据和变化，不用模糊措辞悄悄替换。", materialId: method },
    ], [a]),
  ];
  return finish({ lessonId: `${courseId}-field-v3`, version: "3.0.0-preview.2", title, assignment, initialNodeId: entry, nodes, people, materials, choices: [], bystanders: [],
    region: { id: region, title: stadium ? "榕江赛事街区" : "青岚山地景区（教学仿真）" }, socialLearning: true,
    strategies: [
      { id: `${prefix}-public`, title: "从公开信息开始", question: "哪些信息已经确认，哪些还需要继续核对？", materialIds: [schedule, method], evidenceNpcIds: [], flag: null },
      { id: `${prefix}-people`, title: "从人物的工作开始", question: "不同岗位怎样理解同一件事？", materialIds: [statement], evidenceNpcIds: [b], flag: null },
      { id: `${prefix}-revision`, title: "从一个待核说法开始", question: "找到具体问题后，怎样核查并向受众说明变化？", materialIds: [boundary, method], evidenceNpcIds: [c], flag: null },
    ] });
}

export const courseFieldLessonsV3: ReadonlyArray<{ courseId: string; lesson: ExplorationLesson }> = [
  { courseId: courseRegionAssignments[0]!.courseId, lesson: modernXunpu() },
  ...courseRegionAssignments.slice(1).map(course => ({ courseId: course.courseId,
    lesson: regionalLesson(course.regionId as "rongjiang" | "qinglan", course.courseId, `${course.regionTitle} · ${course.shortTitle}`,
      `在${course.regionTitle}的教学仿真中完成“${course.shortTitle}”岗位任务。自主选择调查起点，与相关岗位人物交流并核对资料，记录你的判断，完成面向明确受众的作品。场景人物和现场数字为教学编排；专业方法的来源可按需核对。`) })),
].map(({ courseId, lesson }) => {
  const { contentHash: _hash, ...body } = structuredClone(lesson);
  const workPlan = fieldWorkPlansV3.find(plan => plan.courseId === courseId);
  if (!workPlan) throw new Error(`课程缺少独立成果计划：${courseId}`);
  const region = body.region!.id as FieldRegionIdV3;
  const addition = buildRegionCastV3(region, region === 'xunpu' ? xunpuAdditionalCastV3 : region === 'rongjiang' ? rongjiangAdditionalCastV3 : qinglanAdditionalCastV3);
  body.nodes = regionNodesV3(region);
  if(region!=='xunpu')body.mediaAssets=structuredClone(fieldMediaAssetsV3[region]);
  body.people.push(...addition.people); body.materials.push(...addition.materials,...fieldSourceLibraryV3(region));
  if (region === 'xunpu') {
    const placements: Record<string, string> = { 'entity-community-source':'xp-courtyard-threshold', 'entity-inheritor':'xp-workshop-foyer',
      'entity-researcher':'xp-archive-corner', 'entity-tourist':'xp-public-plaza', 'entity-public-liaison':'xp-traffic-desk', 'entity-rights-contact':'loc-waterfront-service-point' };
    for (const person of body.people) {
      person.nodeId = placements[person.id] ?? person.nodeId;
      if (placements[person.id]) { person.requiresFlag = null; person.onSiteUntilMinute = null; }
      if (person.id === 'entity-researcher') person.activity = '在阅览角整理资料，可以先说明你的具体问题';
      if (person.id === 'entity-community-source') person.greeting='你好，我是阿环，正在门口核对活动材料。你想了解什么？可以先在这里聊，进院和记录的范围再分别商量。';
    }
    // The resident, rather than a gatekeeper, authorizes entry to the home in the new lesson.
    body.choices = body.choices.filter(choice => !['lin-public-edge','lin-introduction'].includes(choice.id));
    body.choices.push({ id:'ahuan-courtyard-entry',npcId:'entity-community-source',label:'征求进入小院的意愿',keywords:['进院','进入小院','进去看看','进入院子'],
      response:'可以进院里约好的这一小块区域聊。屋内和私人物件不在这次范围，拍摄与公开引用仍要另问我。',requires:[],excludes:['courtyard-access'],minutes:1,
      effect:'flag',flags:['courtyard-access','resident-introduced'],materialIds:[],delayMinutes:0,targetNpcId:null,exclusiveGroup:null });
    for (const choice of body.choices) {
      if (choice.id === 'ahuan-story') choice.requires = [];
      if (choice.id === 'chen-appointment') { choice.label='约五分钟后在阅览角续谈'; choice.response='五分钟后在阅览角继续，能留六分钟。你可以先查其他资料，到点再来；如果改计划，请告诉我。'; }
      if (choice.id === 'ahuan-followup') choice.response='好，我回来后在小院门口继续。刚才的问题保留着，不用从头再说。';
    }
    body.materials.push({ id:'xp-courtyard-observation',title:'院内获准范围的观察',nodeId:'loc-community-courtyard',kind:'simulation',description:'在住户同意的范围继续观察。',
      body:'院内可见两箱尚待核对的活动材料和一张整理台。观察只涵盖已获准的区域，箱数不等于到场人数。住户生活空间、私人物件及其他人的拍摄仍需分别协商。',
      sourceUrl:null,locator:'本场原创教学观察',knowledgeRefs:[],requires:['courtyard-access'],evidenceStatus:'scenario_record' });
    const update=body.materials.find(material=>material.id==='material-service-update')!;
    update.body='活动公共信息联络组 · 补充回执V2\n本场前20分钟在资料联络点提供窗口咨询；之后转由出入咨询点接待。蔡主任当前在出入咨询点核对信息，已经互留工作联系方式的学生也可通过手机继续询问。\n公共路线与资料查阅继续开放，咨询位置变化不代表街区关闭，也不改变进入居民小院需要本人同意的条件。旧版与补充回执应一起保留。这是教学仿真安排，不对应现实通行信息。';
    body.people.find(person=>person.id==='entity-public-liaison')!.topics.find(topic=>topic.id==='cai-notice')!.response='这份补充回执说明咨询由资料联络点转到出入咨询点，我现在就在这里核对信息。咨询位置改变不等于街区关闭。请对照原公示和回执，向读者说明时点、位置及仍未确认的部分。';
  } else if (region === 'rongjiang') {
    body.people.find(person => person.id === 'rg-specialist')!.nodeId = 'rg-commentary-room';
  }
  addCourseArcV3(courseId,body);
  const completed = { ...body, version:'3.0.1-content.2', workPlan };
  completed.strategies = fieldPathsV3(courseId, { ...completed, contentHash:'' });
  return { courseId, lesson: finish(completed) };
});

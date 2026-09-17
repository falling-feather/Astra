import type { ExplorationLesson } from './xunpu-exploration-lesson.js';
type PathSeed = readonly [id: string, title: string, question: string, people: string, materials?: string];

const xunpu: readonly PathSeed[] = [
 ['flower-labor','成品之前的挑选','从花材准备追到示范和学习：一次返工怎样影响成品？对照准备记录与助教观察，选择如何呈现判断过程，完成一篇不以销量替代劳动的报道。','xp-florist,xp-craft-assistant,xp-learning-coordinator'],
 ['net-work','一处网眼里的职业判断','从修网棚进入码头和分拣场，观察工具、交接与记录。错过某个步骤时选择替代呈现，解释协作过程，不把一次作业推算为整个家庭收入。','xp-net-mender,xp-dock-worker,xp-sorter'],
 ['repair-and-life','墙面之后仍有人生活','对照修缮工序、住户选择和公开资料。能观察墙面但未获准进屋时怎样完成报道？区分外观、法定身份与生活需要，写出有范围的建筑生活故事。','xp-restorer,entity-community-source,entity-researcher','material-local-standard'],
 ['oral-history','一张没有年份的相册','从茶桌口述找出亲历与转述，向研究者和另一位当事人求证。找不到精确年份时决定保留什么，完成标明记忆性质的解释性报道。','xp-neighbor,entity-researcher,entity-community-source','material-source-method'],
 ['shared-lane','同一条巷道的几种需要','从清洁路线或游客问路出发，听取搬运者与公共联络人的解释。比较保留通道、调整提示等方案，写出兼顾实际使用者的公共空间报道。','xp-cleaner,xp-dock-worker,entity-public-liaison','material-public-observation'],
 ['visitor-needs','参观一定要先消费吗','从游客的一次误解回到店铺说明和传习门厅。区分服务项目、公开参观和私人空间，选择清楚的指引表达，不把个人经历推广为所有游客遭遇。','entity-tourist,entity-shopkeeper,entity-inheritor','material-shop-service,material-tourist-account'],
 ['learning-process','一次体验学会了什么','跟踪示范、独立练习与反馈，比较成品照片和过程记录能支持什么结论。征求记录意愿后完成学习故事，避免把单次参与写成完整技能认证。','entity-inheritor,xp-craft-assistant,xp-learning-coordinator','material-workshop-notes'],
 ['commercial-choice','好看的样片用不用','从商户合作提议核到具体作者与使用条件，再与外采编辑讨论表达目标。可有限合作、自采或只采访，最终作品应解释选择及其影响。','entity-shopkeeper,entity-rights-contact,xp-field-editor','material-commercial-offer,material-license-note'],
 ['personal-boundary','不拍近景也能讲好故事','向居民或游客协商公开范围，再核对替代素材和编辑选择。尊重拒绝后仍保留具体经历，完成不依赖可识别近景的报道方案。','entity-community-source,entity-tourist,entity-rights-contact','material-alternative-shots'],
 ['public-updates','咨询结束等于街区关闭吗','对照公示、补充回执与使用者需要，追问服务时段和公共路线的区别。选择如何通知看过旧版的人，完成带时点与范围的服务报道。','entity-public-liaison,entity-tourist,xp-cleaner','material-notice-board,material-service-update'],
 ['culture-claim','三个年份是不是一回事','拆分混合旅行介绍中的名录、技艺标准和文旅案例主张，向研究者与实践者核对。对不能确认的部分保留缺口，完成可定位来源的文化解释。','entity-researcher,entity-inheritor,xp-neighbor','material-local-standard,material-conflicting-claim'],
 ['context-revisit','原话没错，意思变了吗','从一段被截短的口述回访当事人，对照完整语境并与编辑讨论。选择补充、更正、维持或暂缓，交付报道和能说明理由的后续安排。','entity-community-source,entity-platform-duty,xp-field-editor','material-full-interview,material-context-feedback'],
];
const sports: readonly PathSeed[] = [
 ['teamwork','进球之外的配合','从训练目标到球员解释，再核队务安排。决定怎样把团队过程写入图文和分镜，不让最后一个镜头抹掉其他人的协作。','rg-practitioner,rg-retired-coach,rg-team-manager','rg-statement'],
 ['backstage','比赛开始前的一班工作','沿场地检查、志愿换班和入口服务调查，找出交接如何发生。对尚未回执的点位保留未知，完成幕后工作报道和可用快讯。','rg-groundkeeper,rg-volunteer-organizer,rg-spectator-service'],
 ['first-visit','第一次来怎样看懂现场','从入口提示走访无障碍服务与平台编辑。核对旧图和当前信息，改写面向初访观众的快讯，并让图文、脚本保留相同范围。','rg-spectator-service,rg-access-volunteer,rg-platform-editor'],
 ['culture','文化表达由谁讲述','从排练参与者、社区记录和经营者获得不同视角。辨认延续与新编，决定如何使用声音画面，完成让参与者有主体性的赛事文化报道。','rg-culture-performer,rg-community-reporter,rg-vendor'],
 ['vendor-economy','热闹能证明赚得多吗','核对备货与成交、观众需求和统计口径。选择有依据的经营角度，制作不过度推算收入的图文与短视频脚本。','rg-vendor,rg-spectator-service,rg-data-analyst'],
 ['image-time','一张照片属于哪一场','从照片说明回到作者、队务记录和多端编辑。历史画面、当前记录与未知作者分别处置，完成具有时间一致性的报道组合。','rg-photographer,rg-team-manager,rg-platform-editor'],
 ['score-explainer','红笔更正改变了赛果吗','对照草记、确认表和解说解释，区分缩写修正与比分变化。为不熟悉流程的观众写解释稿和简短快讯，保留确实没有确认的内容。','rg-referee-liaison,rg-specialist,rg-platform-editor','rg-schedule'],
 ['family-choice','亲友也有自己的生活','从亲友的一次安排核到球员与队务，协商家庭范围。选择如何呈现支持与个人工作，交付不靠私人信息或牺牲叙事的作品。','rg-family-member,rg-practitioner,rg-team-manager'],
 ['participation','练习中的修改与成长','观察具体练习目标，听教练、学员反馈整理者和球员的解释。决定怎样呈现失误后的调整，避免用天才标签代替过程。','rg-retired-coach,rg-sport-volunteer,rg-practitioner'],
 ['transparent-partner','合作支持怎样被说明','比较合作草案、经营者诉求与编辑要求。决定是否采用标识或素材，完成披露关系且保持独立判断的图文与脚本。','rg-partner,rg-vendor,rg-platform-editor'],
 ['reach','热度数字回答了什么','对照两个窗口的数据、现场入口和记者的观察。选择适用指标，不把曝光换算到访或认可，完成数据解释和受众导向快讯。','rg-data-analyst,rg-spectator-service,rg-community-reporter'],
 ['independent-angle','主角不便采访之后','从纪录编辑讨论的替代切口，转向场地维护和文化排练。重新确定可调查的问题并补足两类来源，完成一个不依赖球员独家采访的多端作品。','rg-documentary-editor,rg-groundkeeper,rg-culture-performer'],
];
const response: readonly PathSeed[] = [
 ['quote-context','那句失落是在责怪队友吗','定位旧字幕，回访球员并对照完整问题，再与平台编辑核对剪辑。决定补语境、更正或维持，交付可核对的回应和多端更新安排。','rg-practitioner,rg-sport-volunteer,rg-platform-editor','rg-statement'],
 ['statistics-window','两个数字为什么对不上','从质疑原句回到数据窗口、入口计数和解说记录。判断是否是口径差异还是实质错误，对受影响结论作相应回应。','rg-data-analyst,rg-spectator-service,rg-specialist'],
 ['wrong-caption','旧照片写成今天之后','核对作者说明与队伍实际到场，再定位各端图片说明。选择换图、补充历史属性或停止使用，向读者交代变化及理由。','rg-photographer,rg-team-manager,rg-platform-editor'],
 ['family-image','亲友要求拿掉一段画面','回访当事人确认约定，检查原片和已发布版本。确定受影响范围，选择替代呈现并安排通知，不让一次许可覆盖家庭全部信息。','rg-family-member,rg-photographer,rg-documentary-editor'],
 ['empty-roster','空白回执是不是无人值守','对照志愿换班、场地记录和入口服务，区分尚未收到确认与确定未到岗。回应具体主张，保留需要继续核实的部分。','rg-volunteer-organizer,rg-groundkeeper,rg-spectator-service'],
 ['commercial-disclosure','报道是不是隐藏宣传','回到合作草案、商户便笺和编辑决策，分别核实关系与内容事实。决定补披露、修正或维持，说明判断与真实依据。','rg-partner,rg-vendor,rg-platform-editor'],
 ['culture-label','一种表演代表所有人吗','重读原标题，向节目组织者和社区记者核对主体范围。判断是命名错误、过度概括还是合理评论，写出不抹平差异的回应。','rg-culture-performer,rg-community-reporter,rg-documentary-editor'],
 ['result-correction','记录更正被传成改判','逐项比对草记和确认表，核对解说原话与公众疑问。更正确有错误的部分，也保留有依据的说明，不只用权威结论压过疑问。','rg-referee-liaison,rg-specialist,rg-sport-volunteer'],
 ['access-update','指引改了，旧图还在','从使用者反馈核到入口新版和发布端口。区分事实变化与原先表达不足，制作让看过旧版的人也能找到的新说明。','rg-access-volunteer,rg-spectator-service,rg-platform-editor'],
 ['growth-label','一个失误成了永久标签','对照完整练习目标、球员原意和剪辑版本。讨论如何纠正误导而不抹去真实失误，交付补充过程的回应方案。','rg-retired-coach,rg-practitioner,rg-sport-volunteer'],
 ['opinion-dispute','有异议就必须撤回吗','从社区不同意见和完整材料出发，区分事实、解释与价值判断。选择有依据地维持、补充或暂缓，并清楚说明尚不能回答的问题。','rg-community-reporter,rg-specialist,rg-documentary-editor'],
 ['linked-versions','一处改了为何仍在误传','核对图文、视频字幕与快讯的同一主张，回访整理者确认影响。制定逐端更新和通知顺序，保留旧版与修改理由。','rg-platform-editor,rg-data-analyst,rg-sport-volunteer'],
];
const visual: readonly PathSeed[] = [
 ['author-chain','谁能同意使用这张图','沿作者、提供者和合同追踪具体文件，区分查看与发布范围。选择保留、补许可或替代，交付有清楚素材谱系的视觉方案。','ql-photographer,ql-rights-coordinator,ql-librarian'],
 ['generated-scene','逼真的画面是不是现场','核对制作过程、科普用途和发布显示，决定怎样说明生成属性。让视觉服务解释，避免把示意写成新闻实拍。','ql-practitioner,ql-science-editor,ql-platform-reviewer','ql-statement'],
 ['historical-photo','晴天旧照怎样使用','对照作者时点、当前公告与学员修改案例。选择背景展示或替换，检查标题和画面组合是否让人误解为实时状态。','ql-photographer,ql-duty-manager,ql-visual-apprentice'],
 ['limited-permission','许可只覆盖一个端口','从合同范围核到平台发布和文案，判断改编、期限与渠道缺口。设计能在已确认条件内交付的作品，并交代下一步确认。','ql-rights-coordinator,ql-platform-reviewer,ql-copy-editor'],
 ['source-gap','找不到作者还能用吗','对照检索记录、摄影作者和设计替代，区分检索不到与没有权利。完成可实施的替代方案，保留未解决来源缺口。','ql-librarian,ql-photographer,ql-practitioner'],
 ['metadata-display','后台有说明，读者看得到吗','核对生成过程、发布端显示和信息可读性。决定显著说明放置位置并检查与正文一致，避免只完成后台勾选。','ql-practitioner,ql-platform-reviewer,ql-access-consultant'],
 ['scientific-illustration','一幅示意能证明什么','从一般科普与公开观察核对画面能支持的判断，再交给编辑审读。完成明确区分背景解释和本场事实的图文方案。','ql-science-editor,ql-nature-guide,ql-copy-editor'],
 ['public-space-photo','在公开位置记录之后','核对观察范围、作者记录和素材使用条件。选择不会误导区域状态的照片说明，解释未进入的地方以及可替代信息。','ql-nature-guide,ql-photographer,ql-rights-coordinator'],
 ['readable-visual','好看也要让人看懂','以游客阅读困难为线索，比较颜色、地名和正文条件。调整版式与文字，说明工程检查和尚待真人验证的部分。','ql-senior-visitor,ql-access-consultant,ql-copy-editor'],
 ['version-repair','发现属性写错以后','从学员旧版和平台显示定位影响，回到来源和版本核查。交付更正说明、替换方案与逐端更新顺序。','ql-visual-apprentice,ql-platform-reviewer,ql-verifier'],
 ['self-production','不用外来素材能否完成','从表达目标出发，讨论自采、文字或示意的组合，核对公开观察限制。完成能达到内容目标且来源可说明的独立方案。','ql-practitioner,ql-nature-guide,ql-science-editor'],
 ['audience-fit','风景宣传与服务信息怎么分','核对游客问题、服务决定和视觉表达，选择哪些画面适合作背景、哪些会冲淡重要条件。交付面向明确受众的视觉作品说明。','ql-visitor-service,ql-duty-manager,ql-copy-editor'],
];
const rain: readonly PathSeed[] = [
 ['warning-decision','预警等于闭园命令吗','分别核对预警主体、值班决定和检查覆盖。制作带范围与时点的服务稿，明确尚未得到的复开确认。','ql-weather-reader,ql-duty-manager,ql-specialist','ql-schedule'],
 ['already-here','已经到大厅的人怎么办','调查大厅咨询、摆渡回执与后勤准备，区别实际可用与拟安排服务。完成给已到访者的简明说明与后续更新安排。','ql-visitor-service,ql-shuttle,ql-logistics'],
 ['before-departure','尚未出发的游客需要什么','核对当前管理说明与游客误解，再调整文案。提供可核实的状态和更新渠道，不把未知时刻变成保证。','ql-duty-manager,ql-feedback,ql-copy-editor'],
 ['partial-area','一段步道代表整个景区吗','从公开观察和巡护范围对照值班说明，区分局部、全区和未知区域。完成不夸大关闭也不顺带保证开放的报道。','ql-nature-guide,ql-specialist,ql-duty-manager'],
 ['old-screenshot','流传截图缺了日期','回到原件和版本对照，询问服务方当前确认。定位截图省略如何改变含义，交付面向旧信息读者的更正说明。','ql-librarian,ql-verifier,ql-duty-manager'],
 ['shuttle-scope','计划班次等于当前可坐吗','核对摆渡计划、实际回执与到访者需求。写清起终点与未确认延伸段，安排下一次更新而不编造实时车辆信息。','ql-shuttle,ql-visitor-service,ql-duty-manager'],
 ['supply-count','物资够不够能怎样说','对照准备、领取和待核记录，再听取接待与回访。选择记录能支持的指标，说明缺口，避免把准备量写成服务人数。','ql-logistics,ql-visitor-service,ql-feedback'],
 ['accessible-notice','公告不是每个人都看得懂','从一位游客的具体困惑追到可读性检查与文案修改。保留范围条件，完成可读服务稿，并明确缺少真人验证。','ql-senior-visitor,ql-access-consultant,ql-copy-editor'],
 ['photo-rumor','晴天照片证明恢复正常吗','核对照片时点、制作记录和管理决定。决定是否替换或补历史属性，回应画面与实时标题组合造成的误解。','ql-photographer,ql-practitioner,ql-duty-manager'],
 ['uncertain-update','没有新结论时怎样更新','对照复核安排、版本缺口和公众反馈。选择说明当前进度、保持未知或缩小表述，交付有下一步渠道而无虚构时刻的更新。','ql-verifier,ql-duty-manager,ql-feedback'],
 ['science-boundary','科普解释不等于现场结论','听取一般机制、观察范围与预警解释，逐句检查是否越过证据。完成可理解的背景段落和独立的当前状态段落。','ql-science-editor,ql-nature-guide,ql-weather-reader'],
 ['multi-end-update','信息变化后如何通知到人','定位旧公告、游客误解与不同端口显示，核实变化后安排逐端修订。交付正文、修订理由和可追踪的更新计划。','ql-feedback,ql-platform-reviewer,ql-copy-editor','ql-schedule'],
];

export function fieldPathsV3(courseId: string, lesson: ExplorationLesson): ExplorationLesson['strategies'] {
 const seeds = courseId === 'course-xunpu-intangible-media' ? xunpu : courseId === 'course-village-super-multiplatform' ? sports
  : courseId === 'course-village-super-postpublication-context' ? response : courseId === 'course-ai-tourism-copyright-governance' ? visual
  : courseId === 'course-scenic-rain-emergency-reporting' ? rain : null;
 if (!seeds) throw new Error(`未编排调查路径：${courseId}`);
 const knownMaterials = new Set(lesson.materials.map(item => item.id));
 return seeds.map(([id,title,question,people,materials]) => {
  const evidenceNpcIds = people.split(',');
  return { id: `${courseId}-${id}`, title, question, evidenceNpcIds, flag: null,
   materialIds: [...new Set([...(materials?.split(',') ?? []), ...evidenceNpcIds.map(npcId => `${npcId}-record`).filter(ref => knownMaterials.has(ref))])] };
 });
}

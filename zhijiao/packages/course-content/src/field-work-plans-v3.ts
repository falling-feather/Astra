import { FieldWorkPlanV3Schema, type FieldWorkArtifactV3, type FieldWorkPlanV3 } from '@ronggang/contracts';
import { deepFreeze, hashCanonical } from './canonical.js';
import { xunpuFlagshipContentManifestV3 } from './xunpu-flagship-content-v3.js';
import { xunpuCourseRelease } from './xunpu-course.js';
import { villageSuperKnowledgeRecords, aiCopyrightKnowledgeRecords, rainEmergencyKnowledgeRecords } from './migration-knowledge.js';
import { villagePostpublicationKnowledgeRecords } from './village-postpublication-case.js';
import { professionalTrainingKnowledgeRecords } from './professional-training.js';

const allLevels = [3,4,5,6,7] as const;
function artifact(id: string, title: string, labels: Record<string,string>, checks: string[], options: { optional?: boolean; minimums?: Record<string,number> } = {}): FieldWorkArtifactV3 {
  const source = xunpuFlagshipContentManifestV3.artifacts.find(artifact => artifact.artifactId === id);
  if (!source) throw new Error(`Unknown work artifact: ${id}`);
  return { ...structuredClone(source), title, requiredAtChallengeLevels: options.optional ? [] : [...allLevels],
    editableFields: source.editableFields.map(field => ({ ...field, label: labels[field.fieldId] ?? field.label,
      minimumLength: options.minimums?.[field.fieldId] ?? field.minimumLength })),
    completionChecks: checks, evidenceRequirements: [] };
}
const reflection = (scenario: string) => artifact('artifact-transfer-reflection','本次判断与下一次练习',{
  critical_decisions:'我怎样作出关键判断',ai_decisions:'人物或AI的建议，我如何取舍',next_job_transfer:'换一个条件，我会怎样调整',
}, [`结合${scenario}说明至少一个具体判断，而非只列操作顺序。`,'说明仍然不知道的部分与后续核验办法。','写出可以在下一次练习中实行的改进。'],{minimums:{critical_decisions:80,ai_decisions:40,next_job_transfer:60}});
function plan(courseId: string, title: string, objectives: string[], sourceKnowledgeIds: string[], artifacts: FieldWorkArtifactV3[]): FieldWorkPlanV3 {
  const body = { schemaVersion:'field-work-plan/3.0.0' as const, manifestId:`work-plan-${courseId}-v3`, courseId,version:1,title,expectedDurationMinutes:55,
    artifacts,sourceKnowledgeIds:[...new Set(sourceKnowledgeIds)],learningObjectives:objectives };
  return deepFreeze(FieldWorkPlanV3Schema.parse({...body,contentHash:hashCanonical(body)}));
}

export const fieldWorkPlansV3: ReadonlyArray<FieldWorkPlanV3> = [
  plan('course-xunpu-intangible-media','蟳埔社区 · 采访与报道成果',[
    '从生活与具体劳动提出有公共价值的采访问题。','以多种人物和资料形成有范围的描述。','尊重采访、记录与公开使用的不同意愿。',
  ],[...xunpuCourseRelease.knowledgeRecords,...professionalTrainingKnowledgeRecords].map(record=>record.knowledgeId),[
    artifact('artifact-topic-brief','选题与受众',{angle:'我想讲清的社区问题',audience:'这份报道主要写给谁',public_value:'为什么值得报道',risk_plan:'取材安排与边界'},['围绕真实生活提出角度，不只展示外观。','受众与问题清楚，保留可能需要调整的地方。']),
    artifact('artifact-interview-plan-log','采访与关系协商',{questions:'有效问题、追问与得到的回应',consent:'人物愿意公开的范围'},['区分亲历、转述与个人看法。','不把认识、好友或引荐当成任意记录许可。']),
    artifact('artifact-fact-check-sheet','关键事实核对',{fact_items:'决定作品含义的事实及核对结果',final_wording:'哪些话需要保留条件'},['区分方法资料、现实公开背景与本场仿真记录。','不同来源不能确认的部分保持未知。']),
    artifact('artifact-feature-story','社区报道正文',{},['人物经历有具体出处，不给未采访者补台词。','呈现生活、工作与不同立场，避免单一猎奇描述。','说明采用素材和AI辅助的范围。']),
    artifact('artifact-publication-correction-decision','公开与后续跟进',{publication_plan:'拟公开范围与跟进安排',correction_note:'如果出现异议，我如何处理'},['公开方式与当事人的约定相符。','需要继续核验时可以明确延后或缩小表述。']),
    reflection('本次社区采访'),
    artifact('artifact-source-matrix','信源对照（选做）',{},['用于梳理复杂来源，不作为强制资料勾选。'],{optional:true}),
    artifact('artifact-rights-ledger','素材使用记录（选做）',{},['逐项说明来源与已确认的用途。'],{optional:true}),
  ]),
  plan('course-village-super-multiplatform','榕江赛事 · 多平台报道成果',[
    '从群众赛事中的人、协作与服务需要组织报道。','核对赛程、统计时点、采访语境与素材条件。','为图文、短视频脚本和快讯作出不同表达选择。',
  ],villageSuperKnowledgeRecords.map(record=>record.knowledgeId),[
    artifact('artifact-topic-brief','报道任务与受众',{angle:'这场赛事中值得关注的问题',audience:'主要服务的观众',public_value:'报道对观众和社区的价值',risk_plan:'采访、核验与交付安排'},['不能以热度代替具体新闻价值。','明确计划信息与已经发生的事实。']),
    artifact('artifact-interview-plan-log','人物采访与协作',{questions:'我怎样理解不同岗位的工作',consent:'原话、声音和画面使用的约定'},['从球员、志愿者、社区或保障岗位获得实质信息。','记录原话的上下文和实际协商结果。']),
    artifact('artifact-fact-check-sheet','赛程、数字与素材核对',{fact_items:'我核对过的数字、时点和说法',final_wording:'报道中保留的条件与未知项'},['计划人数不等于实到，赛中数据不等于最终确认。','不直接比较不同窗口的传播统计。']),
    artifact('artifact-feature-story','图文报道',{},['使读者看懂事件与人物的关系。','把观察、原话、公开背景和个人判断分开。','避免用团队成员的一句话替全队表态。']),
    artifact('artifact-multiplatform-script','短视频脚本与现场快讯',{},['各平台可以调整结构，关键事实与条件保持一致。','分镜对应可用材料，快讯交代时点。','不用未获准的近景或断章取义的话制造戏剧性。']),
    reflection('赛事报道中的信息取舍'),
    artifact('artifact-rights-ledger','素材授权备忘（选做）',{},['文件可取得不等于所有使用方式均已获准。'],{optional:true}),
  ]),
  plan('course-village-super-postpublication-context','榕江赛事 · 发布后回应成果',[
    '定位公众质疑涉及的具体作品版本与表述。','核对完整采访、适用条件和受影响对象。','选择更正、补充语境、维持或暂缓，并向受众说明理由。',
  ],villagePostpublicationKnowledgeRecords.map(record=>record.knowledgeId),[
    artifact('artifact-topic-brief','界定需要回应的问题',{angle:'哪一处表述受到了质疑',audience:'受影响的人和需要回应的读者',public_value:'回应应解决什么问题',risk_plan:'先核实什么，怎样避免扩大误解'},['记录具体表述和版本，而不是笼统承认或否认。','不把投诉量、情绪强度直接当事实证明。']),
    artifact('artifact-interview-plan-log','回访与沟通记录',{questions:'我向谁核对了什么',consent:'当事人的回应和公开边界'},['回到原问题、原话与语境，允许不同立场存在。','不以加好友或取得引荐代替独立核实。']),
    artifact('artifact-fact-check-sheet','旧表述与核查结果',{fact_items:'旧表述、现有依据与仍待核实的部分',final_wording:'我最终保留或修订的表述'},['明确发现的是事实错误、语境缺失还是观点分歧。','只有新依据成立时才改变结论。']),
    artifact('artifact-feature-story','面向公众的回应或更正稿',{headline:'回应标题',lead:'需要先告诉读者的变化',body:'回应正文与可核对的说明',disclosure:'依据、版本与AI辅助说明'},['明确回应哪一版作品和哪一处表述。','承认已证实的问题，不给未知部分编造结论。','维持原判断也应说明核验过程与理由。'],{minimums:{body:220,lead:30}}),
    artifact('artifact-publication-correction-decision','多端更新与后续跟进',{publication_plan:'受影响的渠道和更新顺序',correction_note:'更正、补充、维持或暂缓的决定'},['对照实际受影响的版本安排更新。','不以静默替换掩盖必要的说明。','保留继续回访与收集反馈的方法。']),
    reflection('一次发布后的异议处理'),
  ]),
  plan('course-ai-tourism-copyright-governance','青岚视觉 · 素材与发布方案',[
    '区分画面来源、生成属性和可核实的现实内容。','逐项核对素材的权利主体、用途与限制。','在表达目标、许可范围与标识要求之间选择可行方案。',
  ],aiCopyrightKnowledgeRecords.map(record=>record.knowledgeId),[
    artifact('artifact-topic-brief','视觉任务与表达选择',{angle:'这份视觉作品要讲清什么',audience:'面向的读者或游客',public_value:'内容价值与表达原则',risk_plan:'需要查清的素材问题'},['视觉吸引力服务内容目的。','生成画面不能被描述成当日实拍。']),
    artifact('artifact-rights-ledger','素材谱系与使用范围',{materials:'素材、作者、获取方式和生成属性',permission_scope:'已确认用途、平台与仍缺的条件'},['按具体文件核对，不把一人的授权扩大给全部素材。','保留许可主体、范围和不确定性。']),
    artifact('artifact-fact-check-sheet','素材核验与替代选择',{fact_items:'我核对的来源、属性与疑点',final_wording:'无法使用时采用什么替代方式'},['能够解释为何保留、替换或暂不用某份素材。','不把元数据缺失直接解释成确定来源。']),
    artifact('artifact-feature-story','视觉方案与作品说明',{headline:'作品名称',lead:'主要内容与视觉结构',body:'文案、素材组合及表达选择说明',disclosure:'生成属性与来源说明'},['说明素材与信息之间的关系，而非只列制作工具。','标注实际使用的AI辅助，不为未发生的拍摄制造现场感。','所选方案在已确认的使用范围内。'],{minimums:{body:280,lead:30}}),
    artifact('artifact-publication-correction-decision','发布标识与异议处理',{publication_plan:'生成属性如何向受众交代',correction_note:'发现权限或表述问题如何处理'},['区分显式说明与文件中的隐式标识。','根据实际使用场景交代属性和责任，不恶意隐匿生成信息。']),
    reflection('素材取舍与创作边界'),
  ]),
  plan('course-scenic-rain-emergency-reporting','青岚服务 · 动态信息成果',[
    '持续核对预警、管理决定、现场观察和更新时点。','服务不同处境的游客，清楚说明适用范围。','在信息变化时及时调整稿件，并保留仍然未知的部分。',
  ],rainEmergencyKnowledgeRecords.map(record=>record.knowledgeId),[
    artifact('artifact-topic-brief','受众问题与采集安排',{angle:'眼下最需要说明的问题',audience:'当前信息要帮助谁',public_value:'这条信息解决什么需要',risk_plan:'安全取材与核验安排'},['区分尚未出发与已在现场的受众。','不为取材进入未开放或缺乏保障的区域。']),
    artifact('artifact-interview-plan-log','岗位联络与需求记录',{questions:'向哪些岗位确认了什么',consent:'受访者信息与隐私边界'},['确认每个人实际负责和检查的范围。','沟通救助或服务需要时保留必要信息边界。']),
    artifact('artifact-fact-check-sheet','状态与时间线核对',{fact_items:'各时点已确认、待核实和被替换的信息',final_wording:'不能扩大解释的条件'},['预警不等于具体管理决定，局部观察不等于全区状态。','复开需要相应主体的新确认。']),
    artifact('artifact-feature-story','面向游客的服务信息',{headline:'服务信息标题',lead:'最先需要知道的已确认事项',body:'适用对象、区域、时间和后续信息获取方式',disclosure:'来源与更新时间'},['简明说明谁、哪里、何时适用。','不以模糊的全区安全或全部关闭代替核验。','尚未有新确认时明确说明等待更新。'],{minimums:{body:180,lead:30}}),
    artifact('artifact-publication-correction-decision','更新与更正安排',{publication_plan:'信息变化时怎样更新不同渠道',correction_note:'怎样让读者识别被替换的旧说法'},['更新有版本和理由，避免多个平台互相矛盾。','不能核实的传言保持待核，不通过重复扩大传播。']),
    reflection('持续变化的信息服务'),
  ]),
];

import { hashCanonical, validateExplorationLesson, xunpuV4AdaptationVariants, type ExplorationChoice, type ExplorationLesson } from "@ronggang/course-content";
import type { LearnerAdaptationVariantRefV4 } from "@ronggang/contracts";

/** Compile the chosen follow-up into the interview engine students actually use. */
export function deriveAdaptiveFieldLesson(base: ExplorationLesson, variantId: LearnerAdaptationVariantRefV4): ExplorationLesson {
  if(base.workPlan)return deriveCourseAdaptation(base,variantId);
  const variant = xunpuV4AdaptationVariants.find(item => item.variantId === variantId);
  if (!variant) throw new Error("后续训练引用未知变式");
  const { contentHash: _previousHash, ...body } = structuredClone(base);
  body.lessonId = `field-adapt-${hashCanonical({ base: base.contentHash, variantId, policy: 1 }).slice(0, 24)}`;
  body.version = "1.0.0";
  body.title = `${base.title}｜${variant.title}`;
  body.assignment = `${base.assignment}\n下一轮训练：${variant.title}。${variant.npcResistance}${variant.evidenceAvailability}${variant.deadlinePattern}`;
  const prerequisite = (id: string, flag: string, explanation: ExplorationChoice) => {
    const choice = body.choices.find(item => item.id === id);
    if (!choice) throw new Error(`冻结课程缺少后续训练所需安排：${id}`);
    choice.requires = [...new Set([...choice.requires, flag])];
    if (!body.choices.some(item => item.id === explanation.id)) body.choices.push(explanation);
  };
  const agreement = (id: string, npcId: string, label: string, response: string, flag: string, keywords: string[]): ExplorationChoice => ({
    id, npcId, label, response, keywords, flags: [flag], requires: [], excludes: [flag], minutes: 1, effect: "flag",
    materialIds: [], delayMinutes: 0, targetNpcId: null, exclusiveGroup: null,
  });
  if (variantId === "variant-xunpu-source-triangulation") {
    const mail = body.choices.find(item => item.id === "chen-mail")!;
    mail.delayMinutes = 9;
    mail.response = "这次核对要久一些，我九分钟内发资料说明。你可以先对照公开原文与转引，标出能确认和仍缺的内容。";
    body.people.find(item => item.id === "entity-researcher")!.clarification = "先说清你要核对的具体主张与原件定位；等邮件期间也可以继续自行查证。";
  } else if (variantId === "variant-xunpu-consent-negotiation") {
    prerequisite("ahuan-scope", "resident-purpose-clarified", agreement("ahuan-explain-purpose", "entity-community-source",
      "先说明学生记者身份、教学用途与拟公开范围", "先确认你以学生记者身份作课堂练习。具体文字、画面与公开引用请再分别约定，这一步尚未同意录制。",
      "resident-purpose-clarified", ["说明身份", "教学用途", "公开范围", "学生记者"]));
  } else if (variantId === "variant-xunpu-deadline-service") {
    body.people.find(item => item.id === "entity-public-liaison")!.onSiteUntilMinute = 12;
    const update = body.materials.find(item => item.id === "material-service-update")!;
    update.body = update.body.replace(/前\d+分钟/u, "前12分钟");
    update.locator = "本场进阶训练补充回执；前12分钟现场咨询，之后工作消息回复";
  } else {
    prerequisite("wu-limited", "commercial-credit-clarified", agreement("wu-credit-check", "entity-shopkeeper",
      "明确素材提供关系并保留记者选题决定权", "可以说明样片由店家提供，记者保留选题决定权。作者、人物和跨平台使用仍待核对，这不是完整许可。",
      "commercial-credit-clarified", ["提供关系", "选题决定权", "披露条件", "披露合作"]));
  }
  const lesson = { ...body, contentHash: hashCanonical(body) };
  const problems = validateExplorationLesson(lesson);
  if (problems.length) throw new Error(`后续采访课未通过发布校验：${problems.join("；")}`);
  return lesson;
}

/** New courses keep their cast and facts; the adaptation changes an executable investigation condition. */
function deriveCourseAdaptation(base:ExplorationLesson,variantId:LearnerAdaptationVariantRefV4):ExplorationLesson {
 const variant=xunpuV4AdaptationVariants.find(item=>item.variantId===variantId);
 if(!variant)throw new Error('后续训练引用未知变式');
 const targets:Record<string,{source:string;consent:string;deadline:string;commercial:string}>= {
  xunpu:{source:'entity-researcher',consent:'entity-community-source',deadline:'entity-public-liaison',commercial:'entity-shopkeeper'},
  rongjiang:{source:'rg-specialist',consent:'rg-practitioner',deadline:'rg-volunteer-organizer',commercial:'rg-partner'},
  qinglan:{source:'ql-verifier',consent:'ql-photographer',deadline:'ql-duty-manager',commercial:'ql-rights-coordinator'},
 };
 const region=base.region?.id,roles=region?targets[region]:undefined;
 if(!roles)throw new Error('本课程缺少可执行的后续训练配置');
 const mode=variantId==='variant-xunpu-source-triangulation'?'source':variantId==='variant-xunpu-consent-negotiation'?'consent':variantId==='variant-xunpu-deadline-service'?'deadline':'commercial';
 const {contentHash:_hash,...body}=structuredClone(base),person=body.people.find(item=>item.id===roles[mode]);
 if(!person)throw new Error('本课后续训练的目标人物不存在');
  const prefix=`followup-${mode}`,finish=(extra:string)=>{
  body.adaptedFromLessonHash=base.adaptedFromLessonHash??base.contentHash;
  body.lessonId=`field-adapt-${hashCanonical({base:base.contentHash,variantId,policy:2}).slice(0,24)}`;body.version='3.0.0';body.title=`${base.title}｜${variant.title}`;
  body.assignment=`${base.assignment}\n本轮增加的训练条件：${extra} 作品要求保持本课原定目标；过程变化用于练习，不要求故意犯错或走完全部地点。`;
  const lesson={...body,contentHash:hashCanonical(body)},errors=validateExplorationLesson(lesson);if(errors.length)throw new Error(errors.join('；'));return lesson;
 };
 const agreement=(id:string,label:string,response:string,flags:string[],requires:string[]=[],materialIds:string[]=[]):ExplorationChoice=>({id,npcId:person.id,label,response,keywords:[label],flags,requires,excludes:flags,minutes:1,effect:'flag',materialIds,delayMinutes:0,targetNpcId:null,exclusiveGroup:null});
 if(mode==='source'){
  const refs=[...new Set((body.strategies[0]?.evidenceNpcIds??[]).map(id=>body.people.find(item=>item.id===id)?.topics.flatMap(topic=>topic.materialIds)[0]).filter((id):id is string=>Boolean(id)))].slice(0,2);
  if(refs.length<2)throw new Error('多源核查训练缺少两种可取得的来源');
  body.choices.push(agreement(`${prefix}-compare`,'带两份实际取得的材料讨论范围','我们逐项对照来源、时点和适用范围。取得两份材料只是讨论的起点；它们是否支持你的具体判断，仍要在作品里说明。',[`${prefix}-discussed`],refs.map(id=>`acquired-material:${id}`)));
  person.clarification='先取得两份相互可对照的材料，再带着具体主张来讨论；我不会只因你称它为权威来源就认可。';
  return finish(`与${person.name}进行范围对照前，需要实际取得两种相关材料。你仍可选择其他来源或有理由地保留未知。`);
 }
 if(mode==='consent'||mode==='commercial'){
  const purpose=mode==='consent'?'说明采访目的和拟公开范围':'说明素材提供关系和编辑决定权';
  body.choices.push(agreement(`${prefix}-purpose`,purpose,'我了解了你的目的。这一步只是确认沟通前提，具体文件、记录方式与用途还需要分别商量。',[`${prefix}-purpose-agreed`]));
  body.choices.push(agreement(`${prefix}-scope`,'确认本次文字说明的有限使用','本次仅同意在课堂作品中引用已经核对的文字，保留原意和提供关系；人物近景、声音、其他文件及公开平台使用不在这个约定里。',[`${prefix}-scope-agreed`],[`${prefix}-purpose-agreed`]));
  if(person.social&&person.social.supportsContact)person.social.contactThreshold=Math.min(40,person.social.contactThreshold+6);
  return finish(`和${person.name}先说明目的，再协商具体范围。新增约定只覆盖已核对的课堂文字；你可以拒绝不适合的合作或改用其他材料。`);
 }
 const update=`${prefix}-update`;
 const updateText=region==='rongjiang'?'补充回执V2：之前空白的接班回执已经补核，该点已有人接班。它只更新这一个点位，不证明全场所有服务没有问题；旧版待核状态与本次确认应按时点分别说明。'
  :region==='qinglan'?'补充回执V3：本轮仍维持A段暂停，没有形成复开决定；已确认服务范围不因等待新结论而自动扩大。发布时保留本轮确认和下次更新渠道。'
  :'补充回执V3：资料联络点咨询转至出入咨询点，已确认的公共服务继续；没有新增进入居民私人空间的许可。位置调整、服务状态和进入意愿分别说明。';
 body.materials.push({id:update,title:'本轮补充核对回执',nodeId:null,kind:'simulation',description:'只有约定资料实际送达后才能取得。',body:updateText,sourceUrl:null,locator:'后续训练中的仿真回执，以实际送达事件为准',knowledgeRefs:[],requires:[],evidenceStatus:'scenario_record'});
 person.onSiteUntilMinute=12;
 body.choices.push({...agreement(`${prefix}-mail`,'约定补发本轮核对回执','我约五分钟后发补充回执。在它真正送达之前，请保留未知；你可以先查其他公开资料。',[],[],[update]),effect:'promise',delayMinutes:5});
 body.choices.push({...agreement(`${prefix}-remind`,'催办本轮尚未收到的回执','刚才处理别的事耽误了，我两分钟后补发。收到后再核对变化，不必停止其他调查。',[`${prefix}-reminded`],['expert-mail-overdue'],[]),effect:'remind',delayMinutes:2});
 person.topics.unshift({id:`${prefix}-availability`,title:'本轮咨询与回执安排',keywords:['咨询时段','补充回执','这轮安排'],response:'我在本场前十二分钟接待，之后处理后台工作。可以先认识并互留工作联系方式，再约定补发回执；回执未到时，不要预先写成已确认。',materialIds:[]});
 return finish(`${person.name}的现场接待缩短到前12分钟，新的补充回执需要实际约定、跟进并等到送达；其余公开来源仍可继续调查。`);
}

import { deepFreeze, hashCanonical } from './canonical.js';
import type { ExplorationLesson } from './xunpu-exploration-lesson.js';

interface BriefVariant { id:string;title:string;audience:string;brief:string;packet:string;liaison:string; }
const variants: Record<string,readonly BriefVariant[]> = {
 'course-xunpu-intangible-media':[
  {id:'daily-work',title:'成品之外的日常',audience:'初次了解社区生活的年轻读者',liaison:'xp-field-editor',brief:'从花材、修网、分拣、清洁或住户生活中选择一个具体过程，让读者理解其中的判断与协作。',packet:'编辑收到的初稿只有成品和游客热闹镜头，尚没有日常劳动的具体采访。本次需要补充一个能独立成立的生活切口。可以更换最初设想的人物，不必沿固定采访顺序推进。'},
  {id:'first-visit',title:'把参观和消费说明白',audience:'准备第一次来访、关心参观与公共服务的读者',liaison:'entity-public-liaison',brief:'调查一处容易误解的服务信息，听取使用者与提供者的解释，再形成清楚而有范围的报道。',packet:'收到的问题包括：看工坊是否必须购买摄影服务、咨询结束是否等于街区关闭、公共巷道能否随意进入居民家。它们是本次待调查问题，不预设商户或游客哪一方有错。'},
  {id:'learning',title:'一次体验之后留下什么',audience:'希望了解技艺学习过程的职教学生',liaison:'xp-learning-coordinator',brief:'从一个具体步骤、学员修改或反馈展开，区分观看、体验和独立掌握。',packet:'编辑拟用“来一次就学会整套技艺”作标题，但还没有支持材料。你需要调查这个说法能否成立，也可以重新选择角度，呈现一次学习中真正发生的变化和仍未掌握的部分。'},
  {id:'memory',title:'流传说法从哪里来',audience:'希望读懂文化背景而不只看外观的读者',liaison:'entity-researcher',brief:'拆开一个流传说法，对照口述、公开原文与实践者理解，完成有来源层次的解释性报道。',packet:'选题会上把旧照片年份、习俗名录身份、技艺标准发布和文旅案例入选混在了一起。你可以从任一具体疑问开始；没有精确日期时保留缺口，不以全部查完作为交付前提。'},
 ],
 'course-village-super-multiplatform':[
  {id:'team-before-match',title:'上场之前的协作',audience:'想理解群众赛事如何运转的观众',liaison:'rg-documentary-editor',brief:'从球员配合或后台准备切入，交付图文报道、短视频脚本和简明快讯。',packet:'本次尚没有最终赛果，不能拿准备表写成比赛结果。画面计划原先只对着明星球员，你可以保留人物主线，也可以改从维护、队务和志愿协作讲起。'},
  {id:'useful-visit',title:'第一次来看比赛',audience:'初次到访、需要清楚服务信息的观众',liaison:'rg-spectator-service',brief:'选择入口、无障碍信息、换班或咨询中的具体问题，让报道兼有故事和使用价值。',packet:'旧入口图仍在转发，当前入口提示已更换；两个计数表的口径也不同。快讯需要注明适用时点。没有真实使用者测试时，交付中说明已做检查和尚待验证的部分。'},
  {id:'community-expression',title:'赛事中的社区表达',audience:'想了解参与者选择而非只看热闹的读者',liaison:'rg-culture-performer',brief:'调查文化排练、经营或亲友协作，呈现参与者自己的目标与不同立场。',packet:'策划草案想把所有表演称为“一成不变的原生态”，同时用排队镜头证明全街收入增长。两项都是待核主张，你可以调查其中一个并形成独立报道，不必认同原策划。'},
  {id:'beyond-highlight',title:'没有独家进球镜头',audience:'希望看到过程与背景的多平台读者',liaison:'rg-photographer',brief:'在缺少预想中的关键画面时重新组织素材，找到仍能完成的报道角度。',packet:'这次可核查的照片中，A是本场训练，B是上一次排练，C作者待确认。你没有本场独家进球镜头，可以转向过程、解释或服务，不得把历史画面冒充当前现场。'},
 ],
 'course-village-super-postpublication-context':[
  {id:'quote',title:'一句遗憾被剪成指责',audience:'看过原短视频的观众与受访球员',liaison:'rg-sport-volunteer',brief:'核对原话、问题和剪辑语境，决定更正、补充、维持或暂缓，并解释理由。',packet:'待核旧版V1：标题“球员不满队友配合”，片段只保留杨启明“有些遗憾”。完整记录中，他是在回答自己处理球的感受。公开质疑指出字幕是否把个人反思改成了指责。V1为教学编排，不是学生已发布的作品。'},
  {id:'metrics',title:'热度翻倍依据可靠吗',audience:'引用过旧数字的读者与编辑',liaison:'rg-data-analyst',brief:'定位指标和窗口差异，检查数字错误是否影响结论，安排逐端回应。',packet:'待核旧版V1：根据甲表首小时100次曝光和乙表截至观察结束累计200次播放，写成“赛事热度翻倍，游客增加一倍”。两表指标与窗口不同，不能直接得到上述结论。数字只属于本课模拟，需向数据和入口岗位核查含义。'},
  {id:'roster',title:'一格空白变成全部缺岗',audience:'受报道影响的志愿者与观众',liaison:'rg-volunteer-organizer',brief:'区分缺少回执、已确认缺岗与整体结论，回访相关岗位并向公众说明。',packet:'待核旧版V1：看到换班表一格回执为空，标题写“志愿岗位全部无人值守”。原表有六个值守点，其中一个接班回执待补；空白原因尚未完成复核。应针对这项主张调查，不预先认定每一项服务都没有问题。'},
  {id:'photo-time',title:'历史排练图写成当日比赛',audience:'被图片说明影响的观众与素材作者',liaison:'rg-photographer',brief:'核对画面时点与发布语境，决定换图、补说明或停止使用，保留更新理由。',packet:'待核旧版V1：把摄影卡B配成“今天赛场现场”，并据图说明当前看台人数。B实际属于上一次公开排练，画外及本场人数不能由它确认。需检查图文、字幕和快讯哪些端口复用了同一说明。'},
 ],
 'course-ai-tourism-copyright-governance':[
  {id:'mixed-sources',title:'来源混合的一组好画面',audience:'准备阅读景区介绍的游客',liaison:'ql-practitioner',brief:'逐项核对照片、转发和生成画面，完成视觉方案、来源说明与发布选择。',packet:'编辑收到A历史晴天照片、B来源未确认的转发图和一张AI辅助示意。它们的属性和许可不同。选用多少素材由表达目标决定，不要求为了丰富而全部采用。'},
  {id:'expanded-use',title:'图文许可要变成多端发布',audience:'会在不同平台接触同一内容的游客',liaison:'ql-rights-coordinator',brief:'核对原许可是否覆盖新用途，协商或替换，并说明最终的素材组合。',packet:'本场已知照片A许可覆盖课程图文；新策划提出把它改成短视频封面和其他端口内容，这些新用途没有自动获得确认。学生可以继续核实、限缩发布范围或改用其他表达。'},
  {id:'realistic-illustration',title:'示意越逼真越要说清',audience:'容易把画面理解成实时状态的读者',liaison:'ql-science-editor',brief:'让背景解释与本场事实分别呈现，处理画面的生成属性和受众可见说明。',packet:'视觉草案想用AI生成的晴朗步道图搭配“现在一切正常”。目前材料并不支持这个实时判断。你可以保留明确标识的解释性画面，也可以换方案；不能只在看不到的位置留下属性说明。'},
  {id:'repair-release',title:'素材说明需要修订',audience:'已经看过旧版的读者和发布编辑',liaison:'ql-visual-apprentice',brief:'定位旧版属性错误及受影响端口，交付修订后的视觉与公开说明方案。',packet:'学习案例V1将历史照片放在即时标题下，读者理解为当天实拍。需要对照原文件、标题、正文和不同端口说明，决定哪些部分应更正、替换或保留。案例不自动证明当前学生已经犯错。'},
 ],
 'course-scenic-rain-emergency-reporting':[
  {id:'scope',title:'暂停的是哪一段',audience:'需要确认公告范围的游客',liaison:'ql-duty-manager',brief:'分别核对预警、管理决定与现场观察，完成清楚的当前状态和后续更新说明。',packet:'当前V2确认A段步道暂停，大厅及已确认服务继续提供；未检查部分保持未知。流传说法把它扩大为整个景区关闭。没有预先确定的复开时间。所有现场设定均为教学仿真。'},
  {id:'visitor-needs',title:'人已到大厅之后',audience:'已经到访、关心服务与下一步确认的游客',liaison:'ql-visitor-service',brief:'核查休息、摆渡与服务信息，在不作额外保证的前提下写出可理解的说明。',packet:'咨询里有人问当前哪里可休息，有人把计划班次理解为全线实时运行。当前回执只确认大厅至下客点服务；延伸路线待核。物资台账也不能直接换算独立受助人数。'},
  {id:'undated-image',title:'截图没有日期之后',audience:'收到旧图、尚未出发的读者',liaison:'ql-verifier',brief:'追溯原件、版本和当前确认，写明旧信息哪些仍适用、哪些不能继续沿用。',packet:'转发截图裁掉了发布日期，把V1咨询安排和旧晴天照片放在一起，形成“全部恢复正常”的说法。需回到原件与V2管理说明，不把更新时间较新等同于所有区域状态已经确认。'},
  {id:'waiting-confirmation',title:'下一轮复核尚未结束',audience:'已经看到旧版、等待最新消息的游客',liaison:'ql-feedback',brief:'在没有新结论时说明当前进展、未知范围与更新渠道，检查各端表达是否一致。',packet:'编辑希望立即发“即将复开”，但本场只有下一轮复核安排，没有复开回执。你可以发布进度说明、维持已有范围或缩小表述，并安排面向不同受众的后续更新。不得为填满稿件编出确定时刻。'},
 ],
};

/** Four authored commissions rotate on genuinely new starts. Retries keep the already frozen session. */
export function createFieldLessonVariantV3(base: ExplorationLesson, courseId: string, practiceOrdinal: number): ExplorationLesson {
 if (!base.workPlan) return base;
 const options=variants[courseId];
 if (!options || !Number.isInteger(practiceOrdinal) || practiceOrdinal<0) throw new Error('课程情境轮次无效');
 const variant=options[practiceOrdinal%options.length]!;
 const {contentHash:_hash,...body}=structuredClone(base);
 const materialId=`brief-${courseId}-${variant.id}`;
 body.version=`${base.version}.${variant.id}`;
 body.assignment=`本次委托：${variant.title}。面向：${variant.audience}。${variant.brief} 可以选择不同调查起点、人物和取材方式，最终交付按本课工作台要求完成。`;
 body.materials.push({id:materialId,title:`本次任务来件 · ${variant.title}`,nodeId:base.initialNodeId,kind:'simulation',description:'阅读这次委托的具体来件，再决定如何调查。',body:variant.packet,
  sourceUrl:null,locator:'本场原创教学任务；与现实公告和实际学生作品分别对待。',knowledgeRefs:[],requires:[],evidenceStatus:'scenario_record'});
 const liaison=body.people.find(person=>person.id===variant.liaison);
 if (!liaison) throw new Error('课程情境的联络人物不存在');
 liaison.topics.unshift({id:`${materialId}-discussion`,title:'这次来件需要解决什么',keywords:['这次委托','任务来件','当前委托','当前任务'],response:`${variant.packet} ${variant.brief}`,materialIds:[materialId]});
 return deepFreeze({...body,contentHash:hashCanonical(body)});
}

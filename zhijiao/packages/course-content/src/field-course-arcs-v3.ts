import type {ExplorationLesson,ExplorationChoice} from './xunpu-exploration-lesson.js';

interface Arc {prefix:string;person:string;title:string;question:string;record:string;options:readonly [string,string,string][]}
const arcs:Record<string,Arc>={
  'course-xunpu-intangible-media':{prefix:'xp-handover',person:'xp-florist',title:'返工之后的一次交接',question:'你想把返工写成质量问题，还是先把交接过程核对清楚？',
    record:'花材准备交接单｜本课仿真\n09:10备料12份，已完成检查9份，3份需重挑花材；09:18邻居送来替换花材，09:24重新检查其中2份，另1份仍在处理。准备数量不等于成交。陈阿梅负责挑选，学员负责整理，交接时发现标记未对齐。\n陈阿梅：不能只拍那3份就说全部做坏了，也不要把返工完全藏掉。请分别核对为什么要重挑、谁接手、后来怎样处理。',
    options:[['跟进一次返工与交接','跟进返工','你选择跟进具体工序。联络记录：整理台留出一次交接说明，学员可说明自己接到的任务；取材范围为工具、工序与匿名工作记录。尚未完成的1份仍保持待处理，不能替它补写完成结果。'],['记录多人的协作分工','记录协作','你选择比较不同岗位的视角。联络记录：陈阿梅介绍整理岗位，建议向学员本人核对分工；可以先以文字展示协作，个人近景仍分别协商。准备表、观察时点与口述应分开标记。']]},
  'course-village-super-multiplatform':{prefix:'rg-arrival',person:'rg-liaison',title:'赛前名单与实际到场',question:'计划表列了4支队伍，你准备怎样核对它与现场的差别？',
    record:'赛前核对回执｜本课仿真\n14:00计划表列4支队伍，登记总数48；14:10签到记录显示3队共36人，另一队尚在路上，不能据此宣布退赛。14:15场地维护人员确认一处边线补画完成；正式开赛时点由裁判联络处另行确认。\n志愿者：我能确认这张签到回执，不能替裁判宣布比赛开始，也不能拿计划人数作为实际到场数。',
    options:[['先发带时间与范围的快讯','先发快讯','编辑接收了限范围快讯安排：当前只能写14:10已签到3队36人，另一队到场与开赛时点等待确认。平台把下一检查点设在14:25，后续必须对照新回执更新。'],['继续核对后制作人物报道','继续核对','编辑同意暂缓人数型快讯，转向赛前准备的人物报道。球员和保障岗位可以说明自己的工作，新的签到数字不能被上一版记录替代；报道完成时还需补核最新时点。']]},
  'course-village-super-postpublication-context':{prefix:'rg-context',person:'rg-practitioner',title:'一句原话的前后两种含义',question:'有人认为短片在指责队友，你会怎样对照完整采访？',
    record:'短片与完整采访对照｜本课仿真\nV1短片00:06—00:10原音：“最后那一下，我确实很失落。”字幕：“关键时刻，他对队友失望了。”\n完整采访01:12记者问：“你怎样评价自己最后一次处理球？”01:16球员答：“最后那一下，我确实很失落。我应该早点看清队友的位置，这是我自己的判断，下次训练要改。”\n人物回访：可以准确表达我对自己处理球的反思，不能把它写成我在责怪另一位队员。',
    options:[['补充语境并公开版本说明','补充语境','平台回执：可以在V1说明区置顶更正，保留原采访定位；V2须撤去指责队友的字幕并补回提问。人物收到修改计划，是否认可最终成片仍待实际回看。'],['暂停片段并用文字回应','暂停片段','平台回执：该片段暂时不再推荐，旧链接仍可能被转发。你选择先用文字解释原问答与修改理由，并登记待补的新版本；暂停不等于已完成全部通知。']]},
  'course-ai-tourism-copyright-governance':{prefix:'ql-license',person:'ql-rights-coordinator',title:'一张图的许可并不覆盖整组',question:'提供者愿意给你整组图片，你怎样逐项确定可以用的范围？',
    record:'素材许可核对单｜本课仿真\nQ01为摄影者自摄旧晴天图，允许在本课图文背景使用，须标明历史画面；不包括商业广告。Q02为第三方转发图，作者与取得路径未核实。Q03为制作人的AI示意图，可作解释示意，须说明生成属性，不能标成当日实拍。\n协调员：我只能确认自己核对的回执。Q01的许可不能覆盖Q02，Q03的生成属性也不能靠改文件名消除。',
    options:[['限定范围使用已确认素材','限定使用','素材安排已登记：仅使用Q01与Q03，分别标明历史背景与生成示意；Q02保留在待查区，不进入公开组合。后续作品仍应说明画面与文字的对应关系。'],['改用自制示意与文字方案','自制替代','素材安排已登记：不采用外来图片，改做有来源说明的文字与自制示意；省去未确认许可不等于可以编造现场画面。制作人愿意核对示意是否让人误解为现实状态。']]},
  'course-scenic-rain-emergency-reporting':{prefix:'ql-rain-update',person:'ql-duty-manager',title:'公告更新后哪些说法失效',question:'旧截图写着“一切正常”，你怎样向已经到场的游客说明最新范围？',
    record:'值班服务回执 V2｜本课仿真\n09:00预警信息提示降雨风险；09:15管理回执暂停东侧步道，未发布全区闭园决定。09:25摆渡处报告原定3班中已执行1班，余下2班等待路段检查。09:30大厅仍提供咨询，但开放咨询不证明步道安全。下一复核09:45，未承诺复开时刻。\n值班员：请把管理决定、预警和你看到的现场分开，未检查的区域不能替它宣布安全。',
    options:[['先发布限范围服务说明','发布服务说明','服务台接收了更新计划：先说明东侧步道暂停、摆渡待核与大厅咨询位置，提醒读者留意09:45复核；不得写全区安全或确定复开时间。旧截图需附上更新提示。'],['等待复核并发布进度提示','等待复核','服务台接收了进度提示：目前尚无复开结论，明确下一查询入口；等待期间可以核对不同游客的信息需要。若09:45仍未形成结论，保持未知并继续标明更新时间。']]},
};

/** Course-specific facts and mutually exclusive follow-up receipts, without assigning grades for a choice. */
export function addCourseArcV3(courseId:string,lesson:Omit<ExplorationLesson,'contentHash'>):void {
  const arc=arcs[courseId];if(!arc)return;
  const person=lesson.people.find(item=>item.id===arc.person);if(!person)throw new Error('课程调查联络人缺失：'+arc.person);
  const checked=arc.prefix+'-checked',sourceId=arc.prefix+'-record';
  lesson.materials.push({id:sourceId,title:arc.title+' · 核对原件',nodeId:null,kind:'simulation',description:'与当事人核对后获得的具体工作记录。',body:arc.record,sourceUrl:null,locator:'本课原创仿真原件；不对应现实事件',knowledgeRefs:[],requires:[],evidenceStatus:'scenario_record'});
  person.activity=arc.question;
  person.topics.unshift({id:arc.prefix+'-context',title:arc.title,keywords:['当前问题','核对记录','具体记录','这次任务'],response:arc.record,materialIds:[sourceId]});
  const choice=(id:string,label:string,keywords:string[],response:string,options:Partial<ExplorationChoice>):ExplorationChoice=>({id,npcId:person.id,label,keywords,response,requires:[],excludes:[],minutes:2,effect:'flag',flags:[],materialIds:[],delayMinutes:0,targetNpcId:null,exclusiveGroup:null,...options});
  lesson.choices.push(choice(checked,'核对这份具体工作记录',['核对原件','查看工作记录','核对这份记录'],arc.record,{flags:[checked],excludes:[checked],materialIds:[sourceId]}));
  arc.options.forEach(([label,keyword,body],i)=>{
    const id=arc.prefix+'-followup-'+i,receipt=id+'-receipt';
    lesson.materials.push({id:receipt,title:label+' · 后续回执',nodeId:person.nodeId,kind:'simulation',description:'这次调查选择所产生的后续工作安排。',body,sourceUrl:null,locator:'本课原创仿真回执；不代写或评分学生作品',knowledgeRefs:[],requires:[id],evidenceStatus:'scenario_record'});
    lesson.choices.push(choice(id,label,[keyword,label],body,{requires:[checked],flags:[id],materialIds:[receipt],exclusiveGroup:arc.prefix+'-decision'}));
  });
}

import type { ExplorationMaterial } from './xunpu-exploration-lesson.js';
import type { FieldRegionIdV3 } from './region-scenes-v3.js';

const ethics='https://www.zgjx.cn/2019-12/15/c_138632458.htm';
function source(id:string,title:string,nodeId:string,url:string,locator:string,body:string):ExplorationMaterial {
 return {id,title,nodeId,kind:'public_source',description:'公开来源的简要教学转译，可打开原文核对。',body,sourceUrl:url,locator,knowledgeRefs:[],requires:[],evidenceStatus:'public_source'};
}
export function fieldSourceLibraryV3(region:FieldRegionIdV3):ExplorationMaterial[] {
 const desk=region==='xunpu'?'xp-archive-corner':region==='rongjiang'?'rg-commentary-room':'ql-source-library';
 const common=[source(`${region}-professional-ethics`,'新闻真实与回应责任',desk,ethics,'2019年修订；第三条及相关职业规范，2026-09-12核对',
  '职业规范要求从现场和可靠来源核实信息，准确呈现事实，不人为制造新闻或歪曲原意；失实内容需要承担责任并更正。本课把这些要求转为来源核查、完整语境和公开回应练习。具体条文以原文为准。'),
  source(`${region}-professional-standard`,'融媒体岗位的学习目标',desk,'https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548141306012.pdf','教育部2025年融媒体技术与运营专业教学标准；教学转译',
   '本课将采编、制作、发布、运营与职业规范组织成可交付的岗位任务。学生需要说明面向谁、依据什么、怎样表达并在新条件下调整；实际作品和判断过程比操作数量更能体现学习成果。学习安排是本项目的教学设计，不是原标准规定的固定游戏流程。')];
 if(region==='rongjiang')common.push(source('rg-public-background','赛事报道也能看到协作与恢复','rg-community-room','https://www.news.cn/20250727/874851cbd7294c33a138fabefe77a054/c.html','新华社2025-07-27报道，事件发生于2025-07-26',
  '这篇历史报道涉及榕江村超在洪灾后恢复比赛，以及社区、援助力量和公共服务的协作。可据此提出比赛之外的采访问题。它描述的是当时事件，不能证明本课仿真人物的经历，也不能把文中历史数字改成当前数据。'));
 if(region==='qinglan')common.push(
  source('ql-ai-label-method','生成内容的可见说明与文件标识','ql-platform-desk','https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm','人工智能生成合成内容标识办法第三至六、十条；2025-09-01施行',
   '标识既包含受众能感知的说明，也包含文件数据中的信息。发布生成合成内容时，应如实声明并使用相应标识功能；不得恶意隐匿或篡改标识。本课要求学生检查实际发布端的呈现，不能只用后台记录替代受众可见说明。不同主体的具体义务需依原文适用条件判断。'),
  source('ql-seasonal-service-method','出游信息应核对哪些来源','ql-weather-corner','https://www.mct.gov.cn/whzx/whyw/202606/t20260605_966153.htm','文化和旅游部2026-06-05汛期、暑期出游提示，第一项',
   '公开提示建议关注目的地与沿途天气、相关预警和景区开放信息，并据情况调整安排。课程据此练习区分预警、管理决定与现场观察；具体暂停和复开状态仍需当时的权威确认。教学场景不提供现实天气或出行决定。'));
 return common;
}

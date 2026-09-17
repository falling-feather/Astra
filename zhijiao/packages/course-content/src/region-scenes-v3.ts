import type { ExplorationLesson } from './xunpu-exploration-lesson.js';
export type FieldRegionIdV3 = 'xunpu' | 'rongjiang' | 'qinglan';
type Node = ExplorationLesson['nodes'][number];
type SceneSeed = readonly [id: string, title: string, purpose: string];

export const regionSceneSeedsV3: Record<FieldRegionIdV3, readonly SceneSeed[]> = {
 xunpu:[
  ['loc-oyster-alley-gate','巷口','公示与来往工作，是多条调查路径的起点。'],
  ['xp-flower-market','花材准备场','跟踪花材准备、时点与供应者的劳动，不把准备数量写成成交。'],
  ['xp-tea-corner','邻里茶桌','听不同人的生活叙述，区分亲历、记忆与转述。'],
  ['xp-net-workshop','渔网修补棚','从工具与具体工序理解海边日常劳动。'],
  ['xp-working-dock','老码头作业边','在公开范围观察作业分工，核实拍摄与叙述边界。'],
  ['xp-sorting-yard','海产分拣场','追问看不见的准备工作、时间与家庭分工。'],
  ['xp-repair-lane','蚵壳厝修缮巷','辨认建筑保护、使用和更新之间的不同主张。'],
  ['loc-merchant-storefront','沿街旅拍店','素材与经营立场同时出现，由你协商使用条件。'],
  ['loc-waterfront-service-point','社区资料联络点','核对公开说明的版本、适用范围与更新来源。'],
  ['xp-workshop-foyer','传习门厅','先见面了解观摩安排，进入操作区域另行协商。'],
  ['loc-zanhuawei-workshop','手工展示工坊','在获准范围观察工序，分清示范与自己的实际操作。'],
  ['xp-learning-room','社区学习室','了解传习与学习者的变化，不把课堂示范当成普遍结论。'],
  ['xp-courtyard-threshold','居民小院门口','由住户本人决定见面、进院与记录的范围。'],
  ['loc-community-courtyard','居民小院','已经获准进入的生活空间，物件与私人信息仍有边界。'],
  ['xp-archive-corner','民俗资料阅览角','对照标准、历史资料与本场口述，保留来源各自的范围。'],
  ['xp-public-plaza','公共巷道议事处','理解游客、居民和经营者对同一空间的不同需要。'],
  ['xp-cleaning-station','清洁工作站','看见维持现场运转的劳动，讨论被忽略的公共需要。'],
  ['xp-traffic-desk','出入咨询点','区分咨询服务时段、通行信息和整个街区的状态。'],
  ['loc-mobile-edit-bay','外采编辑台','核对素材、原话与多端表达，在现场整理判断。'],
  ['loc-newsroom-desk','社区编辑工作间','让作品经受编辑提问，也保留自己的有依据判断。'],
 ],
 rongjiang:[
  ['rg-entry','赛事广场','观察不同岗位如何准备一场群众赛事。'],
  ['rg-stand-entrance','看台入口','了解观众动线、信息需要与可见范围。'],
  ['rg-working','训练场边线','从团队配合与球员自己的表达开始采访。'],
  ['rg-volunteer-tent','志愿服务帐篷','处理计划、实际到场和临时变化之间的差别。'],
  ['rg-team-office','队务工作间','核对队伍安排、人员职责与未经确认的说法。'],
  ['rg-referee-desk','裁判联络处','区分赛中记录、确认结果和个人解释。'],
  ['rg-ground-workshop','场地维护间','发现比赛画面背后的准备与协作。'],
  ['rg-culture-stage','文化排练亭','由参与者说明文化表达，不仅把表演作为视觉装饰。'],
  ['rg-food-lane','摊位小街','协商经营观点与报道独立性。'],
  ['rg-photo-desk','摄影协作点','检查拍摄时间、位置、许可与图片说明。'],
  ['rg-commentary-room','解说资料间','比较数据窗口与完整语境，避免断章取义。'],
  ['rg-edit-booth','多端编辑台','同一事实怎样进入图文、短视频脚本和快讯。'],
  ['rg-family-corner','亲友等候角','尊重个人经历和不愿公开的家庭范围。'],
  ['rg-accessible-service','无障碍服务点','让信息对不同观众可读可用。'],
  ['rg-community-room','社区协作室','核实谁代表谁、哪些是共同决定。'],
  ['rg-youth-practice','足球学习场','讨论训练、参与与成长，不替学习者编造故事。'],
  ['rg-partner-desk','合作联络台','明确合作条件与编辑选择的界线。'],
  ['rg-data-room','传播数据间','比较统计时点、指标含义与可得出的结论。'],
  ['rg-community','公众回应联络点','回到具体异议、原作品和当前已核实的信息。'],
  ['rg-desk','赛事编辑工作间','完成报道、回应与更新安排。'],
 ],
 qinglan:[
  ['ql-entry','游客中心前场','从当下服务需要进入景区信息与视觉任务。'],
  ['ql-service-hall','游客服务大厅','比较不同游客需要的信息和公告适用范围。'],
  ['ql-working','视觉制作室','区分照片、生成图像与加工后的表达。'],
  ['ql-community','步道联络站','只在公开安全范围了解已经检查的情况。'],
  ['ql-photo-room','摄影选片间','回到作者、拍摄条件与具体文件。'],
  ['ql-rights-office','素材联络室','逐项确认许可主体、用途和没有答应的部分。'],
  ['ql-source-library','数字资料阅览室','核查来源、版本和标识，避免以缺少信息推断事实。'],
  ['ql-weather-corner','气象信息阅读角','理解预警的来源与范围，不把信号当成具体处置决定。'],
  ['ql-operations-room','值班服务室','核对发布主体、更新时间与管理决定。'],
  ['ql-shuttle-desk','摆渡咨询点','处理到访与准备出发两类受众的不同需要。'],
  ['ql-family-lounge','游客休息廊','倾听个体处境，不把一位游客的说法推广全部人。'],
  ['ql-accessible-desk','无障碍咨询台','检查图文信息的可读性与可执行性。'],
  ['ql-logistics','后勤记录间','区分资源准备、实际发放和可承诺范围。'],
  ['ql-nature-room','自然教育室','把科普解释、现场观察与尚未确认的情况分开。'],
  ['ql-platform-desk','发布审核联络点','按作品的实际属性处理标识与传播。'],
  ['ql-copy-desk','信息文案间','让条件、时点和受众行动清楚呈现。'],
  ['ql-observation-deck','公开观察平台','在已开放区域观察景观，不擅自进入关闭路段取材。'],
  ['ql-data-desk','信息校验间','核对不同版本、范围和时间线。'],
  ['ql-feedback-room','游客回访点','区分误解、事实变化和需要更正的表述。'],
  ['ql-desk','山地编辑工作间','整理视觉或服务成果，保留来源与后续安排。'],
 ],
};

// Public paths deliberately offer several starting points. A visit is a choice, not a completion checklist.
const connections: Record<FieldRegionIdV3, readonly (readonly [number,number])[]> = {
 xunpu:[[0,1],[0,7],[0,8],[0,12],[1,4],[1,5],[1,9],[2,7],[2,6],[2,15],[3,4],[3,5],[3,16],[4,17],[5,16],[6,12],[6,14],[7,9],[8,14],[8,17],[8,18],[9,10],[9,11],[10,11],[10,13],[11,14],[12,13],[12,15],[13,15],[14,19],[15,19],[16,17],[17,18],[18,19]],
 rongjiang:[[0,1],[0,3],[0,8],[0,14],[1,2],[1,5],[1,13],[2,4],[2,6],[2,15],[3,9],[3,13],[3,18],[4,5],[4,12],[5,10],[6,9],[7,8],[7,14],[7,15],[8,16],[9,11],[9,16],[10,11],[10,17],[11,19],[12,14],[12,18],[13,18],[14,15],[16,17],[16,19],[17,18],[17,19],[18,19]],
 qinglan:[[0,1],[0,2],[0,3],[0,9],[1,8],[1,10],[1,11],[2,4],[2,5],[2,6],[3,7],[3,12],[3,16],[4,5],[4,13],[5,6],[5,14],[6,15],[6,17],[7,8],[7,17],[8,9],[8,18],[9,10],[10,11],[11,12],[12,13],[13,16],[14,15],[14,19],[15,18],[15,19],[16,17],[17,19],[18,19]],
};
const coordinates: Array<[number,number]> = [
 [.10,.86],[.29,.88],[.47,.91],[.69,.9],[.9,.86],
 [.9,.64],[.69,.66],[.47,.67],[.28,.65],[.09,.65],
 [.1,.4],[.3,.42],[.49,.44],[.69,.44],[.91,.41],
 [.9,.17],[.7,.17],[.5,.19],[.3,.19],[.1,.17],
];
export function regionNodesV3(region: FieldRegionIdV3): Node[] {
 const seeds=regionSceneSeedsV3[region];
 return seeds.map(([id,title,description],index)=>{
  const [x,y]=coordinates[index]!;
  const adjacent=connections[region].flatMap(([a,b])=>a===index?[b]:b===index?[a]:[]);
  return {id,title,description,requiresFlag:region==='xunpu'&&id==='loc-community-courtyard'?'courtyard-access':region==='xunpu'&&id==='loc-zanhuawei-workshop'?'workshop-invited':null,
   travelMinutes:1,image:`/assets/v3/${region}-scenes-${String(Math.floor(index/4)+1).padStart(2,'0')}.png`,imageAtlas:{columns:2,rows:2,index:index%4},map:{x,y},
   lockedHint:id==='loc-community-courtyard'?'先在小院门口征求住户本人的进入意愿。':'先在传习门厅了解并确认观摩安排。',
   exits:placeExits(index, adjacent, seeds)};
 });
}

function placeExits(origin: number, targets: number[], seeds: readonly SceneSeed[]): NonNullable<Node['exits']> {
 const [ox,oy] = coordinates[origin]!;
 const placed: NonNullable<Node['exits']> = [];
 for (const target of targets) {
  const [tx,ty] = coordinates[target]!;
  const direction = Math.atan2(ty-oy,tx-ox);
  let position = {x:0,y:0};
  for (let attempt=0;attempt<24;attempt++) {
   const offset = attempt===0?0:(attempt%2===0?-1:1)*Math.ceil(attempt/2)*Math.PI/12;
   position = {x:.5+Math.cos(direction+offset)*.39,y:.64+Math.sin(direction+offset)*.12};
   if (placed.every(item=>Math.hypot(item.x-position.x,item.y-position.y)>.15)) break;
  }
  placed.push({targetId:seeds[target]![0],...position});
 }
 return placed;
}

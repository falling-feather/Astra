import { LAB_SPACES } from './lab-catalog.js';
const importedTopics=key=>LAB_SPACES.find(space=>space.key===key).topics;
/** The learning directory and the map read the same expandable catalogue. */
const regions = [
  {
    id: 'engineering', title: '工科实验室', subtitle: '把原理放进实验里',
    description: '数学、物理、化学、算法与生物，改变条件、观察现象，在90项交互实验中探索学科规律。',
    color: '#9edcff', y: 1000, radius: 252,
    topics: importedTopics('englab'),
  },
  {
    id: 'code', title: '代码空间', subtitle: '用代码表达想法',
    description: '从第一段程序到可交互的作品，在构建中培养计算思维。',
    color: '#8ce4d8', y: 1450, radius: 246,
    topics: importedTopics('code-space'),
  },
  {
    id: 'future', title: '未来星系', subtitle: '向尚未抵达的地方',
    description: '从地球与宇宙到工程、数据、信息、材料和人文，用19项活动观察、比较并解释跨学科问题。',
    color: '#d9b4ef', y: 870, radius: 268,
    topics: importedTopics('future-galaxy'),
  },
  {
    id: 'ai', title: 'AI智境', subtitle: '与智能一起创造',
    description: '理解人工智能，学习表达需求、判断结果，并把工具用于创造。',
    color: '#efd2a1', y: 1310, radius: 255,
    topics: [
      { id: 'understand-ai', title: '理解人工智能', summary: '从日常应用认识人工智能的能力、边界与使用情境。', objectives: ['区分任务、输入与结果', '观察模型输出的不确定性', '建立验证与判断的习惯'] },
      { id: 'prompts', title: '提示与表达', summary: '把模糊想法整理成清楚、有约束、可以验证的要求。', objectives: ['描述目标与背景', '用示例澄清期待', '根据结果迭代表达'] },
      { id: 'ai-making', title: '智能应用创作', summary: '围绕一个具体需求，组合工具并构思自己的智能作品。', objectives: ['发现一个可以改善的流程', '规划人与工具的分工', '展示作品并说明其限制'] },
    ],
  },
];

export const COURSE_GALAXIES = Object.freeze(regions.map((region, index) => Object.freeze({
  ...region,
  activityCount: region.topics.reduce((sum,topic)=>sum+(topic.activities?.length||0),0),
  position: Object.freeze({ x: (index + .5) * 1800, y: region.y }),
  asset: `/assets/observatory/nebula-${region.id}${region.id==='engineering'?'-concept':''}.png`,
  topics: Object.freeze(region.topics.map(topic => Object.freeze({ ...topic, objectives: Object.freeze(topic.objectives) }))),
})));

export const PANORAMA_WORLD = Object.freeze({ width: COURSE_GALAXIES.length * 1800, height: 2600 });
export const findCourseGalaxy = id => COURSE_GALAXIES.find(region => region.id === id);

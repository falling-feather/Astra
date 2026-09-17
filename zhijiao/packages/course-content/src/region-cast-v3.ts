import { createDefaultCharacterWorkflowV3 } from '@ronggang/contracts';
import type { ExplorationMaterial, ExplorationPerson } from './xunpu-exploration-lesson.js';
import { regionSceneSeedsV3, type FieldRegionIdV3 } from './region-scenes-v3.js';

export type TopicSeedV3 = readonly [title: string, keywords: string, response: string];
export interface PersonSeedV3 {
 id: string; scene: number; name: string; role: string; goal: string; personality: string; unknown: string;
 record: readonly [title: string, body: string]; topics: readonly TopicSeedV3[]; referrals: string[];
 contact?: boolean; reserved?: boolean;
}

/** Authored facts are shared by the dialogue and its discoverable record; public methods stay in the source library. */
export function buildRegionCastV3(region: FieldRegionIdV3, seeds: readonly PersonSeedV3[]): { people: ExplorationPerson[]; materials: ExplorationMaterial[] } {
 const materials: ExplorationMaterial[] = [];
 const people = seeds.map((seed, index): ExplorationPerson => {
  const nodeId = regionSceneSeedsV3[region][seed.scene]![0];
  const materialId = `${seed.id}-record`;
  materials.push({ id: materialId, title: seed.record[0], nodeId: null, kind: 'simulation', description: `${seed.name}在本场工作中的记录与说明。`,
   body: seed.record[1], sourceUrl: null, locator: '本课原创教学仿真记录；人物、数字和约定不对应现实个体。', knowledgeRefs: [], requires: [], evidenceStatus: 'scenario_record' });
  return { id: seed.id, name: seed.name, role: seed.role, nodeId, goal: seed.goal, activity: seed.goal,
   personality: seed.personality, unknown: seed.unknown, greeting: `我是${seed.name}，负责${seed.role}。${seed.goal}。你想从哪件事聊起？`,
   clarification: `我熟悉的是${seed.role}这部分。你可以说明具体对象、时间和准备怎样使用；${seed.unknown}`,
   topics: seed.topics.map(([title, keywords, response], i) => ({ id: `${seed.id}-topic-${i + 1}`, title, keywords: keywords.split('、'), response, materialIds: [materialId] })),
   requiresFlag: null, remoteContact: seed.contact !== false,
   appearance: { image: `/assets/v3/${region}-cast-${String(Math.floor(index / 4) + 1).padStart(2, '0')}.png`, x: .36 + (index % 3) * .12, y: .92, height: .61,
    atlas: { columns: Math.min(4, seeds.length - Math.floor(index / 4) * 4), rows: 1, index: index % 4 } },
   social: { supportsContact: seed.contact !== false, initialTrust: seed.reserved ? 8 : 22, contactThreshold: seed.reserved ? 28 : 25,
    referralThreshold: seed.reserved ? 40 : 35, referralTargets: seed.referrals,
    refusal: seed.contact === false ? '我不添加采访者的私人好友。你可以在这里继续核实，或者通过公开的工作联络点留下具体问题。' : '我们还不熟。先把这次采访目的和使用范围聊清楚，再决定是否交换联系方式。' },
   workflow: createDefaultCharacterWorkflowV3() };
 });
 return { people, materials };
}

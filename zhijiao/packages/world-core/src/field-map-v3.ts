import type { FieldInterviewRecordV1 } from "@ronggang/contracts";
import type { ExplorationLesson } from "@ronggang/course-content";

export function knownFieldNodes(lesson: ExplorationLesson, record: FieldInterviewRecordV1): Set<string> {
  if (!lesson.socialLearning) return new Set(lesson.nodes.map(node => node.id));
  const known = new Set(record.visitedNodeIds);
  for (const node of lesson.nodes) {
    if (record.visitedNodeIds.includes(node.id)) for (const exit of node.exits ?? []) known.add(exit.targetId);
    if (record.flags.includes(`known-node:${node.id}`)) known.add(node.id);
  }
  return known;
}

export function fieldTravelMinutes(lesson: ExplorationLesson, record: FieldInterviewRecordV1, targetId: string): number | null {
  if (record.nodeId === targetId) return 0;
  if (!lesson.socialLearning) return lesson.nodes.find(node => node.id === targetId)?.travelMinutes ?? null;
  if (!knownFieldNodes(lesson, record).has(targetId)) return null;
  const distance = new Map([[record.nodeId, 0]]), remaining = new Set(lesson.nodes.map(node => node.id));
  while (remaining.size) {
    const next = [...remaining].filter(id => distance.has(id)).sort((a, b) => distance.get(a)! - distance.get(b)!)[0];
    if (!next) break;
    if (next === targetId) return distance.get(next)!;
    remaining.delete(next);
    for (const exit of lesson.nodes.find(node => node.id === next)?.exits ?? []) {
      const target = lesson.nodes.find(node => node.id === exit.targetId);
      if (!target || (target.requiresFlag && !record.flags.includes(target.requiresFlag))) continue;
      const candidate = distance.get(next)! + target.travelMinutes;
      if (candidate < (distance.get(target.id) ?? Infinity)) distance.set(target.id, candidate);
    }
  }
  return null;
}

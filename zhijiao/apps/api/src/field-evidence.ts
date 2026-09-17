import type { FieldInterviewEventV1, FieldInterviewRecordV1 } from "@ronggang/contracts";
import { hashCanonical, xunpuExplorationLesson, type ExplorationLesson } from "@ronggang/course-content";
import { isFieldBoundaryRequest, type SimulationSessionRecord } from "@ronggang/world-core";
import type { FlagshipEvidenceOptionV3 } from "./flagship-student-work-v3.js";

export class FieldEvidenceSourceError extends Error {
  readonly code = "source_drift";
}

export interface FieldEvidenceSource {
  option: FlagshipEvidenceOptionV3;
  event: FieldInterviewEventV1;
  sourceContentHash: string;
  material: ExplorationLesson["materials"][number] | null;
  turn: FieldInterviewRecordV1["turns"][number] | null;
}

const evidenceStatusLabels = {
  public_source: "公开来源的教学摘编",
  scenario_record: "教学仿真记录",
  unverified_claim: "待核实说法，不能直接当作已证实事实",
  reference_guide: "方法提示，不能代替本人实际核验",
  case_example: "教学案例，不能当作本场已发生事实",
};

/** Resolve only acquired, committed sources under the frozen lesson and learner identity. */
export function resolveFieldEvidence(
  world: SimulationSessionRecord,
  identity: { actorId: string; bindingId: string },
  lessons: readonly ExplorationLesson[] = [xunpuExplorationLesson],
): FieldEvidenceSource[] {
  const field = world.fieldInterview;
  if (!field) return [];
  if (field.sessionId !== world.sessionId || field.actorId !== identity.actorId || field.bindingId !== identity.bindingId) {
    throw new FieldEvidenceSourceError("采访证据与本场学生归属不一致");
  }
  const lesson = lessons.find(item => item.contentHash === field.lessonRef.contentHash
    && item.lessonId === field.lessonRef.lessonId && item.version === field.lessonRef.version);
  if (!lesson) throw new FieldEvidenceSourceError("本场采访引用的冻结课程版本未装载，原记录已保留");
  for (const event of field.events) {
    if (event.actorId !== field.actorId || event.bindingId !== field.bindingId
      || event.resultingWorldStateVersion !== event.sourceWorldStateVersion + 1
      || event.resultingWorldStateVersion > world.currentSnapshot.stateVersion) {
      throw new FieldEvidenceSourceError("采访事件归属或权威世界版本漂移");
    }
  }
  const eventFor = (reference: string) => {
    const event = field.events.find(item => item.evidenceRefs.includes(reference));
    if (!event) throw new FieldEvidenceSourceError(`采访引用没有已提交事件：${reference}`);
    return event;
  };
  const sources: FieldEvidenceSource[] = [];
  for (const id of field.materialIds) {
    const material = lesson.materials.find(item => item.id === id);
    if (!material) throw new FieldEvidenceSourceError(`采访记录引用未发布材料：${id}`);
    const event = eventFor(id);
    const status = material.evidenceStatus ?? (material.kind === "public_source" ? "public_source" : "scenario_record");
    sources.push({ material, turn: null, event, sourceContentHash: hashCanonical({ lesson: field.lessonRef, material, event }),
      option: { evidenceRef: id, kind: "world_evidence", label: `现场资料｜${material.title}`,
        detail: `${evidenceStatusLabels[status]}；${material.locator}`, eventType: "field_material_inspected" } });
  }
  for (const turn of field.turns) {
    const boundaryRequest = isFieldBoundaryRequest(turn.studentText);
    if (!turn.topicId && !turn.choiceConfirmed && !boundaryRequest) continue;
    const person = lesson.people.find(item => item.id === turn.npcId);
    const topic = person?.topics.find(item => item.id === turn.topicId);
    const choice = lesson.choices.find(item => item.id === turn.choiceId && item.npcId === turn.npcId);
    if (!person || (turn.topicId && !topic) || (turn.choiceConfirmed && !choice)) {
      throw new FieldEvidenceSourceError(`人物问答或安排与冻结课程不一致：${turn.id}`);
    }
    const event = eventFor(turn.id);
    if ((event.action.kind !== "talk" && event.action.kind !== "choose") || event.action.npcId !== turn.npcId) {
      throw new FieldEvidenceSourceError("人物回合没有对应的本人采访行动");
    }
    sources.push({ material: null, turn, event, sourceContentHash: hashCanonical({ lesson: field.lessonRef, turn, event }),
      option: { evidenceRef: turn.id, kind: "world_evidence", label: `${boundaryRequest ? "被拒绝的越界请求" : turn.choiceConfirmed ? "实际安排" : "人物问答"}｜${person.name} · ${boundaryRequest ? "记录边界" : turn.choiceConfirmed ? choice!.label : topic!.title}`,
        detail: `学生：${turn.studentText}\n${person.name}：${turn.npcText}`, eventType: boundaryRequest ? "field_boundary_request" : turn.choiceConfirmed ? "field_arrangement_confirmed" : "field_interview_question" } });
  }
  return sources;
}

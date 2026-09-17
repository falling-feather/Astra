import {
  createMessageMeta,
} from "../packages/contracts/dist/index.js";
import { hashValue } from "../packages/context-engine/dist/index.js";
import { WorldEngine } from "../packages/world-core/dist/index.js";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function command(input) {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: input.scenarioId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
    }),
    kind: "Command",
    name: input.name,
    expectedStateVersion: input.expectedStateVersion,
    payload: input.payload,
  };
}

export async function runTransferAuthoringSmoke(input) {
  const { scenario, release, runId } = input;
  ensure(
    release.ref.contentHash === hashValue(scenario),
    "不可变发布内容哈希与目标情境不一致",
  );
  const design = scenario.experienceDesign;
  ensure(design?.fixedEvaluation.teacherFinalRequired, "目标情境未要求教师终评");
  const mappingByNode = new Map(
    design.nodeMappings.map((mapping) => [mapping.nodeId, mapping]),
  );
  const briefMapping = mappingByNode.get("brief");
  const sourceMapping = mappingByNode.get("source");
  const releaseMapping = mappingByNode.get("release");
  ensure(
    briefMapping && sourceMapping && releaseMapping,
    "技术烟测要求 brief/source/release 三个连续节点",
  );

  const sessionId = `transfer-smoke-${runId}`;
  const engine = new WorldEngine({ defaultRelease: release });
  await engine.createSession(sessionId, true);
  let sequence = 0;

  async function execute(actorId, name, payload) {
    const projection = await engine.getProjection(sessionId, actorId);
    sequence += 1;
    await engine.execute(command({
      sessionId,
      scenarioId: scenario.scenarioId,
      actorId,
      correlationId: `${runId}-smoke-${sequence}`,
      name,
      expectedStateVersion: projection.stateVersion,
      payload,
    }));
    return await engine.getProjection(sessionId, actorId);
  }

  async function approveDynamicEvent(dynamicEventId) {
    const teacher = await engine.getProjection(sessionId, "teacher-main");
    const candidate = teacher.pendingCandidates.find(
      (item) => item.payload.dynamicEventId === dynamicEventId,
    );
    ensure(candidate, `教师门候选不存在：${dynamicEventId}`);
    await execute("teacher-main", "approve_candidate_event", {
      candidateId: candidate.candidateId,
    });
  }

  await execute("student-editor", "record_experience_choice", {
    choiceRef: briefMapping.operationTasks[0].taskId,
  });
  await approveDynamicEvent(briefMapping.dynamicEvents[0].dynamicEventId);
  const sourceProjection = await engine.getProjection(
    sessionId,
    "student-reporter",
  );
  ensure(sourceProjection.currentNode.nodeId === "source", "教师门后未进入source节点");

  await execute("student-reporter", "record_experience_choice", {
    choiceRef: sourceMapping.operationTasks[0].taskId,
  });
  const releaseProjection = await engine.getProjection(
    sessionId,
    "student-editor",
  );
  ensure(releaseProjection.currentNode.nodeId === "release", "采访任务后未进入release节点");

  await execute("student-editor", "record_experience_choice", {
    choiceRef: releaseMapping.operationTasks[0].taskId,
  });
  await approveDynamicEvent(releaseMapping.dynamicEvents[0].dynamicEventId);
  await execute("student-editor", "pause_publication", {});
  await execute("student-editor", "submit_for_review", {});
  await execute("teacher-main", "review_assessment", {
    score: 96,
    reviewNote: "固定量规、三节点行为证据与两次教师门均已复核。",
  });

  const events = await engine.store.load(sessionId);
  const activatedNodeIds = new Set([
    scenario.bootstrap.entryNodeId,
    ...events
      .filter((event) => event.eventType === "node_activated")
      .map((event) => event.payload.nodeId)
      .filter((nodeId) => typeof nodeId === "string"),
  ]);
  const approvedCandidateCount = events.filter(
    (event) => event.eventType === "candidate_event_approved",
  ).length;
  const teacherFinal = events.some(
    (event) => event.eventType === "teacher_reviewed",
  );
  const fixedAssessment = events.some(
    (event) => (
      event.eventType === "assessment_created"
      && event.payload.assessment?.stage === "teacher"
      && event.payload.assessment?.status === "final"
    ),
  );
  const sceneCompleted = events.some(
    (event) => event.eventType === "scene_completed",
  );

  ensure(
    ["brief", "source", "release"].every((nodeId) =>
      activatedNodeIds.has(nodeId)
    ),
    "三节点没有全部进入同一权威事件流",
  );
  ensure(approvedCandidateCount >= 2, "学生世界后果没有经过两次教师门");
  ensure(
    teacherFinal && fixedAssessment && sceneCompleted,
    "固定教师终评没有形成最终评价与闭环事件",
  );

  return {
    status: "passed",
    sessionId,
    checkIds: [
      "three_node_path",
      "teacher_gate",
      "fixed_teacher_final",
      "immutable_release_hash",
    ],
    eventCount: events.length,
    claimBoundary:
      "该烟测只证明全新微型情境在本地确定性WorldEngine中完成三节点、两次教师门、不可变发布绑定和固定教师终评；不代表真实模型性能、教师评价效度或学生学习成效。",
  };
}

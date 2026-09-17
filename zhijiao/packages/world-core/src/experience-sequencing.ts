import {
  type ScenarioDynamicEvent,
  type ScenarioPackage,
  type WorldEvent,
} from "@ronggang/contracts";

export interface AuthoredExperienceSequence {
  nodeId: string;
  actionTaskIds: string[];
  decisionTaskIds: string[];
  primaryActionTaskId: string;
  phase: "action" | "advice_decision" | "waiting" | "completed";
  currentActionTaskId: string | null;
  visibleTaskIds: string[];
}

function choiceRecorded(
  events: WorldEvent[],
  nodeId: string,
  choiceRef: string,
): boolean {
  return events.some((event) => (
    event.eventType === "experience_choice_recorded"
    && event.payload.nodeId === nodeId
    && event.payload.choiceRef === choiceRef
  ));
}

function dynamicEventApplied(
  dynamicEvent: ScenarioDynamicEvent,
  events: WorldEvent[],
): boolean {
  return events.some((event) => (
    event.payload.dynamicEventId === dynamicEvent.dynamicEventId
    && (
      event.eventType === dynamicEvent.eventType
      || event.eventType === "experience_consequence_applied"
    )
  ));
}

/**
 * Derives the authoritative authored sequence for course nodes whose final
 * teacher gate requires evidence from every authored action. The structural
 * qualification deliberately excludes the V1 flagship flow (whose gate only
 * requires one item) without coupling the engine to specific course IDs.
 */
export function deriveAuthoredExperienceSequence(input: {
  scenario: ScenarioPackage;
  nodeId: string;
  events: WorldEvent[];
}): AuthoredExperienceSequence | null {
  const design = input.scenario.experienceDesign;
  const mapping = design?.nodeMappings.find(
    (candidate) => candidate.nodeId === input.nodeId,
  );
  const branch = design?.causalBranches.find(
    (candidate) => candidate.nodeId === input.nodeId,
  );
  if (!mapping || !branch) return null;

  const actionTasks = mapping.operationTasks.filter(
    (task) => !task.taskId.includes(":agent-decision:"),
  );
  const decisionTasks = mapping.operationTasks.filter(
    (task) => task.taskId.includes(":agent-decision:"),
  );
  const primaryActionTaskId = branch.studentChoiceRef;
  const completionEvent = mapping.dynamicEvents.find((event) => (
    event.triggerKind === "student_action"
    && event.triggerRef === primaryActionTaskId
    && (event.eventType === "node_activated" || event.eventType === "scene_completed")
    && event.approvalPolicyId !== null
  ));
  const completionPolicy = completionEvent
    ? input.scenario.approvalPolicies.find((policy) => (
        policy.approvalPolicyId === completionEvent.approvalPolicyId
        && policy.reviewMode === "teacher_required"
      ))
    : undefined;

  if (
    actionTasks.length < 2
    || decisionTasks.length === 0
    || actionTasks.at(-1)?.taskId !== primaryActionTaskId
    || !completionPolicy
    || completionPolicy.minimumEvidenceCount < actionTasks.length
  ) {
    return null;
  }

  const actionTaskIds = actionTasks.map((task) => task.taskId);
  const decisionTaskIds = decisionTasks.map((task) => task.taskId);
  const recordedActionTaskIds = new Set(
    actionTaskIds.filter((taskId) => (
      choiceRecorded(input.events, input.nodeId, taskId)
    )),
  );
  const adviceDecisionCompleted = decisionTaskIds.some((taskId) => (
    choiceRecorded(input.events, input.nodeId, taskId)
  ));

  const waitingActionTaskId = actionTaskIds.find((taskId) => {
    if (!recordedActionTaskIds.has(taskId)) return false;
    return mapping.dynamicEvents.some((event) => (
      event.triggerKind === "student_action"
      && event.triggerRef === taskId
      && event.approvalPolicyId !== null
      && !dynamicEventApplied(event, input.events)
    ));
  }) ?? null;

  if (waitingActionTaskId) {
    return {
      nodeId: input.nodeId,
      actionTaskIds,
      decisionTaskIds,
      primaryActionTaskId,
      phase: "waiting",
      currentActionTaskId: waitingActionTaskId,
      visibleTaskIds: [waitingActionTaskId],
    };
  }

  const nextActionTaskId = actionTaskIds.find(
    (taskId) => !recordedActionTaskIds.has(taskId),
  ) ?? null;
  if (!nextActionTaskId) {
    return {
      nodeId: input.nodeId,
      actionTaskIds,
      decisionTaskIds,
      primaryActionTaskId,
      phase: "completed",
      currentActionTaskId: null,
      visibleTaskIds: [],
    };
  }

  if (nextActionTaskId === primaryActionTaskId && !adviceDecisionCompleted) {
    return {
      nodeId: input.nodeId,
      actionTaskIds,
      decisionTaskIds,
      primaryActionTaskId,
      phase: "advice_decision",
      currentActionTaskId: null,
      visibleTaskIds: decisionTaskIds,
    };
  }

  return {
    nodeId: input.nodeId,
    actionTaskIds,
    decisionTaskIds,
    primaryActionTaskId,
    phase: "action",
    currentActionTaskId: nextActionTaskId,
    visibleTaskIds: [nextActionTaskId],
  };
}

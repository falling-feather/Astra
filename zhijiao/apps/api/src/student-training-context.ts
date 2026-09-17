import {
  StudentTrainingContextSchema,
  StudentTrainingContextSchemaVersion,
  type CourseReleaseReference,
  type ScenarioReleaseReference,
  type StateProjection,
  type StudentTrainingContext,
} from "@ronggang/contracts";

export class StudentTrainingContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentTrainingContextError";
  }
}

export interface BuildStudentTrainingContextInput {
  projection: StateProjection;
  bindingId: string;
  courseReleaseRef: CourseReleaseReference;
  scenarioReleaseRef: ScenarioReleaseReference;
  generatedAt?: string;
}

/**
 * Projects the broad internal WorldEngine state into the minimum student-safe
 * V2 training context. The internal projection must never be returned by the
 * learner route.
 */
export function buildStudentTrainingContext(
  input: BuildStudentTrainingContextInput,
): StudentTrainingContext {
  const { projection } = input;
  if (
    projection.actorKind !== "student"
    || projection.role.roleId !== "reporter"
  ) {
    throw new StudentTrainingContextError(
      "学生训练现场只允许当前记者岗位投影",
    );
  }
  if (
    projection.scenario.scenarioId !== input.scenarioReleaseRef.scenarioId
    || projection.scenario.version !== input.scenarioReleaseRef.version
    || projection.scenario.contentHash !== input.scenarioReleaseRef.contentHash
  ) {
    throw new StudentTrainingContextError(
      "学生训练现场与不可变情境发布引用不一致",
    );
  }
  const world = projection.structuredWorld;
  if (!world) {
    throw new StudentTrainingContextError(
      "当前会话没有可投影的结构化学生现场",
    );
  }

  const anchor = projection.currentTaskAnchor;
  const action = anchor.taskId
    ? world.tasks.find((task) => (
        task.taskId === anchor.taskId
        && (task.status === "ready" || task.status === "in_progress")
      )) ?? null
    : null;
  if (
    action
    && anchor.worldTarget?.sceneId !== world.scene.sceneId
  ) {
    throw new StudentTrainingContextError(
      "学生当前行动与结构化现场场景不一致",
    );
  }

  return StudentTrainingContextSchema.parse({
    schemaVersion: StudentTrainingContextSchemaVersion,
    sessionId: projection.sessionId,
    bindingId: input.bindingId,
    courseReleaseRef: input.courseReleaseRef,
    scenarioReleaseRef: input.scenarioReleaseRef,
    stateVersion: projection.stateVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    actor: {
      roleId: "reporter",
      displayName: projection.role.displayName,
    },
    remainingMinutes: projection.scenario.remainingMinutes,
    scene: {
      sceneId: world.scene.sceneId,
      title: world.scene.title,
      description: world.scene.description,
      phase: world.scene.phase,
      riskLevel: world.scene.riskLevel,
      stateTags: world.scene.stateTags,
    },
    hotspots: world.hotspots.map((hotspot) => ({
      hotspotId: hotspot.hotspotId,
      label: hotspot.label,
      description: hotspot.description,
      status: hotspot.status,
      relationship: hotspot.relationship,
      consequencePreview: hotspot.consequencePreview,
    })),
    eventCards: world.eventCards.slice(-16).map((event) => ({
      eventRef: event.sourceEventId,
      title: event.title,
      changes: event.worldChanges,
      tone: event.tone,
    })),
    currentAction: action ? {
      actionRef: action.taskId,
      sceneId: world.scene.sceneId,
      label: action.label,
      description: action.description,
      expectedOutput: action.expectedOutput,
      status: action.status,
      priority: action.priority,
      sourceEventRefs: action.sourceEventIds,
    } : null,
    evidenceRefs: projection.evidence.map((evidence) => evidence.evidenceId),
  });
}

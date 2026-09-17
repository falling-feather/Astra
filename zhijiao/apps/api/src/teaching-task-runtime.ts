import {
  ChallengeAssignmentSchema, WorldSimulationReleaseSchema,
  type SessionExperienceDescriptor, type TeachingTaskReleaseV1, type TeachingTaskSessionV1, type WorldSimulationRelease,
} from "@ronggang/contracts";
import { hashCanonical } from "@ronggang/course-content";
import { SimulationSessionNotFoundError, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { SessionControlService, SessionMembership } from "@ronggang/session-control";
import { stableMembershipBindingId, type DemoAuthService } from "./identity.js";
import type { BusinessOperationCoordinator } from "./business-operation-receipt.js";
import { membershipAssignment, provisionFlagshipSession } from "./flagship-session-provision.js";
import { TeachingTaskError, TeachingTaskService, type TeachingTaskActor } from "./teaching-task-service.js";
import { assertTeacherScope } from "./session-control-bootstrap.js";

export function teachingTaskSessionId(releaseId: string, principalId: string): string {
  return `task-session-${hashCanonical({ releaseId, principalId }).slice(0, 28)}`;
}

export function compileTeachingTaskWorld(base: WorldSimulationRelease, task: TeachingTaskReleaseV1): WorldSimulationRelease {
  if (hashCanonical(base.courseReleaseRef) !== hashCanonical(task.sourceCourseRef)) throw new TeachingTaskError("source_drift", "基础世界与委托任务课程引用不一致");
  const scenarioReleaseRef = { ...base.scenarioReleaseRef, version: `${base.scenarioReleaseRef.version}-task-${task.ref.taskId.slice(-12)}-r${task.ref.revision}`,
    contentHash: hashCanonical({ base: base.scenarioReleaseRef, task: task.ref }) };
  const { simulationReleaseRef: _source, ...source } = structuredClone(base);
  const body = { ...source, scenarioReleaseRef, title: task.plan.title, summary: task.plan.assignment,
    expectedDurationMinutes: task.plan.durationMinutes, publishedAt: task.publishedAt };
  return WorldSimulationReleaseSchema.parse({ ...body, simulationReleaseRef: { simulationId: base.simulationReleaseRef.simulationId,
    releaseId: `simulation-${task.ref.releaseId}`, version: base.simulationReleaseRef.version + task.ref.revision,
    contentHash: hashCanonical({ base: base.simulationReleaseRef, task: task.ref, body }) } });
}

export class TeachingTaskRuntime {
  readonly #locks = new Map<string, Promise<void>>();
  constructor(readonly dependencies: {
    tasks: TeachingTaskService; baseRelease: WorldSimulationRelease; worldSimulationV3: WorldSimulationEngineV3;
    sessionControl: SessionControlService; auth: DemoAuthService; businessOperations: BusinessOperationCoordinator;
    freezeExperienceDescriptor: (input: { sessionId: string; frozenAt: string }) => Promise<SessionExperienceDescriptor>;
    claimEnrollment: (input: { principalId: string; profileId: string; courseReleaseId: string }) => Promise<string>;
    now?: () => string;
  }) {}

  async start(actor: TeachingTaskActor & { teamId: string | null; profileId: string }, releaseId: string, attemptId?: string): Promise<TeachingTaskSessionV1> {
    if (actor.role !== "student" || !actor.teamId) throw new TeachingTaskError("access_denied", "只有本班学生可以开始自己的委托实训");
    const teamId = actor.teamId;
    const sessionId = attemptId ? `task-session-${hashCanonical({ releaseId, principalId: actor.principalId, attemptId }).slice(0,28)}` : teachingTaskSessionId(releaseId, actor.principalId);
    return this.#serialized(sessionId, async () => {
      const publication = await this.dependencies.tasks.publication(releaseId, actor);
      const task = publication.release;
      const existing = await this.dependencies.sessionControl.getSession(sessionId);
      const current = (await this.dependencies.tasks.workspace(actor)).releases.filter(item => item.ref.taskId === task.ref.taskId)
        .sort((a, b) => b.ref.revision - a.ref.revision)[0]!;
      if (!existing && current.ref.revision !== task.ref.revision) throw new TeachingTaskError("revision_conflict", "该任务已有新发布版，请从任务列表开始；原场次仍可继续");
      const startedAt = existing?.createdAt ?? this.dependencies.now?.() ?? new Date().toISOString();
      const membershipId = `${sessionId}-student`;
      const learnerMembership: SessionMembership = { membershipId, principalId: actor.principalId, classroomId: publication.owner.classroomId,
        teamId, sessionId, role: "student", actorId: "student-reporter", status: "active", createdAt: startedAt, updatedAt: startedAt, revokedAt: null };
      const bindingId = stableMembershipBindingId(actor.principalId, membershipAssignment(learnerMembership, sessionId));
      const worldRelease = compileTeachingTaskWorld(this.dependencies.baseRelease, task);
      if (existing && (existing.requestedBy !== actor.principalId || existing.classroomId !== actor.classroomId || existing.teamId !== teamId
        || existing.releaseId !== worldRelease.simulationReleaseRef.releaseId)) throw new TeachingTaskError("source_drift", "既有场次的学生、班级或发布归属不一致");
      if (existing && ["active", "paused", "completed"].includes(existing.status)) {
        const world = await this.dependencies.worldSimulationV3.getRecord(sessionId);
        if (world.release.simulationReleaseRef.contentHash !== worldRelease.simulationReleaseRef.contentHash
          || world.fieldInterview?.bindingId !== bindingId || world.fieldInterview.lessonRef.contentHash !== task.lessonHash) throw new TeachingTaskError("source_drift", "本场绑定或任务发布发生漂移");
        this.dependencies.auth.addMembershipBindingsForPrincipal(actor.principalId, [membershipAssignment(learnerMembership, sessionId)]);
        return { taskReleaseRef: task.ref, sessionId, bindingId, title: task.plan.title, status: existing.status, startedAt };
      }
      await assertTeacherScope({ control: this.dependencies.sessionControl, principalId: publication.owner.principalId,
        classroomId: publication.owner.classroomId, teamId });
      if (existing?.status === "recovery_failed") await this.dependencies.sessionControl.transitionSessionStatus({ sessionId,
        expectedStatus: "recovery_failed", expectedStatusVersion: existing.statusVersion, nextStatus: "provisioning", updatedAt: this.dependencies.now?.() ?? new Date().toISOString() });
      await this.dependencies.tasks.options.registerLesson(this.dependencies.tasks.lessonFor(publication.draft));
      const teacherMembership: SessionMembership = { membershipId: `${sessionId}-teacher`, principalId: publication.owner.principalId,
        classroomId: publication.owner.classroomId, teamId: null, sessionId, role: "teacher", actorId: publication.owner.actorId,
        status: "active", createdAt: startedAt, updatedAt: startedAt, revokedAt: null };
      const level = task.plan.challengeLevel;
      const variant = worldRelease.challengeVariants.find(item => item.challengeLevel === level)!;
      const assignment = ChallengeAssignmentSchema.parse({
        schemaVersion: "challenge-assignment/3.0.0", challengeAssignmentId: `challenge-${sessionId}`, learnerTwinRef: "learner-twin-pending-evidence",
        sessionId, simulationReleaseRef: worldRelease.simulationReleaseRef, worldVariantRef: variant.worldVariantId,
        previousChallengeLevel: null, challengeLevel: level, scoreCeiling: variant.scoreCeiling,
        pressureDimensions: [{ dimensionId: "time", intensity: level }], assignmentReason: "teacher_override", basisEvidenceRefs: [], forecastRef: null,
        teacherOverride: { teacherId: publication.owner.actorId, reason: `依已发布教学委托设置起始${level}级，学生基础由教师确认；这不是基于已有成绩的能力诊断。`, decidedAt: task.publishedAt },
        policyVersion: "teaching-task-placement/1.0.0", policyContentHash: hashCanonical({ task: task.ref, level, scaffoldingLevel: task.plan.scaffoldingLevel }), assignedAt: startedAt,
      });
      const result = await provisionFlagshipSession({
        operation: { operationKind: "start_teaching_task", requestId: `start-${sessionId}`,
          requestHash: hashCanonical({ task: task.ref, student: actor.principalId, classroomId: actor.classroomId, teamId }),
          scope: { sourceSessionId: publication.owner.sourceSessionId, targetSessionId: sessionId, artifactId: null },
          outboxSteps: ["start_training_world", "freeze_experience_descriptor", "create_learner_membership", "create_teacher_membership", "claim_course_enrollment", "activate_control_session", "materialize_runtime_bindings"], requestedAt: startedAt },
        controlRecord: { sessionId, classroomId: actor.classroomId, teamId, releaseId: worldRelease.simulationReleaseRef.releaseId,
          status: "provisioning", statusVersion: 0, requestedBy: actor.principalId, createdAt: startedAt, updatedAt: startedAt,
          activatedAt: null, completedAt: null, lastRecoveryErrorCode: null, requiresExplicitStudentMembership: true },
        learnerMembership, teacherMembership, release: worldRelease, challengeAssignment: assignment,
        targetCompetencyRefs: [...task.plan.focusCriteria], scaffoldingLevel: task.plan.scaffoldingLevel, fieldLessonHash: task.lessonHash, startStep: "start_training_world",
        claimEnrollment: () => this.dependencies.claimEnrollment({ principalId: actor.principalId, profileId: actor.profileId, courseReleaseId: task.sourceCourseRef.releaseId }),
      }, this.dependencies);
      return { taskReleaseRef: task.ref, sessionId, bindingId: result.learnerBindingId, title: task.plan.title, status: "active", startedAt };
    });
  }

  async sessions(actor: TeachingTaskActor): Promise<TeachingTaskSessionV1[]> {
    const publications = await this.dependencies.tasks.publications();
    const byLesson = new Map(publications.map(item => [item.release.lessonHash, item.release]));
    const releaseIds = new Set(publications.map(item => compileTeachingTaskWorld(this.dependencies.baseRelease, item.release).simulationReleaseRef.releaseId));
    const sessions = await this.dependencies.sessionControl.listSessions({ principalId: actor.principalId });
    const result: TeachingTaskSessionV1[] = [];
    for (const session of sessions) {
      if (!releaseIds.has(session.releaseId)) continue;
      let world;
      try { world = await this.dependencies.worldSimulationV3.getRecord(session.sessionId); }
      catch (error) { if (error instanceof SimulationSessionNotFoundError) continue; throw error; }
      if (!world.fieldInterview) continue;
      const task = byLesson.get(world.fieldInterview.lessonRef.contentHash);
      if (!task) continue;
      if (actor.role === "student" && teachingTaskSessionId(task.ref.releaseId, actor.principalId) !== session.sessionId) continue;
      result.push({ taskReleaseRef: task.ref, sessionId: session.sessionId, bindingId: actor.role === "student" ? world.fieldInterview.bindingId : null,
        title: task.plan.title, status: world.currentSnapshot.endingState.status === "active" ? session.status : "completed", startedAt: session.createdAt });
    }
    return result;
  }

  async recoverPending(resolveActor: (principalId: string) => (TeachingTaskActor & { profileId: string; teamId: string | null }) | null,
    onFailure: (sessionId: string, error: unknown) => void): Promise<void> {
    const publications = await this.dependencies.tasks.publications();
    const byRuntime = new Map(publications.map(item => [compileTeachingTaskWorld(this.dependencies.baseRelease, item.release).simulationReleaseRef.releaseId, item.release]));
    for (const session of await this.dependencies.sessionControl.listRecoverableSessions()) {
      const task = byRuntime.get(session.releaseId);
      if (!task) continue;
      try {
        const actor = resolveActor(session.requestedBy);
        if (!actor) throw new TeachingTaskError("access_denied", "待恢复场次的学生主体无法确认");
        await this.start(actor, task.ref.releaseId);
      } catch (error) { onFailure(session.sessionId, error); }
    }
  }

  async #serialized<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let unlock!: () => void;
    const done = new Promise<void>(resolve => { unlock = resolve; }), tail = previous.then(() => done);
    this.#locks.set(sessionId, tail);
    await previous;
    try { return await run(); } finally { unlock(); if (this.#locks.get(sessionId) === tail) this.#locks.delete(sessionId); }
  }
}

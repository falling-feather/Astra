import { ChallengeAssignmentSchema, WorldSimulationReleaseSchema, type CourseRelease, type WorldSimulationRelease, type SessionExperienceDescriptor, type StudyRunV3 } from "@ronggang/contracts";
import { hashCanonical, type ExplorationLesson } from "@ronggang/course-content";
import type { WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { SessionControlService, SessionMembership } from "@ronggang/session-control";
import { stableMembershipBindingId, type DemoAuthService } from "./identity.js";
import { membershipAssignment, provisionFlagshipSession } from "./flagship-session-provision.js";
import type { BusinessOperationCoordinator } from "./business-operation-receipt.js";
import type { CourseLearningService, CourseLearningSubject } from "./course-learning.js";
import { CourseLearningError } from "./course-learning.js";
import type { StudyOwner } from "./student-study.js";
import { assertTeacherScope } from "./session-control-bootstrap.js";

export interface PublishedStudyActor extends StudyOwner { teamId: string | null; subject: CourseLearningSubject }

/** Reuse the journalism kernel while binding the selected course and its own physical cast. */
export function compilePublishedCourseWorld(base: WorldSimulationRelease, course: CourseRelease, lesson: ExplorationLesson): WorldSimulationRelease {
  const { simulationReleaseRef: _ref, ...kernel } = structuredClone(base);
  const entities = new Map(kernel.worldEntities.map(entity => [entity.entityId, { ...entity,
    visibleScopes: entity.entityKind === "person" || entity.entityKind === "location" ? ["admin" as const] : entity.visibleScopes }]));
  for (const person of lesson.people) entities.set(person.id, { entityId: person.id, entityKind: "person", title: person.name, professionalRole: person.role,
    publicDescription: person.goal.slice(0,500), visibleScopes: ["student","teacher","admin"], initialStateHash: hashCanonical(person) });
  for (const node of lesson.nodes) entities.set(node.id, { entityId: node.id, entityKind: "location", title: node.title, professionalRole: null,
    publicDescription: node.description.slice(0,500), visibleScopes: ["student","teacher","admin"], initialStateHash: hashCanonical(node) });
  const content = { ...kernel, courseReleaseRef: { courseId: course.courseId, releaseId: course.releaseId, version: course.version, contentHash: course.contentHash },
    scenarioReleaseRef: course.scenarioReleaseRef, title: course.title, summary: course.summary,
    worldEntities: [...entities.values()], publishedAt: course.publishedAt };
  return WorldSimulationReleaseSchema.parse({ ...content, simulationReleaseRef: { simulationId: `field-world-${course.courseId}`,
    releaseId: `field-world-${hashCanonical({ course:content.courseReleaseRef, lessonHash:lesson.contentHash, kernel:base.simulationReleaseRef }).slice(0,28)}`,
    version: course.version, contentHash: hashCanonical(content) } });
}

/** A course archive opens a personal world from its published template, never the shared demo world. */
export class PublishedCourseRuntime {
  constructor(readonly dependencies: {
    courses: CourseLearningService; worldSimulationV3: WorldSimulationEngineV3; sessionControl: SessionControlService;
    auth: DemoAuthService; businessOperations: BusinessOperationCoordinator;
    kernelTemplateSessionId: string;
    lessonByHash: (hash: string) => ExplorationLesson;
    freezeExperienceDescriptor: (input: { sessionId: string; frozenAt: string }) => Promise<SessionExperienceDescriptor>;
    teacherFor: (classroomId: string) => { principalId: string; actorId: string };
    fieldLessonFor: (courseId: string, classroomId: string, practiceOrdinal:number) => string | undefined | Promise<string | undefined>;
    inheritedContacts?: (actor: PublishedStudyActor, courseId: string) => Promise<import("@ronggang/contracts").FieldContactMemoryV3[]>;
    teachingTask?: (actor: PublishedStudyActor, courseReleaseId: string, taskReleaseId: string, requestId: string) => Promise<StudyRunV3>;
    now?: () => string;
  }) {}

  async prepare(actor: PublishedStudyActor, courseReleaseId: string, requestId: string, taskReleaseId?: string, practiceOrdinal=0): Promise<StudyRunV3> {
    const { courses, sessionControl, worldSimulationV3, auth } = this.dependencies;
    if (actor.subject.role !== "student" || !actor.teamId) throw new CourseLearningError("access_denied", "只有本班学生可以开始课程");
    if (taskReleaseId) {
      if (!this.dependencies.teachingTask) throw new CourseLearningError("course_not_found", "当前运行环境未启用教师委托");
      return this.dependencies.teachingTask(actor, courseReleaseId, taskReleaseId, requestId);
    }
    const course = courses.getReleaseById(courseReleaseId), launch = courses.getLaunch(courseReleaseId);
    if (!launch) throw new CourseLearningError("course_not_found", "这门课程尚未配置可运行的实训环境");
    const template = await sessionControl.getSession(launch.sessionId);
    if (!template) throw new CourseLearningError("course_not_found", "该课程的发布模板不存在");
    // Published content is reusable across teaching classes. Authorize the
    // learner's actual class/team, then create their own isolated world below.
    const [team,memberships]=await Promise.all([
      sessionControl.getTeam(actor.teamId),
      sessionControl.listMemberships({principalId:actor.principalId,classroomId:actor.classroomId,roles:['student'],statuses:['active']}),
    ]);
    if(!team||team.status!=='active'||team.classroomId!==actor.classroomId||!memberships.some(member=>member.teamId===actor.teamId))throw new CourseLearningError('access_denied','当前学生没有本班小组的有效成员关系');
    const source = await worldSimulationV3.getRecord(this.dependencies.kernelTemplateSessionId);
    const fieldLessonHash = await this.dependencies.fieldLessonFor(course.courseId, actor.classroomId, practiceOrdinal);
    if (!fieldLessonHash) throw new CourseLearningError("course_not_found", "这门课程尚未发布可运行的现场内容");
    const release = source.release.courseReleaseRef.courseId === course.courseId ? source.release : compilePublishedCourseWorld(source.release,course,this.dependencies.lessonByHash(fieldLessonHash));
    if (release.courseReleaseRef.courseId !== course.courseId || release.courseReleaseRef.releaseId !== course.releaseId
      || release.courseReleaseRef.contentHash !== course.contentHash) throw new CourseLearningError("version_hash_drift", "课程与实训模板的发布版本不一致");
    const sessionId = `study-session-${hashCanonical({ principalId: actor.principalId, courseReleaseId, requestId }).slice(0, 28)}`;
    const prior = await sessionControl.getSession(sessionId), startedAt = prior?.createdAt ?? this.dependencies.now?.() ?? new Date().toISOString();
    if (prior && (prior.requestedBy !== actor.principalId || prior.classroomId !== actor.classroomId || prior.teamId !== actor.teamId)) throw new CourseLearningError("access_denied", "已准备的场次不属于当前学生");
    const learnerMembership: SessionMembership = { membershipId: `${sessionId}-student`, principalId: actor.principalId, classroomId: actor.classroomId,
      teamId: actor.teamId, sessionId, role: "student", actorId: "student-reporter", status: "active", createdAt: startedAt, updatedAt: startedAt, revokedAt: null };
    const bindingId = stableMembershipBindingId(actor.principalId, membershipAssignment(learnerMembership, sessionId));
    if (prior && ["active", "paused", "completed"].includes(prior.status)) {
      const existing = await worldSimulationV3.getRecord(sessionId);
      if (existing.release.courseReleaseRef.contentHash !== course.contentHash || existing.release.courseReleaseRef.releaseId !== course.releaseId) throw new CourseLearningError("version_hash_drift", "已准备场次的课程发布引用发生漂移");
      const registered = await sessionControl.getMembership(learnerMembership.membershipId);
      if (!registered || registered.status !== "active" || registered.principalId !== actor.principalId) throw new CourseLearningError("access_denied", "本场学生成员关系已失效");
      if (prior.status === "completed" || existing.currentSnapshot.endingState.status !== "active") throw new CourseLearningError("enrollment_conflict", "原开课请求已经结束，请重新开始一次练习");
      auth.addMembershipBindingsForPrincipal(actor.principalId, [membershipAssignment(registered, sessionId)]);
      return { sessionId, bindingId, courseRef: release.courseReleaseRef, title: course.title, status: "active", startedAt, endedAt: null };
    }
    if (prior?.status === "recovery_failed") await sessionControl.transitionSessionStatus({ sessionId, expectedStatus: "recovery_failed", expectedStatusVersion: prior.statusVersion,
      nextStatus: "provisioning", updatedAt: this.dependencies.now?.() ?? new Date().toISOString() });
    const teacher = this.dependencies.teacherFor(actor.classroomId);
    await assertTeacherScope({ control: sessionControl, principalId: teacher.principalId, classroomId: actor.classroomId, teamId: actor.teamId });
    const teacherMembership: SessionMembership = { membershipId: `${sessionId}-teacher`, principalId: teacher.principalId,
      classroomId: actor.classroomId, teamId: null, sessionId, role: "teacher", actorId: teacher.actorId, status: "active",
      createdAt: startedAt, updatedAt: startedAt, revokedAt: null };
    const assignment = ChallengeAssignmentSchema.parse({ ...source.challengeAssignment, challengeAssignmentId: `challenge-${sessionId}`, sessionId,
      simulationReleaseRef: release.simulationReleaseRef,
      learnerTwinRef: "learner-twin-pending-evidence", previousChallengeLevel: null, basisEvidenceRefs: [], forecastRef: null,
      assignmentReason: "teacher_override", teacherOverride: { teacherId: teacher.actorId, reason: "采用已发布课程的初始训练条件；不是对学生已有能力的评分。", decidedAt: startedAt },
      policyVersion: "published-course-start/3.0.0", policyContentHash: hashCanonical({ course: release.courseReleaseRef, template: source.challengeAssignment.policyContentHash }), assignedAt: startedAt });
    const inheritedContacts = await this.dependencies.inheritedContacts?.(actor, course.courseId);
    const result = await provisionFlagshipSession({
      operation: { operationKind: "start_teaching_task", requestId: `start-${sessionId}`, requestHash: hashCanonical({ courseReleaseId, principalId: actor.principalId, requestId }),
        scope: { sourceSessionId: launch.sessionId, targetSessionId: sessionId, artifactId: null },
        outboxSteps: ["start_training_world", "freeze_experience_descriptor", "create_learner_membership", "create_teacher_membership", "claim_course_enrollment", "activate_control_session", "materialize_runtime_bindings"], requestedAt: startedAt },
      controlRecord: { sessionId, classroomId: actor.classroomId, teamId: actor.teamId, releaseId: release.simulationReleaseRef.releaseId,
        status: "provisioning", statusVersion: 0, requestedBy: actor.principalId, createdAt: startedAt, updatedAt: startedAt,
        activatedAt: null, completedAt: null, lastRecoveryErrorCode: null, requiresExplicitStudentMembership: true },
      learnerMembership, teacherMembership, release, challengeAssignment: assignment, targetCompetencyRefs: source.currentSnapshot.learningContext.targetCompetencyRefs,
      scaffoldingLevel: source.currentSnapshot.learningContext.scaffoldingLevel, ...(fieldLessonHash ? { fieldLessonHash } : {}),
      ...(inheritedContacts ? { inheritedContacts } : {}), startStep: "start_training_world",
      claimEnrollment: async () => (await courses.claim({ subject: actor.subject, courseReleaseId, bindingId: null, activeSessionId: null })).enrollmentId,
    }, this.dependencies);
    return { sessionId, bindingId: result.learnerBindingId, courseRef: release.courseReleaseRef, title: course.title, status: "active", startedAt, endedAt: null };
  }
}

import type { ChallengeAssignment, SessionExperienceDescriptor, WorldSimulationRelease } from "@ronggang/contracts";
import type { SessionControlService, SessionMembership, TrainingSessionRecord } from "@ronggang/session-control";
import { SimulationSessionNotFoundError, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import { BusinessOperationError, type BusinessOperationCoordinator, type CommitBusinessOperationInput } from "./business-operation-receipt.js";
import { stableMembershipBindingId, type DemoAuthService, type MembershipRoleAssignment } from "./identity.js";

export function membershipAssignment(membership: SessionMembership, sessionId: string): MembershipRoleAssignment {
  return { membershipId: membership.membershipId, principalId: membership.principalId, sessionId, actorId: membership.actorId,
    actorKind: membership.role, roleId: membership.role === "student" ? "reporter" : "teacher", status: membership.status };
}

export async function provisionFlagshipSession(input: {
  operation: CommitBusinessOperationInput;
  controlRecord: TrainingSessionRecord;
  learnerMembership: SessionMembership; teacherMembership: SessionMembership;
  release: WorldSimulationRelease; challengeAssignment: ChallengeAssignment; targetCompetencyRefs: string[]; scaffoldingLevel: number;
  fieldLessonHash?: string;
  inheritedContacts?: import("@ronggang/contracts").FieldContactMemoryV3[];
  startStep: "start_second_world" | "start_training_world";
  claimEnrollment?: () => Promise<string>;
}, dependencies: {
  sessionControl: SessionControlService; auth: DemoAuthService; worldSimulationV3: WorldSimulationEngineV3; businessOperations: BusinessOperationCoordinator;
  freezeExperienceDescriptor: (input: { sessionId: string; frozenAt: string }) => Promise<SessionExperienceDescriptor>;
  failure?: (code: "source_drift" | "provisioning_failed", message: string) => Error;
}): Promise<{ sessionId: string; learnerBindingId: string }> {
  const { sessionControl, auth, worldSimulationV3, businessOperations } = dependencies;
  const { sessionId } = input.controlRecord;
  const learnerAssignment = membershipAssignment(input.learnerMembership, sessionId);
  const teacherAssignment = membershipAssignment(input.teacherMembership, sessionId);
  const learnerBindingId = stableMembershipBindingId(input.learnerMembership.principalId, learnerAssignment);
  const drift = (message: string) => dependencies.failure?.("source_drift", message)
    ?? new BusinessOperationError("definition_drift", message, { operationId: input.operation.requestId });
  const ensureMembership = async (expected: SessionMembership) => {
    const existing = await sessionControl.getMembership(expected.membershipId);
    if (!existing) { await sessionControl.putMembership(expected); return; }
    const keys = ["principalId", "classroomId", "teamId", "sessionId", "role", "actorId", "status"] as const;
    if (keys.some(key => existing[key] !== expected[key])) throw drift("既有成员与场次的主体、岗位或范围不一致");
  };
  const operation = await businessOperations.commitAuthority(input.operation, async () => {
    const current = await sessionControl.getSession(sessionId);
    if (current) {
      if (current.classroomId !== input.controlRecord.classroomId || current.teamId !== input.controlRecord.teamId || current.releaseId !== input.controlRecord.releaseId) throw drift("同名场次已绑定不同班级、小组或发布版");
      return { commitRef: current.sessionId };
    }
    const created = await sessionControl.createSession(input.controlRecord, `flagship:${input.operation.operationKind}:${input.operation.requestId}`);
    return { commitRef: created.sessionId };
  });
  await businessOperations.deliverOutbox(operation.operationId, {
    [input.startStep]: async () => {
      try {
        const existing = await worldSimulationV3.getRecord(sessionId);
        if (existing.release.simulationReleaseRef.contentHash !== input.release.simulationReleaseRef.contentHash
          || existing.challengeAssignment.challengeAssignmentId !== input.challengeAssignment.challengeAssignmentId
          || (input.fieldLessonHash && (existing.fieldInterview?.lessonRef.contentHash !== input.fieldLessonHash || existing.fieldInterview.bindingId !== learnerBindingId))) throw drift("既有世界与冻结任务、挑战或学生绑定不一致");
      } catch (error) {
        if (!(error instanceof SimulationSessionNotFoundError)) throw error;
        await worldSimulationV3.startSession({ sessionId, release: input.release, challengeAssignment: input.challengeAssignment,
          targetCompetencyRefs: input.targetCompetencyRefs, scaffoldingLevel: input.scaffoldingLevel, startedAt: input.controlRecord.createdAt,
          ...(input.fieldLessonHash ? { fieldInterview: { lessonHash: input.fieldLessonHash, actorId: input.learnerMembership.actorId, bindingId: learnerBindingId,
            ...(input.inheritedContacts ? { inheritedContacts: input.inheritedContacts } : {}) } } : {}) });
      }
      return { resultRef: input.release.simulationReleaseRef.releaseId };
    },
    freeze_experience_descriptor: async () => ({ resultRef: (await dependencies.freezeExperienceDescriptor({ sessionId, frozenAt: input.controlRecord.createdAt })).descriptorId }),
    create_learner_membership: async () => { await ensureMembership(input.learnerMembership); return { resultRef: input.learnerMembership.membershipId }; },
    create_teacher_membership: async () => { await ensureMembership(input.teacherMembership); return { resultRef: input.teacherMembership.membershipId }; },
    claim_course_enrollment: async () => {
      if (!input.claimEnrollment) throw drift("课程认领投影未装配");
      return { resultRef: await input.claimEnrollment() };
    },
    activate_control_session: async () => {
      let current = await sessionControl.getSession(sessionId);
      if (!current) throw drift("场次权威收据存在但控制记录缺失");
      if (current.status === "provisioning") current = await sessionControl.transitionSessionStatus({ sessionId, expectedStatus: "provisioning", expectedStatusVersion: current.statusVersion,
        nextStatus: "active", updatedAt: new Date(Math.max(Date.parse(current.updatedAt), Date.parse(input.controlRecord.createdAt))).toISOString() });
      if (current.status !== "active") throw drift("场次尚未处于可体验状态");
      return { resultRef: sessionId };
    },
    materialize_runtime_bindings: async () => {
      auth.addMembershipBindingsForPrincipal(input.learnerMembership.principalId, [learnerAssignment]);
      auth.addMembershipBindingsForPrincipal(input.teacherMembership.principalId, [teacherAssignment]);
      return { resultRef: learnerBindingId };
    },
  });
  const current = await sessionControl.getSession(sessionId);
  if (!current || current.status !== "active") throw drift("场次收据已完成但活动状态不一致");
  return { sessionId, learnerBindingId };
}

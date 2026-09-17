import { SessionControlError } from "./errors.js";
import type {
  Classroom,
  MembershipScope,
  SessionMembership,
  SessionScope,
  SessionStatusTransitionInput,
  TeamInstance,
  TeamScope,
  TrainingSessionRecord,
  TrainingSessionStatus,
} from "./models.js";
import type { SessionControlStore } from "./store.js";

const allowedTransitions: Readonly<Record<
  TrainingSessionStatus,
  readonly TrainingSessionStatus[]
>> = {
  provisioning: ["active", "recovery_failed"],
  active: ["paused", "completed", "recovery_failed"],
  paused: ["active", "completed", "recovery_failed"],
  completed: [],
  recovery_failed: ["provisioning"],
};

export class SessionControlService {
  constructor(readonly store: SessionControlStore) {}

  putClassroom(record: Classroom): Promise<Classroom> {
    return this.store.putClassroom(record);
  }

  getClassroom(classroomId: string): Promise<Classroom | null> {
    return this.store.getClassroom(classroomId);
  }

  listClassrooms(): Promise<Classroom[]> {
    return this.store.listClassrooms();
  }

  async putTeam(record: TeamInstance): Promise<TeamInstance> {
    const classroom = await this.requireClassroom(record.classroomId);
    if (classroom.status !== "active") {
      throw new SessionControlError("inactive_resource", "不能在已归档班级中登记团队", {
        classroomId: classroom.classroomId,
        status: classroom.status,
      });
    }
    return this.store.putTeam(record);
  }

  getTeam(teamId: string): Promise<TeamInstance | null> {
    return this.store.getTeam(teamId);
  }

  listTeams(scope?: TeamScope): Promise<TeamInstance[]> {
    return this.store.listTeams(scope);
  }

  async createSession(
    record: TrainingSessionRecord,
    requestId: string,
  ): Promise<TrainingSessionRecord> {
    const classroom = await this.requireClassroom(record.classroomId);
    const team = await this.requireTeam(record.teamId);
    if (team.classroomId !== classroom.classroomId) {
      throw new SessionControlError("scope_mismatch", "团队不属于会话指定班级", {
        classroomId: classroom.classroomId,
        teamId: team.teamId,
        teamClassroomId: team.classroomId,
      });
    }
    if (classroom.status !== "active" || team.status !== "active") {
      throw new SessionControlError("inactive_resource", "不能在已归档班级或团队中创建会话", {
        classroomStatus: classroom.status,
        teamStatus: team.status,
      });
    }
    if (record.status !== "provisioning" || record.statusVersion !== 0) {
      throw new SessionControlError(
        "invalid_record",
        "新会话必须以 provisioning/statusVersion=0 创建",
        { status: record.status, statusVersion: record.statusVersion },
      );
    }
    return this.store.createSession(record, requestId);
  }

  getSession(sessionId: string): Promise<TrainingSessionRecord | null> {
    return this.store.getSession(sessionId);
  }

  listSessions(scope?: SessionScope): Promise<TrainingSessionRecord[]> {
    return this.store.listSessions(scope);
  }

  async transitionSessionStatus(
    input: SessionStatusTransitionInput,
  ): Promise<TrainingSessionRecord> {
    if (!allowedTransitions[input.expectedStatus].includes(input.nextStatus)) {
      throw new SessionControlError("invalid_status_transition", "不允许该会话状态迁移", {
        sessionId: input.sessionId,
        from: input.expectedStatus,
        to: input.nextStatus,
      });
    }
    if (input.nextStatus === "recovery_failed" && !input.recoveryErrorCode) {
      throw new SessionControlError(
        "invalid_record",
        "迁移到 recovery_failed 必须提供 recoveryErrorCode",
        { sessionId: input.sessionId },
      );
    }
    return this.store.compareAndSetSessionStatus(input);
  }

  listRecoverableSessions(
    scope?: Omit<SessionScope, "statuses">,
  ): Promise<TrainingSessionRecord[]> {
    return this.store.listRecoverableSessions(scope);
  }

  async putMembership(record: SessionMembership): Promise<SessionMembership> {
    await this.requireClassroom(record.classroomId);
    const team = record.teamId === null ? null : await this.requireTeam(record.teamId);
    if (team && team.classroomId !== record.classroomId) {
      throw new SessionControlError("scope_mismatch", "成员资格团队不属于指定班级", {
        membershipId: record.membershipId,
        classroomId: record.classroomId,
        teamId: team.teamId,
        teamClassroomId: team.classroomId,
      });
    }
    if (record.role === "student" && record.teamId === null) {
      throw new SessionControlError("invalid_record", "学生成员资格必须绑定团队", {
        membershipId: record.membershipId,
      });
    }
    if (record.sessionId !== null) {
      const session = await this.requireSession(record.sessionId);
      if (
        session.classroomId !== record.classroomId
        || (record.teamId !== null && session.teamId !== record.teamId)
      ) {
        throw new SessionControlError("scope_mismatch", "成员资格与会话作用域不一致", {
          membershipId: record.membershipId,
          sessionId: record.sessionId,
        });
      }
    }
    return this.store.putMembership(record);
  }

  getMembership(membershipId: string): Promise<SessionMembership | null> {
    return this.store.getMembership(membershipId);
  }

  listMemberships(scope?: MembershipScope): Promise<SessionMembership[]> {
    return this.store.listMemberships(scope);
  }

  revokeMembership(membershipId: string, revokedAt: string): Promise<SessionMembership> {
    return this.store.revokeMembership(membershipId, revokedAt);
  }

  private async requireClassroom(classroomId: string): Promise<Classroom> {
    const classroom = await this.store.getClassroom(classroomId);
    if (!classroom) {
      throw new SessionControlError("not_found", "班级不存在", {
        resource: "classroom",
        classroomId,
      });
    }
    return classroom;
  }

  private async requireTeam(teamId: string): Promise<TeamInstance> {
    const team = await this.store.getTeam(teamId);
    if (!team) {
      throw new SessionControlError("not_found", "团队不存在", {
        resource: "team",
        teamId,
      });
    }
    return team;
  }

  private async requireSession(sessionId: string): Promise<TrainingSessionRecord> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new SessionControlError("not_found", "训练会话不存在", {
        resource: "session",
        sessionId,
      });
    }
    return session;
  }
}

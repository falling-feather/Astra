import type {
  Classroom,
  MembershipScope,
  SessionMembership,
  SessionScope,
  SessionStatusTransitionInput,
  TeamInstance,
  TeamScope,
  TrainingSessionRecord,
} from "./models.js";

export interface SessionControlStore {
  putClassroom(classroom: Classroom): Promise<Classroom>;
  getClassroom(classroomId: string): Promise<Classroom | null>;
  listClassrooms(): Promise<Classroom[]>;

  putTeam(team: TeamInstance): Promise<TeamInstance>;
  getTeam(teamId: string): Promise<TeamInstance | null>;
  listTeams(scope?: TeamScope): Promise<TeamInstance[]>;

  createSession(record: TrainingSessionRecord, requestId: string): Promise<TrainingSessionRecord>;
  getSession(sessionId: string): Promise<TrainingSessionRecord | null>;
  listSessions(scope?: SessionScope): Promise<TrainingSessionRecord[]>;
  compareAndSetSessionStatus(
    input: SessionStatusTransitionInput,
  ): Promise<TrainingSessionRecord>;
  listRecoverableSessions(scope?: Omit<SessionScope, "statuses">): Promise<TrainingSessionRecord[]>;

  putMembership(membership: SessionMembership): Promise<SessionMembership>;
  getMembership(membershipId: string): Promise<SessionMembership | null>;
  listMemberships(scope?: MembershipScope): Promise<SessionMembership[]>;
  revokeMembership(membershipId: string, revokedAt: string): Promise<SessionMembership>;
}

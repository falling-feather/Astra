export type ClassroomStatus = "active" | "archived";
export type TeamInstanceStatus = "active" | "archived";
export type TrainingSessionStatus =
  | "provisioning"
  | "active"
  | "paused"
  | "completed"
  | "recovery_failed";
export type SessionMembershipStatus = "active" | "revoked";
export type SessionMembershipRole = "teacher" | "student";

export interface Classroom {
  classroomId: string;
  courseId: string;
  name: string;
  status: ClassroomStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TeamInstance {
  teamId: string;
  classroomId: string;
  name: string;
  status: TeamInstanceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingSessionRecord {
  sessionId: string;
  classroomId: string;
  teamId: string;
  releaseId: string;
  status: TrainingSessionStatus;
  statusVersion: number;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  completedAt: string | null;
  lastRecoveryErrorCode: string | null;
  requiresExplicitStudentMembership?: boolean;
}

export interface SessionMembership {
  membershipId: string;
  principalId: string;
  classroomId: string;
  teamId: string | null;
  sessionId: string | null;
  role: SessionMembershipRole;
  actorId: string;
  status: SessionMembershipStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface SessionScope {
  classroomId?: string;
  teamId?: string;
  principalId?: string;
  statuses?: readonly TrainingSessionStatus[];
}

export interface TeamScope {
  classroomId?: string;
  statuses?: readonly TeamInstanceStatus[];
}

export interface MembershipScope {
  principalId?: string;
  classroomId?: string;
  teamId?: string | null;
  sessionId?: string | null;
  roles?: readonly SessionMembershipRole[];
  statuses?: readonly SessionMembershipStatus[];
}

export interface SessionStatusTransitionInput {
  sessionId: string;
  expectedStatus: TrainingSessionStatus;
  expectedStatusVersion: number;
  nextStatus: TrainingSessionStatus;
  updatedAt: string;
  recoveryErrorCode?: string | null;
}

import { SessionControlError } from "./errors.js";
import type {
  Classroom,
  SessionMembership,
  TeamInstance,
  TrainingSessionRecord,
} from "./models.js";

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new SessionControlError("invalid_record", `${field} 不能为空`, { field });
  }
}

function assertIsoDate(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new SessionControlError("invalid_record", `${field} 不是有效时间`, {
      field,
      value,
    });
  }
}

export function validateClassroom(record: Classroom): void {
  assertNonEmpty(record.classroomId, "classroomId");
  assertNonEmpty(record.courseId, "courseId");
  assertNonEmpty(record.name, "name");
  assertIsoDate(record.createdAt, "createdAt");
  assertIsoDate(record.updatedAt, "updatedAt");
}

export function validateTeam(record: TeamInstance): void {
  assertNonEmpty(record.teamId, "teamId");
  assertNonEmpty(record.classroomId, "classroomId");
  assertNonEmpty(record.name, "name");
  assertIsoDate(record.createdAt, "createdAt");
  assertIsoDate(record.updatedAt, "updatedAt");
}

export function validateSession(record: TrainingSessionRecord): void {
  if (record.requiresExplicitStudentMembership !== undefined && typeof record.requiresExplicitStudentMembership !== "boolean") {
    throw new SessionControlError("invalid_record", "学生场次访问规则必须是布尔值");
  }
  assertNonEmpty(record.sessionId, "sessionId");
  assertNonEmpty(record.classroomId, "classroomId");
  assertNonEmpty(record.teamId, "teamId");
  assertNonEmpty(record.releaseId, "releaseId");
  assertNonEmpty(record.requestedBy, "requestedBy");
  if (!Number.isSafeInteger(record.statusVersion) || record.statusVersion < 0) {
    throw new SessionControlError("invalid_record", "statusVersion 必须是非负安全整数", {
      field: "statusVersion",
      value: record.statusVersion,
    });
  }
  assertIsoDate(record.createdAt, "createdAt");
  assertIsoDate(record.updatedAt, "updatedAt");
  if (record.activatedAt !== null) assertIsoDate(record.activatedAt, "activatedAt");
  if (record.completedAt !== null) assertIsoDate(record.completedAt, "completedAt");
}

export function validateMembership(record: SessionMembership): void {
  assertNonEmpty(record.membershipId, "membershipId");
  assertNonEmpty(record.principalId, "principalId");
  assertNonEmpty(record.classroomId, "classroomId");
  assertNonEmpty(record.actorId, "actorId");
  if (record.teamId !== null) assertNonEmpty(record.teamId, "teamId");
  if (record.sessionId !== null) assertNonEmpty(record.sessionId, "sessionId");
  assertIsoDate(record.createdAt, "createdAt");
  assertIsoDate(record.updatedAt, "updatedAt");
  if (record.revokedAt !== null) assertIsoDate(record.revokedAt, "revokedAt");
  if (record.status === "active" && record.revokedAt !== null) {
    throw new SessionControlError("invalid_record", "有效成员资格不能包含 revokedAt", {
      membershipId: record.membershipId,
    });
  }
  if (record.status === "revoked" && record.revokedAt === null) {
    throw new SessionControlError("invalid_record", "已撤销成员资格必须包含 revokedAt", {
      membershipId: record.membershipId,
    });
  }
}

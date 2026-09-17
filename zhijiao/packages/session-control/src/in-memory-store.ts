import { canonicalJson } from "./canonical.js";
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
} from "./models.js";
import type { SessionControlStore } from "./store.js";
import {
  validateClassroom,
  validateMembership,
  validateSession,
  validateTeam,
} from "./validation.js";

interface IdempotencyEntry {
  sessionId: string;
  payload: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameRecord(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortByCreatedAtThenId<T extends { createdAt: string }>(
  values: T[],
  id: (value: T) => string,
): T[] {
  return values.sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || id(left).localeCompare(id(right))
  ));
}

export class InMemorySessionControlStore implements SessionControlStore {
  readonly #classrooms = new Map<string, Classroom>();
  readonly #teams = new Map<string, TeamInstance>();
  readonly #sessions = new Map<string, TrainingSessionRecord>();
  readonly #sessionRequests = new Map<string, IdempotencyEntry>();
  readonly #memberships = new Map<string, SessionMembership>();

  async putClassroom(rawRecord: Classroom): Promise<Classroom> {
    validateClassroom(rawRecord);
    const record = clone(rawRecord);
    const existing = this.#classrooms.get(record.classroomId);
    if (existing && !sameRecord(existing, record)) {
      throw new SessionControlError("resource_conflict", "班级标识已对应不同记录", {
        resource: "classroom",
        classroomId: record.classroomId,
      });
    }
    if (!existing) this.#classrooms.set(record.classroomId, record);
    return clone(existing ?? record);
  }

  async getClassroom(classroomId: string): Promise<Classroom | null> {
    const record = this.#classrooms.get(classroomId);
    return record ? clone(record) : null;
  }

  async listClassrooms(): Promise<Classroom[]> {
    return sortByCreatedAtThenId(
      [...this.#classrooms.values()],
      (record) => record.classroomId,
    ).map((record) => clone(record));
  }

  async putTeam(rawRecord: TeamInstance): Promise<TeamInstance> {
    validateTeam(rawRecord);
    const record = clone(rawRecord);
    const existing = this.#teams.get(record.teamId);
    if (existing && !sameRecord(existing, record)) {
      throw new SessionControlError("resource_conflict", "团队标识已对应不同记录", {
        resource: "team",
        teamId: record.teamId,
      });
    }
    if (!existing) this.#teams.set(record.teamId, record);
    return clone(existing ?? record);
  }

  async getTeam(teamId: string): Promise<TeamInstance | null> {
    const record = this.#teams.get(teamId);
    return record ? clone(record) : null;
  }

  async listTeams(scope: TeamScope = {}): Promise<TeamInstance[]> {
    return sortByCreatedAtThenId(
      [...this.#teams.values()].filter((record) => (
        (scope.classroomId === undefined || record.classroomId === scope.classroomId)
        && (scope.statuses === undefined || scope.statuses.includes(record.status))
      )),
      (record) => record.teamId,
    ).map((record) => clone(record));
  }

  async createSession(
    rawRecord: TrainingSessionRecord,
    requestId: string,
  ): Promise<TrainingSessionRecord> {
    validateSession(rawRecord);
    if (requestId.trim().length === 0) {
      throw new SessionControlError("invalid_record", "requestId 不能为空", {
        field: "requestId",
      });
    }
    const record = clone(rawRecord);
    const payload = canonicalJson(record);
    const request = this.#sessionRequests.get(requestId);
    if (request) {
      const existing = this.#sessions.get(request.sessionId);
      if (!existing) {
        throw new SessionControlError("resource_conflict", "幂等索引指向缺失会话", {
          requestId,
          sessionId: request.sessionId,
        });
      }
      if (request.payload !== payload) {
        throw new SessionControlError("idempotency_conflict", "同一 requestId 的会话载荷不一致", {
          requestId,
          existingSessionId: request.sessionId,
          attemptedSessionId: record.sessionId,
        });
      }
      return clone(existing);
    }
    const sameId = this.#sessions.get(record.sessionId);
    if (sameId) {
      throw new SessionControlError("resource_conflict", "会话标识已由其他请求占用", {
        sessionId: record.sessionId,
        requestId,
      });
    }
    this.#sessions.set(record.sessionId, record);
    this.#sessionRequests.set(requestId, { sessionId: record.sessionId, payload });
    return clone(record);
  }

  async getSession(sessionId: string): Promise<TrainingSessionRecord | null> {
    const record = this.#sessions.get(sessionId);
    return record ? clone(record) : null;
  }

  async listSessions(scope: SessionScope = {}): Promise<TrainingSessionRecord[]> {
    const visibleSessionIds = scope.principalId === undefined
      ? null
      : new Set(
        [...this.#memberships.values()]
          .filter((membership) => (
            membership.principalId === scope.principalId
            && membership.status === "active"
          ))
          .flatMap((membership) => {
            if (membership.sessionId !== null) return [membership.sessionId];
            return [...this.#sessions.values()]
              .filter((session) => (
                session.classroomId === membership.classroomId
                && (membership.teamId === null || session.teamId === membership.teamId)
                && (membership.role !== "student" || !session.requiresExplicitStudentMembership)
              ))
              .map((session) => session.sessionId);
          }),
      );

    return sortByCreatedAtThenId(
      [...this.#sessions.values()].filter((record) => (
        (scope.classroomId === undefined || record.classroomId === scope.classroomId)
        && (scope.teamId === undefined || record.teamId === scope.teamId)
        && (scope.statuses === undefined || scope.statuses.includes(record.status))
        && (visibleSessionIds === null || visibleSessionIds.has(record.sessionId))
      )),
      (record) => record.sessionId,
    ).map((record) => clone(record));
  }

  async compareAndSetSessionStatus(
    input: SessionStatusTransitionInput,
  ): Promise<TrainingSessionRecord> {
    const current = this.#sessions.get(input.sessionId);
    if (!current) {
      throw new SessionControlError("not_found", "训练会话不存在", {
        resource: "session",
        sessionId: input.sessionId,
      });
    }
    if (
      current.status !== input.expectedStatus
      || current.statusVersion !== input.expectedStatusVersion
    ) {
      throw new SessionControlError("status_conflict", "训练会话状态版本已变化", {
        sessionId: input.sessionId,
        expectedStatus: input.expectedStatus,
        expectedStatusVersion: input.expectedStatusVersion,
        actualStatus: current.status,
        actualStatusVersion: current.statusVersion,
      });
    }
    if (!Number.isFinite(Date.parse(input.updatedAt))) {
      throw new SessionControlError("invalid_record", "updatedAt 不是有效时间", {
        field: "updatedAt",
        value: input.updatedAt,
      });
    }
    const updated: TrainingSessionRecord = {
      ...current,
      status: input.nextStatus,
      statusVersion: current.statusVersion + 1,
      updatedAt: input.updatedAt,
      activatedAt: input.nextStatus === "active"
        ? (current.activatedAt ?? input.updatedAt)
        : current.activatedAt,
      completedAt: input.nextStatus === "completed"
        ? input.updatedAt
        : current.completedAt,
      lastRecoveryErrorCode: input.nextStatus === "recovery_failed"
        ? (input.recoveryErrorCode ?? "unknown_recovery_failure")
        : null,
    };
    validateSession(updated);
    this.#sessions.set(updated.sessionId, updated);
    return clone(updated);
  }

  async listRecoverableSessions(
    scope: Omit<SessionScope, "statuses"> = {},
  ): Promise<TrainingSessionRecord[]> {
    return this.listSessions({
      ...scope,
      statuses: ["provisioning", "recovery_failed"],
    });
  }

  async putMembership(rawRecord: SessionMembership): Promise<SessionMembership> {
    validateMembership(rawRecord);
    const record = clone(rawRecord);
    const existing = this.#memberships.get(record.membershipId);
    if (existing && !sameRecord(existing, record)) {
      throw new SessionControlError("resource_conflict", "成员资格标识已对应不同记录", {
        resource: "membership",
        membershipId: record.membershipId,
      });
    }
    if (!existing) this.#memberships.set(record.membershipId, record);
    return clone(existing ?? record);
  }

  async getMembership(membershipId: string): Promise<SessionMembership | null> {
    const record = this.#memberships.get(membershipId);
    return record ? clone(record) : null;
  }

  async listMemberships(scope: MembershipScope = {}): Promise<SessionMembership[]> {
    return sortByCreatedAtThenId(
      [...this.#memberships.values()].filter((record) => (
        (scope.principalId === undefined || record.principalId === scope.principalId)
        && (scope.classroomId === undefined || record.classroomId === scope.classroomId)
        && (scope.teamId === undefined || record.teamId === scope.teamId)
        && (scope.sessionId === undefined || record.sessionId === scope.sessionId)
        && (scope.roles === undefined || scope.roles.includes(record.role))
        && (scope.statuses === undefined || scope.statuses.includes(record.status))
      )),
      (record) => record.membershipId,
    ).map((record) => clone(record));
  }

  async revokeMembership(membershipId: string, revokedAt: string): Promise<SessionMembership> {
    const current = this.#memberships.get(membershipId);
    if (!current) {
      throw new SessionControlError("not_found", "成员资格不存在", {
        resource: "membership",
        membershipId,
      });
    }
    if (current.status === "revoked") return clone(current);
    const updated: SessionMembership = {
      ...current,
      status: "revoked",
      updatedAt: revokedAt,
      revokedAt,
    };
    validateMembership(updated);
    this.#memberships.set(membershipId, updated);
    return clone(updated);
  }
}

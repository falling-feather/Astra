import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  PrincipalSchema,
  RoleBindingSchema,
  type Principal,
  type RoleBinding,
  type RoleContract,
} from "@ronggang/contracts";

export const DEMO_AUTH_COOKIE = "rg_demo_sid";
const sessionDurationSeconds = 8 * 60 * 60;

export class AuthenticationRequiredError extends Error {
  constructor(message = "需要先建立本地演示会话") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class RoleBindingDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleBindingDeniedError";
  }
}

interface DemoAuthSessionRecord {
  authSessionId: string;
  sidHash: string;
  csrfHash: string;
  csrfToken: string;
  profile: string;
  principal: Principal;
  bindings: RoleBinding[];
  expiresAt: string;
  revokedAt: string | null;
}

export interface DemoIdentityProfile {
  profileId: string;
  principalId: string;
  displayName: string;
}

export interface MembershipRoleAssignment {
  membershipId: string;
  principalId: string;
  sessionId: string;
  actorId: string;
  actorKind: "teacher" | "student";
  roleId: RoleBinding["roleId"];
  status: "active" | "revoked";
}

export interface DemoAuthContext {
  profileId: string;
  principal: Principal;
  bindings: RoleBinding[];
  csrfToken: string;
  expiresAt: string;
}

export interface IssuedDemoAuthSession {
  token: string;
  context: DemoAuthContext;
}

export interface ResolvedRequestIdentity {
  authSessionId: string;
  profileId: string;
  principal: Principal;
  binding: RoleBinding;
  expiresAt: string;
}

export interface ResolvedRequestPrincipal {
  authSessionId: string;
  profileId: string;
  principal: Principal;
  bindings: RoleBinding[];
  expiresAt: string;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function stableMembershipBindingId(
  principalId: string,
  membership: MembershipRoleAssignment,
): string {
  return `binding-${hashSecret([
    "demo-membership-binding-v1",
    principalId,
    membership.membershipId,
    membership.sessionId,
    membership.actorId,
    membership.actorKind,
    membership.roleId,
  ].join("\u0000")).slice(0, 24)}`;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export class DemoAuthService {
  readonly #sessionsBySidHash = new Map<string, DemoAuthSessionRecord>();
  readonly #now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  issueSession(
    worldSessionId: string,
    profile: "operator" | "student" | "teacher" = "operator",
    roles?: readonly RoleContract[],
  ): IssuedDemoAuthSession {
    const now = this.#now();
    const expiresAt = new Date(Date.parse(now) + sessionDurationSeconds * 1_000).toISOString();
    const token = randomSecret();
    const csrfToken = randomSecret();
    const principal = PrincipalSchema.parse({
      principalId: `principal-${profile}-${randomBytes(8).toString("hex")}`,
      kind: "human",
      displayName: profile === "operator"
        ? "本地演示操作员"
        : profile === "teacher"
          ? "本地演示教师"
          : "本地演示学生",
      status: "active",
      createdAt: now,
    });
    const actorBindings = roles
      ? roles
        .filter((role) => (
          (profile === "operator" && ["teacher", "student"].includes(role.actorKind))
          || role.actorKind === profile
        ))
        .map((role) => ({
          actorId: role.agentId,
          actorKind: role.actorKind as "teacher" | "student",
          roleId: role.roleId,
        }))
      : profile === "operator"
        ? [
          { actorId: "student-editor", actorKind: "student" as const, roleId: "responsible_editor" as const },
          { actorId: "student-reporter", actorKind: "student" as const, roleId: "reporter" as const },
          { actorId: "teacher-main", actorKind: "teacher" as const, roleId: "teacher" as const },
        ]
        : profile === "teacher"
          ? [{ actorId: "teacher-main", actorKind: "teacher" as const, roleId: "teacher" as const }]
          : [
            { actorId: "student-editor", actorKind: "student" as const, roleId: "responsible_editor" as const },
            { actorId: "student-reporter", actorKind: "student" as const, roleId: "reporter" as const },
          ];
    const bindings = actorBindings.map((binding) => RoleBindingSchema.parse({
      bindingId: `binding-${randomBytes(12).toString("hex")}`,
      principalId: principal.principalId,
      sessionId: worldSessionId,
      ...binding,
      status: "active",
      createdAt: now,
      expiresAt,
    }));
    const record: DemoAuthSessionRecord = {
      authSessionId: `auth-session-${randomBytes(12).toString("hex")}`,
      sidHash: hashSecret(token),
      csrfHash: hashSecret(csrfToken),
      csrfToken,
      profile,
      principal,
      bindings,
      expiresAt,
      revokedAt: null,
    };
    this.#sessionsBySidHash.set(record.sidHash, record);
    return {
      token,
      context: {
        profileId: profile,
        principal: structuredClone(principal),
        bindings: structuredClone(bindings),
        csrfToken,
        expiresAt,
      },
    };
  }

  issueMembershipSession(
    profile: DemoIdentityProfile,
    memberships: readonly MembershipRoleAssignment[],
  ): IssuedDemoAuthSession {
    const activeMemberships = memberships.filter((membership) => (
      membership.principalId === profile.principalId
      && membership.status === "active"
    ));
    if (activeMemberships.length === 0) {
      throw new RoleBindingDeniedError("当前演示身份没有可用的班级岗位成员关系");
    }
    return this.#issueProfileSession(profile, activeMemberships);
  }

  issuePrincipalSession(
    profile: DemoIdentityProfile,
  ): IssuedDemoAuthSession {
    return this.#issueProfileSession(profile, []);
  }

  resolvePrincipal(token: string): ResolvedRequestPrincipal {
    const record = this.#requireSession(token);
    return {
      authSessionId: record.authSessionId,
      profileId: record.profile,
      principal: structuredClone(record.principal),
      bindings: structuredClone(record.bindings),
      expiresAt: record.expiresAt,
    };
  }

  context(token:string):DemoAuthContext {
    const record=this.#requireSession(token);
    return {profileId:record.profile,principal:structuredClone(record.principal),bindings:structuredClone(record.bindings),csrfToken:record.csrfToken,expiresAt:record.expiresAt};
  }

  #issueProfileSession(
    profile: DemoIdentityProfile,
    activeMemberships: readonly MembershipRoleAssignment[],
  ): IssuedDemoAuthSession {
    const now = this.#now();
    const expiresAt = new Date(Date.parse(now) + sessionDurationSeconds * 1_000).toISOString();
    const token = randomSecret();
    const csrfToken = randomSecret();
    const principal = PrincipalSchema.parse({
      principalId: profile.principalId,
      kind: "human",
      displayName: profile.displayName,
      status: "active",
      createdAt: now,
    });
    const bindings = this.#createMembershipBindings(
      principal.principalId,
      expiresAt,
      activeMemberships,
      [],
      now,
    );
    const record: DemoAuthSessionRecord = {
      authSessionId: `auth-session-${randomBytes(12).toString("hex")}`,
      sidHash: hashSecret(token),
      csrfHash: hashSecret(csrfToken),
      csrfToken,
      profile: profile.profileId,
      principal,
      bindings,
      expiresAt,
      revokedAt: null,
    };
    this.#sessionsBySidHash.set(record.sidHash, record);
    return {
      token,
      context: {
        profileId: profile.profileId,
        principal: structuredClone(principal),
        bindings: structuredClone(bindings),
        csrfToken,
        expiresAt,
      },
    };
  }

  addWorldSessionBindings(
    token: string,
    worldSessionId: string,
    roles: readonly RoleContract[],
  ): RoleBinding[] {
    const record = this.#requireSession(token);
    const now = this.#now();
    const existingActorIds = new Set(
      record.bindings
        .filter((binding) => binding.sessionId === worldSessionId)
        .map((binding) => binding.actorId),
    );
    const bindings = roles
      .filter((role) => (
        !existingActorIds.has(role.agentId)
        && (
          (record.profile === "operator" && ["teacher", "student"].includes(role.actorKind))
          || role.actorKind === record.profile
        )
      ))
      .map((role) => RoleBindingSchema.parse({
        bindingId: `binding-${randomBytes(12).toString("hex")}`,
        principalId: record.principal.principalId,
        sessionId: worldSessionId,
        actorId: role.agentId,
        actorKind: role.actorKind,
        roleId: role.roleId,
        status: "active",
        createdAt: now,
        expiresAt: record.expiresAt,
      }));
    record.bindings.push(...bindings);
    return structuredClone([
      ...record.bindings.filter((binding) => binding.sessionId === worldSessionId),
    ]);
  }

  addMembershipBindings(
    token: string,
    memberships: readonly MembershipRoleAssignment[],
  ): RoleBinding[] {
    const record = this.#requireSession(token);
    const now = this.#now();
    const activeMemberships = memberships.filter((membership) => (
      membership.principalId === record.principal.principalId
      && membership.status === "active"
    ));
    const bindings = this.#createMembershipBindings(
      record.principal.principalId,
      record.expiresAt,
      activeMemberships,
      record.bindings,
      now,
    );
    record.bindings.push(...bindings);
    const targetSessionIds = new Set(activeMemberships.map((membership) => membership.sessionId));
    return structuredClone(
      record.bindings.filter((binding) => targetSessionIds.has(binding.sessionId)),
    );
  }

  /**
   * Materializes a newly provisioned membership into every still-active demo
   * login for the same principal. This never broadens another principal's
   * session and preserves the stable membership-derived binding id.
   */
  addMembershipBindingsForPrincipal(
    principalId: string,
    memberships: readonly MembershipRoleAssignment[],
  ): RoleBinding[] {
    const now = this.#now();
    const activeMemberships = memberships.filter((membership) => (
      membership.principalId === principalId
      && membership.status === "active"
    ));
    const createdByBindingId = new Map<string, RoleBinding>();
    for (const record of this.#sessionsBySidHash.values()) {
      if (
        record.principal.principalId !== principalId
        || record.revokedAt !== null
        || Date.parse(record.expiresAt) <= Date.parse(now)
      ) continue;
      const created = this.#createMembershipBindings(
        principalId,
        record.expiresAt,
        activeMemberships,
        record.bindings,
        now,
      );
      record.bindings.push(...created);
      for (const binding of created) createdByBindingId.set(binding.bindingId, binding);
      for (const binding of record.bindings) {
        if (activeMemberships.some((membership) => (
          membership.sessionId === binding.sessionId
          && membership.actorId === binding.actorId
        ))) createdByBindingId.set(binding.bindingId, binding);
      }
    }
    return structuredClone([...createdByBindingId.values()]);
  }

  cookieHeader(token: string, secure = false): string {
    return [
      `${DEMO_AUTH_COOKIE}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/api",
      `Max-Age=${sessionDurationSeconds}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  clearCookieHeader(secure = false): string {
    return [
      `${DEMO_AUTH_COOKIE}=`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/api",
      "Max-Age=0",
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  resolveBinding(token: string, bindingId: string, worldSessionId: string): ResolvedRequestIdentity {
    const record = this.#requireSession(token);
    const binding = record.bindings.find((candidate) => candidate.bindingId === bindingId);
    if (
      !binding
      || binding.sessionId !== worldSessionId
      || binding.status !== "active"
      || (binding.expiresAt && Date.parse(binding.expiresAt) <= Date.parse(this.#now()))
    ) {
      throw new RoleBindingDeniedError("当前会话没有该岗位绑定");
    }
    if (!["teacher", "student"].includes(binding.actorKind)) {
      throw new RoleBindingDeniedError("浏览器会话不能绑定智能体或系统身份");
    }
    return {
      authSessionId: record.authSessionId,
      profileId: record.profile,
      principal: structuredClone(record.principal),
      binding: structuredClone(binding),
      expiresAt: record.expiresAt,
    };
  }

  assertCsrf(token: string, csrfToken: string | undefined): void {
    if (!csrfToken) throw new RoleBindingDeniedError("写请求缺少 CSRF 凭据");
    const record = this.#requireSession(token);
    if (!secureEquals(record.csrfHash, hashSecret(csrfToken))) {
      throw new RoleBindingDeniedError("CSRF 凭据无效");
    }
  }

  revoke(token: string): void {
    const record = this.#requireSession(token);
    record.revokedAt = this.#now();
  }

  #requireSession(token: string): DemoAuthSessionRecord {
    const record = this.#sessionsBySidHash.get(hashSecret(token));
    if (
      !record
      || record.revokedAt
      || record.principal.status !== "active"
      || Date.parse(record.expiresAt) <= Date.parse(this.#now())
    ) {
      throw new AuthenticationRequiredError("演示会话不存在、已过期或已注销");
    }
    return record;
  }

  #createMembershipBindings(
    principalId: string,
    expiresAt: string,
    memberships: readonly MembershipRoleAssignment[],
    existingBindings: readonly RoleBinding[],
    now: string,
  ): RoleBinding[] {
    const existingKeys = new Set(existingBindings.map(
      (binding) => `${binding.sessionId}:${binding.actorId}`,
    ));
    const created: RoleBinding[] = [];
    for (const membership of memberships) {
      const key = `${membership.sessionId}:${membership.actorId}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      created.push(RoleBindingSchema.parse({
        // The login token remains fresh and revocable, while a membership is
        // durable. A stable demo binding lets the same learner resume pending
        // collaboration and media revisions after role switches or restarts;
        // resolveBinding still requires the current authenticated session.
        bindingId: stableMembershipBindingId(principalId, membership),
        principalId,
        sessionId: membership.sessionId,
        actorId: membership.actorId,
        actorKind: membership.actorKind,
        roleId: membership.roleId,
        status: "active",
        createdAt: now,
        expiresAt,
      }));
    }
    return created;
  }
}

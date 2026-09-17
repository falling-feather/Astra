import { describe, expect, it } from "vitest";
import {
  DemoAuthService,
  RoleBindingDeniedError,
  type MembershipRoleAssignment,
} from "../src/identity.js";

const profile = {
  profileId: "student-team-a",
  principalId: "principal-student-team-a",
  displayName: "A 班采编学生",
};

function membership(
  overrides: Partial<MembershipRoleAssignment> = {},
): MembershipRoleAssignment {
  return {
    membershipId: "membership-student-a-reporter",
    principalId: profile.principalId,
    sessionId: "session-a",
    actorId: "student-reporter",
    actorKind: "student",
    roleId: "reporter",
    status: "active",
    ...overrides,
  };
}

describe("DemoAuthService membership-driven issuance", () => {
  it("issues a principal-only session before an unassigned learner claims a course", () => {
    const auth = new DemoAuthService({
      now: () => "2026-07-26T08:00:00.000Z",
    });
    const issued = auth.issuePrincipalSession({
      ...profile,
      profileId: "student-unassigned",
      principalId: "principal-student-unassigned",
    });

    expect(issued.context.bindings).toEqual([]);
    expect(auth.resolvePrincipal(issued.token)).toMatchObject({
      profileId: "student-unassigned",
      principal: { principalId: "principal-student-unassigned" },
      bindings: [],
    });
    expect(() => auth.resolveBinding(
      issued.token,
      "binding-forged",
      "session-a",
    )).toThrow(RoleBindingDeniedError);
  });

  it("derives a stable principal and only active server-side memberships", () => {
    const auth = new DemoAuthService({
      now: () => "2026-07-26T08:00:00.000Z",
    });
    const issued = auth.issueMembershipSession(profile, [
      membership(),
      membership({
        membershipId: "membership-revoked",
        actorId: "student-editor",
        roleId: "responsible_editor",
        status: "revoked",
      }),
      membership({
        membershipId: "membership-other-principal",
        principalId: "principal-other",
        actorId: "student-editor",
        roleId: "responsible_editor",
      }),
    ]);

    expect(issued.context.principal.principalId).toBe(profile.principalId);
    expect(issued.context.bindings).toHaveLength(1);
    expect(issued.context.bindings[0]).toMatchObject({
      sessionId: "session-a",
      actorId: "student-reporter",
      actorKind: "student",
      roleId: "reporter",
    });
  });

  it("keeps one membership binding stable across fresh demo logins", () => {
    const auth = new DemoAuthService({
      now: () => "2026-07-26T08:00:00.000Z",
    });
    const first = auth.issueMembershipSession(profile, [membership()]);
    const second = auth.issueMembershipSession(profile, [membership()]);

    expect(first.token).not.toBe(second.token);
    expect(first.context.bindings[0]?.bindingId).toBe(
      second.context.bindings[0]?.bindingId,
    );
    expect(auth.resolveBinding(
      second.token,
      first.context.bindings[0]!.bindingId,
      "session-a",
    ).binding.actorId).toBe("student-reporter");
  });

  it("adds only the authenticated principal memberships without duplicate actors", () => {
    const auth = new DemoAuthService({
      now: () => "2026-07-26T08:00:00.000Z",
    });
    const issued = auth.issueMembershipSession(profile, [membership()]);
    const first = auth.addMembershipBindings(issued.token, [
      membership(),
      membership({
        membershipId: "membership-session-b-editor",
        sessionId: "session-b",
        actorId: "student-editor",
        roleId: "responsible_editor",
      }),
      membership({
        membershipId: "membership-other",
        principalId: "principal-other",
        sessionId: "session-b",
      }),
    ]);
    const second = auth.addMembershipBindings(issued.token, [
      membership({
        membershipId: "membership-session-b-editor",
        sessionId: "session-b",
        actorId: "student-editor",
        roleId: "responsible_editor",
      }),
    ]);

    expect(first).toHaveLength(2);
    expect(second.filter((binding) => binding.sessionId === "session-b")).toHaveLength(1);
  });

  it("adds a provisioned second-session binding to every active login of the exact principal", () => {
    const auth = new DemoAuthService({
      now: () => "2026-07-26T08:00:00.000Z",
    });
    const first = auth.issueMembershipSession(profile, [membership()]);
    const second = auth.issueMembershipSession(profile, [membership()]);
    const other = auth.issueMembershipSession({
      profileId: "student-team-b",
      principalId: "principal-student-team-b",
      displayName: "B 班采编学生",
    }, [membership({
      principalId: "principal-student-team-b",
      membershipId: "membership-student-b-reporter",
    })]);
    const secondSession = membership({
      membershipId: "membership-student-a-second-session",
      sessionId: "session-adaptive-v4",
    });
    const created = auth.addMembershipBindingsForPrincipal(
      profile.principalId,
      [secondSession],
    );
    expect(created).toHaveLength(1);
    expect(auth.resolvePrincipal(first.token).bindings).toContainEqual(
      expect.objectContaining({ sessionId: "session-adaptive-v4" }),
    );
    expect(auth.resolvePrincipal(second.token).bindings).toContainEqual(
      expect.objectContaining({ sessionId: "session-adaptive-v4" }),
    );
    expect(auth.resolvePrincipal(other.token).bindings).not.toContainEqual(
      expect.objectContaining({ sessionId: "session-adaptive-v4" }),
    );
  });

  it("rejects profiles without an active membership", () => {
    const auth = new DemoAuthService();
    expect(() => auth.issueMembershipSession(profile, [
      membership({ status: "revoked" }),
    ])).toThrow(RoleBindingDeniedError);
  });
});

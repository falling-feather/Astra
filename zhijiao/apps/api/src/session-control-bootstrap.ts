import type { RoleContract } from "@ronggang/contracts";
import {
  type SessionControlService,
  type SessionMembership,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import {
  RoleBindingDeniedError,
  type DemoIdentityProfile,
  type MembershipRoleAssignment,
} from "./identity.js";

export const DEMO_CLASSROOM_A_ID = "classroom-local-tourism-a";
export const DEMO_CLASSROOM_B_ID = "classroom-local-tourism-b";
export const DEMO_TEAM_A_ID = "team-local-tourism-a";
export const DEMO_TEAM_B_ID = "team-local-tourism-b";
export const DEMO_SECONDARY_SESSION_ID = "demo-local-tourism-b";

export interface DemoProfileDefinition extends DemoIdentityProfile {
  defaultSessionId: string | null;
  classroomId: string;
  teamId: string | null;
  role: "operator" | "teacher" | "student";
}

export const demoProfileDefinitions:readonly DemoProfileDefinition[] = [
  {
    profileId: "operator-demo",
    principalId: "principal-operator-demo",
    displayName: "系统管理员（全功能演示）",
    defaultSessionId: "demo-local-tourism",
    classroomId: DEMO_CLASSROOM_A_ID,
    teamId: DEMO_TEAM_A_ID,
    role: "operator",
  },
  {
    profileId: "teacher-class-a",
    principalId: "principal-teacher-class-a",
    displayName: "地方文旅 A 班教师",
    defaultSessionId: "demo-local-tourism",
    classroomId: DEMO_CLASSROOM_A_ID,
    teamId: null,
    role: "teacher",
  },
  {
    profileId: "student-team-a",
    principalId: "principal-student-team-a",
    displayName: "学生2",
    defaultSessionId: "demo-local-tourism",
    classroomId: DEMO_CLASSROOM_A_ID,
    teamId: DEMO_TEAM_A_ID,
    role: "student",
  },
  {
    profileId: "student-unassigned",
    principalId: "principal-student-unassigned",
    displayName: "学生1",
    defaultSessionId: null,
    classroomId: DEMO_CLASSROOM_A_ID,
    teamId: DEMO_TEAM_A_ID,
    role: "student",
  },
  {
    profileId: "teacher-class-b",
    principalId: "principal-teacher-class-b",
    displayName: "地方文旅 B 班教师",
    defaultSessionId: DEMO_SECONDARY_SESSION_ID,
    classroomId: DEMO_CLASSROOM_B_ID,
    teamId: null,
    role: "teacher",
  },
  {
    profileId: "student-team-b",
    principalId: "principal-student-team-b",
    displayName: "学生3",
    defaultSessionId: DEMO_SECONDARY_SESSION_ID,
    classroomId: DEMO_CLASSROOM_B_ID,
    teamId: DEMO_TEAM_B_ID,
    role: "student",
  },
  {profileId:'teacher-demo',principalId:'principal-teacher-demo',displayName:'演示教师',defaultSessionId:'demo-xunpu-v2',classroomId:DEMO_CLASSROOM_A_ID,teamId:null,role:'teacher'},
  ...Array.from({length:17},(_,index):DemoProfileDefinition=>{
    const number=index+4,inClassA=number<=11;
    return {profileId:`student-roster-${number}`,principalId:`principal-student-roster-${number}`,displayName:`学生${number}`,defaultSessionId:null,
      classroomId:inClassA?DEMO_CLASSROOM_A_ID:DEMO_CLASSROOM_B_ID,teamId:inClassA?DEMO_TEAM_A_ID:DEMO_TEAM_B_ID,role:'student'};
  }),
];

const fixedSeedTime = "2026-07-26T00:00:00.000Z";

function rosterMemberships(): SessionMembership[] {
  const membership = (
    profile: DemoProfileDefinition,
    actorId: string,
    role: "teacher" | "student",
    suffix: string,
  ): SessionMembership => ({
    membershipId: `membership-${profile.profileId}-${suffix}`,
    principalId: profile.principalId,
    classroomId: profile.classroomId,
    teamId: role === "teacher" ? null : profile.teamId,
    sessionId: null,
    role,
    actorId,
    status: "active",
    createdAt: fixedSeedTime,
    updatedAt: fixedSeedTime,
    revokedAt: null,
  });
  const byId = new Map(demoProfileDefinitions.map((profile) => [profile.profileId, profile]));
  const operator = byId.get("operator-demo")!;
  const teacherA = byId.get("teacher-class-a")!;
  const studentA = byId.get("student-team-a")!;
  const teacherB = byId.get("teacher-class-b")!;
  const studentB = byId.get("student-team-b")!;
  const teacherDemo=byId.get('teacher-demo')!;
  const additionalStudents=demoProfileDefinitions.filter(profile=>profile.role==='student'&&!['student-team-a','student-team-b'].includes(profile.profileId));
  return [
    membership(operator, "teacher-main", "teacher", "teacher"),
    membership(operator, "student-editor", "student", "editor"),
    membership(operator, "student-reporter", "student", "reporter"),
    membership(teacherA, "teacher-main", "teacher", "teacher"),
    membership(studentA, "student-editor", "student", "editor"),
    membership(studentA, "student-reporter", "student", "reporter"),
    membership(teacherB, "teacher-main", "teacher", "teacher"),
    membership(studentB, "student-editor", "student", "editor"),
    membership(studentB, "student-reporter", "student", "reporter"),
    membership(teacherDemo,'teacher-main','teacher','class-a'),
    membership({...teacherDemo,classroomId:DEMO_CLASSROOM_B_ID},'teacher-main','teacher','class-b'),
    ...additionalStudents.map(profile=>membership(profile,'student-reporter','student','reporter')),
  ];
}

export async function seedDemoOrganization(
  control: SessionControlService,
): Promise<void> {
  for (const classroom of [
    {
      classroomId: DEMO_CLASSROOM_A_ID,
      courseId: "course-local-tourism-media",
      name: "地方文旅融媒体 A 班",
      status: "active" as const,
      createdAt: fixedSeedTime,
      updatedAt: fixedSeedTime,
    },
    {
      classroomId: DEMO_CLASSROOM_B_ID,
      courseId: "course-local-tourism-media",
      name: "地方文旅融媒体 B 班",
      status: "active" as const,
      createdAt: fixedSeedTime,
      updatedAt: fixedSeedTime,
    },
  ]) {
    if (!await control.getClassroom(classroom.classroomId)) {
      await control.putClassroom(classroom);
    }
  }
  for (const team of [
    {
      teamId: DEMO_TEAM_A_ID,
      classroomId: DEMO_CLASSROOM_A_ID,
      name: "A 班采编组",
      status: "active" as const,
      createdAt: fixedSeedTime,
      updatedAt: fixedSeedTime,
    },
    {
      teamId: DEMO_TEAM_B_ID,
      classroomId: DEMO_CLASSROOM_B_ID,
      name: "B 班采编组",
      status: "active" as const,
      createdAt: fixedSeedTime,
      updatedAt: fixedSeedTime,
    },
  ]) {
    if (!await control.getTeam(team.teamId)) await control.putTeam(team);
  }
  for (const membership of rosterMemberships()) {
    if (!await control.getMembership(membership.membershipId)) {
      await control.putMembership(membership);
    }
  }
}

export function getDemoProfile(profileId: string): DemoProfileDefinition {
  const profile = demoProfileDefinitions.find((candidate) => candidate.profileId === profileId);
  if (!profile) {
    throw new RoleBindingDeniedError("未知的本地演示身份");
  }
  return profile;
}

export async function materializeProfileAssignments(input: {
  control: SessionControlService;
  profile: DemoProfileDefinition;
  session: TrainingSessionRecord;
  roles: readonly RoleContract[];
}): Promise<MembershipRoleAssignment[]> {
  const memberships = await input.control.listMemberships({
    principalId: input.profile.principalId,
    classroomId: input.session.classroomId,
    statuses: ["active"],
  });
  const assignments: MembershipRoleAssignment[] = [];
  for (const membership of memberships) {
    if (input.session.requiresExplicitStudentMembership && membership.role === "student" && membership.sessionId === null) continue;
    if (
      membership.sessionId !== null
      && membership.sessionId !== input.session.sessionId
    ) {
      continue;
    }
    if (
      membership.teamId !== null
      && membership.teamId !== input.session.teamId
    ) {
      continue;
    }
    const role = input.roles.find((candidate) => (
      candidate.agentId === membership.actorId
      && candidate.actorKind === membership.role
    ));
    if (!role || !["teacher", "student"].includes(role.actorKind)) continue;
    assignments.push({
      membershipId: membership.membershipId,
      principalId: membership.principalId,
      sessionId: input.session.sessionId,
      actorId: role.agentId,
      actorKind: role.actorKind as "teacher" | "student",
      roleId: role.roleId,
      status: membership.status,
    });
  }
  if (assignments.length === 0) {
    throw new RoleBindingDeniedError("该身份不是目标班级或团队的有效成员");
  }
  return assignments;
}

export async function assertTeacherScope(input: {
  control: SessionControlService;
  principalId: string;
  classroomId: string;
  teamId: string;
}): Promise<void> {
  const memberships = await input.control.listMemberships({
    principalId: input.principalId,
    classroomId: input.classroomId,
    roles: ["teacher"],
    statuses: ["active"],
  });
  const allowed = memberships.some((membership) => (
    membership.teamId === null || membership.teamId === input.teamId
  ));
  if (!allowed) {
    throw new RoleBindingDeniedError("教师不在目标班级或团队的授权范围内");
  }
}

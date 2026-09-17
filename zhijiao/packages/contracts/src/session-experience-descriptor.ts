import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const SessionExperienceDescriptorSchemaVersion =
  "session-experience-descriptor/4.0.0" as const;

export const SessionExperienceGenerationSchema = z.enum([
  "standard_v2",
  "flagship_v3",
  "flagship_v4",
]);
export type SessionExperienceGeneration = z.infer<
  typeof SessionExperienceGenerationSchema
>;

export const SessionExperienceCapabilitySchema = z.enum([
  "learning_activity",
  "course_outcomes",
  "world_v3",
  "collaboration_episode_v3",
  "student_work_v3",
  "assessment_v3",
  "learner_adaptation_v3",
  "semantic_action_v4",
  "autonomous_world_v4",
  "grounded_collaboration_v4",
  "media_workspace_v4",
  "evidence_assessment_v4",
  "learner_adaptation_v4",
  "operations_observability",
]);
export type SessionExperienceCapability = z.infer<
  typeof SessionExperienceCapabilitySchema
>;

export const SessionExperienceEntryRouteSchema = z.object({
  student: z.literal("/student/training/:sessionId"),
  teacher: z.literal("/teacher/director/:sessionId"),
  studentReview: z.literal("/student/reviews/:sessionId"),
  teacherReview: z.literal("/teacher/reviews/:sessionId"),
  administrator: z.literal("/admin/agent-topology/:sessionId"),
}).strict();
export type SessionExperienceEntryRoute = z.infer<
  typeof SessionExperienceEntryRouteSchema
>;

const descriptorBase = z.object({
  schemaVersion: z.literal(SessionExperienceDescriptorSchemaVersion),
  descriptorId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  capabilities: z.array(SessionExperienceCapabilitySchema).min(2).max(32),
  entryRoute: SessionExperienceEntryRouteSchema,
  compatibility: z.enum(["current", "historical"]),
  frozenAt: z.string().datetime(),
}).strict();

const StandardSessionExperienceDescriptorSchema = descriptorBase.extend({
  experienceGeneration: z.literal("standard_v2"),
  courseReleaseRef: CourseReleaseReferenceSchema.nullable(),
}).strict();

const FlagshipV3SessionExperienceDescriptorSchema = descriptorBase.extend({
  experienceGeneration: z.literal("flagship_v3"),
  courseReleaseRef: CourseReleaseReferenceSchema,
}).strict();

const FlagshipV4SessionExperienceDescriptorSchema = descriptorBase.extend({
  experienceGeneration: z.literal("flagship_v4"),
  courseReleaseRef: CourseReleaseReferenceSchema,
}).strict();

const requiredCapabilities: Record<SessionExperienceGeneration, readonly SessionExperienceCapability[]> = {
  standard_v2: ["learning_activity", "course_outcomes"],
  flagship_v3: [
    "world_v3",
    "collaboration_episode_v3",
    "student_work_v3",
    "assessment_v3",
    "learner_adaptation_v3",
  ],
  flagship_v4: [
    "world_v3",
    "collaboration_episode_v3",
    "student_work_v3",
    "semantic_action_v4",
    "autonomous_world_v4",
    "grounded_collaboration_v4",
    "media_workspace_v4",
    "evidence_assessment_v4",
    "learner_adaptation_v4",
  ],
};

export const SessionExperienceDescriptorSchema = z.discriminatedUnion(
  "experienceGeneration",
  [
    StandardSessionExperienceDescriptorSchema,
    FlagshipV3SessionExperienceDescriptorSchema,
    FlagshipV4SessionExperienceDescriptorSchema,
  ],
).superRefine((descriptor, context) => {
  if (new Set(descriptor.capabilities).size !== descriptor.capabilities.length) {
    context.addIssue({
      code: "custom",
      path: ["capabilities"],
      message: "会话能力不得重复",
    });
  }
  for (const capability of requiredCapabilities[descriptor.experienceGeneration]) {
    if (!descriptor.capabilities.includes(capability)) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: `${descriptor.experienceGeneration} 缺少必需能力 ${capability}`,
      });
    }
  }
  if (
    descriptor.experienceGeneration !== "standard_v2"
    && descriptor.compatibility === "current"
    && !descriptor.capabilities.includes("operations_observability")
  ) {
    context.addIssue({
      code: "custom",
      path: ["capabilities"],
      message: "当前旗舰会话必须声明管理员运行可观测能力",
    });
  }
});
export type SessionExperienceDescriptor = z.infer<
  typeof SessionExperienceDescriptorSchema
>;

export const SessionExperienceDescriptorResponseSchema = z.object({
  descriptor: SessionExperienceDescriptorSchema,
}).strict();
export type SessionExperienceDescriptorResponse = z.infer<
  typeof SessionExperienceDescriptorResponseSchema
>;

export const DefaultSessionExperienceEntryRoute = Object.freeze({
  student: "/student/training/:sessionId",
  teacher: "/teacher/director/:sessionId",
  studentReview: "/student/reviews/:sessionId",
  teacherReview: "/teacher/reviews/:sessionId",
  administrator: "/admin/agent-topology/:sessionId",
} as const satisfies SessionExperienceEntryRoute);

export function sessionExperienceCapabilities(
  generation: SessionExperienceGeneration,
): SessionExperienceCapability[] {
  const base = requiredCapabilities[generation];
  return generation === "standard_v2"
    ? [...base]
    : [...base, "operations_observability"];
}

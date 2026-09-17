import {
  DefaultSessionExperienceEntryRoute,
  SessionExperienceDescriptorSchema,
  SessionExperienceDescriptorSchemaVersion,
  sessionExperienceCapabilities,
  type SessionExperienceDescriptor,
  type SessionExperienceGeneration,
} from "../src/index.js";

export function sessionExperienceDescriptorFixture(
  generation: SessionExperienceGeneration = "flagship_v4",
): SessionExperienceDescriptor {
  return SessionExperienceDescriptorSchema.parse({
    schemaVersion: SessionExperienceDescriptorSchemaVersion,
    descriptorId: `descriptor-session-${generation}`,
    sessionId: `session-${generation}`,
    courseReleaseRef: generation === "standard_v2"
      ? null
      : {
          courseId: "course-xunpu-intangible-media",
          releaseId: "course-xunpu-r4",
          version: 4,
          contentHash: "a".repeat(64),
        },
    scenarioReleaseRef: {
      scenarioId: generation === "standard_v2"
        ? "scenario-village-super"
        : "scenario-xunpu-living-world",
      version: generation === "standard_v2" ? "2.0.0" : "4.0.0",
      contentHash: "b".repeat(64),
    },
    experienceGeneration: generation,
    capabilities: sessionExperienceCapabilities(generation),
    entryRoute: DefaultSessionExperienceEntryRoute,
    compatibility: generation === "flagship_v3" ? "historical" : "current",
    frozenAt: "2026-09-01T00:00:00.000Z",
  });
}

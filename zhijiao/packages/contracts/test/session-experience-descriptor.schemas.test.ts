import { describe, expect, it } from "vitest";
import {
  SessionExperienceDescriptorResponseSchema,
  SessionExperienceDescriptorSchema,
  sessionExperienceCapabilities,
} from "../src/index.js";
import { sessionExperienceDescriptorFixture } from "./session-experience-descriptor.fixture.js";

describe("SessionExperienceDescriptor/4.0.0", () => {
  it.each(["standard_v2", "flagship_v3", "flagship_v4"] as const)(
    "accepts the explicit %s generation",
    (generation) => {
      const descriptor = sessionExperienceDescriptorFixture(generation);
      expect(SessionExperienceDescriptorResponseSchema.parse({ descriptor }))
        .toEqual({ descriptor });
    },
  );

  it("rejects browser generation hints and extra routing fields", () => {
    const forged = {
      ...sessionExperienceDescriptorFixture(),
      requestedGeneration: "standard_v2",
    };
    expect(SessionExperienceDescriptorSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects missing generation capabilities and duplicate capabilities", () => {
    const missing = structuredClone(sessionExperienceDescriptorFixture());
    missing.capabilities = missing.capabilities.filter((item) => (
      item !== "semantic_action_v4"
    ));
    expect(SessionExperienceDescriptorSchema.safeParse(missing).success).toBe(false);

    const duplicated = structuredClone(sessionExperienceDescriptorFixture());
    duplicated.capabilities = [
      ...sessionExperienceCapabilities("flagship_v4"),
      "world_v3",
    ];
    expect(SessionExperienceDescriptorSchema.safeParse(duplicated).success).toBe(false);
  });

  it("requires an immutable course release for every flagship generation", () => {
    const descriptor = {
      ...sessionExperienceDescriptorFixture("flagship_v3"),
      courseReleaseRef: null,
    };
    expect(SessionExperienceDescriptorSchema.safeParse(descriptor).success).toBe(false);
  });
});

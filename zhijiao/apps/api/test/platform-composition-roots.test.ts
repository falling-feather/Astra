import { describe, expect, it } from "vitest";
import {
  createPlatformCompositionRoots,
  PlatformCompositionRootError,
} from "../src/platform-composition-roots.js";

function minimalRuntime(label: string) {
  return createPlatformCompositionRoots({
    course: {
      learning: { label: `${label}:learning` },
      sessionExperienceDescriptors: { label: `${label}:descriptor` },
    },
    world: {
      authoritativeWorld: { label: `${label}:world` },
      simulationWorld: { label: `${label}:simulation` },
      collaboration: { label: `${label}:collaboration` },
      director: { label: `${label}:director` },
      flagshipExperience: { label: `${label}:experience` },
    },
    work: {
      legacyMedia: { label: `${label}:legacy-media` },
      flagshipStudentWork: { label: `${label}:work` },
      flagshipMedia: { label: `${label}:media` },
    },
    assessment: {
      flagshipV3: { label: `${label}:assessment-v3` },
      flagshipV4: { label: `${label}:assessment-v4` },
    },
    adaptation: {
      flagshipV3: { label: `${label}:adaptation-v3` },
      flagshipV4: { label: `${label}:adaptation-v4` },
    },
    operations: {
      auth: { label: `${label}:auth` },
      sessionControl: { label: `${label}:operations` },
      businessOperations: { label: `${label}:business-operations` },
      modelIntegration: { label: `${label}:model` },
      legacyAgentOrchestrator: { label: `${label}:orchestrator` },
    },
  });
}

describe("platform composition roots", () => {
  it("keeps a second minimal runtime isolated from the first root graph", () => {
    const first = minimalRuntime("first");
    const second = minimalRuntime("second");
    expect(first).not.toBe(second);
    expect(first.world).not.toBe(second.world);
    expect(first.world.authoritativeWorld).not.toBe(
      second.world.authoritativeWorld,
    );
    expect(second.course.learning).toEqual({ label: "second:learning" });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.course)).toBe(true);
  });

  it("fails startup when any declared root component is missing", () => {
    expect(() => createPlatformCompositionRoots({
      course: { learning: undefined, sessionExperienceDescriptors: {} },
      world: {
        authoritativeWorld: {}, simulationWorld: {}, collaboration: {},
        director: {}, flagshipExperience: {},
      },
      work: { legacyMedia: {}, flagshipStudentWork: {}, flagshipMedia: {} },
      assessment: { flagshipV3: {}, flagshipV4: {} },
      adaptation: { flagshipV3: {}, flagshipV4: {} },
      operations: {
        auth: {}, sessionControl: {}, businessOperations: {}, modelIntegration: {},
        legacyAgentOrchestrator: {},
      },
    })).toThrowError(PlatformCompositionRootError);
  });
});

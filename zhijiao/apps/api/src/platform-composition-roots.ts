export class PlatformCompositionRootError extends Error {
  constructor(
    readonly root: string,
    readonly component: string,
  ) {
    super(`组合根 ${root} 缺少必需组件 ${component}`);
    this.name = "PlatformCompositionRootError";
  }
}

type RootShape = object;

export interface CourseCompositionPorts {
  learning: unknown;
  sessionExperienceDescriptors: unknown;
}

export interface WorldCompositionPorts {
  authoritativeWorld: unknown;
  simulationWorld: unknown;
  collaboration: unknown;
  director: unknown;
  flagshipExperience: unknown;
}

export interface WorkCompositionPorts {
  legacyMedia: unknown;
  flagshipStudentWork: unknown;
  flagshipMedia: unknown;
}

export interface AssessmentCompositionPorts {
  flagshipV3: unknown;
  flagshipV4: unknown;
}

export interface AdaptationCompositionPorts {
  flagshipV3: unknown;
  flagshipV4: unknown;
}

export interface OperationsCompositionPorts {
  auth: unknown;
  sessionControl: unknown;
  businessOperations: unknown;
  modelIntegration: unknown;
  legacyAgentOrchestrator: unknown;
}

export interface PlatformCompositionRootInput<
  Course extends CourseCompositionPorts,
  World extends WorldCompositionPorts,
  Work extends WorkCompositionPorts,
  Assessment extends AssessmentCompositionPorts,
  Adaptation extends AdaptationCompositionPorts,
  Operations extends OperationsCompositionPorts,
> {
  course: Course;
  world: World;
  work: Work;
  assessment: Assessment;
  adaptation: Adaptation;
  operations: Operations;
}

export type PlatformCompositionRoots<
  Course extends CourseCompositionPorts,
  World extends WorldCompositionPorts,
  Work extends WorkCompositionPorts,
  Assessment extends AssessmentCompositionPorts,
  Adaptation extends AdaptationCompositionPorts,
  Operations extends OperationsCompositionPorts,
> = Readonly<{
  course: Readonly<Course>;
  world: Readonly<World>;
  work: Readonly<Work>;
  assessment: Readonly<Assessment>;
  adaptation: Readonly<Adaptation>;
  operations: Readonly<Operations>;
}>;

function freezeRoot<T extends RootShape>(name: string, root: T): Readonly<T> {
  for (const [component, value] of Object.entries(root)) {
    if (value === null || value === undefined) {
      throw new PlatformCompositionRootError(name, component);
    }
  }
  return Object.freeze({ ...root });
}

/**
 * Establishes the six explicit application boundaries used by server.ts.
 * Only the small root records are frozen; the injected services keep their
 * own lifecycle and remain replaceable in tests.
 */
export function createPlatformCompositionRoots<
  Course extends CourseCompositionPorts,
  World extends WorldCompositionPorts,
  Work extends WorkCompositionPorts,
  Assessment extends AssessmentCompositionPorts,
  Adaptation extends AdaptationCompositionPorts,
  Operations extends OperationsCompositionPorts,
>(
  input: PlatformCompositionRootInput<
    Course,
    World,
    Work,
    Assessment,
    Adaptation,
    Operations
  >,
): PlatformCompositionRoots<
  Course,
  World,
  Work,
  Assessment,
  Adaptation,
  Operations
> {
  return Object.freeze({
    course: freezeRoot("course-composition", input.course),
    world: freezeRoot("world-composition", input.world),
    work: freezeRoot("work-composition", input.work),
    assessment: freezeRoot("assessment-composition", input.assessment),
    adaptation: freezeRoot("adaptation-composition", input.adaptation),
    operations: freezeRoot("operations-composition", input.operations),
  });
}

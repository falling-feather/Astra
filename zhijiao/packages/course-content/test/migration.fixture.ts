import {
  aiCopyrightCourseRelease,
  rainEmergencyCourseRelease,
  villageSuperCourseRelease,
  type CourseContentRelease,
  type CourseSection,
  type KnowledgeRecord,
} from "../src/index.js";

export type MutableMigrationCourseFixture = Omit<
  CourseContentRelease,
  "sections" | "knowledgeRecords"
> & {
  sections: CourseSection[];
  knowledgeRecords: KnowledgeRecord[];
};

export function migrationCourseFixture(
  release: CourseContentRelease = villageSuperCourseRelease,
): MutableMigrationCourseFixture {
  return structuredClone(release) as MutableMigrationCourseFixture;
}

export const migrationCourseFixtures = {
  village: () => migrationCourseFixture(villageSuperCourseRelease),
  aiCopyright: () => migrationCourseFixture(aiCopyrightCourseRelease),
  rain: () => migrationCourseFixture(rainEmergencyCourseRelease),
} as const;

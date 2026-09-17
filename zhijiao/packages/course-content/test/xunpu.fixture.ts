import {
  xunpuCourseRelease,
  type CourseContentRelease,
  type CourseSection,
  type KnowledgeRecord,
} from "../src/index.js";

export type MutableCourseFixture = Omit<
  CourseContentRelease,
  "sections" | "knowledgeRecords"
> & {
  sections: CourseSection[];
  knowledgeRecords: KnowledgeRecord[];
};

export function xunpuCourseFixture(): MutableCourseFixture {
  return structuredClone(xunpuCourseRelease) as MutableCourseFixture;
}

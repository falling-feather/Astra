import { CourseLearningError } from "./course-learning.js";

export interface ContentLibraryIdentity {
  principalId: string;
  role: "student" | "teacher" | "operator";
  /** Populated from the server enrollment store, never from a request body. */
  enrolledCourseIds?: ReadonlySet<string>;
}

export function assertContentCourseAccess(identity: ContentLibraryIdentity, courseId?: string | null): void {
  if (identity.role === "student" && (!courseId || !identity.enrolledCourseIds?.has(courseId))) {
    throw new CourseLearningError("access_denied", "请先认领此课程，再访问对应教学资料");
  }
}

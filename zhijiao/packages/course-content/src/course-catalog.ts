import { deepFreeze } from "./canonical.js";
import { aiCopyrightCourseRelease } from "./ai-copyright-course.js";
import { rainEmergencyCourseRelease } from "./rain-emergency-course.js";
import { villageSuperCourseRelease } from "./village-super-course.js";
import { villagePostpublicationCourseRelease } from "./village-postpublication-case.js";
import { xunpuCourseRelease } from "./xunpu-course.js";

export const courseContentReleases = deepFreeze([
  xunpuCourseRelease,
  villageSuperCourseRelease,
  villagePostpublicationCourseRelease,
  aiCopyrightCourseRelease,
  rainEmergencyCourseRelease,
]);

export const courseContentReleaseCount = courseContentReleases.length;
export const courseContentSectionCount = courseContentReleases.reduce(
  (total, course) => total + course.sections.length,
  0,
);
export const courseContentKnowledgeRecordCount = courseContentReleases.reduce(
  (total, course) => total + course.knowledgeRecords.length,
  0,
);

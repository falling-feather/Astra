import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StudentCourseArchiveV3Schema } from "@ronggang/contracts";
import { courseRegionAssignments } from "@ronggang/course-content";
import { PermissionDeniedError } from "@ronggang/world-core";
import type { CourseLearningRouteDependencies } from "./course-learning-routes.js";
import type { CourseLearningService } from "./course-learning.js";
import type { TeachingTaskService } from "./teaching-task-service.js";
import type { TeachingAuthorizer } from "./character-studio-routes.js";

export async function registerCourseArchiveRoutes(app: FastifyInstance, dependencies: {
  service: CourseLearningService;
  authorize: CourseLearningRouteDependencies["authorizePrincipal"];
  teaching?: { tasks: TeachingTaskService; authorize: TeachingAuthorizer };
}) {
  app.get("/api/v3/course-archive", async request => {
    z.object({}).strict().parse(request.query);
    const principal = await dependencies.authorize({ request, mutation: false });
    if (principal.subject.role !== "student") throw new PermissionDeniedError("学生课程档案仅供学生本人查看");
    const enrollments = await dependencies.service.listEnrollments(principal);
    const courses: import("@ronggang/contracts").CourseArchiveItemV3[] = dependencies.service.listCourses().map(course => {
      const region = courseRegionAssignments.find(item => item.courseId === course.courseId);
      if (!region) throw new Error(`课程缺少地区定义：${course.courseId}`);
      const { courseId: _id, ...presentation } = region;
      return { ...presentation, entryId: course.courseId, courseRef: { courseId: course.courseId, releaseId: course.releaseId, version: course.version, contentHash: course.contentHash },
        title: course.title, summary: region.summary, durationLabel: "约45–60分钟",
        enrollment: enrollments.find(item => item.courseReleaseRef.courseId === course.courseId) ?? null };
    }).sort((a, b) => a.order - b.order);
    if (dependencies.teaching) {
      const actor = await dependencies.teaching.authorize(request,false), tasks = await dependencies.teaching.tasks.workspace(actor);
      const latest = new Map<string, typeof tasks.releases[number]>();
      for (const task of tasks.releases) if (!latest.has(task.ref.taskId) || latest.get(task.ref.taskId)!.ref.revision < task.ref.revision) latest.set(task.ref.taskId,task);
      for (const task of latest.values()) {
        const base = courses.find(course => course.courseRef.courseId === task.sourceCourseRef.courseId);
        if (base) courses.push({ ...base, entryId: task.ref.releaseId, taskReleaseId: task.ref.releaseId, title: task.plan.title, shortTitle: task.plan.title,
          summary: task.plan.assignment, durationLabel: `约${task.plan.durationMinutes}分钟`, order: 10 + courses.length });
      }
    }
    return StudentCourseArchiveV3Schema.parse({ schemaVersion: "student-course-archive/3.0.0", courses });
  });
}

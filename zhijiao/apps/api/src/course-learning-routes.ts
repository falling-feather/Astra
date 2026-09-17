import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CourseReviewFinalizeRequestSchema,
  CourseSubmissionRequestSchema,
  V2IdentifierSchema,
  type CourseRelease,
} from "@ronggang/contracts";
import {
  CourseLearningService,
  type CourseLaunchDefinition,
  type CourseLearningBinding,
  type CourseLearningSubject,
} from "./course-learning.js";

const emptyQuerySchema = z.object({}).strict();
const courseParamsSchema = z.object({
  courseId: V2IdentifierSchema,
}).strict();
const enrollmentBodySchema = z.object({
  courseReleaseId: V2IdentifierSchema,
}).strict();
const learningActivityParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const learningActivityQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();
const courseReviewQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
  reviewTaskId: V2IdentifierSchema.optional(),
}).strict();

export interface AuthorizedCoursePrincipal {
  subject: CourseLearningSubject;
  bindings: CourseLearningBinding[];
}

export interface AuthorizedLearningBinding {
  subject: CourseLearningSubject;
  binding: CourseLearningBinding;
}

export interface ProvisionedReporterBinding {
  bindingId: string;
  activeSessionId: string;
}

export interface CourseLearningRouteDependencies {
  service: CourseLearningService;
  authorizePrincipal(input: {
    request: FastifyRequest;
    mutation: boolean;
  }): AuthorizedCoursePrincipal | Promise<AuthorizedCoursePrincipal>;
  authorizeLearning(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
    purpose?:'review';
  }): AuthorizedLearningBinding | Promise<AuthorizedLearningBinding>;
  provisionReporterBinding(input: {
    request: FastifyRequest;
    principal: AuthorizedCoursePrincipal;
    release: CourseRelease;
    launch: CourseLaunchDefinition;
  }): ProvisionedReporterBinding | Promise<ProvisionedReporterBinding>;
}

/**
 * Registers the V2 learner-facing course surface.
 *
 * Technical traces and client-supplied actor claims are intentionally absent.
 * Query/body schemas are parsed before authorization so forged additions fail
 * without touching principal, projection, event, or agent readers.
 */
export async function registerCourseLearningRoutes(
  app: FastifyInstance,
  dependencies: CourseLearningRouteDependencies,
): Promise<void> {
  app.get("/api/courses", async (request) => {
    emptyQuerySchema.parse(request.query);
    return { courses: dependencies.service.listCourses() };
  });

  app.get<{ Params: { courseId: string } }>(
    "/api/courses/:courseId",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = courseParamsSchema.parse(request.params);
      return { course: dependencies.service.getCourseDetail(params.courseId) };
    },
  );

  app.get("/api/me/course-enrollments", async (request) => {
    emptyQuerySchema.parse(request.query);
    const principal = await dependencies.authorizePrincipal({
      request,
      mutation: false,
    });
    return {
      enrollments: await dependencies.service.listEnrollments(principal),
    };
  });

  app.get("/api/me/course-progress", async (request) => {
    emptyQuerySchema.parse(request.query);
    const principal = await dependencies.authorizePrincipal({
      request,
      mutation: false,
    });
    return {
      progress: await dependencies.service.listProgress(principal),
    };
  });

  app.get("/api/me/portfolio", async (request) => {
    emptyQuerySchema.parse(request.query);
    const principal = await dependencies.authorizePrincipal({
      request,
      mutation: false,
    });
    return {
      portfolio: await dependencies.service.getPortfolio(principal),
    };
  });

  app.post("/api/course-enrollments", async (request) => {
    emptyQuerySchema.parse(request.query);
    const body = enrollmentBodySchema.parse(request.body);
    const principal = await dependencies.authorizePrincipal({
      request,
      mutation: true,
    });
    const release = dependencies.service.getReleaseById(
      body.courseReleaseId,
    );
    const existing = (
      await dependencies.service.listEnrollments(principal)
    ).find((enrollment) => (
      enrollment.courseReleaseRef.courseId === release.courseId
    ));
    if (existing && existing.status !== "claimed" && (existing.bindingId!==null || existing.status==='completed')) return { enrollment: existing };
    const launch = dependencies.service.getLaunch(release.releaseId);
    const provisioned = launch && (!existing || existing.status === "claimed" || existing.bindingId===null)
      ? await dependencies.provisionReporterBinding({
          request,
          principal,
          release,
          launch,
        })
      : null;
    return {
      enrollment: await dependencies.service.claim({
        subject: principal.subject,
        courseReleaseId: release.releaseId,
        bindingId: provisioned?.bindingId ?? null,
        activeSessionId: provisioned?.activeSessionId ?? null,
      }),
    };
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/learning-activity",
    async (request) => {
      const params = learningActivityParamsSchema.parse(request.params);
      const query = learningActivityQuerySchema.parse(request.query);
      const authorized = await dependencies.authorizeLearning({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      return {
        activity: await dependencies.service.getLearningActivity({
          subject: authorized.subject,
          binding: authorized.binding,
          sessionId: params.sessionId,
        }),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/course-review-tasks",
    async (request) => {
      const params = learningActivityParamsSchema.parse(request.params);
      const query = learningActivityQuerySchema.parse(request.query);
      const authorized = await dependencies.authorizeLearning({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      return {
        tasks: await dependencies.service.listReviewTasks({
          subject: authorized.subject,
          binding: authorized.binding,
          sessionId: params.sessionId,
        }),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/course-review",
    async (request) => {
      const params = learningActivityParamsSchema.parse(request.params);
      const query = courseReviewQuerySchema.parse(request.query);
      const authorized = await dependencies.authorizeLearning({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      return {
        review: await dependencies.service.getReviewWorkspace({
          subject: authorized.subject,
          binding: authorized.binding,
          sessionId: params.sessionId,
          ...(query.reviewTaskId ? { reviewTaskId: query.reviewTaskId } : {}),
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/course-submissions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = learningActivityParamsSchema.parse(request.params);
      const body = CourseSubmissionRequestSchema.parse(request.body);
      const authorized = await dependencies.authorizeLearning({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
        purpose:'review',
      });
      return {
        receipt: await dependencies.service.submitForReview({
          subject: authorized.subject,
          binding: authorized.binding,
          sessionId: params.sessionId,
          expectedEnrollmentStateVersion:
            body.expectedEnrollmentStateVersion,
          requestId: body.requestId,
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/course-reviews",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = learningActivityParamsSchema.parse(request.params);
      const body = CourseReviewFinalizeRequestSchema.parse(request.body);
      const authorized = await dependencies.authorizeLearning({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      return {
        receipt: await dependencies.service.finalizeReview({
          subject: authorized.subject,
          binding: authorized.binding,
          sessionId: params.sessionId,
          reviewTaskId: body.reviewTaskId,
          expectedEnrollmentStateVersion:
            body.expectedEnrollmentStateVersion,
          requestId: body.requestId,
        }),
      };
    },
  );
}

import { describe, expect, it } from "vitest";
import { migrateLegacyLocation, parseV2Route } from "../src/v2/router";

describe("V2 path router", () => {
  it('opens the role archive login at the public root and login route',()=>{
    expect(parseV2Route('/')).toEqual({kind:'login'});
    expect(parseV2Route('/login')).toEqual({kind:'login'});
  });
  it("parses the student journeys, course detail, and authorized materials entry", () => {
    expect(parseV2Route("/student/courses")).toEqual({ kind: "student-courses" });
    expect(parseV2Route("/student/courses/course-ai-tourism-copyright-governance"))
      .toEqual({
        kind: "student-course-detail",
        courseId: "course-ai-tourism-copyright-governance",
      });
    expect(parseV2Route("/student/training/session-a")).toEqual({ kind: "student-training", sessionId: "session-a" });
    expect(parseV2Route("/student/materials")).toEqual({ kind: "student-materials" });
    expect(parseV2Route("/student/portfolio")).toEqual({ kind: "student-portfolio" });
    expect(parseV2Route("/student/reviews/session-a")).toEqual({ kind: "student-review", sessionId: "session-a" });
  });

  it("parses teacher/admin routes including the materials workbench", () => {
    expect(parseV2Route("/teacher/classes")).toEqual({ kind: "teacher", page: "classes", sessionId: null });
    expect(parseV2Route("/teacher/director/session-a")).toEqual({ kind: "teacher", page: "director", sessionId: "session-a" });
    expect(parseV2Route("/teacher/reviews/session-a")).toEqual({ kind: "teacher", page: "reviews", sessionId: "session-a" });
    expect(parseV2Route("/teacher/courses")).toEqual({ kind: "teacher", page: "courses", sessionId: null });
    expect(parseV2Route("/teacher/materials")).toEqual({ kind: "teacher", page: "materials", sessionId: null });
    for (const page of ["overview", "agents", "events", "trace", "evidence", "readiness", "materials"]) {
      expect(parseV2Route(`/admin/${page}`)).toEqual({ kind: "admin", page });
    }
  });

  it("maps a legacy query location to exactly one V2 path", () => {
    expect(migrateLegacyLocation({ pathname: "/", search: "?view=student&section=production&mode=course_platform&sessionId=session-a" } as Location)).toBe("/student/training/session-a");
    expect(migrateLegacyLocation({ pathname: "/", search: "?view=teacher&section=scenarios" } as Location)).toBe("/teacher/courses");
    expect(migrateLegacyLocation({ pathname: "/student/courses", search: "?view=admin" } as Location)).toBeNull();
  });

  it("preserves only the role context needed by the migrated V2 route", () => {
    expect(migrateLegacyLocation({
      pathname: "/",
      search: "?view=student&section=production&mode=course_platform&sessionId=session-a&profileId=student-demo-a",
    } as Location)).toBe("/student/training/session-a?profileId=student-demo-a");
    expect(migrateLegacyLocation({
      pathname: "/",
      search: "?view=admin&section=debug&sessionId=session-a&profileId=operator-demo",
    } as Location)).toBe("/admin/trace?profileId=operator-demo&sessionId=session-a");
  });
});

export type TeacherRouteName = "classes" | "director" | "reviews" | "courses" | "materials";
export type AdminRouteName = "overview" | "agents" | "events" | "trace" | "evidence" | "readiness" | "materials";

export type V2Route =
  | { kind: "login" }
  | { kind: "student-courses" }
  | { kind: "student-course-detail"; courseId: string }
  | { kind: "student-training"; sessionId: string }
  | { kind: "student-materials" }
  | { kind: "student-portfolio" }
  | { kind: "student-review"; sessionId: string }
  | { kind: "teacher"; page: TeacherRouteName; sessionId: string | null }
  | { kind: "admin"; page: AdminRouteName }
  | { kind: "not-found" };

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseV2Route(pathname: string): V2Route {
  const parts = pathname.split("/").filter(Boolean).map(decoded);
  if (parts.length === 0 || (parts[0] === 'login' && parts.length === 1)) return { kind: "login" };
  if (parts[0] === "student" && parts[1] === "courses" && parts.length === 2) {
    return { kind: "student-courses" };
  }
  if (parts[0] === "student" && parts[1] === "courses" && parts[2] && parts.length === 3) {
    return { kind: "student-course-detail", courseId: parts[2] };
  }
  if (parts[0] === "student" && parts[1] === "portfolio" && parts.length === 2) {
    return { kind: "student-portfolio" };
  }
  if (parts[0] === "student" && parts[1] === "training" && parts[2] && parts.length === 3) {
    return { kind: "student-training", sessionId: parts[2] };
  }
  if (parts[0] === "student" && parts[1] === "materials" && parts.length === 2) {
    return { kind: "student-materials" };
  }
  if (parts[0] === "student" && parts[1] === "reviews" && parts[2] && parts.length === 3) {
    return { kind: "student-review", sessionId: parts[2] };
  }
  if (parts[0] === "teacher" && parts[1] === "classes" && parts.length === 2) {
    return { kind: "teacher", page: "classes", sessionId: null };
  }
  if (parts[0] === "teacher" && parts[1] === "courses" && parts.length === 2) {
    return { kind: "teacher", page: "courses", sessionId: null };
  }
  if (parts[0] === "teacher" && parts[1] === "materials" && parts.length === 2) {
    return { kind: "teacher", page: "materials", sessionId: null };
  }
  if (parts[0] === "teacher" && parts[1] === "director" && parts[2] && parts.length === 3) {
    return { kind: "teacher", page: "director", sessionId: parts[2] };
  }
  if (parts[0] === "teacher" && parts[1] === "reviews" && parts[2] && parts.length === 3) {
    return { kind: "teacher", page: "reviews", sessionId: parts[2] };
  }
  const adminPages = new Set<AdminRouteName>([
    "overview", "agents", "events", "trace", "evidence", "readiness", "materials",
  ]);
  if (parts[0] === "admin" && parts[1] && parts.length === 2 && adminPages.has(parts[1] as AdminRouteName)) {
    return { kind: "admin", page: parts[1] as AdminRouteName };
  }
  return { kind: "not-found" };
}

export function migrateLegacyLocation(location: Pick<Location, "pathname" | "search">): string | null {
  if (location.pathname !== "/" || location.search.length === 0) return null;
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  const section = params.get("section");
  const sessionId = params.get("sessionId")?.trim() || null;
  const profileId = params.get("profileId")?.trim() || null;
  if (!view && !section) return null;

  const preserveProfile = (path: string): string => {
    const target = new URL(path, "http://v2.local");
    if (profileId) target.searchParams.set("profileId", profileId);
    if (view === "admin" && sessionId) {
      target.searchParams.set("sessionId", sessionId);
    }
    return `${target.pathname}${target.search}`;
  };

  if (view === "student") {
    if (section === "feedback" && sessionId) return preserveProfile(`/student/reviews/${encodeURIComponent(sessionId)}`);
    if (["communications", "sources", "production", "governance", "publication"].includes(section ?? "") && sessionId) {
      return preserveProfile(`/student/training/${encodeURIComponent(sessionId)}`);
    }
    return preserveProfile("/student/courses");
  }
  if (view === "teacher") {
    if (section === "scenarios") return preserveProfile("/teacher/courses");
    if ((section === "review" || section === "evidence") && sessionId) {
      return preserveProfile(`/teacher/reviews/${encodeURIComponent(sessionId)}`);
    }
    return preserveProfile(sessionId
      ? `/teacher/director/${encodeURIComponent(sessionId)}`
      : "/teacher/classes");
  }
  if (view === "admin") {
    const map: Record<string, AdminRouteName> = {
      overview: "overview",
      events: "events",
      debug: "trace",
      evidence: "evidence",
      readiness: "readiness",
    };
    return preserveProfile(`/admin/${map[section ?? ""] ?? "overview"}`);
  }
  return preserveProfile("/student/courses");
}

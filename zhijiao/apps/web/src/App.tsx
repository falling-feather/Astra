import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createHttpExperienceGateway,
  restoreAuthenticatedAuth,
  logoutDemoAccount,
  GatewayHttpError,
  ExperienceGatewayProvider,
} from "./v2/gateway";
import type { DemoAuthContext } from "./v2/models";
import { V2RoleShell } from "./v2/role-shell";
import {
  migrateLegacyLocation,
  parseV2Route,
  type V2Route,
} from "./v2/router";
import { createHttpTeacherGateway } from "./v2/teacher-gateway";
import { createHttpTeachingTaskGateway } from "./v2/teaching-task-gateway";
import {
  createHttpContentLibraryGateway,
  type ContentLibraryGateway,
} from "./v2/content-library-gateway";

const StudentCoursesPage = lazy(() => import("./v2/pages/student-course-archive"));
const LoginPage = lazy(() => import('./v2/pages/login-page'));
const StudentCourseDetailPage = lazy(() => import("./v2/pages/student-course-detail-page"));
const StudentTrainingPage = lazy(() => import("./v2/pages/student-training-page"));
const ContentLibraryPage = lazy(() => import("./v2/pages/content-library-page"));
const StudentPortfolioPage = lazy(() => import("./v2/pages/student-portfolio-page"));
const StudentReviewPage = lazy(() => import("./v2/pages/student-review-page"));
const TeacherClassesPage = lazy(() => import("./v2/pages/teacher-student-archive"));
const TeacherDirectorPage = lazy(() => import("./v2/pages/teacher-director-page"));
const TeacherReviewsPage = lazy(() => import("./v2/pages/teacher-reviews-page"));
const TeacherCoursesPage = lazy(() => import("./v2/pages/teacher-courses-page"));

export const DefaultV2SessionId = "demo-xunpu-v2";

export interface RouteAuthPlan {
  profileId: string;
  sessionId?: string;
}

/** Administrator-only readers must never be constructed for student/teacher routes. */
export function routeAllowsAdministratorData(route: V2Route): boolean {
  return false;
}

function safeProfileId(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_-]{1,80}$/u.test(value) ? value : null;
}

function safeSessionId(value: string | null): string | null {
  return value && /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,119}$/u.test(value)
    ? value
    : null;
}

function profileForRole(
  requested: string | null,
  role: "student" | "teacher" | "admin",
): string | null {
  const profile = safeProfileId(requested);
  if (requested !== null && profile === null) return null;
  if (role === "student") {
    return profile === null
      ? "student-unassigned"
      : profile.startsWith("student-") ? profile : null;
  }
  if (role === "teacher") {
    return profile === null
      ? "teacher-class-a"
      : profile.startsWith("teacher-") ? profile : null;
  }
  return profile === null ? "operator-demo" : profile === "operator-demo" ? profile : null;
}

export function authPlanForRoute(
  route: V2Route,
  requestedProfileId: string | null,
  requestedSessionId: string | null = null,
): RouteAuthPlan | null {
  if (route.kind === "not-found" || route.kind === 'login' || route.kind === 'admin') return null;
  if (route.kind.startsWith("student-")) {
    const profileId = profileForRole(requestedProfileId, "student");
    if (!profileId) return null;
    return {
      profileId,
      ...((route.kind === "student-training" || route.kind === "student-review")
        ? { sessionId: route.sessionId }
        : {}),
    };
  }
  const contextualSessionId = safeSessionId(requestedSessionId)
    ?? DefaultV2SessionId;
  if (route.kind === "teacher") {
    const profileId = profileForRole(requestedProfileId, "teacher");
    if (!profileId) return null;
    return {
      profileId,
      sessionId: route.sessionId ?? contextualSessionId,
    };
  }
  const profileId = profileForRole(requestedProfileId, "admin");
  if (!profileId) return null;
  return {
    profileId,
    sessionId: contextualSessionId,
  };
}

export function reporterBindingIdFor(
  auth: DemoAuthContext,
  sessionId: string,
): string | null {
  return auth.bindings.find((binding) => (
    binding.sessionId === sessionId
    && binding.actorKind === "student"
    && binding.roleId === "reporter"
  ))?.bindingId ?? null;
}

export function teacherBindingIdFor(
  auth: DemoAuthContext,
  sessionId: string,
): string | null {
  return auth.bindings.find((binding) => (
    binding.sessionId === sessionId
    && binding.actorKind === "teacher"
    && binding.roleId === "teacher"
  ))?.bindingId ?? null;
}

export function administratorBindingIdFor(
  auth: DemoAuthContext,
  sessionId: string,
): string | null {
  return teacherBindingIdFor(auth, sessionId)
    ?? auth.bindings.find((binding) => binding.sessionId === sessionId)?.bindingId
    ?? null;
}

export function authMatchesRoute(
  auth: DemoAuthContext,
  route: V2Route,
): boolean {
  if (route.kind.startsWith("student-")) return auth.profileId.startsWith("student-");
  if (route.kind === "teacher") return auth.profileId.startsWith("teacher-");
  if (route.kind === "admin") return auth.profileId === "operator-demo";
  return false;
}

function initializeRoute(): V2Route {
  const target = migrateLegacyLocation(window.location);
  if (target) window.history.replaceState(null, "", target);
  return parseV2Route(window.location.pathname);
}

function locationParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function roleOfPath(pathname: string): "student" | "teacher" | "admin" | null {
  if (pathname.startsWith("/student/")) return "student";
  if (pathname.startsWith("/teacher/")) return "teacher";
  if (pathname.startsWith("/admin/")) return "admin";
  return null;
}

function roleOfProfile(profileId: string | null): "student" | "teacher" | "admin" | null {
  if (profileId?.startsWith("student-")) return "student";
  if (profileId?.startsWith("teacher-")) return "teacher";
  if (profileId === "operator-demo") return "admin";
  return null;
}

export function pathWithRoleContext(
  path: string,
  currentSearch: string,
  origin = "http://v2.local",
): string {
  const target = new URL(path, origin);
  const current = new URLSearchParams(currentSearch);
  const targetRole = roleOfPath(target.pathname);
  const targetRoute = parseV2Route(target.pathname);
  const currentProfile = safeProfileId(current.get("profileId"));
  if (
    targetRole
    && !target.searchParams.has("profileId")
    && roleOfProfile(currentProfile) === targetRole
    && currentProfile
  ) {
    target.searchParams.set("profileId", currentProfile);
  }
  if (
    (targetRole === "teacher" || targetRole === "admin")
    && !target.searchParams.has("sessionId")
  ) {
    const sessionId = targetRoute.kind === "teacher" && targetRoute.sessionId
      ? targetRoute.sessionId
      : safeSessionId(current.get("sessionId"));
    if (sessionId) target.searchParams.set("sessionId", sessionId);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

function RouteLoading({ label = "正在进入工作区" }: { label?: string }) {
  return (
    <main className="v2-route-loading" aria-live="polite">
      <span className="v2-spinner" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}

function RouteFailure({
  title = "暂时无法建立演示身份",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?(): void;
}) {
  return (
    <main className="v2-route-loading" role="alert">
      <h1>{title}</h1>
      <p>{message}</p>
      {onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="v2-route-loading">
      <h1>页面不存在</h1>
      <p>该地址不会发起课程、训练或管理数据请求。</p>
    </main>
  );
}

type AuthLoad =
  | { state: "loading" }
  | { state: "login"; planKey:string }
  | { state: "error"; message: string; planKey: string }
  | { state: "ready"; auth: DemoAuthContext; planKey: string };

export default function App() {
  const [route, setRoute] = useState<V2Route>(initializeRoute);
  const [authRevision, setAuthRevision] = useState(0);
  const [authLoad, setAuthLoad] = useState<AuthLoad>({ state: "loading" });
  const requestedProfileId = locationParam("profileId");
  const requestedSessionId = locationParam("sessionId");
  const authPlan = authPlanForRoute(route, requestedProfileId, requestedSessionId);
  const authPlanKey = authPlan ? JSON.stringify(authPlan) : "";

  const navigate = useCallback((path: string, replace = false) => {
    if(!window.dispatchEvent(new Event("ganglian-before-navigate",{cancelable:true})))return;
    const target = pathWithRoleContext(
      path,
      window.location.search,
      window.location.origin,
    );
    if (replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
    setRoute(parseV2Route(window.location.pathname));
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    const restore = () => setRoute(parseV2Route(window.location.pathname));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!authPlan) return;
    const controller = new AbortController();
    setAuthLoad({ state: "loading" });
    restoreAuthenticatedAuth({...('sessionId' in authPlan?{sessionId:authPlan.sessionId}:{}),...(requestedProfileId?{profileId:requestedProfileId}:{}),role:route.kind==='teacher'?'teacher':'student',signal:controller.signal})
      .then((auth) => {
        if (!controller.signal.aborted) {
          if(!authMatchesRoute(auth,route)||(requestedProfileId!==null&&requestedProfileId!==auth.profileId))setAuthLoad({state:'login',planKey:authPlanKey});
          else setAuthLoad({ state: "ready", auth, planKey: authPlanKey });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if(cause instanceof GatewayHttpError&&cause.status===401){setAuthLoad({state:'login',planKey:authPlanKey});return;}
          setAuthLoad({
            state: "error",
            planKey: authPlanKey,
            message: cause instanceof Error ? cause.message : "身份服务不可用",
          });
        }
      });
    return () => controller.abort();
  }, [authPlanKey, authRevision]);

  const experienceGateway = useMemo(() => (
    authLoad.state === "ready" && route.kind.startsWith("student-")
      ? createHttpExperienceGateway(authLoad.auth)
      : null
  ), [authLoad]);
  const teacherGateway = useMemo(() => (
    authLoad.state === "ready" && route.kind === "teacher"
      ? createHttpTeacherGateway(authLoad.auth)
      : null
  ), [authLoad, route.kind]);
  const contentLibraryGateway: ContentLibraryGateway | null = useMemo(() => (
    authLoad.state === "ready"
      ? createHttpContentLibraryGateway(authLoad.auth)
      : null
  ), [authLoad]);
  const teachingTaskGateway = useMemo(() => authLoad.state === "ready" ? createHttpTeachingTaskGateway(authLoad.auth) : null, [authLoad]);

  const enterLogin=(auth:DemoAuthContext)=>{
    const teacher=auth.profileId.startsWith('teacher-');
    navigate(`${teacher?'/teacher/classes':'/student/courses'}?profileId=${encodeURIComponent(auth.profileId)}${teacher?'&sessionId='+DefaultV2SessionId:''}`,true);
    setAuthRevision(value=>value+1);
  };
  if(route.kind==='admin')return <main className="v2-route-loading"><h1>管理页面已禁用</h1><p>本作品提供学生与教师体验。</p><button type="button" onClick={()=>navigate('/login',true)}>返回登录</button></main>;
  if(route.kind==='login'||authLoad.state==='login')return <Suspense fallback={<RouteLoading label="正在打开登录档案"/>}><LoginPage onLogin={enterLogin}/></Suspense>;

  if (!authPlan) {
    return route.kind === "not-found"
      ? <NotFoundPage />
      : (
        <RouteFailure
          title="身份与页面不匹配"
          message="URL 指定的演示身份不属于目标角色，已停止认证和业务数据读取。"
        />
      );
  }
  if (authLoad.state !== "loading" && authLoad.planKey !== authPlanKey) return <RouteLoading label="正在进入课程" />;
  if (authLoad.state === "error") {
    return (
      <RouteFailure
        message={authLoad.message}
        onRetry={() => setAuthRevision((value) => value + 1)}
      />
    );
  }
  if (authLoad.state === "loading") {
    return <RouteLoading label="正在确认演示身份" />;
  }
  if (!authMatchesRoute(authLoad.auth, route)) {
    return (
      <RouteFailure
        title="身份与页面不匹配"
        message="已停止读取该角色的业务数据，请从管理员角色入口切换到独立师生身份。"
      />
    );
  }

  const contextSessionId = authPlan.sessionId;
  const logout=async()=>{
    try{await logoutDemoAccount(authLoad.auth.csrfToken);}
    catch(cause){if(!(cause instanceof GatewayHttpError&&cause.status===401)){setAuthLoad({state:'error',planKey:authPlanKey,message:cause instanceof Error?cause.message:'暂时无法退出登录'});return;}}
    setAuthLoad({state:'loading'});navigate('/login');
  };
  let content: ReactNode;
  switch (route.kind) {
    case "student-courses":
      content = <StudentCoursesPage navigate={navigate} />;
      break;
    case "student-course-detail":
      content = (
        <StudentCourseDetailPage
          courseId={route.courseId}
          navigate={navigate}
        />
      );
      break;
    case "student-training": {
      const bindingId = reporterBindingIdFor(authLoad.auth, route.sessionId);
      content = bindingId
        ? (
          <StudentTrainingPage
            sessionId={route.sessionId}
            reporterBindingId={bindingId}
            navigate={navigate}
          />
        )
        : (
          <RouteFailure
            title="当前身份没有记者岗位"
            message="已停止读取课程活动、训练现场与智能体建议。"
          />
        );
      break;
    }
    case "student-materials":
      content = contentLibraryGateway
        ? <ContentLibraryPage gateway={contentLibraryGateway} mode="student" />
        : <RouteFailure title="教学资料不可用" message="缺少内容服务网关，已停止读取课程资料。" />;
      break;
    case "student-portfolio":
      content = <StudentPortfolioPage navigate={navigate} />;
      break;
    case "student-review":
      {
        const bindingId = reporterBindingIdFor(authLoad.auth, route.sessionId);
        content = bindingId
          ? (
            <StudentReviewPage
              sessionId={route.sessionId}
              bindingId={bindingId}
              navigate={navigate}
            />
          )
          : (
            <RouteFailure
              title="当前身份没有该课程岗位"
              message="已停止读取课程复核、作品与评价结果。"
            />
          );
      }
      break;
    case "teacher": {
      if (route.page === "materials") {
        content = contentLibraryGateway
          ? <ContentLibraryPage gateway={contentLibraryGateway} mode="staff" />
          : <RouteFailure title="教学资料不可用" message="缺少内容服务网关，已停止读取教学资料。" />;
        break;
      }
      if (!teacherGateway || !contextSessionId) {
        content = <RouteFailure title="教师工作区不可用" message="缺少教师网关或训练会话上下文。" />;
        break;
      }
      const bindingId = teacherBindingIdFor(authLoad.auth, contextSessionId);
      if (!bindingId) {
        content = <RouteFailure title="当前身份没有教师岗位" message="已停止读取班级、协作 Episode 与教师门。" />;
        break;
      }
      if (route.page === "classes") {
        content = (
          <TeacherClassesPage
            gateway={teacherGateway}
            bindingId={bindingId}
            authorizationSessionId={contextSessionId}
            navigate={navigate}
          />
        );
      } else if (route.page === "courses") {
        content = <TeacherCoursesPage gateway={teacherGateway} taskGateway={teachingTaskGateway!} context={{ bindingId, authorizationSessionId: contextSessionId }} navigate={navigate} />;
      } else if (route.page === "reviews" && route.sessionId) {
        content = (
          <TeacherReviewsPage
            gateway={teacherGateway}
            sessionId={route.sessionId}
            bindingId={bindingId}
            navigate={navigate}
          />
        );
      } else if (route.page === "director" && route.sessionId) {
        content = (
          <TeacherDirectorPage
            gateway={teacherGateway}
            sessionId={route.sessionId}
            bindingId={bindingId}
            navigate={navigate}
          />
        );
      } else {
        content = <RouteFailure title="教师页面地址无效" message="请返回课程与班级页面。" />;
      }
      break;
    }
    case "not-found":
      content = <NotFoundPage />;
      break;
  }

  const shell = (
    <V2RoleShell
      route={route}
      {...(contextSessionId ? { contextSessionId } : {})}
      navigate={navigate}
      onLogout={()=>void logout()}
    >
      <Suspense fallback={<RouteLoading />}>{content}</Suspense>
    </V2RoleShell>
  );
  return experienceGateway
    ? <ExperienceGatewayProvider gateway={experienceGateway}>{shell}</ExperienceGatewayProvider>
    : shell;
}

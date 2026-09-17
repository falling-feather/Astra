import { TeacherClassroomsV3Schema, CharacterStudioWorkspaceV3Schema, type CharacterStudioWorkspaceV3, type CharacterStudioDraftV3, type CharacterBlueprintV3 } from "@ronggang/contracts";
import {
  TeachingTaskDraftV1Schema, TeachingTaskGenerationResultV1Schema, TeachingTaskReleaseV1Schema, TeachingTaskSessionV1Schema, TeachingTaskWorkspaceV1Schema,
  type TeachingTaskDraftV1, type TeachingTaskGenerationResultV1, type TeachingTaskInputV1, type TeachingTaskPlanV1, type TeachingTaskReleaseV1, type TeachingTaskSessionV1, type TeachingTaskWorkspaceV1,
} from "@ronggang/contracts";
import { GatewayHttpError, type GatewayRuntimeOptions } from "./gateway";
import type { DemoAuthContext } from "./models";

export type TeachingAuthorContext = { bindingId: string; authorizationSessionId: string; classroomId?: string };
export type TeachingTaskEdit = Pick<TeachingTaskPlanV1, "title" | "assignment" | "audience" | "objectives" | "durationMinutes" | "scaffoldingLevel" | "challengeLevel"> & { steps: Array<{ taskRef: string; instruction: string }> };
export interface TeachingTaskGateway {
  classrooms?(signal?: AbortSignal): Promise<{classrooms:Array<{classroomId:string;name:string}>}>;
  studioWorkspace?(courseId: string, signal?: AbortSignal, classroomId?: string): Promise<CharacterStudioWorkspaceV3>;
  saveStudio?(context: TeachingAuthorContext, draft: CharacterStudioDraftV3, characters: CharacterBlueprintV3[]): Promise<CharacterStudioWorkspaceV3>;
  publishStudio?(context: TeachingAuthorContext, draft: CharacterStudioDraftV3): Promise<CharacterStudioWorkspaceV3>;
  uploadStudioArt?(context: TeachingAuthorContext, courseId: string, input: {name: string; dataUrl: string; rightsStatement: string}): Promise<string>;
  workspace(signal?: AbortSignal): Promise<TeachingTaskWorkspaceV1>;
  generate(context: TeachingAuthorContext, input: TeachingTaskInputV1): Promise<TeachingTaskGenerationResultV1>;
  revise(context: TeachingAuthorContext, draft: TeachingTaskDraftV1, changes: TeachingTaskEdit): Promise<TeachingTaskDraftV1>;
  publish(context: TeachingAuthorContext, draft: TeachingTaskDraftV1, confirmation: string): Promise<TeachingTaskReleaseV1>;
  start(releaseId: string): Promise<TeachingTaskSessionV1>;
}

export function createHttpTeachingTaskGateway(auth: DemoAuthContext, options: GatewayRuntimeOptions = {}): TeachingTaskGateway {
  const base = (options.apiBase ?? import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/u, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const pendingCommands = new Map<string, string>();
  const request = async (path: string, method = "GET", payload?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`${base}${path}`, { method, credentials: "include", ...(signal ? { signal } : {}),
      headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-CSRF-Token": auth.csrfToken }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new GatewayHttpError(response.status, typeof body.message === "string" ? body.message : "任务操作未完成，请保留输入并重试。", typeof body.code === "string" ? body.code : null);
    return body;
  };
  const command = async <T>(path: string, payload: Record<string, unknown>, parse: (body: Record<string, unknown>) => T): Promise<T> => {
    const key = JSON.stringify({ path, payload });
    const requestId = pendingCommands.get(key) ?? crypto.randomUUID();
    pendingCommands.set(key, requestId);
    const result = parse(await request(path, "POST", { ...payload, requestId }));
    pendingCommands.delete(key);
    return result;
  };
  return {
    classrooms: async signal => TeacherClassroomsV3Schema.parse(await request('/api/v3/teacher/classrooms','GET',undefined,signal)),
    studioWorkspace: async (courseId, signal, classroomId) => CharacterStudioWorkspaceV3Schema.parse(await request('/api/v3/character-studio?'+new URLSearchParams({courseId,...(classroomId?{classroomId}:{})}), 'GET', undefined, signal)),
    saveStudio: (context, draft, characters) => command('/api/v3/character-studio/'+encodeURIComponent(draft.courseId)+'/draft', { ...context, classroomId:draft.classroomId, expectedRevision: draft.revision, characters }, body => CharacterStudioWorkspaceV3Schema.parse(body)),
    publishStudio: (context, draft) => command('/api/v3/character-studio/'+encodeURIComponent(draft.courseId)+'/publish', { ...context, classroomId:draft.classroomId, expectedRevision: draft.revision, contentHash: draft.contentHash }, body => CharacterStudioWorkspaceV3Schema.parse(body)),
    uploadStudioArt: async (context, courseId, input) => { const result = await request('/api/v3/character-studio/'+encodeURIComponent(courseId)+'/art','POST', { ...context, ...input }); if (typeof result.image !== 'string') throw new Error('人物图片返回格式无效'); return result.image; },
    workspace: async signal => TeachingTaskWorkspaceV1Schema.parse(await request("/api/teaching-tasks", "GET", undefined, signal)),
    generate: (context, input) => command("/api/teaching-tasks/generate", { ...context, input }, body => TeachingTaskGenerationResultV1Schema.parse(body)),
    revise: (context, draft, changes) => command(`/api/teaching-tasks/${draft.taskId}/revisions`, { ...context, expectedRevision: draft.revision, changes }, body => TeachingTaskDraftV1Schema.parse(body.draft)),
    publish: (context, draft, confirmation) => command(`/api/teaching-tasks/${draft.taskId}/publish`, { ...context, expectedRevision: draft.revision, contentHash: draft.contentHash, confirmation }, body => TeachingTaskReleaseV1Schema.parse(body.release)),
    start: async releaseId => TeachingTaskSessionV1Schema.parse((await request(`/api/teaching-tasks/releases/${releaseId}/my-session`, "PUT", {})).session),
  };
}

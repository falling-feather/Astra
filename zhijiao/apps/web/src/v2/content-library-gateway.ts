import type { CourseReleaseSummary, DemoAuthContext } from "./models";
import {
  GatewayHttpError,
  type FetchLike,
  type GatewayRuntimeOptions,
} from "./gateway";
import { parseCoursesResponse, WireFormatError } from "./wire";

export interface ContentSourceDocument {
  sourceId: string;
  courseId: string | null;
  kind: string;
  title: string;
  publisher: string | null;
  canonicalUrl: string | null;
  rightsNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentSourceFragment {
  fragmentId: string;
  revisionId: string;
  ordinal: number;
  text: string;
  locator: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
}

export interface ContentSourceRevision {
  revisionId: string;
  sourceId: string;
  sourceVersion: string;
  sourceByteHash: string | null;
  mimeType: string;
  byteSize: number;
  objectKey: string | null;
  publicationDate: string | null;
  accessedAt: string;
  status: "current" | "historical" | "failed";
  fragments: ContentSourceFragment[];
  createdAt: string;
  fragmentCount: number;
}

export interface ContentProcessingJob {
  jobId: string;
  sourceId: string | null;
  sourceFileName: string | null;
  assetId: string;
  sourceRevisionId: string;
  parsedRevisionId: string | null;
  kind: "parse_text" | "parse_pdf" | "ocr" | "asr";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attemptCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMaterialUploadInput {
  courseId: string;
  sourceKey: string;
  title: string;
  kind: "course_material" | "interview" | "user_upload" | "simulation";
  fileName: string;
  mimeType: string;
  contentBase64: string;
  rightsNote: string;
  publisher?: string;
  canonicalUrl?: string;
  publicationDate?: string;
  allowModelContext: boolean;
}

export interface ContentMaterialResult {
  sourceId: string;
  status: "completed" | "already_completed" | "failed" | "cancelled";
  assetId: string;
  sourceByteHash: string;
  rawRevisionId: string;
  parsedRevisionId: string | null;
  indexing: {
    status: "ready" | "failed" | "not_processed";
    indexed: number;
    message?: string;
  };
  job: Pick<ContentProcessingJob, "jobId" | "status" | "attemptCount" | "errorCode">;
  capabilityGaps: Array<{ code: string; message: string }>;
}

export interface ContentCitation {
  citationId: string;
  sourceId: string;
  sourceRevisionId: string;
  fragmentId: string;
  title: string;
  publisher: string | null;
  canonicalUrl: string | null;
  sourceVersion: string;
  sourceByteHash: string | null;
  locator: Record<string, unknown>;
  text: string;
  knowledgeRevisionIds: string[];
  claimIds: string[];
  reviewStatus: "draft" | "pending_expert_review" | "verified" | "retired" | null;
  score: number;
}

export interface ContentSearchResult {
  query: string;
  retrieverVersion: string;
  corpusVersion: string;
  citations: ContentCitation[];
  gaps: string[];
  conflicts: Array<{ claimId: string; supporting: string[]; refuting: string[] }>;
}

export interface ContentCaseSourceRef {
  title: string;
  url: string;
  locator: string;
  publisher: string;
  sourceVersion: string;
}

export interface ContentCaseDossier {
  releaseId: string;
  contentHash: string;
  reviewStatus: string;
  dossier: {
    dossierId: string;
    caseBoundary: string;
    studentMaterials: Array<{
      materialId: string;
      title: string;
      publicDescription: string;
      document?:{format:string;body:string};
      sourceRefs: ContentCaseSourceRef[];
      inspectableFields: string[];
      simulationBoundary: string;
    }>;
    scenarios: Array<{
      scenarioId: string;
      title: string;
      studentMaterialIds: string[];
      sourceClaimComparisons: Array<{ claim: string; supportedWording: string; unsupportedExpansion: string }>;
      conflicts: Array<{ title: string; description: string; competingValues: string[] }>;
      legalAlternativeRoutes: Array<{ label: string; steps: string[]; tradeoff: string }>;
      workRequirements: string[];
      teacherObservationPoints?: string[];
    }>;
    teacherOnlyNotes?: Array<{ scenarioId: string; teacherOnlyNotes: string[] }>;
  };
}

export interface ProfessionalTaskPackage {
  packageId: string;
  title: string;
  reviewBoundary: string;
  tasks: Array<{
    taskId: string;
    title: string;
    workflowPhase: string;
    knowledgeIds: string[];
    courseSectionRefs: string[];
    artifacts: string[];
    rubricDimensions: string[];
    trainingRules: Array<{ ruleType: string; statement: string }>;
  }>;
}

export interface ContentLibraryGateway {
  getCourses(signal?: AbortSignal): Promise<CourseReleaseSummary[]>;
  listSources(courseId: string, signal?: AbortSignal): Promise<ContentSourceDocument[]>;
  listJobs(signal?: AbortSignal): Promise<ContentProcessingJob[]>;
  getRevision(revisionId: string, signal?: AbortSignal): Promise<ContentSourceRevision>;
  uploadMaterial(input: ContentMaterialUploadInput, signal?: AbortSignal): Promise<ContentMaterialResult>;
  indexCourse(courseId: string, revisionId?: string, signal?: AbortSignal): Promise<{ indexed: number }>;
  resumeJobs(includeFailed: boolean, signal?: AbortSignal): Promise<unknown>;
  search(courseId: string, query: string, limit?: number, signal?: AbortSignal): Promise<ContentSearchResult>;
  getCaseDossier(courseId: string, signal?: AbortSignal): Promise<ContentCaseDossier | null>;
  getProfessionalTasks(courseId: string, signal?: AbortSignal): Promise<ProfessionalTaskPackage | null>;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new WireFormatError(`${label} 必须是字符串`);
  return value;
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WireFormatError(`${label} 必须是数字`);
  }
  return value;
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new WireFormatError(`${label} 必须是数组`);
  return value;
}

function parseSourceDocument(value: unknown, index: number): ContentSourceDocument {
  const item = objectOf(value, `sources[${index}]`);
  return {
    sourceId: stringOf(item.sourceId, `sources[${index}].sourceId`)!,
    courseId: stringOf(item.courseId, `sources[${index}].courseId`, true),
    kind: stringOf(item.kind, `sources[${index}].kind`)!,
    title: stringOf(item.title, `sources[${index}].title`)!,
    publisher: stringOf(item.publisher, `sources[${index}].publisher`, true),
    canonicalUrl: stringOf(item.canonicalUrl, `sources[${index}].canonicalUrl`, true),
    rightsNote: stringOf(item.rightsNote, `sources[${index}].rightsNote`, true),
    createdAt: stringOf(item.createdAt, `sources[${index}].createdAt`)!,
    updatedAt: stringOf(item.updatedAt, `sources[${index}].updatedAt`)!,
  };
}

function parseFragment(value: unknown, index: number): ContentSourceFragment {
  const item = objectOf(value, `revision.fragments[${index}]`);
  return {
    fragmentId: stringOf(item.fragmentId, `revision.fragments[${index}].fragmentId`)!,
    revisionId: stringOf(item.revisionId, `revision.fragments[${index}].revisionId`)!,
    ordinal: numberOf(item.ordinal, `revision.fragments[${index}].ordinal`),
    text: stringOf(item.text, `revision.fragments[${index}].text`)!,
    locator: objectOf(item.locator, `revision.fragments[${index}].locator`),
    contentHash: stringOf(item.contentHash, `revision.fragments[${index}].contentHash`)!,
    createdAt: stringOf(item.createdAt, `revision.fragments[${index}].createdAt`)!,
  };
}

function parseRevision(value: unknown): ContentSourceRevision {
  const item = objectOf(value, "revision");
  const fragments = arrayOf(item.fragments, "revision.fragments").map(parseFragment);
  const status = stringOf(item.status, "revision.status");
  if (status !== "current" && status !== "historical" && status !== "failed") {
    throw new WireFormatError("revision.status 不合法");
  }
  return {
    revisionId: stringOf(item.revisionId, "revision.revisionId")!,
    sourceId: stringOf(item.sourceId, "revision.sourceId")!,
    sourceVersion: stringOf(item.sourceVersion, "revision.sourceVersion")!,
    sourceByteHash: stringOf(item.sourceByteHash, "revision.sourceByteHash", true),
    mimeType: stringOf(item.mimeType, "revision.mimeType")!,
    byteSize: numberOf(item.byteSize, "revision.byteSize"),
    objectKey: stringOf(item.objectKey, "revision.objectKey", true),
    publicationDate: stringOf(item.publicationDate, "revision.publicationDate", true),
    accessedAt: stringOf(item.accessedAt, "revision.accessedAt")!,
    status,
    fragments,
    createdAt: stringOf(item.createdAt, "revision.createdAt")!,
    fragmentCount: numberOf(item.fragmentCount, "revision.fragmentCount"),
  };
}

function parseJob(value: unknown, index: number): ContentProcessingJob {
  const item = objectOf(value, `jobs[${index}]`);
  const kind = stringOf(item.kind, `jobs[${index}].kind`);
  const status = stringOf(item.status, `jobs[${index}].status`);
  if (!["parse_text", "parse_pdf", "ocr", "asr"].includes(kind!)) {
    throw new WireFormatError(`jobs[${index}].kind 不合法`);
  }
  if (!["queued", "running", "succeeded", "failed", "cancelled"].includes(status!)) {
    throw new WireFormatError(`jobs[${index}].status 不合法`);
  }
  return {
    jobId: stringOf(item.jobId, `jobs[${index}].jobId`)!,
    sourceId: stringOf(item.sourceId ?? null, `jobs[${index}].sourceId`, true),
    sourceFileName: stringOf(item.sourceFileName ?? null, `jobs[${index}].sourceFileName`, true),
    assetId: stringOf(item.assetId, `jobs[${index}].assetId`)!,
    sourceRevisionId: stringOf(item.sourceRevisionId, `jobs[${index}].sourceRevisionId`)!,
    parsedRevisionId: stringOf(item.parsedRevisionId, `jobs[${index}].parsedRevisionId`, true),
    kind: kind as ContentProcessingJob["kind"],
    status: status as ContentProcessingJob["status"],
    attemptCount: numberOf(item.attemptCount, `jobs[${index}].attemptCount`),
    errorCode: stringOf(item.errorCode, `jobs[${index}].errorCode`, true),
    createdAt: stringOf(item.createdAt, `jobs[${index}].createdAt`)!,
    updatedAt: stringOf(item.updatedAt, `jobs[${index}].updatedAt`)!,
  };
}

function parseMaterial(value: unknown): ContentMaterialResult {
  const item = objectOf(value, "material");
  const indexing = objectOf(item.indexing, "material.indexing");
  const job = objectOf(item.job, "material.job");
  const status = stringOf(item.status, "material.status");
  const indexingStatus = stringOf(indexing.status, "material.indexing.status");
  if (!["completed", "already_completed", "failed", "cancelled"].includes(status!)) {
    throw new WireFormatError("material.status 不合法");
  }
  if (!["ready", "failed", "not_processed"].includes(indexingStatus!)) {
    throw new WireFormatError("material.indexing.status 不合法");
  }
  return {
    sourceId: stringOf(item.sourceId, "material.sourceId")!,
    status: status as ContentMaterialResult["status"],
    assetId: stringOf(item.assetId, "material.assetId")!,
    sourceByteHash: stringOf(item.sourceByteHash, "material.sourceByteHash")!,
    rawRevisionId: stringOf(item.rawRevisionId, "material.rawRevisionId")!,
    parsedRevisionId: stringOf(item.parsedRevisionId, "material.parsedRevisionId", true),
    indexing: {
      status: indexingStatus as ContentMaterialResult["indexing"]["status"],
      indexed: numberOf(indexing.indexed, "material.indexing.indexed"),
      ...(typeof indexing.message === "string" ? { message: indexing.message } : {}),
    },
    job: {
      jobId: stringOf(job.jobId, "material.job.jobId")!,
      status: parseJob({
        ...job,
        assetId: item.assetId,
        sourceRevisionId: item.rawRevisionId,
        parsedRevisionId: item.parsedRevisionId,
        kind: job.kind ?? "parse_text",
        createdAt: job.createdAt ?? "",
        updatedAt: job.updatedAt ?? "",
      }, 0).status,
      attemptCount: numberOf(job.attemptCount, "material.job.attemptCount"),
      errorCode: stringOf(job.errorCode, "material.job.errorCode", true),
    },
    capabilityGaps: arrayOf(item.capabilityGaps, "material.capabilityGaps").map((gap, index) => {
      const record = objectOf(gap, `material.capabilityGaps[${index}]`);
      return { code: stringOf(record.code, `material.capabilityGaps[${index}].code`)!, message: stringOf(record.message, `material.capabilityGaps[${index}].message`)! };
    }),
  };
}

function parseCitation(value: unknown, index: number): ContentCitation {
  const item = objectOf(value, `result.citations[${index}]`);
  return {
    citationId: stringOf(item.citationId, `result.citations[${index}].citationId`)!,
    sourceId: stringOf(item.sourceId, `result.citations[${index}].sourceId`)!,
    sourceRevisionId: stringOf(item.sourceRevisionId, `result.citations[${index}].sourceRevisionId`)!,
    fragmentId: stringOf(item.fragmentId, `result.citations[${index}].fragmentId`)!,
    title: stringOf(item.title, `result.citations[${index}].title`)!,
    publisher: stringOf(item.publisher, `result.citations[${index}].publisher`, true),
    canonicalUrl: stringOf(item.canonicalUrl, `result.citations[${index}].canonicalUrl`, true),
    sourceVersion: stringOf(item.sourceVersion, `result.citations[${index}].sourceVersion`)!,
    sourceByteHash: stringOf(item.sourceByteHash, `result.citations[${index}].sourceByteHash`, true),
    locator: objectOf(item.locator, `result.citations[${index}].locator`),
    text: stringOf(item.text, `result.citations[${index}].text`)!,
    knowledgeRevisionIds: arrayOf(item.knowledgeRevisionIds, `result.citations[${index}].knowledgeRevisionIds`).map((id, idIndex) => stringOf(id, `result.citations[${index}].knowledgeRevisionIds[${idIndex}]`)!),
    claimIds: arrayOf(item.claimIds, `result.citations[${index}].claimIds`).map((id, idIndex) => stringOf(id, `result.citations[${index}].claimIds[${idIndex}]`)!),
    reviewStatus: stringOf(item.reviewStatus, `result.citations[${index}].reviewStatus`, true) as ContentCitation["reviewStatus"],
    score: numberOf(item.score, `result.citations[${index}].score`),
  };
}

function parseSearchResult(value: unknown): ContentSearchResult {
  const item = objectOf(value, "result");
  return {
    query: stringOf(item.query, "result.query")!,
    retrieverVersion: stringOf(item.retrieverVersion, "result.retrieverVersion")!,
    corpusVersion: stringOf(item.corpusVersion, "result.corpusVersion")!,
    citations: arrayOf(item.citations, "result.citations").map(parseCitation),
    gaps: arrayOf(item.gaps, "result.gaps").map((gap, index) => stringOf(gap, `result.gaps[${index}]`)!),
    conflicts: arrayOf(item.conflicts, "result.conflicts").map((conflict, index) => {
      const entry = objectOf(conflict, `result.conflicts[${index}]`);
      return {
        claimId: stringOf(entry.claimId, `result.conflicts[${index}].claimId`)!,
        supporting: arrayOf(entry.supporting, `result.conflicts[${index}].supporting`).map((item, itemIndex) => stringOf(item, `result.conflicts[${index}].supporting[${itemIndex}]`)!),
        refuting: arrayOf(entry.refuting, `result.conflicts[${index}].refuting`).map((item, itemIndex) => stringOf(item, `result.conflicts[${index}].refuting[${itemIndex}]`)!),
      };
    }),
  };
}

function stringsOf(value: unknown, label: string): string[] {
  return arrayOf(value, label).map((item, index) => stringOf(item, `${label}[${index}]`)!);
}

function parseCaseDossier(value: unknown): ContentCaseDossier | null {
  if (value === null) return null;
  const item = objectOf(value, "case result");
  const dossier = objectOf(item.dossier, "case result.dossier");
  const sourceRefs = (value: unknown, label: string): ContentCaseSourceRef[] => arrayOf(value, label).map((entry, index) => {
    const source = objectOf(entry, `${label}[${index}]`);
    return {
      title: stringOf(source.title, `${label}[${index}].title`)!,
      url: stringOf(source.url, `${label}[${index}].url`)!,
      locator: stringOf(source.locator, `${label}[${index}].locator`)!,
      publisher: stringOf(source.publisher, `${label}[${index}].publisher`)!,
      sourceVersion: stringOf(source.sourceVersion, `${label}[${index}].sourceVersion`)!,
    };
  });
  return {
    releaseId: stringOf(item.releaseId, "case result.releaseId")!,
    contentHash: stringOf(item.contentHash, "case result.contentHash")!,
    reviewStatus: stringOf(item.reviewStatus, "case result.reviewStatus")!,
    dossier: {
      dossierId: stringOf(dossier.dossierId, "case result.dossier.dossierId")!,
      caseBoundary: stringOf(dossier.caseBoundary, "case result.dossier.caseBoundary")!,
      studentMaterials: arrayOf(dossier.studentMaterials, "case result.dossier.studentMaterials").map((entry, index) => {
        const material = objectOf(entry, `case result.dossier.studentMaterials[${index}]`);
        return {
          materialId: stringOf(material.materialId, `studentMaterials[${index}].materialId`)!,
          title: stringOf(material.title, `studentMaterials[${index}].title`)!,
          publicDescription: stringOf(material.publicDescription, `studentMaterials[${index}].publicDescription`)!,
          ...(material.document?{document:{format:stringOf(objectOf(material.document,'document').format,'document.format')!,body:stringOf(objectOf(material.document,'document').body,'document.body')!}}:{}),
          sourceRefs: sourceRefs(material.sourceRefs, `studentMaterials[${index}].sourceRefs`),
          inspectableFields: stringsOf(material.inspectableFields, `studentMaterials[${index}].inspectableFields`),
          simulationBoundary: stringOf(material.simulationBoundary, `studentMaterials[${index}].simulationBoundary`)!,
        };
      }),
      scenarios: arrayOf(dossier.scenarios, "case result.dossier.scenarios").map((entry, index) => {
        const scenario = objectOf(entry, `case result.dossier.scenarios[${index}]`);
        return {
          scenarioId: stringOf(scenario.scenarioId, `scenarios[${index}].scenarioId`)!,
          title: stringOf(scenario.title, `scenarios[${index}].title`)!,
          studentMaterialIds: stringsOf(scenario.studentMaterialIds, `scenarios[${index}].studentMaterialIds`),
          sourceClaimComparisons: arrayOf(scenario.sourceClaimComparisons, `scenarios[${index}].sourceClaimComparisons`).map((comparison, comparisonIndex) => {
            const item = objectOf(comparison, `sourceClaimComparisons[${comparisonIndex}]`);
            return {
              claim: stringOf(item.claim, `sourceClaimComparisons[${comparisonIndex}].claim`)!,
              supportedWording: stringOf(item.supportedWording, `sourceClaimComparisons[${comparisonIndex}].supportedWording`)!,
              unsupportedExpansion: stringOf(item.unsupportedExpansion, `sourceClaimComparisons[${comparisonIndex}].unsupportedExpansion`)!,
            };
          }),
          conflicts: arrayOf(scenario.conflicts, `scenarios[${index}].conflicts`).map((conflict, conflictIndex) => {
            const item = objectOf(conflict, `conflicts[${conflictIndex}]`);
            return {
              title: stringOf(item.title, `conflicts[${conflictIndex}].title`)!,
              description: stringOf(item.description, `conflicts[${conflictIndex}].description`)!,
              competingValues: stringsOf(item.competingValues, `conflicts[${conflictIndex}].competingValues`),
            };
          }),
          legalAlternativeRoutes: arrayOf(scenario.legalAlternativeRoutes, `scenarios[${index}].legalAlternativeRoutes`).map((route, routeIndex) => {
            const item = objectOf(route, `legalAlternativeRoutes[${routeIndex}]`);
            return {
              label: stringOf(item.label, `legalAlternativeRoutes[${routeIndex}].label`)!,
              steps: stringsOf(item.steps, `legalAlternativeRoutes[${routeIndex}].steps`),
              tradeoff: stringOf(item.tradeoff, `legalAlternativeRoutes[${routeIndex}].tradeoff`)!,
            };
          }),
          workRequirements: stringsOf(scenario.workRequirements, `scenarios[${index}].workRequirements`),
          ...(Array.isArray(scenario.teacherObservationPoints)
            ? { teacherObservationPoints: stringsOf(scenario.teacherObservationPoints, `scenarios[${index}].teacherObservationPoints`) }
            : {}),
        };
      }),
      ...(Array.isArray(dossier.teacherOnlyNotes)
        ? {
            teacherOnlyNotes: arrayOf(dossier.teacherOnlyNotes, "case result.dossier.teacherOnlyNotes").map((entry, index) => {
              const item = objectOf(entry, `teacherOnlyNotes[${index}]`);
              return {
                scenarioId: stringOf(item.scenarioId, `teacherOnlyNotes[${index}].scenarioId`)!,
                teacherOnlyNotes: stringsOf(item.teacherOnlyNotes, `teacherOnlyNotes[${index}].teacherOnlyNotes`),
              };
            }),
          }
        : {}),
    },
  };
}

function parseProfessionalTasks(value: unknown): ProfessionalTaskPackage | null {
  if (value === null) return null;
  const item = objectOf(value, "professional task package");
  return {
    packageId: stringOf(item.packageId, "package.packageId")!,
    title: stringOf(item.title, "package.title")!,
    reviewBoundary: stringOf(item.reviewBoundary, "package.reviewBoundary")!,
    tasks: arrayOf(item.tasks, "package.tasks").map((entry, index) => {
      const task = objectOf(entry, `package.tasks[${index}]`);
      return {
        taskId: stringOf(task.taskId, `tasks[${index}].taskId`)!,
        title: stringOf(task.title, `tasks[${index}].title`)!,
        workflowPhase: stringOf(task.workflowPhase, `tasks[${index}].workflowPhase`)!,
        knowledgeIds: stringsOf(task.knowledgeIds, `tasks[${index}].knowledgeIds`),
        courseSectionRefs: stringsOf(task.courseSectionRefs, `tasks[${index}].courseSectionRefs`),
        artifacts: stringsOf(task.artifacts, `tasks[${index}].artifacts`),
        rubricDimensions: stringsOf(task.rubricDimensions, `tasks[${index}].rubricDimensions`),
        trainingRules: arrayOf(task.trainingRules, `tasks[${index}].trainingRules`).map((rule, ruleIndex) => {
          const item = objectOf(rule, `trainingRules[${ruleIndex}]`);
          return {
            ruleType: stringOf(item.ruleType, `trainingRules[${ruleIndex}].ruleType`)!,
            statement: stringOf(item.statement, `trainingRules[${ruleIndex}].statement`)!,
          };
        }),
      };
    }),
  };
}

function runtime(options: GatewayRuntimeOptions): {
  apiBase: string;
  fetchImpl: FetchLike;
} {
  return {
    apiBase: (options.apiBase ?? import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/u, ""),
    fetchImpl: options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = body as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
  }
  return `请求失败（${status}）`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function requestUnknown(
  path: string,
  init: RequestInit,
  auth: DemoAuthContext,
  options: GatewayRuntimeOptions,
): Promise<unknown> {
  const requestRuntime = runtime(options);
  const response = await requestRuntime.fetchImpl(`${requestRuntime.apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.method === "POST" ? { "X-CSRF-Token": auth.csrfToken } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new GatewayHttpError(response.status, errorMessage(body, response.status), null);
  return body;
}

export function createHttpContentLibraryGateway(
  auth: DemoAuthContext,
  options: GatewayRuntimeOptions = {},
): ContentLibraryGateway {
  const read = (path: string, signal?: AbortSignal) => requestUnknown(
    path,
    signal ? { signal } : {},
    auth,
    options,
  );
  const post = (path: string, body: unknown, signal?: AbortSignal) => requestUnknown(
    path,
    { method: "POST", ...(signal ? { signal } : {}), body: JSON.stringify(body) },
    auth,
    options,
  );
  return {
    async getCourses(signal) {
      return parseCoursesResponse(await read("/api/courses", signal));
    },
    async listSources(courseId, signal) {
      const query = new URLSearchParams({ courseId });
      const response = objectOf(await read(`/api/content-library/sources?${query.toString()}`, signal), "sources response");
      return arrayOf(response.sources, "sources response.sources").map(parseSourceDocument);
    },
    async listJobs(signal) {
      const response = objectOf(await read("/api/content-library/jobs", signal), "jobs response");
      return arrayOf(response.jobs, "jobs response.jobs").map(parseJob);
    },
    async getRevision(revisionId, signal) {
      const response = objectOf(await read(`/api/content-library/revisions/${encodeURIComponent(revisionId)}`, signal), "revision response");
      return parseRevision(response.revision);
    },
    async uploadMaterial(input, signal) {
      const response = objectOf(await post("/api/content-library/materials", input, signal), "material response");
      return parseMaterial(response.material);
    },
    async indexCourse(courseId, revisionId, signal) {
      const response = objectOf(await post("/api/content-library/index", {
        courseId,
        ...(revisionId ? { revisionId } : {}),
      }, signal), "index response");
      const indexing = objectOf(response.indexing, "index response.indexing");
      return { indexed: numberOf(indexing.indexed, "index response.indexing.indexed") };
    },
    async resumeJobs(includeFailed, signal) {
      const response = objectOf(await post("/api/content-library/jobs/resume", { includeFailed }, signal), "resume response");
      return response.recovery;
    },
    async search(courseId, query, limit, signal) {
      const response = objectOf(await post("/api/content-library/search", {
        courseId,
        query,
        ...(limit === undefined ? {} : { limit }),
      }, signal), "search response");
      return parseSearchResult(response.result);
    },
    async getCaseDossier(courseId, signal) {
      const query = new URLSearchParams({ courseId });
      const response = objectOf(await read(`/api/content-library/case-dossier?${query.toString()}`, signal), "case dossier response");
      return parseCaseDossier(response.result);
    },
    async getProfessionalTasks(courseId, signal) {
      const query = new URLSearchParams({ courseId });
      const response = objectOf(await read(`/api/content-library/professional-tasks?${query.toString()}`, signal), "professional tasks response");
      return parseProfessionalTasks(response.package);
    },
  };
}

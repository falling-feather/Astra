import { hashCanonical, xunpuV4PostPublicationCaseDossier,postpublicationDocumentsV3 } from "@ronggang/course-content";
import type { ContentStore } from "@ronggang/content-store";

export const POSTPUBLICATION_CASE_COURSE = "course-xunpu-intangible-media";
const caseId = "case-xunpu-postpublication-context-v2";
const releaseId = "case-release-xunpu-postpublication-context-v2";

/** The published teaching dossier is immutable; publication does not imply expert review. */
export async function seedCourseCaseLibrary(store: ContentStore): Promise<void> {
  if ((await store.listCaseReleases(POSTPUBLICATION_CASE_COURSE)).some((release) => release.releaseId === releaseId)) return;
  const source=structuredClone(xunpuV4PostPublicationCaseDossier);
  const payload = {...source,studentMaterials:source.studentMaterials.map(material=>({...material,
    title:material.materialKind==='published_video_record'?'首发剪辑记录与时间线（仿真文本）':material.title,
    document:postpublicationDocumentsV3[material.materialId]}))} as unknown as Record<string, unknown>;
  const draft = await store.createCaseDraft({ caseId, courseId: POSTPUBLICATION_CASE_COURSE, caseKey: "postpublication-context", version: 2,
    title: "蟳埔发布后语境与权益回应案例资料包", payload, contentHash: hashCanonical(payload), status: "draft" });
  await store.publishCase({ releaseId, caseId: draft.caseId, courseId: draft.courseId, releaseVersion: "postpublication-context/2.0.0", contentHash: draft.contentHash,
    metadata: { reviewStatus: "pending_expert_review", materialBoundary: "教学仿真，未声称真实人物、后台数据或教师外审" } });
}

export async function readCourseCaseDossier(store: ContentStore, courseId: string, audience: "student" | "teacher" | "operator") {
  if (courseId !== POSTPUBLICATION_CASE_COURSE) return null;
  const release = (await store.listCaseReleases(courseId)).find((item) => item.releaseId === releaseId && item.status === "published");
  if (!release) return null;
  const draft = await store.getCaseDraft(release.caseId);
  if (!draft || draft.contentHash !== release.contentHash || hashCanonical(draft.payload) !== release.contentHash) throw new Error("案例资料版本校验失败");
  // An allowlist keeps future teacher-only fields out of student responses too.
  const payload = audience === "student" ? {
    dossierId: draft.payload.dossierId, sourcePatternRef: draft.payload.sourcePatternRef, caseBoundary: draft.payload.caseBoundary,
    studentMaterials: draft.payload.studentMaterials,
    scenarios: (draft.payload.scenarios as Array<Record<string, unknown>>).map((scenario) => ({
      scenarioId: scenario.scenarioId, title: scenario.title, studentMaterialIds: scenario.studentMaterialIds,
      sourceClaimComparisons: scenario.sourceClaimComparisons, conflicts: scenario.conflicts,
      legalAlternativeRoutes: scenario.legalAlternativeRoutes, workRequirements: scenario.workRequirements,
    })),
  } : draft.payload;
  return { releaseId: release.releaseId, contentHash: release.contentHash, reviewStatus: "pending_expert_review", dossier: payload };
}

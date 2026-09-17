import { afterEach, describe, expect, it } from "vitest";
import { TeachingTaskInputV1Schema, type TeachingTaskDraftV1 } from "@ronggang/contracts";
import { professionalTrainingKnowledgeRecords, xunpuExplorationLesson, type ExplorationLesson } from "@ronggang/course-content";
import { openPGliteContentStore, type ContentStore } from "@ronggang/content-store";
import { TeachingTaskService, type TeachingTaskActor } from "../src/teaching-task-service.js";

const opened: ContentStore[] = [];
afterEach(async () => { for (const store of opened.splice(0)) await store.close(); });
const courseRef = { courseId: "course-xunpu-intangible-media", releaseId: "teaching-base-course", version: 1, contentHash: "a".repeat(64) };
const teacher: TeachingTaskActor = { principalId: "teacher-a", actorId: "teacher-main", role: "teacher", classroomId: "class-a", sourceSessionId: "demo-source-session" };
const learner: TeachingTaskActor = { ...teacher, principalId: "student-a", actorId: "student-reporter", role: "student" };
const input = (brief = "为社区居民和游客报道日常劳动中的具体人物故事", durationMinutes = 55) => TeachingTaskInputV1Schema.parse({
  title: "", brief, audience: "首次来访的游客", learnerContext: "已学过采访基本表达，需要练习证据和公开范围", learnerLevel: "beginner", durationMinutes,
  sourceKind: "teaching_example", sourceStatement: "本轮工程测试的自拟教学委托", templateId: null,
});
async function setup() {
  const store = await openPGliteContentStore();
  opened.push(store);
  await store.importKnowledgeSeed(professionalTrainingKnowledgeRecords.map(item => ({ knowledgeId: item.knowledgeId, courseId: courseRef.courseId,
    title: item.topic, teachingSummary: item.teachingSummary, contentHash: item.contentHash, source: item.source })));
  const lessons: ExplorationLesson[] = [xunpuExplorationLesson];
  const service = new TeachingTaskService({ store: async () => store, courseRef, lessons, registerLesson: async lesson => {
    if (!lessons.some(item => item.contentHash === lesson.contentHash)) lessons.push(lesson);
  } });
  const generate = async (requestId = "generation-one", data = input()): Promise<TeachingTaskDraftV1> => {
    const result = await service.generate(teacher, requestId, data);
    if (result.status !== "draft_created") throw new Error(result.questions.join("; "));
    return result.draft;
  };
  return { store, service, lessons, generate };
}
const publishInput = (draft: TeachingTaskDraftV1, requestId = "publish-one") => ({ taskId: draft.taskId, requestId, expectedRevision: draft.revision,
  contentHash: draft.contentHash, confirmation: "已核对任务、课堂条件与材料边界，确认用于本班仿真练习。" });
const changes = (draft: TeachingTaskDraftV1) => ({ title: `${draft.plan.title}（教师修改）`, assignment: draft.plan.assignment, audience: draft.plan.audience,
  objectives: draft.plan.objectives, durationMinutes: draft.plan.durationMinutes, scaffoldingLevel: draft.plan.scaffoldingLevel, challengeLevel: draft.plan.challengeLevel,
  steps: draft.plan.steps.map(step => ({ taskRef: step.taskRef, instruction: step.instruction })) });

describe("teacher job-to-task publication", () => {
  it("clarifies incomplete work, then creates different grounded tasks and coalesces retries", async () => {
    const { service, generate } = await setup();
    expect(await service.generate(teacher, "incomplete", input("想做一个训练"))).toMatchObject({ status: "needs_clarification" });
    const resident = await generate(), publicService = await generate("generation-two", input("为游客制作公共服务和交通出行的公告核对与连续更新任务", 45));
    expect(resident.templateId).toBe("community-story");
    expect(publicService.templateId).toBe("public-service");
    expect(resident.plan.sourcePlan).not.toEqual(publicService.plan.sourcePlan);
    expect(resident.plan.durationMinutes).not.toBe(publicService.plan.durationMinutes);
    expect(resident.plan.basis.every(item => item.knowledgeRevisionId && item.sourceRevisionId)).toBe(true);
    expect(await generate()).toEqual(resident);
    expect((await service.workspace(learner)).drafts).toEqual([]);
    expect((await service.workspace(learner)).releases).toEqual([]);
  });

  it("publishes only a reviewed current draft, preserves earlier releases and keeps edit/publication retries idempotent", async () => {
    const { service, lessons, generate } = await setup();
    const draft = await generate();
    const first = await service.publish(teacher, publishInput(draft));
    const oldLesson = structuredClone(lessons.find(item => item.contentHash === first.lessonHash)!);
    const edit = { taskId: draft.taskId, requestId: "edit-one", expectedRevision: 1, changes: changes(draft) };
    const revised = await service.revise(teacher, edit);
    expect(await service.revise(teacher, edit)).toEqual(revised);
    expect(await service.publish(teacher, publishInput(draft))).toEqual(first);
    const second = await service.publish(teacher, publishInput(revised, "publish-two"));
    expect(second.lessonHash).not.toBe(first.lessonHash);
    expect(lessons.find(item => item.contentHash === first.lessonHash)).toEqual(oldLesson);
    expect((await service.workspace(learner)).releases).toHaveLength(2);
    await expect(service.revise(teacher, { ...edit, requestId: "stale-edit" })).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(service.publish(learner, publishInput(revised))).rejects.toMatchObject({ code: "access_denied" });
    await expect(service.publication(first.ref.releaseId, { ...learner, classroomId: "other-class" })).rejects.toMatchObject({ code: "access_denied" });
  });

  it("uses the current SQL knowledge revision and refuses new publication after its basis changes", async () => {
    const { service, store, generate } = await setup();
    const draft = await generate();
    const basis = draft.plan.basis[0]!;
    const knowledge = (await store.getKnowledge(basis.knowledgeId))!;
    await store.upsertKnowledgeRecord({ knowledgeId: knowledge.knowledgeId, courseId: knowledge.courseId, title: "教师修订后的岗位知识",
      teachingSummary: "按当前资料核对受众与具体工作目标，保留适用边界。", sourceRevisionId: knowledge.sourceRevisionId!, sourceRefs: knowledge.sourceRefs ?? [], reviewStatus: "pending_expert_review" });
    await expect(service.publish(teacher, publishInput(draft))).rejects.toMatchObject({ code: "source_drift" });
    const fresh = await generate("generation-refreshed");
    expect(fresh.plan.basis.find(item => item.knowledgeId === basis.knowledgeId)?.knowledgeRevisionId).not.toBe(basis.knowledgeRevisionId);
    expect(fresh.plan.basis.find(item => item.knowledgeId === basis.knowledgeId)?.title).toBe("教师修订后的岗位知识");
  });
});

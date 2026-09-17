import { z } from "zod";
import {
  TeachingTaskDraftV1Schema, TeachingTaskInputV1Schema, TeachingTaskPlanV1Schema, TeachingTaskReleaseV1Schema,
  type CourseReleaseReference, type TeachingTaskDraftV1, type TeachingTaskGenerationResultV1, type TeachingTaskInputV1, type TeachingTaskPlanV1, type TeachingTaskReleaseV1,
} from "@ronggang/contracts";
import {
  hashCanonical, mediaTeachingContent, mediaTeachingTaskTemplates, professionalTrainingTasks, xunpuV4AssessmentCriteria,
  teachingTaskKnowledgeIds, validateExplorationLesson, xunpuExplorationLesson, type ExplorationLesson,
} from "@ronggang/course-content";
import type { CaseDraftRecord, CaseReleaseRecord, ContentStore } from "@ronggang/content-store";

export class TeachingTaskError extends Error {
  constructor(readonly code: "not_found" | "access_denied" | "revision_conflict" | "invalid_task" | "source_drift", message: string) {
    super(message); this.name = "TeachingTaskError";
  }
}
export interface TeachingTaskActor {
  principalId: string; actorId: string; role: "teacher" | "student" | "operator"; classroomId: string; sourceSessionId: string;
}
const ActorSourceSchema = z.object({ principalId: z.string().min(1), actorId: z.string().min(1), classroomId: z.string().min(1), sourceSessionId: z.string().min(1) }).strict();
const PayloadSchema = z.object({ kind: z.literal("media_teaching_task"), owner: ActorSourceSchema, draft: TeachingTaskDraftV1Schema,
  command: z.object({ requestId: z.string().min(1), requestHash: z.string().length(64) }).strict() }).strict();
const MetadataSchema = z.object({ kind: z.literal("media_teaching_task"), owner: ActorSourceSchema, release: TeachingTaskReleaseV1Schema,
  publicationRequestId: z.string().min(1), publicationRequestHash: z.string().length(64) }).strict();
export type TeachingTaskPublication = z.infer<typeof MetadataSchema> & { draft: TeachingTaskDraftV1 };

function teacher(actor: TeachingTaskActor): void {
  if (actor.role !== "teacher") throw new TeachingTaskError("access_denied", "只有课程教师可以生成、修改和发布委托任务");
}
function owned(actor: TeachingTaskActor, owner: z.infer<typeof ActorSourceSchema>): void {
  teacher(actor);
  if (actor.principalId !== owner.principalId || actor.classroomId !== owner.classroomId) throw new TeachingTaskError("access_denied", "不能修改其他教师或班级的任务原件");
}
function payload(record: CaseDraftRecord) {
  const value = PayloadSchema.parse(record.payload);
  const { contentHash, ...draft } = value.draft;
  if (record.contentHash !== contentHash || hashCanonical(draft) !== contentHash) throw new TeachingTaskError("source_drift", "任务草案内容与冻结hash不一致");
  return value;
}
const keyFor = (taskId: string) => `media-teaching:${taskId}`;

export class TeachingTaskService {
  readonly #locks = new Map<string, Promise<void>>();
  constructor(readonly options: { store: () => Promise<ContentStore>; courseRef: CourseReleaseReference;
    registerLesson: (lesson: ExplorationLesson) => Promise<void>; baseLessonFor?: (actor: TeachingTaskActor) => Promise<string>; lessons: readonly ExplorationLesson[]; now?: () => string }) {}

  #now(): string { return this.options.now?.() ?? new Date().toISOString(); }

  async generate(actor: TeachingTaskActor, requestId: string, raw: TeachingTaskInputV1): Promise<TeachingTaskGenerationResultV1> {
    teacher(actor);
    const input = TeachingTaskInputV1Schema.parse(raw);
    const questions: string[] = [];
    if (input.brief.length < 8) questions.push("请说明要完成哪项具体报道或信息服务任务。");
    if (input.audience.length < 2) questions.push("这份成果要帮助哪类受众解决什么问题？");
    if (!input.learnerContext) questions.push("请补充学生已学过的内容或本次最需要练习的技能。");
    if (!input.sourceStatement) questions.push("请说明委托来源；自拟课堂练习也请明确标注。");
    const ranked = mediaTeachingTaskTemplates.map(template => ({ template, score: template.intentTerms.reduce((sum, word) => sum + (input.brief.includes(word) ? word.length : 0), 0) }))
      .sort((a, b) => b.score - a.score);
    const template = input.templateId ? mediaTeachingTaskTemplates.find(item => item.templateId === input.templateId)!
      : ranked[0]!.score > 0 && ranked[0]!.score !== ranked[1]!.score ? ranked[0]!.template : null;
    if (!template) questions.push("当前仿真支持社区人物报道或公共服务信息核对，请明确本次重点；其他场景需要另行设计。");
    if (questions.length || !template) return { status: "needs_clarification", questions, supportedTemplates: ["community-story", "public-service"] };
    const taskId = `teaching-${hashCanonical({ owner: actor.principalId, requestId }).slice(0, 24)}`;
    return this.#serialized(taskId, async () => {
      const store = await this.options.store();
      const commandHash = hashCanonical({ input, owner: actor.principalId, classroom: actor.classroomId });
      const existing = await store.listCaseDrafts({ courseId: this.options.courseRef.courseId, caseKey: keyFor(taskId) });
      if (existing.length) {
        const prior = payload(existing.find(row => row.version === 1)!);
        owned(actor, prior.owner);
        if (prior.command.requestHash !== commandHash) throw new TeachingTaskError("revision_conflict", "同一生成请求不能更换委托内容");
        return { status: "draft_created", draft: prior.draft };
      }
      const focusCriteria = input.focusCriteria.length ? [...new Set(input.focusCriteria)] : [...template.focusCriteria];
      const focusKnowledgeIds = new Set(professionalTrainingTasks.filter(task => task.rubricDimensions.some(id => focusCriteria.includes(id as typeof focusCriteria[number]))).flatMap(task => task.knowledgeIds));
      const basis = await Promise.all(teachingTaskKnowledgeIds(template).map(async knowledgeId => {
        const knowledge = await store.getKnowledge(knowledgeId);
        if (!knowledge || knowledge.courseId !== this.options.courseRef.courseId || !knowledge.sourceRevisionId || knowledge.reviewStatus === "retired") {
          throw new TeachingTaskError("source_drift", `岗位知识未装载或已停用：${knowledgeId}`);
        }
        const revision = await store.getSourceRevision(knowledge.sourceRevisionId);
        const source = revision ? await store.getSourceDocument(revision.sourceId) : null;
        if (!revision || !source || !["current", "historical"].includes(revision.status)) throw new TeachingTaskError("source_drift", `岗位知识缺少可用来源：${knowledgeId}`);
        const fragment = revision.fragments.find(item => knowledge.sourceRefs?.includes(item.fragmentId));
        return { knowledgeId, knowledgeRevisionId: knowledge.knowledgeRevisionId, sourceRevisionId: revision.revisionId,
          title: knowledge.title, sourceTitle: source.title, sourceUrl: source.canonicalUrl ?? null,
          locator: fragment ? fragment.locator.label ?? JSON.stringify(fragment.locator) : "整份来源引用，具体定位须在专业复核时补充",
          contentHash: knowledge.contentHash, reviewStatus: knowledge.reviewStatus, isFocus: focusKnowledgeIds.has(knowledgeId) };
      }));
      const plan = TeachingTaskPlanV1Schema.parse({
        title: input.title || template.title, audience: input.audience,
        assignment: `本次委托：${input.brief}\n面向：${input.audience}。请在蟳埔社区的现有仿真资料和人物范围内完成调查、核验、作品与复盘；委托描述不自动成为已证实的现场事实。`,
        objectives: [template.purpose, `根据${input.audience}的使用需要决定取材与表达，保留事实和许可范围。`, `学习重点：${input.learnerContext}`],
        durationMinutes: input.durationMinutes, scaffoldingLevel: input.learnerLevel === "beginner" ? 2 : 1, challengeLevel: input.learnerLevel === "beginner" ? 4 : 5,
        focusCriteria,
        steps: template.stages.map(stage => {
          const task = professionalTrainingTasks.find(item => item.taskId === stage.taskRef)!;
          return { ...stage, title: task.title, competencyRefs: task.competencyRefs, knowledgeIds: task.knowledgeIds, artifactIds: task.artifacts };
        }),
        basis,
        sourcePlan: template.sourcePlan, recommendedStrategies: template.recommendedStrategies, acceptableAlternatives: template.acceptableAlternatives,
        reflectionQuestion: template.reflectionQuestion,
        reviewBoundary: "在既有蟳埔仿真中执行；任务、材料与示范不是现实采访事实。知识和量规仍待专业复核，教师确认本次教学适用性不代表外部认证。",
      });
      const draft = this.#draft({ schemaVersion: "teaching-task-draft/1.0.0", taskId, revision: 1, input, templateId: template.templateId, plan,
        sourceCourseRef: this.options.courseRef, baseLessonHash: await this.options.baseLessonFor?.(actor) ?? xunpuExplorationLesson.contentHash, templateContentHash: mediaTeachingContent.contentHash,
        generationMode: "knowledge_rules", createdAt: this.#now() });
      const owner = { principalId: actor.principalId, actorId: actor.actorId, classroomId: actor.classroomId, sourceSessionId: actor.sourceSessionId };
      await this.#save(store, draft, owner, requestId, commandHash);
      return { status: "draft_created", draft };
    });
  }

  #draft(input: Omit<TeachingTaskDraftV1, "contentHash">): TeachingTaskDraftV1 {
    return TeachingTaskDraftV1Schema.parse({ ...input, contentHash: hashCanonical(input) });
  }
  async #save(store: ContentStore, draft: TeachingTaskDraftV1, owner: z.infer<typeof ActorSourceSchema>, requestId: string, requestHash: string): Promise<void> {
    await store.createCaseDraft({ caseId: `${draft.taskId}-r${draft.revision}`, courseId: draft.sourceCourseRef.courseId, caseKey: keyFor(draft.taskId), version: draft.revision,
      title: draft.plan.title, contentHash: draft.contentHash, payload: { kind: "media_teaching_task", owner, draft, command: { requestId, requestHash } } });
  }
  async #versions(taskId: string): Promise<CaseDraftRecord[]> {
    const rows = await (await this.options.store()).listCaseDrafts({ courseId: this.options.courseRef.courseId, caseKey: keyFor(taskId) });
    if (!rows.length) throw new TeachingTaskError("not_found", "任务草案不存在");
    return rows.toSorted((a, b) => a.version - b.version);
  }

  async revise(actor: TeachingTaskActor, input: { taskId: string; requestId: string; expectedRevision: number;
    changes: Pick<TeachingTaskPlanV1, "title" | "assignment" | "audience" | "objectives" | "durationMinutes" | "scaffoldingLevel" | "challengeLevel"> & { steps: Array<{ taskRef: string; instruction: string }> } }): Promise<TeachingTaskDraftV1> {
    return this.#serialized(input.taskId, async () => {
      const versions = await this.#versions(input.taskId), last = payload(versions.at(-1)!);
      owned(actor, last.owner);
      const commandHash = hashCanonical(input);
      const prior = versions.map(payload).find(item => item.command.requestId === input.requestId);
      if (prior) {
        if (prior.command.requestHash !== commandHash) throw new TeachingTaskError("revision_conflict", "同一修改请求的内容不一致");
        return prior.draft;
      }
      if (last.draft.revision !== input.expectedRevision) throw new TeachingTaskError("revision_conflict", "草案已变化，请重新读取后修改");
      const refs = input.changes.steps.map(step => step.taskRef), expected = new Map(last.draft.plan.steps.map(step => [step.taskRef, step]));
      if (refs.length !== expected.size || new Set(refs).size !== expected.size || refs.some(ref => !expected.has(ref))) throw new TeachingTaskError("invalid_task", "本阶段可调整步骤说明与顺序，必须保留完整岗位交付和复盘步骤");
      const plan = TeachingTaskPlanV1Schema.parse({ ...last.draft.plan, ...input.changes, steps: input.changes.steps.map(step => ({ ...expected.get(step.taskRef)!, instruction: step.instruction })) });
      const { contentHash: _hash, ...original } = last.draft;
      const draft = this.#draft({ ...original, revision: last.draft.revision + 1, plan, createdAt: this.#now() });
      await this.#save(await this.options.store(), draft, last.owner, input.requestId, commandHash);
      return draft;
    });
  }

  lessonFor(draft: TeachingTaskDraftV1): ExplorationLesson {
    const base = this.options.lessons.find(item => item.contentHash === draft.baseLessonHash);
    if (!base) throw new TeachingTaskError("source_drift", "任务引用的原采访课程版本未装载");
    const { contentHash: _hash, ...source } = structuredClone(base);
    const focus = draft.plan.focusCriteria.map(id => xunpuV4AssessmentCriteria.find(item => item.criterionId === id)!.title).join("、");
    const lesson = { ...source, lessonId: draft.taskId, version: `1.${draft.revision}.0`, title: draft.plan.title,
      assignment: `${draft.plan.assignment}\n本轮重点：${focus}。起始任务级别由教师设置，不代表已有能力诊断结果。` };
    const published = { ...lesson, contentHash: hashCanonical(lesson) };
    if (validateExplorationLesson(published).length) throw new TeachingTaskError("invalid_task", "任务不能编译为当前可运行的采访课");
    return published;
  }

  async publish(actor: TeachingTaskActor, input: { taskId: string; requestId: string; expectedRevision: number; contentHash: string; confirmation: string }): Promise<TeachingTaskReleaseV1> {
    return this.#serialized(input.taskId, async () => {
      const store = await this.options.store(), versions = await this.#versions(input.taskId);
      const target = versions.find(row => row.version === input.expectedRevision);
      if (!target) throw new TeachingTaskError("revision_conflict", "指定的任务草案版本不存在");
      const last = payload(target);
      owned(actor, last.owner);
      if (last.draft.contentHash !== input.contentHash) throw new TeachingTaskError("revision_conflict", "确认内容与指定草案的hash不一致");
      const lesson = this.lessonFor(last.draft), requestHash = hashCanonical(input);
      const existing = (await store.listCaseReleases(this.options.courseRef.courseId)).find(item => item.caseId === `${input.taskId}-r${input.expectedRevision}`);
      if (existing) {
        const meta = MetadataSchema.parse(existing.metadata);
        if (meta.publicationRequestId === input.requestId && meta.publicationRequestHash !== requestHash) throw new TeachingTaskError("revision_conflict", "同一发布请求的确认内容不一致");
        await this.options.registerLesson(lesson);
        return meta.release;
      }
      if (target.caseId !== versions.at(-1)!.caseId) throw new TeachingTaskError("revision_conflict", "只能新发布当前已审阅的最新草案");
      for (const basis of last.draft.plan.basis) {
        const current = await store.getKnowledge(basis.knowledgeId);
        if (!current || current.knowledgeRevisionId !== basis.knowledgeRevisionId || current.contentHash !== basis.contentHash || current.reviewStatus === "retired") {
          throw new TeachingTaskError("source_drift", "任务依据已发生变化，请用当前知识重新生成并复核草案");
        }
      }
      const release = TeachingTaskReleaseV1Schema.parse({ schemaVersion: "teaching-task-release/1.0.0",
        ref: { taskId: input.taskId, revision: last.draft.revision, releaseId: `${input.taskId}-published-r${last.draft.revision}`, contentHash: last.draft.contentHash },
        plan: last.draft.plan, sourceCourseRef: last.draft.sourceCourseRef, lessonHash: lesson.contentHash, publishedAt: this.#now(), teacherConfirmation: input.confirmation });
      await store.publishCase({ releaseId: release.ref.releaseId, caseId: `${input.taskId}-r${last.draft.revision}`, courseId: this.options.courseRef.courseId,
        releaseVersion: `${input.taskId}-r${last.draft.revision}`, contentHash: last.draft.contentHash,
        metadata: { kind: "media_teaching_task", owner: last.owner, release, publicationRequestId: input.requestId, publicationRequestHash: requestHash } });
      await this.options.registerLesson(lesson);
      return release;
    });
  }

  async publication(releaseId: string, viewer?: TeachingTaskActor): Promise<TeachingTaskPublication> {
    const store = await this.options.store(), row = (await store.listCaseReleases(this.options.courseRef.courseId)).find(item => item.releaseId === releaseId && item.status === "published");
    if (!row || row.metadata?.kind !== "media_teaching_task") throw new TeachingTaskError("not_found", "该教学任务尚未发布或已撤回");
    const result = await this.#publicationFromRow(store, row);
    if (viewer && viewer.role !== "operator" && viewer.classroomId !== result.owner.classroomId) throw new TeachingTaskError("access_denied", "这份任务不属于当前班级");
    return result;
  }

  async #publicationFromRow(store: ContentStore, row: CaseReleaseRecord): Promise<TeachingTaskPublication> {
    const meta = MetadataSchema.parse(row.metadata), draftRow = await store.getCaseDraft(row.caseId);
    if (!draftRow || row.contentHash !== meta.release.ref.contentHash) throw new TeachingTaskError("source_drift", "教学发布与草案引用漂移");
    const source = payload(draftRow);
    if (source.draft.contentHash !== meta.release.ref.contentHash || hashCanonical(source.owner) !== hashCanonical(meta.owner)
      || source.draft.taskId !== meta.release.ref.taskId || source.draft.revision !== meta.release.ref.revision
      || hashCanonical(source.draft.plan) !== hashCanonical(meta.release.plan)) throw new TeachingTaskError("source_drift", "教学发布来源不一致");
    return { ...meta, draft: source.draft };
  }

  async publications(): Promise<TeachingTaskPublication[]> {
    const store = await this.options.store();
    const rows = (await store.listCaseReleases(this.options.courseRef.courseId)).filter(row => row.status === "published" && row.metadata?.kind === "media_teaching_task");
    return Promise.all(rows.map(row => this.#publicationFromRow(store, row)));
  }

  async workspace(viewer: TeachingTaskActor): Promise<{ drafts: TeachingTaskDraftV1[]; releases: TeachingTaskReleaseV1[] }> {
    const store = await this.options.store();
    const drafts = viewer.role === "student" ? [] : (await store.listCaseDrafts({ courseId: this.options.courseRef.courseId }))
      .filter(row => row.payload.kind === "media_teaching_task").map(payload).filter(item => viewer.role === "operator" || item.owner.principalId === viewer.principalId);
    const current = new Map(drafts.map(item => [item.draft.taskId, item.draft]));
    for (const item of drafts) if ((current.get(item.draft.taskId)?.revision ?? 0) < item.draft.revision) current.set(item.draft.taskId, item.draft);
    const releases = (await this.publications()).filter(meta => viewer.role === "operator" || meta.owner.classroomId === viewer.classroomId).map(meta => meta.release);
    return { drafts: [...current.values()], releases };
  }

  async restorePublications(): Promise<void> {
    for (const publication of await this.publications()) {
      const lesson = this.lessonFor(publication.draft);
      if (lesson.contentHash !== publication.release.lessonHash) throw new TeachingTaskError("source_drift", "教学发布与运行课hash漂移");
      await this.options.registerLesson(lesson);
    }
  }

  async #serialized<T>(taskId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(taskId) ?? Promise.resolve();
    let unlock!: () => void;
    const done = new Promise<void>(resolve => { unlock = resolve; }), tail = previous.then(() => done);
    this.#locks.set(taskId, tail);
    await previous;
    try { return await run(); } finally { unlock(); if (this.#locks.get(taskId) === tail) this.#locks.delete(taskId); }
  }
}

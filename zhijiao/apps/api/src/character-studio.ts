import { CharacterBlueprintV3Schema, CharacterStudioDraftV3Schema, CharacterStudioWorkspaceV3Schema, type CharacterBlueprintV3, type CharacterStudioDraftV3 } from '@ronggang/contracts';
import { courseFieldLessonsV3, courseRegionAssignments, hashCanonical, validateExplorationLesson, type ExplorationLesson } from '@ronggang/course-content';
import type { CaseDraftRecord, ContentStore } from '@ronggang/content-store';
import { z } from 'zod';
import { TeachingTaskError, type TeachingTaskActor } from './teaching-task-service.js';

const owner = z.object({ principalId: z.string(), classroomId: z.string() }).strict();
const payloadSchema = z.object({ kind: z.literal('character_studio_v3'), owner, draft: CharacterStudioDraftV3Schema,
  command: z.object({ requestId: z.string(), requestHash: z.string() }).strict() }).strict();
const releaseSchema = z.object({ kind: z.literal('character_studio_v3'), owner, draftRevision: z.number(), lessonHash: z.string(),
  requestId: z.string(), requestHash: z.string(), publishedAt: z.string() }).strict();
const key = (classroomId: string, courseId: string) => `character-studio:${classroomId}:${courseId}`;
function teacher(actor: TeachingTaskActor) { if (actor.role !== 'teacher') throw new TeachingTaskError('access_denied', '只有本班教师可以配置课程人物'); }
function readPayload(row: CaseDraftRecord) {
  const payload = payloadSchema.parse(row.payload), { contentHash, ...body } = payload.draft;
  if (hashCanonical(body) !== contentHash || row.contentHash !== contentHash) throw new TeachingTaskError('source_drift', '人物草案的内容校验失败');
  return payload;
}

export class CharacterStudio {
  readonly #locks = new Map<string, Promise<void>>();
  constructor(readonly options: { store(): Promise<ContentStore>; registerLesson(lesson: ExplorationLesson): Promise<void>; lessons: readonly ExplorationLesson[]; now?: () => string }) {}
  #now() { return this.options.now?.() ?? new Date().toISOString(); }
  #base(courseId: string) { const binding = courseFieldLessonsV3.find(item => item.courseId === courseId); if (!binding) throw new TeachingTaskError('not_found', '这门课尚未开放人物配置'); return binding.lesson; }
  async #versions(actor: TeachingTaskActor, courseId: string) { return (await (await this.options.store()).listCaseDrafts({ courseId, caseKey: key(actor.classroomId, courseId) })).toSorted((a,b) => a.version-b.version); }
  #empty(actor: TeachingTaskActor, courseId: string): CharacterStudioDraftV3 {
    const body = { courseId, classroomId: actor.classroomId, revision: 0, baseLessonHash: this.#base(courseId).contentHash, characters: [], updatedAt: this.#now() };
    return CharacterStudioDraftV3Schema.parse({ ...body, contentHash: hashCanonical(body) });
  }
  async workspace(actor: TeachingTaskActor, courseId: string) {
    teacher(actor); const base = this.#base(courseId), store = await this.options.store();
    const versions = await this.#versions(actor, courseId), latest = versions.at(-1);
    const draft = latest ? readPayload(latest).draft : this.#empty(actor, courseId);
    const publications = (await store.listCaseReleases(courseId)).filter(row => row.status === 'published' && row.metadata?.kind === 'character_studio_v3')
      .map(row => ({ row, data: releaseSchema.parse(row.metadata) })).filter(item => item.data.owner.classroomId === actor.classroomId).sort((a,b) => b.data.draftRevision-a.data.draftRevision);
    const release = publications[0];
    return CharacterStudioWorkspaceV3Schema.parse({ courses: courseRegionAssignments.map(course => ({ courseId: course.courseId, title: course.shortTitle, region: course.regionTitle, regionId: course.regionId })), draft,
      nodes: base.nodes.map(node => ({ id: node.id, title: node.title })), people: base.people.map(person => ({ id: person.id, name: person.name, role: person.role })),
      knowledge: (await store.listKnowledge({ courseId, limit: 200 })).filter(row => row.reviewStatus !== 'retired').map(row => ({ knowledgeId: row.knowledgeId, title: row.title, reviewStatus: row.reviewStatus })),
      publication: release ? { releaseId: release.row.releaseId, draftRevision: release.data.draftRevision, lessonHash: release.data.lessonHash, publishedAt: release.data.publishedAt } : null });
  }
  async save(actor: TeachingTaskActor, courseId: string, input: { requestId: string; expectedRevision: number; characters: CharacterBlueprintV3[] }) {
    teacher(actor); this.#base(courseId);
    return this.#serialized(key(actor.classroomId, courseId), async () => {
      const versions = await this.#versions(actor, courseId), hash = hashCanonical(input), old = versions.map(readPayload).find(item => item.command.requestId === input.requestId);
      if (old) { if (old.command.requestHash !== hash) throw new TeachingTaskError('revision_conflict', '同一保存请求不能更换人物配置'); return this.workspace(actor, courseId); }
      const previous = versions.at(-1), last = previous ? readPayload(previous) : null;
      if (last && last.owner.principalId !== actor.principalId) throw new TeachingTaskError('access_denied', '该课程人物草案属于另一位教师');
      if ((last?.draft.revision ?? 0) !== input.expectedRevision) throw new TeachingTaskError('revision_conflict', '课程人物配置已更新，请先重新读取');
      const body = { courseId, classroomId: actor.classroomId, revision: input.expectedRevision + 1, baseLessonHash: this.#base(courseId).contentHash,
        characters: input.characters.map(value => CharacterBlueprintV3Schema.parse(value)), updatedAt: this.#now() };
      const draft = CharacterStudioDraftV3Schema.parse({ ...body, contentHash: hashCanonical(body) });
      await this.compile(draft); // The saved graph must already be executable.
      await (await this.options.store()).createCaseDraft({ caseId: `studio-${hashCanonical({ key: key(actor.classroomId, courseId), revision: draft.revision }).slice(0,30)}`,
        courseId, caseKey: key(actor.classroomId, courseId), version: draft.revision, title: `${this.#base(courseId).title} · 人物配置`, contentHash: draft.contentHash,
        payload: { kind: 'character_studio_v3', owner: { principalId: actor.principalId, classroomId: actor.classroomId }, draft, command: { requestId: input.requestId, requestHash: hash } } });
      return this.workspace(actor, courseId);
    });
  }
  async compile(draft: CharacterStudioDraftV3): Promise<ExplorationLesson> {
    const base = this.options.lessons.find(lesson => lesson.contentHash === draft.baseLessonHash);
    if (!base) throw new TeachingTaskError('source_drift', '课程人物引用的基础课程版本未装载');
    const { contentHash: _hash, ...body } = structuredClone(base);
    const ids = new Set(body.people.map(person => person.id)), nodes = new Set(body.nodes.map(node => node.id));
    for (const character of draft.characters) {
      if (ids.has(character.id) || !character.id.startsWith('character-')) throw new TeachingTaskError('invalid_task', '自定义人物编号重复或格式不正确'); ids.add(character.id);
    }
    const store = await this.options.store();
    for (const character of draft.characters) {
      if (!nodes.has(character.nodeId) || character.social.referralTargets.some(id => !ids.has(id))) throw new TeachingTaskError('invalid_task', '人物的位置或引荐对象不在本课程中');
      if (!/^\/assets\/[a-zA-Z0-9/_\-.]+$/u.test(character.appearance.image) && !/^\/api\/v3\/character-art\/character-art-[a-f0-9]{32}$/u.test(character.appearance.image)) throw new TeachingTaskError('invalid_task', '请选用素材库中的立绘或上传人物图片');
      if (character.appearance.image.startsWith('/api/')) {
        const asset = await store.getAsset(character.appearance.image.split('/').at(-1)!);
        if (!asset || asset.courseId !== draft.courseId || asset.metadata?.classroomId !== draft.classroomId || asset.rightsStatus !== 'granted') throw new TeachingTaskError('invalid_task', '人物立绘未获准用于当前课程');
      }
      for (const knowledgeId of character.knowledgeIds) {
        const knowledge = await store.getKnowledge(knowledgeId);
        if (!knowledge || knowledge.courseId !== draft.courseId || knowledge.reviewStatus === 'retired') throw new TeachingTaskError('invalid_task', '人物知识库不属于当前课程或已停用');
      }
      const topics = character.topics.map(topic => {
        const id = `${character.id}-${topic.id}`;
        if (topic.sourceKind === 'reference_guide' && !topic.sourceUrl?.startsWith('https://')) throw new TeachingTaskError('invalid_task', '方法资料需要明确 HTTPS 来源');
        body.materials.push({ id, title: topic.sourceTitle, nodeId: character.nodeId, kind: topic.sourceKind === 'simulation' ? 'simulation' : 'public_source', description: '由本课教师配置，交流后可按需查阅。',
          body: topic.response, sourceUrl: topic.sourceKind === 'reference_guide' ? topic.sourceUrl : null, locator: '本班教师配置的人物知识；仿真经历与现实资料分别标注', knowledgeRefs: character.knowledgeIds,
          requires: [], evidenceStatus: topic.sourceKind === 'simulation' ? 'scenario_record' : 'reference_guide' });
        return { id, title: topic.title, keywords: topic.keywords, response: topic.response, materialIds: [id] };
      });
      body.people.push({ id: character.id, name: character.name, role: character.role, nodeId: character.nodeId, goal: character.goal, activity: character.goal, unknown: character.unknown,
        greeting: character.greeting, clarification: '请说明具体想了解哪件事，我会在自己的工作和知识范围内回应。', topics, requiresFlag: null, remoteContact: character.social.supportsContact,
        personality: character.personality, appearance: character.appearance, social: character.social, workflow: character.workflow });
    }
    const content = { ...body, lessonId: `studio-${hashCanonical({ courseId: draft.courseId, classroomId: draft.classroomId }).slice(0,28)}`, version: `3.0.0-r${draft.revision}` };
    const lesson = { ...content, contentHash: hashCanonical(content) }, errors = validateExplorationLesson(lesson);
    if (errors.length) throw new TeachingTaskError('invalid_task', errors.slice(0,5).join('；'));
    return lesson;
  }
  async publish(actor: TeachingTaskActor, courseId: string, input: { requestId: string; expectedRevision: number; contentHash: string }) {
    teacher(actor);
    return this.#serialized(key(actor.classroomId, courseId), async () => {
      const rows = await this.#versions(actor, courseId), target = rows.find(row => row.version === input.expectedRevision);
      if (!target) throw new TeachingTaskError('not_found', '请先保存人物配置');
      const data = readPayload(target);
      if (data.owner.principalId !== actor.principalId) throw new TeachingTaskError('access_denied', '只能发布自己审阅的课程配置');
      if (data.draft.contentHash !== input.contentHash) throw new TeachingTaskError('revision_conflict', '要发布的配置与保存版本不一致');
      const store = await this.options.store(), old = (await store.listCaseReleases(courseId)).find(row => row.caseId === target.caseId);
      if (old) { const meta = releaseSchema.parse(old.metadata); if (meta.requestId === input.requestId && meta.requestHash !== hashCanonical(input)) throw new TeachingTaskError('revision_conflict', '同一发布请求不能更换内容'); return this.workspace(actor, courseId); }
      if (target.caseId !== rows.at(-1)?.caseId) throw new TeachingTaskError('revision_conflict', '只能发布当前已保存的最新版本');
      const lesson = await this.compile(data.draft); await this.options.registerLesson(lesson);
      await store.publishCase({ releaseId: `studio-release-${lesson.contentHash.slice(0,30)}`, caseId: target.caseId, courseId, releaseVersion: lesson.version, contentHash: data.draft.contentHash,
        metadata: { kind: 'character_studio_v3', owner: data.owner, draftRevision: data.draft.revision, lessonHash: lesson.contentHash, requestId: input.requestId, requestHash: hashCanonical(input), publishedAt: this.#now() } });
      return this.workspace(actor, courseId);
    });
  }
  async lessonFor(courseId: string, classroomId: string) {
    const store = await this.options.store();
    const releases = (await store.listCaseReleases(courseId)).filter(row => row.status === 'published' && row.metadata?.kind === 'character_studio_v3')
      .map(row => ({ row, meta: releaseSchema.parse(row.metadata) })).filter(item => item.meta.owner.classroomId === classroomId).sort((a,b) => b.meta.draftRevision-a.meta.draftRevision);
    const latest = releases[0]; if (!latest) return this.#base(courseId).contentHash;
    if (!this.options.lessons.some(lesson => lesson.contentHash === latest.meta.lessonHash)) throw new TeachingTaskError('source_drift', '该人物发布版本未装载，不能改用其他版本开课');
    return latest.meta.lessonHash;
  }
  async #serialized<T>(id: string, action: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(id) ?? Promise.resolve(); let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), next = prior.then(() => wait); this.#locks.set(id, next); await prior;
    try { return await action(); } finally { release(); if (this.#locks.get(id) === next) this.#locks.delete(id); }
  }
}

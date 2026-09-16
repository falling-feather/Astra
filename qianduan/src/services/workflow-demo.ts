import type * as D from '../portal/workflow-types';
import type * as T from '../portal/contracts';
import type { ResourceGateway } from '../portal/resource-types';
import type { DemoTeachingStore } from './school-demo';
import { ApiError } from './http-client.ts';
import { applySync, compareSync, reviewImpact, snapshotHash, stableJson } from '../domain/course-sync.ts';

interface Revision { summary: D.CourseRevisionSummaryRead; snapshot: D.CourseSnapshotRead }
interface CourseState {
  id: number;
  family: number;
  sourceCourse: number | null;
  sourceRelease: number | null;
  sourceRevision: number | null;
  settings: D.CourseSettings;
  revision: number;
  units: D.CourseDraftUnitReadV2[];
  revisions: Revision[];
  releases: Map<number, D.CourseSnapshotRead>;
}
const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const paginate = <T>(items: T[], offset = 0, limit = 25) => ({ items: copy(items.slice(offset, offset + limit)), total: items.length, offset, limit, next_offset: offset + limit < items.length ? offset + limit : null });
const asContent = (content: T.ContentPage): D.ContentPageV2 => copy(content) as D.ContentPageV2;
const legacySettings = (settings: D.CourseSettings): T.CourseInput => ({ ...settings, summary: settings.summary || null, collaborator_user_ids: settings.collaborator_user_ids || [], admission_class_ids: settings.admission_class_ids || [] });

/** Pages-only memory simulation. No account, file or teaching body is persisted. */
export function createWorkflowDemo(role: () => T.Role, store: DemoTeachingStore, resources: ResourceGateway): D.WorkflowGateway {
  const courses = new Map<number, CourseState>();
  const candidates = new Map<number, D.CandidateDetailRead>();
  const receipts = new Map<string, { request: string; kind: string; result: object }>();
  const media = new Map<string, { meta: D.CourseMediaRead; url: string; courses: Set<number> }>();
  const requireRole = (...roles: T.Role[]) => { if (!roles.includes(role())) throw new ApiError('当前演示身份没有此操作权限。', 403); };
  const find = (id: number) => { const course = store.courses.find((course) => course.id === id); if (!course) throw new ApiError('课程不存在。', 404); return course; };
  const snapshot = (course: CourseState): D.CourseSnapshotRead => ({ settings: copy(course.settings), units: course.units.map((unit) => ({ id: unit.id, activity_key: unit.activity_key, origin_key: unit.origin_key, block_origins: copy(unit.block_origins), resource_version_id: unit.resource_version_id, title: unit.title, position: unit.position, content: copy(unit.content || null) })) });
  const capture = async (course: CourseState) => {
    let revision = course.revisions.find((item) => item.summary.revision_number === course.revision);
    if (!revision) { const frozen = snapshot(course); revision = { summary: { id: store.nextId(), course_id: course.id, revision_number: course.revision, content_sha256: await snapshotHash(frozen), created_by_user_id: 1, created_at: now() }, snapshot: frozen }; course.revisions.push(revision); }
    return revision;
  };
  const load = async (id: number): Promise<CourseState> => {
    const known = courses.get(id); if (known) return known;
    const info = find(id), draft = store.drafts.get(id)!;
    const settings = { ...info.information_revision.information_snapshot, school_id: info.school_id, collaborator_user_ids: info.teachers.filter((teacher) => !teacher.is_creator).map((teacher) => teacher.user_id), level_key: null };
    const units: D.CourseDraftUnitReadV2[] = draft.units.map((unit) => ({ id: unit.id!, activity_key: unit.activity_key, title: unit.title, position: unit.position, revision: draft.revision, content: unit.content ? asContent(unit.content) : null, origin_key: `demo-unit-${unit.id}`, block_origins: Object.fromEntries((unit.content?.blocks || []).map((block) => [block.blockId, `demo-unit-${unit.id}:${block.blockId}`])), resource_version_id: null }));
    const course: CourseState = { id, family: id, sourceCourse: null, sourceRelease: null, sourceRevision: null, settings, revision: draft.revision, units, revisions: [], releases: new Map() };
    courses.set(id, course);
    const current = await capture(course);
    for (const release of store.releases.get(id) || []) course.releases.set(release.id, copy(current.snapshot));
    return course;
  };
  const info = (course: CourseState): D.CourseWorkflowRead => {
    const source = find(course.id);
    return { ...source, summary: source.summary, teachers: source.teachers.map((teacher) => ({ ...teacher, username: teacher.is_creator ? 'teacher' : `teacher-${teacher.user_id}` })), admission_classes: source.admission_classes.map((group) => ({ ...group, status: 'active' })), information_revision: { ...source.information_revision, course_id: source.id, teacher_ids_snapshot: source.teachers.map((teacher) => teacher.user_id), created_by_user_id: 1, created_at: now(), updated_at: now() }, content_status: source.has_published_content ? 'published' : 'not_published', content_status_label: source.has_published_content ? '已有演示发布' : '尚未发布', created_at: now(), updated_at: now(), family_id: course.family, source_course_id: course.sourceCourse, source_release_id: course.sourceRelease, source_revision_id: course.sourceRevision, workflow_generation: 2, level_key: course.settings.level_key || null, draft_settings: copy(course.settings) };
  };
  const draft = async (course: CourseState): Promise<D.CourseDraftReadV2> => {
    const ids = new Set(course.units.flatMap((unit) => (unit.content?.blocks || []).flatMap((block) => block.type === 'resource' ? [block.resourceVersionId] : [])));
    return { course_id: course.id, family_id: course.family, revision: course.revision, revision_id: (await capture(course)).summary.id, state_token: await snapshotHash(snapshot(course)), settings: copy(course.settings), units: copy(course.units), resources: await Promise.all([...ids].map((id) => resources.version(id))), warnings: [] };
  };
  const baseline = (course: CourseState) => { const release = store.releases.get(course.id)?.at(-1); return { release, snapshot: copy(release ? course.releases.get(release.id)! : { settings: {}, units: [] }) }; };
  const write = async <T extends object>(kind: string, key: string, body: object, action: () => Promise<T>): Promise<T> => {
    const identity = `${role()}:${key}`, request = stableJson(body), old = receipts.get(identity);
    if (old) { if (old.kind !== kind || old.request !== request) throw new ApiError('该操作编号已用于不同内容。', 409); return copy(old.result) as T; }
    const rollback = store.checkpoint(), saved = { courses: copy(courses), candidates: copy(candidates), media: copy(media) };
    try {
      const result = await action(); receipts.set(identity, { request, kind, result: copy(result) }); return copy(result);
    } catch (error) {
      rollback();
      courses.clear(); saved.courses.forEach((value, key) => courses.set(key, value));
      candidates.clear(); saved.candidates.forEach((value, key) => candidates.set(key, value));
      media.forEach((value, key) => { if (!saved.media.has(key)) URL.revokeObjectURL(value.url); });
      media.clear(); saved.media.forEach((value, key) => media.set(key, value));
      throw error;
    }
  };
  const saveState = async (course: CourseState, settings: D.CourseSettings, units: D.CourseUnitWrite[]) => {
    await capture(course);
    const old = new Map(course.units.map((unit) => [unit.id, unit]));
    const prepared: D.CourseDraftUnitReadV2[] = [];
    for (const unit of units) {
      const existing = unit.id ? old.get(unit.id) || course.revisions.flatMap((revision) => revision.snapshot.units).find((item) => item.id === unit.id) : undefined;
      if (unit.id && !existing) throw new ApiError('单元不属于本课程。', 422);
      const id = existing?.id || store.nextId(), origin = existing?.origin_key || `demo-unit-${id}`;
      const content = copy(unit.content);
      for (const block of content.blocks) if (block.type === 'resource') await resources.preview(block.resourceVersionId, block.configuration || {});
      const activity = existing?.activity_key || `unit.${crypto.randomUUID()}`;
      content.slug = `courses/${course.id}/${activity}`;
      content.status = 'draft'; content.version = `draft-r${course.revision + 1}`;
      if (content.courseUnit) Object.assign(content.courseUnit, { courseId: `course-${course.id}`, unitId: activity, title: unit.title, order: unit.position });
      prepared.push({ id, activity_key: activity, title: unit.title, position: unit.position, content, revision: course.revision + 1, origin_key: origin, block_origins: { ...existing?.block_origins, ...Object.fromEntries(content.blocks.map((block) => [block.blockId, existing?.block_origins[block.blockId] || `${origin}:${block.blockId}`])) }, resource_version_id: unit.resource_version_id || null });
    }
    course.units = prepared; course.settings = copy(settings); course.revision++;
    store.save(course.id, { course_id: course.id, revision: course.revision, status: find(course.id).status, title: settings.title, summary: settings.summary || null, units: prepared.map((unit) => ({ ...unit, content: copy(unit.content) as T.ContentPage })) });
    await capture(course);
  };
  const preview = async (id: number, input: D.SubmissionPreviewCommand): Promise<D.SubmissionPreviewRead> => {
    const source = await load(id);
    if (source.revision !== input.source_revision || await snapshotHash(snapshot(source)) !== input.source_state_token) throw new ApiError('源草稿已变化，请重新读取。', 409);
    const targets = input.target_course_ids || [];
    const base = source.revisions.find((revision) => revision.summary.id === input.base_revision_id);
    if (targets.length && (!base || base.summary.revision_number >= source.revision)) throw new ApiError('请选择修改前的修订。', 422);
    const items: D.SubmissionCoursePreview[] = [];
    for (const key of [id, ...targets]) {
      const target = await load(key);
      if (key !== id && target.family !== source.family) throw new ApiError('同步目标不是同源教学版本。', 403);
      const changes = key === id ? [] : await compareSync(base!.snapshot, snapshot(source), snapshot(target), key);
      const next = applySync(snapshot(target), changes, input.conflict_choices || {}).snapshot;
      if (!next.units.length || next.units.some((unit) => !unit.content?.courseUnit?.completion)) throw new ApiError('请为各单元编排内容并选择完成条件。', 422);
      const previous = baseline(target);
      items.push({ course_id: key, title: target.settings.title, revision: target.revision, state_token: await snapshotHash(snapshot(target)), base_release_id: previous.release?.id || null, pending_review_id: [...candidates.values()].find((candidate) => candidate.course_id === key && candidate.status === 'submitted')?.review_item_id || null, changes, impact: reviewImpact(next, previous.snapshot), dependencies_sha256: await snapshotHash(next.units.map((unit) => unit.resource_version_id)) });
    }
    const result = { source_course_id: id, source_revision: source.revision, base_revision_id: input.base_revision_id || null, courses: items };
    return { ...result, preview_token: await snapshotHash(result) };
  };
  const gateway: D.WorkflowGateway = {
    async courses() { requireRole('teacher', 'admin'); return Promise.all(store.courses.map(async (course) => info(await load(course.id)))); },
    async course(id) { requireRole('teacher', 'admin'); return info(await load(id)); },
    async create(input) {
      requireRole('teacher');
      return write('course.create', input.client_request_id, input, async () => { if (store.courses.some((course) => course.school_id === input.school_id && course.title === input.title)) throw new ApiError('本校已有同名课程。', 409); const created = store.create(legacySettings(input)); const course = await load(created.id); course.settings = copy(input); delete (course.settings as Partial<D.CourseCreateCommand>).client_request_id; course.revisions = []; await capture(course); return info(course); });
    },
    async draft(id) { requireRole('teacher', 'admin'); return draft(await load(id)); },
    async save(id, input) {
      requireRole('teacher');
      return write('course.draft.save', input.client_request_id, { id, ...input }, async () => { const course = await load(id); if (course.revision !== input.expected_revision || await snapshotHash(snapshot(course)) !== input.expected_state_token) throw new ApiError('草稿已变化，请重新读取。', 409); await saveState(course, input.settings, input.units); return draft(course); });
    },
    async fork(id, input) {
      requireRole('teacher');
      return write('course.fork', input.client_request_id, { id, ...input }, async () => {
        const source = await load(id);
        const revision = input.source_revision_id ? source.revisions.find((revision) => revision.summary.id === input.source_revision_id) : await capture(source);
        const frozen = input.source_release_id ? source.releases.get(input.source_release_id) : revision?.snapshot;
        if (!frozen || !input.source_release_id && !input.source_revision_id && source.revision !== input.expected_source_revision) throw new ApiError('来源修订已变化。', 409);
        const created = store.create(legacySettings(input.settings)), target = await load(created.id);
        target.family = source.family; target.sourceCourse = id; target.sourceRelease = input.source_release_id || null; target.sourceRevision = revision?.summary.id || null;
        const warnings: string[] = [];
        const inherited = copy(frozen.units);
        for (const unit of inherited) {
          if (!unit.content) throw new ApiError('来源单元缺少内容。', 422);
          const origins: Record<string, string> = {};
          for (const block of unit.content.blocks) { const origin = unit.block_origins[block.blockId]; block.blockId = `block-${crypto.randomUUID()}`; origins[block.blockId] = origin; if (block.type === 'media') media.get(block.assetKey)?.courses.add(target.id); }
          unit.block_origins = origins;
          if (unit.content.courseUnit?.completion?.preset === 'assignment_reviewed') { unit.content.courseUnit.completion = null; warnings.push(`${unit.title}：请为新课程重新布置作业`); }
        }
        await saveState(target, input.settings, inherited.map((unit) => ({ title: unit.title, position: unit.position, resource_version_id: unit.resource_version_id, content: unit.content! })));
        target.units.forEach((unit, index) => { unit.origin_key = inherited[index].origin_key; unit.block_origins = inherited[index].block_origins; });
        target.revisions.pop(); await capture(target);
        return { course: info(target), draft: { ...await draft(target), warnings }, copied_units: target.units.length, warnings };
      });
    },
    async revisions(id, offset = 0) { requireRole('teacher', 'admin'); return paginate((await load(id)).revisions.map((revision) => revision.summary).sort((a, b) => b.revision_number - a.revision_number), offset, 50); },
    async preview(id, input) { requireRole('teacher'); return preview(id, input); },
    async submit(id, input) {
      requireRole('teacher');
      return write('course.submit', input.client_request_id, { id, ...input }, async () => {
        const shown = await preview(id, input);
        if (shown.preview_token !== input.preview_token) throw new ApiError('预览已过期。', 409);
        const decisions = input.conflict_choices || {}, policies = input.result_policies || {};
        if (shown.courses.some((course) => course.changes.some((change) => change.status === 'conflict' && !decisions[change.key]))) throw new ApiError('请处理全部冲突。', 422);
        const prepared = [];
        const skipped = [];
        for (const item of shown.courses) {
          const course = await load(item.course_id), next = applySync(snapshot(course), item.changes, decisions);
          if (item.course_id !== id && !next.applied.length) { skipped.push({ course_id: course.id, reason: '无需同步' }); continue; }
          if (item.pending_review_id) throw new ApiError('部分课程已有待审候选。', 409);
          const chosen: Record<string, 'keep' | 'redo'> = {};
          for (const unit of item.impact.units) {
            const decision = policies[String(course.id)]?.[String(unit.unit_id)] || unit.default_policy;
            if (!decision || unit.change === 'unchanged' && decision !== 'keep') throw new ApiError('请核对旧结果处理方式。', 422);
            chosen[String(unit.unit_id)] = decision;
          }
          prepared.push({ course, item, next, chosen });
        }
        const batch = store.nextId(), sourceRevision = await capture(await load(id)), items: D.SubmissionItemRead[] = [];
        for (const { course, item, next, chosen } of prepared) {
          if (course.id !== id) await saveState(course, course.settings, next.snapshot.units.map((unit) => ({ id: unit.id, activity_key: unit.activity_key, resource_version_id: unit.resource_version_id, title: unit.title, position: unit.position, content: unit.content! })));
          const revision = await capture(course), candidateId = store.nextId(), reviewId = store.nextId();
          const candidate: D.CandidateDetailRead = { candidate_id: candidateId, batch_id: batch, course_id: course.id, course_title: course.settings.title, school_id: course.settings.school_id, revision_id: revision.summary.id, base_release_id: item.base_release_id, review_item_id: reviewId, review_version: 1, status: 'submitted', review_note: null, reviewed_by_user_id: null, reviewed_at: null, created_at: now(), published_release_id: null, candidate_sha256: await snapshotHash(revision.snapshot), snapshot: copy(revision.snapshot), baseline: baseline(course).snapshot, impact: { ...item.impact, sync: { source_course_id: id, source_revision_id: sourceRevision.summary.id, base_revision_id: input.base_revision_id || null, applied_changes: next.applied, preview_changes: item.changes } }, result_policies: chosen, dependencies: {}, source_revision_id: sourceRevision.summary.id, submitted_by_user_id: 1, note: input.note || null, stale: false };
          candidates.set(candidateId, candidate);
          items.push({ course_id: course.id, candidate_id: candidateId, revision_id: revision.summary.id, review_item_id: reviewId, review_version: 1, status: 'submitted' });
        }
        return { batch_id: batch, items, skipped };
      });
    },
    async candidates(filters = {}) { requireRole('teacher', 'admin'); return paginate([...candidates.values()].filter((item) => (!filters.course_id || item.course_id === filters.course_id) && (!filters.status || item.status === filters.status) && (!filters.batch_id || item.batch_id === filters.batch_id)).sort((a, b) => b.candidate_id - a.candidate_id), filters.offset || 0); },
    async candidate(id) { requireRole('teacher', 'admin'); const item = candidates.get(id); if (!item) throw new ApiError('候选不存在。', 404); return { ...copy(item), stale: baseline(await load(item.course_id)).release?.id !== (item.base_release_id ?? undefined) }; },
    async review(input) {
      requireRole('admin');
      return write('course.review', input.client_request_id, input, async () => {
        const items = input.items.map((selection) => { const item = [...candidates.values()].find((candidate) => candidate.review_item_id === selection.review_item_id); if (!item || item.status !== 'submitted' || item.review_version !== selection.expected_version) throw new ApiError('审核项已变化，本次未作部分处理。', 409); return item; });
        items.forEach((item) => { item.status = input.decision; item.review_version++; item.review_note = input.note || null; item.reviewed_by_user_id = 3; item.reviewed_at = now(); });
        return { items: items.map((item) => ({ course_id: item.course_id, candidate_id: item.candidate_id, review_item_id: item.review_item_id, review_version: item.review_version, status: item.status })) };
      });
    },
    async withdraw(id, input) { requireRole('teacher'); return write('course.withdraw', input.client_request_id, { id, ...input }, async () => { const item = candidates.get(id); if (!item || item.review_version !== input.expected_version || !['submitted', 'approved'].includes(item.status) || item.published_release_id) throw new ApiError('候选状态已变化。', 409); item.status = 'withdrawn'; item.review_version++; return { candidate_id: id, status: 'withdrawn', review_version: item.review_version }; }); },
    async publish(input) {
      requireRole('teacher');
      return write('course.publish', input.client_request_id, input, async () => {
        const selected = [];
        for (const selection of input.items) {
          const item = candidates.get(selection.candidate_id);
          if (!item || item.status !== 'approved' || item.review_version !== selection.expected_review_version || item.published_release_id) throw new ApiError('所选候选未通过或已发布。', 409);
          const course = await load(item.course_id);
          if ((baseline(course).release?.id || null) !== item.base_release_id) throw new ApiError('发布基线已变化，需要重新审核。', 409);
          selected.push({ item, course });
        }
        const result: D.PublishedCandidateRead[] = [];
        for (const { item, course } of selected) {
          const source = find(course.id), settings = item.snapshot.settings as D.CourseSettings;
          Object.assign(source, legacySettings(settings), { status: 'published', has_published_content: true, course_code: source.course_code || `ASTRA${course.id}` });
          source.information_revision.status = 'approved'; source.information_revision.information_snapshot = legacySettings(settings);
          const revision = course.revisions.find((revision) => revision.summary.id === item.revision_id)!;
          const released = store.publish(source, { course_id: course.id, revision: revision.summary.revision_number, status: 'published', title: settings.title, summary: settings.summary || null, units: item.snapshot.units.map((unit) => ({ ...unit, content: copy(unit.content) as T.ContentPage })) });
          course.releases.set(released.id, copy(item.snapshot)); item.published_release_id = released.id;
          for (const [unit, policy] of Object.entries(item.result_policies)) if (policy === 'redo') store.resetResult(course.id, Number(unit));
          if (course.revision === revision.summary.revision_number) { course.revision++; course.units.forEach((unit) => { unit.revision = course.revision; }); const working = store.drafts.get(course.id)!; working.revision = course.revision; await capture(course); }
          const release: D.CourseReleaseRead = { ...released, schema_version: 'astra-course-release-v3', published_by_user_id: 1, units: released.units.map((unit) => ({ ...unit, content_slug: unit.content.slug, content_page_version_id: unit.id, content: { ...unit.content } })) };
          result.push({ course_id: course.id, candidate_id: item.candidate_id, release, binding: { id: store.nextId(), course_class_id: 1, course_release_id: release.id, binding_revision: release.release_number, bound_by_user_id: 1, bound_at: release.published_at }, next_draft_revision: course.revision });
        }
        return { items: result };
      });
    },
    async restore(id, input) {
      requireRole('teacher');
      return write('course.restore', input.client_request_id, { id, ...input }, async () => { const course = await load(id), previous = course.releases.get(input.release_id); if (!previous || course.revision !== input.expected_revision || await snapshotHash(snapshot(course)) !== input.expected_state_token) throw new ApiError('版本或草稿已经变化。', 409); await saveState(course, previous.settings as D.CourseSettings, previous.units.map((unit) => ({ id: unit.id, activity_key: unit.activity_key, title: unit.title, position: unit.position, resource_version_id: unit.resource_version_id, content: unit.content! }))); return draft(course); });
    },
    async receipt(key) { const receipt = receipts.get(`${role()}:${key}`); if (!receipt) throw new ApiError('尚未找到成功回执。', 404); return { client_request_id: key, operation_kind: receipt.kind, response: copy(receipt.result) as Record<string, unknown> }; },
    async media(id, offset = 0) { requireRole('teacher', 'admin'); return paginate([...media.values()].filter((item) => item.courses.has(id)).map((item) => item.meta), offset); },
    async upload(id, file, key) {
      requireRole('teacher');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, '0')).join('');
      return write('course.media.upload', key, { id, name: file.name, size: file.size, type: file.type, digest }, async () => {
        if (!file.size || file.size > 12 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm', 'application/pdf'].includes(file.type)) throw new ApiError('请选择不超过 12 MiB 的受支持素材。', 422);
        const asset_key = `asset.${crypto.randomUUID()}`, type = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('video') ? 'video' : 'document';
        const meta: D.CourseMediaRead = { asset_key, source_course_id: id, filename: file.name, media_type: type, content_type: file.type, size_bytes: file.size, content_sha256: digest, created_at: now() };
        media.set(asset_key, { meta, url: URL.createObjectURL(file), courses: new Set([id]) }); return meta;
      });
    },
    mediaUrl(id, key) { const item = media.get(key); if (!item?.courses.has(id)) throw new ApiError('素材不可用。', 404); return item.url; },
  };
  return gateway;
}

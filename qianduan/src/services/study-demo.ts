import type * as D from '../portal/study-types';
import type * as T from '../portal/contracts';
import type { ResourceGateway } from '../portal/resource-types';
import type { DemoTeachingStore } from './school-demo';
import { ApiError } from './http-client.ts';
import { snapshotHash, stableJson } from '../domain/course-sync.ts';

const copy = <V>(value: V): V => structuredClone(value);
const now = () => new Date().toISOString();
const last = <V>(items: V[], predicate: (value: V) => boolean): V | undefined => {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return items[index];
};
const page = <V>(items: V[], offset = 0, limit = 20) => ({
  items: copy(items.slice(offset, offset + limit)),
  total: items.length,
  offset,
  limit,
  next_offset: offset + limit < items.length ? offset + limit : null,
});

/** Static demonstration only: all answers and history live in this tab's memory. */
export function createStudyDemo(
  role: () => T.Role,
  store: DemoTeachingStore,
  school: T.SchoolGateway,
  resources: ResourceGateway,
): D.StudyGateway {
  const contexts = new Map<string, D.LearningContextRead>();
  const attempts: D.AssignmentAttemptRead[] = [],
    grades: D.AssignmentGradeRead[] = [];
  const results: (D.LearningHistoryItem & {
    courseId: number;
    complete: boolean;
    attemptId?: number;
    gradeId?: number;
  })[] = [];
  const receipts = new Map<string, { hash: string; result: unknown }>();
  const runs = new Map<string, { context: string; sequence: number; serverSequence: number; completed: boolean }>();
  const userId = () => (role() === 'student' ? 2 : role() === 'teacher' ? 1 : 3);
  const requireRole = (...allowed: T.Role[]) => {
    if (!allowed.includes(role())) throw new ApiError('当前演示身份不能执行此操作。', 403);
  };
  const write = async <V>(kind: string, key: string, body: object, perform: () => Promise<V>): Promise<V> => {
    const id = `${userId()}:${key}`,
      hash = stableJson({ kind, body }),
      old = receipts.get(id);
    if (old) {
      if (old.hash !== hash) throw new ApiError('请求编号已对应其他内容。', 409);
      return copy(old.result) as V;
    }
    const result = await perform();
    receipts.set(id, { hash, result: copy(result) });
    return copy(result);
  };
  const releaseFor = (context: D.LearningContextRead) =>
    store.releases.get(context.course_id!)?.find((item) => item.id === context.course_release_id);
  const courseAccess = (id: number) => {
    const course = store.courses.find((item) => item.id === id);
    if (!course) throw new ApiError('课程不存在。', 404);
    if (role() === 'student' && !course.active_student_count) throw new ApiError('请先加入课程。', 403);
    return course;
  };
  const contextAccess = (key: string) => {
    const item = contexts.get(key);
    if (!item || item.user_id !== userId()) throw new ApiError('学习入口不存在。', 404);
    if (item.course_id) courseAccess(item.course_id);
    return item;
  };
  const crossedRedo = (courseId: number, unitId: number, source: number | null, target?: number) => {
    const all = store.releases.get(courseId) || [],
      before = all.findIndex((item) => item.id === source),
      end = target === undefined ? all.length - 1 : all.findIndex((item) => item.id === target);
    return all
      .slice(before + 1, end + 1)
      .some(
        (item) =>
          store.resultPolicies.get(item.id)?.[unitId] === 'redo' ||
          !item.units.some((unit) => unit.source_course_unit_id === unitId),
      );
  };
  const resultValid = (row: (typeof results)[number]) => {
    if (!row.attemptId) return true;
    const attempt = attempts.find((item) => item.id === row.attemptId)!;
    return (
      last(grades, (item) => item.attempt_id === attempt.id)?.id === row.gradeId &&
      !attempts.some(
        (item) =>
          item.submission_id === attempt.submission_id &&
          item.course_release_id === attempt.course_release_id &&
          item.attempt_number > attempt.attempt_number,
      )
    );
  };
  const credit = (row: (typeof results)[number]) =>
    row.complete && resultValid(row) && !crossedRedo(row.courseId, row.course_unit_id, row.source_release_id);
  const refresh = (courseId: number, unitId: number) =>
    store.setResult(
      courseId,
      unitId,
      results.some((row) => row.courseId === courseId && row.course_unit_id === unitId && credit(row)),
    );
  const canResubmit = (head: T.Submission | undefined, context: D.LearningContextRead) => {
    if (!head) return true;
    const same = last(
      attempts,
      (item) => item.submission_id === head.id && item.course_release_id === context.course_release_id,
    );
    if (same) return last(grades, (item) => item.attempt_id === same.id)?.status === 'returned';
    const previous = attempts.find((item) => item.id === head.current_attempt_id);
    const all = store.releases.get(context.course_id!) || [];
    return (
      all.findIndex((item) => item.id === previous?.course_release_id) >
        all.findIndex((item) => item.id === context.course_release_id) ||
      head.status === 'returned' ||
      crossedRedo(
        context.course_id!,
        context.course_unit_id!,
        previous?.course_release_id || null,
        context.course_release_id!,
      )
    );
  };
  const api: D.StudyGateway = {
    async start(input) {
      if (input.mode === 'formal') requireRole('student');
      else if (input.mode === 'preview') requireRole('teacher', 'admin');
      return write('context', input.client_request_id, input, async () => {
        const released =
          input.mode === 'formal' ? (await school.currentRelease(input.course_id!)).release : null;
        if (released && released.id !== input.expected_release_id)
          throw new ApiError('课程已有新版本，请重新进入。', 409);
        const unit = released?.units.find((item) => item.source_course_unit_id === input.course_unit_id);
        if (released && (!unit || unit.access_state === 'locked')) throw new ApiError('单元尚未开放。', 403);
        const assignment = input.assignment_id
          ? store.assignments.find(
              (item) => item.id === input.assignment_id && item.unit_id === unit?.source_course_unit_id,
            )
          : null;
        if (input.assignment_id && !assignment) throw new ApiError('作业不在当前单元。', 404);
        const resourceId =
          input.resource_version_id ||
          unit?.content.blocks.find((block) => block.type === 'resource')?.resourceVersionId ||
          null;
        const result: D.LearningContextRead = {
          context_key: crypto.randomUUID(),
          mode: input.mode,
          user_id: userId(),
          course_id: released?.course_id || null,
          course_unit_id: unit?.source_course_unit_id || null,
          class_id: released ? 1 : null,
          course_release_id: released?.id || null,
          release_number: released?.release_number || null,
          release_unit_id: unit?.id || null,
          published_at: released?.published_at || null,
          activity_key: unit?.activity_key || null,
          content_schema_sha256: unit?.content_schema_sha256 || null,
          resource_version_id: resourceId,
          assignment_id: assignment?.id || null,
          assignment: assignment ? (copy(assignment) as unknown as Record<string, unknown>) : null,
          created_at: now(),
          course_title: released?.title || null,
          unit_title: unit?.title || null,
          content: unit ? (copy(unit.content) as unknown as Record<string, unknown>) : null,
          resources: resourceId ? [await resources.version(resourceId)] : [],
          newer_release_available: false,
          records_course_results: input.mode === 'formal',
        };
        contexts.set(result.context_key, copy(result));
        return result;
      });
    },
    async context(key) {
      const result = copy(contextAccess(key));
      result.newer_release_available = Boolean(
        result.course_id && store.releases.get(result.course_id)?.at(-1)?.id !== result.course_release_id,
      );
      return result;
    },
    async contexts(courseId) {
      requireRole('student');
      courseAccess(courseId);
      return [...contexts.values()]
        .filter((row) => row.user_id === userId() && row.course_id === courseId && !row.assignment_id)
        .reverse()
        .slice(0, 20)
        .map((row) => ({
          context_key: row.context_key,
          course_id: courseId,
          course_unit_id: row.course_unit_id!,
          course_release_id: row.course_release_id!,
          release_number: row.release_number!,
          unit_title: row.unit_title!,
          created_at: row.created_at,
          is_current: store.releases.get(courseId)?.at(-1)?.id === row.course_release_id,
        }));
    },
    async checkpoint(key, checkpoint, input) {
      requireRole('student');
      const context = contextAccess(key);
      return write('checkpoint', input.client_attempt_id, { key, checkpoint, ...input }, async () => {
        const unit = releaseFor(context)?.units.find(
            (item) => item.source_course_unit_id === context.course_unit_id,
          ),
          block = unit?.content.blocks.find((item) => item.checkpointKey === checkpoint);
        if (!block || context.mode !== 'formal') throw new ApiError('不能在这个学习入口交题。', 403);
        const previous = results.filter(
          (row) =>
            row.courseId === context.course_id &&
            row.course_unit_id === context.course_unit_id &&
            row.source_release_id === context.course_release_id &&
            row.kind === 'checkpoint' &&
            row.prompt === block.prompt,
        );
        if (block.maxAttempts && previous.length >= block.maxAttempts)
          throw new ApiError('尝试次数已用完。', 409);
        const correct =
          block.responseType === 'numeric'
            ? Math.abs(Number(input.numeric_answer) - Number(block.numericAnswer)) <= (block.tolerance || 0)
            : block.responseType === 'short-text'
              ? (block.acceptedAnswers || []).includes(input.text_answer || '')
              : stableJson([...(input.selected_choice_ids || [])].sort()) ===
                stableJson([...(block.correctChoiceIds || [])].sort());
        const completion = unit!.content.courseUnit?.completion,
          complete =
            correct && completion?.preset === 'checkpoint_passed' && completion.checkpointKey === checkpoint;
        const id = store.nextId(),
          time = now();
        const row: (typeof results)[number] = {
          result_id: id,
          student_id: 2,
          course_unit_id: context.course_unit_id!,
          title: context.unit_title!,
          kind: 'checkpoint',
          source_release_id: context.course_release_id,
          source_release_number: context.release_number,
          current_credit: false,
          recognized: false,
          valid: true,
          is_correct: correct,
          score: null,
          max_score: null,
          feedback: null,
          feedback_retained: true,
          response: { answer: input.numeric_answer ?? input.text_answer ?? input.selected_choice_ids },
          prompt: block.prompt || null,
          choices: block.choices || [],
          occurred_at: time,
          provenance: 'static-demonstration',
          courseId: context.course_id!,
          complete,
        };
        results.push(row);
        refresh(row.courseId, row.course_unit_id);
        return {
          id,
          client_attempt_id: input.client_attempt_id,
          course_release_id: context.course_release_id!,
          course_unit_id: context.course_unit_id!,
          checkpoint_key: checkpoint,
          attempt_number: previous.length + 1,
          is_correct: correct,
          completed: complete,
          remaining_attempts: block.maxAttempts ? Math.max(0, block.maxAttempts - previous.length - 1) : null,
          replayed: false,
          submitted_at: time,
          context_key: key,
          result_id: id,
          current_version_completed: results.some(
            (item) =>
              item.courseId === row.courseId && item.course_unit_id === row.course_unit_id && credit(item),
          ),
        };
      });
    },
    async openAssignment(id, input) {
      requireRole('student');
      const assignment = store.assignments.find((item) => item.id === id),
        course = store.courses.find((item) =>
          store.drafts.get(item.id)?.units.some((unit) => unit.id === assignment?.unit_id),
        );
      if (!assignment || !course) throw new ApiError('作业不存在。', 404);
      courseAccess(course.id);
      let context = [...contexts.values()].find(
        (item) =>
          item.assignment_id === id &&
          item.context_key === receipts.get(`open:${input.client_request_id}`)?.result,
      );
      if (!context) {
        context = await api.start({
          client_request_id: input.client_request_id,
          mode: 'formal',
          course_id: course.id,
          course_unit_id: assignment.unit_id,
          expected_release_id: store.releases.get(course.id)?.at(-1)?.id,
          assignment_id: id,
        });
        receipts.set(`open:${input.client_request_id}`, { hash: String(id), result: context.context_key });
      }
      context = await api.context(context.context_key);
      const head = store.submissions.find((item) => item.assignment_id === id && item.student_id === 2),
        attempt =
          last(
            attempts,
            (item) => item.submission_id === head?.id && item.course_release_id === context.course_release_id,
          ) || null,
        grade = last(grades, (item) => item.attempt_id === attempt?.id) || null;
      const reason =
        assignment.status !== 'active'
          ? '作业已关闭，可查看提交记录。'
          : !canResubmit(head, context)
            ? '已有提交，等待教师评阅或新版补做安排。'
            : null;
      return copy({
        assignment_id: id,
        course_id: course.id,
        course_unit_id: assignment.unit_id,
        class_id: 1,
        context,
        assignment: context.assignment!,
        assignment_sha256: await snapshotHash(context.assignment!),
        submission_id: head?.id || null,
        submission_revision: head?.revision || 0,
        attempt,
        grade,
        can_submit: !reason,
        submit_block_reason: reason,
      });
    },
    async submit(id, input) {
      requireRole('student');
      const context = contextAccess(input.context_key!);
      return write('submit', input.client_request_id, { id, ...input }, async () => {
        const assignment = store.assignments.find((item) => item.id === id);
        if (!assignment || context.assignment_id !== id || assignment.status !== 'active')
          throw new ApiError('当前不能提交这份作业。', 409);
        let head = store.submissions.find((item) => item.assignment_id === id && item.student_id === 2);
        if ((head?.revision || 0) !== input.expected_submission_revision || !canResubmit(head, context))
          throw new ApiError('提交或评阅状态已变化，请重新读取。', 409);
        if (!Object.values(input.content).some((value) => String(value).trim()))
          throw new ApiError('请填写回答。', 422);
        if (!head) {
          head = {
            id: store.nextId(),
            assignment_id: id,
            student_id: 2,
            class_id: 1,
            content: {},
            status: 'submitted',
            score: null,
            feedback: null,
            submitted_at: now(),
            graded_at: null,
            revision: 0,
          };
          store.submissions.push(head);
        }
        const old = attempts.find((item) => item.id === head!.current_attempt_id),
          all = store.releases.get(context.course_id!)!;
        const current =
          !old ||
          all.findIndex((item) => item.id === old.course_release_id) <=
            all.findIndex((item) => item.id === context.course_release_id);
        head.revision = (head.revision || 0) + 1;
        const attempt: D.AssignmentAttemptRead = {
          id: store.nextId(),
          submission_id: head.id,
          submission_revision: head.revision,
          assignment_id: id,
          student_id: 2,
          class_id: 1,
          course_id: context.course_id!,
          course_unit_id: context.course_unit_id!,
          course_release_id: context.course_release_id,
          release_number: context.release_number,
          context_key: context.context_key,
          attempt_number: attempts.filter((item) => item.submission_id === head!.id).length + 1,
          content: copy(input.content),
          assignment_snapshot: copy(context.assignment!),
          provenance: 'static-demonstration',
          submitted_at: now(),
        };
        attempts.push(attempt);
        if (current)
          Object.assign(head, {
            current_attempt_id: attempt.id,
            current_grade_revision: 0,
            content: copy(input.content),
            status: 'submitted',
            score: null,
            feedback: null,
            submitted_at: attempt.submitted_at,
            graded_at: null,
          });
        refresh(attempt.course_id, attempt.course_unit_id);
        return attempt;
      });
    },
    async grade(id, input) {
      requireRole('teacher', 'admin');
      return write('grade', input.client_request_id, { id, ...input }, async () => {
        const attempt = attempts.find((item) => item.id === id),
          head = store.submissions.find((item) => item.id === attempt?.submission_id);
        if (!attempt || !head) throw new ApiError('提交不存在。', 404);
        const latest = last(grades, (item) => item.attempt_id === id),
          current = head.current_attempt_id === id,
          maximum = Number(attempt.assignment_snapshot.max_score);
        if (
          head.revision !== input.expected_submission_revision ||
          (latest?.revision || 0) !== input.expected_grade_revision ||
          (!current && !input.allow_historical)
        )
          throw new ApiError('提交或评分已更新，请重新读取。', 409);
        if (
          (input.status === 'graded' && input.score == null) ||
          (input.score != null && (input.score < 0 || input.score > maximum)) ||
          (input.status === 'returned' && !input.feedback?.trim())
        )
          throw new ApiError('请核对分数，并填写退回原因。', 422);
        const oldPoints = grades
          .filter(
            (item) => attempts.find((attempt) => attempt.id === item.attempt_id)?.submission_id === head.id,
          )
          .reduce((sum, item) => sum + (item.point_delta || 0), 0);
        head.revision++;
        const grade: D.AssignmentGradeRead = {
          id: store.nextId(),
          attempt_id: id,
          revision: (latest?.revision || 0) + 1,
          submission_revision: head.revision,
          status: input.status,
          score: input.score ?? null,
          max_score: maximum,
          feedback: input.feedback || null,
          graded_by_user_id: userId(),
          graded_at: now(),
          recorded_at: now(),
          feedback_retained: true,
          provenance: 'static-demonstration',
          point_delta: current ? (input.status === 'graded' ? input.score! : 0) - oldPoints : 0,
        };
        grades.push(grade);
        if (current)
          Object.assign(head, {
            status: grade.status,
            score: grade.score,
            feedback: grade.feedback,
            graded_at: grade.graded_at,
            current_grade_revision: grade.revision,
          });
        const release = store.releases
            .get(attempt.course_id)!
            .find((item) => item.id === attempt.course_release_id)!,
          unit = release.units.find((item) => item.source_course_unit_id === attempt.course_unit_id)!,
          completion = unit.content.courseUnit?.completion;
        const complete =
          completion?.assignmentId === attempt.assignment_id &&
          (completion.preset === 'assignment_reviewed' ||
            (completion.preset === 'assignment_accepted' && grade.status === 'graded'));
        results.push({
          result_id: store.nextId(),
          student_id: 2,
          course_unit_id: attempt.course_unit_id,
          title: unit.title,
          kind: 'assignment',
          source_release_id: release.id,
          source_release_number: release.release_number,
          current_credit: false,
          recognized: false,
          valid: true,
          is_correct: null,
          score: grade.score,
          max_score: maximum,
          feedback: grade.feedback,
          feedback_retained: true,
          response: copy(attempt.content),
          prompt: String(attempt.assignment_snapshot.description || ''),
          choices: [],
          occurred_at: grade.recorded_at,
          provenance: 'static-demonstration',
          courseId: attempt.course_id,
          complete,
          attemptId: id,
          gradeId: grade.id,
        });
        refresh(attempt.course_id, attempt.course_unit_id);
        return grade;
      });
    },
    async activityConfig(key) {
      requireRole('student');
      const context = contextAccess(key), unit = releaseFor(context)?.units.find((item) => item.source_course_unit_id === context.course_unit_id);
      if (!unit || context.mode !== 'formal') throw new ApiError('正式运行需要课程学习入口。', 403);
      const blocks: D.ContextActivityBlockRead[] = [];
      for (const block of unit.content.blocks) {
        if (block.type !== 'resource' || !block.resourceVersionId) continue;
        const version = await resources.version(block.resourceVersionId), caps = version.capabilities;
        if (caps.operation_recording !== true) continue;
        const adapter = caps.observation_adapter;
        if (adapter !== 'function-parameters-v1' && adapter !== 'numeric-controls-v1') continue;
        const controls = adapter === 'function-parameters-v1' ? (block.configuration as { parameters?: D.ContextActivityControlRead[] })?.parameters || [] : caps.controls as D.ContextActivityControlRead[];
        blocks.push({ block_id: block.blockId, resource_version_id: version.id, adapter, entry: typeof version.definition.entry === 'string' ? version.definition.entry : null, controls: copy(controls) });
      }
      return { context_key: key, scope: { class_id: context.class_id!, course_id: context.course_id!, course_unit_id: context.course_unit_id!, activity_key: context.activity_key! }, subject_identity: { kind: 'learner', id: String(userId()) }, manifest_version: 'astra-context-activity-v1', content_version: context.content_schema_sha256!, event_schema_version: 1, rule_version: 1, generation: key, state_schema_version: 'astra-observation-state-v1', blocks };
    },
    async activityEvent(key, body) {
      requireRole('student'); const context = contextAccess(key), config = await api.activityConfig(key);
      return write('activity-event', body.command.client_event_id, { key, body }, async () => {
        const command = body.command, identity = `${command.run.run_id}:${command.run.group_id}`, old = runs.get(identity);
        if (stableJson(command.scope) !== stableJson(config.scope) || command.versions.generation !== key || command.versions.content_version !== config.content_version || old && old.context !== key) throw new ApiError('运行与原学习版本不一致。', 409);
        if (command.run.sequence !== (old?.sequence || 0) + 1 || body.snapshot.applied_through_learner_sequence !== command.run.sequence) throw new ApiError('操作序号已变化，请使用原编号重试。', 409);
        const observation = command.evidence?.cursor as { block_id: string; parameter: string; value: number } | undefined;
        if (command.event_type === 'attempted') {
          const control = config.blocks.find((block) => block.block_id === observation?.block_id)?.controls.find((item) => item.key === observation?.parameter);
          if (!control || !Number.isFinite(observation?.value) || observation!.value < control.minimum || observation!.value > control.maximum || stableJson(body.snapshot.data?.last_observation) !== stableJson(observation)) throw new ApiError('参数观察超出该发布允许范围。', 422);
        } else if (command.event_type !== 'started' || body.snapshot.data?.last_observation !== null) throw new ApiError('此演示运行只记录参数观察。', 422);
        const runtime = old || { context: key, sequence: 0, serverSequence: 0, completed: false };
        runtime.sequence = command.run.sequence; runtime.serverSequence++;
        const serverSequence = runtime.serverSequence;
        const unit = releaseFor(context)!.units.find((item) => item.source_course_unit_id === context.course_unit_id)!;
        const complete = command.event_type === 'attempted' && unit.content.courseUnit?.completion?.preset === 'experiment_operation' && !runtime.completed;
        if (complete) { runtime.completed = true; runtime.serverSequence++; }
        const resultId = store.nextId();
        results.push({ result_id: resultId, student_id: userId(), course_unit_id: context.course_unit_id!, title: unit.title, kind: 'activity', source_release_id: context.course_release_id, source_release_number: context.release_number, current_credit: false, recognized: false, valid: true, is_correct: null, score: null, max_score: null, feedback: null, feedback_retained: true, response: observation ? { parameter: observation.parameter, value: observation.value } : { state: '开始记录' }, prompt: null, choices: [], occurred_at: command.occurred_at, provenance: 'static-demonstration', courseId: context.course_id!, complete });
        runs.set(identity, runtime); refresh(context.course_id!, context.course_unit_id!);
        return { status: 'confirmed', client_event_id: command.client_event_id, event_type: command.event_type, run_id: command.run.run_id, group_id: command.run.group_id, learner_sequence: command.run.sequence, server_sequence: serverSequence, server_last_sequence: runtime.serverSequence, server_event_id: `demo-event:${resultId}` };
      });
    },
    async activityRecovery(key, identity) {
      contextAccess(key);
      // The static site deliberately has no durable server-side run recovery.
      return { schema_version: 'astra-learning-activity-server-recovery-v2', consumer_schema_version: 'astra-learning-activity-recovery-v2', exact_available: false, manual_intervention_required: false, reason: 'static_demonstration_has_no_durable_recovery', captured_at: now(), identity, client_pending_status: 'unknown' };
    },
    async submissionHistory(id, offset = 0) {
      const head = store.submissions.find((item) => item.id === id);
      if (!head || (role() === 'student' && head.student_id !== userId()))
        throw new ApiError('记录不存在。', 404);
      const list = page(attempts.filter((item) => item.submission_id === id).reverse(), offset);
      return {
        submission_id: id,
        revision: head.revision!,
        current_attempt_id: head.current_attempt_id || null,
        attempts: list.items,
        grades: copy(
          grades.filter((item) => list.items.some((attempt) => attempt.id === item.attempt_id)).reverse(),
        ),
        total: list.total,
        offset,
        limit: list.limit,
        next_offset: list.next_offset,
      };
    },
    async history(id, offset = 0) {
      courseAccess(id);
      const current = store.releases.get(id)?.at(-1),
        rows = results
          .filter((item) => item.courseId === id)
          .map((row) => {
            const { courseId: _, complete: _complete, attemptId: _attempt, gradeId: _grade, ...item } = row;
            return {
              ...item,
              valid: resultValid(row),
              current_credit: credit(row),
              recognized: credit(row) && row.source_release_id !== current?.id,
            };
          });
      return {
        ...page(rows.reverse(), offset, 25),
        current_release_id: current?.id || null,
        current_release_number: current?.release_number || null,
        current_completed_units: [
          ...new Set(rows.filter((row) => row.current_credit).map((row) => row.course_unit_id)),
        ],
        can_read_course: true,
      };
    },
  };
  return api;
}

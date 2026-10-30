/*
 * Formal code-submission adapter.
 *
 * Code Space's student-context bootstrap supplies the current
 * cookie-authenticated scope without copying authentication logic:
 *
 * window.AstraCodeSpaceStudentContext = {
 *   resolve({ galaxy_key, course_key, activity_key }) {
 *     return { authenticated: true, role: 'student', class_id: 12, course_id: 34 };
 *   }
 * };
 *
 * An absent, malformed, or unavailable host context intentionally disables
 * formal submission. Browser preview remains local learning feedback only.
 */
(function (global) {
    'use strict';

    const submissionStatuses = new Set([
        'queued', 'runner_unavailable', 'running', 'accepted', 'wrong_answer',
        'partial', 'compile_error', 'runtime_error', 'time_limit', 'memory_limit',
        'output_limit', 'internal_error', 'cancelled'
    ]);
    const enterableCourseStates = new Set(['available', 'completed']);
    const languagePattern = /^(javascript|python|c|cpp)$/;
    const pendingStatuses = new Set(['queued', 'running']);
    const submissionPollMinWindowMs = 5000;
    const submissionPollMaxWindowMs = 35000;
    const submissionPollQueueAllowanceMs = 3000;
    const submissionPollIntervalMs = 1000;
    const submissionPollMaxAttempts = 36;

    function unavailable(reason, code) {
        return { available: false, reason, code: code || 'unavailable' };
    }

    function positiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    function courseState(activity) {
        const adapter = global.CvCourseStateAdapter;
        if (!adapter || typeof adapter.resolve !== 'function') {
            return unavailable('此活动当前不可正式提交。', 'course_state_unavailable');
        }
        try {
            const state = adapter.resolve(activity);
            if (!state || !enterableCourseStates.has(state.status)) {
                return unavailable('此活动当前不可正式提交。', 'course_state_closed');
            }
        } catch (_) {
            return unavailable('此活动当前不可正式提交。', 'course_state_unavailable');
        }
        return { available: true };
    }

    function contextFor(activity) {
        const adapter = global.AstraCodeSpaceStudentContext;
        if (!adapter || typeof adapter.resolve !== 'function') {
            return unavailable('请先在已登录的课程中选择班级后再正式提交。', 'context_unavailable');
        }
        let context;
        try {
            context = adapter.resolve({
                galaxy_key: activity.galaxy_key,
                course_key: activity.course_key,
                activity_key: activity.activity_key
            });
        } catch (_) {
            return unavailable('请先在已登录的课程中选择班级后再正式提交。', 'context_unavailable');
        }
        if (!context || context.authenticated !== true || context.role !== 'student') {
            return unavailable('请先登录学生账号后再正式提交。', 'not_authenticated');
        }
        if (!positiveInteger(context.class_id) || !positiveInteger(context.course_id)) {
            return unavailable('请先进入已分配班级的课程后再正式提交。', 'scope_unavailable');
        }
        return {
            available: true,
            context: { class_id: context.class_id, course_id: context.course_id }
        };
    }

    function availability(activity) {
        if (!activity || typeof activity !== 'object' || !languagePattern.test(activity.language || '')) {
            return unavailable('此活动当前不可正式提交。', 'activity_invalid');
        }
        const state = courseState(activity);
        if (!state.available) return state;
        const context = contextFor(activity);
        if (!context.available) return context;
        if (!global.AstraApiClient || typeof global.AstraApiClient.request !== 'function') {
            return unavailable('正式提交服务暂不可用。', 'api_unavailable');
        }
        return context;
    }

    function validProblem(problem, context, activity) {
        if (!problem || typeof problem !== 'object') return false;
        const version = problem.active_version;
        return positiveInteger(problem.id) &&
            positiveInteger(problem.course_id) && problem.course_id === context.course_id &&
            typeof problem.activity_key === 'string' && problem.activity_key === activity.activity_key &&
            problem.effective_release_state === 'open' &&
            version && typeof version === 'object' && positiveInteger(version.id) &&
            Array.isArray(version.language_allowlist) &&
            version.language_allowlist.includes(activity.language);
    }

    function validSubmission(submission, problem, context, activity) {
        return !!submission && typeof submission === 'object' &&
            positiveInteger(submission.id) &&
            submission.problem_id === problem.id &&
            submission.course_id === context.course_id &&
            submission.class_id === context.class_id &&
            submission.activity_key === activity.activity_key &&
            submission.language === activity.language &&
            submissionStatuses.has(submission.status) &&
            submission.result_summary && typeof submission.result_summary === 'object' && !Array.isArray(submission.result_summary) &&
            (submission.idempotent_replay === undefined || typeof submission.idempotent_replay === 'boolean');
    }

    function resultMessage(status) {
        const labels = {
            queued: '权威状态：已进入判题队列。',
            runner_unavailable: '权威状态：判题器暂不可用，尚未判定通过。',
            running: '权威状态：正在判题。',
            accepted: '权威状态：通过。',
            wrong_answer: '权威状态：结果未通过。',
            partial: '权威状态：部分通过。',
            compile_error: '权威状态：编译未通过。',
            runtime_error: '权威状态：运行未通过。',
            time_limit: '权威状态：超出时间限制。',
            memory_limit: '权威状态：超出内存限制。',
            output_limit: '权威状态：输出超过限制。',
            internal_error: '权威状态：暂时无法完成判题。',
            cancelled: '权威状态：判题已取消。'
        };
        return labels[status] || '权威状态暂不可用。';
    }

    function requestFailure(error) {
        const status = Number(error && error.status || 0);
        if (status === 401) return unavailable('请先登录学生账号后再正式提交。', 'unauthorized');
        if (status === 403) return unavailable('此活动当前不可正式提交。', 'forbidden');
        if (status === 409) return unavailable('课程状态或提交内容已变化，请刷新后再试。', 'conflict');
        if (status === 422) return unavailable('提交未通过服务端校验，尚未进入判题。', 'validation');
        if (status === 404) return unavailable('此活动当前不可正式提交。', 'problem_unavailable');
        if (status >= 500) return unavailable('正式提交服务暂不可用。', 'service_unavailable');
        if (global.AstraApiClient && global.AstraApiClient.isAmbiguousMutation && global.AstraApiClient.isAmbiguousMutation(error)) {
            return unavailable('提交结果尚未确认，未显示为成功。请刷新后核对。', 'submission_unconfirmed');
        }
        if (global.AstraApiClient && global.AstraApiClient.isCancelled && global.AstraApiClient.isCancelled(error)) {
            return unavailable('本次提交已取消，未确认进入判题。', 'cancelled');
        }
        return unavailable('无法连接判题服务，未提交成功。', 'network');
    }

    function submissionResult(submission, canRetry) {
        return {
            ok: true,
            status: submission.status,
            reason: resultMessage(submission.status) + (canRetry ? ' 本页查询窗口已结束；你可以再次查询最新权威状态。' : ''),
            submission_id: submission.id,
            problem_id: submission.problem_id,
            can_retry: canRetry === true,
            idempotent_replay: submission.idempotent_replay === true
        };
    }

    function pollPlan(problem) {
        const rawWallTimeMs = problem && problem.active_version && problem.active_version.resource_policy &&
            problem.active_version.resource_policy.wall_time_ms;
        const wallTimeMs = Number.isSafeInteger(rawWallTimeMs) && rawWallTimeMs > 0 ? rawWallTimeMs : 0;
        const requestedWindowMs = wallTimeMs ? wallTimeMs + submissionPollQueueAllowanceMs : submissionPollMinWindowMs;
        const windowMs = Math.max(submissionPollMinWindowMs, Math.min(submissionPollMaxWindowMs, requestedWindowMs));
        return {
            windowMs,
            maxAttempts: Math.min(submissionPollMaxAttempts, Math.max(1, Math.ceil(windowMs / submissionPollIntervalMs)))
        };
    }

    function waitForPoll(signal, delayMs) {
        if (signal && signal.aborted) return Promise.reject({ code: 'cancelled' });
        return new Promise((resolve, reject) => {
            let timer = null;
            const onAbort = () => {
                if (timer !== null) global.clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                reject({ code: 'cancelled' });
            };
            timer = global.setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, delayMs);
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    async function pollSubmission(api, submission, problem, context, activity, signal) {
        let current = submission;
        let attempts = 0;
        const plan = pollPlan(problem);
        const deadline = Date.now() + plan.windowMs;
        while (pendingStatuses.has(current.status) && attempts < plan.maxAttempts && Date.now() < deadline) {
            attempts++;
            await waitForPoll(signal, Math.min(submissionPollIntervalMs, Math.max(1, deadline - Date.now())));
            const refreshed = await api.request('/api/code-submissions/' + encodeURIComponent(String(current.id)), {
                method: 'GET',
                dispatchAuthRequired: false,
                signal
            });
            if (!validSubmission(refreshed, problem, context, activity)) {
                return { ok: false, ...unavailable('提交结果无法确认，未显示为成功。', 'submission_invalid') };
            }
            current = refreshed;
        }
        return submissionResult(current, pendingStatuses.has(current.status));
    }

    async function refresh(activity, record, options) {
        const ready = availability(activity);
        if (!ready.available) return { ok: false, ...ready };
        if (!record || !positiveInteger(record.submission_id) || !positiveInteger(record.problem_id)) {
            return { ok: false, ...unavailable('提交结果无法确认，未显示为成功。', 'submission_invalid') };
        }
        const api = global.AstraApiClient;
        const problem = { id: record.problem_id };
        try {
            const submission = await api.request('/api/code-submissions/' + encodeURIComponent(String(record.submission_id)), {
                method: 'GET',
                dispatchAuthRequired: false,
                signal: options && options.signal
            });
            if (!validSubmission(submission, problem, ready.context, activity)) {
                return { ok: false, ...unavailable('提交结果无法确认，未显示为成功。', 'submission_invalid') };
            }
            return await pollSubmission(api, submission, problem, ready.context, activity, options && options.signal);
        } catch (error) {
            return { ok: false, ...requestFailure(error) };
        }
    }

    async function submit(activity, sourceCode, options) {
        const ready = availability(activity);
        if (!ready.available) return { ok: false, ...ready };
        if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
            return { ok: false, ...unavailable('请先编写代码再正式提交。', 'source_empty') };
        }
        const api = global.AstraApiClient;
        try {
            const problem = await api.request('/api/code-problems/by-activity', {
                method: 'GET',
                params: {
                    course_id: ready.context.course_id,
                    activity_key: activity.activity_key,
                    class_id: ready.context.class_id
                },
                dispatchAuthRequired: false,
                signal: options && options.signal
            });
            if (!validProblem(problem, ready.context, activity)) {
                return { ok: false, ...unavailable('此活动当前不可正式提交。', 'problem_unavailable') };
            }
            const submission = await api.request('/api/code-problems/' + encodeURIComponent(String(problem.id)) + '/submissions', {
                method: 'POST',
                body: {
                    class_id: ready.context.class_id,
                    language: activity.language,
                    source_code: sourceCode,
                    stdin: ''
                },
                dispatchAuthRequired: false,
                signal: options && options.signal
            });
            if (!validSubmission(submission, problem, ready.context, activity)) {
                return { ok: false, ...unavailable('提交结果无法确认，未显示为成功。', 'submission_invalid') };
            }
            return await pollSubmission(api, submission, problem, ready.context, activity, options && options.signal);
        } catch (error) {
            return { ok: false, ...requestFailure(error) };
        }
    }

    global.CvSubmissionAdapter = Object.freeze({
        contract: Object.freeze({
            context_adapter: 'AstraCodeSpaceStudentContext.resolve({ galaxy_key, course_key, activity_key })',
            context_result: '{ authenticated: true, role: "student", class_id: positive integer, course_id: positive integer }',
            discovery: 'GET /api/code-problems/by-activity?course_id={course_id}&activity_key={activity_key}&class_id={class_id}',
            submit: 'POST /api/code-problems/{id}/submissions',
            poll: 'GET /api/code-submissions/{id} while queued or running; 5–35 second bounded window with 1 second cadence',
            statuses: Array.from(submissionStatuses)
        }),
        availability,
        submit,
        refresh,
        resultMessage
    });
})(window);

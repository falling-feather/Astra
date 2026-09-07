(function (global) {
    'use strict';

    const challenge = global.CvChallengeSession = global.CvChallengeSession || {};
    if (challenge.scopeStorageVersion !== 2) {
        challenge.drafts = Object.create(null);
        challenge.predictions = Object.create(null);
        challenge.result = Object.create(null);
        challenge.submissions = Object.create(null);
        challenge.lastRunSources = Object.create(null);
        challenge.predictionRecorded = Object.create(null);
        challenge.repairingKey = null;
        challenge.scopeStorageVersion = 2;
    }
    challenge.runGeneration = Number(challenge.runGeneration) || 0;
    challenge.submissionGeneration = Number(challenge.submissionGeneration) || 0;
    challenge.evidenceController = challenge.evidenceController || null;
    challenge.activeScopeKey = '';
    challenge.evidenceScopeKey = '';
    challenge.evidenceGeneration = Number(challenge.evidenceGeneration) || 0;

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function outputOf(result) {
        const steps = result && result.steps || [];
        const last = steps[steps.length - 1];
        return last && Array.isArray(last.stdout) ? last.stdout.join('\n').trim() : '';
    }

    function courseTitle(manifest, activity) {
        const course = manifest.courses.find(item => item.course_key === activity.course_key);
        return course ? course.title : '代码空间';
    }

    function traceView(result) {
        if (!result) return '<p class="challenge-empty">运行后会在这里显示变量、数组与输出的可观察轨迹。</p>';
        if (result.error) return '<p class="challenge-error">' + esc(result.error) + '</p>';
        const frames = result.steps.slice(0, 5);
        if (!frames.length) return '<p class="challenge-empty">运行完成，但这段代码没有产生可显示的轨迹。</p>';
        return '<ol class="trace-frames">' + frames.map((frame, index) => '<li><span>步骤 ' + (index + 1) + '</span><code>' + esc(JSON.stringify(frame.vars || {})) + '</code><small>' + esc((frame.stdout || []).join(' · ') || '继续观察') + '</small></li>').join('') + '</ol>';
    }

    function submissionState(activity) {
        const adapter = global.CvSubmissionAdapter;
        if (adapter && typeof adapter.availability === 'function') {
            try { return adapter.availability(activity); } catch (_) { /* fail closed below */ }
        }
        return { available: false, reason: '正式提交服务暂不可用。', code: 'adapter_unavailable' };
    }

    function learningGate() {
        const context = global.CvStudentContext;
        return context && typeof context.gate === 'function' ? context.gate() : { blocked: false };
    }

    function formalStatusClass(record) {
        if (!record) return '';
        if (record.pending) return 'is-warn';
        return record.ok && record.status === 'accepted' ? 'is-pass' : 'is-warn';
    }

    function formalStatusCopy(record, state) {
        if (record) return record.reason || '提交结果尚未确认。';
        if (state.available) return '正式提交服务已连接，提交后将在这里显示权威判题状态。';
        return state.reason || '正式提交暂不可用。';
    }

    function formalButtonCopy(record, state) {
        if (record && record.pending) return '正在提交…';
        if (record && record.can_retry) return '再次查询正式结果';
        return state.available ? '正式提交代码' : '暂不能正式提交';
    }

    function restoreResultFocus(intent, generation) {
        if (intent === 'run' && generation !== challenge.runGeneration) return;
        if (intent === 'submit' && generation !== challenge.submissionGeneration) return;
        const root = document.getElementById('course-challenge-root');
        if (!root) return;
        const target = intent === 'run'
            ? root.querySelector('#challenge-repair')
            : root.querySelector('#challenge-submit:not([disabled])') || root.querySelector('#challenge-submission-status');
        if (target && typeof target.focus === 'function') target.focus();
    }

    function scopeDescriptor(activity) {
        const provider = global.AstraCodeSpaceStudentContext;
        const resolved = provider && typeof provider.resolve === 'function'
            ? provider.resolve(activity)
            : null;
        if (
            resolved
            && Number.isInteger(resolved.class_id)
            && resolved.class_id > 0
            && Number.isInteger(resolved.course_id)
            && resolved.course_id > 0
        ) {
            return Object.freeze({
                key: `${resolved.class_id}:${resolved.course_id}:${activity.activity_key}`,
                class_id: resolved.class_id,
                course_id: resolved.course_id,
                activity_key: activity.activity_key,
                authoritative: true
            });
        }
        return Object.freeze({
            key: `preview:0:0:${activity.activity_key}`,
            class_id: 0,
            course_id: 0,
            activity_key: activity.activity_key,
            authoritative: false
        });
    }

    function localStateFor(scopeKey, template) {
        const owns = (collection) => Object.prototype.hasOwnProperty.call(collection, scopeKey);
        return Object.freeze({
            draft: owns(challenge.drafts) ? challenge.drafts[scopeKey] : template.starter_code,
            prediction: owns(challenge.predictions) ? challenge.predictions[scopeKey] : '',
            result: owns(challenge.result) ? challenge.result[scopeKey] : null,
            submission: owns(challenge.submissions) ? challenge.submissions[scopeKey] : null,
            repairing: challenge.repairingKey === scopeKey
        });
    }

    function clearEvidenceRuntime() {
        const host = document.getElementById('cv-page-challenge');
        challenge.evidenceGeneration += 1;
        if (host && global.AstraLearningEvidenceActivity) {
            global.AstraLearningEvidenceActivity.destroyWithin(host);
        }
        if (global.AstraLearningEvidenceLoader) {
            global.AstraLearningEvidenceLoader.clearDomainCommands('code-space', 'control-flow.loop-boundary');
        }
        challenge.evidenceController = null;
        challenge.evidenceScopeKey = '';
    }

    function transitionScope(nextScopeKey) {
        const next = String(nextScopeKey || '');
        if (challenge.activeScopeKey === next) return;
        const previous = challenge.activeScopeKey;
        challenge.runGeneration += 1;
        challenge.submissionGeneration += 1;
        if (challenge.submissionAbort) challenge.submissionAbort.abort();
        challenge.submissionAbort = null;
        if (previous && challenge.submissions[previous] && challenge.submissions[previous].pending) {
            challenge.submissions[previous] = {
                ok: false,
                can_retry: false,
                code: 'submission_scope_changed',
                reason: '班级或课程已切换，旧作用域中的发送已取消。'
            };
        }
        clearEvidenceRuntime();
        challenge.activeScopeKey = next;
    }

    function syncEvidence(activity, descriptor) {
        const host = document.getElementById('cv-page-challenge');
        if (
            !host
            || !global.AstraLearningEvidenceLoader
            || !activity
            || activity.activity_key !== 'control-flow.loop-boundary'
            || !descriptor
            || !descriptor.authoritative
        ) {
            clearEvidenceRuntime();
            return;
        }
        if (challenge.evidenceController && challenge.evidenceScopeKey === descriptor.key) return;
        clearEvidenceRuntime();
        const generation = challenge.evidenceGeneration;
        const expectedScopeKey = descriptor.key;
        global.AstraLearningEvidenceLoader.ensure({ activity: true }).then(() => {
            const current = global.CvCourseSession && global.CvCourseSession.activityKey;
            const currentScope = scopeDescriptor(activity);
            if (
                generation !== challenge.evidenceGeneration
                || current !== activity.activity_key
                || currentScope.key !== expectedScopeKey
                || challenge.activeScopeKey !== expectedScopeKey
                || !host.isConnected
            ) return;
            global.AstraLearningEvidenceActivity.destroyWithin(host);
            challenge.evidenceController = global.AstraLearningEvidenceActivity.mount({
                host,
                galaxy_key: 'code-space',
                activity_key: 'control-flow.loop-boundary',
                title: '循环边界学习证据',
                operationLabel: '运行浏览器预检',
                integrated: true
            });
            challenge.evidenceScopeKey = challenge.evidenceController ? expectedScopeKey : '';
        }).catch(error => {
            if (generation === challenge.evidenceGeneration) clearEvidenceRuntime();
            global.console && global.console.warn('[CodeSpace] learning evidence unavailable', error && (error.code || error.message));
        });
    }

    function recordEvidence(activity, descriptor, eventType, evidence) {
        if (
            !activity
            || activity.activity_key !== 'control-flow.loop-boundary'
            || !descriptor
            || !descriptor.authoritative
            || descriptor.key !== challenge.activeScopeKey
        ) return;
        global.dispatchEvent(new CustomEvent('astra:learning-domain-command', {
            detail: {
                galaxy_key: 'code-space',
                activity_key: activity.activity_key,
                class_id: descriptor.class_id,
                course_id: descriptor.course_id,
                event_type: eventType,
                evidence
            }
        }));
    }

    function render() {
        const root = document.getElementById('course-challenge-root');
        const manifest = global.CvCourseManifest;
        if (!root) return;
        const gate = learningGate();
        if (gate.blocked) {
            transitionScope('');
            root.innerHTML = '<div class="challenge-shell course-context-gate" role="status" aria-live="polite"><p class="course-eyebrow">代码空间</p><h1>' + esc(gate.title || '课程暂不可用') + '</h1><p class="course-lede">' + esc(gate.message || '请稍后重试。') + '</p></div>';
            return;
        }
        const routeKey = global.CvRouter && global.CvRouter.currentParams && global.CvRouter.currentParams.get('activity');
        const activity = manifest && manifest.getActivity(routeKey || (global.CvCourseSession || {}).activityKey || manifest.defaultActivityKey);
        if (!activity) {
            transitionScope('');
            root.replaceChildren();
            global.CvRouter.navigateTo('catalog');
            return;
        }
        global.CvCourseSession.activityKey = activity.activity_key;
        global.CvCourseSession.courseKey = activity.course_key;
        const descriptor = scopeDescriptor(activity);
        const stateKey = descriptor.key;
        transitionScope(stateKey);
        const state = global.CvCourseStateAdapter.resolve(activity);
        if (state.status === 'hidden' || state.status === 'locked' || state.status === 'unavailable') {
            clearEvidenceRuntime();
            if (state.status === 'hidden') root.replaceChildren();
            global.CvRouter.navigateTo('lesson', { activity: activity.activity_key });
            return;
        }
        const template = manifest.getTemplate(activity);
        const local = localStateFor(stateKey, template);
        const draft = local.draft;
        const prediction = local.prediction;
        const result = local.result;
        const precheck = result && !result.error && outputOf(result) === template.expected_output;
        const submitState = submissionState(activity);
        const submission = local.submission;
        const repairing = local.repairing;
        const observation = !result ? '' : '<section class="challenge-compare"><div><span>你的预测</span><p>' + esc(prediction || '尚未写下预测') + '</p></div><div><span>观察结果</span><p>' + esc(result.error ? result.error : (outputOf(result) || '已完成运行，继续查看轨迹。')) + '</p></div><div><span>修正线索</span><p>' + esc(template.repair_hint) + '</p></div></section>';
        const formalDisabled = !submitState.available || (submission && submission.pending);
        root.innerHTML = '<div class="challenge-shell">' +
            '<a class="lesson-back" href="#lesson?activity=' + encodeURIComponent(activity.activity_key) + '">← 返回子课程</a>' +
            '<header class="challenge-heading"><p class="course-eyebrow">' + esc(courseTitle(manifest, activity)) + ' / 可执行挑战</p><h1>挑战：' + esc(activity.title) + '</h1><p>' + esc(activity.goal) + '</p></header>' +
            '<ol class="challenge-steps" aria-label="学习步骤"><li class="' + (prediction ? 'is-done' : 'is-current') + '"><b>1</b>预测</li><li class="' + (result ? 'is-done' : (!prediction ? '' : 'is-current')) + '"><b>2</b>运行</li><li class="' + (result && !repairing ? 'is-current' : (repairing ? 'is-done' : '')) + '"><b>3</b>追踪</li><li class="' + (repairing ? 'is-current' : '') + '"><b>4</b>修正</li></ol>' +
            '<div class="challenge-layout"><section class="challenge-editor"><label for="challenge-prediction">你的预测</label><input id="challenge-prediction" maxlength="180" value="' + esc(prediction) + '" placeholder="先写下你的判断，不会作为正式记录保存。" /><label for="challenge-code">可编辑代码</label><textarea id="challenge-code" spellcheck="false" aria-label="可编辑代码">' + esc(draft) + '</textarea><p class="challenge-public">' + esc(template.public_check) + '</p><p class="challenge-repair-hint">修正线索：' + esc(template.repair_hint) + '</p><button class="cv-btn cv-btn--primary" type="button" id="challenge-run">运行并追踪</button></section>' +
            '<section class="challenge-trace" aria-live="polite"><div class="challenge-panel-title">运行 / 追踪</div>' + traceView(result) + '<button class="cv-btn" type="button" id="challenge-repair">修改后再次运行</button></section></div>' +
            observation +
            '<section class="challenge-checks"><div><p>浏览器预检</p><strong class="' + (result ? (precheck ? 'is-pass' : 'is-warn') : '') + '">' + (result ? (precheck ? '样例通过 · 仅用于学习反馈，不是正式判题' : '样例尚未通过 · 仅用于学习反馈，不是正式判题') : '请先运行公开样例 · 仅用于学习反馈，不是正式判题') + '</strong></div><div><p>正式提交</p><strong id="challenge-submission-status" class="' + formalStatusClass(submission) + '" aria-live="polite" tabindex="-1">' + esc(formalStatusCopy(submission, submitState)) + '</strong><button class="cv-btn" type="button" id="challenge-submit"' + (formalDisabled ? ' disabled aria-disabled="true"' : '') + '>' + formalButtonCopy(submission, submitState) + '</button></div></section>' +
            '</div>';
        syncEvidence(activity, descriptor);

        const code = root.querySelector('#challenge-code');
        const predictionInput = root.querySelector('#challenge-prediction');
        const run = async () => {
            const sourceCode = code.value;
            const previousSource = challenge.lastRunSources[stateKey];
            challenge.drafts[stateKey] = sourceCode;
            challenge.predictions[stateKey] = predictionInput.value;
            if (
                predictionInput.value.trim()
                && !challenge.predictionRecorded[stateKey]
                && !result
                && challenge.repairingKey !== stateKey
            ) {
                recordEvidence(activity, descriptor, 'predicted', {
                    prediction: { choice: 'prediction-recorded' },
                    cursor: { stage: 'before-browser-precheck' }
                });
                challenge.predictionRecorded[stateKey] = true;
            }
            const runGeneration = ++challenge.runGeneration;
            const button = root.querySelector('#challenge-run');
            button.disabled = true;
            button.textContent = '正在运行…';
            const value = await global.CvRuntime.trace({ language: template.language, code: sourceCode, maxSteps: 500 });
            if (runGeneration !== challenge.runGeneration || challenge.activeScopeKey !== stateKey) return;
            const localPass = !value.error && outputOf(value) === template.expected_output;
            recordEvidence(activity, descriptor, 'attempted', {
                operation: 'browser_precheck',
                reported_correct: Boolean(localPass),
                cursor: { runner: value.error ? 'runner_unavailable' : 'browser_precheck_finished' }
            });
            if (typeof previousSource === 'string' && previousSource !== sourceCode) {
                recordEvidence(activity, descriptor, 'corrected', {
                    correction: {
                        kind: 'code-revision',
                        result: localPass ? 'public-check-pass' : 'public-check-needs-review'
                    },
                    cursor: { stage: 'after-repair' }
                });
            }
            challenge.lastRunSources[stateKey] = sourceCode;
            challenge.result[stateKey] = value;
            if (challenge.repairingKey === stateKey) challenge.repairingKey = null;
            render();
            restoreResultFocus('run', runGeneration);
        };
        const formalSubmit = async () => {
            const adapter = global.CvSubmissionAdapter;
            if (!adapter || typeof adapter.submit !== 'function') return;
            const sourceCode = code.value;
            challenge.drafts[stateKey] = sourceCode;
            challenge.predictions[stateKey] = predictionInput.value;
            const previous = challenge.submissions[stateKey] || null;
            if (challenge.submissionAbort) challenge.submissionAbort.abort();
            const controller = new AbortController();
            challenge.submissionAbort = controller;
            const generation = ++challenge.submissionGeneration;
            challenge.submissions[stateKey] = { pending: true, reason: '正在发送正式提交…' };
            render();
            let response;
            try {
                response = previous && previous.can_retry && typeof adapter.refresh === 'function'
                    ? await adapter.refresh(activity, previous, { signal: controller.signal })
                    : await adapter.submit(activity, sourceCode, { signal: controller.signal });
            } catch (_) {
                response = { ok: false, reason: '提交结果尚未确认，未显示为成功。请刷新后核对。', code: 'submission_unconfirmed' };
            }
            if (generation !== challenge.submissionGeneration || challenge.activeScopeKey !== stateKey) return;
            challenge.submissionAbort = null;
            challenge.submissions[stateKey] = response;
            render();
            restoreResultFocus('submit', generation);
            recordEvidence(activity, descriptor, 'attempted', {
                operation: 'formal_oj_submission',
                cursor: {
                    judge: response && response.ok
                        ? 'judge_result_received'
                        : 'judge_result_unconfirmed'
                }
            });
        };
        root.querySelector('#challenge-run').addEventListener('click', run);
        const submitButton = root.querySelector('#challenge-submit');
        if (!submitButton.disabled) submitButton.addEventListener('click', formalSubmit);
        code.addEventListener('input', () => { challenge.drafts[stateKey] = code.value; });
        predictionInput.addEventListener('input', () => { challenge.predictions[stateKey] = predictionInput.value; });
        root.querySelector('#challenge-repair').addEventListener('click', () => {
            challenge.drafts[stateKey] = code.value;
            challenge.predictions[stateKey] = predictionInput.value;
            challenge.repairingKey = stateKey;
            render();
            requestAnimationFrame(() => root.querySelector('#challenge-code').focus());
        });
        code.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); } });
    }

    global.CvCourseChallenge = {
        init: render,
        refresh: render,
        cancel() {
            transitionScope('');
            global.CvRuntime && global.CvRuntime.cancel('cpp');
        }
    };
})(window);

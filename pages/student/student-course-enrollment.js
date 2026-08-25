(function attachStudentCourseEnrollment(global) {
    'use strict';

    if (global.AstraStudentCourseEnrollment) return;

    const VERSION = '20260825v843CourseEnrollmentP0';
    const COURSE_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
    let session = null;

    function normalizeCourseCode(value) {
        return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    }

    function discoveryMatches(value) {
        return Boolean(
            value
            && Number.isInteger(Number(value.course_id))
            && COURSE_CODE_PATTERN.test(normalizeCourseCode(value.course_code))
            && typeof value.title === 'string'
            && ['open', 'class_restricted'].includes(value.admission_mode)
            && ['eligible', 'class_not_eligible', 'request_pending', 'already_enrolled'].includes(value.eligibility_reason)
            && Array.isArray(value.teachers)
            && Array.isArray(value.eligible_source_classes)
        );
    }

    function buildJoinPayload(discovery, sourceClassId, message) {
        if (!discoveryMatches(discovery) || !discovery.can_request) {
            throw new Error('当前课程不能提交加入申请');
        }
        const classes = discovery.eligible_source_classes || [];
        const normalizedClassId = Number(sourceClassId) || null;
        if (discovery.admission_mode === 'class_restricted') {
            if (!normalizedClassId || !classes.some((item) => Number(item.class_id) === normalizedClassId)) {
                throw new Error('请选择一个符合准入要求的行政班');
            }
        } else if (normalizedClassId && !classes.some((item) => Number(item.class_id) === normalizedClassId)) {
            throw new Error('所选行政班不在当前可用范围');
        }
        const note = String(message || '').trim();
        if (note.length > 500) throw new Error('申请说明不能超过 500 字');
        return {
            source_class_id: normalizedClassId,
            message: note || null
        };
    }

    function eligibilityLabel(reason) {
        return ({
            eligible: '可以申请',
            class_not_eligible: '当前班级不符合准入要求',
            request_pending: '申请待教师审核',
            already_enrolled: '已加入课程'
        })[String(reason || '')] || '状态待确认';
    }

    function mount(root, host) {
        destroy();
        if (!root || !host || typeof host.request !== 'function') return false;
        session = {
            root,
            host,
            active: true,
            role: '',
            ready: false,
            loading: false,
            busy: false,
            generation: 0,
            controller: null,
            code: '',
            course: null,
            error: null,
            notice: null,
            leaveConfirmationId: null,
            onSubmit: handleSubmit,
            onClick: handleClick,
            onInput: handleInput,
            onOnline: handleOnline
        };
        root.addEventListener('submit', session.onSubmit);
        root.addEventListener('click', session.onClick);
        root.addEventListener('input', session.onInput);
        global.addEventListener('online', session.onOnline);
        render();
        void loadIdentity();
        return true;
    }

    function destroy() {
        if (!session) return;
        session.active = false;
        session.generation += 1;
        abortRequest();
        session.root.removeEventListener('submit', session.onSubmit);
        session.root.removeEventListener('click', session.onClick);
        session.root.removeEventListener('input', session.onInput);
        global.removeEventListener('online', session.onOnline);
        session = null;
    }

    function handleOnline() {
        if (session && session.role === 'student' && session.code) void discoverCourse({ preserveNotice: true });
    }

    async function loadIdentity() {
        if (!session || session.loading) return false;
        const operation = beginRequest();
        session.loading = true;
        session.error = null;
        render();
        try {
            const user = await session.host.request('/api/users/me', { signal: operation.signal });
            if (!isCurrent(operation)) return false;
            session.role = String(user && user.role || '');
            session.ready = true;
            return session.role === 'student';
        } catch (error) {
            if (!isCurrent(operation) || isCancelled(error)) return false;
            session.error = error;
            session.ready = true;
            return false;
        } finally {
            if (isCurrent(operation)) {
                session.loading = false;
                render();
            }
        }
    }

    async function discoverCourse(options = {}) {
        if (!session || (session.busy && !options.allowBusy)) return false;
        const code = normalizeCourseCode(session.code);
        session.code = code;
        if (!COURSE_CODE_PATTERN.test(code)) {
            session.error = new Error('请输入 4—16 位课程码');
            session.course = null;
            render();
            return false;
        }
        const operation = beginRequest();
        session.loading = true;
        session.error = null;
        if (!options.preserveNotice) session.notice = null;
        session.leaveConfirmationId = null;
        render();
        try {
            const course = await session.host.request(`/api/v1/courses/by-code/${encodeURIComponent(code)}`, {
                signal: operation.signal
            });
            if (!isCurrent(operation)) return false;
            if (!discoveryMatches(course)) throw new Error('课程信息返回格式不完整');
            session.course = course;
            session.code = normalizeCourseCode(course.course_code);
            if (course.eligibility_reason === 'already_enrolled' && typeof session.host.refreshWorkspace === 'function') {
                session.host.refreshWorkspace();
            }
            return true;
        } catch (error) {
            if (!isCurrent(operation) || isCancelled(error)) return false;
            session.course = null;
            session.error = error;
            return false;
        } finally {
            if (isCurrent(operation)) {
                session.loading = false;
                render();
            }
        }
    }

    async function submitJoinRequest(form) {
        if (!session || session.busy || !session.course || !form.reportValidity()) return false;
        let payload;
        try {
            const data = new FormData(form);
            payload = buildJoinPayload(session.course, data.get('source_class_id'), data.get('message'));
        } catch (error) {
            session.error = error;
            render();
            return false;
        }
        session.busy = true;
        session.error = null;
        session.notice = null;
        render();
        try {
            await session.host.request(`/api/v1/courses/${Number(session.course.course_id)}/join-requests`, {
                method: 'POST',
                body: payload
            });
            session.notice = { type: 'success', message: '申请已提交，等待课程教师审核。' };
            await discoverCourse({ preserveNotice: true, allowBusy: true });
            return true;
        } catch (error) {
            if (!isCancelled(error)) session.error = error;
            return false;
        } finally {
            if (session) {
                session.busy = false;
                render();
            }
        }
    }

    async function leaveCourse() {
        if (!session || session.busy || !session.course || !session.course.enrollment) return false;
        const enrollmentId = Number(session.course.enrollment.id);
        if (session.leaveConfirmationId !== enrollmentId) {
            session.leaveConfirmationId = enrollmentId;
            session.notice = { type: 'warning', message: '再次点击“确认退出”才会离开课程；学习历史不会被删除。' };
            render();
            return false;
        }
        session.busy = true;
        session.error = null;
        render();
        try {
            await session.host.request(`/api/v1/courses/${Number(session.course.course_id)}/enrollments/${enrollmentId}`, {
                method: 'PATCH',
                body: { status: 'left', note: '学生在学习台主动退出' }
            });
            session.leaveConfirmationId = null;
            session.notice = { type: 'success', message: '已退出课程；申请和学习历史仍然保留。' };
            await discoverCourse({ preserveNotice: true, allowBusy: true });
            if (session && typeof session.host.refreshWorkspace === 'function') session.host.refreshWorkspace();
            return true;
        } catch (error) {
            if (!isCancelled(error)) session.error = error;
            return false;
        } finally {
            if (session) {
                session.busy = false;
                render();
            }
        }
    }

    function handleSubmit(event) {
        if (!session || !(event.target instanceof HTMLFormElement)) return;
        if (event.target.matches('[data-course-code-form]')) {
            event.preventDefault();
            void discoverCourse();
            return;
        }
        if (event.target.matches('[data-course-join-form]')) {
            event.preventDefault();
            void submitJoinRequest(event.target);
        }
    }

    function handleClick(event) {
        if (!session || !(event.target instanceof Element)) return;
        const action = event.target.closest('[data-course-enrollment-action]');
        if (!action) return;
        const name = action.dataset.courseEnrollmentAction;
        if (name === 'refresh') void discoverCourse({ preserveNotice: true });
        if (name === 'clear') {
            abortRequest();
            session.code = '';
            session.course = null;
            session.error = null;
            session.notice = null;
            session.leaveConfirmationId = null;
            render();
        }
        if (name === 'leave') void leaveCourse();
    }

    function handleInput(event) {
        if (!session || !(event.target instanceof HTMLInputElement)) return;
        if (event.target.matches('[data-course-code-input]')) {
            const normalized = normalizeCourseCode(event.target.value);
            session.code = normalized;
            if (event.target.value !== normalized) event.target.value = normalized;
            session.leaveConfirmationId = null;
        }
    }

    function render() {
        if (!session) return false;
        if (!session.ready && session.loading) {
            session.root.hidden = false;
            session.root.innerHTML = loadingMarkup('正在准备课程加入入口…');
            refreshIcons();
            return true;
        }
        if (session.ready && session.role !== 'student') {
            session.root.hidden = true;
            session.root.innerHTML = '';
            return true;
        }
        session.root.hidden = false;
        session.root.innerHTML = `
            <section class="student-course-enrollment" aria-labelledby="student-course-enrollment-title">
                <header class="student-course-enrollment__header">
                    <div><span>COURSE ACCESS</span><h2 id="student-course-enrollment-title">加入授课课程</h2><p>输入教师提供的课程码，先查看准入状态，再提交申请。</p></div>
                    ${session.course ? `<button type="button" data-course-enrollment-action="clear" ${session.busy ? 'disabled' : ''}><i data-lucide="x"></i><span>清空</span></button>` : ''}
                </header>
                <form class="student-course-code" data-course-code-form>
                    <label><span>课程码</span><input data-course-code-input name="course_code" value="${escapeAttr(session.code)}" minlength="4" maxlength="16" pattern="[A-Za-z0-9]{4,16}" autocomplete="off" placeholder="例如 ABCD2345" required></label>
                    <button type="submit" ${session.loading || session.busy ? 'disabled' : ''}><i data-lucide="scan-search"></i><span>${session.loading ? '正在查找' : '查找课程'}</span></button>
                </form>
                ${noticeMarkup()}
                ${session.error ? errorMarkup(session.error) : ''}
                ${session.loading && session.ready ? loadingMarkup('正在读取课程与准入状态…') : ''}
                ${session.course && !session.loading ? courseMarkup(session.course) : ''}
            </section>`;
        refreshIcons();
        return true;
    }

    function courseMarkup(course) {
        const teachers = course.teachers || [];
        const meta = [course.academic_year, course.schedule_text, course.total_hours ? `${course.total_hours} 课时` : ''].filter(Boolean);
        return `
            <article class="student-course-result" data-state="${escapeAttr(course.eligibility_reason)}">
                <div class="student-course-result__identity">
                    <span>${escapeHtml(course.galaxy_key)} / ${escapeHtml(course.subject_key)}</span>
                    <h3>${escapeHtml(course.title)}</h3>
                    <p>${escapeHtml(course.summary || '教师尚未填写课程简介')}</p>
                    <div>${meta.map(item => `<small>${escapeHtml(item)}</small>`).join('')}</div>
                </div>
                <aside class="student-course-result__status">
                    <span>${escapeHtml(course.course_code)}</span>
                    <strong>${escapeHtml(eligibilityLabel(course.eligibility_reason))}</strong>
                    <small>${course.admission_mode === 'class_restricted' ? '指定行政班申请' : '公开申请'}</small>
                </aside>
                <div class="student-course-result__teachers"><i data-lucide="presentation"></i><span>${teachers.length ? teachers.map(item => escapeHtml(item.display_name)).join('、') : '教师信息待读取'}</span></div>
                ${courseActionMarkup(course)}
            </article>`;
    }

    function courseActionMarkup(course) {
        if (course.eligibility_reason === 'already_enrolled' && course.enrollment) {
            const enrollment = course.enrollment;
            const confirming = session.leaveConfirmationId === Number(enrollment.id);
            return `
                <div class="student-course-receipt student-course-receipt--active">
                    <div><i data-lucide="circle-check-big"></i><p><strong>已在课程名单中</strong><span>${escapeHtml(enrollment.source_class_name || '未关联班级')} · 可以从“我的学习”继续课程。</span></p></div>
                    <button type="button" data-course-enrollment-action="leave" class="${confirming ? 'is-confirming' : ''}" ${session.busy ? 'disabled' : ''}>${confirming ? '确认退出' : '退出课程'}</button>
                </div>`;
        }
        if (course.eligibility_reason === 'request_pending') {
            const request = course.latest_join_request || {};
            return `
                <div class="student-course-receipt">
                    <div><i data-lucide="clock-3"></i><p><strong>第 ${escapeHtml(request.request_number || 1)} 次申请待审核</strong><span>${escapeHtml(request.source_class_name || '未关联班级')} · 提交于 ${escapeHtml(formatDate(request.created_at))}</span></p></div>
                    <button type="button" data-course-enrollment-action="refresh" ${session.busy ? 'disabled' : ''}>刷新状态</button>
                </div>`;
        }
        if (course.eligibility_reason === 'class_not_eligible') {
            return '<div class="student-course-receipt student-course-receipt--blocked"><div><i data-lucide="shield-x"></i><p><strong>当前不能申请</strong><span>你不属于这门课允许申请的行政班，请联系课程教师确认。</span></p></div></div>';
        }
        const latest = course.latest_join_request;
        const classes = course.eligible_source_classes || [];
        const required = course.admission_mode === 'class_restricted';
        return `
            ${latest && latest.status === 'rejected' ? `<div class="student-course-rejected"><strong>上次申请已退回</strong><span>${escapeHtml(latest.review_note || '教师未填写退回说明')}；可以修正后再次申请。</span></div>` : ''}
            <form class="student-course-join-form" data-course-join-form>
                ${classes.length ? `<label><span>关联行政班${required ? '' : '（可选）'}</span><select name="source_class_id" ${required ? 'required' : ''}><option value="">${required ? '请选择行政班' : '不关联行政班'}</option>${classes.map((item, index) => `<option value="${escapeAttr(item.class_id)}"${required && (classes.length === 1 || index === 0) ? ' selected' : ''}>${escapeHtml([item.name, item.grade, item.term].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>` : ''}
                <label class="is-wide"><span>申请说明（可选）</span><textarea name="message" maxlength="500" rows="3" placeholder="给课程教师留一句话"></textarea></label>
                <button type="submit" ${session.busy ? 'disabled' : ''}><i data-lucide="send"></i><span>${session.busy ? '正在提交' : latest && latest.status === 'rejected' ? '再次申请' : '提交申请'}</span></button>
            </form>`;
    }

    function noticeMarkup() {
        if (!session.notice) return '';
        return `<div class="student-course-enrollment__notice" data-type="${escapeAttr(session.notice.type)}" role="status"><i data-lucide="${session.notice.type === 'success' ? 'circle-check-big' : 'triangle-alert'}"></i><span>${escapeHtml(session.notice.message)}</span></div>`;
    }

    function errorMarkup(error) {
        return `<div class="student-course-enrollment__error" role="alert"><i data-lucide="circle-alert"></i><div><strong>课程状态读取失败</strong><p>${escapeHtml(errorMessage(error))}</p></div></div>`;
    }

    function loadingMarkup(message) {
        return `<div class="student-course-enrollment__loading" role="status"><i data-lucide="loader-circle"></i><span>${escapeHtml(message)}</span></div>`;
    }

    function beginRequest() {
        abortRequest();
        session.controller = new AbortController();
        session.generation += 1;
        return { generation: session.generation, signal: session.controller.signal, controller: session.controller };
    }

    function abortRequest() {
        if (session && session.controller && !session.controller.signal.aborted) session.controller.abort();
        if (session) session.controller = null;
    }

    function isCurrent(operation) {
        return Boolean(session && session.active && operation && operation.generation === session.generation && operation.controller === session.controller && !operation.signal.aborted);
    }

    function isCancelled(error) {
        return Boolean(global.AstraApiClient && typeof global.AstraApiClient.isCancelled === 'function' && global.AstraApiClient.isCancelled(error));
    }

    function errorMessage(error) {
        if (global.AstraApiClient && typeof global.AstraApiClient.message === 'function') return global.AstraApiClient.message(error);
        return error && error.message ? error.message : '请求失败，请稍后重试。';
    }

    function formatDate(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
    }

    function refreshIcons() {
        if (session && typeof session.host.refreshIcons === 'function') session.host.refreshIcons(session.root);
        else if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons({ root: session && session.root });
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    global.AstraStudentCourseEnrollment = Object.freeze({
        mount,
        destroy,
        render,
        contract: Object.freeze({ VERSION, normalizeCourseCode, discoveryMatches, buildJoinPayload, eligibilityLabel })
    });
})(window);

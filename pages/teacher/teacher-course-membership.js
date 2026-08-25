(function attachTeacherCourseMembership(global) {
    'use strict';

    if (global.AstraTeacherCourseMembership) return;

    const VERSION = '20260825v843CourseEnrollmentP0';
    const PAGE_LIMIT = 200;
    let session = null;

    function approvedCourse(course) {
        return Boolean(course && Number(course.id) > 0 && String(course.course_code || '').trim());
    }

    function buildReviewPayload(decision, note) {
        const status = String(decision || '').trim();
        if (!['approved', 'rejected'].includes(status)) throw new Error('请选择批准或退回');
        const normalized = String(note || '').trim();
        if (normalized.length > 500) throw new Error('审核说明不能超过 500 字');
        return { status, note: normalized || null };
    }

    function batchResultSummary(result) {
        const source = result && typeof result === 'object' ? result : {};
        return {
            created: Number(source.created_count || 0),
            already: Number(source.already_enrolled_count || 0),
            left: Number(source.previously_left_count || 0),
            ineligible: Number(source.ineligible_count || 0)
        };
    }

    function pageMatches(value, kind) {
        if (!value || !Array.isArray(value.items) || !Number.isInteger(Number(value.total))) return false;
        if (kind === 'requests') return value.items.every((item) => item && Number(item.id) > 0 && ['pending', 'approved', 'rejected'].includes(item.status));
        if (kind === 'enrollments') return value.items.every((item) => item && Number(item.id) > 0 && ['active', 'left'].includes(item.status));
        return false;
    }

    function mount(root, host) {
        destroy();
        if (!root || !host || typeof host.snapshot !== 'function' || typeof host.request !== 'function') return false;
        session = {
            root,
            host,
            active: true,
            selectedCourseId: '',
            loadedCourseId: '',
            loading: false,
            busy: false,
            generation: 0,
            controller: null,
            requestFilter: 'pending',
            rosterFilter: 'active',
            requests: emptyPage(),
            roster: emptyPage(),
            error: null,
            notice: null,
            notes: Object.create(null),
            reviewConfirmation: null,
            removeConfirmationId: null,
            batchClassId: '',
            batchConfirmationClassId: '',
            batchResult: null,
            onClick: handleClick,
            onChange: handleChange,
            onInput: handleInput,
            onSubmit: handleSubmit
        };
        root.addEventListener('click', session.onClick);
        root.addEventListener('change', session.onChange);
        root.addEventListener('input', session.onInput);
        root.addEventListener('submit', session.onSubmit);
        render();
        return true;
    }

    function destroy() {
        if (!session) return;
        session.active = false;
        session.generation += 1;
        abortRead();
        session.root.removeEventListener('click', session.onClick);
        session.root.removeEventListener('change', session.onChange);
        session.root.removeEventListener('input', session.onInput);
        session.root.removeEventListener('submit', session.onSubmit);
        session = null;
    }

    function emptyPage() {
        return { items: [], total: 0, limit: PAGE_LIMIT, offset: 0, next_offset: null };
    }

    function snapshot() {
        const value = session && session.host.snapshot();
        return value && typeof value === 'object' ? value : {};
    }

    function visibleCourses(context = snapshot()) {
        return (Array.isArray(context.courses) ? context.courses : []).filter(approvedCourse);
    }

    function selectedCourse(context = snapshot()) {
        return visibleCourses(context).find((course) => String(course.id) === String(session && session.selectedCourseId)) || null;
    }

    function syncSelection(context) {
        const courses = visibleCourses(context);
        if (!courses.some((course) => String(course.id) === String(session.selectedCourseId))) {
            session.selectedCourseId = courses.length ? String(courses[0].id) : '';
        }
        if (session.loadedCourseId && session.loadedCourseId !== session.selectedCourseId) resetCourseData();
        return courses;
    }

    function resetCourseData() {
        if (!session) return;
        session.generation += 1;
        abortRead();
        session.loadedCourseId = '';
        session.loading = false;
        session.requests = emptyPage();
        session.roster = emptyPage();
        session.error = null;
        session.notice = null;
        session.notes = Object.create(null);
        session.reviewConfirmation = null;
        session.removeConfirmationId = null;
        session.batchClassId = '';
        session.batchConfirmationClassId = '';
        session.batchResult = null;
    }

    async function refreshSelected(options = {}) {
        if (!session || !session.selectedCourseId || session.loading || (session.busy && !options.allowBusy)) return false;
        const courseId = Number(session.selectedCourseId);
        const operation = beginRead(courseId);
        session.loading = true;
        session.error = null;
        if (!options.preserveNotice) session.notice = null;
        render();
        try {
            const [requests, roster] = await Promise.all([
                session.host.request(`/api/v1/courses/${courseId}/join-requests`, {
                    params: { status: session.requestFilter, limit: PAGE_LIMIT, offset: 0 },
                    signal: operation.signal
                }),
                session.host.request(`/api/v1/courses/${courseId}/enrollments`, {
                    params: { status: session.rosterFilter, limit: PAGE_LIMIT, offset: 0 },
                    signal: operation.signal
                })
            ]);
            if (!isCurrent(operation)) return false;
            if (!pageMatches(requests, 'requests') || !pageMatches(roster, 'enrollments')) throw new Error('课程名单返回格式不完整');
            session.requests = normalizePage(requests);
            session.roster = normalizePage(roster);
            session.loadedCourseId = String(courseId);
            session.reviewConfirmation = null;
            session.removeConfirmationId = null;
            return true;
        } catch (error) {
            if (!isCurrent(operation) || isCancelled(error)) return false;
            session.requests = emptyPage();
            session.roster = emptyPage();
            session.error = error;
            session.loadedCourseId = String(courseId);
            return false;
        } finally {
            if (isCurrent(operation)) {
                session.loading = false;
                render();
            }
        }
    }

    async function reviewRequest(requestId, decision) {
        if (!session || session.busy) return false;
        const request = session.requests.items.find((item) => Number(item.id) === Number(requestId));
        if (!request || request.status !== 'pending') return false;
        let payload;
        try {
            payload = buildReviewPayload(decision, session.notes[String(request.id)] || '');
        } catch (error) {
            session.error = error;
            render();
            return false;
        }
        const confirmation = `${request.id}:${payload.status}:${payload.note || ''}`;
        if (session.reviewConfirmation !== confirmation) {
            session.reviewConfirmation = confirmation;
            session.notice = { type: 'warning', message: `再次点击“${payload.status === 'approved' ? '批准' : '退回'}”才会处理 ${request.display_name} 的申请。` };
            render();
            return false;
        }
        if (!beginMutation('审核课程加入申请')) return false;
        session.busy = true;
        session.error = null;
        render();
        try {
            await session.host.request(`/api/v1/courses/${Number(session.selectedCourseId)}/join-requests/${Number(request.id)}`, {
                method: 'PATCH',
                body: payload
            });
            session.notice = { type: 'success', message: `${request.display_name} 的申请已${payload.status === 'approved' ? '批准' : '退回'}。` };
            session.reviewConfirmation = null;
            await refreshSelected({ preserveNotice: true, allowBusy: true });
            notify('success', session.notice.message);
            return true;
        } catch (error) {
            if (!isCancelled(error)) {
                session.error = error;
                await failMutation(error, '审核课程加入申请');
            }
            return false;
        } finally {
            finishMutation();
        }
    }

    async function removeEnrollment(enrollmentId) {
        if (!session || session.busy) return false;
        const enrollment = session.roster.items.find((item) => Number(item.id) === Number(enrollmentId));
        if (!enrollment || enrollment.status !== 'active') return false;
        if (session.removeConfirmationId !== Number(enrollment.id)) {
            session.removeConfirmationId = Number(enrollment.id);
            session.notice = { type: 'warning', message: `再次点击“确认移除”才会把 ${enrollment.display_name} 移出当前课程。` };
            render();
            return false;
        }
        if (!beginMutation('移除课程学生')) return false;
        session.busy = true;
        session.error = null;
        render();
        try {
            await session.host.request(`/api/v1/courses/${Number(session.selectedCourseId)}/enrollments/${Number(enrollment.id)}`, {
                method: 'PATCH',
                body: { status: 'left', note: '教师从课程名单移除' }
            });
            session.notice = { type: 'success', message: `${enrollment.display_name} 已移出课程，历史记录仍保留。` };
            session.removeConfirmationId = null;
            await refreshSelected({ preserveNotice: true, allowBusy: true });
            notify('success', session.notice.message);
            return true;
        } catch (error) {
            if (!isCancelled(error)) {
                session.error = error;
                await failMutation(error, '移除课程学生');
            }
            return false;
        } finally {
            finishMutation();
        }
    }

    async function batchEnroll(classId) {
        if (!session || session.busy) return false;
        const normalizedClassId = Number(classId);
        const available = batchClassOptions(selectedCourse(), snapshot());
        const classOption = available.find((item) => Number(item.class_id) === normalizedClassId);
        if (!classOption) {
            session.error = new Error('请选择当前课程允许的行政班');
            render();
            return false;
        }
        if (session.batchConfirmationClassId !== String(normalizedClassId)) {
            session.batchConfirmationClassId = String(normalizedClassId);
            session.notice = { type: 'warning', message: `再次点击“确认批量加入”才会处理 ${classOption.name} 的学生。` };
            render();
            return false;
        }
        if (!beginMutation('按行政班批量加入课程')) return false;
        session.busy = true;
        session.error = null;
        render();
        try {
            session.batchResult = await session.host.request(`/api/v1/courses/${Number(session.selectedCourseId)}/enrollments/batch`, {
                method: 'POST',
                body: { class_id: normalizedClassId }
            });
            const summary = batchResultSummary(session.batchResult);
            session.notice = { type: 'success', message: `${classOption.name}：新增 ${summary.created}，已在课 ${summary.already}，曾退出 ${summary.left}，不符合 ${summary.ineligible}。` };
            session.batchConfirmationClassId = '';
            await refreshSelected({ preserveNotice: true, allowBusy: true });
            notify('success', session.notice.message);
            return true;
        } catch (error) {
            if (!isCancelled(error)) {
                session.error = error;
                await failMutation(error, '按行政班批量加入课程');
            }
            return false;
        } finally {
            finishMutation();
        }
    }

    function beginMutation(label) {
        return !session.host.beginMutation || session.host.beginMutation(label) !== false;
    }

    function finishMutation() {
        if (!session) return;
        session.busy = false;
        if (typeof session.host.endMutation === 'function') session.host.endMutation();
        render();
    }

    async function failMutation(error, label) {
        if (session && typeof session.host.failMutation === 'function') await session.host.failMutation(error, label);
    }

    function notify(type, message) {
        if (session && typeof session.host.notify === 'function') session.host.notify(type, message);
    }

    function handleClick(event) {
        if (!session || !(event.target instanceof Element)) return;
        const review = event.target.closest('[data-course-membership-review]');
        if (review) {
            void reviewRequest(review.dataset.requestId, review.dataset.courseMembershipReview);
            return;
        }
        const remove = event.target.closest('[data-course-membership-remove]');
        if (remove) {
            void removeEnrollment(remove.dataset.courseMembershipRemove);
            return;
        }
        const action = event.target.closest('[data-course-membership-action]');
        if (!action) return;
        if (action.dataset.courseMembershipAction === 'refresh') void refreshSelected({ preserveNotice: true });
        if (action.dataset.courseMembershipAction === 'retry') void refreshSelected();
    }

    function handleChange(event) {
        if (!session || !(event.target instanceof HTMLSelectElement)) return;
        if (event.target.matches('[data-course-membership-course]')) {
            session.selectedCourseId = event.target.value;
            resetCourseData();
            render();
            return;
        }
        if (event.target.matches('[data-course-membership-filter="requests"]')) {
            session.requestFilter = event.target.value === 'all' ? 'all' : 'pending';
            session.loadedCourseId = '';
            void refreshSelected();
            return;
        }
        if (event.target.matches('[data-course-membership-filter="roster"]')) {
            session.rosterFilter = event.target.value === 'all' ? 'all' : 'active';
            session.loadedCourseId = '';
            void refreshSelected();
            return;
        }
        if (event.target.matches('[data-course-membership-batch-class]')) {
            session.batchClassId = event.target.value;
            session.batchConfirmationClassId = '';
            session.notice = null;
            render();
        }
    }

    function handleInput(event) {
        if (!session || !(event.target instanceof HTMLTextAreaElement) || !event.target.matches('[data-course-membership-note]')) return;
        session.notes[String(event.target.dataset.requestId)] = event.target.value.slice(0, 500);
        session.reviewConfirmation = null;
    }

    function handleSubmit(event) {
        if (!session || !(event.target instanceof HTMLFormElement) || !event.target.matches('[data-course-membership-batch-form]')) return;
        event.preventDefault();
        if (!event.target.reportValidity()) return;
        const classId = new FormData(event.target).get('class_id');
        void batchEnroll(classId);
    }

    function render() {
        if (!session) return false;
        const container = session.root.querySelector('[data-teacher-course-membership]');
        if (!container) return false;
        const context = snapshot();
        if (!context.active || context.role !== 'teacher') {
            container.innerHTML = '<div class="teacher-course-membership__empty"><i data-lucide="shield-check"></i><div><strong>课程成员中心</strong><p>本入口仅供课程教师处理申请和名单。</p></div></div>';
            refreshIcons();
            return true;
        }
        const courses = syncSelection(context);
        if (!courses.length) {
            container.innerHTML = '<section class="teacher-course-membership"><header class="teacher-course-membership__header"><div><span>COURSE MEMBERS</span><h3>课程成员中心</h3><p>课程审核通过并生成课程码后，可在这里处理学生。</p></div></header><div class="teacher-course-membership__empty"><i data-lucide="users-round"></i><div><strong>暂无已批准课程</strong><p>当前草稿仍可在上方继续提交审核。</p></div></div></section>';
            refreshIcons();
            return true;
        }
        const course = selectedCourse(context);
        container.innerHTML = membershipMarkup(course, courses, context);
        refreshIcons();
        if (course && session.loadedCourseId !== String(course.id) && !session.loading) void refreshSelected();
        return true;
    }

    function membershipMarkup(course, courses, context) {
        const blocked = Boolean(context.blocked || session.busy);
        return `
            <section class="teacher-course-membership" aria-labelledby="teacher-course-membership-title">
                <header class="teacher-course-membership__header">
                    <div><span>COURSE MEMBERS</span><h3 id="teacher-course-membership-title">课程成员中心</h3><p>审批申请、按行政班加入、查看来源班级。</p></div>
                    <button type="button" data-course-membership-action="refresh" ${session.loading || blocked ? 'disabled' : ''}><i data-lucide="refresh-cw"></i><span>刷新</span></button>
                </header>
                <div class="teacher-course-membership__scope">
                    <label><span>当前课程</span><select data-course-membership-course ${blocked ? 'disabled' : ''}>${courses.map(item => `<option value="${escapeAttr(item.id)}"${String(item.id) === String(course.id) ? ' selected' : ''}>${escapeHtml(item.title)} · ${escapeHtml(item.course_code)}</option>`).join('')}</select></label>
                    <div><span>课程码</span><strong>${escapeHtml(course.course_code)}</strong><small>${course.admission_mode === 'class_restricted' ? '指定行政班申请' : '公开申请'}</small></div>
                </div>
                ${noticeMarkup()}
                ${session.error ? errorMarkup(session.error) : ''}
                ${session.loading ? loadingMarkup() : dataMarkup(course, context, blocked)}
            </section>`;
    }

    function dataMarkup(course, context, blocked) {
        if (session.error) return '<button type="button" class="teacher-course-membership__retry" data-course-membership-action="retry">重试读取</button>';
        const classOptions = batchClassOptions(course, context);
        return `
            <div class="teacher-course-membership__metrics" aria-label="课程成员摘要">
                <div><span>待审核</span><strong>${formatNumber(session.requestFilter === 'pending' ? session.requests.total : session.requests.items.filter(item => item.status === 'pending').length)}</strong></div>
                <div><span>在读学生</span><strong>${formatNumber(session.rosterFilter === 'active' ? session.roster.total : session.roster.items.filter(item => item.status === 'active').length)}</strong></div>
                <div><span>准入班级</span><strong>${course.admission_mode === 'class_restricted' ? formatNumber((course.admission_classes || []).length) : '公开'}</strong></div>
            </div>
            <form class="teacher-course-membership__batch" data-course-membership-batch-form>
                <label><span>按行政班批量加入</span><select name="class_id" data-course-membership-batch-class required ${blocked || !classOptions.length ? 'disabled' : ''}><option value="">选择行政班</option>${classOptions.map(item => `<option value="${escapeAttr(item.class_id)}"${session.batchClassId === String(item.class_id) ? ' selected' : ''}>${escapeHtml(classOptionLabel(item))}</option>`).join('')}</select></label>
                <button type="submit" class="${session.batchConfirmationClassId ? 'is-confirming' : ''}" ${blocked || !classOptions.length ? 'disabled' : ''}><i data-lucide="users-round"></i><span>${session.batchConfirmationClassId ? '确认批量加入' : '批量加入'}</span></button>
                ${!classOptions.length ? '<small>当前学校没有可批量加入的行政班。</small>' : '<small>曾退出或不符合资格的学生不会被自动恢复。</small>'}
            </form>
            ${session.batchResult ? batchReceiptMarkup(session.batchResult) : ''}
            <div class="teacher-course-membership__grid">
                ${requestPanelMarkup(blocked)}
                ${rosterPanelMarkup(blocked)}
            </div>`;
    }

    function requestPanelMarkup(blocked) {
        const items = session.requests.items || [];
        return `
            <section class="teacher-course-membership__panel" aria-labelledby="teacher-course-requests-title">
                <header><div><span>JOIN REQUESTS</span><h4 id="teacher-course-requests-title">加入申请</h4></div><label><span class="sr-only">申请状态</span><select data-course-membership-filter="requests" ${blocked ? 'disabled' : ''}><option value="pending"${session.requestFilter === 'pending' ? ' selected' : ''}>待审核</option><option value="all"${session.requestFilter === 'all' ? ' selected' : ''}>全部历史</option></select></label></header>
                ${items.length ? `<div class="teacher-course-membership__list">${items.map(item => requestCardMarkup(item, blocked)).join('')}</div>` : '<div class="teacher-course-membership__empty teacher-course-membership__empty--compact"><i data-lucide="inbox"></i><div><strong>没有待处理申请</strong><p>新的学生申请会显示在这里。</p></div></div>'}
            </section>`;
    }

    function requestCardMarkup(item, blocked) {
        const pending = item.status === 'pending';
        const note = session.notes[String(item.id)] || '';
        const approveKey = `${item.id}:approved:${note.trim()}`;
        const rejectKey = `${item.id}:rejected:${note.trim()}`;
        return `
            <article class="teacher-course-request" data-state="${escapeAttr(item.status)}">
                <header><div><strong>${escapeHtml(item.display_name)}</strong><span>@${escapeHtml(item.username)} · ${escapeHtml(item.source_class_name)}</span></div><em>${escapeHtml(requestStatusLabel(item.status))}</em></header>
                ${item.message ? `<p>${escapeHtml(item.message)}</p>` : '<p class="is-muted">学生未填写申请说明</p>'}
                <small>第 ${escapeHtml(item.request_number)} 次 · ${escapeHtml(formatDate(item.created_at))}</small>
                ${pending ? `<label><span>审核说明（可选）</span><textarea data-course-membership-note data-request-id="${escapeAttr(item.id)}" maxlength="500" rows="2" ${blocked ? 'disabled' : ''}>${escapeHtml(note)}</textarea></label><div class="teacher-course-request__actions"><button type="button" data-course-membership-review="rejected" data-request-id="${escapeAttr(item.id)}" class="${session.reviewConfirmation === rejectKey ? 'is-confirming' : ''}" ${blocked ? 'disabled' : ''}>${session.reviewConfirmation === rejectKey ? '再次确认退回' : '退回'}</button><button type="button" data-course-membership-review="approved" data-request-id="${escapeAttr(item.id)}" class="is-primary ${session.reviewConfirmation === approveKey ? 'is-confirming' : ''}" ${blocked ? 'disabled' : ''}>${session.reviewConfirmation === approveKey ? '再次确认批准' : '批准'}</button></div>` : `<div class="teacher-course-request__receipt"><span>${escapeHtml(item.review_note || '无审核说明')}</span><small>${escapeHtml(formatDate(item.reviewed_at))}</small></div>`}
            </article>`;
    }

    function rosterPanelMarkup(blocked) {
        const items = session.roster.items || [];
        return `
            <section class="teacher-course-membership__panel" aria-labelledby="teacher-course-roster-title">
                <header><div><span>COURSE ROSTER</span><h4 id="teacher-course-roster-title">课程名单</h4></div><label><span class="sr-only">名单状态</span><select data-course-membership-filter="roster" ${blocked ? 'disabled' : ''}><option value="active"${session.rosterFilter === 'active' ? ' selected' : ''}>在读</option><option value="all"${session.rosterFilter === 'all' ? ' selected' : ''}>全部历史</option></select></label></header>
                ${items.length ? `<div class="teacher-course-membership__list">${items.map(item => rosterCardMarkup(item, blocked)).join('')}</div>` : '<div class="teacher-course-membership__empty teacher-course-membership__empty--compact"><i data-lucide="user-round-search"></i><div><strong>课程名单为空</strong><p>批准申请或批量加入后会显示学生。</p></div></div>'}
            </section>`;
    }

    function rosterCardMarkup(item, blocked) {
        const active = item.status === 'active';
        const confirming = session.removeConfirmationId === Number(item.id);
        return `
            <article class="teacher-course-roster" data-state="${escapeAttr(item.status)}">
                <span class="teacher-course-roster__avatar">${escapeHtml(String(item.display_name || item.username || '?').slice(0, 1))}</span>
                <div><strong>${escapeHtml(item.display_name)}</strong><span>@${escapeHtml(item.username)}</span><small>${escapeHtml(item.source_class_name || '未关联班级')} · ${escapeHtml(enrollmentSourceLabel(item.source))}</small></div>
                <em>${active ? '在读' : '已退出'}</em>
                ${active ? `<button type="button" data-course-membership-remove="${escapeAttr(item.id)}" class="${confirming ? 'is-confirming' : ''}" ${blocked ? 'disabled' : ''}>${confirming ? '确认移除' : '移除'}</button>` : ''}
            </article>`;
    }

    function batchReceiptMarkup(result) {
        const summary = batchResultSummary(result);
        return `<div class="teacher-course-membership__batch-receipt" role="status"><strong>${escapeHtml(result.class_name || '批量加入结果')}</strong><span>新增 ${summary.created}</span><span>已在课 ${summary.already}</span><span>曾退出 ${summary.left}</span><span>不符合 ${summary.ineligible}</span></div>`;
    }

    function batchClassOptions(course, context) {
        if (!course) return [];
        const homerooms = Array.isArray(context && context.homerooms) ? context.homerooms : [];
        if (course.admission_mode !== 'class_restricted') return homerooms.slice();
        const allowed = new Set((course.admission_classes || []).filter(item => item.status === 'active').map(item => Number(item.class_id)));
        return homerooms.filter(item => allowed.has(Number(item.class_id)));
    }

    function classOptionLabel(item) {
        return [item.name, item.grade, item.term].filter(Boolean).join(' · ') || `行政班 #${item.class_id}`;
    }

    function noticeMarkup() {
        if (!session.notice) return '';
        return `<div class="teacher-course-membership__notice" data-type="${escapeAttr(session.notice.type)}" role="status"><i data-lucide="${session.notice.type === 'success' ? 'circle-check-big' : 'triangle-alert'}"></i><span>${escapeHtml(session.notice.message)}</span></div>`;
    }

    function errorMarkup(error) {
        return `<div class="teacher-course-membership__error" role="alert"><i data-lucide="circle-alert"></i><div><strong>课程成员读取失败</strong><p>${escapeHtml(errorMessage(error))}</p></div></div>`;
    }

    function loadingMarkup() {
        return '<div class="teacher-course-membership__loading" role="status"><i data-lucide="loader-circle"></i><span>正在读取申请与课程名单…</span></div>';
    }

    function normalizePage(value) {
        return {
            items: value.items.slice(),
            total: Number(value.total),
            limit: Number(value.limit || PAGE_LIMIT),
            offset: Number(value.offset || 0),
            next_offset: value.next_offset === undefined ? null : value.next_offset
        };
    }

    function beginRead(courseId) {
        abortRead();
        session.controller = new AbortController();
        session.generation += 1;
        return { generation: session.generation, courseId: Number(courseId), signal: session.controller.signal, controller: session.controller };
    }

    function abortRead() {
        if (session && session.controller && !session.controller.signal.aborted) session.controller.abort();
        if (session) session.controller = null;
    }

    function isCurrent(operation) {
        return Boolean(session && session.active && operation && operation.generation === session.generation && operation.controller === session.controller && Number(session.selectedCourseId) === operation.courseId && !operation.signal.aborted);
    }

    function requestStatusLabel(value) {
        return ({ pending: '待审核', approved: '已批准', rejected: '已退回' })[value] || String(value || '未知');
    }

    function enrollmentSourceLabel(value) {
        return ({ request: '学生申请', class_batch: '行政班批量加入', teacher: '教师加入', admin: '管理员加入' })[value] || String(value || '来源未知');
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

    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
    }

    function refreshIcons() {
        if (session && typeof session.host.refreshIcons === 'function') session.host.refreshIcons();
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

    global.AstraTeacherCourseMembership = Object.freeze({
        mount,
        destroy,
        render,
        contract: Object.freeze({ VERSION, approvedCourse, buildReviewPayload, batchResultSummary, pageMatches, batchClassOptions })
    });
})(window);

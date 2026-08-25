(function attachRoleWorkbenchOverview(global) {
    'use strict';

    if (global.AstraRoleWorkbenchOverview) return;

    const VERSION = '20260825v845RoleWorkbenchP0';
    const ROLES = new Set(['student', 'teacher', 'admin']);
    const ROLE_META = Object.freeze({
        student: Object.freeze({
            eyebrow: 'LEARNER HOME',
            title: '今天，从这一件事开始',
            description: '课程、作业、续学位置和教师反馈都来自当前账号的权威学习记录。',
            icon: 'sparkles'
        }),
        teacher: Object.freeze({
            eyebrow: 'TEACHING HOME',
            title: '先处理最重要的教学事项',
            description: '授课课程、学生申请、共享草稿和待批改任务按当前学校权限统一汇总。',
            icon: 'presentation'
        }),
        admin: Object.freeze({
            eyebrow: 'GOVERNANCE HOME',
            title: '先处理最需要关注的治理事项',
            description: '教师身份、课程信息和组织提醒按真实审核队列统一汇总。',
            icon: 'shield-check'
        })
    });
    const GALAXY_LABELS = Object.freeze({
        englab: '工科试验室',
        'code-space': '代码空间',
        'future-galaxy': '未来星系'
    });
    const SUBJECT_LABELS = Object.freeze({
        mathematics: '数学', physics: '物理', chemistry: '化学', algorithms: '算法', biology: '生物',
        'program-start': '程序起步', 'control-flow': '控制流程', 'data-functions': '数据与函数',
        'algorithm-thinking': '算法思维', 'debugging-testing': '调试与测试', 'challenge-submission': '挑战与提交',
        'earth-space': '地球与宇宙科学', 'engineering-systems': '工程应用', 'data-ai': '数据科学与 AI',
        'information-technology': '信息技术', 'materials-science': '材料科学', 'humanities-futures': '人文与未来'
    });
    const ASSIGNMENT_STATES = Object.freeze({
        pending: '待完成', submitted: '已提交', graded: '已批改', returned: '已退回'
    });
    const COURSE_STATUS_LABELS = Object.freeze({
        draft: '草稿', published: '已发布', archived: '已归档'
    });

    function create(host, options) {
        if (!(host instanceof Element)) throw new TypeError('工作台概览挂载点无效');
        const config = options || {};
        const role = String(config.role || '');
        if (!ROLES.has(role)) throw new TypeError('工作台概览角色无效');
        if (typeof config.request !== 'function') throw new TypeError('工作台概览读取函数无效');

        let active = true;
        let generation = 0;
        let controller = null;
        let payload = null;
        let phase = 'idle';
        let problem = null;
        const clickHandler = (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-role-workbench-action]')
                : null;
            if (!target || !host.contains(target)) return;
            if (target.dataset.roleWorkbenchAction === 'retry') {
                void refresh();
                return;
            }
            const action = actionFromControl(target);
            if (typeof config.onAction === 'function') config.onAction(action, payload);
        };

        host.dataset.roleWorkbenchOverview = role;
        host.hidden = true;
        host.addEventListener('click', clickHandler);

        function reset() {
            generation += 1;
            if (controller && !controller.signal.aborted) controller.abort();
            controller = null;
            payload = null;
            phase = 'idle';
            problem = null;
            host.hidden = true;
            host.innerHTML = '';
        }

        async function refresh() {
            if (!active) return false;
            generation += 1;
            const requestGeneration = generation;
            if (controller && !controller.signal.aborted) controller.abort();
            controller = new AbortController();
            phase = 'loading';
            problem = null;
            host.hidden = false;
            render();
            try {
                const response = await config.request('/api/v1/workbench', {
                    params: { limit: 6, offset: 0 },
                    signal: controller.signal
                });
                if (!current(requestGeneration)) return false;
                payload = validatePayload(response, role);
                phase = 'ready';
                render();
                return true;
            } catch (error) {
                if (!current(requestGeneration) || isCancelled(error)) return false;
                payload = null;
                problem = error;
                phase = 'error';
                render();
                return false;
            }
        }

        function current(requestGeneration) {
            return Boolean(active && requestGeneration === generation && controller && !controller.signal.aborted);
        }

        function render() {
            if (!active) return;
            host.hidden = false;
            host.dataset.phase = phase;
            if (phase === 'loading') host.innerHTML = loadingMarkup(role);
            else if (phase === 'error') host.innerHTML = errorMarkup(role, problem);
            else if (phase === 'ready') host.innerHTML = readyMarkup(role, payload);
            else host.innerHTML = '';
            refreshIcons(config);
        }

        function destroy() {
            if (!active) return;
            active = false;
            reset();
            host.removeEventListener('click', clickHandler);
            delete host.dataset.roleWorkbenchOverview;
        }

        return Object.freeze({
            refresh,
            reset,
            destroy,
            snapshot: () => Object.freeze({
                version: VERSION,
                role,
                phase,
                payload,
                error: problem
            })
        });
    }

    function validatePayload(value, expectedRole) {
        if (!value || typeof value !== 'object' || value.role !== expectedRole) {
            throw responseError('工作台返回的角色与当前身份不一致');
        }
        if (!value.primary_action || typeof value.primary_action !== 'object') {
            throw responseError('工作台缺少首要动作');
        }
        if (!Array.isArray(value.section_errors)) {
            throw responseError('工作台分区状态无法识别');
        }
        if (expectedRole === 'student') {
            requirePage(value.courses, '课程');
            requirePage(value.assignments, '作业');
            requirePage(value.homerooms, '行政班');
            if (!value.submissions || typeof value.submissions !== 'object') throw responseError('提交回执无法识别');
        }
        if (expectedRole === 'teacher') {
            requirePage(value.courses, '授课课程');
            requirePage(value.pending_students, '学生申请');
            requirePage(value.unpublished_drafts, '共享草稿');
            requirePage(value.pending_grading, '待批改作业');
        }
        if (expectedRole === 'admin') {
            requirePage(value.pending_teacher_applications, '教师申请');
            requirePage(value.pending_course_revisions, '课程审核');
            requirePage(value.organization_alerts, '组织提醒');
            if (!value.catalog_totals || typeof value.catalog_totals !== 'object') throw responseError('治理总数无法识别');
        }
        return value;
    }

    function requirePage(value, label) {
        if (!value || typeof value !== 'object' || !Array.isArray(value.items) || !Number.isFinite(Number(value.total))) {
            throw responseError(`${label}分区无法识别`);
        }
    }

    function responseError(message) {
        return Object.assign(new Error(message), { code: 'invalid_workbench_response' });
    }

    function readyMarkup(role, payload) {
        const meta = ROLE_META[role];
        return `
            <section class="role-workbench-overview role-workbench-overview--${escapeAttr(role)}" data-role="${escapeAttr(role)}" aria-labelledby="${escapeAttr(role)}-role-workbench-title">
                <header class="role-workbench-overview__hero">
                    <div class="role-workbench-overview__identity">
                        <span><i data-lucide="${escapeAttr(meta.icon)}"></i>${escapeHtml(meta.eyebrow)}</span>
                        <h2 id="${escapeAttr(role)}-role-workbench-title">${escapeHtml(meta.title)}</h2>
                        <p>${escapeHtml(meta.description)}</p>
                    </div>
                    <div class="role-workbench-overview__primary">
                        <span>当前唯一下一步</span>
                        <strong>${escapeHtml(payload.primary_action.label)}</strong>
                        ${actionButton(payload.primary_action, '现在去处理', 'role-workbench-overview__primary-action', 'arrow-up-right')}
                    </div>
                </header>
                ${sectionIssuesMarkup(payload.section_errors)}
                ${role === 'student' ? studentMarkup(payload) : role === 'teacher' ? teacherMarkup(payload) : adminMarkup(payload)}
                <footer class="role-workbench-overview__freshness">
                    <span><i data-lucide="database-zap"></i>读取现有业务事实，没有建立第二套工作台状态</span>
                    <time datetime="${escapeAttr(payload.generated_at || '')}">${escapeHtml(formatDate(payload.generated_at))}</time>
                </footer>
            </section>`;
    }

    function studentMarkup(payload) {
        const courses = pageItems(payload.courses);
        const assignments = pageItems(payload.assignments);
        const pendingCount = assignments.filter((item) => item.state === 'pending').length;
        const feedbackCount = count(payload.submissions.graded) + count(payload.submissions.returned);
        return `
            ${metricsMarkup([
                ['我的课程', count(payload.courses.total), 'book-open-check', 'course'],
                ['首屏待完成', pendingCount, 'clipboard-list', 'pending'],
                ['教师反馈', feedbackCount, 'message-square-text', 'feedback'],
                ['行政班身份', count(payload.homerooms.total), 'school', 'homeroom']
            ])}
            <div class="role-workbench-overview__flow role-workbench-overview__flow--student">
                ${sectionMarkup('01', '我的课程', `共 ${count(payload.courses.total)} 门`, courses.length
                    ? courses.slice(0, 3).map(studentCourseMarkup).join('')
                    : emptyMarkup('还没有加入课程', '输入教师提供的课程码即可发起申请。', 'book-dashed'))}
                ${sectionMarkup('02', '最近任务', `共 ${count(payload.assignments.total)} 项`, assignments.length
                    ? assignments.slice(0, 4).map(studentAssignmentMarkup).join('')
                    : emptyMarkup('最近没有待办', '教师发布的作业和反馈会按时间出现在这里。', 'badge-check'))}
                ${sectionMarkup('03', '继续上次学习', payload.continue_learning ? '已找到续学位置' : '暂无续学位置', payload.continue_learning
                    ? studentContinueMarkup(payload.continue_learning)
                    : emptyMarkup('还没有可恢复的位置', '开始一个已发布活动后，系统会保留最后一次学习位置。', 'history'))}
                ${sectionMarkup('04', '提交与反馈', `${count(payload.submissions.submitted) + feedbackCount} 条回执`, studentReceiptMarkup(payload))}
            </div>
            <div class="role-workbench-overview__utility">
                <div><span>05 · 课程入口</span><strong>还想学习新的课程？</strong><p>课程码只用于发现课程；加入、退出和再次申请仍由原课程成员接口处理。</p></div>
                ${actionButton({ kind: 'join_course', section: 'courses' }, '加入课程', 'role-workbench-overview__utility-action', 'plus')}
            </div>`;
    }

    function teacherMarkup(payload) {
        return `
            ${metricsMarkup([
                ['授课课程', count(payload.courses.total), 'book-open-check', 'course'],
                ['待审批学生', count(payload.pending_students.total), 'user-round-check', 'pending'],
                ['未发布草稿', count(payload.unpublished_drafts.total), 'file-pen-line', 'draft'],
                ['待批改作业', count(payload.pending_grading.total), 'clipboard-check', 'grading']
            ])}
            <div class="role-workbench-overview__flow role-workbench-overview__flow--teacher">
                ${sectionMarkup('01', '我的授课课程', `共 ${count(payload.courses.total)} 门`, pageItems(payload.courses).length
                    ? pageItems(payload.courses).slice(0, 3).map(teacherCourseMarkup).join('')
                    : emptyMarkup('还没有授课课程', '先创建课程并提交管理员审核。', 'book-plus'))}
                ${sectionMarkup('02', '待审批学生', `${count(payload.pending_students.total)} 人`, queueMarkup(
                    pageItems(payload.pending_students).slice(0, 3), teacherStudentRequestMarkup,
                    '没有待审批学生', '新的课程加入申请会出现在这里。'))}
                ${sectionMarkup('03', '有未发布修改的草稿', `${count(payload.unpublished_drafts.total)} 份`, queueMarkup(
                    pageItems(payload.unpublished_drafts).slice(0, 3), teacherDraftMarkup,
                    '共享草稿都已发布', '共同教师的新修改会在这里形成提醒。'))}
                ${sectionMarkup('04', '待批改作业', `${count(payload.pending_grading.total)} 份`, queueMarkup(
                    pageItems(payload.pending_grading).slice(0, 3), teacherGradingMarkup,
                    '暂时没有待批改作业', '学生提交后会按时间进入队列。'))}
            </div>
            <div class="role-workbench-overview__utility role-workbench-overview__utility--actions">
                ${secondaryAction('create_course', '创建课程', 'book-plus')}
                ${secondaryAction('open_course_content', '编辑与发布', 'panels-top-left')}
                ${secondaryAction('open_course_members', '课程成员', 'users-round')}
                ${secondaryAction('open_grading', '批改与学情', 'chart-no-axes-combined')}
            </div>`;
    }

    function adminMarkup(payload) {
        const totals = payload.catalog_totals;
        return `
            ${metricsMarkup([
                ['平台用户', count(totals.users), 'users-round', 'user'],
                ['授课课程', count(totals.courses), 'library-big', 'course'],
                ['启用学校', count(totals.active_schools), 'landmark', 'school'],
                ['启用行政班', count(totals.active_homerooms), 'school', 'homeroom']
            ])}
            <div class="role-workbench-overview__flow role-workbench-overview__flow--admin">
                ${sectionMarkup('01', '教师身份申请', `${count(payload.pending_teacher_applications.total)} 份待审`, queueMarkup(
                    pageItems(payload.pending_teacher_applications).slice(0, 4), adminTeacherApplicationMarkup,
                    '没有待审核教师', '新的教师申请会按提交时间进入队列。'))}
                ${sectionMarkup('02', '课程信息审核', `${count(payload.pending_course_revisions.total)} 份待审`, queueMarkup(
                    pageItems(payload.pending_course_revisions).slice(0, 4), adminCourseRevisionMarkup,
                    '没有待审核课程', '首次课程信息和运行中修改都已处理。'))}
                ${sectionMarkup('03', '学校与班级提醒', `${count(payload.organization_alerts.total)} 条`, queueMarkup(
                    pageItems(payload.organization_alerts).slice(0, 4), adminOrganizationAlertMarkup,
                    '组织状态正常', '当前没有归档或异常学校、班级需要查看。'))}
            </div>
            <div class="role-workbench-overview__utility role-workbench-overview__utility--actions">
                ${secondaryAction('open_identity_governance', '人员与教师审核', 'badge-check')}
                ${secondaryAction('open_course_governance', '课程治理', 'book-open-check')}
                ${secondaryAction('open_organization_governance', '学校与班级', 'landmark')}
                ${secondaryAction('open_catalog_governance', '用户与课程查询', 'search')}
            </div>`;
    }

    function metricsMarkup(items) {
        return `<dl class="role-workbench-overview__metrics">${items.map(([label, value, icon, tone]) => `
            <div data-tone="${escapeAttr(tone)}"><i data-lucide="${escapeAttr(icon)}"></i><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>`;
    }

    function sectionMarkup(index, title, meta, content) {
        return `<section class="role-workbench-overview__section">
            <header><span>${escapeHtml(index)}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(meta)}</p></div></header>
            <div class="role-workbench-overview__list">${content}</div>
        </section>`;
    }

    function queueMarkup(items, renderer, emptyTitle, emptyText) {
        return items.length ? items.map(renderer).join('') : emptyMarkup(emptyTitle, emptyText, 'circle-check-big');
    }

    function studentCourseMarkup(item) {
        const total = count(item.published_unit_count);
        const completed = Math.min(total, count(item.completed_unit_count));
        const percent = total ? Math.round(completed / total * 100) : 0;
        return `<article class="role-workbench-card role-workbench-card--course">
            <div class="role-workbench-card__top"><span>${escapeHtml(galaxyLabel(item.galaxy_key))} · ${escapeHtml(subjectLabel(item.subject_key))}</span><b>${item.current_release_number ? `第 ${count(item.current_release_number)} 版` : '待发布'}</b></div>
            <h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.schedule_text || '教师尚未填写上课时间')}</p>
            <div class="role-workbench-card__progress" aria-label="已完成 ${completed} / ${total}"><span style="width:${percent}%"></span></div>
            <footer><small>${completed} / ${total} 个单元</small>${actionButton({ kind: 'open_course', section: 'courses', course_id: item.course_id }, '查看课程', '', 'arrow-right')}</footer>
        </article>`;
    }

    function studentAssignmentMarkup(item) {
        const pending = item.state === 'pending';
        const feedback = item.feedback ? `<q>${escapeHtml(item.feedback)}</q>` : '';
        return `<article class="role-workbench-row" data-state="${escapeAttr(item.state)}">
            <span class="role-workbench-row__icon"><i data-lucide="${pending ? 'clipboard-pen-line' : item.state === 'returned' ? 'message-square-reply' : 'badge-check'}"></i></span>
            <div><span>${escapeHtml(item.course_title)} · ${escapeHtml(item.unit_title)}</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(dueLabel(item.due_at))}${item.score != null ? ` · ${escapeHtml(String(item.score))} 分` : ''}</p>${feedback}</div>
            ${actionButton({ kind: pending ? 'continue_assignment' : 'open_feedback', section: 'assignments', course_id: item.course_id, course_unit_id: item.course_unit_id, assignment_id: item.assignment_id }, pending ? '去完成' : '看回执', '', 'chevron-right')}
        </article>`;
    }

    function studentContinueMarkup(item) {
        return `<article class="role-workbench-resume">
            <span><i data-lucide="history"></i></span><div><small>${escapeHtml(item.course_title)}</small><h4>${escapeHtml(item.unit_title)}</h4><p>上次学习于 ${escapeHtml(formatDate(item.last_occurred_at))}</p></div>
            ${actionButton({ kind: 'continue_learning', section: 'continue_learning', course_id: item.course_id, course_unit_id: item.course_unit_id, activity_key: item.activity_key }, '继续学习', '', 'play')}
        </article>`;
    }

    function studentReceiptMarkup(payload) {
        const homerooms = pageItems(payload.homerooms);
        return `<div class="role-workbench-receipts">
            <dl><div><dt>已提交</dt><dd>${count(payload.submissions.submitted)}</dd></div><div><dt>已批改</dt><dd>${count(payload.submissions.graded)}</dd></div><div><dt>已退回</dt><dd>${count(payload.submissions.returned)}</dd></div></dl>
            <div class="role-workbench-receipts__homerooms"><span>行政班身份</span>${homerooms.length ? homerooms.slice(0, 3).map((item) => `<small>${escapeHtml([item.name, item.grade, item.term].filter(Boolean).join(' · '))}</small>`).join('') : '<small>未关联行政班；仍可加入公开课程</small>'}</div>
        </div>`;
    }

    function teacherCourseMarkup(item) {
        return `<article class="role-workbench-card role-workbench-card--course">
            <div class="role-workbench-card__top"><span>${escapeHtml(galaxyLabel(item.galaxy_key))} · ${escapeHtml(subjectLabel(item.subject_key))}</span><b>${escapeHtml(COURSE_STATUS_LABELS[item.status] || item.status || '状态未知')}</b></div>
            <h4>${escapeHtml(item.title)}</h4><p>${item.current_release_number ? `学生当前读取第 ${count(item.current_release_number)} 版` : '还没有正式发布内容'}</p>
            <footer><small>${count(item.active_student_count)} 名学生 · ${count(item.pending_student_count)} 人待审${item.has_unpublished_changes ? ' · 有未发布修改' : ''}</small>${actionButton({ kind: 'open_teaching_course', section: 'courses', course_id: item.course_id }, '管理', '', 'arrow-right')}</footer>
        </article>`;
    }

    function teacherStudentRequestMarkup(item) {
        return compactQueueItem('user-round-plus', item.student_display_name, `${item.course_title} · ${item.source_class_name}`, formatDate(item.requested_at), {
            kind: 'review_course_join_request', section: 'pending_students', course_id: item.course_id, request_id: item.request_id
        }, '审批');
    }

    function teacherDraftMarkup(item) {
        return compactQueueItem('file-pen-line', item.course_title, `共享草稿 revision ${count(item.content_draft_revision)}`, item.current_release_number ? `当前第 ${count(item.current_release_number)} 版` : '尚未首发', {
            kind: 'continue_course_draft', section: 'unpublished_drafts', course_id: item.course_id
        }, '继续备课');
    }

    function teacherGradingMarkup(item) {
        return compactQueueItem('clipboard-check', item.assignment_title, `${item.student_display_name} · ${item.course_title}`, formatDate(item.submitted_at), {
            kind: 'grade_submission', section: 'pending_grading', course_id: item.course_id, course_unit_id: item.course_unit_id, assignment_id: item.assignment_id
        }, '批改');
    }

    function adminTeacherApplicationMarkup(item) {
        return compactQueueItem('badge-check', item.display_name, `账号 ${item.username}`, item.message || formatDate(item.submitted_at), {
            kind: 'review_teacher_application', section: 'pending_teacher_applications', request_id: item.application_id
        }, '审核');
    }

    function adminCourseRevisionMarkup(item) {
        return compactQueueItem('book-open-check', item.course_title, `信息修订第 ${count(item.revision_number)} 版`, formatDate(item.submitted_at), {
            kind: 'review_course_information', section: 'pending_course_revisions', course_id: item.course_id, revision_id: item.revision_id
        }, '审核');
    }

    function adminOrganizationAlertMarkup(item) {
        return compactQueueItem(item.kind === 'school' ? 'landmark' : 'school', item.name, item.kind === 'school' ? '学校状态提醒' : '行政班状态提醒', item.status || '状态未知', {
            kind: 'review_organization_alert', section: 'organization_alerts', resource_id: item.resource_id
        }, '查看');
    }

    function compactQueueItem(icon, title, meta, detail, action, label) {
        return `<article class="role-workbench-row role-workbench-row--compact">
            <span class="role-workbench-row__icon"><i data-lucide="${escapeAttr(icon)}"></i></span><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(meta)}</p><small>${escapeHtml(detail)}</small></div>
            ${actionButton(action, label, '', 'chevron-right')}
        </article>`;
    }

    function secondaryAction(kind, label, icon) {
        return actionButton({ kind, section: 'utility' }, label, 'role-workbench-overview__secondary-action', icon);
    }

    function actionButton(action, label, className, icon) {
        return `<button type="button" class="${escapeAttr(className || 'role-workbench-overview__row-action')}" ${actionAttributes(action)}><span>${escapeHtml(label)}</span><i data-lucide="${escapeAttr(icon || 'arrow-right')}"></i></button>`;
    }

    function actionAttributes(action) {
        const source = action || {};
        const values = {
            'data-role-workbench-action': source.kind || 'open_governance',
            'data-section': source.section || '',
            'data-course-id': source.course_id,
            'data-course-unit-id': source.course_unit_id,
            'data-assignment-id': source.assignment_id,
            'data-request-id': source.request_id,
            'data-revision-id': source.revision_id,
            'data-resource-id': source.resource_id,
            'data-activity-key': source.activity_key
        };
        return Object.entries(values)
            .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
            .map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(' ');
    }

    function actionFromControl(control) {
        return Object.freeze({
            kind: String(control.dataset.roleWorkbenchAction || ''),
            section: String(control.dataset.section || ''),
            course_id: positiveNumber(control.dataset.courseId),
            course_unit_id: positiveNumber(control.dataset.courseUnitId),
            assignment_id: positiveNumber(control.dataset.assignmentId),
            request_id: positiveNumber(control.dataset.requestId),
            revision_id: positiveNumber(control.dataset.revisionId),
            resource_id: positiveNumber(control.dataset.resourceId),
            activity_key: String(control.dataset.activityKey || '')
        });
    }

    function emptyMarkup(title, text, icon) {
        return `<div class="role-workbench-overview__empty"><i data-lucide="${escapeAttr(icon)}"></i><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div></div>`;
    }

    function sectionIssuesMarkup(issues) {
        if (!Array.isArray(issues) || !issues.length) return '';
        return `<div class="role-workbench-overview__issues" role="status"><i data-lucide="triangle-alert"></i><div><strong>部分信息暂时不可用</strong><p>${issues.map((item) => escapeHtml(sectionIssueLabel(item.section))).join('、')}读取失败；其他分区仍来自本次权威读取。</p></div></div>`;
    }

    function sectionIssueLabel(section) {
        return ({
            courses: '课程', assignments: '作业', continue_learning: '续学位置', submissions: '提交回执', homerooms: '行政班',
            pending_students: '学生申请', unpublished_drafts: '共享草稿', pending_grading: '待批改作业',
            pending_teacher_applications: '教师申请', pending_course_revisions: '课程审核', organization_alerts: '组织提醒', catalog_totals: '治理总数'
        })[section] || String(section || '未知分区');
    }

    function loadingMarkup(role) {
        const meta = ROLE_META[role];
        return `<section class="role-workbench-overview role-workbench-overview--${escapeAttr(role)} is-loading" data-role="${escapeAttr(role)}" aria-busy="true">
            <header class="role-workbench-overview__loading-head"><span><i data-lucide="loader-circle"></i>${escapeHtml(meta.eyebrow)}</span><strong>正在整理你的首要事项</strong><p>只读取一次角色工作台聚合，不会改变课程、审核或学习数据。</p></header>
            <div class="role-workbench-overview__skeleton" aria-hidden="true">${Array.from({ length: 4 }, () => '<span></span>').join('')}</div>
        </section>`;
    }

    function errorMarkup(role, error) {
        const message = global.AstraApiClient && typeof global.AstraApiClient.message === 'function'
            ? global.AstraApiClient.message(error)
            : error && error.message || '工作台读取失败，请稍后重试。';
        return `<section class="role-workbench-overview role-workbench-overview--${escapeAttr(role)} is-error" data-role="${escapeAttr(role)}" role="alert">
            <div class="role-workbench-overview__error"><span><i data-lucide="cloud-off"></i></span><div><strong>首屏摘要没有完成读取</strong><p>${escapeHtml(message)}</p><small>详情中的既有数据和写入状态没有被概览层改动。</small></div>
            <button type="button" data-role-workbench-action="retry"><i data-lucide="refresh-cw"></i><span>重试读取</span></button></div>
        </section>`;
    }

    function pageItems(page) {
        return page && Array.isArray(page.items) ? page.items : [];
    }

    function galaxyLabel(key) {
        return GALAXY_LABELS[key] || key || '未分类星系';
    }

    function subjectLabel(key) {
        return SUBJECT_LABELS[key] || key || '未分类学科';
    }

    function dueLabel(value) {
        if (!value) return '未设置截止时间';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '截止时间待核对';
        const overdue = date.getTime() < Date.now();
        return `${overdue ? '已到期' : '截止'} ${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    }

    function formatDate(value) {
        if (!value) return '刚刚更新';
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '更新时间待核对';
    }

    function count(value) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
    }

    function positiveNumber(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : 0;
    }

    function isCancelled(error) {
        return Boolean(error && (error.name === 'AbortError' || error.code === 'cancelled')
            || global.AstraApiClient && typeof global.AstraApiClient.isCancelled === 'function' && global.AstraApiClient.isCancelled(error));
    }

    function refreshIcons(config) {
        if (typeof config.refreshIcons === 'function') {
            config.refreshIcons();
            return;
        }
        if (global.lucide && typeof global.lucide.createIcons === 'function') {
            try { global.lucide.createIcons(); } catch (error) {}
        }
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

    global.AstraRoleWorkbenchOverview = Object.freeze({
        create,
        contract: Object.freeze({ VERSION, roles: Object.freeze(Array.from(ROLES)), validatePayload, actionFromControl })
    });
})(window);

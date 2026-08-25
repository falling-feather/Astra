(function attachTeacherCourseContent(global) {
    'use strict';

    if (global.AstraTeacherCourseContent) return;

    const VERSION = '20260825v844CourseCompletionP1';
    const STYLE_VERSION = VERSION;
    const EXPECTED_ACTIVITY_COUNT = 127;
    const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
    const RAW_HTML_PATTERN = /<!--|<\s*\/?\s*[a-zA-Z][^>]*>/i;
    const DANGEROUS_LINK_PATTERN = /(?:\]\(\s*|<\s*)(?:(?:javascript|vbscript)\s*:|data\s*:\s*text\/html)/i;
    const BLOCK_TYPES = Object.freeze([
        Object.freeze({ type: 'hero', label: '单元导入', icon: 'sparkles', help: '用短标题和摘要建立本单元入口。' }),
        Object.freeze({ type: 'learning-task', label: '学习任务', icon: 'list-checks', help: '写清任务、步骤、目标和核心概念。' }),
        Object.freeze({ type: 'rich-text', label: '正文讲解', icon: 'text', help: '使用安全 Markdown 编写正文，不接受 HTML。' }),
        Object.freeze({ type: 'media', label: '媒体资源', icon: 'image', help: '引用平台注册素材，并补充无障碍说明。' }),
        Object.freeze({ type: 'official-simulation', label: '活动引用', icon: 'orbit', help: '引用当前 127 项正式活动，不改动活动本体。' }),
        Object.freeze({ type: 'checkpoint', label: '即时检查', icon: 'badge-check', help: '设置选择、数值或简答检查点。' }),
        Object.freeze({ type: 'sources', label: '参考来源', icon: 'library', help: '记录可追溯的 http/https 资料。' })
    ]);
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

    let session = null;
    let localUnitSequence = 0;

    function mount(root, host) {
        destroy();
        if (!root || !host || typeof host.snapshot !== 'function' || typeof host.request !== 'function') return false;
        ensureStylesheet();
        session = {
            root,
            host,
            selectedCourseId: '',
            loadedCourseId: '',
            draftRevision: 0,
            draftStatus: '',
            units: [],
            assignments: [],
            releases: [],
            selectedUnitKey: '',
            selectedReleaseId: '',
            mode: 'edit',
            addBlockType: 'hero',
            loading: false,
            busy: false,
            generation: 0,
            dirty: false,
            error: null,
            notice: null,
            validationErrors: [],
            conflict: null,
            pendingScope: null,
            pendingDeleteUnitKey: '',
            pendingDeleteBlockId: '',
            publishConfirm: false,
            publishNote: '',
            collapsedBlocks: new Set(),
            onClick: handleClick,
            onInput: handleInput,
            onChange: handleChange
        };
        root.addEventListener('click', session.onClick);
        root.addEventListener('input', session.onInput);
        root.addEventListener('change', session.onChange);
        render();
        return true;
    }

    function destroy() {
        if (!session) return;
        session.generation += 1;
        session.root.removeEventListener('click', session.onClick);
        session.root.removeEventListener('input', session.onInput);
        session.root.removeEventListener('change', session.onChange);
        session = null;
    }

    function render() {
        if (!session) return false;
        const container = session.root.querySelector('[data-teacher-course-content]');
        if (!container) return false;
        const context = safeSnapshot();
        if (!context.active || context.role !== 'teacher') {
            container.innerHTML = '';
            return true;
        }
        const courses = approvedCourses(context.courses);
        reconcileSelectedCourse(courses);
        container.innerHTML = contentMarkup(context, courses);
        refreshIcons();
        if (session.selectedCourseId && session.loadedCourseId !== session.selectedCourseId && !session.loading) {
            void loadCourse(session.selectedCourseId);
        }
        return true;
    }

    function refreshIcons() {
        const iconRuntime = global.lucide;
        if (!iconRuntime || typeof iconRuntime.createIcons !== 'function') return;
        try {
            iconRuntime.createIcons({
                attrs: { 'stroke-width': 1.8 },
                root: session && session.root || global.document
            });
        } catch (error) {}
    }

    function ensureStylesheet() {
        if (!global.document || !global.document.head) return;
        const id = 'astra-teacher-course-content-style';
        if (global.document.getElementById(id)) return;
        const link = global.document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = `pages/teacher/teacher-course-content.css?v=${STYLE_VERSION}`;
        global.document.head.appendChild(link);
    }

    function safeSnapshot() {
        const value = session && session.host.snapshot();
        return value && typeof value === 'object' ? value : {};
    }

    function approvedCourses(values) {
        return (Array.isArray(values) ? values : []).filter(course => (
            course && Number(course.id) > 0 && course.status === 'published' && String(course.course_code || '').trim()
        ));
    }

    function reconcileSelectedCourse(courses) {
        if (!session) return;
        const currentExists = courses.some(course => String(course.id) === String(session.selectedCourseId));
        if (currentExists) return;
        session.selectedCourseId = courses.length ? String(courses[0].id) : '';
        session.loadedCourseId = '';
        session.selectedUnitKey = '';
        session.selectedReleaseId = '';
        session.units = [];
        session.assignments = [];
        session.releases = [];
        session.dirty = false;
        session.error = null;
        session.conflict = null;
    }

    async function loadCourse(courseId, options = {}) {
        if (!session || session.loading || !courseId) return false;
        const generation = ++session.generation;
        const requestedCourseId = String(courseId);
        session.loading = true;
        session.error = null;
        session.validationErrors = [];
        if (!options.preserveNotice) session.notice = null;
        render();
        try {
            const [draft, releases, assignments] = await Promise.all([
                session.host.request(`/api/v1/courses/${requestedCourseId}/draft`),
                session.host.request(`/api/v1/courses/${requestedCourseId}/releases`),
                session.host.request(`/api/courses/${requestedCourseId}/assignments`)
            ]);
            if (!isCurrent(generation, requestedCourseId)) return false;
            applyRemoteDraft(draft);
            session.releases = Array.isArray(releases) ? releases.slice() : [];
            session.assignments = (Array.isArray(assignments) ? assignments : []).filter(item => (
                positiveInteger(item && item.id) && positiveInteger(item && item.unit_id)
            ));
            session.loadedCourseId = requestedCourseId;
            session.selectedCourseId = requestedCourseId;
            session.selectedReleaseId = session.releases.length ? String(session.releases[0].id) : '';
            session.conflict = null;
            session.pendingScope = null;
            session.publishConfirm = false;
            return true;
        } catch (error) {
            if (!isCurrent(generation, requestedCourseId) || isCancelled(error)) return false;
            session.error = error;
            session.loadedCourseId = requestedCourseId;
            return false;
        } finally {
            if (session && generation === session.generation) {
                session.loading = false;
                render();
            }
        }
    }

    function isCurrent(generation, courseId) {
        return Boolean(session && generation === session.generation && String(session.selectedCourseId) === String(courseId));
    }

    function isCancelled(error) {
        return Boolean(global.AstraApiClient && typeof global.AstraApiClient.isCancelled === 'function'
            && global.AstraApiClient.isCancelled(error));
    }

    function applyRemoteDraft(value) {
        const draft = value && typeof value === 'object' ? value : {};
        const normalized = (Array.isArray(draft.units) ? draft.units : []).map(normalizeRemoteUnit);
        session.draftRevision = Number.isInteger(Number(draft.revision)) ? Number(draft.revision) : 0;
        session.draftStatus = String(draft.status || 'published');
        session.units = normalized;
        session.dirty = normalized.some(unit => unit.generatedContent === true);
        session.selectedUnitKey = normalized.some(unit => unit.localKey === session.selectedUnitKey)
            ? session.selectedUnitKey
            : normalized[0] && normalized[0].localKey || '';
        session.validationErrors = [];
    }

    function normalizeRemoteUnit(value) {
        const source = value && typeof value === 'object' ? value : {};
        const activityKey = String(source.activity_key || '').trim();
        const title = String(source.title || activityTitleByKey(activityKey) || activityKey || '未命名单元').trim();
        const content = source.content && typeof source.content === 'object' ? deepClone(source.content) : null;
        const generatedContent = !content;
        const normalizedContent = content || defaultContentPage({
            id: source.id,
            activity_key: activityKey,
            title,
            position: source.position
        }, selectedCourseFromSnapshot());
        return {
            id: positiveInteger(source.id),
            localKey: source.id ? `unit-${source.id}` : nextLocalUnitKey(),
            activity_key: activityKey,
            title,
            summary: String(normalizedContent.summary || `引用“${title}”，用于课程内的活动安排。`),
            position: positiveInteger(source.position) || 1,
            content_slug: source.content_slug || '',
            last_editor_user_id: positiveInteger(source.last_editor_user_id),
            blocks: Array.isArray(normalizedContent.blocks) ? deepClone(normalizedContent.blocks) : [],
            completion: normalizeCompletion(normalizedContent.courseUnit && normalizedContent.courseUnit.completion),
            generatedContent
        };
    }

    function defaultContentPage(unit, course) {
        const title = String(unit.title || activityTitleByKey(unit.activity_key) || unit.activity_key || '新单元');
        return {
            schemaVersion: 'astra-content-page-v2',
            slug: `courses/${Number(course && course.id) || 1}/${String(unit.activity_key || 'new-unit')}`,
            galaxy: String(course && course.galaxy_key || 'englab'),
            subject: String(course && course.subject_key || 'physics'),
            title,
            summary: `引用“${title}”，用于课程内的活动安排。`,
            layout: 'course-page',
            status: 'draft',
            version: `draft-r${session ? session.draftRevision : 0}`,
            blocks: [createBlock('official-simulation', unit)]
        };
    }

    function selectedCourseFromSnapshot() {
        const context = safeSnapshot();
        return approvedCourses(context.courses).find(course => String(course.id) === String(session && session.selectedCourseId)) || null;
    }

    function contentMarkup(context, courses) {
        const blocked = Boolean(context.blocked || session.busy);
        return `
            <section class="teacher-course-content" aria-labelledby="teacher-course-content-title" aria-busy="${session.loading || session.busy ? 'true' : 'false'}">
                <header class="teacher-course-content__header">
                    <div><span>COURSE CONTENT</span><h4 id="teacher-course-content-title">课程内容中心</h4><p>共同教师维护同一份结构化草稿；发布只影响课程入口，不改动 127 项独立活动本体。</p></div>
                    ${courses.length ? `<button type="button" data-course-content-action="refresh" ${blocked || session.loading ? 'disabled' : ''}><i data-lucide="refresh-cw"></i><span>刷新内容</span></button>` : ''}
                </header>
                ${courses.length ? courseWorkspaceMarkup(context, courses, blocked) : noApprovedCourseMarkup()}
            </section>`;
    }

    function noApprovedCourseMarkup() {
        return '<div class="teacher-course-content__empty"><i data-lucide="book-lock"></i><div><strong>还没有可编辑的正式课程</strong><p>课程信息经管理员通过并生成课程码后，才会在这里建立共享内容草稿。</p></div></div>';
    }

    function courseWorkspaceMarkup(context, courses, blocked) {
        const course = courses.find(item => String(item.id) === String(session.selectedCourseId)) || courses[0];
        return `
            <div class="teacher-course-content__scope">
                <label><span>正在编辑</span><select data-course-content-course ${blocked ? 'disabled' : ''}>${courses.map(item => `<option value="${escapeAttr(item.id)}"${String(item.id) === String(course.id) ? ' selected' : ''}>${escapeHtml(item.title)} · ${escapeHtml(item.course_code)}</option>`).join('')}</select></label>
                <div><span>共享草稿</span><strong>revision ${escapeHtml(session.draftRevision)}</strong></div>
                <div><span>发布状态</span><strong>${escapeHtml(releaseStatusLabel(course))}</strong></div>
                <div data-course-content-dirty data-state="${session.dirty ? 'dirty' : 'saved'}"><span>${session.dirty ? '有未保存修改' : '已与服务器同步'}</span></div>
            </div>
            ${catalogBoundaryMarkup()}
            ${session.notice ? noticeMarkup(session.notice) : ''}
            ${session.pendingScope ? pendingScopeMarkup() : ''}
            ${session.conflict ? conflictMarkup() : ''}
            ${session.error ? errorMarkup(session.error) : ''}
            ${session.validationErrors.length ? validationMarkup(session.validationErrors) : ''}
            ${session.loading ? loadingMarkup() : session.loadedCourseId === String(course.id) ? loadedWorkspaceMarkup(course, blocked) : loadingMarkup()}`;
    }

    function releaseStatusLabel(course) {
        const latest = session.releases.reduce((current, item) => (
            !current || Number(item.release_number) > Number(current.release_number) ? item : current
        ), null);
        return latest
            ? `已发布 · 第 ${latest.release_number} 版`
            : String(course && course.content_status_label || '暂无已发布内容');
    }

    function catalogBoundaryMarkup() {
        const entries = activityEntries();
        const ready = entries.length === EXPECTED_ACTIVITY_COUNT;
        return `<div class="teacher-course-content__catalog" data-state="${ready ? 'ready' : 'error'}"><i data-lucide="${ready ? 'orbit' : 'triangle-alert'}"></i><p><strong>${ready ? '正式活动目录已就绪' : '活动目录数量异常'}</strong><span>${ready ? `当前可引用 ${entries.length} 项活动；星系和学科只用于筛选。` : `预期 ${EXPECTED_ACTIVITY_COUNT} 项，当前读取 ${entries.length} 项；为避免引用未知内容，新增单元已停止。`}</span></p></div>`;
    }

    function loadedWorkspaceMarkup(course, blocked) {
        return `
            <nav class="teacher-course-content__tabs" aria-label="课程内容视图">
                ${[['edit', '编辑草稿', 'pencil-line'], ['preview', '课程预览', 'scan-eye'], ['history', '发布历史', 'history']].map(([mode, label, icon]) => `<button type="button" data-course-content-action="mode" data-mode="${mode}" data-active="${session.mode === mode ? 'true' : 'false'}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}
            </nav>
            ${session.mode === 'edit' ? editorMarkup(course, blocked) : session.mode === 'preview' ? previewMarkup(course, false) : historyMarkup(course)}`;
    }

    function loadingMarkup() {
        return '<div class="teacher-course-content__loading" role="status"><i data-lucide="loader-circle"></i><span>正在读取共享草稿与发布历史…</span></div>';
    }

    function errorMarkup(error) {
        return `<div class="teacher-course-content__error" role="alert"><i data-lucide="circle-alert"></i><div><strong>课程内容读取失败</strong><p>${escapeHtml(errorMessage(error))}</p></div><button type="button" data-course-content-action="retry">重试</button></div>`;
    }

    function noticeMarkup(notice) {
        return `<div class="teacher-course-content__notice" data-type="${escapeAttr(notice.type || 'info')}" role="status"><i data-lucide="${notice.type === 'success' ? 'circle-check-big' : notice.type === 'warning' ? 'triangle-alert' : 'info'}"></i><span>${escapeHtml(notice.message)}</span></div>`;
    }

    function validationMarkup(errors) {
        return `<div class="teacher-course-content__validation" role="alert"><i data-lucide="list-x"></i><div><strong>还不能保存</strong><p>${errors.slice(0, 4).map(escapeHtml).join('；')}${errors.length > 4 ? `；另有 ${errors.length - 4} 项` : ''}</p></div></div>`;
    }

    function pendingScopeMarkup() {
        const target = session.pendingScope && session.pendingScope.type === 'course' ? '切换课程' : '重新读取服务器草稿';
        return `<div class="teacher-course-content__decision" role="alertdialog" aria-label="未保存修改确认"><div><strong>当前修改尚未保存</strong><p>${target}会舍弃本地修改；已发布版本不受影响。</p></div><div><button type="button" data-course-content-action="cancel-scope">继续编辑</button><button type="button" class="is-danger" data-course-content-action="confirm-scope">舍弃并${target}</button></div></div>`;
    }

    function conflictMarkup() {
        const conflict = session.conflict;
        return `<div class="teacher-course-content__conflict" role="alertdialog" aria-label="共享草稿冲突"><div><span>REVISION CONFLICT</span><h5>另一位教师已经更新了共享草稿</h5><p>本地基于 revision ${escapeHtml(conflict.localRevision)}，服务器当前为 revision ${escapeHtml(conflict.remote && conflict.remote.revision)}。系统没有覆盖任何一方，也不会自动重试写入。</p></div><div class="teacher-course-content__conflict-actions"><button type="button" data-course-content-action="export-local"><i data-lucide="download"></i>导出本地副本</button><button type="button" data-course-content-action="use-remote">采用服务器草稿</button><button type="button" class="is-warning" data-course-content-action="keep-local">以最新代际保留本地内容</button></div><small>“保留本地内容”只更新预期 revision，不会立即写入；请复核后再次点击保存。</small></div>`;
    }

    function editorMarkup(course, blocked) {
        const unit = selectedUnit();
        return `
            <div class="teacher-course-content__editor">
                ${unitListMarkup(course, blocked)}
                <main class="teacher-course-content__canvas">
                    ${unit ? unitEditorMarkup(course, unit, blocked) : emptyDraftMarkup(blocked)}
                </main>
            </div>
            ${editorActionsMarkup(course, blocked)}`;
    }

    function unitListMarkup(course, blocked) {
        const entries = activityEntries();
        const available = entries.filter(entry => !session.units.some(unit => unit.activity_key === entry.activity_key));
        return `
            <aside class="teacher-course-content__units" aria-label="课程章节与单元">
                <header><div><span>CHAPTERS / UNITS</span><strong>章节与单元</strong></div><em>${session.units.length}</em></header>
                <div class="teacher-course-content__unit-list">
                    ${session.units.length ? session.units.map((unit, index) => unitListItemMarkup(unit, index, blocked)).join('') : '<div class="teacher-course-content__unit-empty">还没有单元；先从正式活动目录选择一项。</div>'}
                </div>
                <div class="teacher-course-content__unit-add">
                    <label><span>引用正式活动</span><select data-course-content-add-activity ${blocked || !available.length || entries.length !== EXPECTED_ACTIVITY_COUNT ? 'disabled' : ''}>${activityOptions(available, '')}</select></label>
                    <button type="button" data-course-content-action="add-unit" ${blocked || !available.length || entries.length !== EXPECTED_ACTIVITY_COUNT ? 'disabled' : ''}><i data-lucide="plus"></i><span>添加单元</span></button>
                </div>
            </aside>`;
    }

    function unitListItemMarkup(unit, index, blocked) {
        const active = unit.localKey === session.selectedUnitKey;
        const pendingDelete = session.pendingDeleteUnitKey === unit.localKey;
        return `<article class="teacher-course-content__unit" data-active="${active ? 'true' : 'false'}">
            <button type="button" class="teacher-course-content__unit-main" data-course-content-action="select-unit" data-unit-key="${escapeAttr(unit.localKey)}"><span>${String(index + 1).padStart(2, '0')}</span><p><strong>${escapeHtml(unit.title)}</strong><small>${escapeHtml(unit.activity_key)}</small></p></button>
            <div class="teacher-course-content__unit-order"><button type="button" title="上移" data-course-content-action="move-unit" data-direction="-1" data-unit-key="${escapeAttr(unit.localKey)}" ${blocked || index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button><button type="button" title="下移" data-course-content-action="move-unit" data-direction="1" data-unit-key="${escapeAttr(unit.localKey)}" ${blocked || index === session.units.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button><button type="button" title="${pendingDelete ? '确认移除' : '移除'}" data-course-content-action="delete-unit" data-unit-key="${escapeAttr(unit.localKey)}" data-confirm="${pendingDelete ? 'true' : 'false'}" ${blocked ? 'disabled' : ''}><i data-lucide="${pendingDelete ? 'badge-check' : 'trash-2'}"></i></button></div>
        </article>`;
    }

    function emptyDraftMarkup(blocked) {
        return `<div class="teacher-course-content__canvas-empty"><i data-lucide="panels-top-left"></i><h5>从一个活动单元开始</h5><p>课程只负责组织、说明与发布；实验和互动页面保持原样。</p>${blocked ? '<span>当前写入暂不可用。</span>' : ''}</div>`;
    }

    function unitEditorMarkup(course, unit, blocked) {
        return `
            <section class="teacher-course-content__unit-editor" data-unit-key="${escapeAttr(unit.localKey)}">
                <header><div><span>UNIT ${escapeHtml(session.units.indexOf(unit) + 1)}</span><h5>${escapeHtml(unit.title)}</h5><p>${escapeHtml(unit.activity_key)}</p></div><strong>${unit.blocks.length} 个内容块</strong></header>
                <div class="teacher-course-content__unit-fields">
                    <label><span>正式活动</span><select data-course-content-unit-field="activity_key" data-unit-key="${escapeAttr(unit.localKey)}" ${blocked ? 'disabled' : ''}>${activityOptions(activityEntries(), unit.activity_key, session.units.filter(item => item.localKey !== unit.localKey).map(item => item.activity_key))}</select></label>
                    <label><span>单元标题</span><input data-course-content-unit-field="title" data-unit-key="${escapeAttr(unit.localKey)}" value="${escapeAttr(unit.title)}" maxlength="180" ${blocked ? 'disabled' : ''}></label>
                    <label class="is-wide"><span>单元摘要</span><textarea data-course-content-unit-field="summary" data-unit-key="${escapeAttr(unit.localKey)}" rows="2" maxlength="4000" ${blocked ? 'disabled' : ''}>${escapeHtml(unit.summary)}</textarea></label>
                </div>
                ${completionMarkup(unit, blocked)}
                <div class="teacher-course-content__blocks">
                    ${unit.blocks.map((block, index) => blockMarkup(unit, block, index, blocked)).join('')}
                </div>
                <div class="teacher-course-content__block-add"><label><span>新增内容块</span><select data-course-content-add-block ${blocked ? 'disabled' : ''}>${BLOCK_TYPES.map(item => `<option value="${item.type}"${item.type === session.addBlockType ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label><button type="button" data-course-content-action="add-block" ${blocked ? 'disabled' : ''}><i data-lucide="blocks"></i><span>加入当前单元</span></button></div>
            </section>`;
    }

    function completionMarkup(unit, blocked) {
        const completion = normalizeCompletion(unit.completion);
        const preset = completion && completion.preset || '';
        const checkpoints = (unit.blocks || []).filter(block => block.type === 'checkpoint' && block.mode !== 'question-set');
        const assignments = (session.assignments || []).filter(item => (
            Number(item.unit_id) === Number(unit.id) && item.status === 'active'
        ));
        let target = '';
        if (preset === 'checkpoint_passed') {
            target = `<label><span>作为完成依据的检查点</span><select data-course-content-completion-target="checkpointKey" data-unit-key="${escapeAttr(unit.localKey)}" ${blocked || !checkpoints.length ? 'disabled' : ''}><option value="">请选择检查点</option>${checkpoints.map(item => `<option value="${escapeAttr(item.checkpointKey)}"${item.checkpointKey === completion.checkpointKey ? ' selected' : ''}>${escapeHtml(item.title)} · ${escapeHtml(item.checkpointKey)}</option>`).join('')}</select></label>`;
        }
        if (preset === 'assignment_reviewed') {
            target = `<label><span>作为完成依据的作业</span><select data-course-content-completion-target="assignmentId" data-unit-key="${escapeAttr(unit.localKey)}" ${blocked || !assignments.length ? 'disabled' : ''}><option value="">请选择作业</option>${assignments.map(item => `<option value="${escapeAttr(item.id)}"${Number(item.id) === Number(completion.assignmentId) ? ' selected' : ''}>${escapeHtml(item.title)} · #${escapeHtml(item.id)}</option>`).join('')}</select></label>`;
        }
        const hint = preset === 'experiment_operation'
            ? '学生在本单元正式活动中完成一次由服务器接收的操作后记为完成。'
            : preset === 'checkpoint_passed'
                ? (checkpoints.length ? '学生首次答对所选检查点后记为完成。' : '请先在本单元加入一个即时检查块。')
                : preset === 'assignment_reviewed'
                    ? (assignments.length ? '学生提交后，由课程教师完成评分或反馈才记为完成。' : '请先保存单元，再在作业区为该单元创建作业。')
                    : '草稿可以暂不选择，但发布前每个单元都必须明确一种完成方式。';
        return `<section class="teacher-course-content__completion" data-state="${preset ? 'configured' : 'missing'}"><header><div><span>UNIT COMPLETION</span><strong>学生怎样算完成本单元</strong></div><em>${preset ? '已选择' : '发布前必选'}</em></header><div><label><span>完成方式</span><select data-course-content-completion-preset data-unit-key="${escapeAttr(unit.localKey)}" ${blocked ? 'disabled' : ''}><option value="">请选择</option><option value="experiment_operation"${preset === 'experiment_operation' ? ' selected' : ''}>完成一次实验操作</option><option value="checkpoint_passed"${preset === 'checkpoint_passed' ? ' selected' : ''}>答对指定检查点</option><option value="assignment_reviewed"${preset === 'assignment_reviewed' ? ' selected' : ''}>提交作业并完成批改</option></select></label>${target}</div><p>${escapeHtml(hint)}</p></section>`;
    }

    function blockMarkup(unit, block, index, blocked) {
        const meta = blockMeta(block.type);
        const key = `${unit.localKey}:${block.blockId}`;
        const collapsed = session.collapsedBlocks.has(key);
        const pendingDelete = session.pendingDeleteBlockId === key;
        return `<article class="teacher-course-content__block" data-block-type="${escapeAttr(block.type)}">
            <header><button type="button" class="teacher-course-content__block-title" data-course-content-action="toggle-block" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}"><i data-lucide="${meta.icon}"></i><span><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(block.blockId)}</small></span><i data-lucide="${collapsed ? 'chevron-down' : 'chevron-up'}"></i></button><div><button type="button" title="上移" data-course-content-action="move-block" data-direction="-1" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button><button type="button" title="下移" data-course-content-action="move-block" data-direction="1" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || index === unit.blocks.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button><button type="button" title="${pendingDelete ? '确认移除' : '移除'}" data-course-content-action="delete-block" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" data-confirm="${pendingDelete ? 'true' : 'false'}" ${blocked ? 'disabled' : ''}><i data-lucide="${pendingDelete ? 'badge-check' : 'trash-2'}"></i></button></div></header>
            ${collapsed ? '' : `<div class="teacher-course-content__block-body"><p class="teacher-course-content__block-help">${escapeHtml(meta.help)}</p>${blockFieldsMarkup(unit, block, blocked)}</div>`}
        </article>`;
    }

    function blockFieldsMarkup(unit, block, blocked) {
        const field = (name, label, value, options = {}) => {
            const numeric = [
                options.min !== undefined ? `min="${escapeAttr(options.min)}"` : '',
                options.max !== undefined ? `max="${escapeAttr(options.max)}"` : '',
                options.step !== undefined ? `step="${escapeAttr(options.step)}"` : ''
            ].filter(Boolean).join(' ');
            return `<label class="${options.wide ? 'is-wide' : ''}"><span>${escapeHtml(label)}</span>${options.textarea ? `<textarea data-course-content-block-field="${name}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" rows="${options.rows || 3}" maxlength="${options.maxlength || 16000}" ${blocked ? 'disabled' : ''}>${escapeHtml(value || '')}</textarea>` : `<input data-course-content-block-field="${name}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(value || '')}" maxlength="${options.maxlength || 4000}" ${options.type ? `type="${options.type}"` : ''} ${numeric} ${blocked ? 'disabled' : ''}>`}</label>`;
        };
        if (block.type === 'hero') return `<div class="teacher-course-content__field-grid">${field('title', '标题', block.title, { maxlength: 240 })}${field('eyebrow', '眉题（可选）', block.eyebrow, { maxlength: 120 })}${field('summary', '摘要', block.summary, { textarea: true, wide: true, maxlength: 4000 })}${field('badges', '标签（每行一个）', (block.badges || []).join('\n'), { textarea: true, wide: true, rows: 2, maxlength: 328 })}</div>`;
        if (block.type === 'learning-task') return `<div class="teacher-course-content__field-grid">${field('title', '任务标题', block.title, { maxlength: 240 })}${field('prompt', '任务说明', block.prompt, { textarea: true, wide: true, maxlength: 4000 })}${field('outcomes', '学习产出（每行一个）', (block.outcomes || []).join('\n'), { textarea: true, wide: true, maxlength: 6012 })}${field('steps', '操作步骤（每行一个）', (block.steps || []).join('\n'), { textarea: true, wide: true, maxlength: 10020 })}${field('concepts', '核心概念（每行一个）', (block.concepts || []).join('\n'), { textarea: true, wide: true, maxlength: 10020 })}</div>`;
        if (block.type === 'rich-text') return `<div class="teacher-course-content__field-grid">${field('title', '小标题（可选）', block.title, { maxlength: 240 })}${field('markdown', 'Markdown 正文', block.markdown, { textarea: true, wide: true, rows: 8, maxlength: 16000 })}<small class="teacher-course-content__field-note">允许标题、列表、强调和链接；HTML、脚本和危险链接会被拒绝。</small></div>`;
        if (block.type === 'media') return mediaFieldsMarkup(unit, block, blocked, field);
        if (block.type === 'official-simulation') return `<div class="teacher-course-content__field-grid">${field('title', '显示标题', block.title)}<label><span>正式活动</span><select data-course-content-block-field="simulationKey" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" disabled><option value="${escapeAttr(unit.activity_key)}">${escapeHtml(activityDisplay(unit.activity_key))}</option></select></label>${field('instructions', '操作提示', block.instructions, { textarea: true, wide: true })}${field('fallbackMarkdown', '无法运行时的文字说明（可选）', block.fallbackMarkdown, { textarea: true, wide: true })}</div>`;
        if (block.type === 'checkpoint') return checkpointFieldsMarkup(unit, block, blocked, field);
        if (block.type === 'sources') return sourceFieldsMarkup(unit, block, blocked, field);
        return '';
    }

    function mediaFieldsMarkup(unit, block, blocked, field) {
        return `<div class="teacher-course-content__field-grid">${field('title', '媒体标题（可选）', block.title, { maxlength: 240 })}<label><span>媒体类型</span><select data-course-content-block-field="mediaType" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked ? 'disabled' : ''}>${[['image', '图片'], ['diagram', '示意图'], ['audio', '音频'], ['video', '视频'], ['document', '文档']].map(([value, label]) => `<option value="${value}"${block.mediaType === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>${field('assetKey', '平台素材键', block.assetKey, { maxlength: 120 })}${field('alt', block.mediaType === 'image' || block.mediaType === 'diagram' ? '替代文字（必填）' : '替代文字（可选）', block.alt, { maxlength: 500 })}${field('caption', '说明文字（可选）', block.caption, { textarea: true, wide: true, maxlength: 2000 })}${field('transcript', '音视频文字稿（可选）', block.transcript, { textarea: true, wide: true, rows: 5, maxlength: 16000 })}</div>`;
    }

    function checkpointFieldsMarkup(unit, block, blocked, field) {
        const responseType = block.responseType || 'single-choice';
        return `<div class="teacher-course-content__field-grid">${field('title', '检查标题', block.title, { maxlength: 240 })}${field('checkpointKey', '检查点键', block.checkpointKey, { maxlength: 120 })}${field('prompt', '问题', block.prompt, { textarea: true, wide: true, maxlength: 4000 })}<label><span>作答方式</span><select data-course-content-block-field="responseType" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked ? 'disabled' : ''}>${[['single-choice', '单选'], ['multiple-choice', '多选'], ['numeric', '数值'], ['short-text', '简答']].map(([value, label]) => `<option value="${value}"${responseType === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>${field('maxAttempts', '最多尝试次数', block.maxAttempts || 3, { type: 'number', min: 1, max: 20, step: 1 })}${responseType === 'single-choice' || responseType === 'multiple-choice' ? choiceFieldsMarkup(unit, block, blocked) : ''}${responseType === 'numeric' ? `${field('numericAnswer', '标准数值', block.numericAnswer === undefined || block.numericAnswer === null ? '' : block.numericAnswer, { type: 'number', step: 'any' })}${field('tolerance', '允许误差', block.tolerance === undefined || block.tolerance === null ? '0' : block.tolerance, { type: 'number', min: 0, step: 'any' })}` : ''}${responseType === 'short-text' ? field('acceptedAnswers', '可接受答案（每行一个）', (block.acceptedAnswers || []).join('\n'), { textarea: true, wide: true, maxlength: 10020 }) : ''}</div>`;
    }

    function choiceFieldsMarkup(unit, block, blocked) {
        const multiple = block.responseType === 'multiple-choice';
        return `<div class="teacher-course-content__nested is-wide"><header><span>选项与答案</span><button type="button" data-course-content-action="add-choice" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || (block.choices || []).length >= 12 ? 'disabled' : ''}><i data-lucide="plus"></i>添加选项</button></header>${(block.choices || []).map((choice, index) => `<div class="teacher-course-content__nested-row"><label class="teacher-course-content__answer"><input type="${multiple ? 'checkbox' : 'radio'}" name="answer-${escapeAttr(unit.localKey)}-${escapeAttr(block.blockId)}" data-course-content-answer data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" data-choice-id="${escapeAttr(choice.choiceId)}" ${(block.correctChoiceIds || []).includes(choice.choiceId) ? 'checked' : ''} ${blocked ? 'disabled' : ''}><span>正确</span></label><label><span>选项键</span><input data-course-content-choice-field="choiceId" data-choice-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(choice.choiceId)}" maxlength="120" ${blocked ? 'disabled' : ''}></label><label><span>选项文字</span><input data-course-content-choice-field="label" data-choice-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(choice.label)}" maxlength="1000" ${blocked ? 'disabled' : ''}></label><button type="button" title="移除选项" data-course-content-action="remove-choice" data-choice-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || (block.choices || []).length <= 2 ? 'disabled' : ''}><i data-lucide="x"></i></button></div>`).join('')}</div>`;
    }

    function sourceFieldsMarkup(unit, block, blocked, field) {
        return `<div class="teacher-course-content__field-grid">${field('title', '来源区标题', block.title, { maxlength: 240 })}<div class="teacher-course-content__nested is-wide"><header><span>参考资料</span><button type="button" data-course-content-action="add-source" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || (block.items || []).length >= 50 ? 'disabled' : ''}><i data-lucide="plus"></i>添加来源</button></header>${(block.items || []).map((item, index) => `<div class="teacher-course-content__source-row"><label><span>来源键</span><input data-course-content-source-field="sourceId" data-source-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(item.sourceId)}" maxlength="120" ${blocked ? 'disabled' : ''}></label><label><span>名称</span><input data-course-content-source-field="label" data-source-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(item.label)}" maxlength="240" ${blocked ? 'disabled' : ''}></label><label class="is-wide"><span>http/https 地址</span><input data-course-content-source-field="url" data-source-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(item.url)}" maxlength="2048" ${blocked ? 'disabled' : ''}></label><label class="is-wide"><span>使用说明（可选）</span><input data-course-content-source-field="usage" data-source-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" value="${escapeAttr(item.usage || '')}" maxlength="500" ${blocked ? 'disabled' : ''}></label><button type="button" title="移除来源" data-course-content-action="remove-source" data-source-index="${index}" data-unit-key="${escapeAttr(unit.localKey)}" data-block-id="${escapeAttr(block.blockId)}" ${blocked || (block.items || []).length <= 1 ? 'disabled' : ''}><i data-lucide="x"></i></button></div>`).join('')}</div></div>`;
    }

    function editorActionsMarkup(course, blocked) {
        const hasUnits = session.units.length > 0;
        return `<footer class="teacher-course-content__actions"><div><strong>${session.dirty ? '草稿尚未保存' : `服务器 revision ${session.draftRevision}`}</strong><span>${hasUnits ? '保存后再显式发布；共同教师会读取同一代际。' : '可以保留空草稿，但至少建立一个单元后才能发布。'}</span></div><div><button type="button" data-course-content-action="save" ${blocked || !session.dirty ? 'disabled' : ''}><i data-lucide="save"></i><span>${session.busy ? '正在写入…' : '保存共享草稿'}</span></button>${session.publishConfirm ? `<label class="teacher-course-content__publish-note"><span>发布说明（可选）</span><input data-course-content-publish-note value="${escapeAttr(session.publishNote)}" maxlength="1000" ${blocked ? 'disabled' : ''}></label><button type="button" data-course-content-action="cancel-publish" ${blocked ? 'disabled' : ''}>取消</button><button type="button" class="is-primary" data-course-content-action="publish" ${blocked || session.dirty || !hasUnits ? 'disabled' : ''}><i data-lucide="send"></i><span>确认发布下一版</span></button>` : `<button type="button" class="is-primary" data-course-content-action="confirm-publish" ${blocked || session.dirty || !hasUnits ? 'disabled' : ''}><i data-lucide="rocket"></i><span>准备发布</span></button>`}</div></footer>`;
    }

    function previewMarkup(course, fromHistory) {
        const release = fromHistory ? selectedRelease() : null;
        const units = release ? release.units.map(releaseUnitAsEditorUnit) : session.units;
        return `<section class="teacher-course-preview-live"><header><div><span>${fromHistory ? `RELEASE ${escapeHtml(release && release.release_number)}` : 'DRAFT PREVIEW'}</span><h5>${escapeHtml(release && release.title || course.title)}</h5><p>${escapeHtml(release && release.summary || course.summary || '课程内容预览')}</p></div><strong>${units.length} 个单元</strong></header>${units.length ? units.map((unit, index) => `<article class="teacher-course-preview-live__unit"><div class="teacher-course-preview-live__unit-title"><span>${String(index + 1).padStart(2, '0')}</span><div><h6>${escapeHtml(unit.title)}</h6><p>${escapeHtml(unit.summary || unit.activity_key)}</p><small>${escapeHtml(completionLabel(unit.completion))}</small></div><code>${escapeHtml(unit.activity_key)}</code></div><div class="teacher-course-preview-live__blocks">${(unit.blocks || []).map(block => previewBlockMarkup(block, unit)).join('')}</div></article>`).join('') : '<div class="teacher-course-content__empty"><i data-lucide="scan-eye"></i><div><strong>还没有可预览内容</strong><p>返回编辑草稿并添加一个活动单元。</p></div></div>'}</section>`;
    }

    function previewBlockMarkup(block, unit) {
        if (block.type === 'hero') return `<section class="is-hero"><span>${escapeHtml(block.eyebrow || '课程单元')}</span><h6>${escapeHtml(block.title)}</h6><p>${escapeHtml(block.summary)}</p><div>${(block.badges || []).map(item => `<em>${escapeHtml(item)}</em>`).join('')}</div></section>`;
        if (block.type === 'learning-task') return `<section><span>学习任务</span><h6>${escapeHtml(block.title)}</h6><p>${escapeHtml(block.prompt)}</p>${(block.steps || []).length ? `<ol>${block.steps.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>` : ''}</section>`;
        if (block.type === 'rich-text') return `<section><span>正文讲解</span>${block.title ? `<h6>${escapeHtml(block.title)}</h6>` : ''}<div class="teacher-course-preview-live__markdown">${safeMarkdownPreview(block.markdown)}</div></section>`;
        if (block.type === 'media') return `<section class="is-media"><span>${escapeHtml(mediaTypeLabel(block.mediaType))}</span><h6>${escapeHtml(block.title || block.assetKey)}</h6><div><i data-lucide="image"></i><code>${escapeHtml(block.assetKey)}</code></div><p>${escapeHtml(block.caption || block.alt || '发布后从平台注册素材读取。')}</p></section>`;
        if (block.type === 'official-simulation') return `<section class="is-simulation"><span>正式活动引用</span><h6>${escapeHtml(block.title)}</h6><code>${escapeHtml(block.simulationKey || unit.activity_key)}</code><p>${escapeHtml(block.instructions)}</p><small>活动页面保持独立，课程只负责引用与返回。</small></section>`;
        if (block.type === 'checkpoint') return `<section><span>即时检查 · ${escapeHtml(responseTypeLabel(block.responseType))}</span><h6>${escapeHtml(block.title)}</h6><p>${escapeHtml(block.prompt)}</p>${(block.choices || []).length ? `<ul>${block.choices.map(choice => `<li>${escapeHtml(choice.label)}</li>`).join('')}</ul>` : ''}</section>`;
        if (block.type === 'sources') return `<section><span>参考来源</span><h6>${escapeHtml(block.title)}</h6><ul>${(block.items || []).map(item => `<li><a href="${escapeAttr(safeHttpUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a></li>`).join('')}</ul></section>`;
        return '';
    }

    function historyMarkup(course) {
        const release = selectedRelease();
        return `<section class="teacher-course-content__history"><aside><header><span>IMMUTABLE RELEASES</span><strong>不可变发布历史</strong></header>${session.releases.length ? session.releases.map(item => `<button type="button" data-course-content-action="select-release" data-release-id="${escapeAttr(item.id)}" data-active="${String(item.id) === String(session.selectedReleaseId) ? 'true' : 'false'}"><span>第 ${escapeHtml(item.release_number)} 版</span><small>${escapeHtml(formatDate(item.published_at))} · ${item.units.length} 个单元</small><code>${escapeHtml(String(item.package_sha256 || '').slice(0, 12))}</code></button>`).join('') : '<div class="teacher-course-content__unit-empty">尚未发布；保存草稿后从编辑视图显式发布。</div>'}</aside><main>${release ? `<div class="teacher-course-content__release-meta"><div><span>发布者</span><strong>用户 #${escapeHtml(release.published_by_user_id)}</strong></div><div><span>草稿代际</span><strong>revision ${escapeHtml(release.draft_revision)}</strong></div><div><span>完成规则</span><strong>${release.completion_rule_id ? `规则 #${escapeHtml(release.completion_rule_id)}` : '尚未配置'}</strong></div></div>${previewMarkup(course, true)}` : '<div class="teacher-course-content__canvas-empty"><i data-lucide="history"></i><h5>暂无发布历史</h5><p>已发布版本会永久保留在这里，不能直接修改。</p></div>'}</main></section>`;
    }

    function selectedRelease() {
        return session.releases.find(item => String(item.id) === String(session.selectedReleaseId)) || session.releases[0] || null;
    }

    function releaseUnitAsEditorUnit(value) {
        const content = value && value.content || {};
        return {
            activity_key: value.activity_key,
            title: value.title,
            summary: content.summary || '',
            blocks: Array.isArray(content.blocks) ? content.blocks : [],
            completion: normalizeCompletion(content.courseUnit && content.courseUnit.completion)
        };
    }

    function handleClick(event) {
        if (!session || !(event.target instanceof Element)) return;
        const control = event.target.closest('[data-course-content-action]');
        if (!control) return;
        event.preventDefault();
        const action = control.dataset.courseContentAction;
        if (action === 'refresh' || action === 'retry') return requestScopeReload();
        if (action === 'mode') {
            session.mode = ['edit', 'preview', 'history'].includes(control.dataset.mode) ? control.dataset.mode : 'edit';
            session.publishConfirm = false;
            render();
            return;
        }
        if (action === 'select-unit') return selectUnit(control.dataset.unitKey);
        if (action === 'add-unit') return addUnitFromControl();
        if (action === 'move-unit') return moveUnit(control.dataset.unitKey, Number(control.dataset.direction));
        if (action === 'delete-unit') return deleteUnit(control.dataset.unitKey, control.dataset.confirm === 'true');
        if (action === 'toggle-block') return toggleBlock(control.dataset.unitKey, control.dataset.blockId);
        if (action === 'add-block') return addBlock();
        if (action === 'move-block') return moveBlock(control.dataset.unitKey, control.dataset.blockId, Number(control.dataset.direction));
        if (action === 'delete-block') return deleteBlock(control.dataset.unitKey, control.dataset.blockId, control.dataset.confirm === 'true');
        if (action === 'add-choice') return addChoice(control.dataset.unitKey, control.dataset.blockId);
        if (action === 'remove-choice') return removeChoice(control.dataset.unitKey, control.dataset.blockId, Number(control.dataset.choiceIndex));
        if (action === 'add-source') return addSource(control.dataset.unitKey, control.dataset.blockId);
        if (action === 'remove-source') return removeSource(control.dataset.unitKey, control.dataset.blockId, Number(control.dataset.sourceIndex));
        if (action === 'save') return void saveDraft();
        if (action === 'confirm-publish') return preparePublish();
        if (action === 'cancel-publish') { session.publishConfirm = false; render(); return; }
        if (action === 'publish') return void publishDraft();
        if (action === 'cancel-scope') { session.pendingScope = null; render(); return; }
        if (action === 'confirm-scope') return confirmScopeChange();
        if (action === 'use-remote') return adoptConflictRemote();
        if (action === 'keep-local') return keepConflictLocal();
        if (action === 'export-local') return exportLocalDraft();
        if (action === 'select-release') { session.selectedReleaseId = String(control.dataset.releaseId || ''); render(); }
    }

    function handleInput(event) {
        if (!session || !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) return;
        if (event.target.matches('[data-course-content-publish-note]')) {
            session.publishNote = event.target.value;
            return;
        }
        if (event.target.matches('[data-course-content-unit-field]')) {
            const unit = unitByKey(event.target.dataset.unitKey);
            if (!unit) return;
            unit[event.target.dataset.courseContentUnitField] = event.target.value;
            markDirty();
            return;
        }
        if (event.target.matches('[data-course-content-block-field]')) {
            updateBlockField(event.target);
            return;
        }
        if (event.target.matches('[data-course-content-choice-field]')) {
            const block = blockByKey(event.target.dataset.unitKey, event.target.dataset.blockId);
            const choice = block && block.choices && block.choices[Number(event.target.dataset.choiceIndex)];
            if (!choice) return;
            const previousId = choice.choiceId;
            choice[event.target.dataset.courseContentChoiceField] = event.target.value;
            if (event.target.dataset.courseContentChoiceField === 'choiceId') {
                block.correctChoiceIds = (block.correctChoiceIds || []).map(value => value === previousId ? event.target.value : value);
            }
            markDirty();
            return;
        }
        if (event.target.matches('[data-course-content-source-field]')) {
            const block = blockByKey(event.target.dataset.unitKey, event.target.dataset.blockId);
            const source = block && block.items && block.items[Number(event.target.dataset.sourceIndex)];
            if (!source) return;
            source[event.target.dataset.courseContentSourceField] = event.target.value;
            markDirty();
        }
    }

    function handleChange(event) {
        if (!session || !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) return;
        if (event.target.matches('[data-course-content-course]')) return requestCourseChange(event.target.value);
        if (event.target.matches('[data-course-content-add-block]')) { session.addBlockType = event.target.value; return; }
        if (event.target.matches('[data-course-content-completion-preset]')) {
            setCompletionPreset(event.target.dataset.unitKey, event.target.value);
            return;
        }
        if (event.target.matches('[data-course-content-completion-target]')) {
            setCompletionTarget(
                event.target.dataset.unitKey,
                event.target.dataset.courseContentCompletionTarget,
                event.target.value
            );
            return;
        }
        if (event.target.matches('[data-course-content-unit-field="activity_key"]')) {
            const unit = unitByKey(event.target.dataset.unitKey);
            if (!unit) return;
            unit.activity_key = event.target.value;
            unit.blocks.filter(block => block.type === 'official-simulation').forEach(block => { block.simulationKey = event.target.value; });
            markDirty();
            render();
            return;
        }
        if (event.target.matches('[data-course-content-block-field]')) {
            updateBlockField(event.target);
            const field = event.target.dataset.courseContentBlockField;
            if (field === 'responseType') normalizeCheckpoint(blockByKey(event.target.dataset.unitKey, event.target.dataset.blockId));
            render();
            return;
        }
        if (event.target.matches('[data-course-content-answer]')) {
            updateCorrectAnswer(event.target);
            markDirty();
        }
    }

    function updateBlockField(control) {
        const unit = unitByKey(control.dataset.unitKey);
        const block = unit && unit.blocks.find(item => item.blockId === control.dataset.blockId);
        if (!block) return;
        const name = control.dataset.courseContentBlockField;
        const previous = block[name];
        if (['badges', 'outcomes', 'steps', 'concepts', 'acceptedAnswers'].includes(name)) block[name] = lines(control.value);
        else block[name] = control.value;
        if (
            name === 'checkpointKey'
            && unit.completion
            && unit.completion.preset === 'checkpoint_passed'
            && unit.completion.checkpointKey === previous
        ) unit.completion.checkpointKey = control.value;
        markDirty();
    }

    function setCompletionPreset(unitKey, preset) {
        const unit = unitByKey(unitKey);
        if (!unit) return;
        if (preset === 'experiment_operation') unit.completion = { preset };
        else if (preset === 'checkpoint_passed') {
            const checkpoint = (unit.blocks || []).find(block => block.type === 'checkpoint' && block.mode !== 'question-set');
            unit.completion = { preset, checkpointKey: checkpoint ? checkpoint.checkpointKey : '' };
        } else if (preset === 'assignment_reviewed') {
            const assignment = (session.assignments || []).find(item => Number(item.unit_id) === Number(unit.id) && item.status === 'active');
            unit.completion = { preset, assignmentId: assignment ? Number(assignment.id) : null };
        } else unit.completion = null;
        markDirty();
        render();
    }

    function setCompletionTarget(unitKey, field, value) {
        const unit = unitByKey(unitKey);
        if (!unit || !unit.completion) return;
        if (field === 'checkpointKey' && unit.completion.preset === 'checkpoint_passed') unit.completion.checkpointKey = String(value || '');
        if (field === 'assignmentId' && unit.completion.preset === 'assignment_reviewed') unit.completion.assignmentId = positiveInteger(value);
        markDirty();
        render();
    }

    function updateCorrectAnswer(control) {
        const block = blockByKey(control.dataset.unitKey, control.dataset.blockId);
        if (!block) return;
        const choiceId = String(control.dataset.choiceId || '');
        if (block.responseType === 'single-choice') block.correctChoiceIds = control.checked ? [choiceId] : [];
        else {
            const values = new Set(block.correctChoiceIds || []);
            if (control.checked) values.add(choiceId); else values.delete(choiceId);
            block.correctChoiceIds = Array.from(values);
        }
    }

    function requestCourseChange(courseId) {
        if (!courseId || String(courseId) === String(session.selectedCourseId)) return;
        if (session.dirty) {
            session.pendingScope = { type: 'course', courseId: String(courseId) };
            render();
            return;
        }
        switchCourse(courseId);
    }

    function requestScopeReload() {
        if (session.dirty) {
            session.pendingScope = { type: 'reload', courseId: session.selectedCourseId };
            render();
            return;
        }
        session.loadedCourseId = '';
        void loadCourse(session.selectedCourseId);
    }

    function confirmScopeChange() {
        const pending = session.pendingScope;
        session.pendingScope = null;
        if (!pending) return;
        if (pending.type === 'course') switchCourse(pending.courseId);
        else {
            session.dirty = false;
            session.loadedCourseId = '';
            void loadCourse(session.selectedCourseId);
        }
    }

    function switchCourse(courseId) {
        session.generation += 1;
        session.loading = false;
        session.selectedCourseId = String(courseId);
        session.loadedCourseId = '';
        session.units = [];
        session.assignments = [];
        session.releases = [];
        session.selectedUnitKey = '';
        session.selectedReleaseId = '';
        session.dirty = false;
        session.conflict = null;
        session.error = null;
        session.notice = null;
        render();
    }

    function selectUnit(key) {
        if (!unitByKey(key)) return;
        session.selectedUnitKey = key;
        session.pendingDeleteUnitKey = '';
        session.pendingDeleteBlockId = '';
        render();
    }

    function addUnitFromControl() {
        const select = session.root.querySelector('[data-course-content-add-activity]');
        const activityKey = select && select.value;
        const entry = activityEntries().find(item => item.activity_key === activityKey);
        if (!entry || session.units.some(unit => unit.activity_key === activityKey)) return;
        const course = selectedCourseFromSnapshot();
        const title = activityTitle(entry);
        const unit = {
            id: null,
            localKey: nextLocalUnitKey(),
            activity_key: activityKey,
            title,
            summary: `引用“${title}”，用于课程内的活动安排。`,
            position: session.units.length + 1,
            content_slug: '',
            last_editor_user_id: null,
            blocks: [createBlock('official-simulation', { activity_key: activityKey, title })],
            completion: null,
            generatedContent: false
        };
        session.units.push(unit);
        session.selectedUnitKey = unit.localKey;
        markDirty();
        render();
    }

    function moveUnit(key, direction) {
        const index = session.units.findIndex(unit => unit.localKey === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= session.units.length) return;
        [session.units[index], session.units[target]] = [session.units[target], session.units[index]];
        session.units.forEach((unit, position) => { unit.position = position + 1; });
        markDirty();
        render();
    }

    function deleteUnit(key, confirmed) {
        if (!confirmed) {
            session.pendingDeleteUnitKey = key;
            render();
            return;
        }
        const index = session.units.findIndex(unit => unit.localKey === key);
        if (index < 0) return;
        session.units.splice(index, 1);
        session.units.forEach((unit, position) => { unit.position = position + 1; });
        session.selectedUnitKey = session.units[Math.min(index, session.units.length - 1)] && session.units[Math.min(index, session.units.length - 1)].localKey || '';
        session.pendingDeleteUnitKey = '';
        markDirty();
        render();
    }

    function toggleBlock(unitKey, blockId) {
        const key = `${unitKey}:${blockId}`;
        if (session.collapsedBlocks.has(key)) session.collapsedBlocks.delete(key); else session.collapsedBlocks.add(key);
        render();
    }

    function addBlock() {
        const unit = selectedUnit();
        if (!unit || !blockMeta(session.addBlockType)) return;
        const block = createBlock(session.addBlockType, unit, unit.blocks);
        unit.blocks.push(block);
        if (
            block.type === 'checkpoint'
            && unit.completion
            && unit.completion.preset === 'checkpoint_passed'
            && !unit.completion.checkpointKey
        ) unit.completion.checkpointKey = block.checkpointKey;
        markDirty();
        render();
    }

    function moveBlock(unitKey, blockId, direction) {
        const unit = unitByKey(unitKey);
        const index = unit && unit.blocks.findIndex(block => block.blockId === blockId);
        const target = index + direction;
        if (!unit || index < 0 || target < 0 || target >= unit.blocks.length) return;
        [unit.blocks[index], unit.blocks[target]] = [unit.blocks[target], unit.blocks[index]];
        markDirty();
        render();
    }

    function deleteBlock(unitKey, blockId, confirmed) {
        const key = `${unitKey}:${blockId}`;
        if (!confirmed) {
            session.pendingDeleteBlockId = key;
            render();
            return;
        }
        const unit = unitByKey(unitKey);
        const index = unit && unit.blocks.findIndex(block => block.blockId === blockId);
        if (!unit || index < 0) return;
        unit.blocks.splice(index, 1);
        session.pendingDeleteBlockId = '';
        session.collapsedBlocks.delete(key);
        markDirty();
        render();
    }

    function addChoice(unitKey, blockId) {
        const block = blockByKey(unitKey, blockId);
        if (!block || !Array.isArray(block.choices) || block.choices.length >= 12) return;
        const used = new Set(block.choices.map(choice => choice.choiceId));
        const choiceId = uniqueStableId('choice', used);
        block.choices.push({ choiceId, label: `选项 ${block.choices.length + 1}` });
        markDirty();
        render();
    }

    function removeChoice(unitKey, blockId, index) {
        const block = blockByKey(unitKey, blockId);
        if (!block || !Array.isArray(block.choices) || block.choices.length <= 2 || !block.choices[index]) return;
        const removed = block.choices.splice(index, 1)[0];
        block.correctChoiceIds = (block.correctChoiceIds || []).filter(value => value !== removed.choiceId);
        if (!block.correctChoiceIds.length) block.correctChoiceIds = [block.choices[0].choiceId];
        markDirty();
        render();
    }

    function addSource(unitKey, blockId) {
        const block = blockByKey(unitKey, blockId);
        if (!block || !Array.isArray(block.items) || block.items.length >= 50) return;
        const sourceId = uniqueStableId('source', new Set(block.items.map(item => item.sourceId)));
        block.items.push({ sourceId, label: '', url: '', usage: '' });
        markDirty();
        render();
    }

    function removeSource(unitKey, blockId, index) {
        const block = blockByKey(unitKey, blockId);
        if (!block || !Array.isArray(block.items) || block.items.length <= 1 || !block.items[index]) return;
        block.items.splice(index, 1);
        markDirty();
        render();
    }

    function normalizeCheckpoint(block) {
        if (!block) return;
        const type = block.responseType;
        block.mode = 'inline';
        delete block.questionSetKey;
        if (type === 'single-choice' || type === 'multiple-choice') {
            if (!Array.isArray(block.choices) || block.choices.length < 2) block.choices = [{ choiceId: 'choice-a', label: '选项 A' }, { choiceId: 'choice-b', label: '选项 B' }];
            block.correctChoiceIds = (block.correctChoiceIds || []).filter(value => block.choices.some(choice => choice.choiceId === value));
            if (!block.correctChoiceIds.length) block.correctChoiceIds = [block.choices[0].choiceId];
            if (type === 'single-choice') block.correctChoiceIds = block.correctChoiceIds.slice(0, 1);
            delete block.numericAnswer;
            delete block.tolerance;
            delete block.acceptedAnswers;
        } else if (type === 'numeric') {
            block.choices = [];
            block.correctChoiceIds = [];
            block.numericAnswer = block.numericAnswer === undefined ? 0 : block.numericAnswer;
            block.tolerance = block.tolerance === undefined ? 0 : block.tolerance;
            delete block.acceptedAnswers;
        } else {
            block.choices = [];
            block.correctChoiceIds = [];
            block.acceptedAnswers = Array.isArray(block.acceptedAnswers) && block.acceptedAnswers.length ? block.acceptedAnswers : ['参考答案'];
            delete block.numericAnswer;
            delete block.tolerance;
        }
    }

    function createBlock(type, unit, existing = []) {
        const used = new Set((existing || []).map(block => block.blockId));
        const blockId = uniqueStableId(type.replace(/[^a-z0-9]+/g, '-'), used);
        const usedCheckpointKeys = new Set((existing || []).filter(block => block.type === 'checkpoint').map(block => block.checkpointKey));
        const usedSourceIds = new Set((existing || []).filter(block => block.type === 'sources').flatMap(block => (block.items || []).map(item => item.sourceId)));
        const activityKey = String(unit && unit.activity_key || 'physics.energy-conservation');
        const title = String(unit && unit.title || activityTitleByKey(activityKey) || '课程单元');
        if (type === 'hero') return { blockId, type, title, summary: '用一两句话说明本单元要完成的学习活动。', eyebrow: '课程单元', badges: [] };
        if (type === 'learning-task') return { blockId, type, title: '学习任务', prompt: '完成活动并记录关键观察。', outcomes: [], steps: [], concepts: [] };
        if (type === 'rich-text') return { blockId, type, title: '现象与解释', markdown: '请在这里写下简洁的课程正文。' };
        if (type === 'media') return { blockId, type, title: '', mediaType: 'image', assetKey: '', alt: '', caption: '', transcript: '' };
        if (type === 'official-simulation') return { blockId, type, title, simulationKey: activityKey, instructions: '进入活动后按教师要求完成操作并记录观察。', fallbackMarkdown: '' };
        if (type === 'checkpoint') return { blockId, type, checkpointKey: uniqueStableId('checkpoint', usedCheckpointKeys), title: '即时检查', prompt: '根据刚才的活动选择正确答案。', mode: 'inline', responseType: 'single-choice', choices: [{ choiceId: 'choice-a', label: '选项 A' }, { choiceId: 'choice-b', label: '选项 B' }], correctChoiceIds: ['choice-a'], maxAttempts: 3 };
        if (type === 'sources') return { blockId, type, title: '参考来源', items: [{ sourceId: uniqueStableId('source', usedSourceIds), label: '', url: '', usage: '' }] };
        throw new Error(`Unsupported content block: ${type}`);
    }

    function markDirty() {
        if (!session) return;
        session.dirty = true;
        session.notice = null;
        session.validationErrors = [];
        session.publishConfirm = false;
        const badge = session.root.querySelector('[data-course-content-dirty]');
        if (badge) {
            badge.dataset.state = 'dirty';
            badge.innerHTML = '<span>有未保存修改</span>';
        }
        const actions = session.root.querySelector('.teacher-course-content__actions');
        if (actions) {
            const summary = actions.querySelector('strong');
            const save = actions.querySelector('[data-course-content-action="save"]');
            if (summary) summary.textContent = '草稿尚未保存';
            if (save) save.disabled = Boolean(safeSnapshot().blocked || session.busy);
            actions.querySelectorAll('[data-course-content-action="confirm-publish"], [data-course-content-action="publish"]').forEach((control) => {
                control.disabled = true;
            });
        }
    }

    async function saveDraft() {
        if (!session || session.busy || !session.dirty) return false;
        const course = selectedCourseFromSnapshot();
        const validation = validateEditorDraft({ revision: session.draftRevision, units: session.units }, course, activityEntries());
        if (!validation.valid) {
            session.validationErrors = validation.errors;
            render();
            return false;
        }
        if (!beginMutation('保存共享课程草稿')) return false;
        session.busy = true;
        session.notice = null;
        session.error = null;
        render();
        try {
            const payload = buildDraftPayload({ revision: session.draftRevision, units: session.units }, course);
            const remote = await session.host.request(`/api/v1/courses/${course.id}/draft`, { method: 'PATCH', body: payload });
            applyRemoteDraft(remote);
            session.loadedCourseId = String(course.id);
            session.notice = { type: 'success', message: `共享草稿已保存为 revision ${remote.revision}；共同教师刷新后会看到同一版本。` };
            notify('success', '共享课程草稿已保存');
            return true;
        } catch (error) {
            if (isRevisionConflict(error)) await captureConflict(error, course.id);
            else {
                session.notice = { type: 'warning', message: errorMessage(error) };
                await failMutation(error, '保存共享课程草稿');
            }
            return false;
        } finally {
            session.busy = false;
            endMutation();
            render();
        }
    }

    function preparePublish() {
        const validation = validateCompletionForPublish(session.units, session.assignments);
        if (!validation.valid) {
            session.validationErrors = validation.errors;
            session.publishConfirm = false;
            render();
            return false;
        }
        session.validationErrors = [];
        session.publishConfirm = true;
        session.notice = null;
        render();
        return true;
    }

    async function publishDraft() {
        if (!session || session.busy || session.dirty || !session.publishConfirm || !session.units.length) return false;
        const validation = validateCompletionForPublish(session.units, session.assignments);
        if (!validation.valid) {
            session.validationErrors = validation.errors;
            session.publishConfirm = false;
            render();
            return false;
        }
        const course = selectedCourseFromSnapshot();
        if (!beginMutation('发布课程内容版本')) return false;
        session.busy = true;
        session.notice = null;
        render();
        try {
            const receipt = await session.host.request(`/api/v1/courses/${course.id}/releases`, {
                method: 'POST',
                body: { expected_revision: session.draftRevision, note: optional(session.publishNote) }
            });
            const [remoteDraft, releases] = await Promise.all([
                session.host.request(`/api/v1/courses/${course.id}/draft`),
                session.host.request(`/api/v1/courses/${course.id}/releases`)
            ]);
            applyRemoteDraft(remoteDraft);
            session.releases = Array.isArray(releases) ? releases.slice() : receipt && receipt.release ? [receipt.release] : [];
            session.selectedReleaseId = receipt && receipt.release ? String(receipt.release.id) : session.releases[0] && String(session.releases[0].id) || '';
            session.publishConfirm = false;
            session.publishNote = '';
            session.notice = { type: 'success', message: `第 ${receipt.release.release_number} 版已发布；学生下次读取课程时自动看到新版本。` };
            notify('success', `课程第 ${receipt.release.release_number} 版已发布`);
            return true;
        } catch (error) {
            if (isRevisionConflict(error)) await captureConflict(error, course.id);
            else {
                session.notice = { type: 'warning', message: errorMessage(error) };
                await failMutation(error, '发布课程内容版本');
            }
            return false;
        } finally {
            session.busy = false;
            endMutation();
            render();
        }
    }

    async function captureConflict(error, courseId) {
        const localUnits = deepClone(session.units);
        const localRevision = session.draftRevision;
        try {
            const remote = await session.host.request(`/api/v1/courses/${courseId}/draft`);
            session.conflict = { error, localUnits, localRevision, remote };
            session.notice = { type: 'warning', message: '共享草稿已被另一位教师更新；请选择采用服务器版本或显式保留本地内容。' };
        } catch (readError) {
            session.error = readError;
            session.notice = { type: 'warning', message: '检测到草稿冲突，但暂时无法读取服务器最新版本；本地内容仍保留在页面中。' };
        }
    }

    function adoptConflictRemote() {
        if (!session.conflict || !session.conflict.remote) return;
        applyRemoteDraft(session.conflict.remote);
        session.conflict = null;
        session.notice = { type: 'success', message: `已采用服务器 revision ${session.draftRevision}；本地冲突内容未写入。` };
        render();
    }

    function keepConflictLocal() {
        const conflict = session.conflict;
        if (!conflict || !conflict.remote) return;
        const remoteByActivity = new Map((conflict.remote.units || []).map(unit => [unit.activity_key, unit]));
        session.units = conflict.localUnits.map(unit => {
            const remote = remoteByActivity.get(unit.activity_key);
            return Object.assign({}, unit, { id: remote ? remote.id : null, localKey: remote ? `unit-${remote.id}` : unit.localKey });
        });
        session.draftRevision = Number(conflict.remote.revision);
        session.selectedUnitKey = session.units[0] && session.units[0].localKey || '';
        session.conflict = null;
        session.dirty = true;
        session.notice = { type: 'warning', message: `本地内容已放到服务器 revision ${session.draftRevision} 之上；请逐项复核，再手动点击保存。` };
        render();
    }

    function exportLocalDraft() {
        const conflict = session.conflict;
        if (!conflict || !global.Blob || !global.URL || typeof global.URL.createObjectURL !== 'function') return;
        const course = selectedCourseFromSnapshot();
        const payload = buildDraftPayload({ revision: conflict.localRevision, units: conflict.localUnits }, course);
        const blob = new global.Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = `astra-course-${course.id}-local-revision-${conflict.localRevision}.json`;
        anchor.click();
        global.setTimeout(() => global.URL.revokeObjectURL(url), 0);
    }

    function buildDraftPayload(editor, course) {
        return {
            expected_revision: Number(editor.revision) || 0,
            units: (editor.units || []).map((unit, index) => ({
                id: positiveInteger(unit.id),
                activity_key: String(unit.activity_key || '').trim(),
                title: String(unit.title || '').trim(),
                position: index + 1,
                content: buildContentPage(unit, course, Number(editor.revision) || 0, index)
            }))
        };
    }

    function buildContentPage(unit, course, revision, index) {
        const completion = completionPayload(unit.completion);
        return {
            schemaVersion: 'astra-content-page-v2',
            slug: `courses/${Number(course && course.id) || 1}/${String(unit.activity_key || `unit-${index + 1}`)}`,
            galaxy: String(course && course.galaxy_key || 'englab'),
            subject: String(course && course.subject_key || 'physics'),
            title: String(unit.title || '').trim(),
            summary: String(unit.summary || '').trim(),
            layout: 'course-page',
            status: 'draft',
            version: `draft-r${revision}`,
            courseUnit: {
                courseId: clean(course && course.course_key) || `course-${Number(course && course.id) || 1}`,
                unitId: clean(unit.activity_key) || `unit-${index + 1}`,
                order: index + 1,
                title: clean(unit.title),
                completion
            },
            blocks: (unit.blocks || []).map(block => sanitizeBlock(block, unit))
        };
    }

    function sanitizeBlock(block, unit) {
        const base = { blockId: String(block.blockId || '').trim(), type: block.type };
        if (block.type === 'hero') return Object.assign(base, { title: clean(block.title), summary: clean(block.summary), eyebrow: optional(block.eyebrow), badges: cleanList(block.badges) });
        if (block.type === 'learning-task') return Object.assign(base, { title: clean(block.title), prompt: clean(block.prompt), outcomes: cleanList(block.outcomes), steps: cleanList(block.steps), concepts: cleanList(block.concepts) });
        if (block.type === 'rich-text') return Object.assign(base, { title: optional(block.title), markdown: clean(block.markdown) });
        if (block.type === 'media') return Object.assign(base, { title: optional(block.title), mediaType: block.mediaType, assetKey: clean(block.assetKey), alt: optional(block.alt), caption: optional(block.caption), transcript: optional(block.transcript) });
        if (block.type === 'official-simulation') return Object.assign(base, { title: clean(block.title), simulationKey: clean(unit.activity_key), instructions: clean(block.instructions), fallbackMarkdown: optional(block.fallbackMarkdown) });
        if (block.type === 'checkpoint') return sanitizeCheckpoint(base, block);
        if (block.type === 'sources') return Object.assign(base, { title: clean(block.title), items: (block.items || []).map(item => ({ sourceId: clean(item.sourceId), label: clean(item.label), url: clean(item.url), usage: optional(item.usage) })) });
        return base;
    }

    function sanitizeCheckpoint(base, block) {
        const result = Object.assign(base, {
            checkpointKey: clean(block.checkpointKey), title: clean(block.title), prompt: clean(block.prompt),
            mode: 'inline', responseType: block.responseType, maxAttempts: integerOrNull(block.maxAttempts)
        });
        if (block.responseType === 'single-choice' || block.responseType === 'multiple-choice') {
            result.choices = (block.choices || []).map(choice => ({ choiceId: clean(choice.choiceId), label: clean(choice.label) }));
            result.correctChoiceIds = cleanList(block.correctChoiceIds);
        } else if (block.responseType === 'numeric') {
            result.choices = [];
            result.correctChoiceIds = [];
            result.numericAnswer = finiteNumberOrNull(block.numericAnswer);
            result.tolerance = finiteNumberOrNull(block.tolerance);
        } else {
            result.choices = [];
            result.correctChoiceIds = [];
            result.acceptedAnswers = cleanList(block.acceptedAnswers);
        }
        return result;
    }

    function validateEditorDraft(editor, course, catalogEntries) {
        const errors = [];
        const units = Array.isArray(editor && editor.units) ? editor.units : [];
        const catalog = new Set((catalogEntries || []).map(entry => entry.activity_key));
        if (!course || !positiveInteger(course.id)) errors.push('请选择一门已审核课程');
        if (catalog.size !== EXPECTED_ACTIVITY_COUNT) errors.push(`正式活动目录应为 ${EXPECTED_ACTIVITY_COUNT} 项，当前为 ${catalog.size} 项`);
        if (units.length > 200) errors.push('一门课程最多保存 200 个单元');
        const keys = new Set();
        units.forEach((unit, unitIndex) => {
            const prefix = `第 ${unitIndex + 1} 单元`;
            if (!catalog.has(unit.activity_key)) errors.push(`${prefix}必须引用当前正式活动目录`);
            if (keys.has(unit.activity_key)) errors.push(`${prefix}与其他单元重复引用同一活动`); else keys.add(unit.activity_key);
            if (!clean(unit.title)) errors.push(`${prefix}缺少标题`);
            if (clean(unit.title).length > 180) errors.push(`${prefix}标题不能超过 180 个字符`);
            if (!clean(unit.summary)) errors.push(`${prefix}缺少摘要`);
            if (clean(unit.summary).length > 4000) errors.push(`${prefix}摘要不能超过 4000 个字符`);
            const blocks = Array.isArray(unit.blocks) ? unit.blocks : [];
            if (!blocks.length) errors.push(`${prefix}至少需要一个内容块`);
            if (blocks.length > 200) errors.push(`${prefix}内容块超过 200 个`);
            const ids = new Set();
            const checkpoints = new Set();
            const sources = new Set();
            blocks.forEach((block, blockIndex) => validateBlock(block, unit, `${prefix}第 ${blockIndex + 1} 块`, errors, ids, checkpoints, sources));
        });
        return { valid: errors.length === 0, errors };
    }

    function validateCompletionForPublish(units, assignments) {
        const errors = [];
        const assignmentList = Array.isArray(assignments) ? assignments : [];
        (Array.isArray(units) ? units : []).forEach((unit, index) => {
            const prefix = `第 ${index + 1} 单元`;
            const completion = normalizeCompletion(unit && unit.completion);
            if (!completion) {
                errors.push(`${prefix}发布前必须选择完成方式`);
                return;
            }
            if (completion.preset === 'experiment_operation') {
                if (!(unit.blocks || []).some(block => block.type === 'official-simulation' && clean(block.simulationKey) === clean(unit.activity_key))) {
                    errors.push(`${prefix}需要保留当前正式活动引用，才能按实验操作完成`);
                }
                return;
            }
            if (completion.preset === 'checkpoint_passed') {
                if (!(unit.blocks || []).some(block => (
                    block.type === 'checkpoint'
                    && block.mode !== 'question-set'
                    && clean(block.checkpointKey) === clean(completion.checkpointKey)
                ))) errors.push(`${prefix}需要选择一个当前单元中的即时检查`);
                return;
            }
            const assignment = assignmentList.find(item => (
                Number(item.id) === Number(completion.assignmentId)
                && Number(item.unit_id) === Number(unit.id)
                && item.status === 'active'
            ));
            if (!assignment) errors.push(`${prefix}需要选择一份当前单元中的有效作业`);
        });
        return { valid: errors.length === 0, errors };
    }

    function validateBlock(block, unit, prefix, errors, ids, checkpoints, sources) {
        if (!blockMeta(block && block.type)) { errors.push(`${prefix}类型不受支持`); return; }
        if (!STABLE_ID_PATTERN.test(clean(block.blockId)) || clean(block.blockId).length > 120) errors.push(`${prefix}内容块键格式不正确`);
        else if (ids.has(block.blockId)) errors.push(`${prefix}内容块键重复`); else ids.add(block.blockId);
        if (block.type === 'hero') {
            if (!clean(block.title) || !clean(block.summary)) errors.push(`${prefix}需要标题和摘要`);
            validateLengths([[block.title, 240, '标题'], [block.summary, 4000, '摘要'], [block.eyebrow, 120, '眉题']], prefix, errors);
            validateShortList(block.badges, 8, 40, `${prefix}标签`, errors);
        }
        if (block.type === 'learning-task') {
            if (!clean(block.title) || !clean(block.prompt)) errors.push(`${prefix}需要任务标题和说明`);
            validateLengths([[block.title, 240, '任务标题'], [block.prompt, 4000, '任务说明']], prefix, errors);
            validateShortList(block.outcomes, 12, 500, `${prefix}学习产出`, errors);
            validateShortList(block.steps, 20, 500, `${prefix}操作步骤`, errors);
            validateShortList(block.concepts, 20, 500, `${prefix}核心概念`, errors);
        }
        if (block.type === 'rich-text') {
            if (!clean(block.markdown)) errors.push(`${prefix}正文不能为空`);
            if (RAW_HTML_PATTERN.test(block.markdown || '') || DANGEROUS_LINK_PATTERN.test(block.markdown || '')) errors.push(`${prefix}正文包含 HTML、脚本或危险链接`);
            validateLengths([[block.title, 240, '小标题'], [block.markdown, 16000, '正文']], prefix, errors);
        }
        if (block.type === 'media') {
            if (!['image', 'diagram', 'audio', 'video', 'document'].includes(block.mediaType)) errors.push(`${prefix}媒体类型无效`);
            if (!STABLE_ID_PATTERN.test(clean(block.assetKey)) || clean(block.assetKey).length > 120) errors.push(`${prefix}需要有效的平台素材键`);
            if (['image', 'diagram'].includes(block.mediaType) && !clean(block.alt)) errors.push(`${prefix}图片或示意图必须填写替代文字`);
            validateLengths([[block.title, 240, '媒体标题'], [block.alt, 500, '替代文字'], [block.caption, 2000, '说明文字'], [block.transcript, 16000, '文字稿']], prefix, errors);
        }
        if (block.type === 'official-simulation') {
            if (clean(block.simulationKey) !== clean(unit.activity_key)) errors.push(`${prefix}必须引用当前单元的正式活动`);
            if (!clean(block.title) || !clean(block.instructions)) errors.push(`${prefix}需要显示标题和操作提示`);
            validateLengths([[block.title, 240, '显示标题'], [block.instructions, 4000, '操作提示'], [block.fallbackMarkdown, 16000, '备用说明']], prefix, errors);
            if (block.fallbackMarkdown && (RAW_HTML_PATTERN.test(block.fallbackMarkdown) || DANGEROUS_LINK_PATTERN.test(block.fallbackMarkdown))) errors.push(`${prefix}备用说明包含 HTML、脚本或危险链接`);
        }
        if (block.type === 'checkpoint') validateCheckpoint(block, prefix, errors, checkpoints);
        if (block.type === 'sources') {
            if (!clean(block.title) || !Array.isArray(block.items) || !block.items.length) errors.push(`${prefix}至少需要一个参考来源`);
            if ((block.items || []).length > 50) errors.push(`${prefix}参考来源不能超过 50 项`);
            validateLengths([[block.title, 240, '来源区标题']], prefix, errors);
            (block.items || []).forEach((item, index) => {
                if (!STABLE_ID_PATTERN.test(clean(item.sourceId)) || clean(item.sourceId).length > 120 || sources.has(item.sourceId)) errors.push(`${prefix}第 ${index + 1} 个来源键无效或重复`); else sources.add(item.sourceId);
                if (!clean(item.label) || !safeHttpUrl(item.url)) errors.push(`${prefix}第 ${index + 1} 个来源需要名称和 http/https 地址`);
                validateLengths([[item.label, 240, '名称'], [item.url, 2048, '地址'], [item.usage, 500, '使用说明']], `${prefix}第 ${index + 1} 个来源`, errors);
            });
        }
    }

    function validateCheckpoint(block, prefix, errors, checkpoints) {
        if (!STABLE_ID_PATTERN.test(clean(block.checkpointKey)) || clean(block.checkpointKey).length > 120 || checkpoints.has(block.checkpointKey)) errors.push(`${prefix}检查点键无效或重复`); else checkpoints.add(block.checkpointKey);
        if (!clean(block.title) || !clean(block.prompt)) errors.push(`${prefix}需要检查标题和问题`);
        validateLengths([[block.title, 240, '检查标题'], [block.prompt, 4000, '问题']], prefix, errors);
        if (!['single-choice', 'multiple-choice', 'numeric', 'short-text'].includes(block.responseType)) errors.push(`${prefix}作答方式无效`);
        const maxAttempts = integerOrNull(block.maxAttempts);
        if (block.maxAttempts !== '' && block.maxAttempts !== null && block.maxAttempts !== undefined && (maxAttempts === null || maxAttempts > 20)) errors.push(`${prefix}最多尝试次数必须为 1—20`);
        if (block.responseType === 'single-choice' || block.responseType === 'multiple-choice') {
            const choiceIds = new Set();
            (block.choices || []).forEach(choice => {
                if (!STABLE_ID_PATTERN.test(clean(choice.choiceId)) || clean(choice.choiceId).length > 120 || choiceIds.has(choice.choiceId) || !clean(choice.label) || clean(choice.label).length > 1000) errors.push(`${prefix}存在无效或重复选项`);
                choiceIds.add(choice.choiceId);
            });
            if ((block.choices || []).length < 2) errors.push(`${prefix}至少需要两个选项`);
            if ((block.choices || []).length > 12) errors.push(`${prefix}选项不能超过 12 个`);
            if (!(block.correctChoiceIds || []).length || (block.correctChoiceIds || []).some(value => !choiceIds.has(value))) errors.push(`${prefix}需要选择有效正确答案`);
            if (block.responseType === 'single-choice' && (block.correctChoiceIds || []).length !== 1) errors.push(`${prefix}单选只能有一个正确答案`);
        }
        if (block.responseType === 'numeric') {
            if (finiteNumberOrNull(block.numericAnswer) === null) errors.push(`${prefix}需要标准数值`);
            const tolerance = finiteNumberOrNull(block.tolerance);
            if (block.tolerance !== '' && block.tolerance !== null && block.tolerance !== undefined && (tolerance === null || tolerance < 0)) errors.push(`${prefix}允许误差不能为负数`);
        }
        if (block.responseType === 'short-text') {
            if (!cleanList(block.acceptedAnswers).length) errors.push(`${prefix}至少需要一个可接受答案`);
            validateShortList(block.acceptedAnswers, 20, 500, `${prefix}可接受答案`, errors);
        }
    }

    function validateLengths(items, prefix, errors) {
        items.forEach(([value, maximum, label]) => {
            if (clean(value).length > maximum) errors.push(`${prefix}${label}不能超过 ${maximum} 个字符`);
        });
    }

    function validateShortList(values, maximumItems, maximumLength, label, errors) {
        const items = Array.isArray(values) ? values : [];
        if (items.length > maximumItems) errors.push(`${label}不能超过 ${maximumItems} 项`);
        if (items.some(item => clean(item).length > maximumLength)) errors.push(`${label}单项不能超过 ${maximumLength} 个字符`);
    }

    function activityEntries() {
        const catalog = global.AstraLearningActivityCatalog;
        if (!catalog || typeof catalog.entries !== 'function') return [];
        const values = catalog.entries();
        const seen = new Set();
        return (Array.isArray(values) ? values : []).filter(entry => {
            const key = entry && String(entry.activity_key || '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function activityOptions(entries, selected, disabledKeys = []) {
        const disabled = new Set(disabledKeys || []);
        const groups = new Map();
        (entries || []).forEach(entry => {
            const groupKey = `${entry.learning_space_key || entry.galaxy_key}|${entry.subject_key}`;
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(entry);
        });
        return Array.from(groups.entries()).map(([groupKey, items]) => {
            const [galaxy, subject] = groupKey.split('|');
            const label = `${GALAXY_LABELS[galaxy] || galaxy} · ${SUBJECT_LABELS[subject] || subject}`;
            return `<optgroup label="${escapeAttr(label)}">${items.map(entry => `<option value="${escapeAttr(entry.activity_key)}"${entry.activity_key === selected ? ' selected' : ''}${disabled.has(entry.activity_key) ? ' disabled' : ''}>${escapeHtml(activityTitle(entry))} · ${escapeHtml(entry.activity_key)}</option>`).join('')}</optgroup>`;
        }).join('');
    }

    function activityTitle(entry) {
        if (!entry) return '';
        const key = String(entry.activity_key || '');
        if ((entry.learning_space_key || entry.galaxy_key) === 'englab') {
            const registry = global.AstraExperimentRegistry;
            const [subject, id] = key.split('.');
            const definition = registry && typeof registry.get === 'function' ? registry.get(subject, id) : null;
            if (definition && definition.title) return definition.title;
        }
        const future = global.FrontierCourseManifest;
        if (future && typeof future.getActivity === 'function') {
            const candidate = future.getActivity(entry.subject_key, key);
            if (candidate && candidate.title) return candidate.title;
        }
        const code = global.CvCourseManifest;
        if (code && typeof code.getActivity === 'function') {
            const candidate = code.getActivity(key);
            if (candidate && candidate.title) return candidate.title;
        }
        return key.split('.').slice(-1)[0].replace(/-/g, ' ');
    }

    function activityTitleByKey(key) {
        const entry = activityEntries().find(item => item.activity_key === key);
        return entry ? activityTitle(entry) : String(key || '');
    }

    function activityDisplay(key) {
        const entry = activityEntries().find(item => item.activity_key === key);
        return entry ? `${activityTitle(entry)} · ${key}` : key;
    }

    function selectedUnit() {
        return unitByKey(session && session.selectedUnitKey) || session && session.units[0] || null;
    }

    function unitByKey(key) {
        return session && session.units.find(unit => unit.localKey === key) || null;
    }

    function blockByKey(unitKey, blockId) {
        const unit = unitByKey(unitKey);
        return unit && unit.blocks.find(block => block.blockId === blockId) || null;
    }

    function blockMeta(type) {
        return BLOCK_TYPES.find(item => item.type === type) || null;
    }

    function nextLocalUnitKey() {
        localUnitSequence += 1;
        return `local-unit-${localUnitSequence}`;
    }

    function uniqueStableId(prefix, used) {
        let index = 1;
        let value = `${prefix}-${index}`;
        while (used.has(value)) { index += 1; value = `${prefix}-${index}`; }
        return value;
    }

    function beginMutation(label) {
        return !session.host.beginMutation || session.host.beginMutation(label) !== false;
    }

    function endMutation() {
        if (session && typeof session.host.endMutation === 'function') session.host.endMutation();
    }

    async function failMutation(error, label) {
        if (session && typeof session.host.failMutation === 'function') await session.host.failMutation(error, label);
    }

    function notify(type, message) {
        if (session && typeof session.host.notify === 'function') session.host.notify(type, message);
    }

    function isRevisionConflict(error) {
        const detail = error && error.payload && error.payload.detail;
        const code = detail && typeof detail === 'object' ? detail.code : '';
        return Number(error && error.status) === 409 && code === 'course_draft_revision_conflict';
    }

    function errorMessage(error) {
        if (global.AstraApiClient && typeof global.AstraApiClient.message === 'function') return global.AstraApiClient.message(error);
        return error && (error.detail || error.message) ? String(error.detail || error.message) : '请求失败，请稍后重试。';
    }

    function safeMarkdownPreview(value) {
        return escapeHtml(value || '').split(/\n{2,}/).map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
    }

    function safeHttpUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
        } catch (error) { return ''; }
    }

    function mediaTypeLabel(value) {
        return ({ image: '图片', diagram: '示意图', audio: '音频', video: '视频', document: '文档' })[value] || '媒体';
    }

    function responseTypeLabel(value) {
        return ({ 'single-choice': '单选', 'multiple-choice': '多选', numeric: '数值', 'short-text': '简答' })[value] || '检查';
    }

    function normalizeCompletion(value) {
        const source = value && typeof value === 'object' ? value : null;
        if (!source) return null;
        if (source.preset === 'experiment_operation') return { preset: source.preset };
        if (source.preset === 'checkpoint_passed') return {
            preset: source.preset,
            checkpointKey: clean(source.checkpointKey)
        };
        if (source.preset === 'assignment_reviewed') return {
            preset: source.preset,
            assignmentId: positiveInteger(source.assignmentId)
        };
        return null;
    }

    function completionPayload(value) {
        const completion = normalizeCompletion(value);
        if (!completion) return null;
        if (completion.preset === 'checkpoint_passed' && !completion.checkpointKey) return null;
        if (completion.preset === 'assignment_reviewed' && !completion.assignmentId) return null;
        return completion;
    }

    function completionLabel(value) {
        const completion = normalizeCompletion(value);
        if (!completion) return '完成方式尚未设置';
        if (completion.preset === 'experiment_operation') return '完成方式：完成一次实验操作';
        if (completion.preset === 'checkpoint_passed') return `完成方式：答对检查点 ${completion.checkpointKey || '（未选择）'}`;
        return `完成方式：作业 #${completion.assignmentId || '（未选择）'} 完成批改`;
    }

    function formatDate(value) {
        if (!value) return '--';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
    }

    function lines(value) {
        return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    }

    function cleanList(values) {
        return (Array.isArray(values) ? values : []).map(clean).filter(Boolean);
    }

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function optional(value) {
        const text = clean(value);
        return text || null;
    }

    function positiveInteger(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : null;
    }

    function integerOrNull(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : null;
    }

    function finiteNumberOrNull(value) {
        if (value === '' || value === null || value === undefined) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
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

    global.AstraTeacherCourseContent = Object.freeze({
        mount,
        destroy,
        render,
        current: () => session,
        contract: Object.freeze({
            VERSION,
            EXPECTED_ACTIVITY_COUNT,
            BLOCK_TYPES,
            buildDraftPayload,
            buildContentPage,
            createBlock,
            sanitizeBlock,
            validateEditorDraft,
            validateCompletionForPublish,
            completionPayload,
            safeHttpUrl
        })
    });
})(window);

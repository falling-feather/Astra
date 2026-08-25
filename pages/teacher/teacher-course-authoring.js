(function attachTeacherCourseAuthoring(global) {
    'use strict';

    if (global.AstraTeacherCourseAuthoring) return;

    const VERSION = '20260825v841CourseAuthoringP0';
    const STEPS = Object.freeze([
        Object.freeze({ id: 1, label: '基本信息' }),
        Object.freeze({ id: 2, label: '共同教师' }),
        Object.freeze({ id: 3, label: '分类与准入' }),
        Object.freeze({ id: 4, label: '预览提交' })
    ]);
    const GALAXIES = Object.freeze([
        Object.freeze({ key: 'englab', label: '工科试验室' }),
        Object.freeze({ key: 'code-space', label: '代码空间' }),
        Object.freeze({ key: 'future-galaxy', label: '未来星系' })
    ]);
    const SUBJECTS = Object.freeze({
        englab: Object.freeze([
            Object.freeze({ key: 'mathematics', label: '数学' }),
            Object.freeze({ key: 'physics', label: '物理' }),
            Object.freeze({ key: 'chemistry', label: '化学' }),
            Object.freeze({ key: 'algorithms', label: '算法' }),
            Object.freeze({ key: 'biology', label: '生物' })
        ]),
        'code-space': Object.freeze([
            Object.freeze({ key: 'program-start', label: '程序起步' }),
            Object.freeze({ key: 'control-flow', label: '控制流程' }),
            Object.freeze({ key: 'data-functions', label: '数据与函数' }),
            Object.freeze({ key: 'algorithm-thinking', label: '算法思维' }),
            Object.freeze({ key: 'debugging-testing', label: '调试与测试' }),
            Object.freeze({ key: 'challenge-submission', label: '挑战与提交' })
        ]),
        'future-galaxy': Object.freeze([
            Object.freeze({ key: 'earth-space', label: '地球与宇宙科学' }),
            Object.freeze({ key: 'engineering-systems', label: '工程应用' }),
            Object.freeze({ key: 'data-ai', label: '数据科学与 AI' }),
            Object.freeze({ key: 'information-technology', label: '信息技术' }),
            Object.freeze({ key: 'materials-science', label: '材料科学' }),
            Object.freeze({ key: 'humanities-futures', label: '人文与未来' })
        ])
    });
    let session = null;

    function academicYearDefault(now = new Date()) {
        const year = now.getFullYear();
        const start = now.getMonth() >= 6 ? year : year - 1;
        return `${start}—${start + 1}`;
    }

    function newDraft() {
        return {
            title: '',
            summary: '',
            academic_year: academicYearDefault(),
            schedule_text: '',
            total_hours: '32',
            galaxy_key: 'englab',
            subject_key: 'physics',
            admission_mode: 'open',
            collaborator_user_ids: [],
            admission_class_ids: []
        };
    }

    function buildPayload(draft, schoolId) {
        return {
            school_id: Number(schoolId),
            title: String(draft.title || '').trim(),
            summary: optional(draft.summary),
            academic_year: String(draft.academic_year || '').trim(),
            schedule_text: String(draft.schedule_text || '').trim(),
            total_hours: Number(draft.total_hours),
            galaxy_key: String(draft.galaxy_key || '').trim(),
            subject_key: String(draft.subject_key || '').trim(),
            admission_mode: draft.admission_mode === 'class_restricted' ? 'class_restricted' : 'open',
            collaborator_user_ids: uniquePositiveIds(draft.collaborator_user_ids),
            admission_class_ids: draft.admission_mode === 'class_restricted'
                ? uniquePositiveIds(draft.admission_class_ids)
                : []
        };
    }

    function uniquePositiveIds(values) {
        return Array.from(new Set((values || []).map(Number).filter(value => Number.isInteger(value) && value > 0)));
    }

    function optional(value) {
        const text = String(value || '').trim();
        return text || null;
    }

    function mount(root, host) {
        destroy();
        if (!root || !host || typeof host.snapshot !== 'function' || typeof host.request !== 'function') return false;
        session = {
            root,
            host,
            schoolId: '',
            loaded: false,
            loading: false,
            busy: false,
            generation: 0,
            options: null,
            courses: [],
            error: null,
            notice: null,
            open: false,
            step: 1,
            formError: '',
            draft: newDraft(),
            onClick: handleClick,
            onInput: handleInput,
            onChange: handleChange,
            onSubmit: handleSubmit
        };
        root.addEventListener('click', session.onClick);
        root.addEventListener('input', session.onInput);
        root.addEventListener('change', session.onChange);
        root.addEventListener('submit', session.onSubmit);
        render();
        return true;
    }

    function destroy() {
        if (!session) return;
        session.generation += 1;
        session.root.removeEventListener('click', session.onClick);
        session.root.removeEventListener('input', session.onInput);
        session.root.removeEventListener('change', session.onChange);
        session.root.removeEventListener('submit', session.onSubmit);
        session = null;
    }

    function render() {
        if (!session) return false;
        const container = session.root.querySelector('[data-teacher-course-authoring]');
        if (!container) return false;
        const context = safeSnapshot();
        if (!context.active || context.role !== 'teacher') {
            container.innerHTML = roleUnavailableMarkup(context.role);
            return true;
        }
        const schoolId = String(context.schoolId || '');
        if (!schoolId) {
            resetScope('');
            container.innerHTML = emptyScopeMarkup();
            return true;
        }
        if (session.schoolId !== schoolId) resetScope(schoolId);
        container.innerHTML = authoringMarkup(context);
        if (!session.loaded && !session.loading) void refreshScope();
        return true;
    }

    function safeSnapshot() {
        const value = session && session.host.snapshot();
        return value && typeof value === 'object' ? value : {};
    }

    function resetScope(schoolId) {
        if (!session) return;
        session.generation += 1;
        session.schoolId = String(schoolId || '');
        session.loaded = false;
        session.loading = false;
        session.busy = false;
        session.options = null;
        session.courses = [];
        session.error = null;
        session.notice = null;
        session.open = false;
        session.step = 1;
        session.formError = '';
        session.draft = newDraft();
    }

    async function refreshScope(options = {}) {
        if (!session || !session.schoolId || session.loading) return false;
        const generation = ++session.generation;
        const schoolId = session.schoolId;
        session.loading = true;
        session.error = null;
        if (!options.preserveNotice) session.notice = null;
        render();
        try {
            const [authoringOptions, courses] = await Promise.all([
                session.host.request('/api/v1/courses/authoring-options', { params: { school_id: schoolId } }),
                session.host.request('/api/v1/courses', { params: { school_id: schoolId } })
            ]);
            if (!isCurrent(generation, schoolId)) return false;
            session.options = normalizeOptions(authoringOptions, schoolId);
            session.courses = Array.isArray(courses) ? courses.slice() : [];
            session.loaded = true;
            return true;
        } catch (error) {
            if (!isCurrent(generation, schoolId) || isCancelled(error)) return false;
            session.error = error;
            session.loaded = true;
            return false;
        } finally {
            if (isCurrent(generation, schoolId)) {
                session.loading = false;
                render();
            }
        }
    }

    function normalizeOptions(value, schoolId) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            school_id: Number(source.school_id || schoolId),
            teachers: Array.isArray(source.teachers) ? source.teachers.slice() : [],
            homerooms: Array.isArray(source.homerooms) ? source.homerooms.slice() : [],
            admission_modes: Array.isArray(source.admission_modes) ? source.admission_modes.slice() : []
        };
    }

    function isCurrent(generation, schoolId) {
        return Boolean(session && generation === session.generation && String(session.schoolId) === String(schoolId));
    }

    function isCancelled(error) {
        return Boolean(global.AstraApiClient && typeof global.AstraApiClient.isCancelled === 'function'
            && global.AstraApiClient.isCancelled(error));
    }

    function roleUnavailableMarkup(role) {
        return `<div class="teacher-course-authoring__empty"><i data-lucide="shield-check"></i><div><strong>教师创建入口</strong><p>${role === 'admin' ? '管理员在管理工作台审核课程；本入口仅供正式教师创建和提交课程。' : '完成教师身份审核后，才可以创建授课课程。'}</p></div></div>`;
    }

    function emptyScopeMarkup() {
        return '<div class="teacher-course-authoring__empty"><i data-lucide="school"></i><div><strong>先选择学校</strong><p>课程草稿必须归属于一个学校；选择顶部学校后再开始创建。</p></div></div>';
    }

    function authoringMarkup(context) {
        const blocked = Boolean(context.blocked || session.busy);
        return `
            <section class="teacher-course-authoring" aria-labelledby="teacher-course-authoring-title">
                <header class="teacher-course-authoring__header">
                    <div><span>COURSE AUTHORING</span><h3 id="teacher-course-authoring-title">创建授课课程</h3><p>${escapeHtml(context.schoolLabel || '当前学校')} · 教师创建草稿，管理员审核后才会生成课程码并正式启用。</p></div>
                    <button type="button" class="teacher-course-authoring__refresh" data-course-authoring-action="refresh" data-course-authoring-control ${session.loading || blocked ? 'disabled' : ''}><i data-lucide="refresh-cw"></i><span>刷新</span></button>
                </header>
                ${noticeMarkup()}
                ${session.loading && !session.loaded ? loadingMarkup() : ''}
                ${session.error ? errorMarkup(session.error) : ''}
                ${session.loaded && !session.error ? `${session.open ? wizardMarkup(context) : launchMarkup(blocked)}${courseListMarkup(blocked)}` : ''}
            </section>`;
    }

    function noticeMarkup() {
        if (!session.notice) return '';
        return `<div class="teacher-course-authoring__notice" data-type="${escapeAttr(session.notice.type)}" role="status"><i data-lucide="${session.notice.type === 'success' ? 'circle-check-big' : 'triangle-alert'}"></i><span>${escapeHtml(session.notice.message)}</span></div>`;
    }

    function loadingMarkup() {
        return '<div class="teacher-course-authoring__loading" role="status"><i data-lucide="loader-circle"></i><span>正在读取共同教师、行政班和课程草稿…</span></div>';
    }

    function errorMarkup(error) {
        return `<div class="teacher-course-authoring__error" role="alert"><div><strong>课程创建信息读取失败</strong><p>${escapeHtml(errorMessage(error))}</p></div><button type="button" data-course-authoring-action="retry" data-course-authoring-control>重试</button></div>`;
    }

    function launchMarkup(blocked) {
        return `
            <div class="teacher-course-authoring__launch">
                <div><strong>从一份待审核草稿开始</strong><p>课程分类只用于目录归类和默认筛选，不会限制教师后续引用其他学科的实验或内容。</p></div>
                <button type="button" data-course-authoring-action="open" data-course-authoring-control ${blocked ? 'disabled' : ''}><i data-lucide="book-plus"></i><span>创建课程</span></button>
            </div>`;
    }

    function wizardMarkup(context) {
        const blocked = Boolean(context.blocked || session.busy);
        return `
            <form class="teacher-course-wizard" data-course-authoring-form novalidate>
                <ol class="teacher-course-wizard__steps" aria-label="课程创建步骤">
                    ${STEPS.map(step => `<li data-state="${step.id === session.step ? 'current' : step.id < session.step ? 'done' : 'upcoming'}" ${step.id === session.step ? 'aria-current="step"' : ''}><span>${step.id < session.step ? '<i data-lucide="check"></i>' : step.id}</span><strong>${escapeHtml(step.label)}</strong></li>`).join('')}
                </ol>
                <div class="teacher-course-wizard__panel">
                    ${session.formError ? `<div class="teacher-course-wizard__form-error" role="alert">${escapeHtml(session.formError)}</div>` : ''}
                    ${wizardStepMarkup()}
                </div>
                <footer class="teacher-course-wizard__actions">
                    <button type="button" data-course-authoring-action="cancel" data-course-authoring-control ${blocked ? 'disabled' : ''}>暂不创建</button>
                    <span></span>
                    ${session.step > 1 ? `<button type="button" data-course-authoring-action="back" data-course-authoring-control ${blocked ? 'disabled' : ''}><i data-lucide="arrow-left"></i><span>上一步</span></button>` : ''}
                    ${session.step < STEPS.length
                        ? `<button type="button" class="is-primary" data-course-authoring-action="next" data-course-authoring-control ${blocked ? 'disabled' : ''}><span>下一步</span><i data-lucide="arrow-right"></i></button>`
                        : `<button type="submit" class="is-primary" data-course-authoring-control ${blocked ? 'disabled' : ''}><i data-lucide="send"></i><span>${session.busy ? '正在创建…' : '创建并提交审核'}</span></button>`}
                </footer>
            </form>`;
    }

    function wizardStepMarkup() {
        if (session.step === 1) return basicStepMarkup();
        if (session.step === 2) return teacherStepMarkup();
        if (session.step === 3) return classificationStepMarkup();
        return previewStepMarkup();
    }

    function basicStepMarkup() {
        const draft = session.draft;
        return `
            <fieldset class="teacher-course-wizard__fields">
                <legend><span>01</span><div><strong>填写课程基本信息</strong><small>先说明这门课叫什么、何时上课、计划多少课时。</small></div></legend>
                <label class="is-wide"><span>课程名称</span><input name="title" data-course-authoring-field value="${escapeAttr(draft.title)}" maxlength="180" placeholder="例如：高一物理实验与探究" required></label>
                <label><span>学年</span><input name="academic_year" data-course-authoring-field value="${escapeAttr(draft.academic_year)}" maxlength="32" required></label>
                <label><span>总课时</span><input name="total_hours" data-course-authoring-field value="${escapeAttr(draft.total_hours)}" type="number" min="1" max="10000" required></label>
                <label class="is-wide"><span>上课时间</span><input name="schedule_text" data-course-authoring-field value="${escapeAttr(draft.schedule_text)}" maxlength="240" placeholder="例如：每周二 14:00—15:40" required></label>
                <label class="is-wide"><span>课程简介（可选）</span><textarea name="summary" data-course-authoring-field maxlength="2000" rows="3" placeholder="用一两句话说明学习对象和主要内容">${escapeHtml(draft.summary)}</textarea></label>
            </fieldset>`;
    }

    function teacherStepMarkup() {
        const teachers = session.options && session.options.teachers || [];
        return `
            <fieldset class="teacher-course-wizard__fields teacher-course-wizard__fields--choices">
                <legend><span>02</span><div><strong>选择共同教师</strong><small>共同教师会立即看到同一份课程草稿，并可以继续提交审核。</small></div></legend>
                <div class="teacher-course-choice-list is-wide">
                    ${teachers.length ? teachers.map(teacher => {
                        const checked = session.draft.collaborator_user_ids.includes(Number(teacher.user_id));
                        return `<label><input type="checkbox" name="collaborator_user_ids" value="${escapeAttr(teacher.user_id)}" data-course-authoring-field ${checked ? 'checked' : ''}><span><strong>${escapeHtml(teacher.display_name)}</strong><small>@${escapeHtml(teacher.username)} · 共同编辑</small></span></label>`;
                    }).join('') : '<div class="teacher-course-choice-list__empty">当前学校暂无其他可选教师；你仍可以单独创建课程。</div>'}
                </div>
            </fieldset>`;
    }

    function classificationStepMarkup() {
        const draft = session.draft;
        const subjects = subjectsFor(draft.galaxy_key);
        const homerooms = session.options && session.options.homerooms || [];
        return `
            <fieldset class="teacher-course-wizard__fields teacher-course-wizard__fields--choices">
                <legend><span>03</span><div><strong>选择分类与加入方式</strong><small>星系和学科负责默认展示位置，不限制后续课程内容。</small></div></legend>
                <label><span>所属星系</span><select name="galaxy_key" data-course-authoring-field>${GALAXIES.map(item => `<option value="${item.key}"${item.key === draft.galaxy_key ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
                <label><span>所属学科</span><select name="subject_key" data-course-authoring-field>${subjects.map(item => `<option value="${item.key}"${item.key === draft.subject_key ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
                <label class="is-wide"><span>学生准入方式</span><select name="admission_mode" data-course-authoring-field><option value="open"${draft.admission_mode === 'open' ? ' selected' : ''}>公开申请加入</option><option value="class_restricted"${draft.admission_mode === 'class_restricted' ? ' selected' : ''}>仅指定行政班申请</option></select><small class="teacher-course-wizard__hint">公开不代表自动加入；学生申请仍需进入后续课程加入流程。</small></label>
                ${draft.admission_mode === 'class_restricted' ? `
                    <div class="teacher-course-choice-list is-wide" aria-label="允许申请的行政班">
                        ${homerooms.length ? homerooms.map(homeroom => {
                            const checked = draft.admission_class_ids.includes(Number(homeroom.class_id));
                            const meta = [homeroom.grade, homeroom.term].filter(Boolean).join(' · ');
                            return `<label><input type="checkbox" name="admission_class_ids" value="${escapeAttr(homeroom.class_id)}" data-course-authoring-field ${checked ? 'checked' : ''}><span><strong>${escapeHtml(homeroom.name)}</strong><small>${escapeHtml(meta || '当前学校行政班')}</small></span></label>`;
                        }).join('') : '<div class="teacher-course-choice-list__empty">当前学校没有可用行政班，请改为公开申请或先建立行政班。</div>'}
                    </div>` : ''}
            </fieldset>`;
    }

    function previewStepMarkup() {
        const draft = session.draft;
        const teachers = selectedTeachers();
        const classes = selectedHomerooms();
        return `
            <section class="teacher-course-preview">
                <header><span>04</span><div><strong>确认后提交管理员审核</strong><small>此操作不会直接发布课程，也不会立即生成课程码。</small></div></header>
                <div class="teacher-course-preview__title"><span>${escapeHtml(galaxyLabel(draft.galaxy_key))} · ${escapeHtml(subjectLabel(draft.galaxy_key, draft.subject_key))}</span><h4>${escapeHtml(draft.title || '未填写课程名称')}</h4><p>${escapeHtml(draft.summary || '未填写课程简介')}</p></div>
                <dl>
                    <div><dt>学年</dt><dd>${escapeHtml(draft.academic_year)}</dd></div>
                    <div><dt>上课时间</dt><dd>${escapeHtml(draft.schedule_text)}</dd></div>
                    <div><dt>总课时</dt><dd>${escapeHtml(draft.total_hours)} 课时</dd></div>
                    <div><dt>共同教师</dt><dd>${teachers.length ? teachers.map(item => escapeHtml(item.display_name)).join('、') : '无'}</dd></div>
                    <div><dt>加入方式</dt><dd>${draft.admission_mode === 'class_restricted' ? '仅指定行政班申请' : '公开申请加入'}</dd></div>
                    <div><dt>准入班级</dt><dd>${classes.length ? classes.map(item => escapeHtml(item.name)).join('、') : '不限制行政班'}</dd></div>
                </dl>
                <div class="teacher-course-preview__boundary"><i data-lucide="shield-check"></i><p><strong>提交后状态：待管理员审核</strong><span>管理员通过后才会生成课程码、内部课程群组和初始内容版本。</span></p></div>
            </section>`;
    }

    function courseListMarkup(blocked) {
        const courses = session.courses || [];
        return `
            <section class="teacher-course-drafts" aria-labelledby="teacher-course-drafts-title">
                <header><div><span>MY COURSES</span><h4 id="teacher-course-drafts-title">我参与的课程</h4></div><strong>${courses.length}</strong></header>
                ${courses.length ? `<div class="teacher-course-drafts__list">${courses.map(course => courseCardMarkup(course, blocked)).join('')}</div>` : '<div class="teacher-course-drafts__empty"><i data-lucide="notebook-tabs"></i><p><strong>还没有课程草稿</strong><span>创建后，你和共同教师会在这里看到同一份审核状态。</span></p></div>'}
            </section>`;
    }

    function courseCardMarkup(course, blocked) {
        const revision = course && course.information_revision || {};
        const status = revision.status || course.status || 'draft';
        const teachers = Array.isArray(course.teachers) ? course.teachers : [];
        return `
            <article class="teacher-course-draft" data-state="${escapeAttr(status)}">
                <div class="teacher-course-draft__status"><span>${escapeHtml(courseStatusLabel(status))}</span><small>${course.course_code ? `课程码 ${escapeHtml(course.course_code)}` : '审核通过后生成课程码'}</small></div>
                <div class="teacher-course-draft__body"><span>${escapeHtml(galaxyLabel(course.galaxy_key))} · ${escapeHtml(subjectLabel(course.galaxy_key, course.subject_key))}</span><h5>${escapeHtml(course.title)}</h5><p>${escapeHtml(course.academic_year || '--')} · ${escapeHtml(course.schedule_text || '--')} · ${escapeHtml(course.total_hours || 0)} 课时</p></div>
                <div class="teacher-course-draft__people"><i data-lucide="users-round"></i><span>${teachers.length ? teachers.map(item => escapeHtml(item.display_name)).join('、') : '教师信息待读取'}</span></div>
                ${status === 'draft' ? `<button type="button" data-course-authoring-submit-draft="${escapeAttr(course.id)}" data-revision-id="${escapeAttr(revision.id)}" data-course-authoring-control ${blocked ? 'disabled' : ''}>提交审核 <i data-lucide="send"></i></button>` : '<span class="teacher-course-draft__receipt"><i data-lucide="clock-3"></i>等待管理员处理</span>'}
            </article>`;
    }

    function handleClick(event) {
        if (!session || !(event.target instanceof Element)) return;
        const submitDraft = event.target.closest('[data-course-authoring-submit-draft]');
        if (submitDraft) {
            void submitExistingDraft(submitDraft.dataset.courseAuthoringSubmitDraft, submitDraft.dataset.revisionId);
            return;
        }
        const action = event.target.closest('[data-course-authoring-action]');
        if (!action) return;
        const name = action.dataset.courseAuthoringAction;
        if (name === 'refresh' || name === 'retry') {
            session.loaded = false;
            void refreshScope();
            return;
        }
        if (name === 'open') {
            session.open = true;
            session.step = 1;
            session.formError = '';
            session.notice = null;
            render();
            focusWizard();
            return;
        }
        if (name === 'cancel') {
            session.open = false;
            session.step = 1;
            session.formError = '';
            render();
            return;
        }
        if (name === 'back' && session.step > 1) {
            session.step -= 1;
            session.formError = '';
            render();
            focusWizard();
            return;
        }
        if (name === 'next' && validateStep(session.step)) {
            session.step = Math.min(STEPS.length, session.step + 1);
            session.formError = '';
            render();
            focusWizard();
        }
    }

    function handleInput(event) {
        if (!session || !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) return;
        if (!event.target.matches('[data-course-authoring-field]')) return;
        syncField(event.target);
    }

    function handleChange(event) {
        if (!session || !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) return;
        if (!event.target.matches('[data-course-authoring-field]')) return;
        const previousGalaxy = session.draft.galaxy_key;
        syncField(event.target);
        if (event.target.name === 'galaxy_key') {
            const subjects = subjectsFor(session.draft.galaxy_key);
            if (previousGalaxy !== session.draft.galaxy_key || !subjects.some(item => item.key === session.draft.subject_key)) {
                session.draft.subject_key = subjects[0] && subjects[0].key || '';
            }
            render();
        } else if (event.target.name === 'admission_mode') {
            if (session.draft.admission_mode === 'open') session.draft.admission_class_ids = [];
            render();
        }
    }

    function syncField(control) {
        if (!session || !control.name) return;
        if (control.name === 'collaborator_user_ids' || control.name === 'admission_class_ids') {
            session.draft[control.name] = Array.from(session.root.querySelectorAll(`input[name="${control.name}"]:checked`)).map(item => Number(item.value));
            return;
        }
        session.draft[control.name] = control.value;
    }

    function handleSubmit(event) {
        if (!session || !(event.target instanceof HTMLFormElement) || !event.target.matches('[data-course-authoring-form]')) return;
        event.preventDefault();
        if (validateAll()) void createAndSubmit();
    }

    function validateStep(step) {
        session.formError = '';
        if (step === 1) {
            const form = session.root.querySelector('[data-course-authoring-form]');
            if (form && !form.reportValidity()) return false;
            if (!session.draft.title.trim() || !session.draft.academic_year.trim() || !session.draft.schedule_text.trim()) {
                session.formError = '请完整填写课程名称、学年和上课时间。';
            } else if (!Number.isInteger(Number(session.draft.total_hours)) || Number(session.draft.total_hours) < 1) {
                session.formError = '总课时必须是大于 0 的整数。';
            }
        }
        if (step === 3) {
            if (!subjectsFor(session.draft.galaxy_key).some(item => item.key === session.draft.subject_key)) {
                session.formError = '请选择当前星系中的一个学科。';
            } else if (session.draft.admission_mode === 'class_restricted' && !session.draft.admission_class_ids.length) {
                session.formError = '班级限制课程至少要选择一个允许申请的行政班。';
            }
        }
        if (session.formError) {
            render();
            focusWizard();
            return false;
        }
        return true;
    }

    function validateAll() {
        for (const step of [1, 3]) {
            if (!validateStep(step)) return false;
        }
        return true;
    }

    async function createAndSubmit() {
        if (!session || session.busy || !beginMutation('创建并提交课程审核')) return false;
        let created = null;
        session.busy = true;
        session.error = null;
        session.notice = null;
        render();
        try {
            created = await session.host.request('/api/v1/courses', {
                method: 'POST',
                body: buildPayload(session.draft, session.schoolId)
            });
            upsertCourse(created);
            const revisionId = created && created.information_revision && created.information_revision.id;
            const submitted = await session.host.request(`/api/v1/courses/${created.id}/information-revisions/${revisionId}/submit`, { method: 'POST' });
            upsertCourse(submitted);
            session.draft = newDraft();
            session.open = false;
            session.step = 1;
            session.notice = { type: 'success', message: '课程已创建并提交管理员审核；共同教师现在也能看到同一条待审记录。' };
            notify('success', '课程已创建并提交管理员审核');
            return true;
        } catch (error) {
            if (created) {
                session.open = false;
                session.notice = { type: 'warning', message: '课程草稿已创建，但提交审核未完成；请在下方草稿列表继续提交。' };
            } else {
                session.formError = errorMessage(error);
            }
            await failMutation(error, created ? '提交课程审核' : '创建课程草稿');
            return false;
        } finally {
            session.busy = false;
            endMutation();
            render();
        }
    }

    async function submitExistingDraft(courseId, revisionId) {
        if (!session || session.busy) return false;
        const course = session.courses.find(item => String(item.id) === String(courseId));
        const revision = course && course.information_revision;
        if (!course || !revision || String(revision.id) !== String(revisionId) || revision.status !== 'draft') return false;
        if (!beginMutation('提交课程审核')) return false;
        session.busy = true;
        session.notice = null;
        render();
        try {
            const submitted = await session.host.request(`/api/v1/courses/${course.id}/information-revisions/${revision.id}/submit`, { method: 'POST' });
            upsertCourse(submitted);
            session.notice = { type: 'success', message: `“${submitted.title}”已提交管理员审核。` };
            notify('success', '课程已提交管理员审核');
            return true;
        } catch (error) {
            session.notice = { type: 'warning', message: errorMessage(error) };
            await failMutation(error, '提交课程审核');
            return false;
        } finally {
            session.busy = false;
            endMutation();
            render();
        }
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

    function upsertCourse(course) {
        if (!course || !session) return;
        session.courses = [course, ...session.courses.filter(item => String(item.id) !== String(course.id))];
    }

    function selectedTeachers() {
        const teachers = session.options && session.options.teachers || [];
        return teachers.filter(item => session.draft.collaborator_user_ids.includes(Number(item.user_id)));
    }

    function selectedHomerooms() {
        const homerooms = session.options && session.options.homerooms || [];
        return homerooms.filter(item => session.draft.admission_class_ids.includes(Number(item.class_id)));
    }

    function subjectsFor(galaxyKey) {
        return SUBJECTS[galaxyKey] || [];
    }

    function galaxyLabel(key) {
        const item = GALAXIES.find(entry => entry.key === key);
        return item ? item.label : key || '未分类星系';
    }

    function subjectLabel(galaxyKey, subjectKey) {
        const item = subjectsFor(galaxyKey).find(entry => entry.key === subjectKey);
        return item ? item.label : subjectKey || '未分类学科';
    }

    function courseStatusLabel(status) {
        return ({ draft: '课程信息草稿', submitted: '待管理员审核', approved: '审核已通过', rejected: '审核已退回' })[status] || String(status || '状态未知');
    }

    function focusWizard() {
        global.requestAnimationFrame(function () {
            if (!session) return;
            const target = session.root.querySelector('.teacher-course-wizard__panel input, .teacher-course-wizard__panel select, .teacher-course-wizard__panel button, .teacher-course-wizard__panel h4');
            if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
        });
    }

    function errorMessage(error) {
        if (global.AstraApiClient && typeof global.AstraApiClient.message === 'function') return global.AstraApiClient.message(error);
        return error && error.message ? error.message : '请求失败，请稍后重试。';
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

    global.AstraTeacherCourseAuthoring = Object.freeze({
        mount,
        destroy,
        render,
        contract: Object.freeze({ VERSION, STEPS, GALAXIES, SUBJECTS, buildPayload, courseStatusLabel })
    });
})(window);

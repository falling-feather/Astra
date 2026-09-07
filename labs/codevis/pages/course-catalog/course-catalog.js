(function (global) {
    'use strict';

    const session = global.CvCourseSession = global.CvCourseSession || {
        activityKey: 'control-flow.loop-boundary',
        courseKey: 'control-flow'
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function activityState(activity) {
        return global.CvCourseStateAdapter.resolve(activity);
    }

    function learningGate() {
        const context = global.CvStudentContext;
        return context && typeof context.gate === 'function' ? context.gate() : { blocked: false };
    }

    function renderGate(root, gate) {
        root.innerHTML = '<div class="course-context-gate" role="status" aria-live="polite"><p class="course-eyebrow">代码空间</p><h1>' + escapeHtml(gate.title || '课程暂不可用') + '</h1><p class="course-lede">' + escapeHtml(gate.message || '请稍后重试。') + '</p></div>';
    }

    function courseTitle(manifest, activity) {
        const course = manifest.courses.find(item => item.course_key === activity.course_key);
        return course ? course.title : '代码空间';
    }

    function routeActivity(manifest) {
        const routeKey = global.CvRouter && global.CvRouter.currentParams && global.CvRouter.currentParams.get('activity');
        return manifest.getActivity(routeKey || session.activityKey);
    }

    function stateCopy(state) {
        if (state.status === 'completed') return '已完成';
        if (state.status === 'locked') return '前置课程后开放';
        if (state.status === 'unavailable') return '暂不可用';
        return '可学习';
    }

    function renderActivity(activity) {
        const state = activityState(activity);
        if (state.status === 'hidden') return '';
        const locked = state.status === 'locked';
        const unavailable = state.status === 'unavailable';
        const action = locked || unavailable
            ? '<span class="course-row__state" aria-label="' + stateCopy(state) + '">' + stateCopy(state) + '</span>'
            : '<button class="course-row__action" type="button" data-open-activity="' + activity.activity_key + '">' + (state.status === 'completed' ? '再次查看' : '进入子课') + ' <span aria-hidden="true">→</span></button>';
        const detail = locked ? '<small>' + escapeHtml(state.lock_reason || '当前课程暂不可用。') + '</small>' : '<small>' + activity.goal + '</small>';
        return '<li class="course-row course-row--' + state.status + '">' +
            '<span class="course-row__marker" aria-hidden="true">' + (locked ? '⌁' : state.status === 'completed' ? '✓' : '•') + '</span>' +
            '<div class="course-row__copy"><strong>' + activity.title + '</strong>' + detail + '</div>' + action +
            '</li>';
    }

    function renderCourseRail(courses) {
        return courses.map((course, index) => {
            const hasVisible = course.activities.some(activity => activityState(activity).status !== 'hidden');
            if (!hasVisible) return '';
            return '<button type="button" class="course-rail__item' + (course.course_key === session.courseKey ? ' is-selected' : '') + '" data-select-course="' + course.course_key + '">' +
                '<span>' + String(index + 1).padStart(2, '0') + '</span><strong>' + course.title + '</strong></button>';
        }).join('');
    }

    function hasVisibleActivity(course) {
        return course.activities.some(activity => activityState(activity).status !== 'hidden');
    }

    function firstEnterableActivity(course) {
        return course.activities.find(activity => {
            const status = activityState(activity).status;
            return status === 'available' || status === 'completed';
        }) || null;
    }

    function render() {
        const root = document.getElementById('course-catalog-root');
        const manifest = global.CvCourseManifest;
        if (!root || !manifest) return;
        const gate = learningGate();
        if (gate.blocked) {
            renderGate(root, gate);
            return;
        }
        const visibleCourses = manifest.courses.filter(hasVisibleActivity);
        let course = manifest.courses.find(item => item.course_key === session.courseKey) || visibleCourses[0] || manifest.courses[0];
        if (!hasVisibleActivity(course) && visibleCourses.length) course = visibleCourses[0];
        session.courseKey = course.course_key;
        const rows = course.activities.map(renderActivity).join('');
        const representative = firstEnterableActivity(course);
        const representativeAction = representative
            ? '<button class="cv-btn cv-btn--primary" type="button" data-open-representative="' + representative.activity_key + '">进入代表挑战</button>'
            : '<button class="cv-btn cv-btn--primary" type="button" disabled aria-disabled="true">暂不可进入挑战</button>';
        root.innerHTML = '<div class="course-shell">' +
            '<aside class="course-rail" aria-label="课程目录"><p>学习路径</p>' + renderCourseRail(manifest.courses) + '</aside>' +
            '<section class="course-stage" aria-labelledby="course-catalog-title">' +
                '<p class="course-eyebrow">课程目录 / 代码空间</p>' +
                '<h1 id="course-catalog-title">' + course.title + '</h1><p class="course-lede">' + course.goal + '</p>' +
                '<ol class="course-rows">' + rows + '</ol>' +
                '<p class="course-fallback">未发布内容不会出现在学习目录中。</p>' +
            '</section>' +
            '<aside class="course-context" aria-label="课程说明"><p>学习方式</p><h2>先预测，再验证</h2><ol><li>写下你认为会发生的事。</li><li>运行并沿轨迹观察。</li><li>修正后再做公开预检。</li></ol>' + representativeAction + '</aside>' +
            '</div>';

        root.querySelectorAll('[data-select-course]').forEach(button => button.addEventListener('click', () => {
            session.courseKey = button.dataset.selectCourse;
            render();
        }));
        root.querySelectorAll('[data-open-activity]').forEach(button => button.addEventListener('click', () => {
            const activity = manifest.getActivity(button.dataset.openActivity);
            session.activityKey = activity.activity_key;
            session.courseKey = activity.course_key;
            global.CvRouter.navigateTo('lesson', { activity: activity.activity_key });
        }));
        const representativeButton = root.querySelector('[data-open-representative]');
        if (representativeButton) representativeButton.addEventListener('click', () => {
            const activity = manifest.getActivity(representativeButton.dataset.openRepresentative);
            session.activityKey = activity.activity_key;
            session.courseKey = activity.course_key;
            global.CvRouter.navigateTo('challenge', { activity: activity.activity_key });
        });
    }

    function renderLesson() {
        const root = document.getElementById('course-lesson-root');
        const manifest = global.CvCourseManifest;
        if (!root) return;
        const gate = learningGate();
        if (gate.blocked) {
            renderGate(root, gate);
            return;
        }
        const activity = manifest && routeActivity(manifest);
        if (!activity) {
            root.replaceChildren();
            global.CvRouter.navigateTo('catalog');
            return;
        }
        session.activityKey = activity.activity_key;
        session.courseKey = activity.course_key;
        const state = activityState(activity);
        if (state.status === 'hidden') {
            root.replaceChildren();
            const challengeRoot = document.getElementById('course-challenge-root');
            if (challengeRoot) challengeRoot.replaceChildren();
            global.CvRouter.navigateTo('catalog');
            return;
        }
        const template = manifest.getTemplate(activity);
        const disabled = state.status === 'locked' || state.status === 'unavailable';
        root.innerHTML = '<div class="lesson-shell">' +
            '<a class="lesson-back" href="#catalog">← 返回课程目录</a>' +
            '<p class="course-eyebrow">' + escapeHtml(courseTitle(manifest, activity)) + ' / 子课程</p>' +
            '<h1>' + activity.title + '</h1><p class="course-lede">' + activity.goal + '</p>' +
            '<div class="lesson-brief"><div><span>先预测</span><p>' + template.prediction + '</p></div><div><span>可观察轨迹</span><p>' + template.trace_prompt + '</p></div><div><span>修正线索</span><p>' + template.repair_hint + '</p></div></div>' +
            (disabled ? '<p class="course-fallback">' + escapeHtml(state.lock_reason || '当前课程暂不可用。') + '</p>' : '<a class="cv-btn cv-btn--primary" href="#challenge?activity=' + encodeURIComponent(activity.activity_key) + '">进入可编辑挑战</a>') +
            '</div>';
    }

    global.CvCourseCatalog = {
        init: render,
        renderLesson,
        refresh() {
            const activity = global.CvCourseManifest && global.CvCourseManifest.getActivity(session.activityKey);
            if (activity && activityState(activity).status === 'hidden') {
                const lessonRoot = document.getElementById('course-lesson-root');
                const challengeRoot = document.getElementById('course-challenge-root');
                if (lessonRoot) lessonRoot.replaceChildren();
                if (challengeRoot) challengeRoot.replaceChildren();
            }
            render();
        }
    };
})(window);

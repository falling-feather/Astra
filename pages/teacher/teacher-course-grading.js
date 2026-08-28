(function attachTeacherCourseGrading(global) {
    'use strict';

    if (global.AstraTeacherCourseGrading) return;

    const positiveId = (value) => {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : 0;
    };

    async function open(action, port) {
        const state = port && port.state;
        if (!state || !state.active || !state.user || !['teacher', 'admin'].includes(state.user.role)) return false;
        const courseId = positiveId(action && action.course_id);
        const classId = positiveId(action && action.class_id);
        const assignmentId = positiveId(action && action.assignment_id);
        const submissionId = positiveId(action && action.submission_id);
        if (![courseId, classId, assignmentId, submissionId].every(Boolean)) return false;

        port.invalidateRequests();
        port.clearPrivateDownstream();
        const generation = port.beginRequestGeneration();
        port.setBusy(true);
        state.flash = null;
        state.filters.galaxyKey = '';
        state.activeView = 'grading';
        try {
            const courses = await port.fetchJson('/api/courses');
            if (!port.isCurrentRequest(generation)) return false;
            const course = port.findById(courses, courseId);
            if (!course) throw new Error('待批改课程已不在当前教师的有效授课范围');
            state.data.courses = courses;
            state.data.classes = state.data.classes
                .filter((item) => Number(item.id) !== classId)
                .concat({
                    id: classId,
                    school_id: course.school_id,
                    name: '课程直属名单（不关联行政班）',
                    kind: 'course_cohort',
                    status: 'active'
                });
            state.selected.classId = String(classId);
            state.selected.courseId = String(courseId);
            state.data.curriculumAttached = true;
            port.renderWorkspace();
            await port.loadCourseScope(generation);
            if (!port.isCurrentRequest(generation)) return false;
            if (!state.data.assignments.some((item) => Number(item.id) === assignmentId)) {
                throw new Error('待批改作业已不在当前课程范围');
            }
            state.selected.assignmentId = String(assignmentId);
            state.pagination.assignmentSubmissionOffset = 0;
            await port.loadAssignmentScope(generation);
            if (!port.isCurrentRequest(generation)) return false;
            if (!state.data.assignmentSubmissions.some((item) => Number(item.id) === submissionId)) {
                throw new Error('待批改提交已不在当前作业分页');
            }
            const assignment = port.findById(state.data.assignments, assignmentId);
            state.data.submissions = state.data.assignmentSubmissions
                .filter((item) => item.status === 'submitted')
                .map((item) => ({
                    ...item,
                    assignment_title: assignment ? assignment.title : `作业 #${assignmentId}`,
                    course_title: course.title,
                    student_display_name: '未命名学生'
                }));
            state.data.submissions.total = state.data.submissions.length;
            port.renderWorkspace();
            const form = state.root && state.root.querySelector('[data-teacher-form="grade"]');
            if (form && typeof form.scrollIntoView === 'function') {
                form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return true;
        } catch (error) {
            if (!global.AstraApiClient.isCancelled(error) && port.isCurrentRequest(generation)) {
                port.setFlash('error', port.errorMessage(error));
            }
            return false;
        } finally {
            if (port.isCurrentRequest(generation)) {
                port.setBusy(false);
                port.renderWorkspace();
            }
        }
    }

    global.AstraTeacherCourseGrading = Object.freeze({ open });
})(window);

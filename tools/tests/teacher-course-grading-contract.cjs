'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'pages/teacher/teacher-course-grading.js'), 'utf8');
const context = {
  window: null,
  AstraApiClient: { isCancelled: () => false },
  console,
  Object,
  Number,
  String,
  Error,
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'teacher-course-grading.js' });

function stateFor(role = 'teacher') {
  return {
    active: true,
    user: { role },
    root: { querySelector: () => ({ scrollIntoView() {} }) },
    flash: null,
    filters: { galaxyKey: 'englab' },
    activeView: 'overview',
    selected: { classId: '', courseId: '', assignmentId: '' },
    pagination: { assignmentSubmissionOffset: 20 },
    data: { classes: [], courses: [], assignments: [], assignmentSubmissions: [], submissions: [], curriculumAttached: false },
  };
}

async function run() {
  const state = stateFor();
  const busy = [];
  let renders = 0;
  let scrolled = false;
  state.root.querySelector = () => ({ scrollIntoView() { scrolled = true; } });
  const port = {
    state,
    invalidateRequests() {},
    clearPrivateDownstream() {},
    beginRequestGeneration: () => 7,
    setBusy: (value) => busy.push(value),
    isCurrentRequest: (generation) => generation === 7,
    fetchJson: async () => [{ id: 11, school_id: 2, title: '课程直属批改' }],
    findById: (items, id) => items.find((item) => Number(item.id) === Number(id)) || null,
    renderWorkspace: () => { renders += 1; },
    loadCourseScope: async () => { state.data.assignments = [{ id: 31, title: '课程作业' }]; },
    loadAssignmentScope: async () => { state.data.assignmentSubmissions = [{ id: 41, student_id: 5, status: 'submitted' }]; },
    setFlash() {},
    errorMessage: (error) => error.message,
  };

  assert.equal(await context.AstraTeacherCourseGrading.open({ course_id: 11, class_id: 21, assignment_id: 31, submission_id: 41 }, port), true);
  assert.equal(state.activeView, 'grading');
  assert.equal(state.selected.classId, '21');
  assert.equal(state.selected.courseId, '11');
  assert.equal(state.selected.assignmentId, '31');
  assert.equal(state.data.curriculumAttached, true);
  assert.equal(state.data.classes[0].kind, 'course_cohort');
  assert.equal(state.data.submissions[0].assignment_title, '课程作业');
  assert.equal(state.data.submissions[0].course_title, '课程直属批改');
  assert.deepEqual(busy, [true, false]);
  assert.ok(renders >= 3);
  assert.equal(scrolled, true);

  const studentPort = { ...port, state: stateFor('student') };
  assert.equal(await context.AstraTeacherCourseGrading.open({ course_id: 11, class_id: 21, assignment_id: 31, submission_id: 41 }, studentPort), false);
  assert.equal(await context.AstraTeacherCourseGrading.open({ course_id: 11 }, port), false);
  console.log('teacher-course-grading-contract: direct course scope orchestration PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

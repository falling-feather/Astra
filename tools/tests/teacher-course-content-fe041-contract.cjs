const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const contentSource = read('pages/teacher/teacher-course-content.js');
const authoringSource = read('pages/teacher/teacher-course-authoring.js');
const styles = read('pages/teacher/teacher-course-content.css');
const authoringStyles = read('pages/teacher/teacher-course-authoring.css');
const teacherSource = read('pages/teacher/teacher.js');
const registrySource = read('shared/js/page-registry.js');
const officialKeysSource = read('backend/app/schemas/official_activity_keys.py');
const officialKeys = Array.from(officialKeysSource.matchAll(/^\s+"([a-z0-9._:-]+)",$/gm), match => match[1]);

for (const endpoint of [
  '/api/v1/courses/${requestedCourseId}/draft',
  '/api/v1/courses/${requestedCourseId}/releases',
  '/api/v1/courses/${course.id}/draft',
  '/api/v1/courses/${course.id}/releases',
  '/api/courses/${requestedCourseId}/assignments',
]) {
  assert.ok(contentSource.includes(endpoint), `FE-041 must call ${endpoint}`);
}

for (const blockType of ['hero', 'learning-task', 'rich-text', 'media', 'official-simulation', 'checkpoint', 'sources']) {
  assert.ok(contentSource.includes(`type: '${blockType}'`), `FE-041 must expose ${blockType}`);
}

assert.match(contentSource, /EXPECTED_ACTIVITY_COUNT = 127/);
assert.match(contentSource, /AstraLearningActivityCatalog/);
assert.match(contentSource, /course_draft_revision_conflict/);
assert.match(contentSource, /系统没有覆盖任何一方，也不会自动重试写入/);
assert.match(contentSource, /确认发布下一版/);
assert.match(contentSource, /不可变发布历史/);
assert.match(contentSource, /课程版本时光机/);
assert.match(contentSource, /VERSION TIME MACHINE/);
assert.match(contentSource, /这一版改变了什么/);
assert.match(contentSource, /compareReleaseUnits/);
assert.match(contentSource, /发布影响预演/);
assert.match(contentSource, /RELEASE IMPACT PREVIEW/);
assert.match(contentSource, /active_student_count/);
assert.match(contentSource, /当前草稿与已发布内容一致/);
assert.match(contentSource, /学生怎样算完成本单元/);
assert.match(contentSource, /完成一次实验操作/);
assert.match(contentSource, /答对指定检查点/);
assert.match(contentSource, /提交作业并完成批改/);
assert.match(contentSource, /releaseStatusLabel\(course\)/);
assert.match(contentSource, /function markDirty\(\)[\s\S]*data-course-content-action="save"[\s\S]*save\.disabled = Boolean\(safeSnapshot\(\)\.blocked \|\| session\.busy\)/);
assert.match(contentSource, /container\.innerHTML = contentMarkup\(context, courses\);[\s\S]*refreshIcons\(\);/);
assert.match(contentSource, /function refreshIcons\(\)[\s\S]*global\.lucide[\s\S]*createIcons\([\s\S]*root: session && session\.root \|\| global\.document/);
assert.match(contentSource, /检查点答案|正确答案/);
assert.doesNotMatch(contentSource, /contenteditable|draggable|<iframe/i);

assert.match(authoringSource, /COURSE_CONTENT_VERSION = '20260828v861PresentationCleanupP3'/);
assert.match(authoringSource, /import\(`\.\/teacher-course-content\.js\?v=\$\{COURSE_CONTENT_VERSION\}`\)/);
assert.match(authoringSource, /data-teacher-course-content/);
assert.match(authoringSource, /courseContentOwner\.destroy\(\)/);
assert.match(authoringStyles, /data-teacher-operation="course-authoring"[\s\S]*grid-column:\s*1\s*\/\s*-1/);
assert.match(teacherSource, /secondaryOpen:\s*\{\s*structure:\s*false,\s*assignments:\s*false\s*\}/);
assert.match(teacherSource, /addEventListener\('toggle'[\s\S]*teacherSecondary[\s\S]*detail\.open/);
assert.match(teacherSource, /data-teacher-secondary="structure"\$\{state\.secondaryOpen\.structure/);
assert.match(registrySource, /TEACHER_RESOURCE_VERSION = '20260828v861PresentationCleanupP3'/);

assert.match(styles, /\.teacher-course-content__editor/);
assert.match(styles, /\.teacher-course-content__history/);
assert.match(styles, /\.teacher-course-version-rail/);
assert.match(styles, /\.teacher-course-version-diff/);
assert.match(styles, /\.teacher-course-version-diff__changes/);
assert.match(styles, /\.teacher-course-release-impact/);
assert.match(styles, /\.teacher-course-release-impact__route/);
assert.match(styles, /\.teacher-course-content__completion/);
assert.match(styles, /min-height:\s*44px/);
assert.match(styles, /\.teacher-course-content__nested header button\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /prefers-reduced-motion/);

const context = {
  window: {},
  URL,
  console,
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(contentSource, context, { filename: 'pages/teacher/teacher-course-content.js' });
const contract = context.window.AstraTeacherCourseContent.contract;

assert.equal(contract.VERSION, '20260828v861PresentationCleanupP3');
assert.equal(contract.EXPECTED_ACTIVITY_COUNT, 127);
assert.deepEqual(Array.from(contract.BLOCK_TYPES, item => item.type), [
  'hero', 'learning-task', 'rich-text', 'media', 'official-simulation', 'checkpoint', 'sources',
]);

const unit = {
  id: 7,
  localKey: 'unit-7',
  activity_key: 'engineering.robot-arm-ik',
  title: '机械臂逆运动学',
  summary: '在课程中引用正式机械臂活动。',
  completion: { preset: 'experiment_operation' },
  blocks: [],
};
for (const type of Array.from(contract.BLOCK_TYPES, item => item.type)) {
  unit.blocks.push(contract.createBlock(type, unit, unit.blocks));
}
const media = unit.blocks.find(block => block.type === 'media');
media.assetKey = 'engineering.robot-arm.diagram-v1';
media.alt = '机械臂目标点、关节和末端位置关系图';
const sources = unit.blocks.find(block => block.type === 'sources');
sources.items[0] = {
  sourceId: 'robot-arm-source-1',
  label: '机器人学公开资料',
  url: 'https://example.com/robotics',
  usage: '概念复核',
};

const course = { id: 22, galaxy_key: 'englab', subject_key: 'physics' };
const catalog = officialKeys.map(activity_key => ({ activity_key }));
const valid = contract.validateEditorDraft({ revision: 3, units: [unit] }, course, catalog);
assert.equal(valid.valid, true, valid.errors.join('; '));

const payload = contract.buildDraftPayload({ revision: 3, units: [unit] }, course);
assert.equal(payload.expected_revision, 3);
assert.equal(payload.units[0].position, 1);
assert.equal(payload.units[0].content.blocks.length, 7);
assert.equal(payload.units[0].content.blocks[4].simulationKey, 'engineering.robot-arm-ik');
assert.equal(payload.units[0].content.courseUnit.completion.preset, 'experiment_operation');
assert.equal(Object.prototype.hasOwnProperty.call(payload.units[0], 'localKey'), false);
assert.equal(Object.prototype.hasOwnProperty.call(payload.units[0].content, 'script'), false);
assert.equal(contract.validateCompletionForPublish([unit], []).valid, true);

const releaseDiff = contract.compareReleaseUnits(
  [
    { activity_key: 'unit.keep', title: '保留单元', position: 1, content_schema_sha256: 'same' },
    { activity_key: 'unit.change', title: '调整后单元', position: 2, content_schema_sha256: 'new' },
    { activity_key: 'unit.add', title: '新增单元', position: 3, content_schema_sha256: 'add' },
  ],
  [
    { activity_key: 'unit.keep', title: '保留单元', position: 1, content_schema_sha256: 'same' },
    { activity_key: 'unit.change', title: '调整前单元', position: 2, content_schema_sha256: 'old' },
    { activity_key: 'unit.remove', title: '移除单元', position: 3, content_schema_sha256: 'remove' },
  ],
);
assert.equal(releaseDiff.added.length, 1);
assert.equal(releaseDiff.changed.length, 1);
assert.deepEqual(Array.from(releaseDiff.changed[0].fields), ['title', 'content']);
assert.equal(releaseDiff.removed.length, 1);
assert.equal(releaseDiff.unchanged.length, 1);

const semanticSame = contract.compareReleaseUnits(
  [{ activity_key: 'unit.semantic', title: '语义相同', position: 1, content: { version: 'draft-r9', status: 'draft', slug: 'courses/1/unit.semantic', courseUnit: { courseId: 'course-1' }, blocks: [{ type: 'hero', blockId: 'hero', title: '同一内容', eyebrow: '', badges: [] }] } }],
  [{ activity_key: 'unit.semantic', title: '语义相同', position: 1, content_schema_sha256: 'server-hash', content: { version: 'draft-r3', status: 'published', slug: 'demo/unit-semantic', courseUnit: { courseId: 'legacy-demo' }, blocks: [{ title: '同一内容', blockId: 'hero', type: 'hero' }] } }],
);
assert.equal(semanticSame.changed.length, 0, 'internal routing metadata, empty optional fields, and object key order must not create a false release impact');
assert.equal(semanticSame.unchanged.length, 1);

const completionOnly = contract.compareReleaseUnits(
  [{ activity_key: 'unit.rule', title: '完成规则示例', position: 1, content: { courseUnit: { completion: { preset: 'experiment_operation' } }, blocks: [] } }],
  [{ activity_key: 'unit.rule', title: '完成规则示例', position: 1, content: { courseUnit: { completion: { preset: 'checkpoint_passed', checkpointKey: 'check-1' } }, blocks: [] } }],
);
assert.equal(completionOnly.changed.length, 1);
assert.deepEqual(Array.from(completionOnly.changed[0].fields), ['completion']);
assert.match(contentSource, /data-tone="rule"><dt>完成规则/);
assert.match(contentSource, /完成方式调整为/);
assert.match(styles, /teacher-course-release-impact[^]*data-tone="rule"/);

const missingCompletion = JSON.parse(JSON.stringify(unit));
missingCompletion.completion = null;
assert.equal(contract.validateCompletionForPublish([missingCompletion], []).valid, false);

const checkpointCompletion = JSON.parse(JSON.stringify(unit));
checkpointCompletion.completion = {
  preset: 'checkpoint_passed',
  checkpointKey: checkpointCompletion.blocks.find(block => block.type === 'checkpoint').checkpointKey,
};
assert.equal(contract.validateCompletionForPublish([checkpointCompletion], []).valid, true);

const unsafe = JSON.parse(JSON.stringify(unit));
unsafe.blocks.find(block => block.type === 'rich-text').markdown = '<script>alert(1)</script>';
assert.equal(contract.validateEditorDraft({ revision: 3, units: [unsafe] }, course, catalog).valid, false);

const mismatched = JSON.parse(JSON.stringify(unit));
mismatched.blocks.find(block => block.type === 'official-simulation').simulationKey = 'physics.energy-conservation';
assert.equal(contract.validateEditorDraft({ revision: 3, units: [mismatched] }, course, catalog).valid, false);

const duplicate = JSON.parse(JSON.stringify(unit));
duplicate.id = 8;
duplicate.localKey = 'unit-8';
assert.equal(contract.validateEditorDraft({ revision: 3, units: [unit, duplicate] }, course, catalog).valid, false);

assert.equal(officialKeys.length, 127, 'backend official activity allowlist must contain 127 unique keys');
assert.equal(new Set(officialKeys).size, 127);
for (const key of ['physics.double-pendulum-chaos', 'chemistry.chromatography-separation', 'engineering.robot-arm-ik']) {
  assert.ok(officialKeys.includes(key), `${key} must be accepted by structured content`);
}

console.log('teacher-course-content-fe041-contract: ok');

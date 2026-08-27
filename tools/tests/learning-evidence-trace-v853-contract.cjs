const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const studentOwner = read('shared/js/student-learning-evidence.js');
const teacherOwner = read('shared/js/teacher-learning-evidence.js');
const studentStyles = read('shared/css/learning-evidence.css');
const teacherStyles = read('pages/teacher/teacher-curriculum.css');

assert.match(studentOwner, /学习证据链/);
assert.match(studentOwner, /操作如何变成学习结果/);
assert.match(studentOwner, /student-evidence-trace__route/);
assert.match(studentOwner, /AstraLearningActivityCatalog/);
assert.match(studentOwner, /catalog\.recoveryHref/);
assert.match(studentOwner, /不会把浏览页面本身当作完成/);
assert.match(studentStyles, /\.student-evidence-trace/);
assert.match(studentStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(studentStyles, /@media \(max-width: 680px\)/);

for (const stage of ['操作', '规则', '结果', '来源']) {
  assert.match(teacherOwner, new RegExp(`<small>${stage}</small>`));
}
assert.match(teacherOwner, /teacher-evidence-chain/);
assert.match(teacherOwner, /data-teacher-evidence-source/);
assert.match(teacherOwner, /已定位 \$\{activityKey\} 的完整证据链/);
assert.match(teacherStyles, /\.teacher-evidence-chain/);
assert.match(teacherStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(teacherStyles, /@media \(max-width: 760px\)/);

assert.doesNotMatch(studentOwner, /\/api\/learning-evidence/);
assert.doesNotMatch(teacherOwner, /\/api\/learning-evidence/);

console.log('learning-evidence-trace-v853-contract: student projection and teacher event chains are visible, traceable, responsive, and client-owned');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    loadContract,
    validateModelDocument,
    validateModelDocumentReference
} = require('../quality/check-new-experiment-model-document.cjs');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const readTemplate = (name) => fs.readFileSync(path.join(templateRoot, name), 'utf8');
const contract = loadContract();

assert.equal(contract.version, 'V8.2.4');
assert.equal(contract.scope, 'new-experiment-only');
assert.equal(contract.placement, 'documentation-only');
assert.equal(contract.production_registration, false);
assert.equal(contract.required_sections.length, 11);
assert.equal(contract.tables.length, 7);
assert.equal(contract.minimum_references, 2);
assert.deepEqual(contract.required_variable_roles, ['自变量', '因变量']);

const template = readTemplate('model-notes.md.tpl');
assert.match(template, /^<a id="model-__EXPERIMENT_ID__"><\/a>/);
assert.match(template, /^### __EXPERIMENT_TITLE__｜模型说明与验证记录$/m);
assert.match(template, /不复制到实验首屏/);
for (const section of contract.required_sections) {
    assert.match(template, new RegExp(`^#### ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
}
assert.doesNotMatch(template, /^#{1,6}\s+.*(?:学习目标|课程导语|课前任务|课后作业)/m);

const example = readTemplate('model-notes.example.md');
const identity = Object.freeze({
    anchor: 'model-model-document-probe',
    subject: 'physics',
    id: 'model-document-probe',
    title: '匀速运动校核样例'
});
const valid = validateModelDocument({ markdown: example, ...identity });
assert.equal(valid.ok, true, JSON.stringify(valid.errors, null, 2));
assert.deepEqual(valid.stats, {
    sections: 11,
    variableRows: 3,
    validationCases: 2,
    references: 2
});

const expectFailure = (markdown, code, overrides = {}) => {
    const result = validateModelDocument({ markdown, ...identity, ...overrides });
    assert.equal(result.ok, false, `fixture must fail with ${code}`);
    assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors, null, 2));
};

expectFailure(example.replace('<a id="model-model-document-probe"></a>', ''), 'anchor_missing');
expectFailure(example, 'anchor_identity_mismatch', { anchor: 'model-wrong-id' });
expectFailure(example.replace('匀速运动校核样例｜模型说明与验证记录', '错误标题｜模型说明与验证记录'), 'title_identity_mismatch');
expectFailure(example.replace('`physics.model-document-probe`', '`physics.other-id`'), 'experiment_identity_mismatch');
expectFailure(example.replace('**复核状态**：已复核', '**复核状态**：草稿'), 'review_status_unapproved');
expectFailure(example.replace('**复核人**：物理内容复核角色', '**复核人**：[待填写]'), 'unresolved_marker');
expectFailure(example.replace('| `v` | 自变量 |', '| `v` | 控制量 |'), 'variable_role_missing');
expectFailure(example.replace('| `x` | 因变量 | 质点相对原点的位置 | `m` |', '| `x` | 因变量 | 质点相对原点的位置 |  |'), 'si_unit_missing');
expectFailure(example.replace(/\$\$[\s\S]*?\$\$/, '核心关系已删除'), 'equation_missing');
expectFailure(example.replace(/^\| 已知限制 .*\r?\n/m, ''), 'table_required_row_missing');
expectFailure(example.replace(/^\| 边界值 .*\r?\n/m, ''), 'table_rows_insufficient');
expectFailure(example.replace('秒和米的 SI 表达依据 [R2]', '秒和米的 SI 表达依据第二条资料'), 'reference_unused');
expectFailure(
    example.replace(
        '- [R2] Bureau International des Poids et Mesures；The International System of Units (SI Brochure)；9th edition；BIPM；2019',
        '- [R2] BIPM；SI Brochure；9th edition；2019'
    ),
    'reference_fields_incomplete'
);
expectFailure(example.replace('- [x] 误差与已知限制已写明', '- [ ] 误差与已知限制已写明'), 'review_item_unchecked');
expectFailure(example.replace('#### 11. 发布前复核', '#### 学习目标\n\n不应出现。\n\n#### 11. 发布前复核'), 'course_section_forbidden');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ext05-model-'));
try {
    const documentDirectory = path.join(temporaryRoot, 'doc/01-子文档');
    const manifestDirectory = path.join(temporaryRoot, 'pages/physics/registration-probe');
    fs.mkdirSync(documentDirectory, { recursive: true });
    fs.mkdirSync(manifestDirectory, { recursive: true });
    const renderedDocument = example
        .replaceAll('model-model-document-probe', 'model-registration-probe')
        .replaceAll('physics.model-document-probe', 'physics.registration-probe')
        .replaceAll('匀速运动校核样例', '新增实验注册探针')
        .replaceAll('pages/physics/model-document-probe', 'pages/physics/registration-probe');
    const documentFile = path.join(documentDirectory, '15-学科实验与内容开发指南.md');
    fs.writeFileSync(documentFile, renderedDocument);
    const manifest = {
        subject: 'physics',
        id: 'registration-probe',
        title: '新增实验注册探针',
        model_document: 'doc/01-子文档/15-学科实验与内容开发指南.md#model-registration-probe'
    };
    const referenceResult = validateModelDocumentReference({ manifest, root: temporaryRoot });
    assert.equal(referenceResult.ok, true, JSON.stringify(referenceResult.errors, null, 2));
    assert.equal(referenceResult.reference.anchor, 'model-registration-probe');

    const missingResult = validateModelDocumentReference({
        manifest: { ...manifest, model_document: 'doc/missing.md#model-registration-probe' },
        root: temporaryRoot
    });
    assert.ok(missingResult.errors.some((error) => error.code === 'document_missing'));
    const outsideResult = validateModelDocumentReference({
        manifest: { ...manifest, model_document: '../outside.md#model-registration-probe' },
        root: temporaryRoot
    });
    assert.ok(outsideResult.errors.some((error) => error.code === 'reference_invalid'));

    const manifestFile = path.join(manifestDirectory, 'manifest.json');
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    const cli = spawnSync(
        process.execPath,
        [
            path.join(root, 'tools/quality/check-new-experiment-model-document.cjs'),
            '--root',
            temporaryRoot,
            '--manifest',
            manifestFile
        ],
        { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /physics\.registration-probe PASS; 11 sections, 2 validation cases, 2 references/);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const productionFiles = [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'index.html'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(productionFiles, /model-document-probe/);

console.log('new-experiment-model-document-contract: EXT-05 scientific boundary and evidence PASS');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileExpression, evaluateExpression } from '../src/domain/template-expression.ts';
import { previewTemplate } from '../src/domain/template-preview.ts';
import { createResourceDemo } from '../src/services/resource-demo.ts';
import { loadTemplateSeeds, loadLearningSpaces } from '../scripts/learning-spaces.mjs';
import { loadCatalog } from '../scripts/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'backend/tests/template-expression-cases.json'), 'utf8'));
const templates = loadTemplateSeeds(root);

test('函数表达式与后端使用同一组语义、定义域和拒绝样例', () => {
  for (const entry of cases.valid) {
    const tree = compileExpression(entry.formula, new Set(Object.keys(entry.variables)));
    const value = evaluateExpression(tree, entry.variables);
    if (entry.expected === null) assert.equal(value, null, entry.formula);
    else assert.ok(Math.abs(value - entry.expected) < 1e-12, entry.formula);
  }
  for (const formula of cases.invalid) assert.throws(() => compileExpression(formula, new Set(['x'])), undefined, formula);
});

test('模板保留完整数据，拒绝未知字段、布尔数值和越界配置', () => {
  const graph = templates.find((item) => item.renderer === 'function-graph-v1');
  const version = { id: 128, renderer: graph.renderer, definition: graph.definition };
  const config = structuredClone(graph.definition.configuration);
  const preview = previewTemplate(version, config);
  assert.deepEqual(preview.view.points[0], { x: -5, y: 25 });
  assert.deepEqual(preview.view.points[60], { x: 0, y: 0 });
  for (const changed of [{ script: 'alert(1)' }, { x_min: true }, { samples: 10000 }, { formula: 'x.__proto__' }, { x_min: 10, x_max: -10 }])
    assert.throws(() => previewTemplate(version, { ...config, ...changed }));
  const chart = templates.find((item) => item.renderer === 'data-chart-v1');
  const chartVersion = { id: 129, renderer: chart.renderer, definition: chart.definition };
  assert.deepEqual(previewTemplate(chartVersion, chart.definition.configuration).view, { minimum: 0, maximum: 5 });
  assert.throws(() => previewTemplate(chartVersion, { ...chart.definition.configuration, series: [{ name: '错误维度', values: [1] }] }));
});

test('演示模板预览不会修改系统原件，安装操作保留角色边界', async () => {
  let role = 'student';
  const gateway = createResourceDemo(() => role, loadCatalog(root), templates);
  const page = await gateway.list('', 'template');
  assert.equal(page.total, 2);
  const graph = page.items.find((item) => item.renderer === 'function-graph-v1');
  const changed = structuredClone(graph.definition.configuration);
  changed.formula = 'x+1';
  assert.equal((await gateway.preview(graph.id, changed)).view.points[60].y, 1);
  assert.deepEqual(await gateway.version(graph.id), graph);
  await assert.rejects(() => gateway.install(), (error) => error.status === 403);
  role = 'admin';
  assert.equal((await gateway.install()).catalogue_size, 129);
});

test('第四个独立前端使用注册清单接入，路径逃逸与身份冲突被拒绝', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-resource-registry-'));
  try {
    for (const relative of ['shared/js/config.js', 'shared/js/experiment-registry.js', 'shared/js/learning-activity-catalog.js', 'codevis/shared/js/course-manifest.js', 'pages/frontier/frontier-manifest.js', 'backend/app/catalogue/learning-spaces.v1.json']) {
      const destination = path.join(temp, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, relative), destination);
    }
    const manifestFile = path.join(temp, 'backend/app/catalogue/learning-spaces.v1.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.spaces.push({ key: 'archives', view: 'space:archives', title: '档案测试空间', entry: 'labs/spaces/archives/index.html', kind: 'bundle', accent: '#c8b899' });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const bundle = path.join(temp, 'extensions/archives/public');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'index.html'), '<h1>Example bundle</h1>');
    const catalogue = { schema_version: 'astra-activities-v1', activities: [{ key: 'archives.evidence', title: '比较材料', subject: 'history', entry: 'index.html#evidence' }] };
    const file = path.join(bundle, 'astra-activities.json');
    fs.writeFileSync(file, JSON.stringify(catalogue));
    assert.equal(loadLearningSpaces(temp).spaces.length, 4);
    const list = loadCatalog(temp);
    assert.equal(list.length, 128);
    assert.equal(list.at(-1).href, 'labs/spaces/archives/index.html#evidence');
    catalogue.activities[0].entry = '%2e%2e/secret.html';
    fs.writeFileSync(file, JSON.stringify(catalogue));
    assert.throws(() => loadCatalog(temp), /inside their own bundle/);
    catalogue.activities[0].entry = 'index.html';
    catalogue.activities[0].key = 'physics.mechanics';
    fs.writeFileSync(file, JSON.stringify(catalogue));
    assert.throws(() => loadCatalog(temp), /collide/);
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

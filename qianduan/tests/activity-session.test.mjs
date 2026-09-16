import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivitySession } from '../src/domain/activity-session.ts';
import { createSchoolDemo } from '../src/services/school-demo.ts';
import { createResourceDemo } from '../src/services/resource-demo.ts';
import { createStudyDemo } from '../src/services/study-demo.ts';
import { loadCatalog } from '../scripts/catalog.mjs';
import { loadTemplateSeeds } from '../scripts/learning-spaces.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const config = () => ({ context_key: 'context-original', scope: { class_id: 3, course_id: 7, course_unit_id: 21, activity_key: 'unit.experiment' }, subject_identity: { kind: 'learner', id: '5' }, manifest_version: 'astra-context-activity-v1', content_version: 'original-content', event_schema_version: 1, rule_version: 4, generation: 'context-original', state_schema_version: 'astra-observation-state-v1', blocks: [{ block_id: 'graph', resource_version_id: 130, adapter: 'function-parameters-v1', entry: null, controls: [{ key: 'a', label: '系数', minimum: -3, maximum: 3, step: .1, value: 1 }] }] });
const observe = (value) => ({ block_id: 'graph', parameter: 'a', value });
const receipt = (body, extra = 0) => ({ status: 'confirmed', client_event_id: body.command.client_event_id, event_type: body.command.event_type, run_id: body.command.run.run_id, group_id: body.command.run.group_id, learner_sequence: body.command.run.sequence, server_sequence: body.command.run.sequence, server_last_sequence: body.command.run.sequence + extra, server_event_id: 'server-fact-1' });

test('网络丢失回执后保留同一参数、事件号和学习序号，派生事实不占学习者序号', async () => {
  const calls = [], states = [], saved = new Map(); let completed = 0;
  const api = { activityConfig: async () => config(), activityEvent: async (key, body) => {
    calls.push({ key, body: structuredClone(body) });
    const old = saved.get(body.command.client_event_id);
    if (old) { assert.deepEqual(body, old.body); return { ...old.receipt, status: 'reconciled' }; }
    const result = receipt(body, body.command.run.sequence === 2 ? 1 : 0);
    saved.set(body.command.client_event_id, { body: structuredClone(body), receipt: result });
    if (body.command.run.sequence === 2) throw new Error('回执连接中断');
    return result;
  } };
  const session = new ActivitySession(api, 'context-original', (state) => states.push(state), async () => { completed++; });
  await session.initialize();
  await session.observe(observe(2));
  assert.equal(session.hasPending(), true);
  assert.equal(states.at(-1).status, 'error');
  await assert.rejects(session.observe(observe(3)), /先确认或重试/);
  await session.retry();
  await session.observe(observe(1.5));
  assert.deepEqual(calls.map((call) => call.body.command.run.sequence), [1, 2, 2, 3]);
  assert.deepEqual(calls[1], calls[2]);
  assert.ok(calls.every((call) => call.key === 'context-original' && call.body.command.versions.content_version === 'original-content'));
  assert.equal(completed, 1);
  assert.equal(session.hasPending(), false);
});

test('连续参数变化依次保存，离页后不启动排队写入或更新已销毁的画面', async () => {
  const calls = [], states = []; let release;
  const session = new ActivitySession({ activityConfig: async () => config(), activityEvent: async (_, body) => {
    calls.push(structuredClone(body));
    if (body.command.run.sequence === 2) await new Promise((resolve) => { release = resolve; });
    return receipt(body);
  } }, 'context-original', (state) => states.push(state), async () => {});
  await session.initialize();
  const sending = session.observe(observe(2));
  await Promise.resolve();
  await session.observe(observe(2.5));
  assert.equal(calls.length, 2);
  assert.equal(session.hasPending(), true);
  session.destroy();
  const stateCount = states.length;
  release(); await sending;
  assert.equal(calls.length, 2);
  assert.equal(states.length, stateCount);
});

test('静态演示使用同一资源版本和完成状态源，参数观察实际进入学习历史', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let role = 'teacher';
  const activities = loadCatalog(root), school = createSchoolDemo(() => role, activities);
  const resources = createResourceDemo(() => role, activities, loadTemplateSeeds(root));
  const study = createStudyDemo(() => role, school.teaching, school, resources);
  const graph = (await resources.list('englab', 'template')).items.find((item) => item.resource_key === 'template.function-graph');
  assert.equal(graph.version_number, 2);
  const draft = await school.draft(1);
  draft.units[0].content.blocks.push({ blockId: 'record-graph', type: 'resource', title: graph.title, resourceVersionId: graph.id, configuration: graph.definition.configuration, instructions: '比较参数变化' });
  draft.units[0].content.courseUnit.completion = { preset: 'experiment_operation' };
  const saved = await school.saveDraft(1, draft);
  const release = (await school.publish(1, saved.revision, '操作记录示例')).release;
  role = 'student';
  const context = await study.start({ client_request_id: crypto.randomUUID(), mode: 'formal', course_id: 1, course_unit_id: draft.units[0].id, expected_release_id: release.id });
  const session = new ActivitySession(study, context.context_key, () => {}, async () => {});
  await session.initialize();
  assert.equal((await study.history(1)).current_completed_units.length, 0);
  await session.observe({ block_id: 'record-graph', parameter: 'a', value: 1.5 });
  const history = await study.history(1);
  assert.deepEqual(history.current_completed_units, [draft.units[0].id]);
  assert.equal(history.items.find((row) => row.current_credit).response.value, 1.5);
  assert.equal((await school.workbench()).courses.items.find((row) => row.course_id === 1).completed_unit_count, 1);
  session.destroy();
});

test('原力学实验的可记录参数、默认模型和原生滑杆步长保持一致', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const runtime = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/physics/physics.js'), 'utf8'), runtime);
  const model = runtime.window.PhysicsSim;
  const defaults = { gravity: model.gravity, restitution: model.restitution * 100, friction: model.friction * 100, radius: model.ballRadius };
  const latest = loadTemplateSeeds(root).filter((item) => item.key === 'physics.mechanics').sort((a, b) => b.version_number - a.version_number)[0];
  for (const control of latest.capabilities.controls) {
    const tag = html.match(new RegExp(`<input\\b[^>]*id="${control.selector.slice(1)}"[^>]*>`))?.[0];
    assert.ok(tag, control.key);
    const attributes = Object.fromEntries([...tag.matchAll(/([a-z]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    const value = Number(attributes.value), minimum = Number(attributes.min), step = Number(attributes.step);
    assert.equal(value, defaults[control.key]);
    assert.equal(value, control.value);
    assert.equal(step, control.step);
    assert.ok(Number.isInteger((value - minimum) / step), `${control.key} 的浏览器默认值会因步长被自动改写`);
  }
});

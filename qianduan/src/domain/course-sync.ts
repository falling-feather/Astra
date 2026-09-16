import contract from '../../../backend/app/catalogue/course-sync-fields.v1.json' with { type: 'json' };
import type { CourseSnapshotRead, SnapshotUnitRead, SyncChangeRead, CourseImpactRead } from '../portal/workflow-types';

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
export async function snapshotHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((value) => value.toString(16).padStart(2, '0')).join('');
}
const same = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);
const blocks = (unit?: SnapshotUnitRead) => new Map((unit?.content?.blocks || []).map((block) => [unit!.block_origins[block.blockId], block]));
const values = (block: object, fields: string[]) => Object.fromEntries(Object.entries(block).filter(([key]) => fields.includes(key)));

/** Explicitly simulated by Pages; shares the allowed-field contract with Python. */
export async function compareSync(before: CourseSnapshotRead, after: CourseSnapshotRead, target: CourseSnapshotRead, targetId: number): Promise<SyncChangeRead[]> {
  const oldUnits = new Map(before.units.map((unit) => [unit.origin_key, unit]));
  const targetUnits = new Map(target.units.map((unit) => [unit.origin_key, unit]));
  const changes: SyncChangeRead[] = [];
  for (const unit of after.units) {
    const old = oldUnits.get(unit.origin_key), destination = targetUnits.get(unit.origin_key);
    if (!old) { changes.push({ key: `${targetId}:${unit.origin_key}:new`, status: 'skipped', unit_title: unit.title, reason: '新增章节不自动同步' }); continue; }
    const oldBlocks = blocks(old), targetBlocks = blocks(destination);
    for (const [origin, next] of blocks(unit)) {
      const previous = oldBlocks.get(origin), current = targetBlocks.get(origin);
      if (!previous || previous.type !== next.type) { changes.push({ key: `${targetId}:${origin}:structure`, status: 'skipped', unit_title: unit.title, reason: '新增或替换类型的内容不自动插入' }); continue; }
      for (const fields of contract.groups[next.type]) {
        const from = values(previous, fields), to = values(next, fields);
        if (same(from, to)) continue;
        const item: SyncChangeRead = { key: await snapshotHash({ course: targetId, origin, fields }), status: 'skipped', unit_title: unit.title, block_origin: origin, fields, before: from, after: to };
        if (!current || current.type !== next.type) item.reason = '无对应内容，跳过';
        else Object.assign(item, { unit_id: destination!.id, block_id: current.blockId, current: values(current, fields), status: same(values(current, fields), to) ? 'unchanged' : same(values(current, fields), from) ? 'ready' : 'conflict' });
        changes.push(item);
      }
    }
  }
  return changes;
}

export function applySync(snapshot: CourseSnapshotRead, changes: SyncChangeRead[], choices: Record<string, 'keep' | 'replace'>): { snapshot: CourseSnapshotRead; applied: string[] } {
  const next = structuredClone(snapshot), applied: string[] = [];
  for (const change of changes) {
    if (change.status !== 'ready' && !(change.status === 'conflict' && choices[change.key] === 'replace')) continue;
    const unit = next.units.find((unit) => unit.id === change.unit_id)!;
    const block = unit.content!.blocks.find((block) => block.blockId === change.block_id)!;
    const oldPrimary = block.type === 'resource' ? block.resourceVersionId : null;
    Object.assign(block, structuredClone(change.after));
    for (const field of change.fields || []) if (!(field in (change.after || {}))) Reflect.deleteProperty(block, field);
    if (block.type === 'resource' && unit.resource_version_id === oldPrimary) unit.resource_version_id = block.resourceVersionId;
    applied.push(change.key);
  }
  return { snapshot: next, applied };
}

export function reviewImpact(snapshot: CourseSnapshotRead, baseline: CourseSnapshotRead): CourseImpactRead {
  const old = new Map(baseline.units.map((unit) => [unit.origin_key, unit]));
  const learning = (unit: SnapshotUnitRead) => ({ completion: unit.content?.courseUnit?.completion, blocks: unit.content?.blocks.filter((block) => ['checkpoint', 'resource', 'official-simulation'].includes(block.type)).map(({ blockId: _id, title: _title, ...content }) => content) });
  return {
    settings: Object.entries(snapshot.settings).filter(([key, value]) => !same(value, baseline.settings[key])).map(([field, after]) => ({ field, before_recorded: field in baseline.settings, before: baseline.settings[field] ?? null, after })),
    units: snapshot.units.map((unit) => {
      const previous = old.get(unit.origin_key), meaningful = Boolean(previous && !same(learning(unit), learning(previous)));
      const changed = !previous || !same({ ...unit, content: { ...unit.content, version: '', status: '' } }, { ...previous, content: { ...previous.content, version: '', status: '' } });
      return { unit_id: unit.id, origin_key: unit.origin_key, title: unit.title, change: !previous ? 'added' : changed ? 'modified' : 'unchanged', learning_changed: meaningful, decision_required: meaningful, default_policy: !previous ? 'redo' : meaningful ? null : 'keep' };
    }),
    removed_units: baseline.units.filter((unit) => !snapshot.units.some((item) => item.origin_key === unit.origin_key)).map((unit) => ({ unit_id: unit.id, title: unit.title })),
  };
}

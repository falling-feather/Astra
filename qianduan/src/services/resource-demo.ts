import type { Activity, Role } from '../portal/contracts';
import type { ResourceGateway, ResourceVersionRead, TemplateSeed } from '../portal/resource-types';
import { previewTemplate } from '../domain/template-preview.ts';
import { ApiError } from './http-client.ts';

export function createResourceDemo(role: () => Role, activities: Activity[], templates: TemplateSeed[]): ResourceGateway {
  const resources: ResourceVersionRead[] = activities.map((item, index) => ({
    id: index + 1, resource_key: item.key, space_key: item.galaxy, subject_key: item.subject, kind: 'activity',
    version_number: 1, title: item.title, renderer: 'legacy', definition: { entry: item.href, configuration: {} },
    capabilities: { operation_recording: false, completion_modes: ['checkpoint_passed', 'assignment_reviewed'] },
    provenance: { kind: 'static-demonstration' }, content_sha256: 'demo',
  }));
  resources.push(...templates.map((item, index): ResourceVersionRead => ({
    id: activities.length + index + 1, resource_key: item.key, space_key: item.space, subject_key: item.subject,
    kind: 'template', version_number: 1, title: item.title, renderer: item.renderer,
    definition: structuredClone(item.definition), capabilities: structuredClone(item.capabilities),
    provenance: { ...item.provenance, mode: 'static-demonstration' }, content_sha256: 'demo',
  })));
  const version = async (id: number) => {
    const item = resources.find((resource) => resource.id === id);
    if (!item) throw new ApiError('资源不存在。', 404);
    return structuredClone(item);
  };
  return {
    async list(space, kind, offset = 0) {
      const list = resources.filter((item) => (!space || item.space_key === space) && (!kind || item.kind === kind)).sort((a, b) => b.kind.localeCompare(a.kind) || a.resource_key.localeCompare(b.resource_key));
      return { items: structuredClone(list.slice(offset, offset + 24)), total: list.length, limit: 24, offset, next_offset: offset + 24 < list.length ? offset + 24 : null };
    },
    version,
    async preview(id, config) { return previewTemplate(await version(id), config); },
    async install() {
      if (role() !== 'admin') throw new ApiError('只有管理员可以载入系统资源。', 403);
      return { installed_versions: 0, catalogue_size: resources.length };
    },
  };
}

import type { ResourceGateway } from '../portal/resource-types';
import { HttpClient } from './http-client';

export function createResourceApi(client: HttpClient): ResourceGateway {
  return {
    list: (space, kind, offset = 0) => {
      const query = new URLSearchParams({ limit: '24', offset: String(offset) });
      if (space) query.set('space', space);
      if (kind) query.set('kind', kind);
      return client.request(`/v2/resources?${query}`);
    },
    version: (id) => client.request(`/v2/resources/versions/${id}`),
    preview: (id, configuration) => client.request(`/v2/resources/versions/${id}/preview`, 'POST', { configuration }),
    install: () => client.request('/v2/resources/install-system', 'POST'),
  };
}

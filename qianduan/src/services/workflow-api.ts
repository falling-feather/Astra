import type { WorkflowGateway } from '../portal/workflow-types';
import { HttpClient } from './http-client';

export function createWorkflowApi(client: HttpClient): WorkflowGateway {
  const get = <T>(path: string) => client.request<T>(`/v2${path}`);
  const post = <T>(path: string, body: unknown) => client.request<T>(`/v2${path}`, 'POST', body);
  return {
    courses: () => get('/courses'),
    course: (id) => get(`/courses/${id}`),
    create: (body) => post('/courses', body),
    draft: (id) => get(`/courses/${id}/draft`),
    save: (id, body) => client.request(`/v2/courses/${id}/draft`, 'PUT', body),
    fork: (id, body) => post(`/courses/${id}/forks`, body),
    revisions: (id, offset = 0) => get(`/courses/${id}/revisions?offset=${offset}&limit=50`),
    preview: (id, body) => post(`/courses/${id}/submission-preview`, body),
    submit: (id, body) => post(`/courses/${id}/submissions`, body),
    candidates: (filters = {}) => {
      const query = new URLSearchParams({ limit: '25' });
      Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
      return get(`/candidates?${query}`);
    },
    candidate: (id) => get(`/candidates/${id}`),
    review: (body) => post('/candidate-reviews', body),
    withdraw: (id, body) => post(`/candidates/${id}/withdraw`, body),
    publish: (body) => post('/publications', body),
    restore: (id, body) => post(`/courses/${id}/restore-draft`, body),
    receipt: (key) => get(`/operations/${encodeURIComponent(key)}`),
    media: (id, offset = 0) => get(`/courses/${id}/media?offset=${offset}&limit=25`),
    upload: (id, file, key) => post(`/courses/${id}/media?${new URLSearchParams({ filename: file.name, client_request_id: key })}`, file),
    mediaUrl: (courseId, key, releaseId, unitId) => {
      const query = new URLSearchParams();
      if (releaseId !== undefined) query.set('release_id', String(releaseId));
      if (unitId !== undefined) query.set('unit_id', String(unitId));
      return `${client.base}/v2/courses/${courseId}/media/${encodeURIComponent(key)}/content?${query}`;
    },
  };
}

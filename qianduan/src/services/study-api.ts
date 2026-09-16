import type { StudyGateway } from '../portal/study-types';
import { HttpClient } from './http-client';

export function createStudyApi(client: HttpClient): StudyGateway {
  const get = <T>(path: string) => client.request<T>(`/v2${path}`);
  const post = <T>(path: string, body: unknown) => client.request<T>(`/v2${path}`, 'POST', body);
  return {
    start: (body) => post('/learning-contexts', body),
    context: (key) => get(`/learning-contexts/${encodeURIComponent(key)}`),
    checkpoint: (key, checkpoint, body) =>
      post(
        `/learning-contexts/${encodeURIComponent(key)}/checkpoints/${encodeURIComponent(checkpoint)}`,
        body,
      ),
    history: (course, offset = 0, student) =>
      get(
        `/courses/${course}/learning-results?offset=${offset}&limit=25${student ? `&student_id=${student}` : ''}`,
      ),
    contexts: (course) => get(`/courses/${course}/learning-contexts`),
    openAssignment: (id, body) => post(`/assignments/${id}/open`, body),
    submit: (id, body) => post(`/assignments/${id}/attempts`, body),
    grade: (id, body) => post(`/assignment-attempts/${id}/grades`, body),
    submissionHistory: (id, offset = 0) => get(`/submissions/${id}/history?offset=${offset}&limit=20`),
  };
}

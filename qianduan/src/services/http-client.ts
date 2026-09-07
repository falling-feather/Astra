export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  constructor(message: string, status = 0, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

const messages: Record<number, string> = {
  401: '登录已失效，请重新登录。',
  403: '当前账号没有执行此操作的权限。',
  404: '没有找到该资源，可能已被移除。',
  409: '记录已发生变化，请刷新核对后再操作。',
  422: '填写内容不符合要求，请检查必填项与格式。',
  429: '操作过于频繁，请稍后重试。',
  500: '服务暂时无法完成请求，请稍后重试。',
};
const domainMessages: Record<string, string> = {
  course_unit_identity_immutable: '已保存的实验引用保持不变；如需更换，请新增单元。',
  course_not_approved: '请先提交课程资料并通过学校审核，再保存课程内容。',
  course_completion_missing: '请为每个学习单元选择完成条件后再发布。',
  course_completion_assignment_invalid: '用于认定完成的作业已不可用，请重新选择本单元的有效作业。',
  course_draft_revision_conflict: '另一位教师已修改草稿，你的输入仍保留，请先核对新版本。',
  checkpoint_attempt_limit_reached: '该检查点的尝试次数已用完，请联系教师。',
};

/** Browser transport: HttpOnly cookie only, no bearer persistence and no implicit demo fallback. */
export class HttpClient {
  readonly base: string;
  constructor(base = '/api') {
    this.base = base.replace(/\/$/, '');
  }
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.base}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 204) return undefined as T;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError('服务返回了无法识别的内容，请检查后端地址。', response.status);
      }
      if (!response.ok) {
        const detail =
          typeof payload === 'object' && payload !== null && 'detail' in payload
            ? (payload as { detail: unknown }).detail
            : null;
        const code = detail && typeof detail === 'object' && 'code' in detail ? String(detail.code) : '';
        const message =
          domainMessages[code] ||
          (typeof detail === 'string' && /[\u4e00-\u9fff]/.test(detail)
            ? detail
            : messages[response.status] || `请求未完成（${response.status}）。`);
        throw new ApiError(message, response.status, response.headers.get('X-Request-ID'));
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new DOMException('页面已离开', 'AbortError');
      throw new ApiError(
        method === 'GET'
          ? '无法连接后端服务，请检查本机服务是否启动。'
          : '连接中断，操作可能已生效，请刷新核对后再操作。',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

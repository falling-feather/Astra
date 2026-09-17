import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSearch,
  FileText,
  LoaderCircle,
  RotateCcw,
  Search,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useExperienceGateway } from "../gateway";
import type { CourseReleaseSummary } from "../models";
import {
  bytesToBase64,
  type ContentCaseDossier,
  type ContentCitation,
  type ContentLibraryGateway,
  type ContentMaterialResult,
  type ContentProcessingJob,
  type ContentSearchResult,
  type ContentSourceDocument,
  type ContentSourceRevision,
  type ProfessionalTaskPackage,
} from "../content-library-gateway";

type LibraryMode = "staff" | "student";

interface ContentLibraryPageProps {
  gateway: ContentLibraryGateway;
  mode: LibraryMode;
}

interface CourseOptionsProps {
  courses: readonly CourseReleaseSummary[];
  selectedCourseId: string;
  onChange(courseId: string): void;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString("zh-CN");
}

function statusLabel(status: ContentProcessingJob["status"]): string {
  switch (status) {
    case "queued": return "排队中";
    case "running": return "处理中";
    case "succeeded": return "已完成";
    case "failed": return "处理失败";
    case "cancelled": return "已取消";
  }
}

function locatorLabel(locator: Record<string, unknown>): string {
  const page = typeof locator.page === "number" ? `第 ${locator.page} 页` : null;
  const startPage = typeof locator.startPage === "number" ? `第 ${locator.startPage} 页起` : null;
  const time = typeof locator.startMs === "number" ? `${Math.round(locator.startMs / 1000)} 秒起` : null;
  const label = typeof locator.label === "string" ? locator.label : null;
  return [page ?? startPage, time, label].filter(Boolean).join(" · ") || "原文定位待补充";
}

function coursePicker({ courses, selectedCourseId, onChange }: CourseOptionsProps) {
  return (
    <label className="v2-content-course-picker">
      <span>当前课程</span>
      <select
        aria-label="选择教学资料课程"
        value={selectedCourseId}
        onChange={(event) => onChange(event.target.value)}
        disabled={courses.length === 0}
      >
        {courses.length === 0 ? <option value="">暂无可用课程</option> : null}
        {courses.map((course) => (
          <option value={course.courseId} key={course.courseId}>
            {course.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchResultList({ result }: { result: ContentSearchResult | null }) {
  if (!result) return null;
  return (
    <section className="v2-content-panel" aria-labelledby="content-search-result-title">
      <header className="v2-content-panel-heading">
        <div>
          <h2 id="content-search-result-title">授权检索结果</h2>
          <p>仅显示当前课程、当前身份可用的教学片段；无结果时保留缺口。</p>
        </div>
        <span>{result.citations.length} 条引用</span>
      </header>
      {result.citations.length === 0 ? (
        <div className="v2-content-empty"><FileSearch /><p>没有命中已授权片段。</p></div>
      ) : (
        <div className="v2-content-citation-list">
          {result.citations.map((citation) => <CitationCard citation={citation} key={citation.citationId} />)}
        </div>
      )}
      {result.gaps.length > 0 ? (
        <div className="v2-content-gap"><AlertTriangle /><div><strong>仍需补证</strong>{result.gaps.map((gap) => <p key={gap}>{gap}</p>)}</div></div>
      ) : null}
      {result.conflicts.length > 0 ? (
        <div className="v2-content-gap"><AlertTriangle /><div><strong>存在来源冲突</strong><p>请回到来源矩阵保留支持与反证，不自动选择更吸睛的数字。</p></div></div>
      ) : null}
    </section>
  );
}

function CitationCard({ citation }: { citation: ContentCitation }) {
  return (
    <article className="v2-content-citation">
      <header>
        <div>
          <strong>{citation.canonicalUrl ? <a href={citation.canonicalUrl} target="_blank" rel="noreferrer">{citation.title}</a> : citation.title}</strong>
          <span>{citation.publisher ?? "未登记发布机构"} · {locatorLabel(citation.locator)}</span>
        </div>
        <small>检索匹配</small>
      </header>
      <p>{citation.text}</p>
      <footer>{citation.sourceByteHash ? "原件解析片段" : "教学改写 · 原件未入库"} · {citation.reviewStatus === "pending_expert_review" ? "待专家复核" : citation.reviewStatus === "verified" ? "来源已校验" : "教学来源"}</footer>
      <details><summary>来源核对信息</summary><p>版本：{citation.sourceVersion}</p><p>原件指纹：{citation.sourceByteHash ?? "原件未入库"}</p></details>
    </article>
  );
}

function StaffSourceList({
  sources,
  jobs,
  onPreview,
}: {
  sources: readonly ContentSourceDocument[];
  jobs: readonly ContentProcessingJob[];
  onPreview(revisionId: string): void;
}) {
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.sourceId, source])), [sources]);
  return (
    <section className="v2-content-panel" aria-labelledby="content-material-status-title">
      <header className="v2-content-panel-heading">
        <div>
          <h2 id="content-material-status-title">原件、解析与索引状态</h2>
          <p>当前课程来源与全库最近处理任务；原件、派生版本和处理记录均可追溯。</p>
        </div>
        <span>{sources.length} 个来源 · {jobs.length} 个处理任务</span>
      </header>
      {sources.length === 0 && jobs.length === 0 ? (
        <div className="v2-content-empty"><Database /><p>当前课程还没有登记教学资料。</p></div>
      ) : (
        <div className="v2-content-source-list">
          {sources.map((source) => (
            <article key={source.sourceId}>
              <div className="v2-content-source-icon"><FileText /></div>
              <div>
                <strong>{source.title}</strong>
                <span>{source.kind} · {source.publisher ?? "未登记发布机构"}</span>
                <small>更新于 {formatDate(source.updatedAt)}</small>
              </div>
              <span className="v2-content-status-chip">已登记</span>
            </article>
          ))}
          {jobs.map((job) => {
            const source = job.sourceId ? sourceById.get(job.sourceId) : undefined;
            return (
              <article key={job.jobId} className={job.status === "failed" ? "failed" : undefined}>
                <div className="v2-content-source-icon"><Database /></div>
                <div>
                  <strong>{source?.title ?? job.sourceFileName ?? "来源信息待补全的处理任务"}</strong>
                  <span>{job.kind} · 尝试 {job.attemptCount} 次 · {statusLabel(job.status)}</span>
                  <small>{job.errorCode ? `失败码：${job.errorCode}` : `更新于 ${formatDate(job.updatedAt)}`}</small>
                </div>
                <div className="v2-content-source-actions">
                  <span className="v2-content-status-chip">{statusLabel(job.status)}</span>
                  {job.parsedRevisionId ? <button type="button" onClick={() => onPreview(job.parsedRevisionId!)}>预览片段</button> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RevisionPreview({
  revision,
  onClose,
}: {
  revision: ContentSourceRevision | null;
  onClose(): void;
}) {
  if (!revision) return null;
  return (
    <section className="v2-content-panel" aria-labelledby="content-revision-title">
      <header className="v2-content-panel-heading">
        <div>
          <h2 id="content-revision-title">来源与片段预览</h2>
          <p>{revision.mimeType} · {formatBytes(revision.byteSize)} · {revision.fragmentCount} 个片段</p>
        </div>
        <button type="button" className="v2-content-icon-button" aria-label="关闭片段预览" onClick={onClose}><XCircle /></button>
      </header>
      <div className="v2-content-revision-meta">
        <span>版本：{revision.sourceVersion}</span>
        <span>状态：{revision.status}</span>
        <span>访问于：{formatDate(revision.accessedAt)}</span>
      </div>
      {revision.fragments.length === 0 ? <div className="v2-content-empty"><FileSearch /><p>该版本暂无可预览片段。</p></div> : (
        <ol className="v2-content-fragment-list">
          {revision.fragments.slice(0, 24).map((fragment) => (
            <li key={fragment.fragmentId}>
              <span>{fragment.ordinal + 1}</span>
              <div><p>{fragment.text}</p><small>{locatorLabel(fragment.locator)}</small></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CaseDossierPanel({
  dossier,
  loading,
  error,
  mode,
}: {
  dossier: ContentCaseDossier | null;
  loading: boolean;
  error: string | null;
  mode: LibraryMode;
}) {
  return (
    <section className="v2-content-panel v2-content-case-panel" aria-labelledby="content-case-title">
      <header className="v2-content-panel-heading">
        <div><h2 id="content-case-title">案例资料包</h2><p>只读展示学生可检查的教学仿真材料、来源定位和合法替代路线。</p></div>
        {dossier ? <span>{dossier.reviewStatus === "pending_expert_review" ? "待专业复核" : dossier.reviewStatus}</span> : null}
      </header>
      {loading ? <div className="v2-content-inline-loading"><LoaderCircle className="spin" />正在读取案例资料</div> : null}
      {error ? <div className="v2-inline-notice" role="status">案例资料暂不可用：{error}；不影响上传和授权检索。</div> : null}
      {!loading && !error && !dossier ? <div className="v2-content-empty"><FileSearch /><p>当前课程暂无可用案例资料包。</p></div> : null}
      {dossier ? (
        <>
          <div className="v2-content-boundary"><strong>教学边界</strong><span>{dossier.dossier.caseBoundary}</span></div>
          <div className="v2-content-case-materials">
            {dossier.dossier.studentMaterials.map((material) => (
              <article key={material.materialId}>
                <header><strong>{material.title}</strong></header>
                <p>{material.publicDescription}</p>
                {material.document?<details className="case-document"><summary>阅读全文 · 教学仿真原件</summary><pre>{material.document.body}</pre><button type="button" onClick={()=>{const url=URL.createObjectURL(new Blob([material.document!.body],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=material.title+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下载文本</button></details>:null}
                <small>{material.simulationBoundary}</small>
                <ul>
                  {material.inspectableFields.map((field) => <li key={field}>{field}</li>)}
                </ul>
                <div className="v2-content-source-refs">
                  {material.sourceRefs.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.locator}`}>
                      {source.title} · {source.locator}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="v2-content-case-scenarios">
            {dossier.dossier.scenarios.map((scenario) => (
              <details key={scenario.scenarioId}>
                <summary>{scenario.title}</summary>
                <div>
                  <h4>主张与来源对照</h4>
                  {scenario.sourceClaimComparisons.map((comparison) => <p key={comparison.claim}><strong>{comparison.claim}</strong>：{comparison.supportedWording}<br /><span>不可扩张：{comparison.unsupportedExpansion}</span></p>)}
                  <h4>冲突与合法替代路径</h4>
                  {scenario.conflicts.map((conflict) => <p key={conflict.title}><strong>{conflict.title}</strong>：{conflict.description}</p>)}
                  {scenario.legalAlternativeRoutes.map((route) => <p key={route.label}><strong>{route.label}</strong>：{route.steps.join(" → ")}；取舍：{route.tradeoff}</p>)}
                  <h4>学生交付要求</h4>
                  <ul>{scenario.workRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
                  {mode === "staff" && scenario.teacherObservationPoints?.length ? <><h4>教师观察点</h4><ul>{scenario.teacherObservationPoints.map((point) => <li key={point}>{point}</li>)}</ul></> : null}
                </div>
              </details>
            ))}
          </div>
          {mode === "staff" && dossier.dossier.teacherOnlyNotes?.length ? (
            <div className="v2-content-teacher-notes"><strong>教师专属观察备注</strong>{dossier.dossier.teacherOnlyNotes.map((note) => <p key={note.scenarioId}>{note.teacherOnlyNotes.join(" ")}</p>)}</div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ProfessionalTaskPanel({
  taskPackage,
  loading,
  error,
}: {
  taskPackage: ProfessionalTaskPackage | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="v2-content-panel v2-content-task-panel" aria-labelledby="content-professional-tasks-title">
      <header className="v2-content-panel-heading">
        <div><h2 id="content-professional-tasks-title">岗位任务与教学依据</h2><p>展示当前课程可消费的岗位任务、成果、量规与训练设计边界。</p></div>
        {taskPackage ? <span>{taskPackage.tasks.length} 项任务</span> : null}
      </header>
      {loading ? <div className="v2-content-inline-loading"><LoaderCircle className="spin" />正在读取岗位任务</div> : null}
      {error ? <div className="v2-inline-notice" role="status">岗位任务暂不可用：{error}；不影响资料上传和检索。</div> : null}
      {!loading && !error && !taskPackage ? <div className="v2-content-empty"><FileSearch /><p>当前课程暂无独立岗位任务包。</p></div> : null}
      {taskPackage ? <>
        <div className="v2-content-boundary"><strong>{taskPackage.title}</strong><span>{taskPackage.reviewBoundary}</span></div>
        <div className="v2-content-task-list">
          {taskPackage.tasks.map((task) => (
            <details key={task.taskId}>
              <summary><strong>{task.title}</strong></summary>
              <div><p><b>课程章节：</b>{task.courseSectionRefs.join("、")}</p><p><b>成果：</b>{task.artifacts.join("、")}</p><p><b>量规：</b>{task.rubricDimensions.join("、")}</p><p><b>知识：</b>{task.knowledgeIds.join("、")}</p>{task.trainingRules.map((rule) => <p key={`${task.taskId}-${rule.statement}`}><b>{rule.ruleType}：</b>{rule.statement}</p>)}</div>
            </details>
          ))}
        </div>
      </> : null}
    </section>
  );
}

function MaterialUpload({
  courseId,
  gateway,
  onUploaded,
}: {
  courseId: string;
  gateway: ContentLibraryGateway;
  onUploaded(result: ContentMaterialResult): Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rightsNote, setRightsNote] = useState("");
  const [allowModelContext, setAllowModelContext] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) {
      setError("请先选择一个教学资料文件。");
      return;
    }
    if (!rightsNote.trim()) {
      setError("请说明该资料的来源与使用边界。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await gateway.uploadMaterial({
        courseId,
        sourceKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`,
        title: file.name,
        kind: "course_material",
        fileName: file.name,
        mimeType: file.type || "text/plain",
        contentBase64: bytesToBase64(bytes),
        rightsNote: rightsNote.trim(),
        allowModelContext,
      });
      await onUploaded(result);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "资料导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v2-content-panel" aria-labelledby="content-upload-title">
      <header className="v2-content-panel-heading">
        <div><h2 id="content-upload-title">导入教学资料</h2><p>先登记来源与授权边界，再由服务端保存原件、解析版本和处理任务。</p></div>
        <UploadCloud />
      </header>
      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
      <div className="v2-content-upload-grid">
        <label className="v2-content-file-input"><span>文件</span><input ref={inputRef} type="file" accept=".pdf,.txt,.jpg,.jpeg,.png,.mp3,.wav,.mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{file ? `${file.name} · ${formatBytes(file.size)}` : "支持 PDF、文本、图片、音频和视频"}</small></label>
        <label><span>来源与使用说明</span><textarea value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} placeholder="例如：教师上传的课堂采访记录，仅限本课程教学使用。" /></label>
      </div>
      <label className="v2-content-checkbox"><input type="checkbox" checked={allowModelContext} onChange={(event) => setAllowModelContext(event.target.checked)} /><span>允许本课程授权的模型上下文检索使用</span></label>
      <button type="button" className="v2-content-primary-button" disabled={busy} onClick={() => void upload()}>{busy ? <><LoaderCircle className="spin" />正在导入</> : <><UploadCloud />保存并处理</>}</button>
    </section>
  );
}

function ContentLibraryWorkbench({
  courses,
  gateway,
  mode,
}: {
  courses: readonly CourseReleaseSummary[];
  gateway: ContentLibraryGateway;
  mode: LibraryMode;
}) {
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.courseId ?? "");
  const activeCourseId = useRef(selectedCourseId);
  activeCourseId.current = selectedCourseId;
  const [sources, setSources] = useState<ContentSourceDocument[]>([]);
  const [jobs, setJobs] = useState<ContentProcessingJob[]>([]);
  const [revision, setRevision] = useState<ContentSourceRevision | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<ContentSearchResult | null>(null);
  const [caseDossier, setCaseDossier] = useState<ContentCaseDossier | null>(null);
  const [professionalTasks, setProfessionalTasks] = useState<ProfessionalTaskPackage | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedCourseId && courses.some((course) => course.courseId === selectedCourseId)) return;
    setSelectedCourseId(courses[0]?.courseId ?? "");
  }, [courses, selectedCourseId]);

  const refreshStaff = useCallback(async (courseId: string, signal?: AbortSignal) => {
    const [nextSources, nextJobs] = await Promise.all([
      gateway.listSources(courseId, signal),
      gateway.listJobs(signal),
    ]);
    if (signal?.aborted || activeCourseId.current !== courseId) return;
    setSources(nextSources);
    setJobs(nextJobs);
  }, [gateway]);

  useEffect(() => {
    setSearchResult(null);
    setRevision(null);
    setSources([]);
    setJobs([]);
    setNotice(null);
    setBusy(false);
    if (mode !== "staff" || !selectedCourseId) {
      setSources([]);
      setJobs([]);
      return;
    }
    const controller = new AbortController();
    setError(null);
    refreshStaff(selectedCourseId, controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取教学资料状态");
    });
    return () => controller.abort();
  }, [mode, refreshStaff, selectedCourseId]);

  useEffect(() => {
    setCaseDossier(null);
    setProfessionalTasks(null);
    setCaseError(null);
    setTasksError(null);
    if (!selectedCourseId) {
      setCaseLoading(false);
      setTasksLoading(false);
      return;
    }
    const controller = new AbortController();
    setCaseLoading(true);
    setTasksLoading(true);
    gateway.getCaseDossier(selectedCourseId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setCaseDossier(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setCaseError(cause instanceof Error ? cause.message : "读取案例资料失败");
    }).finally(() => {
      if (!controller.signal.aborted) setCaseLoading(false);
    });
    gateway.getProfessionalTasks(selectedCourseId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setProfessionalTasks(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setTasksError(cause instanceof Error ? cause.message : "读取岗位任务失败");
    }).finally(() => {
      if (!controller.signal.aborted) setTasksLoading(false);
    });
    return () => controller.abort();
  }, [gateway, selectedCourseId]);

  const selectedCourse = courses.find((course) => course.courseId === selectedCourseId) ?? null;
  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCourseId || !searchQuery.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.search(selectedCourseId, searchQuery.trim(), 12);
      if (activeCourseId.current === selectedCourseId) setSearchResult(result);
    } catch (cause: unknown) {
      if (activeCourseId.current === selectedCourseId) setError(cause instanceof Error ? cause.message : "资料查询失败");
    } finally {
      if (activeCourseId.current === selectedCourseId) setBusy(false);
    }
  };

  const handleUploaded = async (result: ContentMaterialResult) => {
    if (activeCourseId.current !== selectedCourseId) return;
    const gaps = result.capabilityGaps.map((gap) => gap.message).join("；");
    setNotice(result.indexing.status === "ready"
      ? `资料已保存并建立 ${result.indexing.indexed} 个语义索引。${gaps ? `处理提示：${gaps}` : ""}`
      : `原件已保存，解析或索引仍需处理。${gaps}`);
    if (result.status === "failed" || result.status === "cancelled") setError(gaps || "解析未完成，可检查原件后恢复任务。");
    if (result.parsedRevisionId) {
      const parsed = await gateway.getRevision(result.parsedRevisionId);
      if (activeCourseId.current !== selectedCourseId) return;
      setRevision(parsed);
    }
    if (selectedCourseId) await refreshStaff(selectedCourseId);
  };

  const handlePreview = async (revisionId: string) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await gateway.getRevision(revisionId);
      if (activeCourseId.current === selectedCourseId) setRevision(parsed);
    } catch (cause: unknown) {
      if (activeCourseId.current === selectedCourseId) setError(cause instanceof Error ? cause.message : "无法读取来源片段");
    } finally {
      if (activeCourseId.current === selectedCourseId) setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    setError(null);
    try {
      await gateway.resumeJobs(true);
      if (selectedCourseId) await refreshStaff(selectedCourseId);
      setNotice("已请求恢复失败或未完成的资料任务。");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "无法恢复资料任务");
    } finally {
      setBusy(false);
    }
  };

  const handleIndex = async () => {
    if (!selectedCourseId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.indexCourse(selectedCourseId, revision?.revisionId);
      setNotice(`语义索引完成：${result.indexed} 个片段。`);
      await refreshStaff(selectedCourseId);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "无法建立语义索引");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`v2-teacher-page v2-content-library-page ${mode === "student" ? "student" : "staff"}`}>
      <header className="v2-teacher-page-heading v2-content-library-heading">
        <div>
          <h1>{mode === "staff" ? "教学资料工作台" : "当前课程资料"}</h1>
          <p>{mode === "staff" ? "导入、处理和复核课程教学资料；来源与片段由内容服务保持可追溯。" : "只查询当前已授权课程资料，不展示资料维护列表、处理任务或私有运行追踪。"}</p>
        </div>
        {coursePicker({ courses, selectedCourseId, onChange: setSelectedCourseId })}
      </header>
      {selectedCourse ? <div className="v2-content-course-summary"><strong>{selectedCourse.title}</strong><span>{selectedCourse.chapterCount} 个小节 · {selectedCourse.sourceCount} 条课程来源</span></div> : null}
      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
      {notice ? <div className="v2-inline-notice" role="status"><CheckCircle2 />{notice}</div> : null}
      {courses.length === 0 ? <section className="v2-content-empty v2-content-empty-large"><Database /><h2>{mode === "student" ? "当前没有已授权课程" : "暂无可维护课程"}</h2><p>{mode === "student" ? "认领并进入课程后，才能查询该课程的授权资料。" : "课程发布后，教学资料入口会读取真实课程。"}</p></section> : null}
      {courses.length > 0 ? (
        <>
          {mode==='student'?<><CaseDossierPanel dossier={caseDossier} loading={caseLoading} error={caseError} mode={mode} /><ProfessionalTaskPanel taskPackage={professionalTasks} loading={tasksLoading} error={tasksError} /></>:null}
          {mode === "staff" ? <MaterialUpload key={selectedCourseId} courseId={selectedCourseId} gateway={gateway} onUploaded={handleUploaded} /> : null}
          {mode === "staff" ? <StaffSourceList sources={sources} jobs={jobs} onPreview={(revisionId) => void handlePreview(revisionId)} /> : null}
          {mode === "staff" ? (
            <div className="v2-content-maintenance-actions">
              <button type="button" onClick={() => void handleResume()} disabled={busy}><RotateCcw />恢复全库失败任务</button>
              <button type="button" onClick={() => void handleIndex()} disabled={busy}><Database />重建语义索引</button>
            </div>
          ) : null}
          {mode === "staff" ? <RevisionPreview revision={revision} onClose={() => setRevision(null)} /> : null}
          <section className="v2-content-panel" aria-labelledby="content-search-title">
            <header className="v2-content-panel-heading">
              <div><h2 id="content-search-title">查询已授权资料</h2><p>以当前课程为边界检索来源片段，返回引用、缺口与冲突。</p></div>
              <Search />
            </header>
            <form className="v2-content-search-form" onSubmit={(event) => void handleSearch(event)}>
              <input aria-label="查询教学资料" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="例如：统计数据的时间口径如何核验？" />
              <button type="submit" disabled={busy || !selectedCourseId || !searchQuery.trim()}><Search />{busy ? "查询中" : "查询"}</button>
            </form>
          </section>
          <SearchResultList result={searchResult} />
          {mode==='staff'?<details className="teacher-material-reference"><summary>课程资料包与默认岗位任务</summary><CaseDossierPanel dossier={caseDossier} loading={caseLoading} error={caseError} mode={mode} /><ProfessionalTaskPanel taskPackage={professionalTasks} loading={tasksLoading} error={tasksError} /></details>:null}
        </>
      ) : null}
    </main>
  );
}

function StaffContentLibraryPage({ gateway }: { gateway: ContentLibraryGateway }) {
  const [courses, setCourses] = useState<CourseReleaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    gateway.getCourses(controller.signal).then((result) => {
      if (!controller.signal.aborted) setCourses(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取课程列表");
    });
    return () => controller.abort();
  }, [gateway]);
  if (!courses) return <main className="v2-centered-state v2-full-state">{error ? <p role="alert">{error}</p> : <><LoaderCircle className="spin" />正在读取课程</>}</main>;
  return <ContentLibraryWorkbench courses={courses} gateway={gateway} mode="staff" />;
}

function StudentContentLibraryPage({ gateway }: { gateway: ContentLibraryGateway }) {
  const experienceGateway = useExperienceGateway();
  const [courses, setCourses] = useState<CourseReleaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([experienceGateway.getEnrollments(controller.signal), gateway.getCourses(controller.signal)])
      .then(([enrollments, available]) => {
        const enrolledCourseIds = new Set(enrollments.map((enrollment) => enrollment.courseReleaseRef.courseId));
        setCourses(available.filter((course) => enrolledCourseIds.has(course.courseId)));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取当前课程");
      });
    return () => controller.abort();
  }, [experienceGateway, gateway]);
  if (!courses) return <main className="v2-centered-state v2-full-state">{error ? <p role="alert">{error}</p> : <><LoaderCircle className="spin" />正在读取当前课程</>}</main>;
  return <ContentLibraryWorkbench courses={courses} gateway={gateway} mode="student" />;
}

export default function ContentLibraryPage({ gateway, mode }: ContentLibraryPageProps) {
  return mode === "staff"
    ? <StaffContentLibraryPage gateway={gateway} />
    : <StudentContentLibraryPage gateway={gateway} />;
}

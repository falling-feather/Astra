import {
  ArrowLeft,
  BookOpen,
  Check,
  Circle,
  FileCheck2,
  FileClock,
  FilePenLine,
  LockKeyhole,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FlagshipWorkspaceArtifact,
  FlagshipWorkspaceView,
} from "../world-v3";
import { StudentNotebookDrawer } from "./node-field/notebook";
import { SubmissionNotes } from "./node-field/submission-notes";
import { NodeFieldDialog } from "./node-field/shell";
import type { WorkSupplementSelectionV3 } from "@ronggang/contracts";
import "./flagship-workbench-v3.css";

interface WorkbenchProps {
  workspace: FlagshipWorkspaceView;
  courseTitle?: string;
  bindingId?: string;
  busy: string | null;
  message: string | null;
  onClose(): void;
  onComplete?(): Promise<void>;
  onSave(input: {
    artifact: FlagshipWorkspaceArtifact;
    fields: Array<{ fieldId: string; content: string }>;
    evidenceRefs: string[];
    revisionNote: string;
  }): Promise<void>;
  onSubmit(artifact: FlagshipWorkspaceArtifact, supplement?: WorkSupplementSelectionV3): Promise<void>;
  onReviewDraft(artifact: FlagshipWorkspaceArtifact): Promise<void>;
  onPublish(artifact: FlagshipWorkspaceArtifact): Promise<void>;
}

const statusCopy = {
  empty: "未开始",
  draft: "草稿",
  submitted: "已锁定",
} as const;

function ArtifactEditor({
  artifact,
  workspace, bindingId,
  busy,
  message,
  onSave,
  onSubmit,
  onReviewDraft, onDirtyChange,
}: Pick<WorkbenchProps, "workspace" | "bindingId" | "busy" | "message" | "onSave" | "onSubmit" | "onReviewDraft"> & {
  artifact: FlagshipWorkspaceArtifact; onDirtyChange(id: string, changed: boolean): void;
}) {
  const initialFields = Object.fromEntries(artifact.editableFields.map((field) => [
    field.fieldId,
    artifact.latestRevision?.fields.find((item) => item.fieldId === field.fieldId)?.content ?? "",
  ]));
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  const evidenceRefs = artifact.latestRevision?.evidenceRefs ?? [];
  const [revisionNote, setRevisionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const changed = useMemo(() => artifact.editableFields.some(field => fields[field.fieldId] !== initialFields[field.fieldId]), [artifact, fields, initialFields]);
  useEffect(() => { onDirtyChange(artifact.artifactId,changed); return () => onDirtyChange(artifact.artifactId,false); },[artifact.artifactId,changed,onDirtyChange]);
  const missing=artifact.editableFields.filter(field=>(fields[field.fieldId]??'').trim().length<field.minimumLength).map(field=>field.label);
  const tooLong=artifact.editableFields.some(field=>(fields[field.fieldId]??'').length>field.maximumLength);
  const canSave = !tooLong && changed && Object.values(fields).some(value => value.trim());
  useEffect(() => { if (artifact.status === "submitted") setSubmitting(false); }, [artifact.status]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (changed) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [changed]);
  return (
    <div className="flagship-editor-grid">
      <section className="flagship-editor-document" aria-label={`${artifact.title}编辑区`}>
        <header>
          <div>
            <span>{artifact.required ? "本局必交" : "本局选做"}</span>
            <h2>{artifact.title}</h2>
            <p>整理本次调查所得，完成面向受众的作品。笔记与照片可在送审时自愿附上。</p>
          </div>
          <div className={`work-status ${artifact.status}`}>
            {artifact.status === "submitted" ? <FileCheck2 /> : <FileClock />}
            <span>{statusCopy[artifact.status]} · R{artifact.revisionCount}</span>
          </div>
        </header>

        <section className="flagship-editor-fields">
          {artifact.editableFields.map((field) => {
            const value = fields[field.fieldId] ?? "";
            const below = value.trim().length < field.minimumLength;
            return (
              <label key={field.fieldId}>
                <span>
                  <b>{field.label}</b>
                  <small className={below ? "below" : ""}>
                    {value.trim().length} / {field.minimumLength}—{field.maximumLength}
                  </small>
                </span>
                <textarea
                  value={value}
                  maxLength={field.maximumLength}
                  rows={field.maximumLength > 1_000 ? 9 : 4}
                  placeholder={`记录${field.label}，写下你的具体观察与判断。`}
                  onChange={(event) => setFields((current) => ({
                    ...current,
                    [field.fieldId]: event.target.value,
                  }))}
                />
              </label>
            );
          })}
        </section>

        <section className="flagship-editor-checks">
          <h3><ShieldCheck />送审前由你与教师判断</h3>
          {artifact.completionChecks.map((check) => (
            <p key={check}><Circle />{check}</p>
          ))}
          <small>这些是专业核验清单，系统不会仅凭字数自动声称你已经做到。</small>
        </section>

        <label className="flagship-revision-note">
          <span>修改说明（选填）</span>
          <input
            value={revisionNote}
            maxLength={600}
            placeholder="例如：根据社区受访者边界，删除住址并补充匿名说明。"
            onChange={(event) => setRevisionNote(event.target.value)}
          />
        </label>

        {artifact.latestRevision ? (
          <div className="flagship-version-receipt">
            <FilePenLine />
            <div>
              <span>已保存 R{artifact.latestRevision.revisionNumber}</span>

            </div>
            <small>{artifact.latestRevision.parentRevisionId ? "具有父版本" : "首个版本"}</small>
          </div>
        ) : null}
      </section>

      <footer className="flagship-editor-actions">
        <div>
          <span>{changed?'有未保存修改':artifact.status==='submitted'?'当前版本已送审':artifact.mechanicalCompletion.mechanicalReady?'内容已齐备，可以送审':'继续完善作品'}</span>
          <small>{changed?(missing.length?`可先保存草稿，送审前还需完善：${missing.join('、')}`:'请先保存当前修改，再提交这一版本'):artifact.status==='submitted'?'继续修改会保存为新版本，已交内容保留':missing.length?`待完善：${missing.join('、')}`:'提交以当前保存的作品为准'}</small>
        </div>
        {artifact.artifactId === "artifact-feature-story" && artifact.latestRevision ? (
          <button
            type="button"
            disabled={busy !== null || changed}
            onClick={() => void onReviewDraft(artifact)}
          >
            <Send />让编辑部审阅当前版本
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy !== null || !canSave}
          className={!artifact.mechanicalCompletion.mechanicalReady ? "primary" : ""}
          onClick={() => void onSave({
            artifact,
            fields: artifact.editableFields.map((field) => ({
              fieldId: field.fieldId,
              content: fields[field.fieldId] ?? "",
            })),
            evidenceRefs,
            revisionNote: revisionNote.trim() || (artifact.latestRevision ? "更新作品内容" : "首次保存作品"),
          })}
        >
          <FilePenLine />保存为 R{artifact.revisionCount + 1}
        </button>
        <button
          type="button"
          className={artifact.mechanicalCompletion.mechanicalReady ? "primary" : ""}
          disabled={busy !== null
            || changed
            || !artifact.latestRevision
            || !artifact.mechanicalCompletion.mechanicalReady
            || artifact.status === "submitted"}
          onClick={() => bindingId ? setSubmitting(true) : void onSubmit(artifact)}
        >
          <LockKeyhole />锁定送审
        </button>
      </footer>
      {submitting && bindingId ? <SubmissionNotes sessionId={workspace.sessionId} bindingId={bindingId} busy={busy !== null} message={message} onClose={() => setSubmitting(false)} onSubmit={selection => void onSubmit(artifact, selection)} /> : null}
    </div>
  );
}

export function FlagshipWorkbenchV3({
  workspace, bindingId, courseTitle,
  busy,
  message,
  onClose, onComplete,
  onSave,
  onSubmit,
  onReviewDraft,
  onPublish,
}: WorkbenchProps) {
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [dirty, setDirty] = useState<Record<string,boolean>>({}), [confirmExit,setConfirmExit] = useState(false);
  const reportDirty = useCallback((id:string,changed:boolean) => setDirty(current => current[id]===changed ? current : {...current,[id]:changed}),[]);
  const hasUnsaved = Object.values(dirty).some(Boolean);
  const requestClose = () => { if(hasUnsaved)setConfirmExit(true);else onClose(); };
  const firstIncomplete = workspace.artifacts.find((artifact) => (
    artifact.required && artifact.status !== "submitted"
  ));
  const [selectedId, setSelectedId] = useState(
    firstIncomplete?.artifactId ?? workspace.artifacts[0]!.artifactId,
  );
  const artifact = workspace.artifacts.find((item) => item.artifactId === selectedId)
    ?? workspace.artifacts[0]!;
  const featureStory = workspace.artifacts.find(
    (item) => item.artifactId === "artifact-feature-story",
  )!;
  return (
    <main className="flagship-workbench" aria-label="学生编辑部真实工作台">
      <header className="flagship-workbench-header">
        <button type="button" aria-label="返回采访现场" onClick={requestClose}><ArrowLeft /><span>返回采访现场</span></button>
        <div>
          <small>FIELD NOTES / EDITORIAL DESK</small>
          <strong>{courseTitle ?? workspace.manifest.title}</strong>
        </div>
        <div className="workbench-progress">
          <span>{workspace.completion.submittedRequiredCount} / {workspace.completion.requiredArtifactCount} 必交已锁定</span>
          <i><b style={{ width: `${workspace.completion.requiredArtifactCount === 0
            ? 0
            : workspace.completion.submittedRequiredCount
              / workspace.completion.requiredArtifactCount * 100}%` }} /></i>
        </div>
        <button
          type="button"
          className="publish"
          aria-label={onComplete ? "完成本课程" : "进入发布门"}
          disabled={busy !== null || hasUnsaved || !workspace.completion.readyForPublication}
          onClick={() => onComplete ? void onComplete() : void onPublish(featureStory)}
        >
          <Send /><span>{onComplete ? "完成本课程" : "进入发布门"}</span>
        </button>
        {bindingId ? <button type="button" className="notebook-control" aria-label="打开我的笔记" onClick={() => setNotebookOpen(true)}><BookOpen/><span>我的笔记</span></button> : <button type="button" className="close" aria-label="关闭工作台" onClick={requestClose}><X /></button>}
      </header>

      <div className="flagship-workbench-body">
        <nav className="flagship-artifact-nav" aria-label="作品清单">
          <div><span>本次成果</span><small>按任务保存与送审</small></div>
          {workspace.artifacts.map((item, index) => (
            <button
              type="button"
              key={item.artifactId}
              className={item.artifactId === artifact.artifactId ? "active" : ""}
              onClick={() => setSelectedId(item.artifactId)}
            >
              <i>{item.status === "submitted" ? <Check /> : index + 1}</i>
              <span><b>{item.title}</b><small>{item.required ? "本局必交" : "进阶选做"} · {statusCopy[item.status]}</small></span>
            </button>
          ))}
        </nav>
        <div className="flagship-editors">{workspace.artifacts.map(item => <div key={item.artifactId} hidden={item.artifactId !== artifact.artifactId} className="flagship-editor-panel"><ArtifactEditor
          key={`${item.artifactId}:${item.latestRevision?.revisionId ?? "empty"}`}
          artifact={item}
          onDirtyChange={reportDirty}
          {...(bindingId ? { bindingId } : {})}
          workspace={workspace}
          busy={busy}
          message={message}
          onSave={onSave}
          onSubmit={onSubmit}
          onReviewDraft={onReviewDraft}
        /></div>)}</div>
      </div>
      {confirmExit ? <NodeFieldDialog title="作品草稿尚未保存" onClose={() => setConfirmExit(false)}><div className="submission-notes"><p>还有未保存的作品修改。可以返回工作台保存，或明确放弃这些修改后回到现场。已经保存和送审的版本不受影响。</p><footer><button type="button" onClick={() => setConfirmExit(false)}>返回继续编辑</button><button type="button" onClick={onClose}>不保存，返回现场</button></footer></div></NodeFieldDialog> : null}
      {notebookOpen && bindingId ? <StudentNotebookDrawer sessionId={workspace.sessionId} bindingId={bindingId} onClose={() => setNotebookOpen(false)} /> : null}
      {message ? <div className="flagship-workbench-message">{message}</div> : null}
    </main>
  );
}

export default FlagshipWorkbenchV3;

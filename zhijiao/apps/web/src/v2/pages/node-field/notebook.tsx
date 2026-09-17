import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileText, LoaderCircle, LockKeyhole, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { StudentNotebookV1, StudentNotebookMutationV1, StudentNoteV1 } from "@ronggang/contracts";
import { useExperienceGateway } from "../../gateway";
import "./notebook.css";

type Draft = Pick<StudentNoteV1, "noteId" | "title" | "body">;
const fromNote = (note: StudentNoteV1 | undefined): Draft | null => note ? { noteId: note.noteId, title: note.title, body: note.body } : null;

export function StudentNotebookDrawer({ sessionId, bindingId, onClose }: {
  sessionId: string; bindingId: string; onClose(): void;
}) {
  const gateway = useExperienceGateway();
  const [book, setBook] = useState<StudentNotebookV1 | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentBook = useRef(book), currentDraft = useRef(draft);
  const pending = useRef<Promise<boolean> | null>(null);
  const lastCommand = useRef<StudentNotebookMutationV1 | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const applyBook = useCallback((next: StudentNotebookV1) => { currentBook.current = next; setBook(next); }, []);
  const applyDraft = useCallback((next: Draft | null) => { currentDraft.current = next; setDraft(next); }, []);
  const changed = Boolean(draft && (!book?.notes.some(note => note.noteId === draft.noteId && note.title === draft.title && note.body === draft.body)));

  useEffect(() => {
    const controller = new AbortController();
    if (!gateway.getStudentNotebook) { setError("当前连接未提供笔记服务"); return; }
    gateway.getStudentNotebook(sessionId, bindingId, controller.signal).then(next => {
      if (!controller.signal.aborted) { applyBook(next); applyDraft(fromNote(next.notes.at(-1))); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "笔记暂时无法读取"); });
    return () => controller.abort();
  }, [gateway, sessionId, bindingId, applyBook, applyDraft]);

  const flush = useCallback(async function save(): Promise<boolean> {
    if (pending.current) return (await pending.current) ? save() : false;
    const value = currentDraft.current, notebook = currentBook.current;
    if (!notebook) return !value;
    if (!value) return true;
    if (!gateway.updateStudentNotebook) return false;
    const stored = notebook.notes.find(note => note.noteId === value.noteId);
    if (!lastCommand.current && stored?.title === value.title && stored.body === value.body) return true;
    const command = lastCommand.current ?? { bindingId, requestId: `note-${crypto.randomUUID()}`, expectedRevision: notebook.revision,
      action: { kind: "save" as const, ...value } };
    lastCommand.current = command;
    setSaving(true); setError(null);
    const operation = gateway.updateStudentNotebook(sessionId, command).then(next => {
      applyBook(next); lastCommand.current = null; return true;
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : "保存失败，当前草稿仍保留在此窗口"); return false;
    }).finally(() => { pending.current = null; setSaving(false); });
    pending.current = operation;
    if (!await operation) return false;
    const latest = currentDraft.current;
    if (latest && (latest.noteId !== value.noteId || latest.title !== value.title || latest.body !== value.body)) return save();
    return true;
  }, [gateway, bindingId, sessionId, applyBook]);

  useEffect(() => {
    if (!changed || error) return;
    const timer = window.setTimeout(() => { void flush(); }, 650);
    return () => window.clearTimeout(timer);
  }, [changed, draft, error, flush]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (changed || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [changed, saving]);

  useEffect(() => () => { void flush(); }, [flush]);

  const choose = async (note: StudentNoteV1) => { if (await flush()) { applyDraft(fromNote(currentBook.current?.notes.find(item => item.noteId === note.noteId))); textRef.current?.focus(); } };
  const create = async () => {
    if (!await flush()) return;
    applyDraft({ noteId: `note-${crypto.randomUUID()}`, title: "", body: "" });
    requestAnimationFrame(() => textRef.current?.focus());
  };
  const remove = async () => {
    if (!currentDraft.current || !await flush() || !gateway.updateStudentNotebook) return;
    const notebook = currentBook.current!, noteId = currentDraft.current!.noteId;
    setSaving(true); setError(null);
    try {
      const next = await gateway.updateStudentNotebook(sessionId, { bindingId, requestId: `note-${crypto.randomUUID()}`,
        expectedRevision: notebook.revision, action: { kind: "remove", noteId } });
      applyBook(next); applyDraft(fromNote(next.notes.at(-1)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除未完成"); }
    finally { setSaving(false); }
  };
  const preserveAsNewPage = async () => {
    if (!gateway.getStudentNotebook || !currentDraft.current) return;
    const kept = { ...currentDraft.current, noteId: `note-${crypto.randomUUID()}` };
    try {
      const next = await gateway.getStudentNotebook(sessionId, bindingId);
      lastCommand.current = null; applyBook(next); applyDraft(kept); setError(null);
      await flush();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重新同步失败，草稿仍在此窗口"); }
  };

  return <aside className="v3-notebook" aria-label="我的采访本" onKeyDown={event => event.stopPropagation()}>
    <header><BookOpen /><h2>我的采访本</h2><span><LockKeyhole />仅自己可见</span>
      <button type="button" aria-label="收起采访本" onClick={() => void flush().then(saved => { if (saved) onClose(); })}><X /></button></header>
    {!book ? <div className="v3-notebook-loading">{error ?? <><LoaderCircle className="spin" />正在打开笔记…</>}</div> : <div className="v3-notebook-body">
      <nav aria-label="笔记页"><button type="button" className="v3-note-new" onClick={() => void create()} disabled={saving}><Plus />新建一页</button>
        {book.notes.map(note => <button type="button" key={note.noteId} className={draft?.noteId === note.noteId ? "selected" : ""} onClick={() => void choose(note)}>
          <FileText /><span>{note.title.trim() || "未命名笔记"}<small>{new Date(note.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small></span></button>)}
      </nav>
      {draft ? <section className="v3-note-paper"><div className="v3-note-title"><input aria-label="笔记标题" value={draft.title} placeholder="给这一页起个名字" maxLength={120}
        onChange={event => applyDraft({ ...currentDraft.current!, title: event.target.value })} /><button type="button" aria-label="删除当前笔记" disabled={saving} onClick={() => void remove()}><Trash2 /></button></div>
        <textarea ref={textRef} aria-label="笔记正文" placeholder="记下观察、原话、疑问，或自己的想法…" value={draft.body} maxLength={20_000}
          onChange={event => applyDraft({ ...currentDraft.current!, body: event.target.value })} onBlur={() => { if (!error) void flush(); }} />
        <footer aria-live="polite">{saving ? <><LoaderCircle className="spin" />正在保存</> : changed ? "尚未保存" : <><Check />已保存</>}<span>{draft.body.length}字</span></footer>
      </section> : <section className="v3-note-empty"><BookOpen /><p>从你的第一条观察开始。</p><button type="button" onClick={() => void create()}>写一页笔记</button><small>笔记仅自己可见，交作品时由你选择是否附上。</small></section>}
    </div>}
    {error ? <div className="v3-note-error" role="alert"><p>{error}</p>{book ? <><button type="button" onClick={() => void flush()}><RefreshCw />重试保存</button><button type="button" onClick={() => void preserveAsNewPage()}>保留草稿为新页</button></> : <button type="button" onClick={onClose}>稍后再试</button>}</div> : null}
  </aside>;
}

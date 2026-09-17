import { useEffect, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import type { StudentNoteV1, WorkSupplementSelectionV3 } from "@ronggang/contracts";
import { useExperienceGateway } from "../../gateway";
import { NodeFieldDialog } from "./shell";
import "./submission-notes.css";

export function SubmissionNotes({ sessionId, bindingId, busy, message, onClose, onSubmit }: {
  sessionId: string; bindingId: string; busy: boolean; onClose(): void; onSubmit(selection: WorkSupplementSelectionV3): void;
  message?: string | null;
}) {
  const gateway = useExperienceGateway();
  const [notes, setNotes] = useState<StudentNoteV1[]>([]), [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<WorkSupplementSelectionV3>({ noteIds: [], photos: [] });
  const [error, setError] = useState<string | null>(null);
  const [readingPhotos,setReadingPhotos]=useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!gateway.getStudentNotebook) { setLoading(false); setError("当前环境无法读取笔记，可直接提交作品。"); return; }
    gateway.getStudentNotebook(sessionId, bindingId, controller.signal).then(book => { if (!controller.signal.aborted) { setNotes(book.notes); setSelection(current => ({ ...current, notebookRevision: book.revision })); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "笔记读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [gateway, sessionId, bindingId]);
  const addPhotos = async (files: File[]) => {
    setError(null);
    if (selection.photos.length + files.length > 2 || files.some(file => file.size > 2_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) {
      setError("最多附上两张笔记照片，每张不超过 2MB，支持 PNG、JPEG、WebP。"); return;
    }
    setReadingPhotos(true);
    try {
      const photos = await Promise.all(files.map(file => new Promise<WorkSupplementSelectionV3["photos"][number]>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error("照片读取失败，请重新选择"));
        reader.onload = () => resolve({ name: file.name.slice(0, 120), dataUrl: String(reader.result) }); reader.readAsDataURL(file);
      })));
      setSelection(current => ({ ...current, photos: [...current.photos, ...photos].slice(0, 2) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "照片读取失败"); }
    finally { setReadingPhotos(false); }
  };
  return <NodeFieldDialog title="提交作品" onClose={() => { if (!busy) onClose(); }}><div className="submission-notes">
    <p>作品将送交教师。下面的笔记和照片均为选填，不附上也可以提交。</p>
    <h3>自愿附上我的笔记</h3><small>仅提交选中的当前副本。未选笔记以及此后的修改仍只对你自己可见。</small>
    {loading ? <p>读取我的笔记…</p> : !notes.length ? <p className="supplement-empty">笔记本暂无记录。</p> : <div className="submission-note-list">{notes.map(note => <label key={note.noteId}>
      <input type="checkbox" checked={selection.noteIds.includes(note.noteId)} disabled={busy} onChange={event => setSelection(current => ({ ...current, noteIds: event.target.checked ? [...current.noteIds, note.noteId] : current.noteIds.filter(id => id !== note.noteId) }))}/><span><strong>{note.title || "未命名笔记"}</strong><small>{note.body.slice(0, 140)}</small></span>
    </label>)}</div>}
    <h3>纸质笔记照片</h3><label className="submission-photo-pick"><ImagePlus />选择照片<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void addPhotos(files); }}/></label>
    <small>照片在点击下方“确认送审”之前只留在当前浏览器。</small>
    <div className="submission-photo-list">{selection.photos.map((photo, index) => <figure key={index}><img src={photo.dataUrl} alt={`待提交的${photo.name}`}/><figcaption>{photo.name}</figcaption><button type="button" disabled={busy} aria-label={`移除${photo.name}`} onClick={() => setSelection(current => ({ ...current, photos: current.photos.filter((_, i) => i !== index) }))}><X/></button></figure>)}</div>
    {error || message ? <p role="alert">{error ?? message}</p> : null}
    <footer><button type="button" disabled={busy || readingPhotos} onClick={onClose}>继续整理</button><button type="button" className="node-primary" disabled={busy || loading || readingPhotos} onClick={() => onSubmit(selection)}><Check/>{busy ? "正在送审…" : readingPhotos ? "正在读取照片…" : "确认送审"}</button></footer>
  </div></NodeFieldDialog>;
}

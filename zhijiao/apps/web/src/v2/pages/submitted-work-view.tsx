import type {TeacherSubmittedWorksV3} from '@ronggang/contracts';
import './submitted-work-view.css';

export function SubmittedWorkView({value,title,onClose}:{value:TeacherSubmittedWorksV3;title:string;onClose():void}){
 return <section className="dossier-submitted-works"><header><h3>{title} · 已交作品</h3><button type="button" onClick={onClose}>收起</button></header>
  {!value.works.length?<p>本场尚无已送审作品。</p>:value.works.map(work=><article key={work.artifactId}><h4>{work.title} · R{work.revisionNumber}</h4>
   {work.fields.map(field=><section key={field.label}><h5>{field.label}</h5><p>{field.content}</p></section>)}
   {work.supplement?.notes.length?<details><summary>学生主动附上的笔记 · {work.supplement.notes.length}页</summary>{work.supplement.notes.map(note=><section key={note.noteId}><h5>{note.title||'未命名笔记'}</h5><p>{note.body}</p></section>)}</details>:null}
   {work.supplement?.photos.length?<details><summary>学生主动附上的纸质笔记照片</summary>{work.supplement.photos.map((photo,index)=><figure key={index}><img src={photo.dataUrl} alt={photo.name}/><figcaption>{photo.name}</figcaption></figure>)}</details>:null}
  </article>)}
 </section>;
}

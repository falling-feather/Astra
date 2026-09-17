import {useEffect,useState} from 'react';
import type {SessionControlOverview} from '@ronggang/contracts';
import type {AdminGateway} from './admin-gateway';

export function AdminSessionPicker({gateway,bindingId,sessionId,page,navigate}:{gateway:AdminGateway;bindingId:string;sessionId:string;page:string;navigate(path:string):void}){
  const [overview,setOverview]=useState<SessionControlOverview|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();setError(null);gateway.getSessionOverview?.(bindingId,sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setOverview(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'场次目录读取失败');});return()=>controller.abort();},[gateway,bindingId,sessionId]);
  const states={active:'进行中',paused:'已暂停',completed:'已完成',provisioning:'准备中',recovery_failed:'待恢复'};
  const sessions=overview?.sessions.toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt))??[];
  return <label className="admin-session-picker"><span>当前审查场次</span><select aria-label="选择审查场次" value={sessionId} onChange={event=>navigate(`/admin/${page}?sessionId=${encodeURIComponent(event.target.value)}`)}>
    {!sessions.some(item=>item.sessionId===sessionId)?<option value={sessionId}>{sessionId}</option>:null}
    {sessions.map(item=><option key={item.sessionId} value={item.sessionId}>{states[item.status]} · {item.experienceTitle??overview?.classrooms.find(c=>c.classroomId===item.classroomId)?.name??'课程实训'} · {new Date(item.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</option>)}
  </select>{error?<small role="status">{error}</small>:null}</label>;
}

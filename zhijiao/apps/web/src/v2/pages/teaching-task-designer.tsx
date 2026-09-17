import { useEffect, useState } from "react";
import { ArrowRight, BookOpenCheck, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import type { AssessmentCriterionIdV4, TeachingTaskDraftV1, TeachingTaskInputV1, TeachingTaskWorkspaceV1 } from "@ronggang/contracts";
import type { TeachingAuthorContext, TeachingTaskEdit, TeachingTaskGateway } from "../teaching-task-gateway";
import "./teaching-tasks.css";

const criteria: Array<[AssessmentCriterionIdV4, string]> = [["criterion-fact-verification", "事实核验"], ["criterion-interview-consent", "采访与同意"],
  ["criterion-editorial-judgment", "编辑判断"], ["criterion-rights-governance", "素材权利"], ["criterion-multiplatform-production", "媒体适配"], ["criterion-recovery-transfer", "复盘迁移"]];
export function teachingTaskEditOf(draft: TeachingTaskDraftV1): TeachingTaskEdit {
  const plan = draft.plan;
  return { title: plan.title, assignment: plan.assignment, audience: plan.audience, objectives: [...plan.objectives], durationMinutes: plan.durationMinutes,
    scaffoldingLevel: plan.scaffoldingLevel, challengeLevel: plan.challengeLevel, steps: plan.steps.map(step => ({ taskRef: step.taskRef, instruction: step.instruction })) };
}
const initial: TeachingTaskInputV1 = { title: "", brief: "", audience: "", learnerContext: "", learnerLevel: "beginner", durationMinutes: 55,
  sourceKind: "teaching_example", sourceStatement: "", templateId: null, focusCriteria: [] };
const failure = (cause: unknown) => cause instanceof Error ? cause.message : "任务操作未完成，输入已保留。";

export function TeachingTaskDesigner({ gateway, context, navigate }: { gateway: TeachingTaskGateway; context: TeachingAuthorContext; navigate(path: string): void }) {
  const [workspace, setWorkspace] = useState<TeachingTaskWorkspaceV1 | null>(null);
  const [input, setInput] = useState<TeachingTaskInputV1>(initial);
  const [draft, setDraft] = useState<TeachingTaskDraftV1 | null>(null);
  const [edit, setEdit] = useState<TeachingTaskEdit | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("已核对本班任务要求、课堂条件与材料使用范围，确认用于本次仿真练习。");
  const refresh = async () => setWorkspace(await gateway.workspace());
  useEffect(() => {
    const controller = new AbortController();
    gateway.workspace(controller.signal).then(value => { if (!controller.signal.aborted) setWorkspace(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(failure(cause)); });
    return () => controller.abort();
  }, [gateway]);
  const select = (value: TeachingTaskDraftV1) => { setInput(value.input); setDraft(value); setEdit(teachingTaskEditOf(value)); setConfirmed(false); setNotice(null); };
  const dirty = draft && edit ? JSON.stringify(edit) !== JSON.stringify(teachingTaskEditOf(draft)) : false;
  const perform = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(null); setNotice(null);
    try { await action(); } catch (cause) { setError(failure(cause)); } finally { setBusy(null); }
  };
  const example = (kind: "community-story" | "public-service") => {
    setInput({ ...initial, templateId: kind, durationMinutes: kind === "community-story" ? 55 : 45,
      title: kind === "community-story" ? "簪花之外的日常劳动" : "先确认服务范围，再写游客指引",
      brief: kind === "community-story" ? "为第一次了解蟳埔的读者做一篇社区人物报道，关注容易被造型照片遮蔽的日常劳动，说明本人经历及记录边界。" : "为初次来访游客制作公共服务信息说明，核对公示版本、咨询时段与出行信息，形成带时点的首版与后续更新。",
      audience: kind === "community-story" ? "初次了解社区生活的年轻读者" : "需要当下出行与咨询信息的游客",
      learnerContext: "已学过采访基本表达，需要练习来源核对、公开范围和有依据的编辑取舍。", sourceStatement: "本项目自拟教学示例，不是现实企业委托。" });
    setQuestions([]);
  };
  const updateEdit = (value: Partial<TeachingTaskEdit>) => { setEdit(current => current ? { ...current, ...value } : current); setConfirmed(false); };

  return <section className="teaching-designer" aria-labelledby="teaching-designer-title">
    <header className="teaching-heading"><div><span className="teaching-eyebrow">教师委托 · 蟳埔社区仿真</span><h2 id="teaching-designer-title">把岗位委托转成学习任务</h2><p>先说明委托与学生基础，再审阅任务、依据和成果要求，确认后发布给本班。</p></div>
      <button type="button" className="teaching-secondary" disabled={Boolean(busy)} onClick={() => void perform("刷新", refresh)}><RefreshCw size={16} />刷新任务</button></header>
    {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
    {notice ? <p className="teaching-success" role="status"><CheckCircle2 size={18} />{notice}</p> : null}
    <div className="teaching-columns">
      <form className="teaching-card teaching-input" onSubmit={event => { event.preventDefault(); void perform("生成", async () => {
        const result = await gateway.generate(context, input);
        if (result.status === "needs_clarification") { setQuestions(result.questions); return; }
        setQuestions([]); select(result.draft); await refresh(); setNotice("任务草案已保存，请逐项核对后再发布。");
      }); }}>
        <h3>1. 岗位委托</h3>
        <div className="teaching-examples"><button type="button" onClick={() => example("community-story")}>使用人物报道示例</button><button type="button" onClick={() => example("public-service")}>使用公共服务示例</button></div>
        <label>任务名称<input value={input.title} maxLength={120} onChange={event => setInput({ ...input, title: event.target.value })} placeholder="可留空，由任务类型生成" /></label>
        <label>委托内容<textarea value={input.brief} maxLength={1200} rows={5} onChange={event => setInput({ ...input, brief: event.target.value })} placeholder="谁希望完成什么报道或信息服务？具体要解决什么问题？" /></label>
        <label>成果受众<input value={input.audience} maxLength={160} onChange={event => setInput({ ...input, audience: event.target.value })} placeholder="例如：初次来访、需要咨询信息的游客" /></label>
        <label>学生基础与本次练习目标<textarea value={input.learnerContext} maxLength={500} rows={3} onChange={event => setInput({ ...input, learnerContext: event.target.value })} placeholder="描述班级已学内容和需要练习的能力，请勿填写姓名、学号等个人信息" /></label>
        <div className="teaching-two-fields"><label>先备经验<select value={input.learnerLevel} onChange={event => setInput({ ...input, learnerLevel: event.target.value as TeachingTaskInputV1["learnerLevel"] })}><option value="beginner">基础阶段 · 起始4级</option><option value="practiced">已完成基础练习 · 起始5级</option></select></label>
          <label>世界内可用分钟<input type="number" min={45} max={60} value={input.durationMinutes} onChange={event => setInput({ ...input, durationMinutes: Number(event.target.value) })} /></label></div>
        <label>委托类型<select value={input.templateId ?? "auto"} onChange={event => setInput({ ...input, templateId: event.target.value === "auto" ? null : event.target.value as TeachingTaskInputV1["templateId"] })}><option value="auto">按委托内容识别</option><option value="community-story">社区人物与日常劳动</option><option value="public-service">公共服务信息与更新</option></select></label>
        <fieldset className="teaching-focus"><legend>本次重点（可选，最多3项）</legend>{criteria.map(([id, title]) => <label key={id}><input type="checkbox" checked={input.focusCriteria.includes(id)} disabled={input.focusCriteria.length >= 3 && !input.focusCriteria.includes(id)} onChange={event => setInput({ ...input, focusCriteria: event.target.checked ? [...input.focusCriteria, id] : input.focusCriteria.filter(value => value !== id) })} />{title}</label>)}</fieldset>
        <label>委托来源<select value={input.sourceKind} onChange={event => setInput({ ...input, sourceKind: event.target.value as TeachingTaskInputV1["sourceKind"] })}><option value="teaching_example">自拟教学练习</option><option value="teacher_provided">教师提供的项目要求</option></select></label>
        <label>来源说明<input value={input.sourceStatement} maxLength={600} onChange={event => setInput({ ...input, sourceStatement: event.target.value })} placeholder="说明原任务来源或明确是教学编写" /></label>
        {questions.length ? <div className="teaching-clarification" role="alert"><strong>还需要明确这些信息</strong><ul>{questions.map(question => <li key={question}>{question}</li>)}</ul></div> : null}
        <button className="teaching-primary" disabled={Boolean(busy)}>{busy === "生成" ? <LoaderCircle className="spin" size={18} /> : <BookOpenCheck size={18} />}生成任务草案</button>
        <small>任务依据来自当前岗位知识与课程规则；生成结果需教师复核，不能替代学生完成作品。</small>
      </form>
      <div className="teaching-card teaching-review">
        <h3>2. 审阅与发布</h3>
        {!draft || !edit ? <div className="teaching-empty"><BookOpenCheck size={36} /><p>生成或打开一份草案后，在这里核对任务步骤、来源和教学条件。</p></div> : <>
          <p className="teaching-revision">草案 R{draft.revision} · {dirty ? "有未保存修改" : "当前修改已保存"}</p>
          <label>当前任务名称<input value={edit.title} maxLength={120} onChange={event => updateEdit({ title: event.target.value })} /></label>
          <label>给学生的任务说明<textarea value={edit.assignment} rows={5} maxLength={1800} onChange={event => updateEdit({ assignment: event.target.value })} /></label>
          <label>当前成果受众<input value={edit.audience} maxLength={160} onChange={event => updateEdit({ audience: event.target.value })} /></label>
          <label>学习目标（每行一项）<textarea value={edit.objectives.join("\n")} rows={4} onChange={event => updateEdit({ objectives: event.target.value.split("\n") })} /></label>
          <div className="teaching-three-fields"><label>世界内分钟<input type="number" min={45} max={60} value={edit.durationMinutes} onChange={event => updateEdit({ durationMinutes: Number(event.target.value) })} /></label>
            <label>起始级别<select value={edit.challengeLevel} onChange={event => updateEdit({ challengeLevel: Number(event.target.value) as 3 | 4 | 5 })}><option value={3}>3级</option><option value={4}>4级</option><option value={5}>5级</option></select></label>
            <label>支架强度<select value={edit.scaffoldingLevel} onChange={event => updateEdit({ scaffoldingLevel: Number(event.target.value) })}><option value={2}>更多引导</option><option value={1}>常规提示</option><option value={0}>自主完成</option></select></label></div>
          <p className="teaching-hint">起始条件由教师设置，不代表系统已测出学生能力。世界时限会实际应用于新场次。</p>
          <ol className="teaching-steps">{edit.steps.map((step, index) => <li key={step.taskRef}>
            <strong>{draft.plan.steps.find(item => item.taskRef === step.taskRef)?.title}</strong>
            <textarea aria-label={`步骤${index + 1}说明`} rows={3} value={step.instruction} maxLength={2000} onChange={event => updateEdit({ steps: edit.steps.map(item => item.taskRef === step.taskRef ? { ...item, instruction: event.target.value } : item) })} />
            <small>{draft.plan.steps.find(item => item.taskRef === step.taskRef)?.observableResult}</small>
          </li>)}</ol>
          <details className="teaching-basis"><summary>查看 {draft.plan.basis.length} 条知识依据与复核状态</summary>{draft.plan.basis.map(basis => <article key={basis.knowledgeRevisionId}><strong>{basis.isFocus ? "本次重点 · " : ""}{basis.title}</strong><p>{basis.sourceTitle} · {basis.locator}</p><small>{basis.reviewStatus === "verified" ? "库内已复核" : "仍需专业复核"}</small>{basis.sourceUrl ? <a href={basis.sourceUrl} target="_blank" rel="noreferrer">查看来源</a> : <span>原件在课程资料库</span>}</article>)}</details>
          <details className="teaching-basis"><summary>资料计划与可选路径</summary>{draft.plan.sourcePlan.map(source => <p key={source.personId}>{source.purpose}</p>)}<ul>{draft.plan.acceptableAlternatives.map(value => <li key={value}>{value}</li>)}</ul></details>
          <div className="teaching-save-row"><button className="teaching-secondary" type="button" disabled={Boolean(busy) || !dirty} onClick={() => void perform("保存", async () => { select(await gateway.revise(context, draft, edit)); await refresh(); setNotice("修改已保存为新的草案版本，原版本保留。"); })}>保存草案修改</button></div>
          <div className="teaching-publish"><label><input type="checkbox" checked={confirmed} disabled={Boolean(dirty)} onChange={event => setConfirmed(event.target.checked)} />我已核对任务、依据与本班条件，确认用于当前仿真实训。</label>
            <label>发布确认说明<textarea value={confirmation} onChange={event => setConfirmation(event.target.value)} rows={2} maxLength={1000} /></label>
            <button className="teaching-primary" type="button" disabled={Boolean(busy) || Boolean(dirty) || !confirmed || confirmation.trim().length < 8} onClick={() => void perform("发布", async () => {
              const value = await gateway.publish(context, draft, confirmation); await refresh(); setNotice(`已发布 R${value.ref.revision}，本班学生可开始独立场次。`); setConfirmed(false);
            })}>确认发布给本班<ArrowRight size={17} /></button></div>
        </>}
      </div>
    </div>
    <section className="teaching-saved" aria-label="已保存的教学任务"><h3>任务与场次</h3>{!workspace ? <p>正在读取已保存的任务…</p> : <>
      {workspace.drafts.length === 0 ? <p>尚无任务草案。可以从一份具体委托开始。</p> : <div className="teaching-task-cards">{workspace.drafts.map(item => <article key={item.taskId}><span>草案 R{item.revision}</span><h4>{item.plan.title}</h4><p>{item.plan.audience} · {item.plan.durationMinutes}分钟</p><button type="button" className="teaching-secondary" onClick={() => select(item)}>打开草案</button></article>)}</div>}
      <div className="teaching-task-cards">{workspace.releases.map(item => <article key={item.ref.releaseId}><span>已发布 R{item.ref.revision}</span><h4>{item.plan.title}</h4><p>{workspace.sessions.filter(session => session.taskReleaseRef.releaseId === item.ref.releaseId).length}个已开始场次</p><small>发布于{new Date(item.publishedAt).toLocaleString("zh-CN")}</small></article>)}</div>
      {workspace.sessions.length ? <ul className="teaching-session-list">{workspace.sessions.map(session => <li key={session.sessionId}><span>{session.title} · {session.status === "completed" ? "实训已结束" : "已开始"}</span><button type="button" onClick={() => navigate(`/teacher/director/${session.sessionId}`)}>查看本场过程</button><button type="button" onClick={() => navigate(`/teacher/reviews/${session.sessionId}`)}>查看本场反馈</button></li>)}</ul> : null}
    </>}</section>
  </section>;
}

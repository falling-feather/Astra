import type * as D from '../portal/workflow-types';
import { readTemplateForm } from '../portal/template-controls.ts';

export function blankUnit(settings: D.CourseSettings, position: number): D.CourseUnitWrite {
  const key = `draft-${crypto.randomUUID()}`;
  return { title: '新的学习单元', position, content: { schemaVersion: 'astra-content-page-v2', slug: `draft/${key}`, galaxy: settings.galaxy_key, subject: settings.subject_key, title: '新的学习单元', summary: '围绕一个问题，预测、观察并解释。', layout: 'course-page', status: 'draft', version: 'draft', courseUnit: { courseId: 'draft', unitId: key, order: position, title: '新的学习单元', completion: null }, blocks: [{ blockId: 'learning-goal', type: 'learning-task', title: '学习目标', prompt: '围绕一个问题，预测、观察并解释。' }, { blockId: 'lesson-text', type: 'rich-text', title: '教学说明', markdown: '记录预测、改变的条件和观察到的结果。' }] } };
}

export function toWriteUnit(unit: D.CourseDraftUnitReadV2, settings?: D.CourseSettings): D.CourseUnitWrite {
  if (!unit.content && !settings) throw new Error(`${unit.title} 需要课程设置才能补齐正文。`);
  const content = unit.content ? structuredClone(unit.content) : blankUnit(settings!, unit.position).content;
  content.title = unit.title;
  if (content.courseUnit) { content.courseUnit.title = unit.title; content.courseUnit.unitId = unit.activity_key; }
  return { id: unit.id, activity_key: unit.activity_key, resource_version_id: unit.resource_version_id, title: unit.title, position: unit.position, content };
}

export function readUnit(unit: D.CourseUnitWrite, data: FormData, resource?: D.ResourceVersionRead): D.CourseUnitWrite {
  const result = structuredClone(unit), page = result.content;
  const value = (key: string) => String(data.get(key) || '').trim();
  result.title = value('unit_title'); page.title = result.title; page.summary = value('goal');
  if (!page.summary || !value('markdown')) throw new Error('请填写学习目标与教学说明。');
  const goal = page.blocks.find((block) => block.type === 'learning-task');
  if (goal) goal.prompt = page.summary;
  else page.blocks.unshift({ blockId: `goal-${crypto.randomUUID()}`, type: 'learning-task', title: '学习目标', prompt: page.summary });
  const text = page.blocks.find((block) => block.type === 'rich-text');
  if (text) text.markdown = value('markdown');
  else page.blocks.push({ blockId: `text-${crypto.randomUUID()}`, type: 'rich-text', markdown: value('markdown') });
  const block = page.blocks.find((item) => item.type === 'resource');
  if (block) {
    block.instructions = value('instructions');
    if (resource && ['function-graph-v1', 'data-chart-v1'].includes(resource.renderer)) block.configuration = readTemplateForm(resource.renderer, block.configuration || {}, data);
  }
  let checkpoint = page.blocks.find((item) => item.type === 'checkpoint');
  if (!checkpoint || checkpoint.mode !== 'question-set') {
    if (data.has('checkpoint_enabled')) {
      const kind = value('response_type') as D.CheckpointBlock['responseType'];
      const choices = value('choices').split(/\r?\n/).filter(Boolean).map((label, index) => ({ choiceId: checkpoint?.choices?.[index]?.choiceId || `choice-${index + 1}`, label }));
      const choiceKind = kind === 'single-choice' || kind === 'multiple-choice';
      const next: D.CheckpointBlock = { ...checkpoint, blockId: checkpoint?.blockId || 'understanding', type: 'checkpoint', checkpointKey: checkpoint?.checkpointKey || 'understanding', title: checkpoint?.title || '检查理解', prompt: value('question'), mode: 'inline', responseType: kind, choices: choiceKind ? choices : [], correctChoiceIds: choiceKind ? value('correct_choices').split(/[,，\s]+/).filter(Boolean).map((index) => choices[Number(index) - 1]?.choiceId || `invalid-${index}`) : [], numericAnswer: kind === 'numeric' ? Number(value('numeric_answer')) : null, tolerance: kind === 'numeric' ? Number(value('tolerance') || 0) : null, acceptedAnswers: kind === 'short-text' ? value('accepted_answers').split(/\r?\n/).filter(Boolean) : [], maxAttempts: value('max_attempts') ? Number(value('max_attempts')) : null };
      if (!next.prompt || kind === 'numeric' && !value('numeric_answer')) throw new Error('请补全检查点题目与参考答案。');
      if (checkpoint) page.blocks[page.blocks.indexOf(checkpoint)] = next;
      else page.blocks.push(next);
      checkpoint = next;
    } else if (checkpoint) { page.blocks.splice(page.blocks.indexOf(checkpoint), 1); checkpoint = undefined; }
  }
  if (page.courseUnit) {
    page.courseUnit.title = result.title;
    const preset = value('completion');
    if (preset === 'checkpoint_passed' && !checkpoint) throw new Error('请先配置理解检查点。');
    if (preset === 'assignment_reviewed' && !Number(value('assignment_id'))) throw new Error('请选择本单元已布置的作业。');
    page.courseUnit.completion = preset === 'checkpoint_passed' ? { preset, checkpointKey: checkpoint!.checkpointKey } : preset === 'assignment_reviewed' ? { preset, assignmentId: Number(value('assignment_id')) } : preset === 'experiment_operation' ? { preset } : null;
  }
  return result;
}

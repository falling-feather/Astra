import type { Block, CourseInfo, DraftUnit } from './contracts';
import { defaultContent, replaceBlock } from './presentation.ts';

/** Only the simple two-choice authoring form owns these fields. Other blocks remain intact. */
export function simpleCheckpoint(block?: Block): boolean {
  return (
    !block ||
    (block.mode === 'inline' &&
      block.responseType === 'single-choice' &&
      block.choices?.length === 2 &&
      block.choices[0].choiceId === 'a' &&
      block.choices[1].choiceId === 'b')
  );
}

export function updateUnit(course: CourseInfo, unit: DraftUnit, data: FormData): DraftUnit {
  const value = (key: string) => String(data.get(key) || '').trim();
  const title = value('unit_title'),
    key = value('activity_key') || unit.activity_key;
  if (!title || !key) throw new Error('请填写单元名称并选择关联实验。');
  if (unit.id && key !== unit.activity_key)
    throw new Error('已保存的实验引用保持不变；如需更换，请新增单元。');
  const content = structuredClone(unit.content || defaultContent(course, key, title, unit.position));
  content.title = title;
  content.summary = value('goal');
  if (content.courseUnit) Object.assign(content.courseUnit, { title, unitId: key, order: unit.position });
  const goal = content.blocks.find((block) => block.type === 'learning-task');
  replaceBlock(content, 'learning-task', {
    ...goal,
    blockId: goal?.blockId || 'learning-goal',
    type: 'learning-task',
    title: goal?.title || '学习目标',
    prompt: value('goal'),
  });
  const text = content.blocks.find((block) => block.type === 'rich-text');
  replaceBlock(content, 'rich-text', {
    ...text,
    blockId: text?.blockId || 'lesson-text',
    type: 'rich-text',
    title: text?.title || '教学说明',
    markdown: value('markdown'),
  });
  const experiment = content.blocks.find((block) => block.type === 'official-simulation');
  if (experiment)
    replaceBlock(content, 'official-simulation', {
      ...experiment,
      blockId: experiment?.blockId || 'official-experiment',
      type: 'official-simulation',
      simulationKey: key,
    });
  const checkpoint = content.blocks.find((block) => block.type === 'checkpoint');
  if (simpleCheckpoint(checkpoint)) {
    if (data.has('checkpoint_enabled')) {
      if (!value('question') || !value('choice_a') || !value('choice_b'))
        throw new Error('请填写检查点题目与两个选项。');
      replaceBlock(content, 'checkpoint', {
        ...checkpoint,
        blockId: checkpoint?.blockId || 'understanding',
        type: 'checkpoint',
        checkpointKey: checkpoint?.checkpointKey || 'understanding',
        title: checkpoint?.title || '检查理解',
        prompt: value('question'),
        mode: 'inline',
        responseType: 'single-choice',
        choices: [
          { choiceId: 'a', label: value('choice_a') },
          { choiceId: 'b', label: value('choice_b') },
        ],
        correctChoiceIds: [value('correct_choice')],
      });
    } else replaceBlock(content, 'checkpoint', null);
  }
  const completion = value('completion');
  if (completion === 'assignment_reviewed' && !Number(value('completion_assignment')))
    throw new Error('请选择本单元用于认定完成的作业。');
  if (content.courseUnit && completion !== 'preserve') {
    const check = content.blocks.find((block) => block.type === 'checkpoint');
    if (completion === 'checkpoint_passed' && !check) throw new Error('请先配置检查点，再将它设为完成条件。');
    content.courseUnit.completion =
      completion === 'checkpoint_passed'
        ? { preset: 'checkpoint_passed', checkpointKey: check!.checkpointKey }
        : completion === 'assignment_reviewed'
          ? { preset: 'assignment_reviewed', assignmentId: Number(value('completion_assignment')) }
          : null;
  }
  return { ...unit, title, activity_key: key, content };
}

import type * as T from './contracts';
import { e, field } from './presentation';
import { flowButton as button } from './workflow-view';
import { markdown } from '../ui/markdown';

export function renderLearningBlock(block: T.Block, activities: T.Activity[]): string {
  if (block.type === 'hero')
    return `<section class="lesson-block"><h2>${e(block.title)}</h2><p>${e(block.summary)}</p></section>`;
  if (block.type === 'rich-text')
    return `<section class="lesson-block"><h3>${e(block.title || '学习内容')}</h3><div class="lesson-prose">${markdown(block.markdown || '')}</div></section>`;
  if (block.type === 'learning-task')
    return `<section class="lesson-block"><h3>${e(block.title)}</h3><p>${e(block.prompt)}</p>${block.outcomes?.length ? `<ul>${block.outcomes.map((value) => `<li>${e(value)}</li>`).join('')}</ul>` : ''}${block.steps?.length ? `<ol>${block.steps.map((value) => `<li>${e(value)}</li>`).join('')}</ol>` : ''}</section>`;
  if (block.type === 'official-simulation') {
    const activity = activities.find((item) => item.key === block.simulationKey);
    return `<section class="lesson-block"><h3>${e(block.title)}</h3><p>${e(block.instructions)}</p>${activity ? button('打开交互实验 →', 'open-activity', `data-key="${e(activity.key)}"`) : '<p>该实验暂不可用。</p>'}</section>`;
  }
  if (block.type === 'sources')
    return `<section class="lesson-block"><h3>${e(block.title || '参考资料')}</h3>${(block.items || []).map((item) => (/^https?:\/\//.test(item.url) ? `<p><a href="${e(item.url)}" target="_blank" rel="noopener noreferrer">${e(item.label)}</a></p>` : '')).join('')}</section>`;
  if (block.type === 'resource')
    return `<section class="lesson-block"><h3>${e(block.title)}</h3><p>${e(block.instructions)}</p><div data-course-resource="${e(block.blockId)}" role="group" aria-label="${e(block.title)}">正在读取交互资源…</div></section>`;
  if (block.type === 'media')
    return `<section class="lesson-block"><h3>${e(block.title || '课程素材')}</h3><div data-course-media="${e(block.blockId)}">正在读取素材…</div><p>${e(block.caption || block.alt || '')}</p>${block.transcript ? `<details><summary>文字内容</summary><p>${e(block.transcript)}</p></details>` : ''}</section>`;
  if (block.type === 'checkpoint')
    return `<section class="lesson-block checkpoint-block"><h3>${e(block.title)}</h3><p>${e(block.prompt)}</p><form data-flow-form="checkpoint" data-flow-dirty data-key="${e(block.checkpointKey)}" data-response="${e(block.responseType)}">${block.responseType?.endsWith('choice') ? (block.choices || []).map((item) => `<label class="checkpoint-choice"><input type="${block.responseType === 'multiple-choice' ? 'checkbox' : 'radio'}" name="answer" value="${e(item.choiceId)}"/>${e(item.label)}</label>`).join('') : field('你的回答', 'answer', '', { type: block.responseType === 'numeric' ? 'number' : 'text', required: true })}<button class="primary-button" type="submit" ${block.mode !== 'question-set' ? '' : 'disabled'}>提交检查</button><output class="checkpoint-result" role="status"></output></form></section>`;
  return `<section class="lesson-block"><h3>${e(block.title || '课程媒体')}</h3><p>${e(block.caption || block.alt || '该媒体资源由学校内容库管理。')}</p></section>`;
}

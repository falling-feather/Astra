import { TARGETS, readNotebook, writeNotebook, notebookKey, addNote, toggleFavorite } from './notebook.js';
import './observatory-panels.css';

/** Utilities retain the existing notebook schema; course navigation uses the shared catalogue. */
export function createObservatoryPanels({ panels, catalog, username, onLocate, onOpenCategory, getIntensity, setIntensity }) {
  const key = notebookKey(username);
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(text, listener, signal, quiet = false) {
    const node = element('button', 'panel-action' + (quiet ? ' panel-action--quiet' : ''), text);
    node.type = 'button'; node.addEventListener('click', listener, { signal }); return node;
  }
  function storageState() {
    let storage;
    try { storage = localStorage; } catch { storage = null; }
    return { storage, ...readNotebook(storage, key) };
  }
  function targetName(id) { return TARGETS.find(target => target.id === id).name; }

  function showJournal() {
    panels.showUtility('观测日志', (content, signal) => {
      const state = storageState();
      content.append(element('p', 'utility-intro', '把此刻的星光，和刚刚想到的事一起留下。'));
      if (state.issue) { content.append(element('p', 'course-empty', state.issue)); return; }
      const form = element('form', 'journal-form');
      const label = element('label', '', '观测星域'); label.htmlFor = 'journal-target';
      const select = element('select'); select.id = 'journal-target';
      for (const target of TARGETS) {
        const option = element('option', '', target.name); option.value = target.id; select.append(option);
      }
      const textLabel = element('label', '', '记录此刻'); textLabel.htmlFor = 'journal-note';
      const input = element('textarea'); input.id = 'journal-note'; input.maxLength = 1000; input.rows = 4;
      input.placeholder = '今晚看见了什么？或是一次学习中的灵感……'; input.required = true;
      const submit = element('button', 'panel-action panel-action--primary', '保存日志'); submit.type = 'submit';
      const feedback = element('p', 'utility-feedback'); feedback.setAttribute('role', 'status');
      const records = element('div', 'journal-records');
      function renderRecords() {
        records.replaceChildren();
        if (!state.notebook.notes.length) records.append(element('p', 'course-empty', '还没有日志，从今晚开始。'));
        for (const note of state.notebook.notes) {
          const row = element('article', 'local-entry');
          const heading = element('div', 'utility-row');
          const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.createdAt));
          heading.append(element('span', '', targetName(note.targetId) + ' · ' + date));
          heading.append(action('删除', () => {
            const next = { ...state.notebook, notes: state.notebook.notes.filter(item => item.id !== note.id) };
            try { writeNotebook(state.storage, key, next); state.notebook = next; renderRecords(); feedback.textContent = '日志已删除。'; }
            catch { feedback.textContent = '保存失败，原来的记录仍然保留。'; }
          }, signal, true));
          row.append(heading, element('p', '', note.text)); records.append(row);
        }
      }
      form.append(label, select, textLabel, input, submit, feedback);
      form.addEventListener('submit', event => {
        event.preventDefault();
        let next;
        try { next = addNote(state.notebook, input.value, select.value); }
        catch (error) { feedback.textContent = error.message; input.focus(); return; }
        try {
          writeNotebook(state.storage, key, next); state.notebook = next;
          input.value = ''; feedback.textContent = '已保存到这台设备。'; renderRecords();
        } catch { feedback.textContent = '暂时无法保存，请保留输入内容后重试。'; }
      }, { signal });
      content.append(form, records); renderRecords();
    });
  }

  function showFavorites() {
    panels.showUtility('灵感收藏', (content, signal) => {
      const state = storageState();
      content.append(element('p', 'utility-intro', '收下喜欢的星域，把一次停留留给未来的自己。'));
      if (state.issue) { content.append(element('p', 'course-empty', state.issue)); return; }
      const feedback = element('p', 'utility-feedback'); feedback.setAttribute('role', 'status');
      const list = element('div', 'utility-list');
      for (const target of TARGETS) {
        const card = element('article', 'local-entry');
        const row = element('div', 'utility-row');
        const button = action('', () => {
          const next = toggleFavorite(state.notebook, target.id);
          try {
            writeNotebook(state.storage, key, next); state.notebook = next; reflect();
            feedback.textContent = state.notebook.favorites.includes(target.id) ? '已收藏' + target.name : '已取消收藏' + target.name;
          } catch { feedback.textContent = '暂时无法保存收藏，原有记录未被修改。'; }
        }, signal);
        function reflect() {
          const active = state.notebook.favorites.includes(target.id);
          button.textContent = active ? '已收藏 · 取消' : '收藏星域'; button.setAttribute('aria-pressed', String(active));
          button.setAttribute('aria-label', (active ? '取消收藏' : '收藏') + target.name);
        }
        row.append(element('h3', '', target.name), button); card.append(row, element('p', '', target.description));
        reflect(); list.append(card);
      }
      content.append(list, feedback);
    });
  }

  function showExplore() {
    panels.showUtility('星际探索', (content, signal) => {
      content.append(element('p', 'utility-intro', '海岸留在身边，星空由你探索。'));
      const instructions = element('ul', 'explore-instructions');
      for (const text of ['拖动上方星空，沿星光寻找新的学习星系。', '向同一方向持续拖动，会绕回出发的星域。', '滚轮或双指缩放；悬停星云，等待周围的星点回应。', '点击望远镜，可以直接查看全部课程目录。']) instructions.append(element('li', '', text));
      const paths = element('div', 'utility-actions');
      for (const category of catalog) paths.append(action('前往' + category.title, () => { panels.close(); onLocate(category.id); }, signal));
      content.append(instructions, paths);
    });
  }

  function showLibrary() {
    panels.showUtility('知识星库', (content, signal) => {
      content.append(element('p', 'utility-intro', '从一个问题出发，找到下一段学习方向。'));
      content.append(element('p', 'course-preview-label', '127 项实验与活动 · 按学科浏览'));
      for (const category of catalog) {
        const card = element('article', 'local-entry');
        card.append(element('h3', '', category.title));
        for (const topic of category.topics) card.append(element('p', '', topic.title + ' · ' + topic.summary));
        card.append(action('查看学习目标', () => onOpenCategory(category.id), signal)); content.append(card);
      }
    });
  }

  function showStudio() {
    panels.showUtility('创作工坊', (content, signal) => {
      content.append(element('p', 'utility-intro', '调整星光的呼吸，选择自己喜欢的夜晚。'));
      const label = element('label', 'utility-row', '星光与光丝强度'); label.htmlFor = 'starlight-intensity';
      const output = element('output'); output.htmlFor = 'starlight-intensity';
      const slider = element('input', 'starlight-slider'); slider.id = 'starlight-intensity'; slider.type = 'range';
      slider.min = '.35'; slider.max = '1.6'; slider.step = '.05'; slider.value = String(getIntensity());
      function reflect() { output.value = Math.round(Number(slider.value) * 100) + '%'; }
      slider.addEventListener('input', () => { setIntensity(Number(slider.value)); reflect(); }, { signal });
      label.append(output); reflect(); content.append(label, slider);
      content.append(element('p', 'utility-intro', '切换星系，体验冰蓝轨迹、青色星流、粉紫光雾与浅金脉冲。'));
      const paths = element('div', 'utility-actions');
      for (const category of catalog) paths.append(action('体验' + category.title, () => { panels.close(); onLocate(category.id); }, signal));
      content.append(paths);
    });
  }

  return { showJournal, showFavorites, showExplore, showLibrary, showStudio };
}

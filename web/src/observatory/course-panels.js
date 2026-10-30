import { appendLabActivities } from './lab-activities.js';
import { experimentHref } from './lab-catalog.js';
/** @typedef {(typeof import('./courses.js').COURSE_GALAXIES)[number]} CourseGalaxy */

const normalizeSearch = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

/** Select original catalogue records without copying or changing the authoritative course data. */
export function selectCatalogResults(catalog, query = '') {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return catalog.flatMap(category => {
    const categoryText = normalizeSearch(`${category.title} ${category.subtitle}`);
    const categoryMatches = terms.every(term => categoryText.includes(term));
    const topics = categoryMatches ? category.topics : category.topics.filter(topic => {
      const activityText=(topic.activities||[]).map(item=>`${item.title} ${item.summary}`).join(' ');
      const topicText = normalizeSearch(`${categoryText} ${topic.title} ${topic.summary} ${activityText}`);
      return terms.every(term => topicText.includes(term));
    });
    return categoryMatches || topics.length ? [{ category, topics }] : [];
  });
}

const iconPaths = {
  arrow: ['M4 12h15m-5-5 5 5-5 5'],
  back: ['M19 12H4m5-5-5 5 5 5'],
  locate: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', 'M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z'],
  search: ['M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm16 16 5 5'],
  journal: ['M5 3h11l4 4v14H5V3Z', 'M15 3v5h5M9 12h7M9 16h7'],
  favorite: ['m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9L12 3Z'],
};

/**
 * @param {{dialog: HTMLDialogElement, catalog: readonly CourseGalaxy[],
 * onLocate: (id: string) => void, onOpenCategory?: (id: string) => void,
 * onProfileAction: (action: 'journal'|'favorites'|'signout') => void,
 * onClose?: () => void}} options
 */
export function createCoursePanels({ dialog, catalog, onLocate, onOpenCategory = null, onProfileAction, onClose = () => {} }) {
  if (!dialog || typeof dialog.showModal !== 'function') throw new TypeError('课程面板需要一个原生 dialog 元素。');
  if (!Array.isArray(catalog)) throw new TypeError('课程目录必须使用课程数据数组。');
  if (typeof onLocate !== 'function' || typeof onProfileAction !== 'function') throw new TypeError('课程面板需要定位与个人中心操作回调。');
  const document = dialog.ownerDocument;
  const view = document.defaultView;
  const title = dialog.querySelector('#dialog-title');
  const content = dialog.querySelector('#dialog-content');
  const closeButton = dialog.querySelector('#dialog-close');
  if (!title || !content || !closeButton) throw new Error('课程面板缺少标题、内容或关闭按钮。');
  const events = new AbortController();
  let viewEvents = new AbortController();
  let opener = null, active = false, disposed = false, outsidePointer = false, catalogQuery = '';
  const selectedTopics = new Map();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
    for (const pathData of iconPaths[name]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData); svg.append(path);
    }
    return svg;
  }

  function button(label, action, { categoryId, primary = false, quiet = false, glyph } = {}) {
    const result = element('button', `panel-action${primary ? ' panel-action--primary' : ''}${quiet ? ' panel-action--quiet' : ''}`);
    result.type = 'button'; result.dataset.action = action;
    if (categoryId !== undefined) result.dataset.categoryId = categoryId;
    if (glyph && glyph !== 'arrow') result.append(icon(glyph));
    result.append(element('span', '', label));
    if (glyph === 'arrow') result.append(icon(glyph));
    return result;
  }

  function colorize(node, color) {
    const cssColor = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
    node.style.setProperty('--sector-color', cssColor);
  }

  function beginView(heading) {
    if (disposed) throw new Error('课程面板已经释放。');
    viewEvents.abort(); viewEvents = new AbortController();
    title.textContent = heading; content.replaceChildren();
    dialog.querySelector('.course-dialog-scroll').scrollTop = 0;
  }

  function present() {
    if (!dialog.open) {
      opener = document.activeElement;
      active = true;
      dialog.showModal();
    } else active = true;
    title.focus({ preventScroll: true });
  }

  function canRestore(node) {
    if (!node?.isConnected || node.disabled || node.closest('[hidden],[inert]') || dialog.contains(node)) return false;
    if (!node.matches('button,a[href],input,textarea,select,[tabindex]')) return false;
    const rect = node.getBoundingClientRect();
    const style = view.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function finishClose() {
    if (!active || dialog.open) return;
    active = false;
    viewEvents.abort();
    const target = canRestore(opener) ? opener : document.querySelector('#catalog-toggle');
    opener = null;
    if (canRestore(target)) target.focus({ preventScroll: true });
    onClose();
  }

  function close() {
    if (!active && !dialog.open) return;
    if (dialog.open) dialog.close();
    finishClose();
  }

  function locate(categoryId) {
    close();
    onLocate(categoryId);
  }

  function displayCatalog() {
    beginView('课程目录');
    const toolbar = element('div', 'catalog-toolbar');
    const searchField = element('div');
    const label = element('label', 'catalog-search-label', '搜索星系或学习方向');
    label.htmlFor = 'course-search';
    const searchWrap = element('div', 'catalog-search-wrap');
    const search = element('input', 'catalog-search');
    search.id = 'course-search'; search.type = 'search'; search.autocomplete = 'off'; search.spellcheck = false;
    search.placeholder = '输入名称或关键词'; search.value = catalogQuery;
    search.setAttribute('aria-controls', 'catalog-results');
    searchWrap.append(icon('search'), search); searchField.append(label, searchWrap);
    const count = element('p', 'catalog-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
    toolbar.append(searchField, count);
    const results = element('div', 'catalog-results'); results.id = 'catalog-results';
    const footer = element('div', 'catalog-footer');
    footer.append(element('span', 'course-preview-label', '127 项实验与活动 · AI 智境为课程预览'));
    content.append(toolbar, results, footer);

    function renderResults() {
      const matches = selectCatalogResults(catalog, catalogQuery);
      const topicCount = matches.reduce((total, match) => total + match.topics.length, 0);
      count.textContent = `${matches.length} 个星系 · ${topicCount} 个学习方向`;
      results.replaceChildren();
      if (!matches.length) {
        const empty = element('div', 'course-empty');
        empty.append(element('strong', '', '没有找到相关课程'), element('p', '', '试试其他星系名称或学习方向。'), button('清除筛选', 'clear-search', { quiet: true }));
        results.append(empty);
        return;
      }
      for (const { category, topics } of matches) {
        const row = element('article', 'catalog-sector');
        row.dataset.categoryId = category.id; colorize(row, category.color);
        const mark = element('span', 'catalog-sector-mark'); mark.setAttribute('aria-hidden', 'true'); mark.append(element('i'));
        const summary = element('div', 'catalog-sector-content');
        summary.append(element('h3', '', category.title), element('p', 'catalog-sector-subtitle', category.subtitle), element('p', 'catalog-topic-list', topics.map(topic => topic.title).join(' · ')));
        const actions = element('div', 'catalog-actions');
        const locateButton = button('定位星系', 'locate', { categoryId: category.id, glyph: 'locate' });
        const openButton = button('查看课程', 'open-category', { categoryId: category.id, primary: true, glyph: 'arrow' });
        locateButton.setAttribute('aria-label', `定位${category.title}`); openButton.setAttribute('aria-label', `查看${category.title}课程`);
        actions.append(locateButton, openButton); row.append(mark, summary, actions);
        if(catalogQuery.trim()){
          const hits=topics.flatMap(topic=>topic.activities||[]).filter(item=>{
            const text=normalizeSearch(`${category.title} ${item.title} ${item.summary}`);
            return normalizeSearch(catalogQuery).split(/\s+/).every(term=>text.includes(term));
          });
          if(hits.length){
            const hitList=element('div','catalog-activity-hits');
            for(const item of hits){const link=element('a','lab-activity-link');link.href=experimentHref(item.key);link.dataset.labKey=item.key;
              link.append(element('strong','',item.title),element('span','lab-enter','进入实验 →'));hitList.append(link);}
            row.append(hitList);
          }
        }
        results.append(row);
      }
    }

    search.addEventListener('input', () => { catalogQuery = search.value; renderResults(); }, { signal: viewEvents.signal });
    results.addEventListener('click', event => {
      const action = event.target.closest('button[data-action]');
      if (!action || !results.contains(action)) return;
      if (action.dataset.action === 'clear-search') { catalogQuery = ''; search.value = ''; renderResults(); search.focus(); }
      if (action.dataset.action === 'locate') locate(action.dataset.categoryId);
      if (action.dataset.action === 'open-category') { const id = action.dataset.categoryId; if(onOpenCategory){close();onOpenCategory(id);}else showCategory(id); }
    }, { signal: viewEvents.signal });
    renderResults(); present();
  }

  function showCatalog() { catalogQuery = ''; displayCatalog(); }

  function showCategory(categoryId, { topicId = null, onBack = null, onTopicChange = () => {} } = {}) {
    const category = catalog.find(item => item.id === categoryId);
    if (!category) throw new RangeError(`未知课程星系：${categoryId}`);
    beginView(category.title);
    const topline = element('div', 'course-topline');
    const back = button(onBack ? '返回课程星图' : '全部课程', 'back', { quiet: true, glyph: 'back' });
    const locateButton = button('定位星系', 'locate', { categoryId, glyph: 'locate' });
    const hasExperiments=category.topics.some(topic=>topic.activities?.length);
    topline.append(back, element('span', 'course-preview-label', hasExperiments?'实验目录 · 自主探索':'课程结构预览'), locateButton);
    const overview = element('section', 'category-overview'); colorize(overview, category.color);
    overview.append(element('h3', '', category.subtitle), element('p', '', category.description));
    const tabs = element('div', 'topic-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', `${category.title}的学习方向`);
    const details = element('section', 'topic-detail'); details.id = 'course-topic-detail'; details.tabIndex = 0; details.setAttribute('role', 'tabpanel');
    const tabButtons = category.topics.map(topic => {
      const tab = element('button', 'topic-tab', topic.title); tab.type = 'button'; tab.dataset.topicId = topic.id;
      tab.id = `course-topic-${category.id}-${topic.id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', details.id);
      tabs.append(tab); return tab;
    });
    let selected = category.topics.findIndex(topic => topic.id === (topicId || selectedTopics.get(categoryId)));
    if (selected < 0) selected = 0;

    function selectTopic(index, focus = false) {
      selected = index;
      const topic = category.topics[index]; selectedTopics.set(categoryId, topic.id);
      tabButtons.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
      details.setAttribute('aria-labelledby', tabButtons[index].id);
      details.replaceChildren(element('h3', '', topic.title), element('p', 'topic-summary', topic.summary));
      if(topic.activities?.length)appendLabActivities(details,topic);
      else{
        const objectives = element('ol', 'topic-objectives');
        for (const objective of topic.objectives) objectives.append(element('li', '', objective));
        details.append(element('h4', '', '学习目标'), objectives);
      }
      if (focus) tabButtons[index].focus({ preventScroll: true });
      onTopicChange(topic.id);
    }

    back.addEventListener('click', () => { if (onBack) { close(); onBack(); } else displayCatalog(); }, { signal: viewEvents.signal });
    locateButton.addEventListener('click', () => locate(categoryId), { signal: viewEvents.signal });
    tabs.addEventListener('click', event => {
      const tab = event.target.closest('button[data-topic-id]');
      if (!tab || !tabs.contains(tab)) return;
      selectTopic(tabButtons.indexOf(tab));
    }, { signal: viewEvents.signal });
    tabs.addEventListener('keydown', event => {
      let index = selected;
      if (event.key === 'ArrowRight') index = (selected + 1) % tabButtons.length;
      else if (event.key === 'ArrowLeft') index = (selected + tabButtons.length - 1) % tabButtons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabButtons.length - 1;
      else return;
      event.preventDefault(); selectTopic(index, true);
    }, { signal: viewEvents.signal });
    content.append(topline, overview, tabs, details); selectTopic(selected); present();
  }

  function showProfile(session = null) {
    beginView('个人中心');
    const username = typeof session?.username === 'string' && session.username.trim() ? session.username.trim() : '旅人';
    const identity = element('div', 'profile-identity');
    const monogram = element('span', 'profile-monogram', [...username][0].toLocaleUpperCase()); monogram.setAttribute('aria-hidden', 'true');
    const identityText = element('div');
    identityText.append(element('h3', '', username), element('p', '', session ? '本地演示会话' : '访客模式')); identity.append(monogram, identityText);
    const links = element('div', 'profile-links');
    for (const item of [
      { action: 'journal', title: '观测日志', description: '记录与回看自己的想法。', glyph: 'journal' },
      { action: 'favorites', title: '灵感收藏', description: '继续查看已保存的星域。', glyph: 'favorite' },
    ]) {
      const link = element('button', 'profile-link'); link.type = 'button'; link.dataset.profileAction = item.action;
      const copy = element('span'); copy.append(element('strong', '', item.title), element('small', '', item.description));
      link.append(icon(item.glyph), copy, icon('arrow')); links.append(link);
    }
    const footer = element('div', 'profile-footer');
    footer.append(element('p', '', '查看这台设备上的日志与收藏。'));
    if (session) {
      const signout = button('退出当前演示', 'signout', { quiet: true });
      signout.dataset.profileAction = 'signout'; footer.append(signout);
    } else {
      const signin = element('a', 'panel-action panel-action--quiet', '进入登录'); signin.href = './login.html'; footer.append(signin);
    }
    content.append(identity, links, footer);
    content.addEventListener('click', event => {
      const action = event.target.closest('button[data-profile-action]');
      if (!action || !content.contains(action)) return;
      const name = action.dataset.profileAction;
      if (name === 'journal' || name === 'favorites' || name === 'signout') onProfileAction(name);
    }, { signal: viewEvents.signal });
    present();
  }

  function showUtility(heading, render) {
    beginView(heading);
    render(content, viewEvents.signal);
    present();
  }

  closeButton.addEventListener('click', close, { signal: events.signal });
  dialog.addEventListener('close', finishClose, { signal: events.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: events.signal });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }, { signal: events.signal });
  dialog.addEventListener('wheel', event => event.stopPropagation(), { passive: true, signal: events.signal });
  dialog.addEventListener('pointerdown', event => {
    event.stopPropagation();
    const rect = dialog.getBoundingClientRect();
    outsidePointer = event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }, { signal: events.signal });
  dialog.addEventListener('click', event => {
    event.stopPropagation();
    const rect = dialog.getBoundingClientRect();
    if (outsidePointer && event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
    outsidePointer = false;
  }, { signal: events.signal });

  return Object.freeze({
    showCatalog, showCategory, showProfile, showUtility, close,
    dispose() {
      if (disposed) return;
      disposed = true; active = false; opener = null;
      viewEvents.abort(); events.abort();
      if (dialog.open) dialog.close();
    },
  });
}

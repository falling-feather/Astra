import { NAVIGATION, layoutNavigation, navigationLines, initialNavigation, transitionNavigation } from './navigation.js';
import { seededRandom } from './motion.js';

const iconShapes = {
  planet: [['circle', {cx:16,cy:16,r:9}], ['ellipse', {cx:16,cy:16,rx:17,ry:5,transform:'rotate(-35 16 16)'}]],
  orbit: [['circle', {cx:16,cy:16,r:9}], ['path', {d:'M22 7c4-3 7-3 8-1 3 4-4 12-13 18S1 29 2 25c0-2 2-5 6-8'}]],
  journal: [['path', {d:'M7 2h13l7 7v22H7zM20 2v8h7M11 16h11M11 21h11M11 26h8'}]],
  book: [['path', {d:'M2 5c5-2 10-1 14 2 4-3 9-4 14-2v23c-5-2-10-1-14 2-4-3-9-4-14-2zM16 7v23'}]],
  pen: [['path', {d:'m5 22 16-17 6 6-16 17-8 3zM18 8l6 6M5 22l6 6M21 5l3-3c1-1 2-1 3 0l3 3c1 1 1 2 0 3l-3 3'}]],
  heart: [['path', {d:'M16 29C9 24 2 18 2 11 2 3 12 1 16 9c4-8 14-6 14 2 0 7-7 13-14 18z'}]],
  person: [['circle', {cx:16,cy:8,r:6}], ['path', {d:'M4 31v-4a12 12 0 0 1 24 0v4'}]],
};

/** Scene playback and background inert states belong to the caller; menu transitions are independent. */
export function createBigDipperMenu({ onSelect, onOpenChange = () => {} }) {
  if (typeof onSelect !== 'function') throw new TypeError('七星导航需要实际功能选择回调。');
  const toggleButton = document.querySelector('#star-toggle');
  const menu = document.querySelector('#big-dipper-menu');
  const lines = document.querySelector('#big-dipper-lines');
  const items = document.querySelector('#big-dipper-items');
  const shade = menu?.querySelector('.big-dipper-shade');
  if (!toggleButton || !menu || !lines || !items || !shade) throw new Error('七星导航缺少所需界面节点。');
  const events = new AbortController();
  const { signal } = events;
  let state = initialNavigation(), opener = null, disposed = false;
  const buttons = [], visuals = [], lineNodes = [];

  function node(tag, className) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    return result;
  }
  function svg(tag, attributes = {}) {
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value));
    return result;
  }
  function gradient(id, stops) {
    const result = svg('linearGradient', { id });
    for (const [offset, color, opacity] of stops) result.append(svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    return result;
  }

  const defs = svg('defs');
  defs.append(
    gradient('dipper-band-blue', [[0,'#102d55',.65],[.65,'#31507b',.33],[1,'#a2c7ff',.05]]),
    gradient('dipper-band-gold', [[0,'#223149',.76],[.7,'#55657d',.35],[1,'#ddc49b',.08]]),
    gradient('dipper-band-alpha', [[0,'white',1],[.62,'white',1],[1,'black',1]]),
  );
  const mask = svg('mask', { id:'dipper-band-mask', maskContentUnits:'objectBoundingBox' });
  mask.append(svg('rect', {width:1,height:1,fill:'url(#dipper-band-alpha)'})); defs.append(mask); lines.append(defs);

  NAVIGATION.forEach(item => {
    const button = node('button', 'dipper-item'); button.type = 'button'; button.dataset.view = item.id;
    const band = svg('svg', {class:'dipper-band','aria-hidden':'true'});
    const fill = svg('path', {class:'dipper-band-fill'}), edge = svg('path', {class:'dipper-band-edge'}), dust = svg('g', {class:'dipper-band-dust'});
    const group = svg('g', {mask:'url(#dipper-band-mask)'}); group.append(fill, dust); band.append(group, edge);
    const icon = svg('svg', {class:'dipper-icon',viewBox:'0 0 34 34','aria-hidden':'true'});
    for (const [tag, attributes] of iconShapes[item.icon]) icon.append(svg(tag, attributes));
    const label = node('span', 'dipper-label'); label.textContent = item.label;
    const star = node('span', 'dipper-star'); star.setAttribute('aria-hidden','true'); star.append(node('i'));
    button.append(band, icon, label, star); items.append(button);
    buttons.push(button); visuals.push({ band, fill, edge, dust, label });
  });

  function resize() {
    if (disposed) return;
    const rows = layoutNavigation(window.innerWidth, window.innerHeight);
    lines.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    const links = navigationLines(rows);
    links.forEach((link, index) => {
      if (!lineNodes[index]) {
        lineNodes[index] = svg('line', {pathLength:1});
        lineNodes[index].style.setProperty('--index', index); lines.append(lineNodes[index]);
      }
      for (const key of ['x1','y1','x2','y2']) lineNodes[index].setAttribute(key, link[key]);
    });
    rows.forEach(row => {
      const button = buttons[row.index], visual = visuals[row.index];
      button.style.top = `${row.y-row.height/2}px`; button.style.width = `${row.x}px`; button.style.height = `${row.height}px`;
      button.style.setProperty('--index', row.index);
      visual.label.style.left = `${row.labelX}px`; visual.label.style.fontSize = `${row.fontSize}px`;
      visual.band.setAttribute('viewBox', `0 0 ${row.x} ${row.height}`);
      const path = `M0 1 C${row.x*.48} 1 ${row.x*.66} ${row.height*.035} ${row.x} ${row.height*.5} C${row.x*.7} ${row.height*.91} ${row.x*.45} ${row.height-1} 0 ${row.height-1}`;
      visual.fill.setAttribute('d', `${path}Z`); visual.edge.setAttribute('d', path);
      const random = seededRandom(210+row.index); visual.dust.replaceChildren();
      for (let i=0;i<40;i++) {
        const x=row.x*(.42+random()*.55), spread=row.height*.30*(1-x/row.x);
        visual.dust.append(svg('circle', {cx:x,cy:row.height*.5+(random()-.5)*spread*2.2,r:.3+random()*.8,opacity:.25+random()*.7}));
      }
    });
  }

  function reflect() {
    menu.classList.toggle('is-open', state.open); menu.inert = !state.open; menu.setAttribute('aria-hidden', String(!state.open));
    toggleButton.setAttribute('aria-expanded', String(state.open)); toggleButton.setAttribute('aria-label', state.open?'收起七星导航':'打开七星导航');
    for (const button of buttons) {
      if (button.dataset.view === state.active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  function focusable(element) {
    if (!element?.isConnected || element.disabled || element.closest('[inert],[hidden]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width>0 && rect.height>0 && rect.bottom>0 && rect.right>0 && rect.top<window.innerHeight && rect.left<window.innerWidth;
  }

  function open() {
    if (disposed || state.open) return;
    opener = document.activeElement;
    state = transitionNavigation(state, {type:'toggle'}); resize(); reflect();
    onOpenChange(true);
    if (state.open) (buttons.find(button => button.dataset.view === state.active) || buttons[0]).focus({preventScroll:true});
  }

  function close() {
    if (!state.open) return;
    state = transitionNavigation(state, {type:'close'}); reflect();
    onOpenChange(false);
    if (!disposed) (focusable(opener) && !menu.contains(opener) ? opener : toggleButton).focus({preventScroll:true});
    opener = null;
  }

  function toggle() { if (state.open) close(); else open(); }
  toggleButton.addEventListener('click', toggle, {signal});
  shade.addEventListener('click', close, {signal});
  items.addEventListener('click', event => {
    const button = event.target.closest('button[data-view]');
    if (!button || !items.contains(button)) return;
    const id = button.dataset.view;
    if (!NAVIGATION.some(item => item.id === id)) return;
    close(); state = transitionNavigation(state, {type:'select',id}); reflect(); onSelect(id);
  }, {signal});
  menu.addEventListener('pointerdown', event => event.stopPropagation(), {signal});
  menu.addEventListener('wheel', event => event.stopPropagation(), {passive:true,signal});
  document.addEventListener('keydown', event => {
    if (!state.open || document.querySelector('dialog[open]')) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const index = buttons.indexOf(document.activeElement);
    let destination = null;
    if (event.key==='ArrowDown' || event.key==='ArrowRight') destination = buttons[(index+1)%buttons.length];
    if (event.key==='ArrowUp' || event.key==='ArrowLeft') destination = buttons[(index<0?buttons.length-1:index+buttons.length-1)%buttons.length];
    if (event.key==='Home') destination = buttons[0];
    if (event.key==='End') destination = buttons.at(-1);
    if (event.key==='Tab') {
      const stops=[toggleButton,...buttons], active=stops.indexOf(document.activeElement);
      destination=stops[(active+(event.shiftKey?-1:1)+stops.length)%stops.length];
    }
    if (destination) { event.preventDefault(); destination.focus({preventScroll:true}); }
  }, {capture:true,signal});
  document.addEventListener('focusin', event => {
    if (state.open && !document.querySelector('dialog[open]') && event.target!==toggleButton && !menu.contains(event.target)) buttons[0].focus({preventScroll:true});
  }, {signal});
  window.addEventListener('resize', resize, {signal});
  resize(); reflect();

  return Object.freeze({open,close,toggle,get isOpen(){return state.open;},dispose(){
    if(disposed)return; disposed=true; close(); events.abort(); items.replaceChildren(); lines.replaceChildren();
  }});
}

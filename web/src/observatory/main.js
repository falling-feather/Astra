import { getSession, signOut } from '../shared/session.js';
import { createStarTrail } from '../shared/star-trail.js';
import { AnimationClock } from '../timeline.js';
import { COURSE_GALAXIES, PANORAMA_WORLD, findCourseGalaxy } from './courses.js';
import { PanoramaController, projectWorldPoint, wrapDelta } from './panorama-model.js';
import { createPanoramaScene } from './panorama-scene.js';
import { createObservatoryScene } from './scene.js';
import { createLayerState } from './layers.js';
import { coastalLayout } from './coastal-layout.js';
import { createCoastComposer, galaxyFocusPoint, presentationZoom, galaxyLabelLayout } from './desktop-composition.js';
import { createCoursePanels } from './course-panels.js';
import { createObservatoryPanels } from './observatory-panels.js';
import { createBigDipperMenu } from './big-dipper-menu.js';
import { createCourseAtlas } from './course-atlas.js';
import { experimentHref,findLabActivity } from './lab-catalog.js';
import './lab-activities.css';

const $ = selector => document.querySelector(selector);
const app = $('#observatory'), canvas = $('#panorama-canvas'), galaxyNavigation = $('#galaxy-navigation');
const coastCanvas = $('#coast-canvas'), telescopeHotspot = $('#telescope-hotspot');
const coastLayers = createLayerState();
const arrangeCoast = createCoastComposer(coastLayers);
arrangeCoast(innerWidth,innerHeight);
function skyViewportHeight() {
  return coastalLayout(innerWidth, innerHeight, coastLayers).sky.height;
}
const catalogToggle = $('#catalog-toggle'), pauseToggle = $('#pause-toggle'), dialog = $('#course-dialog');
const status = $('#panorama-status'), notice = $('#render-notice'), sectorNavigation = $('#sector-nav');
const session = getSession(), username = session?.username || '旅人';
$('#welcome-name').textContent = username;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const hashParams = new URLSearchParams(location.hash.slice(1));
const hashId = hashParams.get('galaxy');
const initialCategory = findCourseGalaxy(hashId) || COURSE_GALAXIES[0];
const savedView=history.state?.astraObservatory;
const restoredView=savedView?.galaxyId===initialCategory.id&&['x','y','zoom'].every(key=>Number.isFinite(savedView.camera?.[key]))?savedView:null;
const map = new PanoramaController({ world: PANORAMA_WORLD, initial: restoredView?.camera || { ...initialCategory.position, zoom: 1 } });
map.resize(innerWidth, skyViewportHeight());
const clock = new AnimationClock({ paused: reduced.matches });
clock.hidden = document.hidden;
const trail = createStarTrail({ paused: true });
const events = new AbortController(), { signal } = events;
const pointers = new Map(), entries = new Map(), sectors = new Map();
let scene = null, coast = null, frameId = 0, lastFrame = performance.now(), destroyed = false, suspended = false;
let renderStatus = 'loading', selectedId = initialCategory.id, hoveredId = null, interacted = Boolean(restoredView);
let drag = null, pinch = null, suppressClickUntil = 0, projectionKey = '';
let bigDipper = null, effectIntensity = 1;
let atlas = null, atlasReturnState = null;
const atlasSource = {x:0,y:0}, atlasVisual = {categoryId:null,progress:0};

function on(node, type, handler, options = {}) { node.addEventListener(type, handler, { ...options, signal }); }
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setStatus(message) { status.textContent = message; }
function useMap() { interacted = true; app.classList.add('has-interacted'); }
function categoryFocusPoint(category) {
  return galaxyFocusPoint(category,map.viewport);
}
if(!restoredView){map.camera.zoom=presentationZoom(initialCategory,map.viewport);map.constrain();map.focus(categoryFocusPoint(initialCategory), { animate: false });}

function updateHash(id,subject=null) {
  const params=new URLSearchParams({galaxy:id});if(subject)params.set('subject',subject);
  history.replaceState(history.state,'','#'+params);
}
function nearestCategory() {
  let nearest = COURSE_GALAXIES[0], distance = Infinity;
  for (const category of COURSE_GALAXIES) {
    const value = Math.hypot(wrapDelta(category.position.x - map.camera.x, PANORAMA_WORLD.width), (category.position.y - map.camera.y) * .55);
    if (value < distance) { distance = value; nearest = category; }
  }
  return nearest;
}

function updateEntries(force = false) {
  const key = [map.camera.x, map.camera.y, map.camera.zoom, map.viewport.width, map.viewport.height].join(',');
  if (force || key !== projectionKey) {
    projectionKey = key;
    for (const category of COURSE_GALAXIES) {
      const button = entries.get(category.id);
      const point = projectWorldPoint(category.position, map.camera, map.viewport, PANORAMA_WORLD);
      const {radius,labelOffset,visible,titleSize,summaryOffset,enterOffset,labelWidth} = galaxyLabelLayout(category,point,map.viewport);
      button.hidden = !visible;
      if (visible) {
        button.style.left = point.x + 'px'; button.style.top = point.y + 'px';
        button.style.width = Math.max(115, radius * 1.5) + 'px'; button.style.height = Math.max(100, radius * 1.5) + 'px';
        button.style.setProperty('--label-offset', labelOffset + 'px');
        button.style.setProperty('--entry-title-size',titleSize+'px');
        button.style.setProperty('--summary-offset',summaryOffset+'px');
        button.style.setProperty('--enter-offset',enterOffset+'px');
        button.style.setProperty('--label-width',labelWidth+'px');
      }
    }
    if (!map.flight && !dialog.open && !atlas?.active) selectedId = nearestCategory().id;
  }
  for (const category of COURSE_GALAXIES) {
    const selected = category.id === selectedId;
    entries.get(category.id).classList.toggle('is-focused', selected);
    entries.get(category.id).setAttribute('aria-current', String(selected));
    entries.get(category.id).setAttribute('aria-expanded', String(atlas?.active && atlas.categoryId === category.id));
    sectors.get(category.id).setAttribute('aria-pressed', String(selected));
  }
  $('#zoom-out').disabled = map.camera.zoom <= map.minZoom + .001;
  $('#zoom-in').disabled = map.camera.zoom >= map.maxZoom - .001;
}

function frame(now) {
  frameId = 0;
  if (destroyed || suspended || document.hidden) return;
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, .05)); lastFrame = now;
  clock.advance(dt); if (!atlas?.active) map.step(dt); updateEntries();
  if (atlas?.active) {
    projectWorldPoint(findCourseGalaxy(atlas.categoryId).position,map.camera,map.viewport,PANORAMA_WORLD,atlasSource);
    atlas.render(dt,clock.time,atlasSource);
  }
  atlasVisual.categoryId=atlas?.categoryId; atlasVisual.progress=atlas?.progress || 0;
  scene?.render({ time: clock.time, camera: map.camera, viewport: map.viewport, selectedId: hoveredId || selectedId, effectIntensity, atlas:atlasVisual });
  coast?.render(clock.time, scene?.getEnvironmentLight());
  if ((renderStatus === 'ready' && !clock.paused) || map.moving || atlas?.moving) requestFrame();
}
function requestFrame() {
  if (!destroyed && !suspended && !document.hidden && !frameId) frameId = requestAnimationFrame(frame);
}
function reflectPlayback() {
  const unavailable = renderStatus === 'unavailable';
  app.dataset.paused = String(clock.paused || document.hidden || suspended);
  app.dataset.renderStatus = renderStatus;
  pauseToggle.disabled = renderStatus !== 'ready';
  pauseToggle.setAttribute('aria-pressed', String(clock.paused));
  const label = unavailable ? '动态星空不可用' : clock.paused ? '播放动态效果' : '暂停动态效果';
  pauseToggle.setAttribute('aria-label', label); pauseToggle.title = label;
  trail.setPaused(clock.paused || document.hidden || suspended || renderStatus !== 'ready');
}
function pause() {
  if (renderStatus !== 'ready') return;
  clock.paused = !clock.paused;
  if (clock.paused) map.stop();
  lastFrame = performance.now(); reflectPlayback(); requestFrame();
}

function focusCategory(id, { animate = !clock.paused && !reduced.matches } = {}) {
  const category = findCourseGalaxy(id);
  if (!category) return;
  atlas?.close({animate:false,restoreFocus:false});
  useMap(); selectedId = id; hoveredId = null; updateHash(id);
  map.focus(categoryFocusPoint(category), { animate });
  updateEntries(true); requestFrame();
  setStatus('正在探索：' + category.title);
}
function reflectPanel(open) {
  if (open) bigDipper?.close();
  app.classList.toggle('has-panel', open);
  catalogToggle.setAttribute('aria-expanded', String(open));
  telescopeHotspot.setAttribute('aria-expanded', String(open));
}
const panels = createCoursePanels({
  dialog, catalog: COURSE_GALAXIES,
  onLocate: id => focusCategory(id),
  onOpenCategory: openCategory,
  onProfileAction: showProfileAction,
  onClose: () => { reflectPanel(false); lastFrame = performance.now(); requestFrame(); },
});
const utilityPanels = createObservatoryPanels({
  panels, catalog: COURSE_GALAXIES, username, onLocate: focusCategory, onOpenCategory: openCategory,
  getIntensity: () => effectIntensity,
  setIntensity: value => { effectIntensity = value; requestFrame(); },
});
atlas = createCourseAtlas({
  container:app,catalog:COURSE_GALAXIES,requestFrame,isReduced:()=>reduced.matches,
  onTopicSelected:(id,subject)=>updateHash(id,subject),
  onChange(active) {
    app.classList.toggle('is-atlas-open',active);galaxyNavigation.inert=active||Boolean(bigDipper?.isOpen);
    hoveredId=null;cancelGesture();map.stop();updateEntries(true);requestFrame();
  },
  onClosed(opener) {
    if(atlasReturnState){
      Object.assign(map.camera,atlasReturnState.camera);map.constrain();selectedId=atlasReturnState.selectedId;
      history.replaceState(null,'',location.pathname+location.search+atlasReturnState.hash);atlasReturnState=null;
      updateEntries(true);requestFrame();
    }
    if(opener?.isConnected&&!dialog.open&&!bigDipper?.isOpen&&!opener.closest('[inert],[hidden]'))opener.focus({preventScroll:true});
  },
  onReadTopic(id,topicId) {
    reflectPanel(true);
    panels.showCategory(id,{topicId,onBack:()=>requestFrame(),onTopicChange:next=>atlas.select(next)});
  },
});
bigDipper = createBigDipperMenu({
  onSelect(id) {
    if (id === 'overview') { openCatalog(); return; }
    if (id === 'profile') { openProfile(); return; }
    const actions = { explore: utilityPanels.showExplore, journal: utilityPanels.showJournal,
      library: utilityPanels.showLibrary, studio: utilityPanels.showStudio, favorites: utilityPanels.showFavorites };
    if (actions[id]) { reflectPanel(true); actions[id](); }
  },
  onOpenChange(open) {
    if(open)atlas.close({animate:false,restoreFocus:false});
    cancelGesture(); map.stop(); hoveredId = null;
    for (const node of [galaxyNavigation, telescopeHotspot, catalogToggle, sectorNavigation, $('.panorama-controls'), $('.panorama-header')]) node.inert = open;
    requestFrame();
  },
});
function openCatalog() {
  atlas?.close({animate:false,restoreFocus:false});
  map.stop(); hoveredId = null; reflectPanel(true); panels.showCatalog(); requestFrame();
}
function openCategory(id) {
  const category = findCourseGalaxy(id);
  if (!category) return;
  if(renderStatus==='unavailable'){reflectPanel(true);panels.showCategory(id);return;}
  bigDipper?.close();
  if(entries.get(id)?.hidden)focusCategory(id,{animate:false});
  if(!atlas.active){const returnParams=new URLSearchParams(location.hash.slice(1));returnParams.delete('subject');atlasReturnState={camera:{...map.camera},selectedId,hash:'#'+returnParams};}
  map.stop();hoveredId=null;selectedId=id;updateHash(id);
  atlas.open(id);updateEntries(true);requestFrame();
}
function openProfile() { atlas?.close({animate:false,restoreFocus:false});map.stop(); reflectPanel(true); panels.showProfile(session); }

function showProfileAction(action) {
  if (action === 'signout') { signOut(); location.assign('./login.html'); return; }
  if (action === 'journal') utilityPanels.showJournal();
  if (action === 'favorites') utilityPanels.showFavorites();
}

for (const category of COURSE_GALAXIES) {
  const entry = element('button', 'galaxy-entry');
  entry.type = 'button'; entry.dataset.categoryId = category.id; entry.setAttribute('aria-label', '查看' + category.title + '课程');
  entry.setAttribute('aria-expanded', 'false'); entry.setAttribute('aria-controls', 'course-atlas');
  entry.style.setProperty('--galaxy-color', category.color);
  entry.append(element('span', 'galaxy-entry__title', category.title));
  entry.append(element('span','galaxy-entry__summary',category.activityCount?`${category.topics.length} 个学科 · ${category.activityCount} 项实验`:`${category.topics.length} 个方向 · 课程预览`));
  const enter = element('span', 'galaxy-entry__enter', '查看课程');
  enter.innerHTML += '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.2"/></svg>';
  entry.append(enter); galaxyNavigation.append(entry); entries.set(category.id, entry);
  on(entry, 'click', () => openCategory(category.id));
  on(entry, 'pointerenter', () => { if (!drag?.active && !dialog.open) { hoveredId = category.id; requestFrame(); } });
  on(entry, 'pointerleave', () => { if (hoveredId === category.id) { hoveredId = null; requestFrame(); } });
  const sector = element('button', 'sector-button');
  sector.type = 'button'; sector.setAttribute('aria-label', '定位' + category.title); sector.style.setProperty('--sector-color', category.color);
  const dot = element('i', 'sector-dot'); dot.setAttribute('aria-hidden', 'true');
  const current = element('span', 'sector-current', '当前星系'); current.setAttribute('aria-hidden', 'true');
  sector.append(dot, element('span', '', category.title), current); sectorNavigation.append(sector); sectors.set(category.id, sector);
  on(sector, 'click', () => focusCategory(category.id));
}

function cancelGesture() {
  for (const id of pointers.keys()) if (app.hasPointerCapture(id)) app.releasePointerCapture(id);
  pointers.clear(); drag = null; pinch = null; map.endDrag(false); app.classList.remove('is-dragging');
}
function pointerDown(event) {
  if (dialog.open || atlas.active || bigDipper.isOpen || event.clientY > map.viewport.height || event.target.closest('[data-pan-block]') || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    map.stop();
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, time: event.timeStamp, active: false };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag = null; map.stop(); hoveredId = null; app.classList.add('is-dragging'); useMap();
    for (const id of pointers.keys()) app.setPointerCapture(id);
  }
}
function pointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const next = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    map.beginDrag(); map.dragBy(next.x - pinch.x, next.y - pinch.y, .016); map.endDrag(false);
    if (pinch.distance > 4) map.zoomAt(next.distance / pinch.distance, next);
    pinch = next; event.preventDefault(); updateEntries(true); requestFrame(); return;
  }
  if (!drag || drag.id !== event.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
    drag.active = true; map.beginDrag(); hoveredId = null; app.setPointerCapture(event.pointerId);
    app.classList.add('is-dragging'); useMap();
  }
  if (drag.active) {
    map.dragBy(event.clientX - drag.x, event.clientY - drag.y, (event.timeStamp - drag.time) / 1000);
    event.preventDefault(); updateEntries(true); requestFrame();
  }
  drag.x = event.clientX; drag.y = event.clientY; drag.time = event.timeStamp;
}
function pointerUp(event) {
  if (!pointers.has(event.pointerId)) return;
  const moved = Boolean(pinch || drag?.active);
  pointers.delete(event.pointerId);
  if (app.hasPointerCapture(event.pointerId)) app.releasePointerCapture(event.pointerId);
  if (moved) {
    suppressClickUntil = performance.now() + 120;
    map.endDrag(!clock.paused && !reduced.matches && !pinch);
    setStatus('当前星域：' + nearestCategory().title);
  }
  if (pointers.size === 1) {
    const [id, point] = pointers.entries().next().value;
    drag = { id, startX: point.x, startY: point.y, ...point, time: event.timeStamp, active: false }; pinch = null;
  } else { drag = null; pinch = null; app.classList.remove('is-dragging'); }
  requestFrame();
}
on(app, 'pointerdown', pointerDown);
on(window, 'pointermove', pointerMove, { passive: false });
on(window, 'pointerup', pointerUp);
on(window, 'pointercancel', () => { cancelGesture(); map.stop(); });
on(app, 'click', event => {
  if (event.detail > 0 && performance.now() < suppressClickUntil && !event.target.closest('[data-pan-block]')) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, { capture: true });
on(document,'click',event=>{
  const link=event.target.closest('a[data-lab-key]');
  if(!link||event.defaultPrevented||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const activity=findLabActivity(link.dataset.labKey);if(!activity)return;
  link.href=experimentHref(activity.key);
  history.replaceState({...history.state,astraObservatory:{camera:{...map.camera},galaxyId:activity.galaxyId,topicId:activity.topicId}},'',
    `#galaxy=${activity.galaxyId}&subject=${encodeURIComponent(activity.topicId)}`);
},{capture:true});
on(app, 'wheel', event => {
  if (dialog.open || atlas.active || bigDipper.isOpen || event.clientY > map.viewport.height || event.target.closest('[data-pan-block]')) return;
  event.preventDefault(); useMap();
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
  map.zoomAt(Math.exp(-Math.max(-240, Math.min(240, event.deltaY * multiplier)) * .0015), { x: event.clientX, y: event.clientY });
  updateEntries(true); requestFrame();
}, { passive: false });
on(document, 'keydown', event => {
  if(atlas.active&&!dialog.open&&!bigDipper.isOpen){
    if(event.key==='Escape'){event.preventDefault();if(atlas.topicId)atlas.select(null);else atlas.close();}
    return;
  }
  if (dialog.open || bigDipper.isOpen || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable],[data-pan-block]')) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); useMap(); map.beginDrag();
    const step = 100;
    map.dragBy(event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0, event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0, .1);
    map.endDrag(false); updateEntries(true); requestFrame();
  } else if (event.key === 'Home') { event.preventDefault(); focusCategory(COURSE_GALAXIES[0].id); }
  else if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); pause(); }
  else if (event.key === 'Escape') { map.stop(); cancelGesture(); }
});
on(catalogToggle, 'click', openCatalog);
on(telescopeHotspot, 'click', openCatalog);
on($('#welcome-button'), 'click', openProfile);
on(pauseToggle, 'click', pause);
on($('#reset-view'), 'click', () => {
  useMap(); map.camera.zoom = Math.max(map.minZoom, Math.min(presentationZoom(COURSE_GALAXIES[0],map.viewport), map.maxZoom)); map.constrain();
  focusCategory(COURSE_GALAXIES[0].id);
});
on($('#zoom-in'), 'click', () => { useMap(); map.zoomAt(1.2); updateEntries(true); requestFrame(); });
on($('#zoom-out'), 'click', () => { useMap(); map.zoomAt(1 / 1.2); updateEntries(true); requestFrame(); });

function resize() {
  arrangeCoast(innerWidth,innerHeight);
  const layout = coastalLayout(innerWidth, innerHeight, coastLayers), skyHeight = layout.sky.height;
  cancelGesture(); map.resize(innerWidth, skyHeight); scene?.resize(innerWidth, skyHeight); coast?.resize(innerWidth, innerHeight);
  atlas?.resize(innerWidth,innerHeight);
  canvas.style.height = skyHeight + 'px';
  app.style.setProperty('--sky-bottom', skyHeight + 'px');
  telescopeHotspot.style.left = layout.telescope.x + 'px'; telescopeHotspot.style.top = layout.telescope.y + 'px';
  telescopeHotspot.style.width = layout.telescope.width + 'px'; telescopeHotspot.style.height = layout.telescope.height + 'px';
  if (!interacted&&!atlas?.active) {map.camera.zoom=presentationZoom(initialCategory,map.viewport);map.constrain();map.focus(categoryFocusPoint(initialCategory), { animate: false });}
  updateEntries(true); requestFrame();
}
on(window, 'resize', resize);
on(window, 'blur', cancelGesture);
on(document, 'visibilitychange', () => {
  clock.hidden = document.hidden; lastFrame = performance.now(); reflectPlayback();
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; cancelGesture(); }
  else requestFrame();
});
on(reduced, 'change', event => {
  if (event.matches) { clock.paused = true; map.stop(); }
  lastFrame = performance.now(); reflectPlayback(); requestFrame();
});

function failure(error) {
  renderStatus = 'unavailable'; clock.paused = true; map.stop(); scene?.dispose(); coast?.dispose(); scene = null; coast = null;
  notice.textContent = '动态星空暂时无法显示。课程目录仍可使用，请刷新页面重试。';
  notice.classList.add('is-visible'); reflectPlayback();
  if (error) console.error('[Astra panorama]', error);
}
on(canvas, 'webglcontextlost', event => { event.preventDefault(); failure(); });
on(canvas, 'webglcontextrestored', () => location.reload());
on(coastCanvas, 'webglcontextlost', event => { event.preventDefault(); failure(); });
on(coastCanvas, 'webglcontextrestored', () => location.reload());
notice.textContent = '星空正在展开'; notice.classList.add('is-visible');
resize(); reflectPlayback();
Promise.allSettled([
  createPanoramaScene(canvas, { catalog: COURSE_GALAXIES, world: PANORAMA_WORLD }),
  createObservatoryScene(coastCanvas, { layers: coastLayers, foregroundOnly: true }),
]).then(results => {
  const error = results.find(result => result.status === 'rejected');
  if (destroyed || renderStatus === 'unavailable' || error) {
    results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
    if (error && !destroyed) failure(error.reason);
    return;
  }
  scene = results[0].value; coast = results[1].value; renderStatus = 'ready'; app.classList.add('is-ready');
  notice.textContent = ''; notice.classList.remove('is-visible'); reflectPlayback(); resize();
  const initialTopic=hashParams.get('subject');
  if(initialCategory.topics.some(topic=>topic.id===initialTopic)){openCategory(initialCategory.id);atlas.select(initialTopic);}
  setStatus('工科实验室、代码空间、未来星系、AI智境。拖动探索，或打开课程目录快速定位。');
}).catch(failure);

const diagnostics = Object.freeze({
  snapshot: () => ({ ...scene?.snapshot(), camera: { ...map.camera }, viewport: { ...map.viewport }, world: { ...PANORAMA_WORLD }, selectedId, playing: !clock.paused, time: clock.time,
    renderStatus, dragging: Boolean(drag?.active || pinch), moving: map.moving, dialogOpen: dialog.open, menuOpen: bigDipper.isOpen,
    catalogIds: COURSE_GALAXIES.map(category => category.id), atlas:atlas.snapshot(), coast: coast?.snapshot() }),
  focus: id => focusCategory(id),
  moveBy(dx, dy) { map.beginDrag(); map.dragBy(dx, dy, .1); map.endDrag(false); updateEntries(true); requestFrame(); },
});
window.__ASTRA_PANORAMA__ = diagnostics;
function dispose() {
  if (destroyed) return;
  destroyed = true; cancelAnimationFrame(frameId); cancelGesture(); events.abort(); scene?.dispose(); coast?.dispose(); panels.dispose(); atlas.dispose(); bigDipper.dispose(); trail.dispose();
  if (window.__ASTRA_PANORAMA__ === diagnostics) delete window.__ASTRA_PANORAMA__;
}
on(window, 'pagehide', event => {
  if (!event.persisted) dispose();
  else { suspended = true; cancelAnimationFrame(frameId); frameId = 0; cancelGesture(); reflectPlayback(); }
});
on(window, 'pageshow', event => {
  if (event.persisted) { suspended = false; clock.hidden = document.hidden; lastFrame = performance.now(); reflectPlayback(); resize(); }
});
if (import.meta.hot) import.meta.hot.dispose(dispose);

import { CourseAtlasMotion, atlasLayout, atlasNodePose, atlasCurve } from './course-atlas-model.js';
import './course-atlas.css';
import { appendLabActivities } from './lab-activities.js';

/** The readable controls stay fixed while the cloud, stars and surface plates unfold behind them. */
export function createCourseAtlas({container,catalog,onChange,onClosed,onReadTopic,onTopicSelected=()=>{},requestFrame,isReduced}){
  const motion=new CourseAtlasMotion(catalog),events=new AbortController();
  let viewEvents=new AbortController(),layout=null,opener=null,lastCategory=null,lastTopic=undefined,hovered=-1;
  let stars=[],buttons=[],paths=[],particles=[],disposed=false;
  const root=document.createElement('section');root.className='course-atlas';root.id='course-atlas';root.hidden=true;root.dataset.panBlock='';root.setAttribute('aria-labelledby','atlas-title');
  root.innerHTML='<div class="atlas-shade" aria-hidden="true"></div><div class="atlas-workbench"><div class="atlas-content"><svg class="atlas-field" aria-hidden="true"><defs><filter id="atlas-light"><feGaussianBlur stdDeviation="2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><radialGradient id="atlas-star-light"><stop offset="0" stop-color="#fff"/><stop offset=".12" stop-color="#e4f3ff"/><stop offset=".35" stop-color="currentColor" stop-opacity=".6"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><g class="atlas-branches"></g><g class="atlas-star-layer"></g></svg><header class="atlas-heading"><div><p class="atlas-eyebrow">课程星图</p><h2 id="atlas-title" tabindex="-1"></h2><p class="atlas-instruction"></p></div><button class="atlas-close" type="button">返回观星 <span aria-hidden="true">↗</span></button></header><div class="atlas-courses" role="group" aria-label="选择学习方向"></div><aside class="atlas-preview" aria-label="课程简介"></aside></div></div>';
  container.append(root);
  const workbench=root.querySelector('.atlas-workbench'),content=root.querySelector('.atlas-content'),field=root.querySelector('.atlas-field');
  const heading=root.querySelector('#atlas-title'),instructions=root.querySelector('.atlas-instruction'),list=root.querySelector('.atlas-courses'),preview=root.querySelector('.atlas-preview');
  const branchGroup=root.querySelector('.atlas-branches'),starGroup=root.querySelector('.atlas-star-layer');
  function element(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
  function svg(tag,attrs){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs||{}))node.setAttribute(key,String(value));return node;}
  function action(label,handler,cls=''){const button=element('button','atlas-action '+cls,label);button.type='button';button.addEventListener('click',handler);return button;}
  function buildCategory(){
    viewEvents.abort();viewEvents=new AbortController();lastCategory=motion.categoryId;lastTopic=undefined;hovered=-1;
    const category=motion.category;root.style.setProperty('--atlas-color',category.color);
    const activityCount=category.activityCount;
    heading.textContent=category.title;instructions.textContent=activityCount?`${category.topics.length} 个学科方向 · ${activityCount} 项实验与活动`:`${category.topics.length} 个学习方向 · 课程预览`;
    list.replaceChildren();branchGroup.replaceChildren();starGroup.replaceChildren();buttons=[];paths=[];stars=[];particles=[];
    category.topics.forEach((topic,index)=>{
      const button=element('button','atlas-course');button.type='button';button.dataset.topicId=topic.id;button.setAttribute('aria-label','预览'+topic.title);button.setAttribute('aria-pressed','false');
      const plate=element('span','atlas-course-plate');plate.setAttribute('aria-hidden','true');
      const number=element('span','atlas-course-number',String(index+1).padStart(2,'0'));
      const topicLabel=topic.activities?.length?`${topic.activities.length} 项实验 · 查看目录 →`:'预览课程 →';
      button.append(plate,number,element('strong','atlas-course-title',topic.title),element('span','atlas-course-action',topicLabel));
      button.addEventListener('click',event=>select(topic.id,event.detail>0),{signal:viewEvents.signal});
      button.addEventListener('pointerenter',()=>{hovered=index;requestFrame();},{signal:viewEvents.signal});
      button.addEventListener('pointerleave',()=>{hovered=-1;requestFrame();},{signal:viewEvents.signal});
      button.addEventListener('keydown',event=>{
        let target=index;if(event.key==='ArrowRight'||event.key==='ArrowDown')target=(index+1)%buttons.length;
        else if(event.key==='ArrowLeft'||event.key==='ArrowUp')target=(index+buttons.length-1)%buttons.length;
        else if(event.key==='Home')target=0;else if(event.key==='End')target=buttons.length-1;else return;
        event.preventDefault();event.stopPropagation();buttons[target].focus({preventScroll:true});buttons[target].scrollIntoView({block:'nearest',behavior:'instant'});
      },{signal:viewEvents.signal});
      list.append(button);buttons.push(button);
      const glow=svg('path',{class:'atlas-branch-glow',pathLength:1}),line=svg('path',{class:'atlas-branch',pathLength:1});branchGroup.append(glow,line);paths.push({glow,line});
      const star=svg('g',{class:'atlas-course-star'});
      star.append(svg('circle',{r:24,fill:'url(#atlas-star-light)'}),svg('circle',{r:17,class:'atlas-star-orbit'}),svg('path',{d:'M0-9 2-2 9 0 2 2 0 9-2 2-9 0-2-2Z',fill:'#eaf5ff'}));
      starGroup.append(star);stars.push(star);
      const dots=Array.from({length:4},()=>{const dot=svg('circle',{r:1.6,class:'atlas-path-spark'});branchGroup.append(dot);return dot;});particles.push(dots);
    });
    workbench.scrollTop=0;resize(innerWidth,innerHeight);updatePreview();
  }
  function updatePreview(){
    if(lastTopic===motion.topicId)return;lastTopic=motion.topicId;
    const category=motion.category,topic=category.topics.find(item=>item.id===motion.topicId);
    preview.replaceChildren();preview.classList.toggle('is-selected',Boolean(topic));
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.topicId===motion.topicId)));
    if(!topic){preview.append(element('p','atlas-preview-kicker','关于这个星系'),element('p','atlas-preview-copy',category.description));return;}
    const copy=element('div','atlas-preview-main');
    copy.append(element('p','atlas-preview-kicker',category.title+(topic.activities?.length?' / 实验目录':' / 课程预览')),element('h3','',topic.title),element('p','atlas-preview-copy',topic.summary));
    const goals=element('ol','atlas-objectives');
    for(const objective of topic.objectives)goals.append(element('li','',objective));
    if(topic.objectives.length)copy.append(goals);
    const footer=element('div','atlas-preview-footer');
    const readLabel=topic.activities?.length?'专注浏览目录 →':'专注阅读 →';
    const meta=topic.activities?.length?`${topic.activities.length} 项实验 · 点击名称进入`:`${topic.objectives.length} 项学习目标 · 课程结构预览`;
    footer.append(element('span','atlas-preview-meta',meta),action(readLabel,()=>onReadTopic(category.id,topic.id),'atlas-action-primary'));
    const back=action('返回课程星图',()=>{const index=buttons.findIndex(button=>button.dataset.topicId===motion.topicId);select(null);buttons[index]?.focus({preventScroll:true});},'atlas-action-quiet');
    preview.append(copy,footer,back);
    if(topic.activities?.length)appendLabActivities(preview,topic);
  }
  function open(id){
    if(disposed)return;
    if(!motion.active)opener=document.activeElement;
    motion.open(id,{animate:!isReduced()});root.hidden=false;root.inert=false;workbench.inert=false;
    if(lastCategory!==id)buildCategory();
    root.dataset.phase='open';onChange(true,id);heading.focus({preventScroll:true});requestFrame();
  }
  function finish(){root.hidden=true;root.inert=true;lastCategory=null;lastTopic=undefined;onChange(false,null);const previous=opener;opener=null;onClosed(previous);}
  function close({animate=!isReduced(),restoreFocus=true}={}){
    if(!motion.active)return;
    if(!restoreFocus)opener=null;
    motion.close({animate});root.dataset.phase='closing';workbench.inert=true;
    if(!motion.active)finish();else requestFrame();
  }
  function select(id,scroll=false){
    if(!motion.active||motion.closing)return;motion.select(id);onTopicSelected(motion.categoryId,id);updatePreview();requestFrame();
    if(id===null){workbench.scrollTo({top:0,behavior:isReduced()?'instant':'smooth'});return;}
    if(scroll&&layout.stacked)preview.scrollIntoView({block:'nearest',behavior:isReduced()?'instant':'smooth'});
  }
  function resize(width,height){
    if(!motion.active)return;
    layout=atlasLayout(width,height,motion.category.topics.length);
    const f=layout.frame;root.classList.toggle('is-stacked',layout.stacked);
    Object.assign(workbench.style,{left:f.x+'px',top:f.y+'px',width:f.width+'px',height:f.height+'px'});
    content.style.height=layout.contentHeight+'px';field.setAttribute('viewBox',`0 0 ${f.width} ${layout.contentHeight}`);
    buttons.forEach((button,index)=>{const box=layout.nodes[index].box;Object.assign(button.style,{left:box.x-f.x+'px',top:box.y-f.y+'px',width:box.width+'px',height:box.height+'px'});});
    Object.assign(preview.style,{left:'0px',top:layout.preview.y-f.y+'px',width:f.width+'px'});requestFrame();
  }
  const pose={},spark={};
  function syncContentHeight(){
    if(!layout||!motion.active)return;
    const height=Math.max(layout.contentHeight,layout.preview.y-layout.frame.y+preview.offsetHeight+24);
    content.style.height=height+'px';field.setAttribute('viewBox',`0 0 ${layout.frame.width} ${height}`);
  }
  const previewObserver=new ResizeObserver(syncContentHeight);previewObserver.observe(preview);
  function render(dt,time,origin){
    if(!motion.active)return;
    if(isReduced()&&motion.moving){if(motion.target)motion.open(motion.categoryId,{animate:false});else motion.close({animate:false});}
    motion.step(dt);if(!motion.active){finish();return;}
    workbench.inert=motion.closing;root.style.setProperty('--atlas-open',motion.progress);
    const f=layout.frame,source={x:origin.x,y:origin.y+workbench.scrollTop};
    layout.nodes.forEach((node,index)=>{
      const progress=Math.max(0,Math.min(1,(motion.progress-index*.06)/(1-index*.06)));
      atlasNodePose(source,node,progress,index,pose);
      const selected=motion.topicId===motion.category.topics[index].id;
      const scale=(1+pose.z/350)*(selected?1.35:hovered===index?1.16:1);
      stars[index].setAttribute('transform',`translate(${pose.x-f.x} ${pose.y-f.y}) scale(${scale})`);
      stars[index].setAttribute('opacity',pose.alpha);
      stars[index].classList.toggle('is-selected',selected);
      const curve=atlasCurve(source,node,index);
      const d=`M${source.x-f.x} ${source.y-f.y} C${curve.x1-f.x} ${curve.y1-f.y} ${curve.x2-f.x} ${curve.y2-f.y} ${node.x-f.x} ${node.y-f.y}`;
      for(const path of [paths[index].line,paths[index].glow]){path.setAttribute('d',d);path.style.strokeDashoffset=1-progress;}
      paths[index].line.style.opacity=selected?.85:.35;
      buttons[index].style.setProperty('--plate-progress',progress);
      buttons[index].style.setProperty('--plate-x',(source.x-node.x)*(1-progress)*.32+'px');
      buttons[index].style.setProperty('--plate-y',(source.y-node.y)*(1-progress)*.32+'px');
      particles[index].forEach((dot,j)=>{
        const phase=((time*.20+index*.27+j*.23)%1)*progress;
        atlasNodePose(source,node,phase,index,spark);dot.setAttribute('cx',spark.x-f.x);dot.setAttribute('cy',spark.y-f.y);
        dot.setAttribute('opacity',Math.sin(phase*Math.PI)*progress*(selected?.85:.5));
      });
    });
  }
  root.querySelector('.atlas-close').addEventListener('click',()=>close(),{signal:events.signal});
  workbench.addEventListener('scroll',()=>{workbench.classList.toggle('is-scrolled',workbench.scrollTop>12);requestFrame();},{passive:true,signal:events.signal});
  root.addEventListener('wheel',event=>event.stopPropagation(),{passive:true,signal:events.signal});
  return {
    open,close,select,resize,render,
    get active(){return motion.active;},get moving(){return motion.moving;},get categoryId(){return motion.categoryId;},
    get progress(){return motion.progress;},get topicId(){return motion.topicId;},
    snapshot:()=>({active:motion.active,categoryId:motion.categoryId,topicId:motion.topicId,progress:motion.progress,closing:motion.closing,layout}),
    dispose(){disposed=true;events.abort();viewEvents.abort();previewObserver.disconnect();root.remove();},
  };
}

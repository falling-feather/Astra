import type * as THREE from 'three';
import type { Course } from '../domain/models';
import { CourseWheel, visibleCourses } from '../domain/course-wheel';
import { CourseOrbitScene } from './course-orbit-scene';

interface Options {available:boolean;invalidate:()=>void;onSelect:(id:string)=>void}
interface LabelView {button:HTMLButtonElement;title:HTMLSpanElement;meta:HTMLSpanElement;key:string;position:string;hidden:boolean}

/** Small DOM/input adapter over a cyclic wheel and one Three.js projection. */
export class CourseOrbitView {
  private wheel:CourseWheel;
  private scene:CourseOrbitScene;
  private abort=new AbortController();
  private observer:ResizeObserver;
  private container:HTMLElement;
  private labels=new Map<number,LabelView>();
  private fallback:SVGSVGElement|null=null;
  private rect:DOMRect;
  private gesture:{id:number;x:number;y:number;moved:boolean}|null=null;
  private clickDeadline=0;
  private busy=false;
  private lastPhase='';
  private pendingSelection:string|null=null;

  constructor(private stage:HTMLElement,private courses:Course[],noise:THREE.Data3DTexture,private options:Options){
    this.wheel=new CourseWheel(courses.length);this.scene=new CourseOrbitScene(noise,courses,options.available);
    this.container=stage.querySelector<HTMLElement>('.galaxy-labels')!;
    this.rect=stage.getBoundingClientRect();
    if(!options.available){this.fallback=document.createElementNS('http://www.w3.org/2000/svg','svg');this.fallback.classList.add('orbit-fallback-curves');this.fallback.setAttribute('aria-hidden','true');stage.prepend(this.fallback);}
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(stage);
    const {signal}=this.abort;
    stage.closest('.view-enter')?.addEventListener('animationend',()=>this.resize(),{signal});
    stage.closest('.workspace')?.addEventListener('scroll',()=>this.resize(),{signal,passive:true});
    stage.addEventListener('click',event=>{if(performance.now()<this.clickDeadline){event.preventDefault();event.stopImmediatePropagation();}},{signal,capture:true});
    stage.addEventListener('pointerdown',event=>{
      if(courses.length<2||(event.target as Element).closest('button,a'))return;
      this.gesture={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};this.wheel.beginDrag();stage.setPointerCapture(event.pointerId);stage.classList.add('is-dragging');
    },{signal});
    stage.addEventListener('pointermove',event=>{
      if(!this.gesture||this.gesture.id!==event.pointerId)return;
      const dx=event.clientX-this.gesture.x,dy=event.clientY-this.gesture.y;
      this.gesture.moved ||= Math.hypot(dx,dy)>6;
      this.wheel.drag((-dx+dy*.62)/Math.max(180,this.rect.width*.22));this.options.invalidate();
    },{signal});
    const finish=(event:PointerEvent,cancel=false)=>{
      if(!this.gesture||this.gesture.id!==event.pointerId)return;
      if(this.gesture.moved)this.clickDeadline=performance.now()+350;
      this.gesture=null;this.wheel.endDrag(cancel);stage.classList.remove('is-dragging');
      if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);this.options.invalidate();
    };
    stage.addEventListener('pointerup',event=>finish(event),{signal});stage.addEventListener('pointercancel',event=>finish(event,true),{signal});
    stage.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();this.step(['ArrowRight','ArrowDown'].includes(event.key)?1:-1);}
    },{signal});
    let lastWheel=0;
    stage.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey)return;event.preventDefault();if(performance.now()-lastWheel<420)return;lastWheel=performance.now();this.step(Math.sign(event.deltaY||event.deltaX));},{signal,passive:false});
    this.stage.dataset.courseCount=String(courses.length);
    this.resize();
  }

  resize():void {this.rect=this.stage.getBoundingClientRect();if(this.rect.width>0)this.scene.resize(this.rect.width,this.rect.height);this.options.invalidate();}
  select(id:string,instant=false):void {const index=this.courses.findIndex(course=>course.id===id);if(index<0)return;this.wheel.select(index,instant);this.pendingSelection=null;if(instant)this.stage.dataset.selectedGalaxy=id;this.options.invalidate();}
  step(direction:number):void {this.wheel.step(direction);this.options.invalidate();}

  update(delta:number,time:number,yaw:number,pitch:number,ratio:number,reduced:boolean):void {
    const landed=this.wheel.update(delta,reduced||!this.options.available);
    if(landed!==null)this.pendingSelection=this.courses[landed]?.id||null;
    const layers=visibleCourses(this.wheel.position,this.courses.length);
    const projections=this.scene.update(layers,time,yaw,pitch,ratio);
    for(const [ordinal,label] of this.labels)if(!layers.some(layer=>layer.ordinal===ordinal)){label.button.remove();this.labels.delete(ordinal);}
    projections.forEach(projected=>{
      const course=this.courses[projected.index];let label=this.labels.get(projected.ordinal);
      if(!label){
        const button=document.createElement('button');button.className='galaxy-label';button.dataset.galaxy=course.id;
        button.innerHTML='<svg class="galaxy-leader" viewBox="0 0 56 30" aria-hidden="true"><path d="M0 29 24 12H53"/><circle cx="53" cy="12" r="1.5"/></svg><span class="galaxy-label-title"></span><span class="galaxy-label-meta"></span>';
        const title=button.querySelector<HTMLSpanElement>('.galaxy-label-title')!,meta=button.querySelector<HTMLSpanElement>('.galaxy-label-meta')!;
        title.textContent=course.title;button.setAttribute('aria-label',`选择${course.title}`);button.style.setProperty('--course-color',course.color);
        button.setAttribute('aria-hidden','false');this.container.append(button);label={button,title,meta,key:'',position:'',hidden:false};this.labels.set(projected.ordinal,label);
      }
      const hidden=!projected.labelVisible||projected.x<150||projected.x>this.rect.width+10||projected.y<20||projected.y>this.rect.height-66;
      if(label.hidden!==hidden){label.button.hidden=hidden;label.button.setAttribute('aria-hidden',String(hidden));label.button.tabIndex=hidden?-1:0;label.hidden=hidden;}
      const current=projected.index===this.wheel.index;
      const key=`${current}/${projected.x>this.rect.width-205}/${projected.slot>.55}`;
      if(key!==label.key){label.button.classList.toggle('is-selected',current);label.button.classList.toggle('is-right',projected.x>this.rect.width-205);label.button.classList.toggle('is-distant',projected.slot>.55);label.button.setAttribute('aria-pressed',String(current));label.meta.textContent=current?'':course.subject;label.key=key;}
      const position=`${projected.x.toFixed(1)},${projected.y.toFixed(1)},${projected.opacity.toFixed(2)}`;
      if(position!==label.position){label.button.style.transform=`translate3d(${projected.x.toFixed(1)}px,${projected.y.toFixed(1)}px,0)`;label.button.style.opacity=String(Math.min(1,projected.opacity*1.55));label.button.dataset.anchor=`${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;label.button.dataset.trackSlot=projected.slot.toFixed(3);label.position=position;}
    });
    if(this.fallback){this.fallback.setAttribute('viewBox',`0 0 ${this.rect.width} ${this.rect.height}`);this.fallback.innerHTML=layers.map(layer=>`<path d="${this.scene.path(layer.slot)}" stroke="${this.courses[layer.index].color}" opacity="${Math.max(.04,layer.opacity*.65)}"/>`).join('');}
    const phase=this.wheel.position.toFixed(3);
    if(phase!==this.lastPhase){this.stage.dataset.wheelPosition=phase;this.lastPhase=phase;}
    const busy=this.wheel.dragging||Math.abs(this.wheel.target-this.wheel.position)>.002;
    if(busy!==this.busy){this.stage.setAttribute('aria-busy',String(busy));this.busy=busy;}
    if(this.pendingSelection){const id=this.pendingSelection;this.pendingSelection=null;this.stage.dataset.selectedGalaxy=id;this.options.onSelect(id);}
  }

  render(renderer:THREE.WebGLRenderer,canvasHeight:number):void {
    if(this.rect.width>0&&this.rect.height>0)this.scene.render(renderer,{x:this.rect.left,y:canvasHeight-this.rect.bottom,width:this.rect.width,height:this.rect.height});
  }
  dispose():void {this.abort.abort();this.observer.disconnect();this.scene.dispose();this.labels.forEach(label=>label.button.remove());this.labels.clear();this.fallback?.remove();}
}

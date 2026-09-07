import * as THREE from 'three';
import type { Course } from '../domain/models';
import { CourseOrbitView } from './course-orbit-view';
import { randomGenerator } from './galaxy-model';
import { starFragment, starVertex } from './shaders';
import { createNoiseVolume, VolumePass } from './volume-pass';

type Mode='welcome'|'login'|'ambient'|'courses';
interface Options { reducedMotion:boolean; onSelect:(id:string)=>void }

/** Owns one canvas and its lifecycle. Course identity and business state remain in the app. */
export class SpaceRenderer {
  readonly available:boolean;
  private renderer:THREE.WebGLRenderer|null=null;
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(43,1,.1,250);
  private field=new THREE.Group();
  private foreground=new THREE.Scene();
  private nebula:VolumePass;
  private starMaterial:THREE.ShaderMaterial;
  private foregroundMaterial:THREE.ShaderMaterial;
  private noise=createNoiseVolume();
  private orbit:CourseOrbitView|null=null;
  private abort=new AbortController();
  private mode:Mode='welcome';
  private reduced:boolean;
  private hidden=document.hidden;
  private lost=false;
  private disposed=false;
  private frame=0;
  private lastFrame=0;
  private lastRender=0;
  private time=0;
  private intro=false;
  private introElapsed=0;
  private introShifted=false;
  private width=innerWidth;
  private height=innerHeight;
  private ratio=1;
  private yaw=0;
  private pitch=0;
  private targetYaw=0;
  private targetPitch=0;
  private orbitYaw=0;
  private orbitPitch=0;
  private welcomeDrag:{id:number;x:number;y:number;yaw:number;pitch:number}|null=null;
  private ignoreClickUntil=0;
  private theme=0;
  private themeElapsed=0;
  private themeBlend=1;
  private courses:Course[]=[];
  private samples:number[]=[];
  private diagnostics:HTMLElement|null=null;

  constructor(private canvas:HTMLCanvasElement,private options:Options){
    this.reduced=options.reducedMotion;
    this.camera.position.z=32;
    this.nebula=new VolumePass(this.noise,'nebula');
    this.scene.add(this.field);
    this.starMaterial=this.makeStarfield();
    this.foregroundMaterial=this.makeStarfield(true);
    try{
      if(new URLSearchParams(location.search).get('graphics')==='basic')throw new Error('Static mode');
      this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure=1.08;this.renderer.setClearColor('#030711',1);this.renderer.autoClear=false;this.renderer.info.autoReset=false;
      this.available=true;document.documentElement.classList.remove('no-webgl');
    }catch{this.available=false;document.documentElement.classList.add('no-webgl');}
    const {signal}=this.abort;
    window.addEventListener('resize',()=>this.resize(),{signal});
    window.addEventListener('pointermove',event=>{
      if(this.reduced||this.mode==='ambient')return;
      if(this.welcomeDrag&&this.welcomeDrag.id===event.pointerId){this.orbitYaw=THREE.MathUtils.clamp(this.welcomeDrag.yaw+(event.clientX-this.welcomeDrag.x)*.0028,-.9,.9);this.orbitPitch=THREE.MathUtils.clamp(this.welcomeDrag.pitch+(event.clientY-this.welcomeDrag.y)*.002,-.65,.65);}
      this.targetYaw=(event.clientX/this.width-.5)*.4+this.orbitYaw;
      this.targetPitch=(event.clientY/this.height-.5)*.35+this.orbitPitch;
      document.documentElement.style.setProperty('--pointer-x',`${this.targetYaw*8}px`);
      document.documentElement.style.setProperty('--pointer-y',`${this.targetPitch*7}px`);
      this.invalidate();
    },{signal,passive:true});
    document.addEventListener('visibilitychange',()=>{this.hidden=document.hidden;if(this.hidden)this.stop();else{this.lastFrame=0;this.invalidate();}},{signal});
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;this.stop();document.documentElement.classList.add('no-webgl');},{signal});
    canvas.addEventListener('webglcontextrestored',()=>{this.lost=false;document.documentElement.classList.remove('no-webgl');this.resize();},{signal});
    if(new URLSearchParams(location.search).has('debug')){this.diagnostics=document.createElement('output');this.diagnostics.className='render-diagnostics';this.diagnostics.setAttribute('aria-label','图形性能');document.body.append(this.diagnostics);}
    this.resize();
  }

  private makeStarfield(near=false):THREE.ShaderMaterial {
    const count=near?1600:innerWidth<700?1400:3100,random=randomGenerator(near?837:762);
    const positions=new Float32Array(count*3),origins=new Float32Array(count*3),colors=new Float32Array(count*3),sizes=new Float32Array(count),phases=new Float32Array(count);
    for(let i=0;i<count;i++){
      const x=(random()-.5)*(near?60:160),y=(random()-.5)*(near?40:100),z=near?14+random()*8:-10-random()*120;
      positions.set([x,y,z],i*3);origins.set([x*2.4,y*2.4,z-55],i*3);
      colors.set(random()>.8?[1,.86,.69]:[.65,.81,1],i*3);
      sizes[i]=near?.3+Math.pow(random(),5)*2.2:random()>.985?3.5:.6+random()*1.0;phases[i]=random()*6.28;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aOrigin',new THREE.BufferAttribute(origins,3));geometry.setAttribute('aColor',new THREE.BufferAttribute(colors,3));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
    const material=new THREE.ShaderMaterial({vertexShader:starVertex,fragmentShader:starFragment,uniforms:{uTime:{value:0},uGather:{value:1},uPixelRatio:{value:1},uOpacity:{value:.32}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
    const stars=new THREE.Points(geometry,material);stars.frustumCulled=false;(near?this.foreground:this.field).add(stars);return material;
  }

  setCourses(courses:Course[]):void {this.courses=courses;}
  setMode(mode:Mode):void {
    if(mode!==this.mode){this.samples=[];this.lastRender=0;}
    this.mode=mode;this.canvas.dataset.renderMode=mode;this.targetYaw=0;this.targetPitch=0;this.orbitYaw=0;this.orbitPitch=0;this.welcomeDrag=null;
    this.syncNebulaControls();this.invalidate();
  }
  setReducedMotion(reduced:boolean):void {this.reduced=reduced;if(reduced){this.yaw=this.pitch=this.targetYaw=this.targetPitch=this.orbitYaw=this.orbitPitch=0;this.welcomeDrag=null;this.themeBlend=1;}this.invalidate();}
  playIntro():number {this.intro=!this.reduced&&this.available;this.introElapsed=0;this.introShifted=false;this.themeElapsed=0;this.invalidate();return this.intro?4200:250;}
  finishIntro():void {this.intro=false;this.invalidate();}

  selectNebula(index:number):void {
    index=((index%3)+3)%3;
    if(index!==this.theme){this.nebula.material.uniforms.uFrom.value=this.theme;this.theme=index;this.nebula.material.uniforms.uTo.value=index;this.themeBlend=this.reduced?1:0;}
    this.themeElapsed=0;this.syncNebulaControls();this.invalidate();
  }
  private syncNebulaControls():void {
    this.canvas.dataset.nebula=String(this.theme);
    document.querySelectorAll<HTMLButtonElement>('[data-nebula]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.nebula)===this.theme)));
  }

  attachWelcome(surface:HTMLElement):void {
    surface.addEventListener('click',event=>{if(performance.now()<this.ignoreClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{signal:this.abort.signal,capture:true});
    surface.addEventListener('pointerdown',event=>{if((this.mode==='welcome'||this.mode==='login')&&!(event.target as Element).closest('button,input,a')&&!this.reduced){this.welcomeDrag={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.orbitYaw,pitch:this.orbitPitch};surface.setPointerCapture(event.pointerId);}},{signal:this.abort.signal});
    const release=(event:PointerEvent)=>{if(this.welcomeDrag&&Math.hypot(event.clientX-this.welcomeDrag.x,event.clientY-this.welcomeDrag.y)>6)this.ignoreClickUntil=performance.now()+350;this.welcomeDrag=null;if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);};
    surface.addEventListener('pointerup',release,{signal:this.abort.signal});surface.addEventListener('pointercancel',release,{signal:this.abort.signal});
  }

  attachOrbit(stage:HTMLElement|null):void {
    this.orbit?.dispose();
    this.orbit=stage?new CourseOrbitView(stage,this.courses,this.noise,{available:this.available,invalidate:()=>this.invalidate(),onSelect:id=>this.options.onSelect(id)}):null;
    this.invalidate();
  }

  select(id:string,instant=false):void {this.orbit?.select(id,instant);}
  step(direction:number):void {this.orbit?.step(direction);}
  private resize():void {
    this.width=innerWidth;this.height=innerHeight;this.ratio=Math.min(devicePixelRatio||1,1.5);
    this.renderer?.setPixelRatio(this.ratio);this.renderer?.setSize(this.width,this.height,false);
    this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();
    this.starMaterial.uniforms.uPixelRatio.value=this.ratio;
    this.orbit?.resize();this.invalidate();
  }

  private invalidate():void {if(!this.frame&&!this.hidden&&!this.lost&&!this.disposed)this.frame=requestAnimationFrame(this.draw);}
  private stop():void {cancelAnimationFrame(this.frame);this.frame=0;}
  private draw=(now:number):void=>{
    this.frame=0;if(this.hidden||this.lost||this.disposed)return;
    const elapsed=this.lastFrame?Math.max(0,(now-this.lastFrame)/1000):1/60;
    const delta=Math.min(.06,elapsed);this.lastFrame=now;
    if(!this.reduced){this.time+=delta;if(this.mode==='welcome'||this.mode==='login'){this.themeElapsed+=delta;if(this.themeElapsed>17)this.selectNebula(this.theme+1);}}
    if(this.intro){this.introElapsed+=delta;if(this.introElapsed>1.8&&!this.introShifted){this.introShifted=true;this.selectNebula(this.theme+1);}}
    const damping=this.reduced?1:1-Math.exp(-delta*4.5);
    this.yaw+=(this.targetYaw-this.yaw)*damping;this.pitch+=(this.targetPitch-this.pitch)*damping;
    this.themeBlend=this.reduced?1:Math.min(1,this.themeBlend+delta/2.1);
    const reveal=this.intro?Math.min(1,this.introElapsed/3.7):1;
    const uniforms=this.nebula.material.uniforms;
    uniforms.uTime.value=this.time;uniforms.uReveal.value=reveal;uniforms.uBlend.value=this.themeBlend;
    const distance=32+(1-reveal)*7;
    this.camera.position.set(Math.sin(this.yaw)*distance,-this.pitch*12,Math.cos(this.yaw)*distance);
    this.camera.lookAt(0,0,-2);
    if(this.diagnostics)this.canvas.dataset.camera=this.camera.position.toArray().map(value=>value.toFixed(2)).join(',');
    this.starMaterial.uniforms.uTime.value=this.time;this.starMaterial.uniforms.uGather.value=reveal;
    this.starMaterial.uniforms.uOpacity.value=this.mode==='ambient'?.12:this.mode==='courses'?.45:.35;
    this.foregroundMaterial.uniforms.uTime.value=this.time;this.foregroundMaterial.uniforms.uGather.value=reveal;this.foregroundMaterial.uniforms.uPixelRatio.value=this.ratio;this.foregroundMaterial.uniforms.uOpacity.value=.74;
    this.orbit?.update(elapsed,this.time,this.yaw,this.pitch,this.ratio,this.reduced);
    if(this.renderer&&(this.mode!=='ambient'||this.reduced||now-this.lastRender>48)){
      this.renderer.info.reset();this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,this.width,this.height);this.renderer.clear();this.renderer.render(this.scene,this.camera);
      if(this.mode==='welcome'||this.mode==='login'){this.nebula.render(this.renderer,this.camera,{x:0,y:0,width:this.width,height:this.height});this.renderer.render(this.foreground,this.camera);}
      if(this.mode==='courses'&&this.orbit){this.renderer.clearDepth();this.orbit.render(this.renderer,this.height);this.renderer.setScissorTest(false);}
      if(this.lastRender){this.samples.push(now-this.lastRender);if(this.samples.length>100)this.samples.shift();}this.lastRender=now;
      if(this.diagnostics){const info=this.renderer.info,resources=`${info.render.calls} draws · ${info.memory.geometries} geo · ${info.memory.textures} textures · DPR ${this.ratio.toFixed(2)}`;if(this.reduced)this.diagnostics.textContent=`静态模式 · ${resources}`;else if(this.mode==='ambient')this.diagnostics.textContent=`背景节能 · ${resources}`;else if(this.samples.length>20){const sorted=[...this.samples].sort((a,b)=>a-b);this.diagnostics.textContent=`${Math.round(1000/sorted[Math.floor(sorted.length*.5)])} FPS · P95 ${sorted[Math.floor(sorted.length*.95)].toFixed(1)} ms · ${resources}`;}}
    }
    if(this.available&&!this.reduced)this.invalidate();
  };

  dispose():void {
    this.disposed=true;this.stop();this.abort.abort();this.orbit?.dispose();this.nebula.dispose();this.noise.dispose();
    this.scene.traverse(object=>{const item=object as THREE.Mesh;if(item.geometry)item.geometry.dispose();if(item.material)(Array.isArray(item.material)?item.material:[item.material]).forEach(material=>material.dispose());});
    this.foreground.traverse(object=>{const item=object as THREE.Mesh;if(item.geometry)item.geometry.dispose();if(item.material)(Array.isArray(item.material)?item.material:[item.material]).forEach(material=>material.dispose());});this.foreground.clear();
    this.scene.clear();this.renderer?.dispose();this.diagnostics?.remove();
  }
}

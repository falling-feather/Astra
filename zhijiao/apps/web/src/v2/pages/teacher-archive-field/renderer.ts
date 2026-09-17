import {
  ACESFilmicToneMapping, BoxGeometry, CanvasTexture, Color, DirectionalLight,
  DynamicDrawUsage, EdgesGeometry, HemisphereLight,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera,
  PCFShadowMap, PlaneGeometry, Raycaster, RepeatWrapping, Scene, ShadowMaterial,
  SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer,
  type Material,
} from 'three';
import grainUrl from '../../../../public/assets/archive/charcoal-paper.webp?url';
import {ARCHIVE_MAX_FPS,archiveFrameIsDue} from '../archive-field/frame-pacing';
import {advanceTeacherFlow,CLASS_LANE_GAP,createTeacherSheets,FILE_HEIGHT,FILE_WIDTH,positionTeacherSheet,resizeArchiveLoop,teacherPose,TEACHER_VISIBLE_SLOTS} from './motion';
import {ClassShelfMotion,sampleClassMove,type ClassCommit,type ClassMove,type ClassMovePhase} from './class-motion';
import type {StudentDossier} from './data';

export interface FolderAnchor {x:number;y:number;left:number;top:number;width:number;height:number;tabX:number;tabY:number}
export interface ClassVisualState {front:number;target:number;moving:number;phase:ClassMovePhase;busy:boolean}
interface Callbacks {hover(id:number|null):void;anchor(value:FolderAnchor|null):void;failure(message:string):void;classProgress?(value:ClassVisualState):void;classSettled?(id:number):void}
interface Layer {mesh:InstancedMesh;local:Matrix4;kind:'cover'|'detail'|'tab'}
const background=new Color('#d4dfeb');

export class TeacherArchiveRenderer {
  private readonly renderer:WebGLRenderer;
  private readonly scene=new Scene();
  private readonly camera=new OrthographicCamera(-14,14,7,-7,.1,160);
  private readonly sheets:ReturnType<typeof createTeacherSheets>;
  private readonly lanes:ReturnType<typeof createTeacherSheets>[];
  private readonly shelf:ClassShelfMotion;
  private splitFor:ClassMove|null=null;
  private splitSides:number[]=[];
  private slideRatio=1;
  private scatterDistance=1;
  private rightX=1;
  private rightZ=0;
  private active=true;
  private lastClassReport='';
  private readonly instanceColor=new Color();
  private readonly layers:Layer[]=[];
  private readonly labels:Array<Mesh<PlaneGeometry,MeshBasicMaterial>>=[];
  private readonly raycaster=new Raycaster();
  private readonly pointer=new Vector2();
  private readonly transform=new Object3D();
  private readonly matrix=new Matrix4();
  private readonly vector=new Vector3();
  private readonly outline:LineSegments<EdgesGeometry,LineBasicMaterial>;
  private readonly labelAtlas:CanvasTexture;
  private readonly labelColumns=16;
  private readonly labelRows:number;
  private readonly observer:ResizeObserver;
  private visible:number[]=[];
  private width=1;
  private height=1;
  private halfWidth=0;
  private halfHeight=0;
  private focus:number|null=null;
  private extracted:number|null=null;
  private spread=0;
  private spreadTarget=0;
  private reduced=false;
  private disposed=false;
  private frame=0;
  private raf=0;
  private lastDraw:number|null=null;
  private readonly visibility=()=>{this.lastDraw=null;this.invalidate();};
  private readonly contextLost=(event:Event)=>{event.preventDefault();this.callbacks.failure('三维画面已中断，可通过档案目录继续预览。');};

  static async create(canvas:HTMLCanvasElement,students:readonly StudentDossier[],callbacks:Callbacks,signal:AbortSignal) {
    const grain=await new TextureLoader().loadAsync(grainUrl);
    if(signal.aborted){grain.dispose();throw new DOMException('Archive mount cancelled','AbortError');}
    grain.wrapS=grain.wrapT=RepeatWrapping;grain.repeat.set(.85,1.1);
    try{return new TeacherArchiveRenderer(canvas,grain,students,callbacks);}
    catch(error){grain.dispose();throw error;}
  }

  private constructor(private readonly canvas:HTMLCanvasElement,private readonly grain:Texture,
    private readonly students:readonly StudentDossier[],private readonly callbacks:Callbacks) {
    this.sheets=createTeacherSheets(students);
    this.lanes=[...new Set(this.sheets.map(sheet=>sheet.row))].map(row=>this.sheets.filter(sheet=>sheet.row===row));
    this.shelf=new ClassShelfMotion(this.lanes.map(lane=>lane[0]!.row));
    if(!students.length)throw new Error('暂无可显示的班级');
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
    const gl=this.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const device=String(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
    const software=/swiftshader|llvmpipe|softpipe|software|basic render/i.test(device);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,software?.75:1.5));
    this.canvas.dataset.rendererTier=software?'software':'gpu';
    this.canvas.dataset.totalSheets=String(this.sheets.length);
    this.canvas.dataset.targetFps=String(ARCHIVE_MAX_FPS);
    this.renderer.outputColorSpace=SRGBColorSpace;
    this.renderer.toneMapping=ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.13;
    this.renderer.shadowMap.enabled=!software;
    this.renderer.shadowMap.type=PCFShadowMap;
    this.scene.background=background;
    this.camera.position.set(-22,11,40);this.camera.lookAt(0,0,0);this.camera.updateMatrixWorld();
    this.scene.add(new HemisphereLight(0xffffff,0xa8b8cb,2.8));
    const key=new DirectionalLight(0xffffff,3.0);key.position.set(14,24,36);key.target.position.set(0,0,12);
    key.castShadow=!software;key.shadow.mapSize.set(2048,2048);
    Object.assign(key.shadow.camera,{left:-18,right:18,top:35,bottom:-25,near:.5,far:90});
    key.shadow.normalBias=.035;key.shadow.bias=-.0003;key.shadow.radius=3;
    this.scene.add(key,key.target);
    const rim=new DirectionalLight(0xe5ecff,1.15);rim.position.set(15,12,-14);this.scene.add(rim);
    this.grain.anisotropy=Math.min(2,this.renderer.capabilities.getMaxAnisotropy());
    const cover=new MeshStandardMaterial({color:0xffffff,roughness:.92,bumpMap:grain,bumpScale:.012});
    const paper=new MeshStandardMaterial({color:0xd4dfeb,roughness:1});
    const binding=new MeshStandardMaterial({color:0x8b9db2,roughness:.9});
    const tab=new MeshStandardMaterial({color:0xffffff,roughness:.5,metalness:.12});
    this.addLayer(new BoxGeometry(FILE_WIDTH,FILE_HEIGHT,.114),cover,0,0,0,true,'cover');
    this.addLayer(new BoxGeometry(FILE_WIDTH-.13,.017,.065),paper,.015,FILE_HEIGHT/2+.004,0);
    this.addLayer(new BoxGeometry(.034,FILE_HEIGHT-.03,.12),binding,-FILE_WIDTH/2+.032,0,0);
    this.addLayer(new BoxGeometry(.20,.30,.042),tab,-FILE_WIDTH/2+.21,FILE_HEIGHT/2-.18,.082,false,'tab');
    const floor=new Mesh(new PlaneGeometry(200,200),new MeshBasicMaterial({color:0xd4dfeb,toneMapped:false}));
    floor.rotation.x=-Math.PI/2;floor.position.y=-.03;this.scene.add(floor);
    const shadows=new Mesh(new PlaneGeometry(200,200),new ShadowMaterial({color:0x253c57,opacity:.17}));
    shadows.rotation.x=-Math.PI/2;shadows.position.y=-.02;shadows.receiveShadow=true;this.scene.add(shadows);
    this.outline=new LineSegments(new EdgesGeometry(new BoxGeometry(FILE_WIDTH+.014,FILE_HEIGHT+.014,.008)),
      new LineBasicMaterial({color:0x73aaf1,transparent:true,opacity:.75}));
    this.outline.visible=false;this.scene.add(this.outline);
    this.labelRows=Math.ceil(students.length/this.labelColumns);
    this.labelAtlas=this.makeLabelAtlas(students);
    students.forEach((student,index)=>{
      const geometry=new PlaneGeometry(.52,2.08),uv=geometry.getAttribute('uv');
      const column=index%this.labelColumns,row=Math.floor(index/this.labelColumns);
      for(let i=0;i<uv.count;i++)uv.setXY(i,(column+uv.getX(i))/this.labelColumns,1-(row+1-uv.getY(i))/this.labelRows);
      const material=new MeshBasicMaterial({map:this.labelAtlas,transparent:true,depthWrite:false,toneMapped:false});
      const mesh=new Mesh(geometry,material);mesh.visible=false;mesh.renderOrder=2;
      mesh.userData.studentId=student.id;this.labels.push(mesh);this.scene.add(mesh);
    });
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    document.addEventListener('visibilitychange',this.visibility);
    canvas.addEventListener('webglcontextlost',this.contextLost);
    this.resize();
  }

  private makeLabelAtlas(students:readonly StudentDossier[]) {
    const canvas=document.createElement('canvas');canvas.width=this.labelColumns*64;canvas.height=this.labelRows*256;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法绘制姓名标签');
    ctx.fillStyle='#202a36';ctx.textAlign='center';ctx.textBaseline='middle';
    students.forEach((student,index)=>{
      const x=(index%this.labelColumns)*64+32,y=Math.floor(index/this.labelColumns)*256;
      ctx.font='600 40px "Microsoft YaHei UI","Microsoft YaHei",sans-serif';
      const name=Array.from(student.name);
      const shown=name.length>5?[...name.slice(0,4),'…']:name;
      shown.forEach((char,line)=>ctx.fillText(char,x,y+32+line*44,54));
    });
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=2;
    return texture;
  }

  private addLayer(geometry:BoxGeometry,material:MeshStandardMaterial,x:number,y:number,z:number,shadow=false,kind:Layer['kind']='detail') {
    const mesh=new InstancedMesh(geometry,material,this.sheets.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.frustumCulled=false;
    mesh.castShadow=shadow;mesh.receiveShadow=true;
    this.layers.push({mesh,local:new Matrix4().makeTranslation(x,y,z),kind});this.scene.add(mesh);
  }

  private resize() {
    if(this.disposed)return;
    this.width=Math.max(1,this.canvas.clientWidth);this.height=Math.max(1,this.canvas.clientHeight);
    const span=this.width<760?20.5:14.2,aspect=this.width/this.height;
    const offset=span*aspect*.10;
    this.camera.left=-span*aspect/2+offset;this.camera.right=span*aspect/2+offset;
    this.camera.top=span/2;this.camera.bottom=-span/2;this.camera.updateProjectionMatrix();
    const origin=this.project(0,0,0),edge=this.project(FILE_WIDTH/2,0,0),top=this.project(0,FILE_HEIGHT/2,0);
    this.halfWidth=Math.abs(edge.x-origin.x)+5;
    this.halfHeight=Math.abs(edge.y-origin.y)+Math.abs(top.y-origin.y)+5;
    const alongZ=this.project(0,0,1),alongX=this.project(1,0,0);
    this.slideRatio=(alongX.x-origin.x)/(alongZ.x-origin.x);
    this.rightX=this.camera.matrixWorld.elements[0]!;this.rightZ=this.camera.matrixWorld.elements[2]!;
    const right=this.project(this.rightX,0,this.rightZ);
    this.scatterDistance=this.width*.44/(right.x-origin.x);
    // Every lane starts and recycles beyond the viewport, including its full file width.
    for(const lane of this.lanes){
      const center=this.project(lane[0]!.x,0,0),step=this.project(lane[0]!.x,0,1);
      const dx=step.x-center.x,padding=this.halfWidth*2+60;
      const start=(-padding-center.x)/dx,length=(this.width+padding*2)/dx;
      resizeArchiveLoop(lane,start,length*Math.max(1,lane.length/TEACHER_VISIBLE_SLOTS));
    }
    this.renderer.setSize(this.width,this.height,false);this.lastDraw=null;this.invalidate();
  }

  private project(x:number,y:number,z:number) {
    this.vector.set(x,y,z).project(this.camera);
    return {x:(this.vector.x+1)*this.width/2,y:(1-this.vector.y)*this.height/2};
  }

  anchor(index=this.focus):FolderAnchor|null {
    if(index===null)return null;
    const pose=this.poseFor(index);
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>this.project(pose.x+x!*FILE_WIDTH/2,pose.y+y!*FILE_HEIGHT/2,pose.z+.08));
    const left=Math.min(...corners.map(point=>point.x)),top=Math.min(...corners.map(point=>point.y));
    const right=Math.max(...corners.map(point=>point.x)),bottom=Math.max(...corners.map(point=>point.y));
    const center=this.project(pose.x,pose.y,pose.z),tab=this.project(pose.x-FILE_WIDTH/2+.29,pose.y+FILE_HEIGHT/2-.45,pose.z+.09);
    return {...center,left,top,width:right-left,height:bottom-top,tabX:tab.x,tabY:tab.y};
  }

  pointerAt(x:number,y:number) {
    if(this.disposed||this.extracted!==null||this.shelf.busy||!this.active)return null;
    this.pointer.set(x/this.width*2-1,1-y/this.height*2);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hits=this.raycaster.intersectObject(this.layers[0]!.mesh,false);
    const id=hits[0]?.instanceId===undefined?null:this.visible[hits[0]!.instanceId!]??null;
    const selected=id!==null&&this.students[id]?.recordId?id:null;this.setFocus(selected);return selected;
  }
  private setFocus(id:number|null) {
    if(this.focus===id)return;
    this.focus=id;
    if(id!==null)this.sheets[id]!.speed=0;
    this.callbacks.hover(id);this.callbacks.anchor(this.anchor());
    this.invalidate();
  }
  clearPointer(){if(this.extracted===null)this.setFocus(null);}
  get classState():ClassVisualState{return {front:this.shelf.order[0]!,target:this.shelf.requested,moving:this.shelf.move?.target??this.shelf.order[0]!,phase:this.shelf.phase,busy:this.shelf.busy};}
  requestClass(id:number,immediate=false){
    if(!this.shelf.order.includes(id))return;
    this.extracted=null;this.setFocus(null);
    const commit=this.shelf.request(id,immediate||this.reduced||!this.active);
    if(commit)this.commitClassOrder(commit);
    this.reportClass();
    if(!this.shelf.busy)this.callbacks.classSettled?.(this.shelf.order[0]!);
    this.invalidate();
  }
  setActive(value:boolean){
    if(!value&&this.shelf.busy)this.requestClass(this.shelf.requested,true);
    this.active=value;this.lastDraw=null;
    if(!value){cancelAnimationFrame(this.raf);this.raf=0;}else this.invalidate();
  }
  private reportClass(){
    const value=this.classState,key=JSON.stringify(value);
    if(key===this.lastClassReport)return;
    this.lastClassReport=key;this.callbacks.classProgress?.(value);
    this.canvas.dataset.classPhase=value.phase;this.canvas.dataset.frontClass=String(value.front);
    this.canvas.dataset.classOrder=this.shelf.order.join(',');
  }
  private commitClassOrder(commit:ClassCommit){
    for(const lane of this.lanes){
      const row=lane[0]!.row,newX=commit.to.indexOf(row)*CLASS_LANE_GAP;
      const shiftZ=-(newX-lane[0]!.x)*this.slideRatio;
      lane[0]!.loop.start+=shiftZ;
      for(const sheet of lane){sheet.x=newX;sheet.z+=shiftZ;}
    }
    this.splitFor=null;
  }
  private poseFor(index:number){
    const sheet=this.sheets[index]!,base=teacherPose(sheet,this.spread),move=this.shelf.move;
    if(!move)return base;
    const frame=sampleClassMove(move,sheet.row);
    const x=frame.x*(1+this.spread*.10);
    const scatter=(this.splitSides[index]??1)*frame.scatter*this.scatterDistance;
    return {x:x+this.rightX*scatter,y:base.y+frame.lift,z:base.z-(x-base.x)*this.slideRatio+this.rightZ*scatter};
  }
  focusStudent(id:number) {
    const anchor=this.anchor(id);
    if(!anchor||anchor.tabX<this.width*.25||anchor.tabX>this.width*.86||anchor.tabY<95||anchor.tabY>this.height-180) {
      const sheet=this.sheets[id]!,center=this.project(sheet.x,FILE_HEIGHT/2,0),step=this.project(sheet.x,FILE_HEIGHT/2,1);
      const targetZ=(this.width*.62-center.x)/(step.x-center.x);
      positionTeacherSheet(this.sheets,id,targetZ);
    }
    this.setFocus(id);this.callbacks.anchor(this.anchor());this.invalidate();
    return this.anchor();
  }
  setExtracted(value:boolean){this.extracted=value?this.focus:null;this.invalidate();}
  setReducedMotion(value:boolean){this.reduced=value;this.lastDraw=null;this.invalidate();}
  setExpanded(value:boolean){this.spreadTarget=value?1:0;this.invalidate();}

  private invalidate() {
    if(this.disposed||this.raf||document.hidden||!this.active)return;
    this.raf=requestAnimationFrame(this.draw);
  }

  private readonly draw=(now:number)=>{
    this.raf=0;if(this.disposed||document.hidden||!this.active)return;
    if(!archiveFrameIsDue(now,this.lastDraw,this.reduced)){this.invalidate();return;}
    const start=performance.now();
    const delta=this.lastDraw===null?0:Math.min((now-this.lastDraw)/1000,.2);this.lastDraw=now;
    this.spread+=(this.spreadTarget-this.spread)*(this.reduced?1:1-Math.exp(-delta*5));
    if(this.shelf.busy){
      const commit=this.shelf.advance(delta,this.reduced);
      if(commit){this.commitClassOrder(commit);if(!this.shelf.busy)this.callbacks.classSettled?.(this.shelf.order[0]!);}
      if(this.shelf.move!==this.splitFor){
        this.splitFor=this.shelf.move;
        this.splitSides=this.sheets.map(sheet=>{const pose=teacherPose(sheet,this.spread);return this.project(pose.x,pose.y,pose.z).x<this.width*.5?-1:1;});
      }
    }else advanceTeacherFlow(this.sheets,delta,this.focus,this.reduced);
    this.reportClass();
    const poses=this.sheets.map((_,index)=>this.poseFor(index));
    this.visible=poses.flatMap((pose,index)=>{
      if(index===this.extracted)return [];
      const center=this.project(pose.x,pose.y,pose.z);
      return center.x+this.halfWidth>-20&&center.x-this.halfWidth<this.width+20&&center.y+this.halfHeight>-20&&center.y-this.halfHeight<this.height+20?[index]:[];
    });
    this.labels.forEach(label=>{label.visible=false;});
    this.visible.forEach((index,instance)=>{
      const pose=poses[index]!;
      this.transform.position.set(pose.x,pose.y,pose.z);this.transform.updateMatrix();
      for(const layer of this.layers){
        this.matrix.multiplyMatrices(this.transform.matrix,layer.local);
        layer.mesh.setMatrixAt(instance,this.matrix);
        if(layer.kind==='cover')layer.mesh.setColorAt(instance,this.instanceColor.set(this.sheets[index]!.row===this.shelf.requested?0xffffff:0xe2eaf4));
        if(layer.kind==='tab')layer.mesh.setColorAt(instance,this.instanceColor.set(this.sheets[index]!.row===this.shelf.requested?0xe2aa37:0x7297c1));
      }
      const name=this.labels[index]!;
      name.position.set(pose.x-FILE_WIDTH/2+.34,pose.y+FILE_HEIGHT/2-1.45,pose.z+.077);
      name.visible=true;
    });
    for(const layer of this.layers){
      layer.mesh.count=this.visible.length;layer.mesh.instanceMatrix.needsUpdate=true;
      if(layer.mesh.instanceColor)layer.mesh.instanceColor.needsUpdate=true;
      layer.mesh.boundingSphere=null;
    }
    this.outline.visible=this.focus!==null&&this.extracted===null;
    if(this.focus!==null){
      const pose=poses[this.focus]!;
      this.outline.position.set(pose.x,pose.y,pose.z+.087);this.callbacks.anchor(this.anchor());
    }
    this.renderer.render(this.scene,this.camera);this.frame++;
    if(this.frame%6===0){
      this.canvas.dataset.frame=String(this.frame);
      this.canvas.dataset.focusId=this.focus===null?'':String(this.focus);
      this.canvas.dataset.focusPhase=this.focus===null?'':this.sheets[this.focus]!.phase.toFixed(5);
      const leading=this.focus===null?Math.min(8,this.sheets.length-1):(this.focus+3)%this.sheets.length;
      this.canvas.dataset.leadingPhase=this.sheets[leading]!.phase.toFixed(5);
      this.canvas.dataset.visibleSheets=String(this.visible.length);
      this.canvas.dataset.drawMs=(performance.now()-start).toFixed(1);
    }
    if(!this.reduced||this.shelf.busy||Math.abs(this.spread-this.spreadTarget)>.002)this.invalidate();
  };

  dispose() {
    if(this.disposed)return;
    this.disposed=true;cancelAnimationFrame(this.raf);this.observer.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);
    this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    const materials=new Set<Material>(),geometries=new Set<{dispose():void}>();
    this.scene.traverse(object=>{
      if(object instanceof Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}
    });
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
    this.outline.geometry.dispose();this.outline.material.dispose();
    this.labelAtlas.dispose();this.grain.dispose();this.renderer.dispose();
  }
}

import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, DynamicDrawUsage, Float32BufferAttribute,
  EdgesGeometry, FogExp2, HemisphereLight, InstancedMesh, LineBasicMaterial, LineSegments,
  Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera,
  PlaneGeometry, Raycaster, RepeatWrapping, Scene, SRGBColorSpace, Texture, TextureLoader,
  Vector2, Vector3, WebGLRenderer,
} from 'three';
import {advanceArchiveFlow, archiveSheetPose, createArchiveSheets, dossierIndexForSheet, FILE_HEIGHT, FILE_WIDTH, resizeArchiveLoop} from './motion';
import {publicAsset} from '../../../public-asset';
import {ARCHIVE_MAX_FPS,archiveFrameIsDue} from './frame-pacing';

export interface ArchiveAnchor {
  x: number; y: number; left: number; top: number; width: number; height: number;
  tabX: number; tabY: number;
}
interface FieldCallbacks {
  hover(id: string | null): void;
  anchor(value: ArchiveAnchor | null): void;
}
interface Layer {mesh: InstancedMesh; local: Matrix4}

export class ArchiveFieldRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene=new Scene();
  private readonly camera=new OrthographicCamera(-12,12,6.5,-6.5,.1,100);
  private readonly sheets=createArchiveSheets();
  private poses=this.sheets.map(sheet=>archiveSheetPose(sheet));
  private visibleSheets:number[]=[];
  private halfWidth=0;
  private halfHeight=0;
  private readonly layers: Layer[]=[];
  private readonly raycaster=new Raycaster();
  private readonly pointer=new Vector2();
  private pointerInside=false;
  private lastPointerCheck=0;
  private readonly object=new Object3D();
  private readonly matrix=new Matrix4();
  private readonly vector=new Vector3();
  private readonly outline: LineSegments<EdgesGeometry,LineBasicMaterial>;
  private readonly observer: ResizeObserver;
  private ids: readonly string[]=[];
  private focus: number | null=null;
  private extracted: number | null=null;
  private width=1;
  private height=1;
  private spread=0;
  private spreadTarget=0;
  private reduced=false;
  private lastFrame:number|null=null;
  private frame=0;
  private request=0;
  private disposed=false;
  private readonly onVisibility=()=>{this.lastFrame=null;this.invalidate();};

  static async create(canvas:HTMLCanvasElement,callbacks:FieldCallbacks,signal:AbortSignal) {
    if(signal.aborted)throw new DOMException('Archive mount cancelled','AbortError');
    const texture=await new TextureLoader().loadAsync(publicAsset('/assets/archive/charcoal-paper.webp'));
    if(signal.aborted){texture.dispose();throw new DOMException('Archive mount cancelled','AbortError');}
    texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;
    texture.repeat.set(.8,1.1);
    try {return new ArchiveFieldRenderer(canvas,texture,callbacks);}
    catch(error){texture.dispose();throw error;}
  }

  private constructor(private canvas:HTMLCanvasElement,private texture:Texture,private callbacks:FieldCallbacks) {
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    const gl=this.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const device=String(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
    const software=/(swiftshader|llvmpipe|softpipe|software|basic render)/i.test(device);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,software ? 0.55 : 1.5));
    this.canvas.dataset.rendererTier=software?'software':'gpu';
    this.canvas.dataset.totalSheets=String(this.sheets.length);
    this.canvas.dataset.targetFps=String(ARCHIVE_MAX_FPS);
    this.renderer.outputColorSpace=SRGBColorSpace;
    this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    this.texture.anisotropy=Math.min(2,this.renderer.capabilities.getMaxAnisotropy());
    this.scene.background=new Color('#111315');
    this.scene.fog=new FogExp2('#111315',.012);
    this.camera.position.set(-22,23,28);this.camera.lookAt(0,2.6,0);
    this.camera.updateMatrixWorld();

    this.scene.add(new HemisphereLight(0xe4e1dc,0x12151c,1.3));
    const key=new DirectionalLight(0xe7e3dd,4.7);key.position.set(-12,22,30);
    this.scene.add(key);
    const rim=new DirectionalLight(0xcddce6,1.4);rim.position.set(8,8,-14);this.scene.add(rim);
    const fill=new DirectionalLight(0xe0e2e4,.55);fill.position.set(16,10,25);this.scene.add(fill);
    const cover=new MeshBasicMaterial({color:0xdddfe0,map:texture,vertexColors:true});
    const paper=new MeshBasicMaterial({color:0x5f625c,vertexColors:true});
    const binding=new MeshBasicMaterial({color:0x151719,vertexColors:true});
    const brass=new MeshStandardMaterial({color:0x9e8358,roughness:.42,metalness:.62});
    const geometry=new BoxGeometry(FILE_WIDTH,FILE_HEIGHT,.114);
    this.addLayer(geometry,cover,0,0,0);
    this.addLayer(new BoxGeometry(FILE_WIDTH-.13,.017,.065),paper,.015,FILE_HEIGHT/2+.004,0);
    this.addLayer(new BoxGeometry(.034,FILE_HEIGHT-.03,.12),binding,-FILE_WIDTH/2+.032,0,0);
    this.addLayer(new BoxGeometry(.20,.28,.056),brass,-FILE_WIDTH/2+.23,FILE_HEIGHT/2-.10,.08);
    const ground=new Mesh(new PlaneGeometry(120,120),new MeshBasicMaterial({color:0x0c0e10}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.25;ground.receiveShadow=true;this.scene.add(ground);
    this.outline=new LineSegments(new EdgesGeometry(new BoxGeometry(FILE_WIDTH+.008,FILE_HEIGHT+.008,.005)),
      new LineBasicMaterial({color:0xc2d7cb,transparent:true,opacity:.88}));
    this.outline.visible=false;this.scene.add(this.outline);

    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.resize();this.invalidate();
  }

  private addLayer(geometry:BoxGeometry,material:Material,x:number,y:number,z:number) {
    if(material instanceof MeshBasicMaterial&&material.vertexColors) {
      // All folders only translate. Their matte response to fixed studio lights
      // is constant in object space, so bake that response once per face.
      const normals=geometry.getAttribute('normal'),colors:number[]=[];
      const sky=new Color(0xe4e1dc).multiplyScalar(1.3),ground=new Color(0x12151c).multiplyScalar(1.3);
      const lights=[
        {direction:new Vector3(-12,22,30).normalize(),color:new Color(0xe7e3dd).multiplyScalar(4.7)},
        {direction:new Vector3(8,8,-14).normalize(),color:new Color(0xcddce6).multiplyScalar(1.4)},
        {direction:new Vector3(16,10,25).normalize(),color:new Color(0xe0e2e4).multiplyScalar(.55)},
      ];
      const normal=new Vector3();
      for(let vertex=0;vertex<normals.count;vertex++){
        normal.fromBufferAttribute(normals,vertex);
        const irradiance=ground.clone().lerp(sky,normal.y*.5+.5);
        for(const light of lights)irradiance.add(light.color.clone().multiplyScalar(Math.max(0,normal.dot(light.direction))));
        irradiance.multiplyScalar(1/Math.PI);colors.push(irradiance.r,irradiance.g,irradiance.b);
      }
      geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
    }
    const mesh=new InstancedMesh(geometry,material,this.sheets.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled=false;
    const color=new Color();
    this.sheets.forEach((sheet,index)=>mesh.setColorAt(index,color.setScalar(.76+sheet.tone*.3)));
    this.layers.push({mesh,local:new Matrix4().makeTranslation(x,y,z)});this.scene.add(mesh);
  }

  setDossiers(ids:readonly string[]) {
    this.ids=ids;this.focus=null;this.extracted=null;
    this.callbacks.hover(null);this.callbacks.anchor(null);this.invalidate();
  }
  setReducedMotion(reduced:boolean){this.reduced=reduced;this.invalidate();}
  setExpanded(value:boolean){this.spreadTarget=value?1:0;this.invalidate();}
  setExtracted(value:boolean) {this.extracted=value?this.focus:null;this.invalidate();}

  private resize() {
    if(this.disposed)return;
    this.width=Math.max(1,this.canvas.clientWidth);this.height=Math.max(1,this.canvas.clientHeight);
    const aspect=this.width/this.height,span=this.width<700?15.5:13.2;
    this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;
    this.camera.top=span/2;this.camera.bottom=-span/2;this.camera.updateProjectionMatrix();

    const origin=this.project(0,0,0),edge=this.project(FILE_WIDTH/2,0,0),top=this.project(0,FILE_HEIGHT/2+.1,0);
    this.halfWidth=Math.abs(edge.x-origin.x)+3;
    this.halfHeight=Math.abs(edge.y-origin.y)+Math.abs(top.y-origin.y)+3;
    const step=this.project(0,0,1),dx=step.x-origin.x,dy=step.y-origin.y;
    let first=Infinity,last=-Infinity;
    // The complete folder must leave the viewport before recycling. Include
    // both compact and expanded row positions, including portrait/ultrawide views.
    for(const sheet of this.sheets.filter(value=>value.slot===0)) {
      for(const scale of [1,1.16]) {
        const center=this.project(sheet.x*scale,FILE_HEIGHT/2+.65,0);
        const min=Math.max((-this.halfWidth-24-center.x)/dx,(-this.halfHeight-24-center.y)/dy);
        const max=Math.min((this.width+this.halfWidth+24-center.x)/dx,(this.height+this.halfHeight+24-center.y)/dy);
        if(min<max){first=Math.min(first,min);last=Math.max(last,max);}
      }
    }
    resizeArchiveLoop(this.sheets,first-2,last-first+4);
    this.updateVisibleSheets();
    this.renderer.setSize(this.width,this.height,false);
    this.invalidate();
  }

  private updateVisibleSheets() {
    this.poses=this.sheets.map(sheet=>archiveSheetPose(sheet,this.spread));
    const next=this.poses.flatMap((pose,index)=>{
      const center=this.project(pose.x,pose.y,pose.z);
      return center.x+this.halfWidth>-8&&center.x-this.halfWidth<this.width+8
        &&center.y+this.halfHeight>-8&&center.y-this.halfHeight<this.height+8?[index]:[];
    });
    // Recycled folders change depth and visibility. Refresh the small instance
    // list instead of retaining the first frame's cull or drawing the whole loop.
    const view=this.camera.matrixWorldInverse.elements;
    const depth=(index:number)=>{const p=this.poses[index]!;return view[2]!*p.x+view[6]!*p.y+view[10]!*p.z+view[14]!;};
    next.sort((a,b)=>depth(b)-depth(a));
    const changed=next.length!==this.visibleSheets.length||next.some((index,instance)=>index!==this.visibleSheets[instance]);
    this.visibleSheets=next;
    const color=new Color();
    for(const layer of this.layers) {
      layer.mesh.count=this.visibleSheets.length;
      if(changed) {
        this.visibleSheets.forEach((index,instance)=>layer.mesh.setColorAt(instance,color.setScalar(.76+this.sheets[index]!.tone*.3)));
        if(layer.mesh.instanceColor)layer.mesh.instanceColor.needsUpdate=true;
      }
      layer.mesh.boundingSphere=null;
    }
  }
  private project(x:number,y:number,z:number) {
    this.vector.set(x,y,z).project(this.camera);
    return {x:(this.vector.x+1)*this.width/2,y:(1-this.vector.y)*this.height/2};
  }
  private anchorFor(index:number):ArchiveAnchor {
    const pose=archiveSheetPose(this.sheets[index]!,this.spread);
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>this.project(pose.x+x!*FILE_WIDTH/2,pose.y+y!*FILE_HEIGHT/2,pose.z+.13));
    const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
    const right=Math.max(...corners.map(p=>p.x)),bottom=Math.max(...corners.map(p=>p.y));
    const center=this.project(pose.x,pose.y,pose.z+.13),tab=this.project(pose.x-FILE_WIDTH/2+.23,pose.y+FILE_HEIGHT/2-.12,pose.z+.18);
    return {...center,left,top,width:right-left,height:bottom-top,tabX:tab.x,tabY:tab.y};
  }
  pointerAt(x:number,y:number) {
    if(this.disposed||this.extracted!==null)return null;
    this.pointer.set(x/this.width*2-1,1-y/this.height*2);
    this.pointerInside=true;
    if(!this.ids.length)return null;
    return this.pick();
  }
  private pick() {
    this.lastPointerCheck=performance.now();
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObject(this.layers[0]!.mesh,false)[0];
    const index=hit?.instanceId===undefined?null:this.visibleSheets[hit.instanceId]??null;
    this.focus=index;
    const id=index===null?null:this.ids[dossierIndexForSheet(this.sheets[index]!,this.ids.length)]??null;
    this.callbacks.hover(id);this.callbacks.anchor(index===null?null:this.anchorFor(index));this.invalidate();
    return id;
  }
  clearPointer(){
    if(this.extracted!==null)return;
    this.pointerInside=false;
    this.focus=null;this.callbacks.hover(null);this.callbacks.anchor(null);this.invalidate();
  }
  focusDossier(id:string) {
    const dossier=this.ids.indexOf(id);if(dossier<0)return null;
    let nearest:number|null=null,score=Infinity;
    for(const i of this.visibleSheets) {
      if(dossierIndexForSheet(this.sheets[i]!,this.ids.length)!==dossier)continue;
      const pose=this.anchorFor(i);
      if(pose.top<140||pose.top+pose.height>this.height-65||pose.left<80||pose.left+pose.width>this.width-80)continue;
      const distance=Math.hypot(pose.x-this.width*.58,pose.y-this.height*.54);
      if(distance<score){score=distance;nearest=i;}
    }
    if(nearest===null)return null;
    this.focus=nearest;this.callbacks.hover(id);
    const anchor=this.anchorFor(nearest);this.callbacks.anchor(anchor);this.invalidate();return anchor;
  }
  getAnchor(){return this.focus===null?null:this.anchorFor(this.focus);}

  private invalidate() {
    if(this.disposed||this.request||document.hidden)return;
    this.request=requestAnimationFrame(this.draw);
  }
  private readonly draw=(now:number)=>{
    const drawStarted=performance.now();
    this.request=0;if(this.disposed||document.hidden)return;
    if(!archiveFrameIsDue(now,this.lastFrame,this.reduced)){this.invalidate();return;}
    const delta=this.lastFrame===null?1/60:Math.min((now-this.lastFrame)/1000,.2);this.lastFrame=now;
    this.spread+=(this.spreadTarget-this.spread)*(this.reduced?1:1-Math.exp(-delta*5));
    advanceArchiveFlow(this.sheets,delta,this.focus,this.reduced);
    this.updateVisibleSheets();
    this.visibleSheets.forEach((index,instance)=>{
      const pose=this.poses[index]!;
      this.object.position.set(pose.x,pose.y,pose.z);
      this.object.scale.setScalar(index===this.extracted?0:1);
      this.object.updateMatrix();
      for(const layer of this.layers){this.matrix.multiplyMatrices(this.object.matrix,layer.local);layer.mesh.setMatrixAt(instance,this.matrix);}
    });
    for(const layer of this.layers)layer.mesh.instanceMatrix.needsUpdate=true;
    this.outline.visible=this.focus!==null&&this.extracted===null;
    if(this.focus!==null) {
      const pose=this.poses[this.focus]!;
      this.outline.position.set(pose.x,pose.y,pose.z+.115);
      this.callbacks.anchor(this.anchorFor(this.focus));
    }
    this.renderer.render(this.scene,this.camera);this.frame+=1;
    if(this.pointerInside&&this.ids.length>0&&this.focus===null&&now-this.lastPointerCheck>150)this.pick();
    if(this.frame%12===0) {
      this.canvas.dataset.frame=String(this.frame);
      this.canvas.dataset.focusPhase=this.focus===null?'':this.sheets[this.focus]!.phase.toFixed(4);
      this.canvas.dataset.distantPhase=this.sheets[this.focus===0?this.sheets.length-1:0]!.phase.toFixed(4);
      this.canvas.dataset.drawMs=(performance.now()-drawStarted).toFixed(1);
      this.canvas.dataset.visibleSheets=String(this.visibleSheets.length);
    }
    if(!this.reduced||Math.abs(this.spread-this.spreadTarget)>.002)this.invalidate();
  };

  dispose() {
    this.disposed=true;cancelAnimationFrame(this.request);this.observer.disconnect();
    document.removeEventListener('visibilitychange',this.onVisibility);
    const materials=new Set<Material>();
    this.scene.traverse(object=>{
      if(object instanceof Mesh){object.geometry.dispose();if(!Array.isArray(object.material))materials.add(object.material);}
    });
    materials.forEach(material=>material.dispose());
    this.outline.geometry.dispose();this.outline.material.dispose();this.texture.dispose();
    this.renderer.dispose();
  }
}

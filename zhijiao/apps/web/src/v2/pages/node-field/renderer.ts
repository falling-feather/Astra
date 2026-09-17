import * as THREE from "three";
import { STAGE, cameraBounds, constrainCamera, type CameraState, type FieldActor, type Point } from "./visuals";

export class FieldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-836, 836, 470.5, -470.5, .1, 500);
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly actors = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly loading = new Map<string, Promise<THREE.Texture>>();
  private readonly pixels = new Map<string, ImageData>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly observer: ResizeObserver;
  private request = 0;
  private disposed = false;
  private constructor(private canvas: HTMLCanvasElement, private atlas: THREE.Texture) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.camera.position.z = 100;
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(STAGE.width, STAGE.height), new THREE.MeshBasicMaterial()); this.background.position.z = -20; this.scene.add(this.background);
    this.capturePixels("legacy", atlas);
    this.observer = new ResizeObserver(() => this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)); this.observer.observe(canvas); this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }
  private capturePixels(key: string, texture: THREE.Texture) {
    if (!(texture.image instanceof HTMLImageElement)) throw new Error("人物素材没有正确解码");
    const buffer = document.createElement("canvas"); buffer.width = texture.image.width; buffer.height = texture.image.height;
    const context = buffer.getContext("2d", { willReadFrequently: true })!; context.drawImage(texture.image, 0, 0);
    this.pixels.set(key, context.getImageData(0, 0, buffer.width, buffer.height));
  }
  static async create(canvas: HTMLCanvasElement) {
    const atlas = await new THREE.TextureLoader().loadAsync("/assets/node-world/characters.png"); atlas.colorSpace = THREE.SRGBColorSpace;
    return new FieldRenderer(canvas, atlas);
  }
  private texture(path: string): Promise<THREE.Texture> {
    const existing = this.textures.get(path); if (existing) return Promise.resolve(existing);
    const pending = this.loading.get(path); if (pending) return pending;
    const load = new THREE.TextureLoader().loadAsync(path).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      if (this.disposed) { texture.dispose(); throw new Error("场景已经关闭"); }
      this.textures.set(path, texture); return texture;
    }).finally(() => this.loading.delete(path));
    this.loading.set(path, load); return load;
  }
  async loadScene(path: string, atlas?: { columns: number; rows: number; index: number }) {
    const request = ++this.request, texture = await this.texture(path);
    if (this.disposed || request !== this.request) return false;
    if (!(texture.image instanceof HTMLImageElement)) throw new Error("场景图片没有正确解码");
    const columns=atlas?.columns??1, rows=atlas?.rows??1, index=atlas?.index??0;
    const cellAspect=(texture.image.width/columns)/(texture.image.height/rows), stageAspect=STAGE.width/STAGE.height;
    const cropX=Math.min(1,stageAspect/cellAspect), cropY=Math.min(1,cellAspect/stageAspect);
    texture.repeat.set(cropX/columns,cropY/rows);
    texture.offset.set(((index%columns)+(1-cropX)/2)/columns,(rows-1-Math.floor(index/columns)+(1-cropY)/2)/rows);
    texture.needsUpdate=true;
    this.background.material.map = texture; this.background.material.needsUpdate = true; return true;
  }
  async loadActors(actors: readonly FieldActor[]) {
    await Promise.all([...new Set(actors.flatMap(actor => actor.image ? [actor.image] : []))].map(async image => {
      const texture = await this.texture(image); if (!this.pixels.has(image)) this.capturePixels(image, texture);
    }));
  }
  setActors(actors: readonly FieldActor[]) {
    for (const [id, mesh] of this.actors) mesh.visible = actors.some(actor => actor.entityId === id && actor.visible);
    for (const actor of actors) {
      const key = actor.image ?? "legacy", texture = actor.image ? this.textures.get(actor.image) : this.atlas;
      if (!texture) continue;
      const columns = actor.image ? actor.columns ?? 1 : 4, rows = actor.rows ?? 1;
      const keyed=!actor.image || actor.image==='/assets/node-world/characters.png';
      let mesh = this.actors.get(actor.entityId);
      if (mesh && mesh.userData.textureKey !== key) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); this.actors.delete(actor.entityId); mesh = undefined; }
      if (!mesh) {
        const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: {
          map: { value: texture }, cell: { value: actor.atlas }, columns: { value: columns }, rows: { value: rows }, keyed: { value: keyed ? 1 : 0 },
        },
          vertexShader: "varying vec2 uvOut; void main(){uvOut=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
          fragmentShader: `uniform sampler2D map; uniform float cell; uniform float columns; uniform float rows; uniform float keyed; varying vec2 uvOut;
          void main(){vec2 st=vec2((uvOut.x+mod(cell,columns))/columns,(uvOut.y+rows-1.0-floor(cell/columns))/rows);vec4 c=texture2D(map,st);float a=c.a;
          if(keyed>0.5){a=1.0-smoothstep(.1,.27,c.g-max(c.r,c.b));c.g=min(c.g,max(c.r,c.b)*1.08);}if(a<.04)discard;gl_FragColor=vec4(c.rgb,a);
          #include <colorspace_fragment>
          }`,
        });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); mesh.userData.entityId = actor.entityId; this.actors.set(actor.entityId, mesh); this.scene.add(mesh);
      }
      Object.assign(mesh.userData, { textureKey: key, atlas: actor.atlas, columns, rows, keyed });
      mesh.material.uniforms.cell!.value = actor.atlas;
      const h = actor.height * STAGE.height, pixels = this.pixels.get(key)!;
      const aspect = actor.image ? (pixels.width / columns) / (pixels.height / rows) : .5;
      mesh.scale.set(h * aspect, h, 1); mesh.position.set((actor.x - .5) * STAGE.width, (.5 - actor.y) * STAGE.height + h / 2, 10); mesh.visible = actor.visible;
    }
  }
  render(state: CameraState) {
    const c = constrainCamera(state, this.canvas.clientWidth, this.canvas.clientHeight), { scale } = cameraBounds(this.canvas.clientWidth, this.canvas.clientHeight, c.zoom);
    const w = this.canvas.clientWidth / scale, h = this.canvas.clientHeight / scale;
    this.camera.left = -w / 2; this.camera.right = w / 2; this.camera.top = h / 2; this.camera.bottom = -h / 2;
    this.camera.position.set(c.x, c.y, 100); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(); this.renderer.render(this.scene, this.camera);
  }
  project(point: Point) {
    const p = new THREE.Vector3((point.x - .5) * STAGE.width, (.5 - point.y) * STAGE.height, 10).project(this.camera);
    return { x: (p.x + 1) * this.canvas.clientWidth / 2, y: (1 - p.y) * this.canvas.clientHeight / 2 };
  }
  pick(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect(); this.raycaster.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),this.camera);
    for (const hit of this.raycaster.intersectObjects([...this.actors.values()].filter(actor=>actor.visible))) {
      if (!hit.uv) continue;
      const data=hit.object.userData, pixels=this.pixels.get(data.textureKey)!;
      const u=(hit.uv.x+data.atlas%data.columns)/data.columns, v=(hit.uv.y+data.rows-1-Math.floor(data.atlas/data.columns))/data.rows;
      const px=Math.max(0,Math.min(pixels.width-1,Math.floor(u*pixels.width))), py=Math.max(0,Math.min(pixels.height-1,Math.floor((1-v)*pixels.height))), i=(py*pixels.width+px)*4;
      if (data.keyed ? pixels.data[i+1]!-Math.max(pixels.data[i]!,pixels.data[i+2]!)<60 : pixels.data[i+3]!>35) return data.entityId as string;
    }
    return null;
  }
  dispose() { this.disposed=true;this.request++;this.observer.disconnect();this.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});this.textures.forEach(t=>t.dispose());this.atlas.dispose();this.renderer.dispose(); }
}

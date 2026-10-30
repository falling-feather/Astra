import * as THREE from 'three';
import { Orrery } from './orrery.js';

function starlightEnvironment(renderer) {
  const environment = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vDirection;void main(){vec3 d=normalize(vDirection);vec3 c=vec3(.18,.19,.22);
      c+=vec3(.85,.95,1.15)*pow(max(dot(d,normalize(vec3(-.6,.8,1.))),0.),36.)*3.2;
      c+=vec3(.38,.67,1.)*pow(max(dot(d,normalize(vec3(.85,-.35,.7))),0.),22.)*1.8;
      c+=vec3(1.,.78,.48)*pow(max(dot(d,normalize(vec3(-.6,-.4,-.7))),0.),45.)*2.8;
      c+=vec3(.28,.42,.65)*pow(max(dot(d,normalize(vec3(.35,.9,-.5))),0.),14.);
      gl_FragColor=vec4(c,1.);}`,
    toneMapped: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), material);
  environment.add(sphere);
  const generator = new THREE.PMREMGenerator(renderer);
  const result = generator.fromScene(environment, .025);
  sphere.geometry.dispose(); material.dispose(); generator.dispose();
  return result;
}

function stellarPoints() {
  let seed = 4217;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], sizes = [], phases = [], colors = [];
  for (let i = 0; i < 80; i++) {
    positions.push((random() - .35) * 15, (random() - .5) * 8, -2 - random() * 5);
    sizes.push(i % 23 === 0 ? 8 : 1 + random() * 2.5);
    phases.push(random() * Math.PI * 2);
    const color = new THREE.Color(i % 7 === 0 ? 0xffe1b9 : i % 3 === 0 ? 0x89cbff : 0xd4eaff);
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRatio: { value: 1 } },
    vertexShader: `attribute float aSize;attribute float aPhase;varying vec3 vColor;varying float vIntensity;uniform float uTime;uniform float uRatio;
      void main(){vColor=color;vIntensity=.2+.09*sin(uTime*.55+aPhase);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize*uRatio;}`,
    fragmentShader: `varying vec3 vColor;varying float vIntensity;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float disk=exp(-r*r*85.);float rays=exp(-abs(p.x)*105.-abs(p.y)*10.)+exp(-abs(p.y)*105.-abs(p.x)*10.);float a=(disk+rays*.3)*vIntensity;if(a<.015)discard;gl_FragColor=vec4(vColor,a);}`,
    transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export class CelestialScene {
  constructor(container) {
    this.container = container;
    this.renderCount = 0;
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 760 ? 1.3 : 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 50);
    this.camera.position.z = 15;
    this.environment = starlightEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.scene.add(new THREE.AmbientLight(0x88baff, .55));
    const key = new THREE.DirectionalLight(0xffe3bd, 2.6);
    key.position.set(-3, 5, 7);
    const fill = new THREE.DirectionalLight(0x80c6ff, 2.2);
    fill.position.set(4, -1, 5);
    const rim = new THREE.DirectionalLight(0xc3e6ff, 1.5);
    rim.position.set(-2, -4, -1);
    this.scene.add(key, fill, rim);
    this.orrery = new Orrery();
    this.stars = stellarPoints();
    this.scene.add(this.orrery.root, this.stars);
    this.resize();
  }

  async load() { await this.orrery.load(); }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const mobile = innerWidth <= 760;
    const viewHeight = mobile ? 7.5 : Math.max(7.6, 7.6 * (1.65 / (width / height)));
    const viewWidth = viewHeight * width / height;
    this.camera.left = -viewWidth / 2; this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2; this.camera.bottom = -viewHeight / 2;
    const centerX = mobile ? .5 : innerWidth <= 1100 ? .27 : .326;
    this.camera.position.x = (.5 - centerX) * viewWidth;
    this.camera.position.y = (mobile ? .02 : .018) * viewHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.stars.material.uniforms.uRatio.value = this.renderer.getPixelRatio();
    this.orrery.resize(this.renderer.getPixelRatio(), mobile);
    this.orrery.longArc.visible = !mobile;
  }

  setPointer(x, y) { this.pointer.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))); }

  render(time) {
    this.parallax.lerp(this.pointer, .035);
    this.orrery.root.rotation.y = this.parallax.x * .055;
    this.orrery.root.rotation.x = this.parallax.y * .035;
    this.orrery.update(time);
    this.orrery.occlusion.update(this.camera);
    this.stars.material.uniforms.uTime.value = time;
    this.renderer.render(this.scene, this.camera);
    this.renderCount++;
  }

  get diagnostics() {
    return { frames: this.renderCount, movingNodes: this.orrery.movers.length, rings: this.orrery.rings.length, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, volumeSteps: this.orrery.core.steps, volumeResolution: this.orrery.core.volumeResolution, pixelRatio: this.renderer.getPixelRatio() };
  }

  dispose() {
    const geometries = new Set(), materials = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.orrery.disposeTextures();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

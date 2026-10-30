import * as THREE from 'three';
import { buildNebulaDensity } from './nebula-density.js';

function stars() {
  let seed = 932;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], sizes = [], phases = [], colors = [];
  for (let i = 0; i < 1400; i++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.pow(random(), .57) * 1.5;
    const height = (random() - .5) * (.36 + radius * .38);
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, height);
    sizes.push(i % 137 === 0 ? 10 : .75 + random() * 1.8);
    phases.push(random() * Math.PI * 2);
    const color = new THREE.Color(i % 11 === 0 ? 0xffdfa6 : i % 4 === 0 ? 0xd9edff : 0x79baff);
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRatio: { value: 1 } },
    vertexShader: `attribute float aSize;attribute float aPhase;varying float vGlow;varying vec3 vColor;uniform float uTime;uniform float uRatio;
      void main(){vColor=color;vGlow=.65+.2*sin(uTime*.45+aPhase);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uRatio;}`,
    fragmentShader: `varying float vGlow;varying vec3 vColor;void main(){vec2 p=gl_PointCoord-.5;float light=exp(-dot(p,p)*70.);
      light+=(exp(-abs(p.x)*100.-abs(p.y)*11.)+exp(-abs(p.y)*100.-abs(p.x)*11.))*.23;
      if(light<.018)discard;gl_FragColor=vec4(vColor,light*vGlow);}`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 3;
  return points;
}

export class NebulaCore {
  constructor() {
    this.root = new THREE.Group();
    this.clouds = new THREE.Group();
    this.clouds.rotation.set(.5, -.08, .32);
    this.root.add(this.clouds);
    this.stars = stars();
    this.clouds.add(this.stars);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcdf1, roughness: .065, metalness: .06, transmission: 0, transparent: true, opacity: .095, depthWrite: false, clearcoat: .5, clearcoatRoughness: .09, envMapIntensity: .32 });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1.72, 96, 64), glass);
    this.shell.renderOrder = 4;
    this.root.add(this.shell);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.726, 80, 56), new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vNormal;varying vec3 vView;void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),4.5);gl_FragColor=vec4(.3,.65,.96,f*.24);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    rim.renderOrder = 5;
    this.root.add(rim);
    this.inverse = new THREE.Matrix4();
    this.direction = new THREE.Vector3();
    this.steps = 40;
  }

  async load() {
    this.artwork = await new THREE.TextureLoader().loadAsync('./assets/login/core-nebula.png');
    this.artwork.colorSpace = THREE.SRGBColorSpace;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(this.artwork.image, 0, 0, 256, 256);
    const size = innerWidth <= 760 ? 72 : 96;
    this.volumeResolution = size;
    this.density = new THREE.Data3DTexture(buildNebulaDensity(context.getImageData(0, 0, 256, 256), size), size, size, size);
    this.density.format = THREE.RGBAFormat;
    this.density.minFilter = this.density.magFilter = THREE.LinearFilter;
    this.density.unpackAlignment = 1;
    this.density.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uDensity: { value: this.density }, uDirection: { value: new THREE.Vector3(0, 0, -1) }, uSteps: { value: this.steps } },
      vertexShader: `out vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp sampler3D;in vec3 vPosition;out vec4 outColor;uniform sampler3D uDensity;uniform vec3 uDirection;uniform int uSteps;
        void main(){vec3 direction=normalize(uDirection);float distance=-2.*dot(vPosition,direction);float stepSize=distance/float(uSteps);
          vec3 p=vPosition+direction*stepSize*.5;vec3 color=vec3(0.);float opacity=0.;
          for(int i=0;i<40;i++){if(i>=uSteps)break;vec4 cloud=texture(uDensity,p/3.3+.5);float a=1.-exp(-cloud.a*stepSize*8.2);
            vec3 light=pow(cloud.rgb,vec3(2.2))*1.7;light+=vec3(.025,.065,.12)*cloud.a;
            color+=(1.-opacity)*a*light;opacity+=(1.-opacity)*a;p+=direction*stepSize;}
          if(opacity<.008)discard;outColor=vec4(color/max(opacity,.001),min(opacity*.94,.93));
          #ifdef TONE_MAPPING
            outColor.rgb=toneMapping(outColor.rgb);
          #endif
          outColor=linearToOutputTexel(outColor);
        }`,
      transparent: true, depthWrite: false,
    });
    this.volume = new THREE.Mesh(new THREE.SphereGeometry(1.65, 64, 48), material);
    this.volume.renderOrder = 2;
    this.clouds.add(this.volume);
    // A fine, translucent galactic disk sits inside the 3D density field; it never covers the glass surface.
    const filaments = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.ShaderMaterial({
      uniforms: { uArtwork: { value: this.artwork } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vUv;uniform sampler2D uArtwork;void main(){vec3 dust=texture2D(uArtwork,vUv).rgb;
        float rim=1.-smoothstep(.25,.49,length(vUv-.5));float brightness=max(max(dust.r,dust.g),dust.b);
        float alpha=pow(brightness,.62)*rim*.58;if(alpha<.012)discard;
        gl_FragColor=vec4(dust*1.3,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    filaments.position.z = .045;
    filaments.rotation.z = -.4;
    filaments.renderOrder = 2.5;
    this.clouds.add(filaments);
  }

  resize(ratio, mobile) {
    this.stars.material.uniforms.uRatio.value = ratio;
    this.steps = mobile ? 28 : 40;
    if (this.volume) this.volume.material.uniforms.uSteps.value = this.steps;
  }

  update(time) {
    this.clouds.rotation.y = -.08 + time * .012;
    this.stars.material.uniforms.uTime.value = time;
    if (!this.volume) return;
    this.root.updateWorldMatrix(true, true);
    this.inverse.copy(this.volume.matrixWorld).invert();
    this.direction.set(0, 0, -1).transformDirection(this.inverse);
    this.volume.material.uniforms.uDirection.value.copy(this.direction);
  }

  disposeTextures() { this.artwork?.dispose(); this.density?.dispose(); }
}

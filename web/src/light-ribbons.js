import * as THREE from 'three';
import { curtainPoint, starfirePoint, skyPoint, makeRandom } from './motion.js';
import { createStarCloud } from './sky.js';

const ribbonVertex=/* glsl */`
attribute vec2 aComposition;
varying vec2 vUv;varying vec2 vComposition;
void main(){vUv=uv;vComposition=aComposition;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const curtainFragment=/* glsl */`
uniform float uTime;uniform float uWeight;uniform float uBand;
varying vec2 vUv;varying vec2 vComposition;
float hash(float n){return fract(sin(n*127.1)*43758.5453);}
float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(hash(i),hash(i+1.0),f);}
void main(){
  float u=vUv.x,v=vUv.y;
  float curtain=noise(u*13.0-uTime*.20+uBand)*.55+noise(u*37.0+uTime*.38)*.45;
  float threads=pow(noise(u*740.0+noise(u*80.0-uTime*.4)*7.0+v*.6),2.5);
  threads+=pow(noise(u*310.0-uTime*.16+uBand),3.0)*.45;
  float pulse=.65+.35*sin(u*18.0-uTime*.75+uBand);
  float lowerFade=smoothstep(0.0,.025,v);
  float density=(.035+threads*.70)*(.20+curtain*.80)*pow(1.0-v,2.5)*lowerFade;
  float fringe=exp(-pow((v-.025)/.021,2.0))*(.15+threads*.26)*lowerFade;
  float envelope=smoothstep(0.0,.06,u)*(1.0-smoothstep(.94,1.0,u));
  vec3 cyan=vec3(.20,.72,1.0),violet=vec3(.66,.27,.92),green=vec3(.25,.9,.65);
  vec3 color=mix(cyan,violet,.5+.5*sin(u*10.0-uTime*.18+uBand));
  color=mix(color,green,pow(.5+.5*sin(u*19.0+uBand),4.0)*.45);
  float titleMask=max(smoothstep(.28,.43,vComposition.x),smoothstep(.30,.43,vComposition.y));
  float alpha=(density+fringe)*pulse*envelope*uWeight*titleMask;
  if(alpha<.002)discard;
  gl_FragColor=vec4(color*(1.5+fringe),alpha);
}`;

export class LightRibbons {
  constructor(){
    this.root=new THREE.Group();this.root.name='procedural-aurora-and-starfire';
    this.curtains=[];this.columns=144;this.rows=22;
    for(let band=0;band<3;band++){
      const geometry=new THREE.BufferGeometry();
      const positions=new Float32Array((this.columns+1)*(this.rows+1)*3),uvs=new Float32Array((this.columns+1)*(this.rows+1)*2),indices=[];
      for(let x=0;x<=this.columns;x++)for(let y=0;y<=this.rows;y++){
        const i=x*(this.rows+1)+y;uvs.set([x/this.columns,y/this.rows],i*2);
        if(x<this.columns&&y<this.rows){const next=i+this.rows+1;indices.push(i,next,i+1,next,next+1,i+1);}
      }
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
      geometry.setAttribute('aComposition',new THREE.BufferAttribute(new Float32Array(uvs.length),2).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);
      const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uWeight:{value:0},uBand:{value:band*1.7}},
        vertexShader:ribbonVertex,fragmentShader:curtainFragment,transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
      const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.name=`aurora-curtain-${band}`;
      this.root.add(mesh);this.curtains.push(mesh);
    }
    this.createStarfire();
  }
  createStarfire(){
    const random=makeRandom(882),positions=[],attributes=[],colors=[];this.filaments=[];
    const samples=84;
    for(let stream=0;stream<3;stream++)for(let strand=0;strand<34;strand++){
      const seed=random(),spread=(random()-.5)*.068;
      this.filaments.push({stream,seed,spread});
      const color=new THREE.Color(strand%5===0?0xffdfac:strand%3===0?0xcda3ff:0x83caff);
      for(let point=0;point<samples-1;point++)for(const end of [point,point+1]){
        positions.push(0,0,0);attributes.push(end/(samples-1),seed);colors.push(...color.toArray());
      }
    }
    this.streamSamples=samples;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTrail',new THREE.Float32BufferAttribute(attributes,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uWeight:{value:0}},transparent:true,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`attribute vec2 aTrail;varying vec2 vTrail;varying vec3 vColor;void main(){vTrail=aTrail;vColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform float uTime;uniform float uWeight;varying vec2 vTrail;varying vec3 vColor;void main(){float pulse=pow(.5+.5*sin(vTrail.x*20.0-uTime*1.5+vTrail.y*9.0),9.0);float end=smoothstep(0.0,.13,vTrail.x)*(1.0-smoothstep(.9,1.0,vTrail.x));gl_FragColor=vec4(vColor*(.5+pulse*1.2),(.012+pulse*.18)*end*uWeight);}`,
    });
    this.starfire=new THREE.LineSegments(geometry,material);this.starfire.frustumCulled=false;this.root.add(this.starfire);
    this.fireSparks=Array.from({length:210},(_,i)=>({stream:i%3,seed:random(),spread:(random()-.5)*.016,
      x:.5,y:.3,depth:75,size:5+random()*7,alpha:.8,color:i%4===0?0xffdcac:0xaacbff}));
    this.sparks=createStarCloud(this.fireSparks);this.sparks.frustumCulled=false;this.root.add(this.sparks);
    this.glows=[];
    for(let stream=0;stream<3;stream++){
      const geometry=new THREE.PlaneGeometry(1,1,90,1);
      const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uWeight:{value:0},uHue:{value:stream}},
        transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`uniform float uTime;uniform float uWeight;uniform float uHue;varying vec2 vUv;
        void main(){float edge=pow(1.0-abs(vUv.y*2.0-1.0),3.0);float ends=sin(vUv.x*3.14159265);float pulse=pow(.5+.5*sin(vUv.x*22.0-uTime*1.4+uHue),5.0);
        vec3 color=mix(vec3(.19,.4,1.0),vec3(.72,.35,.9),.5+.5*sin(vUv.x*6.0+uHue));gl_FragColor=vec4(color*(1.0+pulse),edge*ends*(.07+pulse*.15)*uWeight);}`,
      });
      const glow=new THREE.Mesh(geometry,material);glow.frustumCulled=false;this.root.add(glow);this.glows.push(glow);
    }
  }
  resize(height,ratio){this.sparks.material.uniforms.uScale.value=Math.max(.65,height/941)*ratio;}
  update(time,weights){
    for(let band=0;band<this.curtains.length;band++){
      const mesh=this.curtains[band];mesh.visible=weights[2]>.001;
      if(!mesh.visible)continue;
      mesh.material.uniforms.uTime.value=time;mesh.material.uniforms.uWeight.value=weights[2]*.72;
      const position=mesh.geometry.attributes.position,composition=mesh.geometry.attributes.aComposition;let i=0;
      for(let x=0;x<=this.columns;x++)for(let y=0;y<=this.rows;y++){
        const p=curtainPoint(x/this.columns,y/this.rows,time,band),world=skyPoint(p.x,p.y,p.depth);
        composition.setXY(i,p.x,p.y);position.setXYZ(i++,world.x,world.y,world.z);
      }
      position.needsUpdate=true;composition.needsUpdate=true;
    }
    this.starfire.visible=weights[1]>.001;
    this.sparks.visible=this.starfire.visible;
    this.glows.forEach(glow=>glow.visible=this.starfire.visible);
    if(!this.starfire.visible)return;
    this.starfire.material.uniforms.uTime.value=time;this.starfire.material.uniforms.uWeight.value=weights[1];
    const position=this.starfire.geometry.attributes.position;let index=0;
    for(const {stream,seed,spread} of this.filaments){
      for(let point=0;point<this.streamSamples-1;point++)for(const end of [point,point+1]){
        const u=end/(this.streamSamples-1);
        const p=starfirePoint(u,time,stream,seed,spread),world=skyPoint(p.x,p.y,p.depth);position.setXYZ(index++,world.x,world.y,world.z);
      }
    }
    position.needsUpdate=true;
    this.sparks.material.uniforms.uTime.value=time;this.sparks.material.uniforms.uGain.value=weights[1]*.65;
    const points=this.sparks.geometry.attributes.position,alphas=this.sparks.geometry.attributes.aAlpha;
    this.fireSparks.forEach((spark,i)=>{
      const u=(time*.075+spark.seed)%1,p=starfirePoint(u,time,spark.stream,spark.seed,spark.spread),world=skyPoint(p.x,p.y,p.depth);
      points.setXYZ(i,world.x,world.y,world.z);alphas.setX(i,Math.pow(Math.sin(u*Math.PI),.65)*.9);
    });
    points.needsUpdate=true;alphas.needsUpdate=true;
    this.glows.forEach((glow,stream)=>{
      const positions=glow.geometry.attributes.position,uvs=glow.geometry.attributes.uv;
      for(let i=0;i<positions.count;i++){
        const u=uvs.getX(i),p=starfirePoint(u,time,stream,.5,0);
        const width=.016*Math.sin(u*Math.PI);
        const world=skyPoint(p.x,p.y+(uvs.getY(i)*2-1)*width,p.depth+.5);positions.setXYZ(i,world.x,world.y,world.z);
      }
      positions.needsUpdate=true;glow.material.uniforms.uTime.value=time;glow.material.uniforms.uWeight.value=weights[1];
    });
  }
  dispose(){this.root.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});}
}

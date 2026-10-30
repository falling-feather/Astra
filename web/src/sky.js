import * as THREE from 'three';
import { skyPoint, makeRandom, normalRandom, gatherParticle, VIEW } from './motion.js';

const pointVertex=/* glsl */`
uniform float uTime;uniform float uScale;uniform float uGain;
attribute float aSize;attribute float aSeed;attribute float aAlpha;
varying vec3 vColor;varying float vAlpha;
void main(){
  float pulse=.38+.62*pow(.5+.5*sin(uTime*(.6+aSeed*.7)+aSeed*73.0),3.0);
  vColor=color*uGain;vAlpha=aAlpha*pulse;
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mv;gl_PointSize=aSize*uScale;
}`;
const pointFragment=/* glsl */`
varying vec3 vColor;varying float vAlpha;
void main(){
  vec2 p=gl_PointCoord-.5;float r=length(p);
  float core=exp(-r*r*240.0);
  float halo=exp(-r*r*24.0)*.10;
  float rays=(exp(-abs(p.x)*65.0-abs(p.y)*10.0)+exp(-abs(p.y)*65.0-abs(p.x)*10.0))*.34;
  float alpha=(core+halo+rays)*vAlpha*(1.0-smoothstep(.35,.5,r));
  if(alpha<.002)discard;
  gl_FragColor=vec4(vColor*3.6,alpha);
}`;

export function createStarCloud(data){
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(data.length*3),colors=new Float32Array(data.length*3);
  for(let i=0;i<data.length;i++){
    const point=skyPoint(data[i].x,data[i].y,data[i].depth);
    positions.set([point.x,point.y,point.z],i*3);colors.set(new THREE.Color(data[i].color).toArray(),i*3);
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  for(const [key,field] of [['aSize','size'],['aSeed','seed'],['aAlpha','alpha']])geometry.setAttribute(key,new THREE.Float32BufferAttribute(data.map(p=>p[field]),1));
  const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uScale:{value:1},uGain:{value:1}},vertexShader:pointVertex,fragmentShader:pointFragment,
    transparent:true,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const mesh=new THREE.Points(geometry,material);mesh.frustumCulled=false;return mesh;
}

function lineBuffer(count){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
  const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  line.frustumCulled=false;return line;
}

export class CelestialSky {
  constructor(){
    this.root=new THREE.Group();this.root.name='independent-celestial-layers';
    const random=makeRandom(90210),stars=[];
    const color=()=>{const c=random();return c>.93?0xffd6a0:c>.79?0xd8b7ff:0xbddfff;};
    for(let i=0;i<14500;i++){
      const band=i>8700,t=random();
      const x=band?.27+t*.58+normalRandom(random)*.053:random();
      const y=band?.67-t*.57+normalRandom(random)*.04:random()*.69;
      if(x<0||x>1||y<.005||y>.695)continue;
      const titleDensity=.08+.92*Math.max(Math.max(0,Math.min(1,(x-.2)/.23)),Math.max(0,Math.min(1,(y-.25)/.2)));
      if(random()>titleDensity)continue;
      const bright=i%571===0;
      stars.push({x,y,depth:87+random()*25,size:bright?20+random()*12:2+Math.pow(random(),5)*5,
        seed:random(),alpha:bright?.9:band?.16+random()*.48:.16+random()*.55,color:color()});
    }
    this.starCount=stars.length;this.stars=createStarCloud(stars);this.root.add(this.stars);
    const anchors=[[.57,.21],[.69,.12],[.83,.09],[.91,.22],[.79,.36],[.62,.43],[.92,.42],[.74,.26]];
    this.swarmData=Array.from({length:560},(_,i)=>{
      const target=anchors[i%anchors.length];
      return {sx:.34+random()*.70,sy:.20+random()*.45,tx:target[0]+normalRandom(random)*.021,ty:target[1]+normalRandom(random)*.016,
        delay:random()*2.1,seed:random(),depth:67+random()*12,x:target[0],y:target[1],size:4+random()*5,alpha:.8,color:color()};
    });
    this.swarm=createStarCloud(this.swarmData);this.swarm.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.swarm.geometry.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage);this.root.add(this.swarm);
    this.trailCount=80;this.trailSteps=8;
    this.trails=lineBuffer(this.trailCount*(this.trailSteps-1)*2);this.root.add(this.trails);
    this.meteors=lineBuffer(3*28*2);this.root.add(this.meteors);
  }

  async load(){
    this.texture=await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/atmosphere.png`);
    this.texture.colorSpace=THREE.SRGBColorSpace;
    this.atmosphere=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:this.texture}));
    this.atmosphere.name='starless-atmosphere-and-horizon';this.atmosphere.frustumCulled=false;this.root.add(this.atmosphere);
  }
  resize(width,height,ratio){
    for(const mesh of [this.stars,this.swarm])mesh.material.uniforms.uScale.value=Math.max(.65,height/941)*ratio;
    if(!this.atmosphere)return;
    const stretch=Math.max(1,width/height/VIEW.aspect),attribute=this.atmosphere.geometry.attributes.position;
    const corners=[[0,0],[1,0],[0,1],[1,1]];
    for(let i=0;i<4;i++){
      const p=skyPoint((corners[i][0]-.5)*stretch+.5,corners[i][1],160);
      attribute.setXYZ(i,p.x,p.y-VIEW.height,p.z);
    }
    attribute.needsUpdate=true;
  }
  update(time,weights){
    this.stars.material.uniforms.uTime.value=time;this.stars.material.uniforms.uGain.value=.7+weights[0]*.3;
    this.swarm.material.uniforms.uTime.value=time;this.swarm.material.uniforms.uGain.value=1.15;
    const positions=this.swarm.geometry.attributes.position,alphas=this.swarm.geometry.attributes.aAlpha;
    for(let i=0;i<this.swarmData.length;i++){
      const data=this.swarmData[i],moving=gatherParticle(data,time),p=skyPoint(moving.x,moving.y,data.depth);
      positions.setXYZ(i,p.x,p.y,p.z);alphas.setX(i,moving.alpha*(.58+.35*data.seed));
    }
    positions.needsUpdate=true;alphas.needsUpdate=true;
    const trailPositions=this.trails.geometry.attributes.position,trailColors=this.trails.geometry.attributes.color;
    let vertex=0;
    for(let i=0;i<this.trailCount;i++){
      const data=this.swarmData[i*7],current=gatherParticle(data,time);
      for(let j=0;j<this.trailSteps-1;j++){
        for(const k of [j,j+1]){
          const past=gatherParticle(data,time-k*.065),p=skyPoint(past.x,past.y,data.depth);
          const alpha=current.alpha*past.alpha*(1-k/this.trailSteps)*(1-current.progress)*.18;
          trailPositions.setXYZ(vertex,p.x,p.y,p.z);trailColors.setXYZ(vertex,alpha*.37,alpha*.67,alpha);vertex++;
        }
      }
    }
    trailPositions.needsUpdate=true;trailColors.needsUpdate=true;
    this.updateMeteors(time);
  }
  updateMeteors(time){
    const position=this.meteors.geometry.attributes.position,color=this.meteors.geometry.attributes.color;
    let vertex=0;
    for(let meteor=0;meteor<3;meteor++){
      const age=((time+meteor*5.7)%18)-2.2,progress=age/1.6;
      const active=progress>0&&progress<1;
      for(let j=0;j<28;j++)for(const k of [j,j+1]){
        const tail=k/28,travel=progress-tail*.25;
        const p=skyPoint([.94,.72,.90][meteor]-travel*.27,[.09,.18,.29][meteor]+travel*.19,60);
        const alpha=active?Math.sin(progress*Math.PI)*Math.pow(1-tail,2)*2.5:0;
        position.setXYZ(vertex,p.x,p.y,p.z);color.setXYZ(vertex,alpha*.65,alpha*.82,alpha);vertex++;
      }
    }
    position.needsUpdate=true;color.needsUpdate=true;
  }
  dispose(){this.root.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});this.texture?.dispose();}
}

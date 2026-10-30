import * as THREE from 'three';
import { OCEAN_BANDS, oceanSurface, oceanCrestAt, createSpraySeeds, oceanSprayAt } from './ocean-motion.js';

export function createOceanGeometry(){
  const geometry=new THREE.PlaneGeometry(2,2,112,56),count=geometry.attributes.position.count;
  geometry.setAttribute('aWaveOffset',new THREE.BufferAttribute(new Float32Array(count*2),2));
  geometry.setAttribute('aWaveInfo',new THREE.BufferAttribute(new Float32Array(count*3),3));
  return geometry;
}

const localVertex=`
uniform vec4 uRect;
uniform vec2 uReferenceSize;
uniform vec2 uAnchor;
uniform float uRotation;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform vec2 uPointer;
uniform vec2 uParallax;
attribute vec3 aWaveInfo;
varying vec2 vUv;
varying vec3 vInfo;
void main(){
  vUv=uv;vInfo=aWaveInfo;
  vec2 local=position.xy-uAnchor*uRect.zw;
  float c=cos(uRotation),s=sin(uRotation);
  vec2 reference=uRect.xy+uAnchor*uRect.zw+vec2(local.x*c-local.y*s,local.x*s+local.y*c);
  vec2 p=((reference+uPointer*uParallax)/uReferenceSize-uOffset)/uCrop;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;

const crestFragment=`
uniform float uTime;
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vInfo;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
void main(){
  float depth=vInfo.x,breaking=vInfo.y,edge=vInfo.z;
  float grain=noise(vec2(vUv.x*420.-uTime*9.,vUv.y*29.+uTime*1.6));
  float gaps=smoothstep(.38,.61,noise(vec2(vUv.x*77.+uTime*.6,depth*19.-uTime*.2)));
  float visibility=smoothstep(.04,.25,depth);
  float lip=exp(-vUv.y*vUv.y*32.);
  float foam=lip*(.45+.55*grain)*gaps*(.16+.84*breaking)*visibility;
  float face=(1.-vUv.y)*smoothstep(.1,.35,vUv.y)*visibility*(.10+.08*depth);
  float alpha=min(.68,foam*.82+face)*edge*uOpacity;
  vec3 color=mix(vec3(.012,.025,.043),vec3(.30,.41,.52),clamp(foam*4.5,0.,1.));
  gl_FragColor=vec4(color*uTint,alpha);
  #include <colorspace_fragment>
}`;

const sprayVertex=`
uniform vec4 uRect;
uniform vec2 uReferenceSize;
uniform vec2 uAnchor;
uniform float uRotation;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform vec2 uPointer;
uniform vec2 uParallax;
uniform float uPixelRatio;
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main(){
  vec2 local=position.xy-uAnchor*uRect.zw;
  float c=cos(uRotation),s=sin(uRotation);
  vec2 reference=uRect.xy+uAnchor*uRect.zw+vec2(local.x*c-local.y*s,local.x*s+local.y*c);
  vec2 p=((reference+uPointer*uParallax)/uReferenceSize-uOffset)/uCrop;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
  gl_PointSize=aSize*uPixelRatio;vAlpha=aAlpha;
}`;
const sprayFragment=`
uniform float uOpacity;
uniform vec3 uTint;
varying float vAlpha;
void main(){
  float r=length(gl_PointCoord-.5);
  float core=1.-smoothstep(.035,.48,r);
  gl_FragColor=vec4(vec3(.43,.54,.63)*uTint,core*vAlpha*uOpacity);
  #include <colorspace_fragment>
}`;

/** Owns only sea geometry and spray; all materials inherit the ocean layer transform. */
export function createOceanEffects(scene,layer,geometry,uniforms){
  const segments=112,vertices=OCEAN_BANDS*segments*6;
  const crestGeometry=new THREE.BufferGeometry();
  crestGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(vertices*3),3));
  crestGeometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(vertices*2),2));
  crestGeometry.setAttribute('aWaveInfo',new THREE.BufferAttribute(new Float32Array(vertices*3),3));
  const crestMaterial=new THREE.ShaderMaterial({vertexShader:localVertex,fragmentShader:crestFragment,uniforms,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  const crests=new THREE.Mesh(crestGeometry,crestMaterial);crests.renderOrder=31;crests.frustumCulled=false;scene.add(crests);

  const seeds=createSpraySeeds(210),sprayGeometry=new THREE.BufferGeometry();
  sprayGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(seeds.length*3),3));
  sprayGeometry.setAttribute('aSize',new THREE.BufferAttribute(new Float32Array(seeds.length),1));
  sprayGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(seeds.length),1));
  const sprayMaterial=new THREE.ShaderMaterial({vertexShader:sprayVertex,fragmentShader:sprayFragment,uniforms,transparent:true,depthTest:false,depthWrite:false});
  const spray=new THREE.Points(sprayGeometry,sprayMaterial);spray.renderOrder=32;spray.frustumCulled=false;scene.add(spray);
  let water={width:1672,height:941,waterline:layer.anchors.waterline.y},lastTime=0,activeSpray=0;
  const uv=geometry.attributes.uv,offset=geometry.attributes.aWaveOffset,info=geometry.attributes.aWaveInfo;
  const faceCorners=[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];

  function update(time){
    lastTime=time;water={width:uniforms.uRect.value.z,height:uniforms.uRect.value.w,waterline:layer.anchors.waterline.y};
    for(let index=0;index<uv.count;index++){
      const sample=oceanSurface(uv.getX(index),1-uv.getY(index),time,water);
      offset.setXY(index,sample.dx,sample.dy);info.setXYZ(index,sample.lighting,sample.foam,sample.depth);
    }
    offset.needsUpdate=true;info.needsUpdate=true;

    for(let band=0;band<OCEAN_BANDS;band++){
      const row=Array.from({length:segments+1},(_,index)=>oceanCrestAt(index/segments,band,time,water));
      for(let segment=0;segment<segments;segment++){
        for(let corner=0;corner<6;corner++){
          const [side,down]=faceCorners[corner],sample=row[segment+side],vertex=(band*segments+segment)*6+corner;
          const depth=Math.max(0,Math.min(1,sample.depth)),faceHeight=(5+22*Math.sqrt(depth))*(.84+.16*Math.sin((segment+side)/segments*41+time*1.2))*water.height/941;
          crestGeometry.attributes.position.setXYZ(vertex,sample.x,sample.y+down*faceHeight,0);
          crestGeometry.attributes.uv.setXY(vertex,(segment+side)/segments,down);
          crestGeometry.attributes.aWaveInfo.setXYZ(vertex,depth,sample.foam,sample.visible?sample.edge:0);
        }
      }
    }
    for(const attribute of Object.values(crestGeometry.attributes))attribute.needsUpdate=true;
    activeSpray=0;
    seeds.forEach((seed,index)=>{
      const sample=oceanSprayAt(seed,time,water);
      sprayGeometry.attributes.position.setXYZ(index,sample.x,sample.y,0);sprayGeometry.attributes.aSize.setX(index,sample.size*2.2);sprayGeometry.attributes.aAlpha.setX(index,sample.alpha);
      if(sample.alpha>.01)activeSpray++;
    });
    for(const attribute of Object.values(sprayGeometry.attributes))attribute.needsUpdate=true;
  }
  return {
    update,
    snapshot(){return {oceanVertices:uv.count,oceanSamples:[[.22,.88],[.5,.78],[.8,.94]].map(([u,v])=>({u,v,...oceanSurface(u,v,lastTime,water)})),midOceanSample:{u:.495,v:.704,...oceanSurface(.495,.704,lastTime,water)},crestSamples:Array.from({length:OCEAN_BANDS},(_,index)=>oceanCrestAt(.44,index,lastTime,water)),activeSprayCount:activeSpray,spraySamples:seeds.slice(0,8).map(seed=>oceanSprayAt(seed,lastTime,water))};},
    dispose(){scene.remove(crests,spray);geometry.dispose();crestGeometry.dispose();crestMaterial.dispose();sprayGeometry.dispose();sprayMaterial.dispose();},
  };
}

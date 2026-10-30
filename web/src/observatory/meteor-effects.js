import * as THREE from 'three';
import { METEOR_COUNT, meteorAt, meteorTrailPoint } from './motion.js';

const trailVertex=`
attribute float aAlpha;
attribute float aAcross;
uniform vec2 uCrop;
uniform vec2 uOffset;
varying float vAlpha;
varying float vAcross;
void main(){vec2 p=(position.xy-uOffset)/uCrop;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);vAlpha=aAlpha;vAcross=aAcross;}`;
const trailFragment=`
varying float vAlpha;
varying float vAcross;
void main(){float core=exp(-vAcross*vAcross*3.4);gl_FragColor=vec4(.72,.82,.98,vAlpha*core*.88);}`;
const headVertex=`
attribute float aAlpha;
attribute float aSize;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform float uPixelRatio;
varying float vAlpha;
void main(){vec2 p=(position.xy-uOffset)/uCrop;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);gl_PointSize=aSize*uPixelRatio;vAlpha=aAlpha;}`;
const headFragment=`
varying float vAlpha;
void main(){vec2 p=gl_PointCoord-.5;float core=exp(-dot(p,p)*100.);float glow=exp(-dot(p,p)*23.)*.24;float ray=(exp(-abs(p.x)*95.)*exp(-abs(p.y)*10.)+exp(-abs(p.y)*95.)*exp(-abs(p.x)*10.))*.075;gl_FragColor=vec4(.86,.92,1.,(core+glow+ray)*vAlpha);}`;

export function createMeteorEffects(scene,{crop,offset,pixelRatio}){
  const segments=16,vertices=METEOR_COUNT*segments*6,uniforms={uCrop:crop,uOffset:offset,uPixelRatio:pixelRatio};
  const trailGeometry=new THREE.BufferGeometry();trailGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(vertices*3),3));trailGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(vertices),1));trailGeometry.setAttribute('aAcross',new THREE.BufferAttribute(new Float32Array(vertices),1));
  const trailMaterial=new THREE.ShaderMaterial({vertexShader:trailVertex,fragmentShader:trailFragment,uniforms,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
  const trails=new THREE.Mesh(trailGeometry,trailMaterial);trails.renderOrder=21;trails.frustumCulled=false;scene.add(trails);
  const headGeometry=new THREE.BufferGeometry();headGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(METEOR_COUNT*3),3));headGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(METEOR_COUNT),1));headGeometry.setAttribute('aSize',new THREE.BufferAttribute(new Float32Array(METEOR_COUNT),1));
  const headMaterial=new THREE.ShaderMaterial({vertexShader:headVertex,fragmentShader:headFragment,uniforms,transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending});
  const heads=new THREE.Points(headGeometry,headMaterial);heads.renderOrder=22;heads.frustumCulled=false;scene.add(heads);
  const corners=[[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]];
  let lastTime=0;
  function update(time){
    lastTime=time;
    for(let index=0;index<METEOR_COUNT;index++){
      const sample=meteorAt(time,index);
      headGeometry.attributes.position.setXYZ(index,sample.x,sample.y,0);headGeometry.attributes.aAlpha.setX(index,sample.alpha);headGeometry.attributes.aSize.setX(index,sample.headSize);
      for(let segment=0;segment<segments;segment++){
        for(let corner=0;corner<6;corner++){
          const [advance,side]=corners[corner],point=meteorTrailPoint(sample,(segment+advance)/segments),vertex=(index*segments+segment)*6+corner;
          const x=point.x-sample.direction.y*point.halfWidth*side/1672,y=point.y+sample.direction.x*point.halfWidth*side/941;
          trailGeometry.attributes.position.setXYZ(vertex,x,y,0);trailGeometry.attributes.aAlpha.setX(vertex,point.alpha);trailGeometry.attributes.aAcross.setX(vertex,side);
        }
      }
    }
    for(const geometry of [trailGeometry,headGeometry])for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;
  }
  return {update,snapshot(){const samples=Array.from({length:METEOR_COUNT},(_,index)=>({index,...meteorAt(lastTime,index)}));return {meteorSamples:samples,activeMeteorCount:samples.filter(sample=>sample.active).length};},dispose(){scene.remove(trails,heads);trailGeometry.dispose();trailMaterial.dispose();headGeometry.dispose();headMaterial.dispose();}};
}

import * as THREE from 'three';
import {projectConnectedWorldPoint} from './panorama-scene-projection.js';
import {createSelectionParticles,sampleSelectionParticle,sampleSelectionFilament,sampleSelectionFlare} from './panorama-scene-selection.js';
import * as shaders from './panorama-scene-materials.js';

const lineVertex=`
attribute vec3 aColor;
attribute float aAlpha;
attribute float aAcross;
uniform vec2 uViewport;
varying vec3 vColor;
varying float vAlpha;
varying float vAcross;
void main(){gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);vColor=aColor;vAlpha=aAlpha;vAcross=aAcross;}`;
const lineFragment=`
varying vec3 vColor;
varying float vAlpha;
varying float vAcross;
void main(){
  gl_FragColor=vec4(vColor,vAlpha*exp(-vAcross*vAcross*2.4));
  #include <colorspace_fragment>
}`;
const flareVertex=`
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uZoomSize;
varying vec3 vColor;
varying float vAlpha;
void main(){gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);gl_PointSize=min(32.,aSize*sqrt(uZoomSize))*uPixelRatio;vColor=aColor;vAlpha=aAlpha;}`;
const flareFragment=`
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 p=gl_PointCoord-.5;float radius=dot(p,p);
  float core=exp(-radius*90.),glow=exp(-radius*22.)*.15;
  float rays=(exp(-abs(p.x)*100.)*exp(-abs(p.y)*7.)+exp(-abs(p.y)*100.)*exp(-abs(p.x)*7.))*.14;
  gl_FragColor=vec4(vColor,(core+glow+rays)*vAlpha);
  #include <colorspace_fragment>
}`;

/** Three reusable batches own the selected region's flowing particles, light filaments and flares. */
export function createSelectionEffects({scene,scope,catalog,world,common,colors}){
  const perGalaxy=112,lineCount=6,lineSegments=48,particles=createSelectionParticles(catalog,perGalaxy);
  const softColors=colors.map(color=>color.clone().lerp(new THREE.Color(.82,.89,.98),.28));
  const ownMaterial=(vertexShader,fragmentShader,uniforms)=>scope.own(new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
  function geometry(count,attributes){
    const result=scope.own(new THREE.BufferGeometry());
    for(const [name,size] of attributes)result.setAttribute(name,new THREE.BufferAttribute(new Float32Array(count*size),size));
    return result;
  }
  function attach(object,order){object.renderOrder=order;object.frustumCulled=false;scene.add(object);return object;}
  const particleGeometry=geometry(particles.length,[['position',3],['aSize',1],['aSeed',1],['aAlpha',1],['aColor',3]]);
  const particleMaterial=ownMaterial(shaders.pointVertex,shaders.pointFragment,{...common,uCoreFalloff:{value:34},uTwinkleFloor:{value:.76},uRayGain:{value:.035}});
  attach(new THREE.Points(particleGeometry,particleMaterial),5.1);
  const lineGeometry=geometry(catalog.length*lineCount*lineSegments*6,[['position',3],['aAlpha',1],['aColor',3],['aAcross',1]]);
  attach(new THREE.Mesh(lineGeometry,ownMaterial(lineVertex,lineFragment,{uViewport:common.uViewport})),4.5);
  const flareGeometry=geometry(catalog.length*3,[['position',3],['aAlpha',1],['aSize',1],['aColor',3]]);
  attach(new THREE.Points(flareGeometry,ownMaterial(flareVertex,flareFragment,common)),5.5);
  const sample={},screen={},a={},b={},screenA={},screenB={};
  const corners=[[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]];
  let lastTime=0,lastIntensity=1,lastWeights=new Float64Array(catalog.length),lastNebulae=[],lastViewport=null,activeParticles=0,activeFlares=0;

  function update(time,viewport,nebulae,weights,intensity,mobile){
    lastTime=time;lastIntensity=intensity;lastWeights=weights;lastNebulae=nebulae;lastViewport=viewport;
    let particleIndex=0,lineIndex=0,flareIndex=0;activeParticles=0;activeFlares=0;
    for(let region=0;region<catalog.length;region++){
      const weight=weights[region],nebula=nebulae[region],color=softColors[region];
      if(weight<.0001||!nebula.projection.visible)continue;
      const limit=mobile?72:perGalaxy;
      for(let index=0;index<limit;index++){
        const particle=particles[region*perGalaxy+index];sampleSelectionParticle(particle,nebula.entry,time,weight,sample);
        projectConnectedWorldPoint(sample,nebula.entry.position,nebula.projection,viewport,world,screen);
        const attrs=particleGeometry.attributes,alpha=Math.min(.88,sample.alpha*intensity);
        attrs.position.setXYZ(particleIndex,screen.x,screen.y,0);attrs.aSize.setX(particleIndex,sample.size);attrs.aSeed.setX(particleIndex,particle.phase);attrs.aAlpha.setX(particleIndex,alpha);attrs.aColor.setXYZ(particleIndex,color.r,color.g,color.b);particleIndex++;
        if(alpha>.05)activeParticles++;
      }
      for(let line=0;line<lineCount;line++)for(let segment=0;segment<lineSegments;segment++){
        sampleSelectionFilament(nebula.entry,line,segment/lineSegments,time,weight,a);sampleSelectionFilament(nebula.entry,line,(segment+1)/lineSegments,time,weight,b);
        projectConnectedWorldPoint(a,nebula.entry.position,nebula.projection,viewport,world,screenA);projectConnectedWorldPoint(b,nebula.entry.position,nebula.projection,viewport,world,screenB);
        const dx=screenB.x-screenA.x,dy=screenB.y-screenA.y,length=Math.max(.001,Math.hypot(dx,dy));
        for(const [end,side] of corners){
          const p=end?screenB:screenA,source=end?b:a,halfWidth=.65;
          lineGeometry.attributes.position.setXYZ(lineIndex,p.x-dy/length*halfWidth*side,p.y+dx/length*halfWidth*side,0);
          lineGeometry.attributes.aAlpha.setX(lineIndex,Math.min(.72,source.alpha*intensity));lineGeometry.attributes.aAcross.setX(lineIndex,side);lineGeometry.attributes.aColor.setXYZ(lineIndex,color.r,color.g,color.b);lineIndex++;
        }
      }
      for(let index=0;index<3;index++){
        sampleSelectionFlare(nebula.entry,index,time,weight,sample);projectConnectedWorldPoint(sample,nebula.entry.position,nebula.projection,viewport,world,screen);
        const alpha=Math.min(.9,sample.alpha*intensity),attrs=flareGeometry.attributes;
        attrs.position.setXYZ(flareIndex,screen.x,screen.y,0);attrs.aSize.setX(flareIndex,sample.size);attrs.aAlpha.setX(flareIndex,alpha);attrs.aColor.setXYZ(flareIndex,color.r,color.g,color.b);flareIndex++;if(alpha>.05)activeFlares++;
      }
    }
    particleGeometry.setDrawRange(0,particleIndex);lineGeometry.setDrawRange(0,lineIndex);flareGeometry.setDrawRange(0,flareIndex);
    for(const buffer of [particleGeometry,lineGeometry,flareGeometry])for(const attribute of Object.values(buffer.attributes))attribute.needsUpdate=true;
  }

  return {
    update,
    snapshot(){
      const particleSamples=[],flareSamples=[];
      if(lastViewport)for(let region=0;region<catalog.length;region++){
        if(lastWeights[region]<.0001)continue;
        const nebula=lastNebulae[region];
        for(let index=0;index<2;index++){
          const result=sampleSelectionParticle(particles[region*perGalaxy+index],nebula.entry,lastTime,lastWeights[region]);
          particleSamples.push({id:nebula.entry.id,weight:lastWeights[region],...result,sourceAlpha:result.alpha,alpha:Math.min(.88,result.alpha*lastIntensity),screen:projectConnectedWorldPoint(result,nebula.entry.position,nebula.projection,lastViewport,world)});
        }
        for(let index=0;index<3;index++){const result=sampleSelectionFlare(nebula.entry,index,lastTime,lastWeights[region]);flareSamples.push({id:nebula.entry.id,...result,sourceAlpha:result.alpha,alpha:Math.min(.9,result.alpha*lastIntensity)});}
      }
      return {effectIntensity:lastIntensity,activeEffectParticles:activeParticles,activeSelectionFlares:activeFlares,effectParticleSamples:particleSamples,selectionFlareSamples:flareSamples};
    },
  };
}

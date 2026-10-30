import * as THREE from 'three';
import { sceneFrame, seededRandom, gatherStar } from './motion.js';
import { REFERENCE_FRAME, STAR_FIELD, createLayerState, patchLayer, layerRect, layerTransform, layerTint, layerInventory, contactShadows, registrationMetrics } from './layers.js';
import { createOceanGeometry, createOceanEffects } from './ocean-effects.js';
import { createMeteorEffects } from './meteor-effects.js';
import { DESKTOP_MIN_WIDTH } from './desktop-composition.js';

const imageVertex=`
uniform vec4 uRect;
uniform vec2 uReferenceSize;
uniform vec2 uAnchor;
uniform float uRotation;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform vec2 uPointer;
uniform vec2 uParallax;
#ifdef OCEAN_LAYER
attribute vec2 aWaveOffset;
attribute vec3 aWaveInfo;
varying vec3 vWave;
#endif
varying vec2 vUv;
varying vec2 vReference;
void main(){
  vUv=uv;
  vec2 local=(vec2(uv.x,1.-uv.y)-uAnchor)*uRect.zw;
  #ifdef OCEAN_LAYER
  local+=aWaveOffset;
  vWave=aWaveInfo;
  #endif
  float c=cos(uRotation),s=sin(uRotation);
  vec2 rotated=vec2(local.x*c-local.y*s,local.x*s+local.y*c);
  vec2 reference=uRect.xy+uAnchor*uRect.zw+rotated;
  vReference=reference/uReferenceSize;
  vec2 p=((reference+uPointer*uParallax)/uReferenceSize-uOffset)/uCrop;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;

const imageFragment=`
uniform sampler2D uImage;
uniform vec3 uTint;
uniform float uOpacity;
uniform vec3 uEnvironmentColor;
uniform float uEnvironmentStrength;
uniform float uEnvironmentX;
uniform float uDesktopComposition;
uniform vec2 uCrop;
uniform vec2 uOffset;
varying vec2 vUv;
varying vec2 vReference;
void main(){
  vec4 art=texture2D(uImage,vUv);
  #ifdef FOREGROUND_SKY
  float screenY=(vReference.y-uOffset.y)/uCrop.y;
  art.a*=mix(smoothstep(.34,.62,vReference.y),smoothstep(.43,.695,screenY),uDesktopComposition);
  #endif
  if(art.a<.002)discard;
  #ifdef COASTAL_LIGHT
  float luminance=dot(art.rgb,vec3(.2126,.7152,.0722));
  float screenX=(vReference.x-uOffset.x)/uCrop.x;
  float sourceFalloff=.24+.76*exp(-pow((screenX-uEnvironmentX)/.48,2.));
  art.rgb*=vec3(.90,.95,1.02);
  #ifdef COAST_ROCK
  art.rgb=art.rgb/(1.+art.rgb*.8)*.86;
  #endif
  float reflectedLight=smoothstep(.006,.24,luminance)*.020;
  #ifdef FOREGROUND_SKY
  reflectedLight=(.2+.8*smoothstep(.22,.61,vReference.y))*.012;
  art.rgb=mix(vec3(luminance),art.rgb,.85);
  #endif
  art.rgb+=uEnvironmentColor*uEnvironmentStrength*sourceFalloff*reflectedLight;
  #endif
  gl_FragColor=vec4(art.rgb*uTint,art.a*uOpacity);
  #include <colorspace_fragment>
}`;

const oceanFragment=`
uniform sampler2D uImage;
uniform vec4 uRect;
uniform vec2 uReferenceSize;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uEnvironmentColor;
uniform float uEnvironmentStrength;
uniform float uEnvironmentX;
uniform vec2 uCrop;
uniform vec2 uOffset;
varying vec2 vUv;
varying vec2 vReference;
varying vec3 vWave;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
}
void main(){
  vec2 p=vReference;
  float depth=vWave.z;
  float weight=pow(depth,1.25),t=uTime;
  float ripples=sin(p.x*310.+p.y*170.-t*4.2)*sin(p.y*250.-t*3.4);
  vec2 displacement=vec2(sin(p.y*360.-t*2.8)*.00065,-ripples*.0008)*weight;
  vec2 q=clamp(vUv+displacement*uReferenceSize/uRect.zw,0.,1.);
  vec4 sea=texture2D(uImage,q);
  if(sea.a<.002)discard;
  float foamNoise=noise(vec2(p.x*520.+ripples,p.y*390.-t*4.3));
  float foam=vWave.y*smoothstep(.45,.84,foamNoise);
  sea.rgb*=1.+vWave.x*.28+ripples*weight*.018;
  sea.rgb+=vec3(.13,.21,.29)*foam*.13;
  float shimmer=.5+.5*sin(p.y*175.-t*2.6+sin(p.x*170.)*2.);
  float reflection=exp(-pow((p.x-.407)/(.019+depth*.17),2.));
  sea.rgb+=vec3(.24,.13,.075)*reflection*shimmer*weight*.015;
  #ifdef COASTAL_LIGHT
  float screenX=(p.x-uOffset.x)/uCrop.x;
  float lightWidth=.036+depth*.27;
  float starlight=exp(-pow((screenX-uEnvironmentX+sin(p.y*118.-t*.5)*.012)/lightWidth,2.));
  float brokenReflection=pow(shimmer,4.)*(.34+.66*smoothstep(-.6,.7,vWave.x));
  sea.rgb*=vec3(.90,.95,1.02);
  sea.rgb+=uEnvironmentColor*uEnvironmentStrength*(starlight*brokenReflection*.034+foam*.009)*smoothstep(0.,.08,depth);
  #endif
  gl_FragColor=vec4(sea.rgb*uTint,sea.a*uOpacity);
  #include <colorspace_fragment>
}`;

const pointVertex=`
attribute float aSize;
attribute float aSeed;
attribute float aAlpha;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform vec2 uPointer;
uniform float uTime;
uniform float uPixelRatio;
varying float vAlpha;
varying float vSeed;
void main(){
  vec2 p=(position.xy-uOffset-uPointer*.0007)/uCrop;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
  gl_PointSize=aSize*uPixelRatio;
  vAlpha=(.30+.70*pow(.5+.5*sin(uTime*(.65+aSeed*1.15)+aSeed*61.),2.))*aAlpha;
  vSeed=aSeed;
}`;
const pointFragment=`
uniform float uIntensity;
varying float vAlpha;
varying float vSeed;
void main(){
  vec2 p=gl_PointCoord-.5;
  float r=length(p);
  float core=exp(-r*r*84.);
  float glow=exp(-r*r*26.)*.10;
  float ray=exp(-abs(p.x)*85.)*exp(-abs(p.y)*9.)+exp(-abs(p.y)*85.)*exp(-abs(p.x)*9.);
  float alpha=(core+glow+ray*.09)*vAlpha*uIntensity;
  vec3 color=mix(vec3(.57,.69,.87),vec3(.93,.83,.66),step(.90,vSeed));
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
}`;
const shadowVertex=`
attribute float aOpacity;
attribute vec2 aParallax;
uniform vec2 uReferenceSize;
uniform vec2 uCrop;
uniform vec2 uOffset;
uniform vec2 uPointer;
varying vec2 vUv;
varying float vOpacity;
void main(){
  vUv=uv;vOpacity=aOpacity;
  vec2 p=(position.xy+uPointer*aParallax/uReferenceSize-uOffset)/uCrop;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;
const shadowFragment=`
varying vec2 vUv;
varying float vOpacity;
void main(){vec2 p=(vUv-.5)*2.;float alpha=exp(-dot(p,p)*4.2)*vOpacity;gl_FragColor=vec4(.002,.003,.005,alpha);}`;

export async function loadLayerTextures(loader,layers){
  const results=await Promise.allSettled(layers.map(layer=>loader.loadAsync(layer.src)));
  const failures=results.flatMap((result,index)=>result.status==='rejected'?[layers[index].id]:[]);
  if(failures.length){
    for(const result of results)if(result.status==='fulfilled')result.value.dispose();
    throw new Error(`无法载入独立图层：${failures.join('、')}`);
  }
  return results.map(result=>result.value);
}

export async function createObservatoryScene(canvas,{layers=createLayerState(),onLayersChanged=()=>{},foregroundOnly=false}={}){
  const renderer=new THREE.WebGLRenderer({canvas,alpha:foregroundOnly,antialias:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x040b17,foregroundOnly?0:1);
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,10);camera.position.z=1;
  let textures;
  try{textures=await loadLayerTextures(new THREE.TextureLoader(),layers);}
  catch(error){renderer.dispose();throw error;}
  for(const texture of textures){texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;}

  const crop={value:new THREE.Vector2(1,1)},offset={value:new THREE.Vector2()},pointer={value:new THREE.Vector2()},time={value:0},intensity={value:1},reference={value:new THREE.Vector2(REFERENCE_FRAME.width,REFERENCE_FRAME.height)},pixelRatio={value:1};
  const environmentColor={value:new THREE.Vector3()},environmentStrength={value:0},environmentX={value:.5};
  const desktopComposition={value:0};
  const plane=new THREE.PlaneGeometry(2,2),oceanGeometry=createOceanGeometry(),drawOrder={sky:0,nebula:10,ocean:30,cliff:40,telescope:50,child:60};
  const layerMeshes=layers.map((layer,index)=>{
    const uniforms={uImage:{value:textures[index]},uRect:{value:new THREE.Vector4()},uReferenceSize:reference,uAnchor:{value:new THREE.Vector2()},uRotation:{value:0},uCrop:crop,uOffset:offset,uPointer:pointer,uParallax:{value:new THREE.Vector2()},uTint:{value:new THREE.Vector3()},uOpacity:{value:1},uTime:time,uPixelRatio:pixelRatio,uEnvironmentColor:environmentColor,uEnvironmentStrength:environmentStrength,uEnvironmentX:environmentX};
    uniforms.uDesktopComposition=desktopComposition;
    const isOcean=layer.id==='ocean';
    const defines={};
    if(foregroundOnly)defines.COASTAL_LIGHT=1;
    if(foregroundOnly&&layer.id==='cliff')defines.COAST_ROCK=1;
    if(isOcean)defines.OCEAN_LAYER=1;
    if(foregroundOnly&&layer.id==='sky')defines.FOREGROUND_SKY=1;
    const material=new THREE.ShaderMaterial({vertexShader:imageVertex,fragmentShader:isOcean?oceanFragment:imageFragment,defines,transparent:true,depthTest:false,depthWrite:false,uniforms});
    const mesh=new THREE.Mesh(isOcean?oceanGeometry:plane,material);mesh.renderOrder=drawOrder[layer.id];mesh.frustumCulled=false;mesh.name=layer.id;mesh.visible=!(foregroundOnly&&layer.id==='nebula');scene.add(mesh);return mesh;
  });
  const oceanIndex=layers.findIndex(layer=>layer.id==='ocean');
  const oceanEffects=createOceanEffects(scene,layers[oceanIndex],oceanGeometry,layerMeshes[oceanIndex].material.uniforms);

  const shadowCount=contactShadows(layers).length,shadowGeometry=new THREE.BufferGeometry();
  shadowGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(shadowCount*18),3));
  shadowGeometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(shadowCount*12),2));
  shadowGeometry.setAttribute('aOpacity',new THREE.BufferAttribute(new Float32Array(shadowCount*6),1));
  shadowGeometry.setAttribute('aParallax',new THREE.BufferAttribute(new Float32Array(shadowCount*12),2));
  const shadowMaterial=new THREE.ShaderMaterial({vertexShader:shadowVertex,fragmentShader:shadowFragment,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,uniforms:{uReferenceSize:reference,uCrop:crop,uOffset:offset,uPointer:pointer}});
  const shadows=new THREE.Mesh(shadowGeometry,shadowMaterial);shadows.frustumCulled=false;shadows.renderOrder=45;scene.add(shadows);

  const random=seededRandom(6178),{farCount,movingCount,nearCount}=STAR_FIELD,total=farCount+movingCount+nearCount;
  const staticCount=farCount+nearCount;
  const positions=new Float32Array(total*3),sizes=new Float32Array(total),seeds=new Float32Array(total),alphas=new Float32Array(total),migrators=[];
  for(let i=0;i<total;i++){
    positions[i*3]=random();positions[i*3+1]=random()*.625;
    sizes[i]=i<nearCount?8+random()*3:2.6+random()*2.2;
    seeds[i]=random();alphas[i]=i<nearCount?.72:i<staticCount?.43+random()*.29:.52;
    if(i>=staticCount){
      sizes[i]+=1;
      const angle=random()*Math.PI*2,radius=Math.pow(random(),.6)*.068,center=[[.57,.29],[.65,.16],[.40,.44]][i%3];
      migrators.push({sx:random(),sy:random()*.63,tx:center[0]+Math.cos(angle)*radius,ty:center[1]+Math.sin(angle)*radius*.63,seed:random(),delay:random()*3});
    }
  }
  const starGeometry=new THREE.BufferGeometry();
  starGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));starGeometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));starGeometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));starGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(alphas,1));
  const starsMaterial=new THREE.ShaderMaterial({vertexShader:pointVertex,fragmentShader:pointFragment,transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uCrop:crop,uOffset:offset,uPointer:pointer,uTime:time,uPixelRatio:pixelRatio,uIntensity:intensity}});
  const stars=new THREE.Points(starGeometry,starsMaterial);stars.renderOrder=20;stars.frustumCulled=false;stars.visible=!foregroundOnly;scene.add(stars);
  const meteorGroup=new THREE.Group();meteorGroup.visible=!foregroundOnly;scene.add(meteorGroup);
  const meteors=createMeteorEffects(meteorGroup,{crop,offset,pixelRatio});

  let frame=sceneFrame(innerWidth,innerHeight),disposed=false,palette='night';
  const pointerTarget=new THREE.Vector2();
  function updateLayers(elapsed){
    layers.forEach((layer,index)=>{
      const rect=layerRect(layer,elapsed),uniforms=layerMeshes[index].material.uniforms;
      uniforms.uRect.value.set(rect.x,rect.y,rect.width,rect.height);uniforms.uAnchor.value.set(layer.anchor.x,layer.anchor.y);
      uniforms.uRotation.value=layerTransform(layer,elapsed).rotation*Math.PI/180;uniforms.uParallax.value.set(layer.parallax.x,layer.parallax.y);
      uniforms.uOpacity.value=layer.opacity;uniforms.uTint.value.set(...layerTint(layer,palette));
    });
    const corners=[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];
    contactShadows(layers,elapsed).forEach((shadow,index)=>{
      corners.forEach(([u,v],corner)=>{
        const vertex=index*6+corner,x=shadow.center.x+(u-.5)*shadow.radius.x*4,y=shadow.center.y+(v-.5)*shadow.radius.y*4;
        shadowGeometry.attributes.position.setXYZ(vertex,x/REFERENCE_FRAME.width,y/REFERENCE_FRAME.height,0);
        shadowGeometry.attributes.uv.setXY(vertex,u,v);shadowGeometry.attributes.aOpacity.setX(vertex,shadow.opacity);shadowGeometry.attributes.aParallax.setXY(vertex,shadow.parallax.x,shadow.parallax.y);
      });
    });
    for(const attribute of Object.values(shadowGeometry.attributes))attribute.needsUpdate=true;
  }
  function resize(width,height){
    if(disposed)return;
    desktopComposition.value=foregroundOnly&&width>=DESKTOP_MIN_WIDTH?1:0;
    frame=sceneFrame(width,height);crop.value.set(frame.cropX,frame.cropY);offset.value.set(frame.offsetX,frame.offsetY);
    const ratio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2400000/(width*height)));
    pixelRatio.value=ratio;renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
  }
  function render(elapsed,light){
    if(disposed)return;
    environmentStrength.value=light?.strength??0;
    if(light){environmentColor.value.set(...light.color);environmentX.value=light.x;}
    time.value=elapsed;pointer.value.lerp(pointerTarget,.08);updateLayers(elapsed);oceanEffects.update(elapsed);
    if(!foregroundOnly){
      migrators.forEach((star,index)=>{const sample=gatherStar(star,elapsed),i=staticCount+index;positions[i*3]=sample.x;positions[i*3+1]=sample.y;alphas[i]=sample.alpha*.72;});
      starGeometry.attributes.position.needsUpdate=true;starGeometry.attributes.aAlpha.needsUpdate=true;
      meteors.update(elapsed);
    }
    renderer.render(scene,camera);
  }
  resize(innerWidth,innerHeight);updateLayers(0);
  return {
    render,resize,
    get frame(){return frame;},
    setPointer(x,y){pointerTarget.set(x,y);},
    setPalette(value){palette=value;updateLayers(time.value);onLayersChanged();},
    setStarlight(value){intensity.value=value;},
    getLensStars(){return foregroundOnly?[]:Array.from({length:total},(_,index)=>({x:positions[index*3],y:positions[index*3+1],size:sizes[index],alpha:alphas[index]*intensity.value}));},
    setLayer(id,patch){patchLayer(layers,id,patch);updateLayers(time.value);onLayersChanged();},
    snapshot(){return {foregroundOnly,environmentLight:{x:environmentX.value,strength:environmentStrength.value,color:environmentColor.value.toArray()},seaTime:time.value,starCount:foregroundOnly?0:total,nearStarCount:foregroundOnly?0:nearCount,movingStarCount:foregroundOnly?0:movingCount,starSamples:foregroundOnly?[]:[0,27,63].map(index=>gatherStar(migrators[index],time.value)),drawCalls:renderer.info.render.calls,textureObjectCount:new Set(textures.map(texture=>texture.uuid)).size,textureObjects:layers.map((layer,index)=>({id:layer.id,uuid:textures[index].uuid})),frame:{...frame},layerInventory:layerInventory(layers,palette,time.value),registration:registrationMetrics(layers),...oceanEffects.snapshot(),...meteors.snapshot()};},
    dispose(){
      if(disposed)return;disposed=true;
      meteors.dispose();scene.remove(meteorGroup);oceanEffects.dispose();
      plane.dispose();starGeometry.dispose();starsMaterial.dispose();shadowGeometry.dispose();shadowMaterial.dispose();layerMeshes.forEach(mesh=>mesh.material.dispose());textures.forEach(texture=>texture.dispose());renderer.dispose();
    },
  };
}

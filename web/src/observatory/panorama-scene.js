import * as THREE from 'three';
import { projectWorldPoint, wrapDelta } from './panorama-model.js';
import { projectPanoramaDisc, projectConnectedWorldPoint, panoramaBackgroundUniforms, panoramaPixelRatio } from './panorama-scene-projection.js';
import { PANORAMA_DUST_LAYER, createPanoramaParticles, sampleNebulaParticle, sampleNebulaFilament, createPanoramaMeteors, samplePanoramaMeteor } from './panorama-scene-data.js';
import { createPanoramaResourceScope, loadPanoramaSceneAssets } from './panorama-scene-resources.js';
import { SELECTION_EXTENT, createSelectionWeights, selectionStyleIndex, sampleSelectedAmbientStar } from './panorama-scene-selection.js';
import { createSelectionEffects } from './panorama-scene-selection-effects.js';
import { sampleEnvironmentLight } from './environment-light.js';
import * as shaders from './panorama-scene-materials.js';
import {DESKTOP_MIN_WIDTH} from './desktop-composition.js';

/** Caller owns time, camera and input. This renderer creates no timers or event handlers. */
export async function createPanoramaScene(canvas,{catalog,world}){
  const scope=createPanoramaResourceScope();
  const renderer=scope.own(new THREE.WebGLRenderer({canvas,alpha:false,antialias:false,powerPreference:'high-performance'}));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x061124);
  let assets;
  try{assets=await loadPanoramaSceneAssets(new THREE.TextureLoader(),catalog);}
  catch(error){scope.dispose();throw error;}
  const {textures,backgroundTexture}=assets;
  const anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  [...textures,backgroundTexture].forEach(texture=>{scope.own(texture);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=anisotropy;});
  backgroundTexture.wrapS=THREE.RepeatWrapping;

  const scene=new THREE.Scene(),camera2D=new THREE.OrthographicCamera(-1,1,1,-1,0,2);camera2D.position.z=1;
  const quad=scope.own(new THREE.PlaneGeometry(2,2));
  const viewportUniform={value:new THREE.Vector2(1,1)},timeUniform={value:0},pixelRatioUniform={value:1},zoomSizeUniform={value:1};
  const worldPhaseUniform={value:new THREE.Vector4()};
  const milkyWayPhaseUniform={value:new THREE.Vector4()};
  const effectIntensityUniform={value:1},selectionWeights=createSelectionWeights(catalog.map(entry=>entry.id));
  let currentWeights=new Float64Array(catalog.length);
  const environmentLight={x:.5,strength:0,color:[0,0,0]};
  const common={uViewport:viewportUniform,uTime:timeUniform,uPixelRatio:pixelRatioUniform,uZoomSize:zoomSizeUniform};
  function material(vertexShader,fragmentShader,uniforms,options={}){
    return scope.own(new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthTest:false,depthWrite:false,...options}));
  }
  function attach(object,order){object.renderOrder=order;object.frustumCulled=false;scene.add(object);return object;}
  const background=material(shaders.backgroundVertex,shaders.backgroundFragment,{uWorldPhase:worldPhaseUniform,uTime:timeUniform,uMilkyWay:{value:backgroundTexture},uMilkyWayPhase:milkyWayPhaseUniform,uMilkyWayOpacity:{value:PANORAMA_DUST_LAYER.opacity},uMilkyWayEdgeFade:{value:PANORAMA_DUST_LAYER.edgeFade}},{transparent:false});
  attach(new THREE.Mesh(quad,background),0);
  const colors=catalog.map(entry=>new THREE.Color(entry.color));
  const nebulae=catalog.map((entry,index)=>{
    const center={value:new THREE.Vector2()},extent={value:new THREE.Vector2()},haloExtent={value:new THREE.Vector2()},selected={value:0},unfold={value:0};
    const shared={uViewport:viewportUniform,uCenter:center,uTime:timeUniform,uSeed:{value:index*1.71+.3},uColor:{value:colors[index]},uSelected:selected,uEffectIntensity:effectIntensityUniform,uEffectStyle:{value:selectionStyleIndex(entry.id)}};
    const haloMaterial=material(shaders.spriteVertex,shaders.haloFragment,{...shared,uHalfSize:haloExtent},{blending:THREE.AdditiveBlending});
    const nebulaMaterial=material(shaders.spriteVertex,shaders.nebulaFragment,{...shared,uAtlasOpen:unfold,uHalfSize:extent,uMap:{value:textures[index]}});
    const image=textures[index].image,max=Math.max(image.width,image.height);
    return {entry,center,extent,haloExtent,selected,unfold,lightColor:colors[index].toArray(),aspect:{x:image.width/max,y:image.height/max},projection:{},halo:attach(new THREE.Mesh(quad,haloMaterial),1),mesh:attach(new THREE.Mesh(quad,nebulaMaterial),3)};
  });

  const field=createPanoramaParticles(catalog,world,false),insidePerGalaxy=field.inside.length/Math.max(1,catalog.length);
  function pointGeometry(count){
    const geometry=scope.own(new THREE.BufferGeometry());
    for(const [name,size] of [['position',3],['aSize',1],['aSeed',1],['aAlpha',1],['aColor',3]])geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(count*size),size));
    return geometry;
  }
  const farGeometry=pointGeometry(field.far.length),insideGeometry=pointGeometry(field.inside.length);
  const farStarMaterial=material(shaders.pointVertex,shaders.pointFragment,{...common,uCoreFalloff:{value:32},uTwinkleFloor:{value:.58},uRayGain:{value:.035}},{blending:THREE.AdditiveBlending});
  const insideStarMaterial=material(shaders.pointVertex,shaders.pointFragment,{...common,uCoreFalloff:{value:58},uTwinkleFloor:{value:.42},uRayGain:{value:.07}},{blending:THREE.AdditiveBlending});
  attach(new THREE.Points(farGeometry,farStarMaterial),2);attach(new THREE.Points(insideGeometry,insideStarMaterial),5);
  const baseColor=new THREE.Color(),targetColor=new THREE.Color(),softStarColor=new THREE.Color(.76,.84,.93);
  field.far.forEach((star,index)=>{
    baseColor.setRGB(...(star.warm?[.67,.57,.42]:[.36,.49,.70]));
    for(let region=0;region<catalog.length;region++){
      const nebula=catalog[region],distance=Math.hypot(wrapDelta(star.x-nebula.position.x,world.width),star.y-nebula.position.y);
      const influence=Math.max(0,1-Math.pow(distance/(nebula.radius*2),2))*.30;
      baseColor.lerp(colors[region],influence);
    }
    farGeometry.attributes.aSize.setX(index,star.size);farGeometry.attributes.aSeed.setX(index,star.seed);farGeometry.attributes.aAlpha.setX(index,star.alpha);farGeometry.attributes.aColor.setXYZ(index,baseColor.r,baseColor.g,baseColor.b);
  });
  const farBaseColors=farGeometry.attributes.aColor.array.slice(),farOwners=new Int16Array(field.far.length).fill(-1);
  const ambientCandidates=catalog.map((nebula,region)=>{
    const indices=[],probes=[];
    field.far.forEach((star,index)=>{
      const distance=Math.hypot(wrapDelta(star.x-nebula.position.x,world.width),star.y-nebula.position.y)/nebula.radius;
      if(distance<SELECTION_EXTENT){indices.push(index);farOwners[index]=region;if(distance>.65&&distance<1.1&&probes.length<3)probes.push(index);}
    });
    return {indices,probes};
  });
  const previousWeights=new Float64Array(catalog.length);
  const selectionEffects=createSelectionEffects({scene,scope,catalog,world,common,colors});

  const filamentCount=6,filamentSegments=36,filamentVertices=catalog.length*filamentCount*filamentSegments*2;
  const filamentGeometry=scope.own(new THREE.BufferGeometry());
  filamentGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(filamentVertices*3),3));
  filamentGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(filamentVertices),1));
  filamentGeometry.setAttribute('aColor',new THREE.BufferAttribute(new Float32Array(filamentVertices*3),3));
  const filamentMaterial=material(shaders.lineVertex,shaders.lineFragment,{uViewport:viewportUniform},{blending:THREE.AdditiveBlending});
  attach(new THREE.LineSegments(filamentGeometry,filamentMaterial),4);

  const meteorSlots=createPanoramaMeteors(catalog),tailSegments=16,tailVertices=meteorSlots.length*tailSegments*6;
  const meteorGeometry=scope.own(new THREE.BufferGeometry());
  meteorGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(tailVertices*3),3));
  meteorGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(tailVertices),1));
  meteorGeometry.setAttribute('aAcross',new THREE.BufferAttribute(new Float32Array(tailVertices),1));
  const meteorMaterial=material(shaders.trailVertex,shaders.trailFragment,{uViewport:viewportUniform},{blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
  attach(new THREE.Mesh(meteorGeometry,meteorMaterial),6);
  const headGeometry=scope.own(new THREE.BufferGeometry());
  headGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(meteorSlots.length*3),3));
  headGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(meteorSlots.length),1));
  const headSizeUniform={value:15};
  const headMaterial=material(shaders.meteorHeadVertex,shaders.meteorHeadFragment,{uViewport:viewportUniform,uPixelRatio:pixelRatioUniform,uHeadSize:headSizeUniform},{blending:THREE.AdditiveBlending});
  attach(new THREE.Points(headGeometry,headMaterial),7);

  let width=0,height=0,mobile=false,farLimit=field.far.length,insideLimit=insidePerGalaxy,frames=0,visibleFar=0,visibleInside=0,activeMeteors=0,affectedAmbientStars=0;
  let lastTime=0,lastCamera={x:0,y:0,zoom:1},lastViewport={width:1,height:1,scale:1},projectionKey='';
  const point={},projected={},phase={},meteor={},headProjected={},tailWorld={},tailProjected={};
  const tailCorners=[[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]];
  const coarse=typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches;

  function resize(nextWidth,nextHeight){
    if(scope.disposed||!(nextWidth>0&&nextHeight>0))return;
    width=nextWidth;height=nextHeight;mobile=coarse||width<760;
    background.uniforms.uMilkyWayOpacity.value=width>=DESKTOP_MIN_WIDTH?.26:PANORAMA_DUST_LAYER.opacity;
    const ratio=panoramaPixelRatio(width,height,globalThis.devicePixelRatio||1,mobile);
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);pixelRatioUniform.value=ratio;viewportUniform.value.set(width,height);
    farLimit=mobile?Math.min(3200,field.far.length):field.far.length;insideLimit=mobile?Math.min(120,insidePerGalaxy):insidePerGalaxy;
    farGeometry.setDrawRange(0,farLimit);projectionKey='';
  }

  function projectFar(camera,viewport){
    const key=`${camera.x},${camera.y},${viewport.scale},${viewport.width},${viewport.height},${farLimit}`;
    if(key===projectionKey)return;
    projectionKey=key;visibleFar=0;
    for(let index=0;index<farLimit;index++){
      projectWorldPoint(field.far[index],camera,viewport,world,projected);
      farGeometry.attributes.position.setXYZ(index,projected.x,projected.y,0);
      farGeometry.attributes.aSize.setX(index,field.far[index].size);farGeometry.attributes.aAlpha.setX(index,field.far[index].alpha);
      farGeometry.attributes.aColor.setXYZ(index,farBaseColors[index*3],farBaseColors[index*3+1],farBaseColors[index*3+2]);
      if(projected.x>=0&&projected.x<=width&&projected.y>=0&&projected.y<=height)visibleFar++;
    }
    for(const name of ['position','aSize','aAlpha','aColor'])farGeometry.attributes[name].needsUpdate=true;
  }

  function projectSelectedAmbient(time,camera,viewport,weights,intensity){
    affectedAmbientStars=0;let updated=false;
    for(let region=0;region<catalog.length;region++){
      const weight=weights[region];if(weight===0&&previousWeights[region]===0)continue;
      const nebula=catalog[region],color=colors[region];
      for(const index of ambientCandidates[region].indices){
        if(index>=farLimit)continue;
        const star=field.far[index];sampleSelectedAmbientStar(star,nebula,time,weight,world,point);projectWorldPoint(point,camera,viewport,world,projected);
        const response=weight*point.influence,colorMix=Math.min(.50,response*.50*intensity),attrs=farGeometry.attributes;
        attrs.position.setXYZ(index,projected.x,projected.y,0);attrs.aSize.setX(index,star.size*(1+response*.12));attrs.aAlpha.setX(index,Math.min(.95,star.alpha*(1+response*.40*intensity)));
        attrs.aColor.setXYZ(index,farBaseColors[index*3]+(color.r-farBaseColors[index*3])*colorMix,farBaseColors[index*3+1]+(color.g-farBaseColors[index*3+1])*colorMix,farBaseColors[index*3+2]+(color.b-farBaseColors[index*3+2])*colorMix);
        if(response>.03&&projected.x>=0&&projected.x<=width&&projected.y>=0&&projected.y<=height)affectedAmbientStars++;updated=true;
      }
    }
    previousWeights.set(weights);
    if(updated)for(const name of ['position','aSize','aAlpha','aColor'])farGeometry.attributes[name].needsUpdate=true;
  }

  function farStarSample(index){
    const star=field.far[index],region=farOwners[index];
    const actual=region>=0?sampleSelectedAmbientStar(star,catalog[region],lastTime,currentWeights[region],world):{x:star.x,y:star.y};
    return {baseWorld:{x:star.x,y:star.y},world:{x:actual.x,y:actual.y},screen:projectWorldPoint(actual,lastCamera,lastViewport,world)};
  }

  function projectInside(time,camera,viewport){
    let particleIndex=0,lineIndex=0;visibleInside=0;
    for(let region=0;region<nebulae.length;region++){
      const nebula=nebulae[region];if(!nebula.projection.visible)continue;
      targetColor.copy(colors[region]).lerp(softStarColor,.35);
      for(let local=0;local<insideLimit;local++){
        const particle=field.inside[region*insidePerGalaxy+local];sampleNebulaParticle(particle,nebula.entry,time,point);
        projectConnectedWorldPoint(point,nebula.entry.position,nebula.projection,viewport,world,projected);
        const attrs=insideGeometry.attributes;
        attrs.position.setXYZ(particleIndex,projected.x,projected.y,0);attrs.aSize.setX(particleIndex,point.size);attrs.aSeed.setX(particleIndex,particle.seed);attrs.aAlpha.setX(particleIndex,point.alpha);attrs.aColor.setXYZ(particleIndex,targetColor.r,targetColor.g,targetColor.b);
        if(projected.x>=0&&projected.x<=width&&projected.y>=0&&projected.y<=height)visibleInside++;particleIndex++;
      }
      for(let filament=0;filament<filamentCount;filament++)for(let segment=0;segment<filamentSegments;segment++)for(let end=0;end<2;end++){
        sampleNebulaFilament(nebula.entry,filament,(segment+end)/filamentSegments,time,point);
        projectConnectedWorldPoint(point,nebula.entry.position,nebula.projection,viewport,world,projected);
        filamentGeometry.attributes.position.setXYZ(lineIndex,projected.x,projected.y,0);filamentGeometry.attributes.aAlpha.setX(lineIndex,point.alpha);filamentGeometry.attributes.aColor.setXYZ(lineIndex,targetColor.r,targetColor.g,targetColor.b);lineIndex++;
      }
    }
    insideGeometry.setDrawRange(0,particleIndex);filamentGeometry.setDrawRange(0,lineIndex);
    for(const geometry of [insideGeometry,filamentGeometry])for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;
  }

  function projectMeteors(time,camera,viewport){
    let vertex=0;activeMeteors=0;
    headSizeUniform.value=Math.max(8,Math.min(22,15*Math.sqrt(viewport.scale)));
    for(let index=0;index<meteorSlots.length;index++){
      samplePanoramaMeteor(meteorSlots[index],time,meteor);projectWorldPoint(meteor,camera,viewport,world,headProjected);
      headGeometry.attributes.position.setXYZ(index,headProjected.x,headProjected.y,0);headGeometry.attributes.aAlpha.setX(index,meteor.alpha);
      if(meteor.alpha>.1&&headProjected.x>=0&&headProjected.x<=width&&headProjected.y>=0&&headProjected.y<=height)activeMeteors++;
      for(let segment=0;segment<tailSegments;segment++)for(const [advance,side] of tailCorners){
        const progress=(segment+advance)/tailSegments,length=meteor.length*progress,halfWidth=meteor.width*Math.pow(1-progress,.82);
        tailWorld.x=meteor.x-meteor.dx*length-meteor.dy*halfWidth*side;tailWorld.y=meteor.y-meteor.dy*length+meteor.dx*halfWidth*side;
        projectConnectedWorldPoint(tailWorld,meteor,headProjected,viewport,world,tailProjected);
        meteorGeometry.attributes.position.setXYZ(vertex,tailProjected.x,tailProjected.y,0);meteorGeometry.attributes.aAlpha.setX(vertex,meteor.alpha*Math.pow(1-progress,1.65));meteorGeometry.attributes.aAcross.setX(vertex,side);vertex++;
      }
    }
    for(const geometry of [meteorGeometry,headGeometry])for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;
  }

  function render({time,camera,viewport,selectedId=null,effectIntensity=1,atlas=null}){
    if(scope.disposed)return;
    if(width!==viewport.width||height!==viewport.height)resize(viewport.width,viewport.height);
    lastTime=time;Object.assign(lastCamera,camera);Object.assign(lastViewport,viewport);timeUniform.value=time;
    currentWeights=selectionWeights.update(selectedId,time);effectIntensityUniform.value=Number.isFinite(effectIntensity)?Math.max(.35,Math.min(1.6,effectIntensity)):1;
    zoomSizeUniform.value=Math.max(.78,Math.min(1.6,Math.pow(viewport.scale,.24)));
    panoramaBackgroundUniforms(camera,viewport,world,phase);worldPhaseUniform.value.set(phase.phaseX,phase.centerY,phase.horizontalSpan,phase.verticalSpan);
    milkyWayPhaseUniform.value.set(phase.dustPhaseX+(width>=DESKTOP_MIN_WIDTH?-.16:0),phase.dustCenterY,phase.dustHorizontalSpan,phase.dustVerticalSpan);
    for(let index=0;index<nebulae.length;index++){
      const nebula=nebulae[index];
      nebula.unfold.value=atlas?.categoryId===nebula.entry.id?atlas.progress:0;
      projectPanoramaDisc(nebula.entry,camera,viewport,world,nebula.projection);
      nebula.center.value.set(nebula.projection.x,nebula.projection.y);nebula.extent.value.set(nebula.projection.radius*nebula.aspect.x,nebula.projection.radius*nebula.aspect.y).multiplyScalar(1+nebula.unfold.value*.22);
      nebula.haloExtent.value.setScalar(nebula.projection.radius*1.7);nebula.selected.value=currentWeights[index];
      nebula.mesh.visible=nebula.halo.visible=nebula.projection.visible;
    }
    sampleEnvironmentLight(nebulae,currentWeights,viewport,environmentLight);
    projectFar(camera,viewport);projectSelectedAmbient(time,camera,viewport,currentWeights,effectIntensityUniform.value);projectInside(time,camera,viewport);
    selectionEffects.update(time,viewport,nebulae,currentWeights,effectIntensityUniform.value,mobile);projectMeteors(time,camera,viewport);
    renderer.render(scene,camera2D);frames++;
  }

  return {
    render,resize,getEnvironmentLight:()=>environmentLight,
    snapshot(){
      const ambientSamples=[];
      for(let region=0;region<catalog.length;region++)if(currentWeights[region]>.0001)for(const index of ambientCandidates[region].probes)if(index<farLimit)ambientSamples.push({id:catalog[region].id,weight:currentWeights[region],...farStarSample(index)});
      return {
        frames,time:lastTime,disposed:scope.disposed,drawCalls:renderer.info.render.calls,
        starCount:farLimit+insideLimit*catalog.length,visibleStarCount:visibleFar+visibleInside,mobile,pixelRatio:pixelRatioUniform.value,renderPixels:Math.round(width*height*pixelRatioUniform.value**2),
        camera:{...lastCamera},viewport:{...lastViewport},textureCount:textures.length,backgroundTextureCount:1,
        backgroundTexture:{src:PANORAMA_DUST_LAYER.asset,uuid:backgroundTexture.uuid,opacity:background.uniforms.uMilkyWayOpacity.value,repeat:PANORAMA_DUST_LAYER.repeat},
        activeMeteorCount:activeMeteors,selectedWeights:selectionWeights.snapshot(),cloudOpening:Object.fromEntries(nebulae.map(nebula=>[nebula.entry.id,nebula.unfold.value])),affectedAmbientStarCount:affectedAmbientStars,selectedAmbientStarSamples:ambientSamples,
        nebulaSamples:nebulae.map((nebula,index)=>({id:nebula.entry.id,world:{...nebula.entry.position},screen:{...nebula.projection},texture:textures[index].uuid,particle:sampleNebulaParticle(field.inside[index*insidePerGalaxy],nebula.entry,lastTime),filament:sampleNebulaFilament(nebula.entry,2,.43,lastTime)})),
        starSamples:[0,517,1711].map(farStarSample),...selectionEffects.snapshot(),
      };
    },
    dispose(){if(scope.disposed)return;scene.clear();scope.dispose();},
  };
}

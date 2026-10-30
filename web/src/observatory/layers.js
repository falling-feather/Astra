/**
 * All composition coordinates use the 1672 × 941 reference frame.
 * rect is the asset's baseline frame; position is only an offset from it.
 * anchor and named anchors are normalized coordinates inside the asset.
 * Both renderers and all interaction hit points consume these same records.
 * @typedef {{x:number,y:number}} Point
 * @typedef {{x:number,y:number,width:number,height:number}} Rect
 * @typedef {{id:string,src:string,rect:Rect,position:Point,scale:Point,anchor:Point,
 *   rotation:number,opacity:number,tint:number[],parallax:Point,anchors:Record<string,Point>,
 *   palette?:boolean,motion?:{angularVelocity:number,phase:number,speed:number,drift:Point}}} Layer
 */
export const REFERENCE_FRAME=Object.freeze({width:1672,height:941});
const fullFrame={x:0,y:0,width:1672,height:941};
const telescopeRect={x:1280,y:349,width:184,height:276};
const telescopeEye={x:944/1024,y:356/1536};
const childEye={x:374/1024,y:309/1536};
const childSize={width:183.4,height:275.1};
const childRect={
  x:telescopeRect.x+telescopeEye.x*telescopeRect.width-childEye.x*childSize.width,
  y:telescopeRect.y+telescopeEye.y*telescopeRect.height-childEye.y*childSize.height,
  ...childSize,
};

// Asset registration is kept here, including the anatomical/contact points.
// The child's base frame is solved from its measured eye and the telescope eyepiece.
export const SCENE_LAYERS=Object.freeze([
  {id:'sky',src:'/assets/observatory/sky-horizon.png',rect:{...fullFrame,y:-118},parallax:{x:.7,y:.45},anchors:{horizon:{x:.5,y:735/941}},palette:true},
  {id:'nebula',src:'/assets/observatory/nebula.png',rect:{...fullFrame},opacity:.52,parallax:{x:1.4,y:.7},palette:true},
  {id:'ocean',src:'/assets/observatory/ocean.png',rect:{...fullFrame,y:92},parallax:{x:.7,y:.45},anchors:{waterline:{x:.5,y:525/941}},palette:true},
  {id:'cliff',src:'/assets/observatory/cliff.png',rect:{...fullFrame},parallax:{x:1.8,y:1.2},anchors:{surface:{x:.875,y:612/941}}},
  {id:'telescope',src:'/assets/observatory/telescope.png',rect:telescopeRect,anchor:{x:.5,y:1460/1536},parallax:{x:1.8,y:1.2},anchors:{eyepiece:telescopeEye,feet:{x:540/1024,y:1460/1536},leftFoot:{x:142/1024,y:1460/1536},rightFoot:{x:938/1024,y:1460/1536},rearFoot:{x:555/1024,y:1280/1536},lens:{x:145/1024,y:176/1536}}},
  {id:'child',src:'/assets/observatory/child.png',rect:childRect,anchor:{x:645/1024,y:1428.5/1536},parallax:{x:1.8,y:1.2},anchors:{eye:childEye,feet:{x:645/1024,y:1428.5/1536},leftFoot:{x:491/1024,y:1430/1536},rightFoot:{x:799/1024,y:1427/1536}}},
]);

export const GALAXY_ASSET='/assets/observatory/galaxy-core.png';
export const GALAXY_CORES=Object.freeze([
  {id:'main',src:GALAXY_ASSET,rect:{x:565,y:210,width:540,height:540},opacity:.82,tint:[.78,.88,1],rotation:-14,view:'overview',motion:{angularVelocity:2.4,phase:0,speed:.16,drift:{x:6,y:4}}},
  {id:'gold',src:GALAXY_ASSET,rect:{x:228,y:143,width:384,height:384},opacity:.66,tint:[1,.89,.69],rotation:-28,view:'journal',motion:{angularVelocity:-3,phase:1.6,speed:.16,drift:{x:10,y:7}}},
  {id:'ice',src:GALAXY_ASSET,rect:{x:1114,y:104,width:372,height:372},opacity:.68,tint:[.78,.84,1],rotation:18,view:'explore',motion:{angularVelocity:2,phase:3.2,speed:.16,drift:{x:8,y:5}}},
  {id:'violet',src:GALAXY_ASSET,rect:{x:360,y:540,width:320,height:320},opacity:.65,tint:[.88,.74,1],rotation:-32,view:'favorites',motion:{angularVelocity:-3.6,phase:4.8,speed:.16,drift:{x:7,y:8}}},
]);

export const STAR_FIELD=Object.freeze({farCount:420,movingCount:84,nearCount:4});
export const PALETTES=Object.freeze({night:[1,1,1],violet:[1.055,.94,1.04],gold:[1.07,.98,.92]});
const clone=value=>structuredClone(value);

function validate(layer){
  if(typeof layer.id!=='string'||!layer.id||typeof layer.src!=='string'||!layer.src)throw new TypeError('图层需要 id 与独立资源路径。');
  for(const name of ['rect','position','scale','anchor','parallax']){
    if(!Object.values(layer[name]).every(Number.isFinite))throw new TypeError(`${layer.id}: ${name} 必须是有限数值。`);
  }
  if(layer.rect.width<=0||layer.rect.height<=0)throw new RangeError(`${layer.id}: rect 尺寸必须大于零。`);
  if(layer.scale.x<=0||layer.scale.y<=0)throw new RangeError(`${layer.id}: scale 必须大于零。`);
  if(!Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1)throw new RangeError(`${layer.id}: opacity 必须在 0–1 之间。`);
  if(layer.tint.length!==3||!layer.tint.every(value=>Number.isFinite(value)&&value>=0))throw new RangeError(`${layer.id}: tint 需要三个非负数。`);
  if(!Number.isFinite(layer.rotation))throw new RangeError(`${layer.id}: rotation 必须为有限数值。`);
}

/** @returns {Layer[]} */
export function createLayerState(source=SCENE_LAYERS,{allowSharedAsset=false}={}){
  const layers=source.map(entry=>({position:{x:0,y:0},scale:{x:1,y:1},anchor:{x:.5,y:.5},rotation:0,opacity:1,tint:[1,1,1],parallax:{x:0,y:0},anchors:{},...clone(entry)}));
  layers.forEach(validate);
  if(new Set(layers.map(layer=>layer.id)).size!==layers.length)throw new Error('图层 id 必须唯一。');
  if(!allowSharedAsset&&new Set(layers.map(layer=>layer.src)).size!==layers.length)throw new Error('场景各层必须使用独立资源，不能再次引用同一复合图。');
  return layers;
}

/** Update one stable record so WebGL, fallback and lens continue to share it. */
export function patchLayer(layers,id,patch){
  const layer=layers.find(entry=>entry.id===id);
  if(!layer)throw new Error(`未知图层：${id}`);
  const allowed=['position','scale','anchor','rotation','opacity','tint','parallax'];
  if(Object.keys(patch).some(key=>!allowed.includes(key)))throw new Error('运行时只允许调整图层变换、透明度与色调。');
  const next={...layer,...clone(patch)};
  for(const key of ['position','scale','anchor','parallax'])if(patch[key])next[key]={...layer[key],...patch[key]};
  validate(next);Object.assign(layer,next);return layer;
}

export function layerTransform(layer,time=0){
  const motion=layer.motion;
  const phase=motion?time*motion.speed+motion.phase:0;
  return {
    position:{x:layer.position.x+(motion?Math.sin(phase)*motion.drift.x:0),y:layer.position.y+(motion?Math.cos(phase*.8)*motion.drift.y:0)},
    rotation:layer.rotation+(motion?time*motion.angularVelocity:0),
  };
}

export function layerRect(layer,time=0){
  const {position}=layerTransform(layer,time),{rect,scale,anchor}=layer;
  const width=rect.width*scale.x,height=rect.height*scale.y;
  return {x:rect.x+position.x+anchor.x*(rect.width-width),y:rect.y+position.y+anchor.y*(rect.height-height),width,height};
}

export function layerPoint(layer,nameOrPoint,time=0){
  const point=typeof nameOrPoint==='string'?layer.anchors[nameOrPoint]:nameOrPoint;
  if(!point)throw new Error(`${layer.id}: 缺少锚点 ${nameOrPoint}`);
  const rect=layerRect(layer,time),angle=layerTransform(layer,time).rotation*Math.PI/180;
  const center={x:rect.x+layer.anchor.x*rect.width,y:rect.y+layer.anchor.y*rect.height};
  const x=(point.x-layer.anchor.x)*rect.width,y=(point.y-layer.anchor.y)*rect.height;
  return {x:center.x+x*Math.cos(angle)-y*Math.sin(angle),y:center.y+x*Math.sin(angle)+y*Math.cos(angle)};
}

export function projectLayer(layer,frame,width,height,time=0){
  const rect=layerRect(layer,time),sx=width/(REFERENCE_FRAME.width*frame.cropX),sy=height/(REFERENCE_FRAME.height*frame.cropY);
  return {rect:{x:(rect.x-frame.offsetX*REFERENCE_FRAME.width)*sx,y:(rect.y-frame.offsetY*REFERENCE_FRAME.height)*sy,width:rect.width*sx,height:rect.height*sy},rotation:layerTransform(layer,time).rotation,anchor:{...layer.anchor}};
}

export function lensFrame(target,zoom){
  const cropX=.28/Math.pow(Math.max(1,zoom),.6),cropY=cropX*REFERENCE_FRAME.width/REFERENCE_FRAME.height;
  return {cropX,cropY,offsetX:Math.max(0,Math.min(1-cropX,target.x-cropX/2)),offsetY:Math.max(0,Math.min(1-cropY,target.y-cropY/2))};
}

export function layerTint(layer,palette='night'){
  const ambient=layer.palette?(PALETTES[palette]||PALETTES.night):PALETTES.night;
  return layer.tint.map((value,index)=>value*ambient[index]);
}

export function registrationMetrics(layers){
  const find=id=>layers.find(layer=>layer.id===id);
  const eye=layerPoint(find('child'),'eye'),eyepiece=layerPoint(find('telescope'),'eyepiece');
  return {eye,eyepiece,eyeGap:Math.hypot(eye.x-eyepiece.x,eye.y-eyepiece.y),childFeet:layerPoint(find('child'),'feet'),telescopeFeet:layerPoint(find('telescope'),'feet'),cliffSurface:layerPoint(find('cliff'),'surface')};
}

export function layerInventory(layers,palette='night',time=0){
  return layers.map(layer=>({id:layer.id,src:layer.src,rect:layerRect(layer,time),position:{...layer.position},scale:{...layer.scale},opacity:layer.opacity,tint:layerTint(layer,palette)}));
}

export function contactShadows(layers,time=0){
  return layers.flatMap(layer=>{
    if(!['child','telescope'].includes(layer.id))return [];
    return ['leftFoot','rightFoot','rearFoot'].filter(name=>layer.anchors[name]).map(name=>({
      id:`${layer.id}-${name}`,center:layerPoint(layer,name,time),radius:{x:(layer.id==='child'?10:5)*layer.scale.x,y:(layer.id==='child'?2.5:1.7)*layer.scale.y},opacity:(layer.id==='child'?.18:.14)*layer.opacity,parallax:{...layer.parallax},
    }));
  });
}

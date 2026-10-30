import { REFERENCE_FRAME, projectLayer, layerTint, lensFrame, layerRect, layerTransform, contactShadows } from './layers.js';
import { projectPoint } from './motion.js';

const SVG='http://www.w3.org/2000/svg';
const svgElement=(tag,attributes={})=>{const element=document.createElementNS(SVG,tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));return element;};

function tintFilter(id,tint){
  const filter=svgElement('filter',{id,'color-interpolation-filters':'sRGB'}),transfer=svgElement('feComponentTransfer');
  for(const [index,channel] of ['R','G','B'].entries())transfer.append(svgElement(`feFunc${channel}`,{type:'linear',slope:tint[index]}));
  filter.append(transfer);return filter;
}

/** The static presentation is six actual images, not a baked composition. */
export function createLayerFallback(container,layers,onImageLoad){
  const definitions=svgElement('svg',{width:0,height:0,'aria-hidden':'true'}),defs=svgElement('defs');definitions.append(defs);container.replaceChildren(definitions);
  const images=new Map(),filters=new Map();
  for(const [index,layer] of layers.entries()){
    const id=`fallback-tint-${layer.id}`,filter=tintFilter(id,layer.tint);defs.append(filter);filters.set(layer.id,filter);
    const image=new Image();image.className='scene-layer';image.dataset.layer=layer.id;image.alt='';image.decoding='async';image.src=layer.src;image.style.filter=`url(#${id})`;image.style.zIndex=String(index*10);
    image.addEventListener('load',onImageLoad);container.append(image);images.set(layer.id,image);
  }
  const shadows=new Map();
  for(const shadow of contactShadows(layers)){const node=document.createElement('i');node.className='contact-shadow';node.style.zIndex='35';container.append(node);shadows.set(shadow.id,node);}
  return {
    images,
    update(frame,width,height,palette='night'){
      for(const layer of layers){
        const projection=projectLayer(layer,frame,width,height),image=images.get(layer.id),{rect,anchor,rotation}=projection;
        Object.assign(image.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`,opacity:String(layer.opacity),transform:`rotate(${rotation}deg)`,transformOrigin:`${anchor.x*100}% ${anchor.y*100}%`});
        const values=layerTint(layer,palette);[...filters.get(layer.id).firstChild.children].forEach((channel,index)=>channel.setAttribute('slope',values[index]));
      }
      for(const shadow of contactShadows(layers)){
        const node=shadows.get(shadow.id),point=projectPoint(shadow.center.x/REFERENCE_FRAME.width,shadow.center.y/REFERENCE_FRAME.height,frame,width,height);
        Object.assign(node.style,{left:`${point.x}px`,top:`${point.y}px`,width:`${shadow.radius.x*4*width/(REFERENCE_FRAME.width*frame.cropX)}px`,height:`${shadow.radius.y*4*height/(REFERENCE_FRAME.height*frame.cropY)}px`,opacity:String(shadow.opacity)});
      }
    },
    dispose(){for(const image of images.values())image.removeEventListener('load',onImageLoad);container.replaceChildren();},
  };
}

/** A lens composites the same registered assets at a smaller field of view. */
export function drawLayerLens(canvas,layers,images,target,zoom,stars=[]){
  const size=288;
  if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
  const context=canvas.getContext('2d'),frame=lensFrame(target,zoom);
  if(!context)return;
  context.clearRect(0,0,size,size);context.fillStyle='#040b17';context.fillRect(0,0,size,size);
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  for(const layer of layers){
    const image=images.get(layer.id);
    if(!image?.complete||!image.naturalWidth)continue;
    const {rect,anchor,rotation}=projectLayer(layer,frame,size,size);
    context.save();context.globalAlpha=layer.opacity;context.filter=`url(#fallback-tint-${layer.id})`;
    context.translate(rect.x+rect.width*anchor.x,rect.y+rect.height*anchor.y);context.rotate(rotation*Math.PI/180);
    context.drawImage(image,-rect.width*anchor.x,-rect.height*anchor.y,rect.width,rect.height);context.restore();
  }
  // Samples come from the live particle buffer, preserving the observed sky positions.
  context.save();context.fillStyle='#cad8e9';
  for(const star of stars){
    const x=(star.x-frame.offsetX)/frame.cropX*size,y=(star.y-frame.offsetY)/frame.cropY*size;
    if(x<0||x>size||y<0||y>size)continue;
    context.globalAlpha=star.alpha*.65;const pointSize=Math.max(.7,Math.min(2,star.size*.42));context.fillRect(x,y,pointSize,pointSize);
  }
  context.restore();
}

/** One sparse native orbit system, with four independent images from one core asset. */
export function createGalaxyNavigation(container,cores){
  const svg=container.querySelector('svg'),defs=svgElement('defs');svg.replaceChildren(defs);
  const orbits=[{cx:835,cy:461,rx:730,ry:192,angle:-20},{cx:835,cy:461,rx:520,ry:152,angle:-20}];
  for(const orbit of orbits)svg.append(svgElement('ellipse',{cx:orbit.cx,cy:orbit.cy,rx:orbit.rx,ry:orbit.ry,transform:`rotate(${orbit.angle} ${orbit.cx} ${orbit.cy})`,fill:'none',stroke:'#92aac4','stroke-opacity':.19,'stroke-width':1.15}));
  const nodes=cores.map(core=>{
    const filterId=`galaxy-tint-${core.id}`;defs.append(tintFilter(filterId,core.tint));
    const image=svgElement('image',{href:core.src,filter:`url(#${filterId})`,preserveAspectRatio:'none','data-galaxy-core':core.id});svg.append(image);
    return {core,image,button:container.querySelector(`[data-view="${core.view}"]`)};
  });
  const travellers=Array.from({length:6},(_,index)=>{const dot=svgElement('circle',{r:index%3===0?2.8:1.8,fill:index%3===0?'#d1c3a9':'#a7bed9'});svg.append(dot);return dot;});
  return {
    update(time){
      for(const {core,image,button} of nodes){
        const rect=layerRect(core,time),motion=layerTransform(core,time),cx=rect.x+core.anchor.x*rect.width,cy=rect.y+core.anchor.y*rect.height;
        for(const [key,value] of Object.entries(rect))image.setAttribute(key,String(value));
        image.setAttribute('opacity',String(core.opacity));image.setAttribute('transform',`rotate(${motion.rotation} ${cx} ${cy})`);
        button.style.left=`${cx/REFERENCE_FRAME.width*100}%`;button.style.top=`${cy/REFERENCE_FRAME.height*100}%`;button.style.width=`${rect.width*.8/REFERENCE_FRAME.width*100}%`;button.style.height=`${rect.height*.8/REFERENCE_FRAME.height*100}%`;
      }
      travellers.forEach((dot,index)=>{
        const orbit=orbits[index%orbits.length],phase=time*(.045+index*.009)+index*Math.PI*.63,angle=orbit.angle*Math.PI/180;
        const x=Math.cos(phase)*orbit.rx,y=Math.sin(phase)*orbit.ry;
        dot.setAttribute('cx',orbit.cx+x*Math.cos(angle)-y*Math.sin(angle));dot.setAttribute('cy',orbit.cy+x*Math.sin(angle)+y*Math.cos(angle));dot.setAttribute('opacity',.32+Math.sin(phase)*.18);
      });
    },
    snapshot(time){return cores.map(core=>({id:core.id,rect:layerRect(core,time),...layerTransform(core,time)}));},
  };
}

import {layerPoint,layerRect,REFERENCE_FRAME} from './layers.js';
import {sceneFrame} from './motion.js';

export const DESKTOP_MIN_WIDTH=900;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Recompose independent assets, retaining their shared measured contact points. */
export function createCoastComposer(layers){
  const originals=structuredClone(layers),byId=id=>layers.find(layer=>layer.id===id);
  function place(layer,rect){
    layer.scale={x:rect.width/layer.rect.width,y:rect.height/layer.rect.height};
    layer.position={x:rect.x-layer.rect.x-layer.anchor.x*(layer.rect.width-rect.width),y:rect.y-layer.rect.y-layer.anchor.y*(layer.rect.height-rect.height)};
  }
  return (width,height)=>{
    layers.forEach((layer,index)=>Object.assign(layer,structuredClone(originals[index])));
    if(width<DESKTOP_MIN_WIDTH)return;
    const frame=sceneFrame(width,height),W=REFERENCE_FRAME.width,H=REFERENCE_FRAME.height;
    const visible={x:frame.offsetX*W,y:frame.offsetY*H,width:frame.cropX*W,height:frame.cropY*H};
    const screenScale=width/visible.width,waterY=visible.y+visible.height*.695;
    const ocean=byId('ocean'),oceanHeight=visible.height*.305/(1-ocean.anchors.waterline.y);
    place(ocean,{x:visible.x,y:waterY-oceanHeight*ocean.anchors.waterline.y,width:visible.width,height:oceanHeight});
    const sky=byId('sky');
    place(sky,{x:visible.x,y:waterY-sky.anchors.horizon.y*visible.height,width:visible.width,height:visible.height});
    const cliff=byId('cliff'),cliffScale=.78*frame.cropX;
    place(cliff,{x:visible.x+visible.width-W*cliffScale,y:visible.y+visible.height-H*cliffScale,width:W*cliffScale,height:H*cliffScale});
    const ledge=layerPoint(cliff,'surface');
    const child=originals.find(layer=>layer.id==='child'),feet=layerPoint(child,'feet');
    const scale=Math.min(height*.17,width*.12)/(child.rect.height*screenScale);
    const target={x:ledge.x+width*.008/screenScale,y:ledge.y-2/screenScale};
    for(const id of ['child','telescope']){
      const base=layerRect(originals.find(layer=>layer.id===id));
      place(byId(id),{x:target.x+(base.x-feet.x)*scale,y:target.y+(base.y-feet.y)*scale,width:base.width*scale,height:base.height*scale});
    }
  };
}

export function presentationZoom(category,viewport){
  if(viewport.width<DESKTOP_MIN_WIDTH)return 1;
  const baseScale=Math.min(viewport.width/1120,viewport.height/840);
  return clamp(Math.min(viewport.width*.215,viewport.height*.40)/(category.radius*baseScale),.8,1.7);
}

export function galaxyFocusPoint(category,viewport){
  const desktop=viewport.width>=DESKTOP_MIN_WIDTH;
  const yOffset=desktop?.16:viewport.width>=600&&viewport.width<1100?.08:.15;
  return {x:category.position.x+viewport.width*(desktop?.15:.14)/viewport.scale,y:category.position.y+viewport.height*yOffset/viewport.scale};
}

/** DOM labels and their visibility share the projection and a complete text-box budget. */
export function galaxyLabelLayout(category,point,viewport){
  const desktop=viewport.width>=DESKTOP_MIN_WIDTH,radius=category.radius*viewport.scale;
  const titleSize=desktop?clamp(Math.min(viewport.width*.03,viewport.height*.078),32,58):20;
  const labelOffset=desktop?Math.min(radius*.8+8,viewport.height*.30):Math.min(radius*.88+8,viewport.height*.27);
  const summaryOffset=titleSize*1.25+10,enterOffset=summaryOffset+34;
  const copyHeight=desktop?enterOffset+46:72,labelWidth=desktop?Math.max(220,titleSize*category.title.length*1.15):220;
  const margin=desktop?labelWidth/2+20:40;
  const visible=point.x>margin&&point.x<viewport.width-margin&&point.y+radius>65&&point.y+labelOffset+copyHeight<viewport.height-8;
  return {radius,labelOffset,titleSize,summaryOffset,enterOffset,copyHeight,labelWidth,visible};
}

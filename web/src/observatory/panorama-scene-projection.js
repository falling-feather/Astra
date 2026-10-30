import { projectWorldPoint, wrapDelta, wrapPosition } from './panorama-model.js';
import { PANORAMA_DUST_LAYER } from './panorama-scene-data.js';

export function projectPanoramaDisc(entry,camera,viewport,world,out={}){
  projectWorldPoint(entry.position,camera,viewport,world,out);
  out.radius=entry.radius*viewport.scale;
  const extent=out.radius*1.7;
  out.visible=out.x+extent>=0&&out.x-extent<=viewport.width&&out.y+extent>=0&&out.y-extent<=viewport.height;
  return out;
}

/** Connected geometry keeps its anchor's periodic copy, even at the antipodal cut. */
export function projectConnectedWorldPoint(point,anchor,anchorScreen,viewport,world,out={}){
  out.x=anchorScreen.x+wrapDelta(point.x-anchor.x,world.width)*viewport.scale;
  out.y=anchorScreen.y+(point.y-anchor.y)*viewport.scale;return out;
}

/** Periodic shader phases derive from the public world model, not another camera. */
export function panoramaBackgroundUniforms(camera,viewport,world,out={}){
  out.phaseX=wrapPosition(camera.x,world.width)/world.width*Math.PI*2;
  out.centerY=camera.y/world.height;
  out.horizontalSpan=viewport.width/(viewport.scale*world.width)*Math.PI*2;
  out.verticalSpan=viewport.height/(viewport.scale*world.height);
  const dustPeriod=world.width/PANORAMA_DUST_LAYER.repeat;
  out.dustPhaseX=wrapPosition(camera.x,dustPeriod)/dustPeriod;
  out.dustHorizontalSpan=viewport.width/(viewport.scale*dustPeriod);
  out.dustCenterY=(camera.y-PANORAMA_DUST_LAYER.worldTop)/PANORAMA_DUST_LAYER.worldHeight;
  out.dustVerticalSpan=viewport.height/(viewport.scale*PANORAMA_DUST_LAYER.worldHeight);return out;
}

export function panoramaPixelRatio(width,height,dpr,mobile){
  const budget=mobile?1800000:3400000;
  return Math.min(dpr,mobile?1.65:1.8,Math.sqrt(budget/(width*height)));
}

import { ART, artPoint } from './character-art.js';
export const CHILD_Z=-5.2;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const mod=(a,b)=>((a%b)+b)%b;

export function stationaryFoot(side){
  const point=artPoint(ART[side<0?'left':'right'].ankle);
  return {x:point.x,y:0,z:CHILD_Z,contact:true};
}

/** Stars genuinely travel from a scattered origin, curve into place, then fade for a new cycle. */
export function gatherParticle(p,time){
  const local=mod(time,20),progress=smooth((local-p.delay)/8);
  const bend=Math.sin(progress*Math.PI)*(1-progress);
  return {x:p.sx+(p.tx-p.sx)*progress+Math.sin(p.seed*20+progress*5)*.11*bend,
    y:p.sy+(p.ty-p.sy)*progress+.105*bend,
    alpha:smooth(local/1.1)*smooth((20-local)/2.2),progress};
}

/** Each column and height in a curtain follows a different wind phase. No image is displaced. */
export function curtainPoint(u,v,time,band){
  const phase=band*1.8;
  const x=[.20,.02,.40][band]+u*[.85,.86,.73][band]+.115*Math.sin(u*11+time*.22+phase)+v*.025*Math.sin(u*12+v*3-time*.43);
  const lower=.28+band*.025+.12*Math.sin(u*6.2+phase)+.085*Math.sin(u*12.4+phase*.4);
  const wind=.075*Math.sin(u*7.3+time*.46+phase)+.025*Math.sin(u*19-time*.63+phase);
  const bottom=.36+.25*Math.tanh((lower+wind-.36)/.25);
  const y=bottom-v*(.43+.10*Math.sin(u*7+phase));
  return {x,y,depth:64+band*12+9*Math.sin(u*8.5+phase+time*.19)+v*3};
}

export function starfirePoint(u,time,stream,seed=0,spread=0){
  return {x:.27+u*.78+Math.sin(u*11+time*.25+seed*3)*.012,
    y:.64-u*.52+Math.sin(u*8.5+stream*1.6+time*.19)*(.07+stream*.01)+spread+Math.sin(u*28-time*.5+seed*20)*.006,
    depth:66+stream*9+seed*2};
}

export function makeRandom(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
export function normalRandom(random){return Math.sqrt(-2*Math.log(Math.max(1e-8,random())))*Math.cos(random()*Math.PI*2);}

export const VIEW=Object.freeze({aspect:1672/941,fov:43,pitch:Math.atan(.42*Math.tan(43*Math.PI/360)),height:1.1,z:6});

/** Convert reference composition coordinates into real world positions in front of the camera. */
export function skyPoint(x,y,depth){
  const tan=Math.tan(VIEW.fov*Math.PI/360),cy=Math.cos(VIEW.pitch),sy=Math.sin(VIEW.pitch);
  const ry=(1-2*y)*tan;
  return {x:(2*x-1)*tan*VIEW.aspect*depth,y:VIEW.height+(ry*cy+sy)*depth,z:VIEW.z+(ry*sy-cy)*depth};
}

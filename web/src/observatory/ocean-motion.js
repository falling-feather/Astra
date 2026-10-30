import { seededRandom } from './motion.js';

export const OCEAN_BANDS=6;
const TAU=Math.PI*2;
const PRIMARY_FREQUENCY=24;
const PRIMARY_SPEED=2.25;
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=(min,max,value)=>{const t=clamp((value-min)/(max-min));return t*t*(3-2*t);};
const bend=(u,time)=>Math.sin(u*10.4-time*.32)*.65;

/** A deterministic surface drives both the textured mesh and the visible breaking crest. */
export function oceanSurface(u,v,time,{width,height,waterline}){
  const depth=clamp((v-waterline)/(1-waterline));
  if(v<=waterline||v>=1||u<=0||u>=1)return {dx:0,dy:0,depth,lighting:0,foam:0,edge:0};
  const edge=smooth(0,.035,u)*smooth(0,.035,1-u)*smooth(0,.06,1-v);
  // Reach readable wave height in the visible middle distance, then grow more gently.
  const strength=smooth(0,.22,depth)*(.44+.60*Math.sqrt(depth))*edge;
  const p1=depth*PRIMARY_FREQUENCY+u*4.8+bend(u,time)-time*PRIMARY_SPEED;
  const p2=depth*42+u*7.1-time*3.6+Math.sin(u*14+time*.2)*.3;
  const p3=depth*70-u*11-time*5.1;
  const dx=(Math.cos(p1)*6.4+Math.cos(p2)*2.2)*strength*width/1672;
  const dy=-(Math.sin(p1)*9.3+Math.sin(p2)*2.6+Math.sin(p3)*.6)*strength*height/941;
  const lighting=(-Math.cos(p1)*.76-Math.cos(p2)*.24)*strength;
  const crest=Math.pow(Math.max(0,Math.sin(p1)),10)+Math.pow(Math.max(0,Math.sin(p2)),14)*.26;
  const broken=smooth(.3,.77,.53+Math.sin(u*39+time*1.5)*.27+Math.sin(u*103-time*2.1)*.2);
  return {dx,dy,depth,lighting,foam:Math.min(1,crest*broken*strength),edge};
}

/** A travelling crest is solved from the primary wave phase, then deformed by that surface. */
export function oceanCrestAt(u,band,time,water){
  const cycle=Math.floor(time*PRIMARY_SPEED/TAU),waveId=band-1-cycle;
  const depth=(Math.PI/2+TAU*waveId-u*4.8-bend(u,time)+time*PRIMARY_SPEED)/PRIMARY_FREQUENCY;
  const v=water.waterline+depth*(1-water.waterline),surface=oceanSurface(u,v,time,water);
  return {x:u*water.width+surface.dx,y:v*water.height+surface.dy,v,depth,visible:depth>0&&depth<1,foam:surface.foam,edge:surface.edge,waveId};
}

export function createSpraySeeds(count=210){
  const random=seededRandom(320471);
  return Array.from({length:count},(_,index)=>({id:index,u:.025+random()*.95,band:Math.floor(random()*OCEAN_BANDS),delay:random()*3.5,period:2.0+random()*1.9,life:.7+random()*.55,drift:-8+random()*36,lift:45+random()*40,size:1.2+random()*1.4}));
}

/** Short ballistic droplets leave a crest and expire; they never move the foreground. */
export function oceanSprayAt(seed,time,water){
  const cycle=Math.floor((time+seed.delay)/seed.period),born=cycle*seed.period-seed.delay,elapsed=Math.max(0,time-born);
  const crest=oceanCrestAt(seed.u,seed.band,born,water),progress=clamp(elapsed/seed.life);
  const strength=.5+.5*Math.sqrt(clamp(crest.depth));
  const visible=crest.visible&&crest.depth>.14&&elapsed<seed.life;
  const alpha=visible?smooth(0,.1,progress)*Math.pow(1-progress,1.4)*smooth(.09,.40,crest.depth)*Math.min(1,.1+crest.foam*1.3)*.68:0;
  return {
    x:crest.x+seed.drift*elapsed*strength,
    y:crest.y-seed.lift*elapsed*strength+80*elapsed*elapsed,
    alpha,progress,depth:crest.depth,size:seed.size*(.58+.42*Math.sqrt(clamp(crest.depth))),
  };
}

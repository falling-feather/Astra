export const REFERENCE_ASPECT=1672/941;
const METEOR_CYCLE=14;
const METEORS=Object.freeze([
  {start:.7,duration:1.35,x:.91,y:.10,speed:260,angle:.45,length:178,width:1.65,headSize:17},
  {start:3.4,duration:1.65,x:.73,y:.21,speed:190,angle:.56,length:122,width:1.3,headSize:14},
  {start:6.2,duration:1.15,x:.95,y:.065,speed:340,angle:.43,length:210,width:1.5,headSize:18},
  {start:9.1,duration:1.8,x:.60,y:.13,speed:225,angle:.38,length:154,width:1.6,headSize:16},
  {start:11.8,duration:1.4,x:.88,y:.29,speed:285,angle:.62,length:198,width:1.35,headSize:16},
  {start:6.65,duration:.95,x:.87,y:.12,speed:380,angle:.48,length:92,width:1.05,headSize:12},
]);
export const METEOR_COUNT=METEORS.length;
const clamp01=value=>Math.max(0,Math.min(1,value));
const smooth01=value=>{const t=clamp01(value);return t*t*(3-2*t);};

export function createObservatoryClock(reducedMotion=false){
  let time=0,last=null,playing=!reducedMotion,visible=true;
  return {
    get time(){return time;},
    get playing(){return playing;},
    get active(){return playing&&visible;},
    step(now){
      const delta=last===null?0:Math.max(0,Math.min((now-last)/1000,.05));
      last=now;
      if(playing&&visible)time+=delta;
      return time;
    },
    setPlaying(value){playing=Boolean(value);last=null;},
    setVisible(value){visible=Boolean(value);last=null;},
  };
}

/** Portrait layouts widen the coast and anchor it to the bottom; the sky fills the space above. */
export function sceneFrame(width,height){
  const ratio=width/height;
  const cropX=Math.max(width<600?.52:0,Math.min(1,ratio/REFERENCE_ASPECT));
  const cropY=cropX*REFERENCE_ASPECT/ratio;
  return {cropX,cropY,offsetX:(1-cropX)*.94,offsetY:(1-cropY)*(cropY>1?1:.40)};
}

export function projectPoint(x,y,frame,width,height){
  return {x:(x-frame.offsetX)/frame.cropX*width,y:(y-frame.offsetY)/frame.cropY*height};
}

export function meteorAt(time,index){
  const meteor=METEORS[index];
  if(!meteor)throw new RangeError('未知流星槽。');
  const cycle=Math.floor((time-meteor.start)/METEOR_CYCLE),elapsed=time-meteor.start-cycle*METEOR_CYCLE;
  const active=cycle>=0&&elapsed>1e-9&&elapsed<meteor.duration-1e-9;
  const progress=clamp01(elapsed/meteor.duration),variation=Math.sin((Math.max(0,cycle)+1)*(index+2)*1.73);
  const direction={x:-Math.cos(meteor.angle),y:Math.sin(meteor.angle)};
  const travel=meteor.speed*Math.min(elapsed,meteor.duration);
  const alpha=active?smooth01(progress/.13)*smooth01((1-progress)/.35):0;
  const tailLength=meteor.length*Math.min(1,.2+progress*3)*(1-.15*smooth01((progress-.8)/.2));
  return {
    x:meteor.x+variation*.035+direction.x*travel/1672,
    y:meteor.y+variation*.02+direction.y*travel/941,
    alpha,active,progress,cycle,speed:meteor.speed,direction,tailLength,tail:tailLength/1672,width:meteor.width,headSize:meteor.headSize,
  };
}

/** Reference-space tail geometry uses the same head state as the luminous particle. */
export function meteorTrailPoint(meteor,amount){
  const t=clamp01(amount),distance=meteor.tailLength*t;
  const curve=Math.sin(t*Math.PI)*1.2;
  return {
    x:meteor.x+(-meteor.direction.x*distance-meteor.direction.y*curve)/1672,
    y:meteor.y+(-meteor.direction.y*distance+meteor.direction.x*curve)/941,
    halfWidth:Math.max(.025,meteor.width*Math.pow(1-t,.82)),
    alpha:meteor.alpha*Math.pow(1-t,1.65),
  };
}

export function seededRandom(seed){
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
}

export function gatherStar(star,time){
  if(time<star.delay)return {x:star.sx,y:star.sy,progress:0,alpha:0};
  const local=((time-star.delay)%17.5+17.5)%17.5;
  const raw=Math.min(1,local/6.6);
  const progress=raw*raw*(3-2*raw);
  const bend=Math.sin(progress*Math.PI)*(1-progress);
  const alpha=Math.min(1,local/1.1)*Math.min(1,(17.5-local)/2.2);
  return {
    x:star.sx+(star.tx-star.sx)*progress+Math.sin(star.seed*18+progress*5)*.062*bend,
    y:star.sy+(star.ty-star.sy)*progress+Math.sin(star.seed*12)*.105*bend,
    progress,alpha,
  };
}

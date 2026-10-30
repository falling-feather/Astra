const TAU=Math.PI*2;
export const PANORAMA_DUST_LAYER=Object.freeze({id:'milky-way-background',asset:'/assets/observatory/milky-way-concept.png',repeat:4,worldTop:600,worldHeight:1000,opacity:.14,edgeFade:.04});
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
function random(seed){let state=seed|0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}

export function createPanoramaParticles(catalog,world,mobile=false){
  const rand=random(928441),insideRand=random(4075711519),farCount=mobile?3200:16000,perNebula=Math.min(mobile?120:160,Math.floor(800/Math.max(1,catalog.length)));
  const far=Array.from({length:farCount},(_,index)=>({
    x:rand()*world.width,y:(rand()*1.6-.3)*world.height,phase:rand()*TAU,
    size:index<48?5.5+rand()*2.7:2.7+rand()*1.7,alpha:index<48?.78+rand()*.16:.45+rand()*.33,
    seed:rand(),warm:rand()>.90,
  }));
  const inside=catalog.flatMap((_,nebulaIndex)=>Array.from({length:perNebula},()=>({
    nebulaIndex,angle:insideRand()*TAU,radius:.09+Math.pow(insideRand(),.63)*.76,speed:(.018+insideRand()*.045)*(insideRand()>.3?1:-1),
    phase:insideRand()*TAU,flatten:.57+insideRand()*.22,size:1.9+insideRand()*3.2,alpha:.42+insideRand()*.44,seed:insideRand(),
  })));
  return {far,inside};
}

export function sampleNebulaParticle(particle,nebula,time,out={}){
  const angle=particle.angle+time*particle.speed+.04*Math.sin(time*.28+particle.phase);
  const radius=nebula.radius*particle.radius*(1+.04*Math.sin(angle*3+time*.31+particle.phase));
  out.x=nebula.position.x+Math.cos(angle)*radius;
  out.y=nebula.position.y+Math.sin(angle)*radius*particle.flatten+Math.sin(angle*2-time*.23+particle.phase)*nebula.radius*.022;
  out.alpha=particle.alpha;out.size=particle.size;return out;
}

export function sampleNebulaFilament(nebula,index,amount,time,out={}){
  const phase=index*1.37,angle=phase+(amount-.5)*(2.3+index*.11)+time*(index%2?.028:-.019);
  const radius=nebula.radius*(.14+index*.072+.035*Math.sin(amount*9+time*.34+phase));
  const warp=nebula.radius*.024*Math.sin(amount*14-time*.41+phase)*Math.sin(amount*Math.PI);
  out.x=nebula.position.x+Math.cos(angle)*radius+warp;
  out.y=nebula.position.y+Math.sin(angle)*radius*.66+warp*.55;
  out.alpha=(amount<=0||amount>=1)?0:Math.sin(amount*Math.PI)*(.037+.016*Math.sin(time*.5+phase));
  return out;
}

export function createPanoramaMeteors(catalog){
  const rand=random(720191);
  return catalog.flatMap((nebula,nebulaIndex)=>Array.from({length:3},(_,index)=>({
    nebulaIndex,start:.65+index*3.12+nebulaIndex*.34,period:9.8,duration:1.15+rand()*.60,
    x:nebula.position.x+nebula.radius*(.6+rand()*1.6),y:nebula.position.y-nebula.radius*(.25+rand()*1.1),
    speed:210+rand()*140,angle:.28+rand()*.30,length:155+rand()*150,width:1.25+rand()*.60,phase:rand()*TAU,
  })));
}

export function samplePanoramaMeteor(slot,time,out={}){
  const cycle=Math.floor((time-slot.start)/slot.period),elapsed=time-slot.start-cycle*slot.period,progress=clamp(elapsed/slot.duration);
  const active=cycle>=0&&elapsed>1e-9&&elapsed<slot.duration-1e-9;
  const variation=Math.sin(Math.max(0,cycle)*1.43+slot.phase),travel=slot.speed*Math.min(slot.duration,elapsed);
  out.x=slot.x+variation*65-Math.cos(slot.angle)*travel;out.y=slot.y+variation*36+Math.sin(slot.angle)*travel;
  out.alpha=active?smooth(progress/.13)*smooth((1-progress)/.35):0;
  out.dx=-Math.cos(slot.angle);out.dy=Math.sin(slot.angle);out.length=slot.length*Math.min(1,.2+progress*3);out.width=slot.width;
  out.progress=progress;out.active=active;return out;
}

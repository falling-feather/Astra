import { wrapDelta } from './panorama-model.js';

const TAU=Math.PI*2;
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const fract=value=>value-Math.floor(value);
const styles={engineering:0,code:1,future:2,ai:3};
export const SELECTION_EXTENT=1.62;
export function selectionStyleIndex(id){return styles[id]??0;}

/** Scene time drives the transition; a frozen-time selection gets an immediate visible state. */
export function createSelectionWeights(ids,duration=1.25){
  const values=new Float64Array(ids.length),from=new Float64Array(ids.length),target=new Float64Array(ids.length);
  let current=null,previousTime=null,startTime=0;
  return {
    update(selectedId,time){
      const next=ids.includes(selectedId)?selectedId:null;
      if(previousTime!==null){const mix=smooth((time-startTime)/duration);for(let i=0;i<values.length;i++)values[i]=from[i]+(target[i]-from[i])*mix;}
      if(previousTime===null||next!==current){
        from.set(values);target.fill(0);const index=ids.indexOf(next);if(index>=0)target[index]=1;
        if(previousTime===null||time<=previousTime){values.set(target);from.set(target);}
        startTime=time;current=next;
      }
      previousTime=time;return values;
    },
    snapshot(){return Object.fromEntries(ids.map((id,index)=>[id,values[index]]));},
  };
}

function limitedPoint(x,y,limit,out){const distance=Math.hypot(x,y),scale=distance>limit?limit/distance:1;out.x=x*scale;out.y=y*scale;return out;}

export function sampleSelectedAmbientStar(star,nebula,time,weight,world,out={}){
  const dx=wrapDelta(star.x-nebula.position.x,world.width),dy=star.y-nebula.position.y,radius=nebula.radius;
  const influence=smooth((SELECTION_EXTENT-Math.hypot(dx,dy)/radius)/(SELECTION_EXTENT-.45));
  const amount=clamp(weight)*influence,phase=star.seed*TAU,style=selectionStyleIndex(nebula.id);
  if(amount===0){out.x=star.x;out.y=star.y;out.influence=0;return out;}
  let x=dx,y=dy;
  if(style===0){
    const angle=amount*.14*Math.sin(time*.42+phase),size=1-amount*.22;
    x=(dx*Math.cos(angle)-dy*Math.sin(angle))*size;y=(dx*Math.sin(angle)+dy*Math.cos(angle))*size;
  }else if(style===1){
    x=dx*(1-amount*.13)+radius*.08*amount*Math.sin(time*.75+dy/radius*6+phase);
    y=dy*(1-amount*.13)+radius*.10*amount*Math.sin(time*.60+dx/radius*7+phase);
  }else if(style===2){
    const size=1-amount*.12+amount*.07*Math.sin(time*.26+phase),angle=amount*.18*Math.sin(time*.25+phase);
    x=(dx*Math.cos(angle)-dy*Math.sin(angle))*size;y=(dx*Math.sin(angle)+dy*Math.cos(angle))*size;
  }else{
    const pulse=1-amount*.21+amount*.045*Math.sin(time*.70-phase);
    x=dx*pulse+radius*.025*amount*Math.sin(time*.4+phase);y=dy*pulse+radius*.035*amount*Math.sin(time*.55+phase);
  }
  limitedPoint(x,y,radius*SELECTION_EXTENT,out);out.x+=nebula.position.x;out.y+=nebula.position.y;out.influence=influence;return out;
}

function selectionPath(nebula,index,amount,time,out){
  const style=selectionStyleIndex(nebula.id),t=clamp(amount);let x,y;
  if(style===0){
    const angle=index*.98+(t-.5)*1.7+time*.045,radius=.74+index*.087+.018*Math.sin(t*9+time*.42+index);
    x=Math.cos(angle)*radius;y=Math.sin(angle)*radius*.78+.025*Math.sin(t*6+time*.24);
  }else if(style===1){
    const a=-1.30+2.6*t,b=(index-2.5)*.10+Math.sin(t*6.8+index*.6-time*.68)*.24;
    x=a*Math.cos(-.35)-b*Math.sin(-.35);y=a*Math.sin(-.35)+b*Math.cos(-.35);
  }else if(style===2){
    const angle=index*1.12+(t-.5)*2.5+time*.019,radius=.82+index*.085+.045*Math.sin(t*5.5+time*.29+index);
    x=Math.cos(angle)*radius;y=Math.sin(angle)*radius*.73+.055*Math.sin(t*9-time*.20);
  }else{
    const a=index*.99+Math.sin(time*.16+index)*.026,b=a+1.02+(index%2)*.32,ra=.8+(index%3)*.095,rb=.76+((index+1)%3)*.08;
    x=Math.cos(a)*ra*(1-t)+Math.cos(b)*rb*t;y=Math.sin(a)*ra*.8*(1-t)+Math.sin(b)*rb*.8*t+Math.sin(t*Math.PI)*.04*Math.sin(time*.25+index);
  }
  return limitedPoint(x,y,1.55,out);
}

export function createSelectionParticles(catalog,perGalaxy=112){
  let state=618297;
  const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  return catalog.flatMap((_,region)=>Array.from({length:perGalaxy},()=>({region,line:Math.floor(rand()*6),start:rand(),homeAngle:rand()*TAU,homeRadius:.90+rand()*.61,phase:rand()*TAU,size:2.8+rand()*1.7,alpha:.55+rand()*.30})));
}

export function sampleSelectionParticle(particle,nebula,time,weight,out={}){
  const style=selectionStyleIndex(nebula.id),progress=fract(particle.start+time*[.085,.20,.065,.16][style]),mix=clamp(weight);
  selectionPath(nebula,particle.line,progress,time,out);
  const homeX=Math.cos(particle.homeAngle)*particle.homeRadius,homeY=Math.sin(particle.homeAngle)*particle.homeRadius;
  const pathMix=mix*.80;
  const x=homeX+(out.x-homeX)*pathMix+Math.sin(time*.45+particle.phase)*.014*mix,y=homeY+(out.y-homeY)*pathMix+Math.cos(time*.38+particle.phase)*.014*mix;
  limitedPoint(x,y,1.58,out);out.x=nebula.position.x+out.x*nebula.radius;out.y=nebula.position.y+out.y*nebula.radius;
  out.alpha=mix*particle.alpha*Math.pow(Math.sin(progress*Math.PI),.65)*(.76+.24*Math.sin(time*.55+particle.phase));out.size=particle.size;return out;
}

export function sampleSelectionFilament(nebula,index,amount,time,weight,out={}){
  selectionPath(nebula,index,amount,time,out);out.x=nebula.position.x+out.x*nebula.radius;out.y=nebula.position.y+out.y*nebula.radius;
  const style=selectionStyleIndex(nebula.id),pulsePosition=fract(time*[.12,.27,.09,.22][style]+index*.15),distance=Math.abs(amount-pulsePosition);
  const pulse=Math.exp(-Math.pow(Math.min(distance,1-distance)/.052,2));
  out.alpha=amount<=0||amount>=1?0:clamp(weight)*Math.pow(Math.sin(amount*Math.PI),.6)*pulse*.23;return out;
}

export function sampleSelectionFlare(nebula,index,time,weight,out={}){
  const style=selectionStyleIndex(nebula.id),period=8.8+style*.9,start=1+index*2.6,local=((time-start)%period+period)%period,duration=1.3;
  selectionPath(nebula,index*2,.2+index*.24,time,out);out.x=nebula.position.x+out.x*nebula.radius;out.y=nebula.position.y+out.y*nebula.radius;
  out.alpha=local>1e-8&&local<duration-1e-8?Math.sin(local/duration*Math.PI)**2*clamp(weight)*.72:0;out.size=17+index*5;return out;
}

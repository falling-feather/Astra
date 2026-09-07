export function wrapCourse(index:number,count:number):number {
  return count>0?((index%count)+count)%count:0;
}

function smooth(value:number):number {const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);}

export interface CourseLayer {
  ordinal:number;
  index:number;
  slot:number;
  opacity:number;
  labelVisible:boolean;
}

/** A bounded visible window over an unbounded cyclic position. */
export function visibleCourses(position:number,count:number):CourseLayer[] {
  if(count===0)return [];
  if(count===1)return [{ordinal:0,index:0,slot:0,opacity:1,labelVisible:true}];
  const first=Math.floor(position+1e-8);
  const layers=Array.from({length:3},(_,offset)=>{
    const ordinal=first+offset,slot=ordinal-position;
    const opacity=slot<0?smooth(slot+1):slot<=1?1-.56*smooth(slot):.44*(1-smooth(slot-1));
    return {ordinal,index:wrapCourse(ordinal,count),slot,opacity,labelVisible:opacity>.12&&slot<1.6};
  });
  // With two courses, the incoming repeat must not duplicate a visible label.
  for(const layer of layers){
    if(layers.some(other=>other!==layer&&other.index===layer.index&&other.opacity>layer.opacity))layer.labelVisible=false;
  }
  return layers;
}

/** Selection is committed only after landing; rendering never owns the course record. */
export class CourseWheel {
  readonly count:number;
  position=0;
  target=0;
  settledOrdinal=0;
  dragging=false;
  private dragOrigin=0;

  constructor(count:number){this.count=Math.max(0,count);}
  get index():number{return wrapCourse(this.settledOrdinal,this.count);}

  select(index:number,instant=false):void {
    if(this.count<2){this.position=this.target=this.settledOrdinal=0;return;}
    const base=Math.round(this.position);
    let distance=wrapCourse(index-wrapCourse(base,this.count),this.count);
    if(distance>this.count/2)distance-=this.count;
    this.target=base+distance;this.dragging=false;
    if(instant)this.position=this.settledOrdinal=this.target;
  }

  step(direction:number):void {if(this.count>1){this.target=Math.round(this.target)+Math.sign(direction);this.dragging=false;}}
  beginDrag():void {this.dragging=true;this.dragOrigin=this.position;}
  drag(offset:number):void {if(this.dragging&&this.count>1)this.position=this.dragOrigin+Math.max(-2.5,Math.min(2.5,offset));}
  endDrag(cancel=false):void {this.target=cancel?Math.round(this.dragOrigin):Math.round(this.position);this.dragging=false;}

  update(delta:number,reduced=false):number|null {
    if(this.dragging)return null;
    const distance=this.target-this.position;
    const advance=reduced?distance:distance*(1-Math.exp(-Math.max(0,delta)*9));
    this.position+=reduced?advance:Math.sign(advance)*Math.min(Math.abs(advance),Math.max(0,delta)*4.5);
    if(Math.abs(this.target-this.position)<.002){
      this.position=this.target;
      if(this.settledOrdinal!==this.target){this.settledOrdinal=this.target;return this.index;}
    }
    return null;
  }
}

export class CourseAtlasMotion {
  constructor(catalog){this.catalog=catalog;this.categoryId=null;this.topicId=null;this.progress=0;this.target=0;this.velocity=0;}
  get category(){return this.catalog.find(item=>item.id===this.categoryId);}
  get active(){return this.categoryId!==null;}
  get moving(){return this.active&&(this.progress!==this.target||this.velocity!==0);}
  get closing(){return this.active&&this.target===0;}
  open(id,{animate=true}={}){
    if(!this.catalog.some(item=>item.id===id))throw new RangeError('未知课程星系。');
    if(this.categoryId!==id){this.categoryId=id;this.topicId=null;this.progress=0;this.velocity=0;}
    this.target=1;if(!animate){this.progress=1;this.velocity=0;}
  }
  close({animate=true}={}){
    this.target=0;
    if(!animate){this.progress=0;this.velocity=0;this.categoryId=null;this.topicId=null;}
  }
  select(id){
    if(id!==null&&!this.category?.topics.some(item=>item.id===id))throw new RangeError('课程不属于当前星系。');
    this.topicId=id;
  }
  step(elapsed){
    if(!this.moving)return false;
    const dt=Math.max(0,Math.min(.1,elapsed)),omega=12,difference=this.progress-this.target;
    const decay=Math.exp(-omega*dt),delta=(this.velocity+omega*difference)*dt;
    this.progress=Math.max(0,Math.min(1,this.target+(difference+delta)*decay));
    this.velocity=(this.velocity-omega*delta)*decay;
    if(Math.abs(this.progress-this.target)<.001&&Math.abs(this.velocity)<.014){
      this.progress=this.target;this.velocity=0;
      if(this.target===0){this.categoryId=null;this.topicId=null;}
    }
    return true;
  }
}

/** Labels use fixed boxes; only their light stars travel between the source and these targets. */
export function atlasLayout(width,height,count){
  const stacked=width<900||height<620;
  const x=width<760?18:Math.max(28,width*.04),y=height<620?94:112;
  const areaWidth=width<760?width-36:Math.min(stacked?560:1040,width*.64);
  const frame={x,y,width:areaWidth,height:Math.max(210,height-y-(width<900?170:124))};
  const nodes=Array.from({length:count},(_,index)=>{
    if(stacked){const nx=x+18,ny=y+140+index*86;return {x:nx,y:ny,box:{x:x+48,y:ny-29,width:areaWidth-50,height:72}};}
    const columns=Math.min(3,count),column=index%columns,row=Math.floor(index/columns);
    const nx=x+areaWidth*(columns===1?.5:.14+column*.72/(columns-1));
    const ny=y+[170,108,198][column]+row*156;
    const nodeWidth=Math.min(238,areaWidth/columns-26);
    return {x:nx,y:ny,box:{x:nx-nodeWidth/2,y:ny+22,width:nodeWidth,height:87}};
  });
  const bottom=Math.max(y+100,...nodes.map(node=>node.box.y+node.box.height));
  const preview={x,y:bottom+25,width:areaWidth,height:stacked?320:268};
  return {frame,nodes,preview,stacked,contentHeight:preview.y+preview.height-y+16};
}

export function atlasCurve(source,node,index){
  const dx=node.x-source.x,bend=(index-1)*64;
  return {x1:source.x+dx*.24+bend,y1:source.y-70-index*13,x2:node.x-dx*.18,y2:node.y-55};
}

export function atlasNodePose(source,node,progress,index,out={}){
  const t=Math.max(0,Math.min(1,progress)),v=1-t,curve=atlasCurve(source,node,index);
  out.x=v*v*v*source.x+3*v*v*t*curve.x1+3*v*t*t*curve.x2+t*t*t*node.x;
  out.y=v*v*v*source.y+3*v*v*t*curve.y1+3*v*t*t*curve.y2+t*t*t*node.y;
  out.z=Math.sin(Math.PI*t)*(index===1?70:-42)+t*(index-1)*12;
  out.alpha=Math.min(1,t*4);
  return out;
}

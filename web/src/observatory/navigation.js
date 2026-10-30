export const NAVIGATION = Object.freeze([
  {id:'overview',label:'星图总览',icon:'planet'},
  {id:'explore',label:'星际探索',icon:'orbit'},
  {id:'journal',label:'观测日志',icon:'journal'},
  {id:'library',label:'知识星库',icon:'book'},
  {id:'studio',label:'创作工坊',icon:'pen'},
  {id:'favorites',label:'灵感收藏',icon:'heart'},
  {id:'profile',label:'个人中心',icon:'person'},
]);

const STARS = [[800,135],[699,216],[632,310],[551,427],[620,524],[355,620],[510,704]];
const EDGES = [[0,1],[1,2],[2,3],[3,4],[4,6],[6,5],[5,3]];
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));

/** One set of coordinates owns band tips, hit areas, stars, and connecting lines. */
export function layoutNavigation(width,height){
  const narrow=width<900;
  const short=height<570;
  const fontSize=clamp(width/1672*28,16,29);
  const labelX=narrow?59:width*.073;
  const labelEnd=labelX+fontSize*4+fontSize*.15*3;
  const minimumStar=Math.max(labelEnd+38,width*.20);
  const maxStar=narrow?width*.88:width*800/1672;
  const rowHeight=short?34:clamp(height/941*62,44,66);
  const top=short?98:Math.max(114,height*135/941);
  const bottom=short?height-53:Math.min(height-83,height*704/941);
  return NAVIGATION.map((item,index)=>{
    const [refX,refY]=STARS[index];
    const x=narrow?minimumStar+(refX-355)/(800-355)*(maxStar-minimumStar):refX*width/1672;
    const y=(narrow||short)?top+(refY-135)/(704-135)*(bottom-top):refY*height/941;
    return {...item,index,x,y,height:rowHeight,fontSize,labelX,labelEnd};
  });
}

export function navigationLines(rows){
  return EDGES.map(([from,to])=>({from,to,x1:rows[from].x,y1:rows[from].y,x2:rows[to].x,y2:rows[to].y}));
}

export function initialNavigation(){return {open:false,active:'overview',panel:null};}

export function transitionNavigation(state,event){
  switch(event.type){
    case 'toggle':return {...state,open:!state.open,panel:null};
    case 'close':return {...state,open:false};
    case 'escape':return {...state,open:false,panel:null};
    case 'select':return NAVIGATION.some(item=>item.id===event.id)?{open:false,active:event.id,panel:event.id}:state;
    default:return state;
  }
}

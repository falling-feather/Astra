export const TARGETS=Object.freeze([
  {id:'milky-way',name:'银河深处',x:.59,y:.25,color:'#efc4ee',description:'沿着蓝紫色的星河向上，看看那些被夜色包裹的细碎光芒。'},
  {id:'blue-cluster',name:'蓝色星群',x:.41,y:.29,color:'#a5d7ff',description:'将目光停在冰蓝的星群之间，让明暗与远近慢慢浮现。'},
  {id:'golden-horizon',name:'金色天际',x:.41,y:.60,color:'#ffdda2',description:'海与天空相接的地方，晚霞正被一层层星光轻轻接住。'},
]);
const targetIds=new Set(TARGETS.map(target=>target.id));
export function emptyNotebook(){return {version:1,notes:[],favorites:[]};}
export function notebookKey(username){return `astra:observatory:notebook:${encodeURIComponent(username)}`;}

export function addNote(book,text,targetId,createdAt=new Date().toISOString()){
  const clean=text.trim();
  if(!clean)throw new Error('请先写下一点观测感受。');
  if(clean.length>1000)throw new Error('请将这篇观测记录保留在 1000 字以内。');
  if(!targetIds.has(targetId))throw new Error('请选择一个已知星域。');
  return {...book,notes:[{id:`${createdAt}-${book.notes.length}`,text:clean,targetId,createdAt},...book.notes]};
}

export function toggleFavorite(book,targetId){
  if(!targetIds.has(targetId))throw new Error('请选择一个已知星域。');
  const favorites=book.favorites.includes(targetId)?book.favorites.filter(id=>id!==targetId):[...book.favorites,targetId];
  return {...book,favorites};
}

export function readNotebook(storage,key){
  try{
    const stored=storage.getItem(key);
    if(stored===null)return {notebook:emptyNotebook(),issue:null};
    const data=JSON.parse(stored);
    if(data?.version!==1||!Array.isArray(data.notes)||!Array.isArray(data.favorites))throw new Error('Invalid notebook');
    if(data.notes.some(note=>typeof note.text!=='string'||!note.text.trim()||note.text.length>1000||typeof note.id!=='string'||!targetIds.has(note.targetId)||!Number.isFinite(Date.parse(note.createdAt))))throw new Error('Invalid note');
    if(data.favorites.some(id=>!targetIds.has(id)))throw new Error('Invalid favorite');
    return {notebook:{version:1,notes:data.notes,favorites:[...new Set(data.favorites)]},issue:null};
  }catch{
    return {notebook:emptyNotebook(),issue:'暂时无法读取本地记录。原有存储未被修改。'};
  }
}

export function writeNotebook(storage,key,book){storage.setItem(key,JSON.stringify(book));}

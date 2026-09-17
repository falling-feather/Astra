import {copyFile, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {courseRegionAssignments, courseFieldLessonsV3} from '../packages/course-content/dist/index.js';
import {optimizePublicImages} from './lib/public-images.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const web=resolve(root,'apps/web');
const output=resolve(root,'.local/public-student-demo/dist');
const require=createRequire(resolve(web,'package.json'));
const {build}=await import(pathToFileURL(require.resolve('vite')).href);
const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const catalog=courseRegionAssignments.map(meta=>{
  const original=courseFieldLessonsV3.find(item=>item.courseId===meta.courseId);
  if(!original)throw new Error(`Missing lesson for ${meta.courseId}`);
  const {title,assignment,initialNodeId,nodes,people,materials,strategies,workPlan}=original.lesson;
  return {...meta,lesson:{title,assignment,initialNodeId,nodes,people:people.map(({id,name,role,nodeId,activity,goal,greeting,topics,appearance})=>({id,name,role,nodeId,activity,goal,greeting,topics,appearance})),materials,strategies,workPlan}};
});
const assetPaths=new Set(['/assets/archive/charcoal-paper.png','/assets/archive/xunpu-cover.png','/assets/v3/course-covers.png']);
function collectAssets(value){
  if(typeof value==='string'&&value.startsWith('/assets/'))assetPaths.add(value);
  else if(value&&typeof value==='object')Object.values(value).forEach(collectAssets);
}
collectAssets(catalog);
const cache=resolve(root,'.local/public-image-cache');
const optimized=await optimizePublicImages(assetPaths,resolve(web,'public'),cache);
const variants=Object.fromEntries(optimized.map(asset=>[asset.originalPath,asset.publicPath]));
const filesByPath=new Map(optimized.map(asset=>[asset.originalPath,asset.name]));
const lessons=catalog.map(course=>({file:`lessons/${course.courseId}-${hash(JSON.stringify(course.lesson))}.json`,body:JSON.stringify(course.lesson)}));
const summaries=catalog.map(({lesson,...meta},index)=>({...meta,assignment:lesson.assignment,initialNodeId:lesson.initialNodeId,sceneCount:lesson.nodes.length,personCount:lesson.people.length,pathCount:lesson.strategies.length,lessonFile:lessons[index].file}));
const catalogBody=JSON.stringify(summaries),catalogFile=`catalog-${hash(catalogBody)}.json`;
await build({root:web,configFile:false,base:'./',resolve:{alias:{'@public-optimized':cache.replaceAll('\\','/')}},define:{__PUBLIC_ASSET_MAP__:JSON.stringify(variants),__PUBLIC_CATALOG_URL__:JSON.stringify('./'+catalogFile)},plugins:[{
  name:'optimized-public-css',enforce:'pre',transform(source,id){
    if(!id.endsWith('.css'))return null;
    return source.replace(/url\((['"]?)(\/assets\/[^)'"\s]+)\1\)/gu,(original,_quote,path)=>filesByPath.has(path)?`url("@public-optimized/${filesByPath.get(path)}")`:original);
  },
},react()],build:{outDir:output,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:resolve(web,'public-demo.html'),output:{assetFileNames:asset=>((asset.names?.[0]??asset.name??'').endsWith('.webp')?'assets/optimized/[name][extname]':'assets/[name]-[hash][extname]')}}}});
await rename(resolve(output,'public-demo.html'),resolve(output,'index.html'));
for(const asset of optimized){
  const destination=resolve(output,asset.publicPath.slice(1));
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(asset.variantFile,destination);
}
await mkdir(output,{recursive:true});
await writeFile(resolve(output,catalogFile),catalogBody);
await writeFile(resolve(output,'catalog.json'),catalogBody);
await mkdir(resolve(output,'lessons'),{recursive:true});
for(const lesson of lessons)await writeFile(resolve(output,lesson.file),lesson.body);
await writeFile(resolve(output,'.nojekyll'),'');
await writeFile(resolve(output,'favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#111315"/><path d="M8 25 18 10h12l-8 12h-8l-4 7h12l13-19h6L25 36H13Z" fill="#d0ae6b"/></svg>');
const html=await readFile(resolve(output,'index.html'),'utf8');
if(/127\.0\.0\.1|localhost|\/src\//u.test(html))throw new Error('Development-only reference in public entry');
const texture=variants['/assets/archive/charcoal-paper.png'];
await writeFile(resolve(output,'index.html'),html.replace('</head>',`<link rel="preload" as="image" href=".${texture}" crossorigin="anonymous" fetchpriority="high"></head>`));
const report={output,courses:catalog.length,regions:new Set(catalog.map(course=>course.regionId)).size,scenesByRegion:Object.fromEntries(catalog.map(course=>[course.regionId,course.lesson.nodes.length])),originalImageBytes:optimized.reduce((sum,asset)=>sum+asset.originalBytes,0),imageBytes:optimized.reduce((sum,asset)=>sum+asset.bytes,0),originalCatalogBytes:Buffer.byteLength(JSON.stringify(catalog)),indexBytes:Buffer.byteLength(catalogBody),assets:optimized.map(({variantFile,...asset})=>asset)};
const reportRoot=resolve(root,'.local/public-performance');await mkdir(reportRoot,{recursive:true});
await writeFile(resolve(reportRoot,'build-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,assets:undefined}));

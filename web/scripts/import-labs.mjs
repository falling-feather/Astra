import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const extensions = new Set(['.js','.mjs','.css','.html','.json','.svg','.png','.jpg','.jpeg','.webp','.gif','.ico','.woff','.woff2','.ttf','.wasm','.mp3','.mp4','.ogg','.glb','.gltf','.bin','.pdf','.map']);
const spaces = [{key:'englab',title:'工科实验室'},{key:'code-space',title:'代码空间'},{key:'future-galaxy',title:'未来星系'}];

export function validateActivityHref(href) {
  if (typeof href !== 'string' || !href.startsWith('labs/') || /[\\\s]/.test(href)) throw new Error('实验入口必须位于本地 labs 目录。');
  const decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  if (decoded.split('/').some(part => part === '..') || decoded.includes('\\')) throw new Error('实验入口不能越出 labs 目录。');
  return href;
}

export function buildSnapshot({activities,config,codeCourses,futureCourses,source}) {
  const seen = new Set();
  for (const item of activities) {
    if(seen.has(item.key)) throw new Error('实验身份重复：'+item.key);
    seen.add(item.key);validateActivityHref(item.href);
    if(!spaces.some(space=>space.key===item.galaxy))throw new Error('未知学习空间：'+item.galaxy);
  }
  const groupsFor = key => {
    if(key==='englab')return Object.keys(config.experiments).map(id=>({id,title:config.pages[id].label,summary:config.pages[id].desc,objectives:[]}));
    const courses=key==='code-space'?codeCourses:futureCourses;
    return courses.map(course=>({id:course.course_key,title:course.title,summary:course.goal||course.objective,objectives:[course.goal||course.objective]}));
  };
  const activityDetails = new Map([...codeCourses,...futureCourses].flatMap(course=>course.activities).map(item=>[item.activity_key,item]));
  const snapshot = {
    schemaVersion:1,source,
    spaces:spaces.map(space=>({...space,topics:groupsFor(space.key).map(group=>({...group,
      activities:activities.filter(item=>item.galaxy===space.key&&item.subject===group.id).map(item=>{
        const detail=activityDetails.get(item.key);
        const experiment=config.experiments?.[item.subject]?.find(entry=>item.key===item.subject+'.'+entry.id);
        return {key:item.key,title:item.title,summary:detail?.goal||detail?.prompt||experiment?.description||'',href:item.href};
      }),
    }))})),
  };
  const total=snapshot.spaces.flatMap(space=>space.topics).flatMap(topic=>topic.activities).length;
  if(total!==activities.length)throw new Error('部分活动未分配到已登记学科。');
  return snapshot;
}

async function exists(filename){try{await fs.access(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

export async function importLabs(sourceDirectory) {
  const source=await fs.realpath(path.resolve(sourceDirectory));
  const destination=path.join(project,'public','labs');
  const catalogue=path.join(project,'src','data','lab-catalog.json');
  if(await exists(destination)||await exists(catalogue))throw new Error('实验副本已存在。为保护本地改动，此命令不会覆盖已有导入。');
  const {loadCatalog}=await import(pathToFileURL(path.join(source,'qianduan','scripts','catalog.mjs')).href);
  const context=vm.createContext({console});context.window=context;
  for(const filename of ['shared/js/config.js','codevis/shared/js/course-manifest.js','pages/frontier/frontier-manifest.js']){
    vm.runInContext(await fs.readFile(path.join(source,filename),'utf8'),context,{filename});
  }
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim();
  const snapshot=buildSnapshot({activities:loadCatalog(source),config:vm.runInContext('CONFIG',context),codeCourses:context.CvCourseManifest.courses,futureCourses:context.FrontierCourseManifest.courses,
    source:{directory:source,commit,importedAt:new Date().toISOString()}});
  let files=0,bytes=0;
  async function copyTree(relative){
    const from=path.join(source,relative),stat=await fs.lstat(from);
    if(stat.isSymbolicLink())throw new Error('公开资源中不允许符号链接：'+relative);
    const parts=relative.split(path.sep),name=path.basename(relative);
    if(parts.some(part=>part.startsWith('.')||['node_modules','tests','test-screenshots'].includes(part)))return;
    if(parts[0]==='pages'&&['admin','student','teacher'].includes(parts[1]))return;
    const to=path.join(destination,relative);
    if(stat.isDirectory()){
      await fs.mkdir(to,{recursive:true});
      for(const child of await fs.readdir(from))await copyTree(path.join(relative,child));
    }else if(stat.isFile()&&(extensions.has(path.extname(name).toLowerCase())||/^(LICENSE(?:\.md)?|SOURCE\.md|THIRD_PARTY_NOTICES\.md)$/.test(name))){
      await fs.copyFile(from,to);files++;bytes+=stat.size;
    }
  }
  await fs.mkdir(destination,{recursive:true});
  for(const dir of ['shared','pages','UI','codevis'])await copyTree(dir);
  const marker='<meta name="astra-resource-explorer" content="public">';
  let html=await fs.readFile(path.join(source,'index.html'),'utf8');
  html=html.replace('</head>',marker+'<link rel="stylesheet" href="resource-explorer.css"></head>')
    .replace(/<script\b[^>]*src="shared\/js\/(?:auth-ui|app-session)\.js[^>]*><\/script>/g,'')
    .replace(/<link\b[^>]*href="shared\/css\/(?:auth-ui|app-session)\.css[^>]*>/g,'')
    .replace('<script src="shared/js/main.js','<script src="shared/js/resource-explorer.js"></script><script src="shared/js/main.js')
    .replace('<button type="button" id="nav-search-trigger"','<a href="#planets" class="nav-item nav-item--galaxy" data-page="planets"><i data-lucide="orbit"></i><span>星序</span></a><button type="button" id="nav-search-trigger"')
    .replaceAll('class="nav-item nav-item--galaxy" data-page="planets"','class="nav-item nav-item--galaxy" data-page="planets" aria-label="星序" title="返回星序主页面"')
    .replace('</body>','<script src="../labs-host/bridge.js"></script></body>');
  await fs.writeFile(path.join(destination,'index.html'),html,'utf8');
  let code=await fs.readFile(path.join(destination,'codevis','index.html'),'utf8');
  code=code.replace('</head>',marker+'</head>')
    .replace(/<script\b[^>]*src="shared\/js\/student-context\.js[^>]*><\/script>/g,'')
    .replace('</body>','<script src="../../labs-host/bridge.js"></script></body>');
  await fs.writeFile(path.join(destination,'codevis','index.html'),code,'utf8');
  await fs.copyFile(path.join(source,'qianduan','public','resource-explorer.css'),path.join(destination,'resource-explorer.css'));
  await fs.copyFile(path.join(source,'LICENSE.md'),path.join(destination,'LICENSE.md'));
  await fs.mkdir(path.dirname(catalogue),{recursive:true});
  await fs.writeFile(catalogue,JSON.stringify(snapshot,null,2)+'\n','utf8');
  const summary={...snapshot.source,activities:snapshot.spaces.reduce((sum,space)=>sum+space.topics.reduce((s,topic)=>s+topic.activities.length,0),0),spaces:snapshot.spaces.map(space=>({key:space.key,groups:space.topics.length,activities:space.topics.reduce((sum,topic)=>sum+topic.activities.length,0)})),files,bytes};
  await fs.writeFile(path.join(destination,'import-manifest.json'),JSON.stringify(summary,null,2)+'\n','utf8');
  return summary;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=process.argv[2];if(!source)throw new Error('请提供工科实验室源码目录。');
  console.log(JSON.stringify(await importLabs(source),null,2));
}

import {execFileSync} from 'node:child_process';
import {copyFile,lstat,mkdir,readFile,unlink,writeFile} from 'node:fs/promises';
import {dirname,resolve,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const destination=resolve(root,'.local/public-github-source');
const receipt=resolve(destination,'.public-source-receipt.json');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const eligibleNew=/^(?:apps\/|packages\/|scripts\/|e2e\/|doc\/|deploy\/|\.github\/|前端设计\/|\.dockerignore$)/u;
const prohibited=/(?:^|\/)(?:\.git|\.local|\.local-secrets|node_modules|dist|\.data[^/]*)(?:\/|$)|(?:^|\/)\.env(?:$|\.(?!example$))/u;
const files=[...new Set([...tracked,...untracked.filter(file=>eligibleNew.test(file))])].filter(file=>!prohibited.test(file));
await mkdir(destination,{recursive:true});
const inside=(base,file)=>{const target=resolve(base,file);const part=relative(base,target);if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw new Error('Invalid export path');return target;};
let previous=[];
try{previous=JSON.parse(await readFile(receipt,'utf8')).files;}catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of previous)if(!files.includes(file))await unlink(inside(destination,file)).catch(error=>{if(error.code!=='ENOENT')throw error;});
let bytes=0;
for(const file of files){
  const source=inside(root,file),target=inside(destination,file),info=await lstat(source);
  if(!info.isFile())throw new Error('Only ordinary files can be published: '+file);
  await mkdir(dirname(target),{recursive:true});await copyFile(source,target);bytes+=info.size;
}
await writeFile(receipt,JSON.stringify({files},null,2));
console.log(JSON.stringify({destination,files:files.length,bytes,historyIncluded:false}));

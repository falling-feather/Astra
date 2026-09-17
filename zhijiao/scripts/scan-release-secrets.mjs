import {readFile,lstat} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectRoot} from './lib/release-process.mjs';

// Scan publishable tracked and unignored source. Private runtime directories are
// excluded by Git, while an accidentally tracked credential file still fails.
const files=process.env.RONGGANG_EXPORTED_SOURCE==='1'
  ? JSON.parse(await readFile(resolve(projectRoot,'.release-source-files.json'),'utf8'))
  : execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:projectRoot}).toString('utf8').split('\0').filter(Boolean);
if(!Array.isArray(files)||files.some(file=>typeof file!=='string'||file.startsWith('/')||file.includes('..')||file.includes(':')))throw new Error('发布源文件清单无效');
const extensions=new Set(['.json','.cjs','.css','.cts','.html','.ini','.js','.jsx','.md','.mjs','.mts','.properties','.svg','.toml','.ts','.tsx','.txt','.xml','.yaml','.yml','.ps1']);
const findings=[];
for(const file of new Set(files)){
  if(/(^|\/)\.env(?:$|\.(?!example$))/.test(file)){findings.push(file+' (tracked environment file)');continue;}
  if(!extensions.has(extname(file))&&!['.gitignore','.node-version','.nvmrc','.env.example'].includes(file))continue;
  const path=resolve(projectRoot,file);
  let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(!info.isFile())continue;
  const text=await readFile(path,'utf8');
  if(/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}/u.test(text)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)||/(?:DEEPSEEK|IFLYTEK)_[A-Z_]*(?:KEY|SECRET|TOKEN)[ \t]*=[ \t]*[^\s#=]{8,}/u.test(text))findings.push(file);
}
if(findings.length)throw new Error('发布源发现疑似真实密钥：'+findings.join(', '));
console.log('release secret scan ok: '+files.length+' source paths; no credential-shaped values');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {LAB_SPACES} from '../src/observatory/lab-catalog.js';

const labs=new URL('../public/labs/',import.meta.url);
const html=fs.readFileSync(new URL('index.html',labs),'utf8');
test('127项活动的本地入口文件全部存在，90项学科实验有对应界面与脚本',()=>{
  for(const space of LAB_SPACES)for(const topic of space.topics)for(const activity of topic.activities){
    const url=new URL(activity.href,'https://local.test/');
    let filename=url.pathname.slice('/labs/'.length);if(filename.endsWith('/'))filename+='index.html';
    assert.ok(fs.existsSync(new URL(filename,labs)),activity.key);
    if(space.key==='englab')assert.ok(html.includes(`data-module="${activity.key.split('.')[1]}"`),activity.key+' 缺少实验界面');
  }
  const context=vm.createContext({console});context.window=context;
  vm.runInContext(fs.readFileSync(new URL('shared/js/experiment-registry.js',labs),'utf8'),context);
  for(const entry of context.AstraExperimentRegistry.entries()){
    assert.ok(fs.existsSync(new URL(entry.script.split('?')[0],labs)),entry.id+' 缺少运行脚本');
  }
});
test('公开副本保留来源与许可证，排除后端和角色管理页面',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('import-manifest.json',labs),'utf8'));
  assert.equal(manifest.activities,127);assert.match(manifest.commit,/^[a-f0-9]{40}$/);
  assert.ok(fs.existsSync(new URL('LICENSE.md',labs)));
  for(const directory of ['backend','server','qianduan','node_modules','pages/admin','pages/teacher','pages/student']){
    assert.equal(fs.existsSync(new URL(directory,labs)),false,directory);
  }
  assert.ok(html.includes('name="astra-resource-explorer"'));
  assert.equal(/<script[^>]+src="shared\/js\/(?:auth-ui|app-session)\.js/.test(html),false);
});

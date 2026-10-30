import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {resolveExperimentRoute} from '../src/observatory/lab-catalog.js';

test('开发服务把课程的真实 iframe 地址交给代码空间，而不是镜湖首页',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const server=await createServer({root,logLevel:'silent',server:{host:'127.0.0.1',port:0,hmr:false,open:false}});
  try {
    await server.listen();
    const origin='http://127.0.0.1:'+server.httpServer.address().port+'/';
    const {iframeUrl}=resolveExperimentRoute('?activity=program-start.variable-box',origin);
    const response=await fetch(iframeUrl,{headers:{Accept:'text/html'}});
    assert.equal(response.status,200);
    const html=await response.text();
    assert.ok(html.includes('id="cv-page-challenge"')&&html.includes('id="cv-page-trace"'),'公开课程入口未加载代码空间');
    assert.ok(html.includes('../../labs-host/bridge.js'),'代码空间缺少返回观星页的桥接');
    assert.ok(!html.includes('id="enter-gateway"'),'实验 iframe 错误回到了开篇');
  } finally {await server.close();}
});

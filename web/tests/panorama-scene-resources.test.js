import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture, BufferGeometry, ShaderMaterial } from 'three';
import { loadPanoramaTextures, loadPanoramaSceneAssets, createPanoramaResourceScope } from '../src/observatory/panorama-scene-resources.js';
import { PANORAMA_DUST_LAYER } from '../src/observatory/panorama-scene-data.js';

test('部分星云加载失败时释放所有成功纹理，错误指出失败星系',async()=>{
  const first=new Texture(),third=new Texture();let disposed=0;
  first.addEventListener('dispose',()=>disposed++);third.addEventListener('dispose',()=>disposed++);
  const loader={loadAsync:async path=>{if(path==='engineering.png')return first;if(path==='ai.png')return third;throw new Error('asset missing');}};
  await assert.rejects(()=>loadPanoramaTextures(loader,[{id:'engineering',asset:'engineering.png'},{id:'code',asset:'code.png'},{id:'ai',asset:'ai.png'}]),/code/);
  assert.equal(disposed,2);
});

test('共享几何与材质只释放一次，重复关闭渲染器安全',()=>{
  const scope=createPanoramaResourceScope(),geometry=new BufferGeometry(),material=new ShaderMaterial();
  let geometryDisposals=0,materialDisposals=0;
  geometry.addEventListener('dispose',()=>geometryDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  scope.own(geometry);scope.own(geometry);scope.own(material);scope.dispose();scope.dispose();
  assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);assert.equal(scope.disposed,true);
});

test('异步结束时渲染器已经关闭，新到纹理立即释放而非泄漏',()=>{
  const scope=createPanoramaResourceScope(),texture=new Texture();let disposed=false;
  texture.addEventListener('dispose',()=>{disposed=true;});scope.dispose();
  assert.throws(()=>scope.own(texture),/关闭/);assert.equal(disposed,true);
});

test('原银河远景独立载入，课程纹理计数仍是四个并一起释放',async()=>{
  const catalog=Array.from({length:4},(_,index)=>({id:`course-${index}`,asset:`course-${index}.png`}));
  const created=[];let disposed=0;
  const loader={loadAsync:async asset=>{const texture=new Texture();texture.name=asset;texture.addEventListener('dispose',()=>disposed++);created.push(texture);return texture;}};
  const assets=await loadPanoramaSceneAssets(loader,catalog);
  assert.equal(assets.textures.length,4);assert.equal(assets.backgroundTexture?.name,PANORAMA_DUST_LAYER.asset);
  assert.equal(created.length,5);
  const scope=createPanoramaResourceScope();assets.textures.forEach(texture=>scope.own(texture));scope.own(assets.backgroundTexture);scope.dispose();
  assert.equal(disposed,5);
});

test('原银河加载失败也释放四个已完成的课程纹理',async()=>{
  const catalog=Array.from({length:4},(_,index)=>({id:`course-${index}`,asset:`course-${index}.png`}));let disposed=0;
  const loader={loadAsync:async asset=>{if(asset===PANORAMA_DUST_LAYER.asset)throw new Error('missing background');const texture=new Texture();texture.addEventListener('dispose',()=>disposed++);return texture;}};
  await assert.rejects(()=>loadPanoramaSceneAssets(loader,catalog),/milky-way-background/);assert.equal(disposed,4);
});

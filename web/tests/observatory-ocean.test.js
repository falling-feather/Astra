import test from 'node:test';
import assert from 'node:assert/strict';
import { oceanSurface,oceanCrestAt,createSpraySeeds,oceanSprayAt } from '../src/observatory/ocean-motion.js';

const water={width:1672,height:941,waterline:525/941};

test('海面动态保持地平线与图层四边固定，不在裁切边缘露出空缝',()=>{
  for(const time of [0,.8,3.4,8.9,17]){
    for(const u of [0,.15,.5,.88,1]){
      for(const v of [0,water.waterline,1]){
        const sample=oceanSurface(u,v,time,water);
        assert.equal(sample.dx,0);assert.equal(sample.dy,0);
      }
    }
    for(const u of [0,1])for(const v of [.6,.75,.93]){const sample=oceanSurface(u,v,time,water);assert.equal(sample.dx,0);assert.equal(sample.dy,0);}
  }
});

test('近海起伏显著强于远海且随时间变化，网格不翻折',()=>{
  const near=[],far=[];
  for(let time=0;time<6;time+=.2){near.push(oceanSurface(.44,.91,time,water).dy);far.push(oceanSurface(.44,.59,time,water).dy);}
  const spread=values=>Math.max(...values)-Math.min(...values);
  assert.ok(spread(near)>13,'近处应有可见的浪峰起伏');
  assert.ok(spread(near)>spread(far)*5,'不能整块海面等幅摆动');
  for(const u of [.1,.34,.64,.9])for(const time of [0,1.2,3.6,7.8]){
    let previous=water.waterline*water.height;
    for(let v=water.waterline+.002;v<1;v+=.004){
      const sample=oceanSurface(u,v,time,water),y=v*water.height+sample.dy;
      assert.ok(y>previous,'相邻网格行不能穿越翻折');previous=y;
    }
  }
});

test('浪峰持续朝近处推进，泡沫带依附真实变形后的海面',()=>{
  const first=oceanCrestAt(.45,2,.9,water),later=oceanCrestAt(.45,2,1.7,water);
  assert.ok(first.visible&&later.visible);
  assert.ok(later.y-first.y>20);
  const surface=oceanSurface(.45,later.v,1.7,water);
  assert.ok(Math.abs(later.y-(later.v*water.height+surface.dy))<1e-8);
});

test('破碎浪花具有有限生命周期，起跳后下落并完全消失',()=>{
  const seed={u:.45,band:2,delay:0,period:3,life:1,drift:20,lift:65,size:2};
  const born=oceanSprayAt(seed,0,water),rising=oceanSprayAt(seed,.2,water),falling=oceanSprayAt(seed,.75,water),dead=oceanSprayAt(seed,1.2,water);
  assert.equal(born.alpha,0);
  assert.ok(rising.y<born.y);
  assert.ok(falling.y>rising.y);
  assert.equal(dead.alpha,0);
  assert.ok(falling.x>rising.x);
  const seeds=createSpraySeeds(180);
  assert.equal(seeds.length,180);
  const active=seeds.map(item=>oceanSprayAt(item,4.2,water)).filter(item=>item.alpha>.01);
  assert.ok(active.length>5&&active.length<100,'浪花应是稀疏破碎粒子，不是整面白雾');
});

test('实际可见中景有8像素以上浪高，2.2秒内浪峰与破碎泡沫明显变化',()=>{
  const samples=Array.from({length:161},(_,index)=>{const time=index*.05;return {time,...oceanSurface(.495,.704,time,water)};});
  const peak=Math.max(...samples.map(sample=>Math.abs(sample.dy)));
  assert.ok(peak>=8&&peak<=14,'标注的中景不能只起伏1至3像素，也不能过度拉伸');
  assert.ok(samples.some(sample=>Math.abs(sample.dy-oceanSurface(.495,.704,sample.time+2.2,water).dy)>=12),'2.2秒应能看清中景浪高变化');
  const crests=[];
  for(let time=0;time<8;time+=.1)for(let band=0;band<6;band++){
    const crest=oceanCrestAt(.495,band,time,water);if(crest.visible&&crest.depth>.25&&crest.depth<.4)crests.push(crest);
  }
  assert.ok(crests.some(crest=>crest.foam>.45),'中景浪尖不能被多次深度衰减到近乎不可见');
});

test('强化后实际细分网格三角形保持正面积，不露背面剔除洞',()=>{
  const columns=112,rows=56;
  const area=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let time=0;time<8;time+=.4){
    const points=Array.from({length:(columns+1)*(rows+1)},(_,index)=>{
      const u=(index%(columns+1))/columns,v=Math.floor(index/(columns+1))/rows,sample=oceanSurface(u,v,time,water);
      return {x:u*water.width+sample.dx,y:v*water.height+sample.dy};
    });
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const a=points[row*(columns+1)+column],b=points[row*(columns+1)+column+1],c=points[(row+1)*(columns+1)+column],d=points[(row+1)*(columns+1)+column+1];
      assert.ok(area(a,b,c)>0&&area(b,d,c)>0,'海面三角形不得翻面');
    }
  }
});

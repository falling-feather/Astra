import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChildFigure } from '../src/character.js';
import { MirrorLake } from '../src/scene.js';
import { MirrorWater } from '../src/water.js';
import { CelestialSky } from '../src/sky.js';
import { LightRibbons } from '../src/light-ribbons.js';
import { ART, artPoint } from '../src/character-art.js';
import { VIEW } from '../src/motion.js';

test('the figure stands neutrally with both soles on the water',()=>{
  const child=new ChildFigure();
  try{
    child.root.updateMatrixWorld(true);
    for(const side of ['left','right']){
      const shoe=child.limbs[side].shoe;
      assert.deepEqual(shoe.position.toArray(),Object.values(artPoint(ART[side].ankle)));
      assert.deepEqual(shoe.quaternion.toArray(),[0,0,0,1]);
      const sole=new THREE.Vector3(0,(ART[side].ankle[1]-ART.ground)*ART.scale,0).applyMatrix4(shoe.matrixWorld);
      assert.ok(Math.abs(sole.y)<1e-8);
    }
  }finally{child.dispose();}
});

test('scene time advances sky and water without moving the figure, camera, or scenery',()=>{
  const child=new ChildFigure(),water=new MirrorWater(),sky=new CelestialSky(),ribbons=new LightRibbons();
  const camera=new THREE.PerspectiveCamera(VIEW.fov,1,.05,450);camera.position.set(0,VIEW.height,VIEW.z);
  const scene={child,water,sky,ribbons,camera,renderer:{info:{reset(){}}},composer:{render(){}},renderCount:0};
  const transforms=()=>{child.root.updateMatrixWorld(true);return child.parts.map(part=>part.matrixWorld.toArray());};
  try{
    const before=transforms(),cameraBefore=camera.position.toArray();
    MirrorLake.prototype.render.call(scene,2,[.4,.3,.3]);
    MirrorLake.prototype.render.call(scene,9,[.4,.3,.3]);
    assert.deepEqual(transforms(),before);
    assert.deepEqual(camera.position.toArray(),cameraBefore);
    assert.equal(sky.root.position.z,0);assert.equal(ribbons.root.position.z,0);assert.equal(water.mesh.position.z,0);
    assert.equal(sky.stars.material.uniforms.uTime.value,9);
    assert.equal(ribbons.curtains[0].material.uniforms.uTime.value,9);
    assert.equal(water.mesh.material.uniforms.uTime.value,9);
  }finally{child.dispose();water.dispose();sky.dispose();ribbons.dispose();}
});

test('ripples repeat at both fixed feet and are not duplicated by paused redraws',()=>{
  const water=new MirrorWater();
  try{
    water.update(0);water.update(2.8);water.update(5.6);
    assert.equal(water.count,6);
    const events=water.events.filter(event=>event.w>0);
    assert.equal(events.length,6);
    const centres=new Set(events.map(event=>`${event.x},${event.y}`));
    assert.equal(centres.size,2);
    for(const birth of [0,2.8,5.6])assert.equal(events.filter(event=>event.z===birth).length,2);
    water.update(5.6);assert.equal(water.count,6);
  }finally{water.dispose();}
});

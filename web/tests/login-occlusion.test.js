import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoreOcclusion, sphereOcclusionGLSL } from '../src/login/occlusion.js';

// Execute the production scalar GLSL predicate, rather than maintaining a second math implementation.
const [, argumentsSource, body] = sphereOcclusionGLSL.match(/bool astraSphereBlocks\(([^)]+)\)\s*\{([\s\S]*)\}/);
const argumentNames = argumentsSource.replace(/\bfloat\s+/g, '').split(',').map(name => name.trim());
const blocks = new Function('sqrt', ...argumentNames, body.replace(/\bfloat\s+(\w+)\s*=/g, 'const $1 =')).bind(null, Math.sqrt);

function fixture(camera, center = new THREE.Vector3(), radius = 1) {
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius));
  shell.position.copy(center);
  const occlusion = new CoreOcclusion(shell);
  occlusion.update(camera);
  const uniforms = occlusion.uniforms;
  return point => {
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    const delta = view.clone().sub(uniforms.uAstraCoreCenter.value);
    const direction = uniforms.uAstraOrthographic.value ? new THREE.Vector3(0, 0, 1) : view.clone().negate().normalize();
    const limit = uniforms.uAstraOrthographic.value ? -view.z : view.length();
    return blocks(delta.x, delta.y, delta.z, direction.x, direction.y, direction.z, limit, uniforms.uAstraCoreRadius.value);
  };
}

test('front ring fragments survive, back fragments are removed, and off-silhouette fragments remain', () => {
  assert.equal(blocks(0, 0, 3, 0, 0, 1, 12, 1), false);
  assert.equal(blocks(0, 0, -3, 0, 0, 1, 18, 1), true);
  assert.equal(blocks(1.1, 0, -3, 0, 0, 1, 18, 1), false);
  assert.equal(blocks(0, 0, 0, 0, 0, 1, 15, 1), true);
});

test('tangency and the near surface do not flicker, while just inside the limb is occluded', () => {
  assert.equal(blocks(1, 0, -3, 0, 0, 1, 18, 1), false);
  assert.equal(blocks(1.0001, 0, -3, 0, 0, 1, 18, 1), false);
  assert.equal(blocks(.9999, 0, -3, 0, 0, 1, 18, 1), true);
  assert.equal(blocks(0, 0, 1, 0, 0, 1, 14, 1), false);
  assert.equal(blocks(0, 0, 1.0001, 0, 0, 1, 14, 1), false);
});

test('occlusion is per fragment: a satellite crossing the silhouette is only partly hidden', () => {
  assert.equal(blocks(1.6, 0, -2, 0, 0, 1, 17, 1.72), true);
  assert.equal(blocks(1.85, 0, -2, 0, 0, 1, 17, 1.72), false);
});

for (const projection of ['orthographic', 'perspective']) {
  test(`${projection} camera rotations retain the same front/back relationship`, () => {
    const center = new THREE.Vector3(.4, -.3, .2);
    for (const position of [[0, 0, 9], [6, 4, 9], [-8, 3, 1]]) {
      const camera = projection === 'orthographic'
        ? new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 50)
        : new THREE.PerspectiveCamera(45, 1.5, .1, 50);
      camera.position.set(...position); camera.lookAt(center); camera.updateProjectionMatrix();
      const occluded = fixture(camera, center);
      const towardCamera = camera.position.clone().sub(center).normalize();
      assert.equal(occluded(center.clone().addScaledVector(towardCamera, 3)), false);
      assert.equal(occluded(center.clone().addScaledVector(towardCamera, -3)), true);
    }
  });
}

test('a sphere beyond the camera cannot hide geometry in front of the camera', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.5, .1, 50);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0);
  assert.equal(fixture(camera, new THREE.Vector3(0, 0, 8))(new THREE.Vector3(0, 0, 0)), false);
});

test('off-axis perspective rays converge through the core while parallel orthographic rays miss', () => {
  const perspective = new THREE.PerspectiveCamera(45, 1.5, .1, 50);
  const orthographic = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 50);
  for (const camera of [perspective, orthographic]) { camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); }
  const farPoint = new THREE.Vector3(1.5, 0, -10);
  assert.equal(fixture(perspective)(farPoint), true);
  assert.equal(fixture(orthographic)(farPoint), false);
});

test('a rotating orbit changes occlusion at the sphere, rather than hiding an entire ring', () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 50);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  const occluded = fixture(camera);
  const point = new THREE.Vector3(0, 0, 3);
  assert.equal(occluded(point), false);
  assert.equal(occluded(point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)), true);
  assert.equal(occluded(point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)), false);
});

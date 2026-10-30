import * as THREE from 'three';
import { NebulaCore } from './nebula.js';
import { ringAssembly, crystal, satellite, torus, metal } from './instrument.js';
import { CoreOcclusion } from './occlusion.js';

export class Orrery {
  constructor() {
    this.root = new THREE.Group();
    this.instruments = new THREE.Group();
    this.root.add(this.instruments);
    this.rings = [
      ringAssembly({ radius: 2.64, width: .043, color: 0xa3aebc, angle: -.14, tilt: 1.23, silver: true, subtle: true }),
      ringAssembly({ radius: 2.83, width: .14, color: 0xb9c7d5, angle: 1.91, tilt: -1.12, silver: true }),
      ringAssembly({ radius: 3.08, width: .27, color: 0xf3e6cf, angle: .77, tilt: 1.08 }),
    ];
    this.rings.forEach(ring => this.instruments.add(ring.root));
    this.core = new NebulaCore();
    this.root.add(this.core.root);
    this.movers = [];
    this.lightOrbit = new THREE.Group();
    this.lightOrbit.rotation.set(1.02, -.08, -.13);
    this.instruments.add(this.lightOrbit);
    this.lightOrbit.add(torus(3.36, .0027, new THREE.MeshBasicMaterial({ color: 0x71a9cf, toneMapped: false })));
    this.addMover(satellite(.097, true), this.lightOrbit, 3.36, 2.75, .085);
    this.addMover(satellite(.091), this.lightOrbit, 3.36, .10, .085);
    this.addMover(satellite(.071), this.lightOrbit, 3.36, 4.75, .085);
    this.addMover(crystal(true), this.rings[1].plane, 2.83, .18, .035);
    this.addMover(crystal(false), this.rings[0].plane, 2.64, 5.96, -.055);
    this.addMover(satellite(.056, true), this.rings[2].plane, 3.08, 1.65, -.022);
    this.addMover(satellite(.051, true), this.rings[2].plane, 3.08, 4.78, -.022);
    this.addMover(satellite(.084, true), this.rings[0].plane, 2.64, 2.03, -.032);

    const bearing = new THREE.Group();
    bearing.add(torus(.175, .012, metal(0xd0b693)), torus(.143, .004, metal(0xe6d4b9)), torus(.105, .0025, metal(0xb79b76)));
    const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(.005, .273, .007), metal(0xc6aa81), 4);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 4; i++) { transform.rotation.z = i * Math.PI / 4; transform.updateMatrix(); spokes.setMatrixAt(i, transform.matrix); }
    bearing.add(spokes);
    const hubGeometry = new THREE.CylinderGeometry(.034, .039, .017, 32);
    hubGeometry.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeometry, metal(0x9c8260, .29));
    hub.position.z = .011;
    bearing.add(hub);
    const screwGeometry = new THREE.CylinderGeometry(.0075, .0085, .008, 12);
    screwGeometry.rotateX(Math.PI / 2);
    const screws = new THREE.InstancedMesh(screwGeometry, metal(0x766249, .31), 6);
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      transform.position.set(Math.cos(angle) * .158, Math.sin(angle) * .158, .011);
      transform.rotation.z = 0;
      transform.updateMatrix();
      screws.setMatrixAt(i, transform.matrix);
    }
    bearing.add(screws);
    bearing.position.set(Math.cos(5.28) * 3.08, Math.sin(5.28) * 3.08, .052);
    this.rings[2].plane.add(bearing);

    const points = [];
    for (let i = 0; i <= 240; i++) {
      const t = .13 + i / 240 * 3.6;
      points.push(new THREE.Vector3(2.7 + 5.9 * Math.cos(t), .17 + 3.24 * Math.sin(t), -2.4));
    }
    this.longArc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x97b7d0, transparent: true, opacity: .24 }));
    this.instruments.add(this.longArc);
    this.occlusion = new CoreOcclusion(this.core.shell);
    this.occlusion.attach(this.instruments);
  }

  addMover(object, orbit, radius, phase, speed) {
    orbit.add(object);
    this.movers.push({ object, radius, phase, speed });
  }

  async load() {
    await this.core.load();
    this.metalTexture = await new THREE.TextureLoader().loadAsync('./assets/login/brushed-champagne.png');
    this.metalTexture.colorSpace = THREE.SRGBColorSpace;
    this.metalTexture.wrapS = THREE.RepeatWrapping;
    this.metalTexture.repeat.set(5, 1);
    this.metalTexture.anisotropy = 8;
    const gold = this.rings[2].material;
    gold.map = this.metalTexture;
    gold.bumpMap = this.metalTexture;
    gold.bumpScale = .0007;
    gold.needsUpdate = true;
    this.update(0);
  }

  resize(ratio, mobile) { this.core.resize(ratio, mobile); }

  update(time) {
    this.core.update(time);
    this.rings.forEach((ring, index) => {
      ring.root.rotation.z = ring.angle + Math.sin(time * .045 + index) * .035;
      ring.plane.rotation.x = ring.tilt + Math.sin(time * .04 + index * 2) * .05;
      ring.plane.rotation.z = time * (index === 2 ? .013 : -.01);
    });
    this.movers.forEach(({ object, radius, phase, speed }) => {
      const theta = phase + time * speed;
      object.position.set(Math.cos(theta) * radius, Math.sin(theta) * radius, .03);
      object.rotation.set(time * .085, time * .12, theta * .15);
    });
  }

  disposeTextures() { this.core.disposeTextures(); this.metalTexture?.dispose(); }
}

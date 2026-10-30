import * as THREE from 'three';

const TAU = Math.PI * 2;

export function metal(color, roughness = .24) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: .88, roughness, clearcoat: .28, clearcoatRoughness: .16, envMapIntensity: 1.65 });
}

export function torus(radius, thickness, material) {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 10, 288), material);
}

function bandGeometry(radius, width, depth) {
  const segments = 384, profile = 24;
  const positions = [], normals = [], uv = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * TAU;
    const halfWidth = width * .5 * (1 + Math.cos(angle * 2) * .065);
    const halfDepth = depth * .5 * (1 + Math.sin(angle * 2) * .08);
    for (let j = 0; j <= profile; j++) {
      const across = j / profile * TAU;
      const r = radius + Math.cos(across) * halfWidth;
      positions.push(Math.cos(angle) * r, Math.sin(angle) * r, Math.sin(across) * halfDepth);
      const normal = new THREE.Vector3(Math.cos(angle) * Math.cos(across) / halfWidth, Math.sin(angle) * Math.cos(across) / halfWidth, Math.sin(across) / halfDepth).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uv.push(i / segments, j / profile);
      if (i < segments && j < profile) {
        const current = i * (profile + 1) + j;
        const next = current + profile + 1;
        indices.push(current, next, current + 1, next, next + 1, current + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

function machinedMaterial(color, silver, subtle) {
  const material = metal(color, silver ? .31 : .33);
  material.anisotropy = .42;
  material.clearcoat = .11;
  material.clearcoatRoughness = .24;
  material.envMapIntensity = silver ? 1.03 : 1.3;
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec2 vBandUv;\n${shader.vertexShader}`.replace('#include <uv_vertex>', '#include <uv_vertex>\nvBandUv=uv;');
    shader.fragmentShader = `varying vec2 vBandUv;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `
      #include <color_fragment>
      float radiusAcross=.5+.5*cos(vBandUv.y*6.2831853);
      float gradeCoordinate=vBandUv.x*24.;
      float gradePosition=fract(gradeCoordinate)-.5;
      float gradeAA=max(fwidth(gradeCoordinate)*.55,.004);
      float face=smoothstep(.23,.48,abs(sin(vBandUv.y*6.2831853)));
      float majorStroke=1.-smoothstep(.006,.006+gradeAA,abs(gradePosition));
      float majorSpan=smoothstep(.24,.27,radiusAcross)*(1.-smoothstep(.73,.76,radiusAcross));
      float middleStroke=1.-smoothstep(.004,.004+gradeAA,abs(abs(gradePosition)-.15));
      float middleSpan=smoothstep(.39,.42,radiusAcross)*(1.-smoothstep(.69,.72,radiusAcross));
      float shortStroke=1.-smoothstep(.003,.003+gradeAA,abs(abs(gradePosition)-.29));
      float shortSpan=smoothstep(.49,.51,radiusAcross)*(1.-smoothstep(.66,.69,radiusAcross));
      float ticks=(majorStroke*majorSpan*.78+middleStroke*middleSpan*.6+shortStroke*shortSpan*.43)*face;
      vec2 calibrationPosition=vec2((gradePosition+.36)*${silver ? '4.8' : '2.8'},radiusAcross-.37);
      float symbolAA=max(fwidth(calibrationPosition.x),fwidth(calibrationPosition.y))*.55;
      float calibrationCircle=1.-smoothstep(.012,.012+symbolAA,abs(length(calibrationPosition)-.073));
      float horizontalStroke=(1.-smoothstep(.01,.01+symbolAA,abs(calibrationPosition.y)))*(1.-smoothstep(.105,.115,abs(calibrationPosition.x)));
      float verticalStroke=(1.-smoothstep(.01,.01+symbolAA,abs(calibrationPosition.x)))*(1.-smoothstep(.105,.115,abs(calibrationPosition.y)));
      float calibrationSector=1.-step(.5,mod(floor(gradeCoordinate),4.));
      float calibration=max(calibrationCircle,max(horizontalStroke,verticalStroke)*.7)*calibrationSector*face;
      float groove=(1.-smoothstep(.003,.009,abs(radiusAcross-.19)))*face;
      float engraving=clamp(ticks+calibration*.7+groove*.16,0.,.85);
      diffuseColor.rgb*=1.-engraving*${subtle ? '.35' : '.86'};
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=min(.9,roughnessFactor+engraving*.2);');
  };
  material.customProgramCacheKey = () => `machined-ring-scale24-${silver}-${subtle}`;
  return material;
}

/** Fine angular graduations are recessed shading on one continuous machined surface. */
export function ringAssembly({ radius, width, color, angle, tilt, silver = false, subtle = false }) {
  const root = new THREE.Group();
  root.rotation.z = angle;
  const plane = new THREE.Group();
  plane.rotation.x = tilt;
  root.add(plane);
  const material = machinedMaterial(color, silver, subtle);
  plane.add(new THREE.Mesh(bandGeometry(radius, width, subtle ? .025 : .06), material));
  const railMaterial = metal(subtle ? 0x8c9bad : silver ? 0xc1cedc : 0xe3c89e, .2);
  railMaterial.envMapIntensity = 1.28;
  const thickness = subtle ? .003 : .008;
  plane.add(torus(radius - width * .49, thickness, railMaterial), torus(radius + width * .49, thickness, railMaterial));
  return { root, plane, material, angle, tilt, radius, silver };
}

export function crystal(gold) {
  const group = new THREE.Group();
  const sections = [
    { radius: .115, height: .31, rotation: Math.PI / 8 },
    { radius: .255, height: .045, rotation: 0 },
    { radius: .255, height: .008, rotation: 0 },
    { radius: .102, height: -.24, rotation: Math.PI / 8 },
  ];
  const vertices = [], indices = [];
  for (const section of sections) {
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * TAU + section.rotation;
      vertices.push(Math.cos(angle) * section.radius, section.height, Math.sin(angle) * section.radius);
    }
  }
  vertices.push(0, .31, 0, 0, -.40, 0);
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    indices.push(32, next, i, 33, 24 + i, 24 + next);
    for (let row = 0; row < sections.length - 1; row++) {
      const top = row * 8, bottom = top + 8;
      indices.push(top + i, top + next, bottom + next, top + i, bottom + next, bottom + i);
    }
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose(); geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    color: gold ? 0xffedcc : 0xc4edff, metalness: 0, roughness: .028,
    transmission: 1, thickness: .56, ior: 1.5, dispersion: .055,
    attenuationColor: gold ? new THREE.Color(0xdab780) : new THREE.Color(0x7aadd1), attenuationDistance: .75,
    transparent: true, opacity: .7, depthWrite: false, envMapIntensity: .6, clearcoat: .12, specularIntensity: .6,
  });
  group.add(new THREE.Mesh(geometry, material));
  const core = new THREE.Mesh(new THREE.SphereGeometry(.11, 20, 16), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(gold ? 0xffd591 : 0x73cfff) } },
    vertexShader: `varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec3 vNormal;varying vec3 vView;uniform vec3 uColor;void main(){float a=pow(max(dot(normalize(vNormal),normalize(vView)),0.),3.5);gl_FragColor=vec4(uColor,a*.21);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(core);
  return group;
}

export function satellite(radius, gold = false) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), metal(gold ? 0xb9a184 : 0x9bb0c6, .23)));
  const seam = torus(radius * 1.006, .0024, metal(gold ? 0xe5cbaa : 0xbdcfe2, .18));
  seam.rotation.x = .8;
  group.add(seam);
  return group;
}

import * as THREE from 'three';

// Scalar form makes the very same GPU predicate executable in boundary regression tests.
export const sphereOcclusionGLSL = `
bool astraSphereBlocks(float ox, float oy, float oz, float dx, float dy, float dz, float rayLimit, float radius) {
  float projection=ox*dx+oy*dy+oz*dz;
  float discriminant=projection*projection-(ox*ox+oy*oy+oz*oz-radius*radius);
  if(discriminant<=0.0)return false;
  float halfChord=sqrt(discriminant);
  float nearHit=-projection-halfChord;
  float farHit=-projection+halfChord;
  return farHit>0.0001 && nearHit<rayLimit-0.0001;
}`;

const vertexDeclarations = `
uniform mat4 uAstraInverseProjection;
varying vec3 vAstraInstrumentView;
`;
const fragmentDeclarations = `
varying vec3 vAstraInstrumentView;
uniform vec3 uAstraCoreCenter;
uniform float uAstraCoreRadius;
uniform bool uAstraOrthographic;
${sphereOcclusionGLSL}
`;
const fragmentTest = `
  vec3 astraOffset=vAstraInstrumentView-uAstraCoreCenter;
  vec3 astraDirection=uAstraOrthographic?vec3(0.0,0.0,1.0):normalize(-vAstraInstrumentView);
  float astraRayLimit=uAstraOrthographic?-vAstraInstrumentView.z:length(vAstraInstrumentView);
  if(astraSphereBlocks(astraOffset.x,astraOffset.y,astraOffset.z,astraDirection.x,astraDirection.y,astraDirection.z,astraRayLimit,uAstraCoreRadius))discard;
`;

/** Masks only instruments hidden by the core; no depth mask is applied to the internal cloud passes. */
export class CoreOcclusion {
  constructor(shell) {
    this.shell = shell;
    this.materials = new Set();
    this.scale = new THREE.Vector3();
    this.uniforms = {
      uAstraInverseProjection: { value: new THREE.Matrix4() },
      uAstraCoreCenter: { value: new THREE.Vector3() },
      uAstraCoreRadius: { value: shell.geometry.parameters.radius },
      uAstraOrthographic: { value: true },
    };
  }

  attach(instruments) {
    instruments.traverse(object => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (this.materials.has(material)) continue;
        this.materials.add(material);
        const originalCompile = material.onBeforeCompile.bind(material);
        const originalKey = material.customProgramCacheKey.bind(material);
        material.onBeforeCompile = shader => {
          originalCompile(shader);
          Object.assign(shader.uniforms, this.uniforms);
          shader.vertexShader = vertexDeclarations + shader.vertexShader.replace(/}\s*$/, `
            vec4 astraViewCoordinate=uAstraInverseProjection*gl_Position;
            vAstraInstrumentView=astraViewCoordinate.xyz/astraViewCoordinate.w;
          }`);
          shader.fragmentShader = fragmentDeclarations + shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, match => match + fragmentTest);
        };
        material.customProgramCacheKey = () => `${originalKey()}|astra-core-occlusion`;
        material.needsUpdate = true;
      }
    });
  }

  update(camera) {
    camera.updateMatrixWorld();
    this.shell.updateWorldMatrix(true, false);
    this.shell.getWorldPosition(this.uniforms.uAstraCoreCenter.value).applyMatrix4(camera.matrixWorldInverse);
    this.shell.getWorldScale(this.scale);
    this.uniforms.uAstraCoreRadius.value = this.shell.geometry.parameters.radius * this.scale.x;
    this.uniforms.uAstraInverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uAstraOrthographic.value = Boolean(camera.isOrthographicCamera);
  }
}

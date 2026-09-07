import * as THREE from 'three';
import { randomGenerator } from './galaxy-model';
import { screenVertex } from './shaders';
import { volumeFragment, volumeVertex } from './volume-shaders';
import { orbitVolumeFragment } from './orbit-shaders';

/** A numerical 64³ noise lattice, generated from a seed. It contains no image artwork. */
export function createNoiseVolume():THREE.Data3DTexture {
  const size=64,random=randomGenerator(935782),data=new Uint8Array(size**3);
  for(let i=0;i<data.length;i++)data[i]=Math.floor(random()*256);
  const texture=new THREE.Data3DTexture(data,size,size,size);
  texture.format=THREE.RedFormat;texture.type=THREE.UnsignedByteType;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;
  texture.unpackAlignment=1;texture.needsUpdate=true;return texture;
}

interface Viewport {x:number;y:number;width:number;height:number}

/** Low-resolution volume integration, then full-resolution composition and separate stars. */
export class VolumePass {
  readonly material:THREE.RawShaderMaterial;
  private scene=new THREE.Scene();
  private compositeScene=new THREE.Scene();
  private compositeMaterial:THREE.ShaderMaterial;
  private geometry=new THREE.PlaneGeometry(2,2);
  private target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});
  private clearColor=new THREE.Color();
  private resolutionScale:number;

  constructor(noise:THREE.Data3DTexture,kind:'nebula'|'galaxy'|'orbits'){
    this.resolutionScale=kind==='nebula'?.52:.65;
    this.material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:volumeVertex,fragmentShader:volumeFragment,uniforms:{uNoise:{value:noise},uInverseProjection:{value:new THREE.Matrix4()},uCameraWorld:{value:new THREE.Matrix4()},uInverseModel:{value:new THREE.Matrix4()},uKind:{value:kind==='galaxy'?1:0},uTime:{value:0},uFrom:{value:0},uTo:{value:0},uBlend:{value:1},uReveal:{value:1},uOpacity:{value:1},uArms:{value:2},uTwist:{value:0},uBar:{value:0},uFragments:{value:0},uTint:{value:new THREE.Vector3(1,1,1)}},depthWrite:false,depthTest:false});
    if(kind==='orbits'){
      this.material.fragmentShader=orbitVolumeFragment;
      Object.assign(this.material.uniforms,{uRadii:{value:new THREE.Vector3()},uWeights:{value:new THREE.Vector3()},uAngles:{value:new THREE.Vector3()},uWidths:{value:new THREE.Vector3()},uSeeds:{value:new THREE.Vector3()},uColor0:{value:new THREE.Vector3()},uColor1:{value:new THREE.Vector3()},uColor2:{value:new THREE.Vector3()}});
    }
    const volume=new THREE.Mesh(this.geometry,this.material);volume.frustumCulled=false;this.scene.add(volume);
    this.compositeMaterial=new THREE.ShaderMaterial({vertexShader:screenVertex,fragmentShader:`uniform sampler2D uMap;varying vec2 vUv;void main(){gl_FragColor=texture2D(uMap,vUv);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(';#include',';\n#include'),uniforms:{uMap:{value:this.target.texture}},transparent:true,depthWrite:false,depthTest:false});
    const composite=new THREE.Mesh(this.geometry,this.compositeMaterial);composite.frustumCulled=false;this.compositeScene.add(composite);
  }

  render(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera,viewport:Viewport):void {
    const scale=Math.min(this.resolutionScale,800/viewport.width);
    const width=Math.max(1,Math.round(viewport.width*scale)),height=Math.max(1,Math.round(viewport.height*scale));
    if(this.target.width!==width||this.target.height!==height)this.target.setSize(width,height);
    camera.updateMatrixWorld();
    this.material.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    this.material.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    const alpha=renderer.getClearAlpha();renderer.getClearColor(this.clearColor);
    renderer.setRenderTarget(this.target);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.setClearColor(0,0);renderer.clear();renderer.render(this.scene,camera);
    renderer.setRenderTarget(null);renderer.setClearColor(this.clearColor,alpha);renderer.setViewport(viewport.x,viewport.y,viewport.width,viewport.height);
    renderer.setScissor(viewport.x,viewport.y,viewport.width,viewport.height);renderer.setScissorTest(true);renderer.render(this.compositeScene,camera);
  }

  dispose():void {this.geometry.dispose();this.material.dispose();this.compositeMaterial.dispose();this.target.dispose();this.scene.clear();this.compositeScene.clear();}
}

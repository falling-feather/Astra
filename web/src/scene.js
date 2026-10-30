import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CelestialSky } from './sky.js';
import { LightRibbons } from './light-ribbons.js';
import { ChildFigure } from './character.js';
import { MirrorWater } from './water.js';
import { VIEW, stationaryFoot } from './motion.js';

/** All visible moving content lives in one 3D world, including the mirrored view. */
export class MirrorLake {
  constructor(container){
    this.container=container;this.time=0;this.renderCount=0;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<650?1.25:1.5));
    this.renderer.info.autoReset=false;
    this.renderer.domElement.setAttribute('aria-hidden','true');container.appendChild(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x030918);
    this.camera=new THREE.PerspectiveCamera(VIEW.fov,1,.05,450);
    this.camera.position.set(0,VIEW.height,VIEW.z);this.camera.rotation.x=VIEW.pitch;
    this.sky=new CelestialSky();this.ribbons=new LightRibbons();this.child=new ChildFigure();this.water=new MirrorWater();
    this.scene.add(this.sky.root,this.ribbons.root,this.child.root,this.water.mesh);
    this.composer=new EffectComposer(this.renderer);
    this.renderPass=new RenderPass(this.scene,this.camera);
    this.bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.38,.48,1.12);
    this.output=new OutputPass();this.composer.addPass(this.renderPass);this.composer.addPass(this.bloom);this.composer.addPass(this.output);
    this.resize();
  }
  async load(){await Promise.all([this.sky.load(),this.child.load()]);this.textures=[this.sky.texture,this.child.texture];this.resize();}
  resize(){
    this.width=this.container.clientWidth;this.height=this.container.clientHeight;
    this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    this.renderer.setSize(this.width,this.height);this.composer.setSize(this.width,this.height);
    this.sky.resize(this.width,this.height,this.renderer.getPixelRatio());this.ribbons.resize(this.height,this.renderer.getPixelRatio());this.water.resize(this.width,this.height,this.renderer.getPixelRatio());
  }
  render(time,weights){
    this.time=time;
    this.water.update(time);this.sky.update(time,weights);this.ribbons.update(time,weights);
    this.renderer.info.reset();this.composer.render();this.renderCount++;
  }
  get rippleCount(){return this.water.count;}
  get diagnostics(){
    const project=side=>{
      const foot=stationaryFoot(side),screen=new THREE.Vector3(foot.x,foot.y,foot.z).project(this.camera);
      return {x:(screen.x+1)/2,y:(1-screen.y)/2,lift:foot.y,grounded:foot.contact};
    };
    return {layers:{starParticles:this.sky.starCount,gatheringParticles:this.sky.swarmData.length,auroraMeshes:3,starfireStrands:102,liveReflection:true,illustratedChild:true},
      feet:{left:project(-1),right:project(1)},activeRipples:this.water.events.filter(e=>this.time-e.z>=0&&this.time-e.z<5.6).length};
  }
  dispose(){
    this.sky.dispose();this.ribbons.dispose();this.child.dispose();this.water.dispose();
    this.bloom.dispose();this.output.dispose();this.composer.dispose();this.renderer.dispose();this.renderer.domElement.remove();
  }
}

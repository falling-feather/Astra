import * as THREE from 'three';
import type { Course } from '../domain/models';
import type { CourseLayer } from '../domain/course-wheel';
import { randomGenerator, GALAXY_PROFILES, spiralPoint } from './galaxy-model';
import { orbitPoint, trackAngle, trackRadius, trackWidth } from './orbit-math';
import { orbitStarVertex } from './orbit-shaders';
import { starFragment, starVertex } from './shaders';
import { VolumePass } from './volume-pass';

interface TrackView { group:THREE.Group; stars:THREE.Points; guide:THREE.LineLoop; cluster:THREE.Points; color:THREE.Color; seed:number }
export interface CourseProjection extends CourseLayer { x:number;y:number;depth:number }

function identitySeed(id:string):number {let value=733;for(const char of id)value=(Math.imul(value,31)+char.charCodeAt(0))>>>0;return value;}

/** All geometry, gas and labels are projected through this single inclined orbital frame. */
export class CourseOrbitScene {
  readonly camera=new THREE.PerspectiveCamera(40,1,.1,200);
  private scene=new THREE.Scene();
  private plane=new THREE.Group();
  private volume:VolumePass|null;
  private tracks=new Map<number,TrackView>();
  private projection=new THREE.Vector3();
  private width=1;
  private height=1;

  constructor(noise:THREE.Data3DTexture,private courses:Course[],private visual=true){
    this.volume=visual?new VolumePass(noise,'orbits'):null;
    this.camera.position.z=48;
    this.plane.scale.set(1,1.5,1);
    this.scene.add(this.plane);
  }

  resize(width:number,height:number):void {
    this.width=width;this.height=Math.max(1,height);
    this.camera.aspect=width/this.height;
    this.camera.setViewOffset(width,this.height,-width*.60,-this.height*.68,width,this.height);
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  }

  update(layers:CourseLayer[],time:number,yaw:number,pitch:number,ratio:number):CourseProjection[] {
    this.plane.rotation.set(-.25+pitch*.045,.26+yaw*.05,0);
    this.plane.updateMatrixWorld(true);this.camera.updateMatrixWorld();
    for(const [ordinal,track] of this.tracks)if(!layers.some(layer=>layer.ordinal===ordinal)){this.release(track);this.tracks.delete(ordinal);}
    const uniforms=this.volume?.material.uniforms;
    if(uniforms){uniforms.uWeights.value.set(0,0,0);uniforms.uTime.value=time;uniforms.uInverseModel.value.copy(this.plane.matrixWorld).invert();}
    const projected:CourseProjection[]=[];
    layers.forEach((layer,slotIndex)=>{
      const radius=trackRadius(layer.slot),angle=trackAngle(layer.slot),width=trackWidth(radius);
      if(this.visual){
        let track=this.tracks.get(layer.ordinal);
        if(!track){track=this.createTrack(this.courses[layer.index]);this.tracks.set(layer.ordinal,track);this.plane.add(track.group);}
        const stars=track.stars.material as THREE.ShaderMaterial;
        stars.uniforms.uRadius.value=radius;stars.uniforms.uWidth.value=width;stars.uniforms.uTurn.value=-(angle-trackAngle(0));stars.uniforms.uTime.value=time;stars.uniforms.uPixelRatio.value=ratio;stars.uniforms.uOpacity.value=layer.opacity*.78;
        track.stars.visible=layer.opacity>.006;
        track.guide.scale.set(radius,radius,1);
        (track.guide.material as THREE.LineBasicMaterial).opacity=layer.opacity*.63+(layer.slot>1.8?.018:0);
        track.cluster.position.set(...orbitPoint(radius,angle));
        const cluster=track.cluster.material as THREE.ShaderMaterial;
        cluster.uniforms.uTime.value=time;cluster.uniforms.uPixelRatio.value=ratio;cluster.uniforms.uOpacity.value=layer.opacity;
        track.cluster.visible=layer.opacity>.006;
        if(uniforms){
          uniforms.uRadii.value.setComponent(slotIndex,radius);uniforms.uAngles.value.setComponent(slotIndex,angle);uniforms.uWidths.value.setComponent(slotIndex,width);uniforms.uWeights.value.setComponent(slotIndex,layer.opacity);
          uniforms.uSeeds.value.setComponent(slotIndex,track.seed%997/11);
          uniforms[`uColor${slotIndex}`].value.set(track.color.r*.65+.001,track.color.g*.70+.004,track.color.b*1.2+.016);
        }
      }
      this.projection.set(...orbitPoint(radius,angle)).applyMatrix4(this.plane.matrixWorld);
      const depth=-this.projection.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      this.projection.project(this.camera);
      projected.push({...layer,x:(this.projection.x*.5+.5)*this.width,y:(-.5*this.projection.y+.5)*this.height,depth});
    });
    return projected;
  }

  /** The static fallback uses these same projected curves, not an independent CSS ellipse. */
  path(slot:number):string {
    const radius=trackRadius(slot),points:string[]=[];
    for(let i=0;i<=110;i++){
      this.projection.set(...orbitPoint(radius,Math.PI*.26+i/110*Math.PI*.92)).applyMatrix4(this.plane.matrixWorld).project(this.camera);
      points.push(`${i?'L':'M'}${((this.projection.x*.5+.5)*this.width).toFixed(1)},${((-.5*this.projection.y+.5)*this.height).toFixed(1)}`);
    }
    return points.join(' ');
  }

  private createTrack(course:Course):TrackView {
    const seed=identitySeed(course.id),random=randomGenerator(seed),color=new THREE.Color(course.color),group=new THREE.Group();
    const hue={h:0,s:0,l:0};color.getHSL(hue,THREE.SRGBColorSpace);color.setHSL((hue.h+.025)%1,.83,.48,THREE.SRGBColorSpace);
    const count=innerWidth<700?7000:23000;
    const positions=new Float32Array(count*3),spread=new Float32Array(count*2),sizes=new Float32Array(count),phases=new Float32Array(count),colors=new Float32Array(count*3);
    for(let i=0;i<count;i++){
      const angle=random()*Math.PI*2;
      positions.set([Math.cos(angle),Math.sin(angle),0],i*3);
      spread.set([(random()+random()+random()-1.5)*1.2,(random()+random()-1)*1.0],i*2);
      sizes[i]=random()>.997?3.4:.48+Math.pow(random(),4)*1.35;phases[i]=random()*6.28;
      colors.set([color.r*.48+.055,color.g*.65+.10,color.b*.75+.13],i*3);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aSpread',new THREE.BufferAttribute(spread,2));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));geometry.setAttribute('aColor',new THREE.BufferAttribute(colors,3));
    const starMaterial=new THREE.ShaderMaterial({vertexShader:orbitStarVertex,fragmentShader:starFragment,uniforms:{uRadius:{value:32},uWidth:{value:1},uTurn:{value:0},uTime:{value:0},uPixelRatio:{value:1},uOpacity:{value:0}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
    const stars=new THREE.Points(geometry,starMaterial);stars.frustumCulled=false;group.add(stars);
    const linePoints=Array.from({length:320},(_,i)=>new THREE.Vector3(...orbitPoint(1,i/320*Math.PI*2)));
    const guide=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePoints),new THREE.LineBasicMaterial({color:color.clone().lerp(new THREE.Color('#b9ecff'),.35),transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));group.add(guide);
    const cluster=this.createCluster(seed,color);group.add(cluster);
    return {group,stars,guide,cluster,color,seed};
  }

  private createCluster(seed:number,color:THREE.Color):THREE.Points {
    const random=randomGenerator(seed+871),profile=GALAXY_PROFILES[seed%GALAXY_PROFILES.length],count=6500;
    const positions=new Float32Array(count*3),colors=new Float32Array(count*3),sizes=new Float32Array(count),phases=new Float32Array(count);
    for(let i=0;i<count;i++){
      const radius=Math.pow(random(),1.1)*2.5;
      const [x,y]=spiralPoint(Math.max(.02,radius/2.5),i%profile.arms,profile);
      positions.set([x*2.5+(random()-.5)*.11,y*2.5+(random()-.5)*.11,(random()-.5)*(.14+.2*Math.exp(-radius*2))],i*3);
      const center=Math.exp(-radius*2.4);
      colors.set([color.r*.6+center*.68,color.g*.7+center*.65,color.b*.85+center*.5],i*3);
      sizes[i]=.36+random()*.8;phases[i]=random()*6.28;
    }
    positions.set([0,0,0],0);sizes[0]=9;colors.set([.75,.95,1],0);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aOrigin',new THREE.BufferAttribute(positions.slice(),3));geometry.setAttribute('aColor',new THREE.BufferAttribute(colors,3));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
    const material=new THREE.ShaderMaterial({vertexShader:starVertex,fragmentShader:starFragment,uniforms:{uTime:{value:0},uGather:{value:1},uPixelRatio:{value:1},uOpacity:{value:0}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
    const points=new THREE.Points(geometry,material);points.frustumCulled=false;return points;
  }

  render(renderer:THREE.WebGLRenderer,viewport:{x:number;y:number;width:number;height:number}):void {this.volume?.render(renderer,this.camera,viewport);renderer.render(this.scene,this.camera);}
  private release(track:TrackView):void {this.plane.remove(track.group);track.group.traverse(object=>{const item=object as THREE.Mesh;if(item.geometry)item.geometry.dispose();if(item.material)(Array.isArray(item.material)?item.material:[item.material]).forEach(material=>material.dispose());});track.group.clear();}
  dispose():void {this.tracks.forEach(track=>this.release(track));this.tracks.clear();this.volume?.dispose();this.scene.clear();}
}

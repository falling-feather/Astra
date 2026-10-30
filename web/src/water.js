import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { stationaryFoot } from './motion.js';
import { footRippleTimesBetween } from './timeline.js';

const vertexShader=/* glsl */`
uniform mat4 textureMatrix;
varying vec4 reflectionUV;
varying vec3 worldPosition;
void main(){
  reflectionUV=textureMatrix*vec4(position,1.0);
  worldPosition=(modelMatrix*vec4(position,1.0)).xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const fragmentShader=/* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec3 color;
uniform float uTime;
uniform vec4 uRipples[12];
uniform vec3 uFeet[2];
varying vec4 reflectionUV;
varying vec3 worldPosition;
void main(){
  vec2 uv=reflectionUV.xy/reflectionUV.w;
  vec2 normal=vec2(0.0);
  float crestLight=0.0;
  for(int i=0;i<12;i++){
    float age=uTime-uRipples[i].z;
    if(age>=0.0&&age<5.6){
      vec2 d=worldPosition.xz-uRipples[i].xy;
      float radius=.025+age*.27;
      float distanceToFoot=length(d);
      float width=max(.012+age*.002,fwidth(distanceToFoot)*1.15);
      float ring=exp(-pow((distanceToFoot-radius)/width,2.0));
      float echo=exp(-pow((distanceToFoot-radius+.075)/(width*1.4),2.0))*.4;
      float fade=pow(1.0-age/5.6,1.75)*smoothstep(0.0,.09,age)*uRipples[i].w;
      vec2 direction=d/max(.001,distanceToFoot);
      normal+=direction*(ring-echo)*fade;
      crestLight+=(ring+echo)*fade*(.50+.50*abs(direction.x));
    }
  }
  float viewDistance=length(cameraPosition-worldPosition);
  uv+=normal*vec2(.0022,.0007)*clamp(15.0/viewDistance,.2,1.0);
  vec3 reflected=texture2D(tDiffuse,clamp(uv,.001,.999)).rgb;
  reflected*=vec3(.64,.77,.92);
  reflected+=crestLight*vec3(.44,.53,.61);
  for(int i=0;i<2;i++){
    float d=length(worldPosition.xz-uFeet[i].xy);
    float contact=(1.0-smoothstep(.005,.075,uFeet[i].z))*exp(-d*d/.009);
    reflected*=1.0-contact*.22;
  }
  gl_FragColor=vec4(reflected,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class MirrorWater {
  constructor(){
    this.events=Array.from({length:12},()=>new THREE.Vector4(0,0,-100,0));
    this.count=0;this.cursor=0;this.lastTime=0;
    this.mesh=new Reflector(new THREE.PlaneGeometry(600,600),{
      textureWidth:1024,textureHeight:768,clipBias:.002,multisample:0,color:0xffffff,
      shader:{uniforms:{tDiffuse:{value:null},color:{value:new THREE.Color()},textureMatrix:{value:new THREE.Matrix4()},
        uTime:{value:0},uRipples:{value:this.events},uFeet:{value:[new THREE.Vector3(),new THREE.Vector3()]}},vertexShader,fragmentShader},
    });
    this.mesh.name='live-reflection-lake';this.mesh.rotation.x=-Math.PI/2;
    // Reflector clones uniforms, so the event pool must refer to the material-owned array.
    this.events=this.mesh.material.uniforms.uRipples.value;
    [-1,1].forEach((side,index)=>{const foot=stationaryFoot(side);this.mesh.material.uniforms.uFeet.value[index].set(foot.x,foot.z,0);});
    this.emitFootRipples(0);
  }
  add(x,z,time,strength=1){this.events[this.cursor].set(x,z,time,strength);this.cursor=(this.cursor+1)%12;this.count++;}
  emitFootRipples(time){for(const side of [-1,1]){const foot=stationaryFoot(side);this.add(foot.x,foot.z,time,.55);}}
  update(time){
    for(const birth of footRippleTimesBetween(this.lastTime,time))this.emitFootRipples(birth);
    this.lastTime=time;
    this.mesh.material.uniforms.uTime.value=time;
  }
  resize(width,height,pixelRatio){this.mesh.getRenderTarget().setSize(Math.round(width*Math.min(pixelRatio,1.3)),Math.round(height*Math.min(pixelRatio,1.3)));}
  dispose(){this.mesh.geometry.dispose();this.mesh.dispose();}
}

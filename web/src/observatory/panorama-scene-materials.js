export const backgroundVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
export const backgroundFragment=`
uniform vec4 uWorldPhase;
uniform float uTime;
uniform sampler2D uMilkyWay;
uniform vec4 uMilkyWayPhase;
uniform float uMilkyWayOpacity;
uniform float uMilkyWayEdgeFade;
varying vec2 vUv;
void main(){
  float angle=uWorldPhase.x+(vUv.x-.5)*uWorldPhase.z;
  float y=uWorldPhase.y+(.5-vUv.y)*uWorldPhase.w;
  // Integer harmonics are exactly periodic around the shared world circumference.
  float clouds=.50+.20*sin(angle*3.+y*4.1+sin(angle*2.)*.6)+.16*cos(angle*7.-y*3.3)+.09*sin(angle*11.+y*7.1+uTime*.014);
  float latitude=exp(-pow((y-.48)*1.15,2.));
  vec3 navy=vec3(.0028,.0072,.0175)+vec3(.0021,.0036,.0082)*clouds*latitude;
  vec2 dustUv=vec2(fract(uMilkyWayPhase.x+(vUv.x-.5)*uMilkyWayPhase.z),1.-(uMilkyWayPhase.y+(.5-vUv.y)*uMilkyWayPhase.w));
  float dustEdge=smoothstep(0.,uMilkyWayEdgeFade,min(dustUv.x,1.-dustUv.x))*smoothstep(0.,uMilkyWayEdgeFade,min(dustUv.y,1.-dustUv.y));
  vec4 milkyWay=texture2D(uMilkyWay,vec2(dustUv.x,clamp(dustUv.y,0.,1.)));
  navy=mix(navy,milkyWay.rgb,milkyWay.a*dustEdge*uMilkyWayOpacity);
  gl_FragColor=vec4(navy,1.);
  #include <colorspace_fragment>
}`;

export const spriteVertex=`
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform vec2 uHalfSize;
varying vec2 vUv;
void main(){vUv=uv;vec2 p=uCenter+vec2(position.x,-position.y)*uHalfSize;gl_Position=vec4(p.x/uViewport.x*2.-1.,1.-p.y/uViewport.y*2.,0.,1.);}`;

export const nebulaFragment=`
uniform sampler2D uMap;
uniform float uTime;
uniform float uSeed;
uniform float uSelected;
uniform vec3 uColor;
uniform float uAtlasOpen;
varying vec2 vUv;
vec4 cloudSlice(vec2 uv,float side){
  vec2 q=uv-.5-vec2(side*.19*uAtlasOpen,side*.052*uAtlasOpen);
  float angle=side*uAtlasOpen*.25,c=cos(angle),s=sin(angle);
  q=mat2(c,-s,s,c)*q/(1.+uAtlasOpen*(side<0.?.10:-.055));
  vec2 sampleUv=q+.5;
  sampleUv+=vec2(sin(q.y*12.+uTime*.19+uSeed),cos(q.x*11.-uTime*.13))*.007;
  vec4 cloud=texture2D(uMap,sampleUv);
  float split=q.x+sin(q.y*12.+uSeed)*.025;
  cloud.a*=smoothstep(-.035,.035,side*split);
  cloud.rgb*=mix(1.,side<0.?1.08:.76,uAtlasOpen);
  return cloud;
}
void main(){
  vec2 p=vUv-.5;
  float envelope=1.-smoothstep(.29,.49,length(p));
  vec2 wind=vec2(sin(p.y*9.+uTime*.19+uSeed)*cos(p.x*7.-uTime*.11),sin(p.x*10.-uTime*.17+uSeed)*sin(p.y*6.+uTime*.13));
  vec2 warped=vUv+wind*.009*envelope;
  vec4 dust=texture2D(uMap,warped);
  if(uAtlasOpen>.0001){
    vec4 nearCloud=cloudSlice(vUv,-1.),farCloud=cloudSlice(vUv,1.);
    float alpha=nearCloud.a+farCloud.a;
    vec3 color=(nearCloud.rgb*nearCloud.a+farCloud.rgb*farCloud.a)/max(alpha,.0001);
    dust=mix(dust,vec4(color,min(1.,alpha)),uAtlasOpen);
  }
  float edge=smoothstep(0.,.038,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
  float breath=.97+.03*sin(uTime*.27+p.x*5.+p.y*4.+uSeed);
  float luminance=dot(dust.rgb,vec3(.2126,.7152,.0722));
  vec3 distantDust=mix(vec3(luminance),dust.rgb,.76)*.89;
  float alpha=dust.a*edge*mix(.76,.60,uAtlasOpen);
  if(alpha<.002)discard;
  gl_FragColor=vec4(distantDust*breath*(1.+uSelected*.035),alpha);
  #include <colorspace_fragment>
}`;

export const haloFragment=`
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uSelected;
uniform float uEffectIntensity;
uniform float uEffectStyle;
varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.;
  float uneven=.72+.28*sin(p.x*4.1+p.y*2.+uSeed)*cos(p.y*3.4-uTime*.025);
  float radius=length(p);
  float haze=pow(1.-smoothstep(.05,1.,radius),2.)*uneven;
  float rhythm;
  if(uEffectStyle<.5)rhythm=.70+.30*pow(.5+.5*cos(atan(p.y,p.x)*4.-uTime*.17),2.);
  else if(uEffectStyle<1.5)rhythm=.67+.33*(.5+.5*sin(p.x*9.-p.y*3.-uTime*.80));
  else if(uEffectStyle<2.5)rhythm=.75+.25*sin(p.x*3.+p.y*6.+uTime*.24);
  else rhythm=.68+.32*pow(.5+.5*sin(radius*15.-uTime*.70),3.);
  float spill=pow(1.-smoothstep(.03,1.,radius),1.15)*rhythm*uneven*uSelected*uEffectIntensity*.11;
  gl_FragColor=vec4(uColor,min(.24,haze*.045+spill));
  #include <colorspace_fragment>
}`;

export const pointVertex=`
attribute float aSize;
attribute float aSeed;
attribute float aAlpha;
attribute vec3 aColor;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uZoomSize;
uniform float uTime;
uniform float uTwinkleFloor;
varying float vAlpha;
varying float vRays;
varying vec3 vColor;
void main(){
  gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);
  gl_PointSize=clamp(aSize*uZoomSize,2.,14.)*uPixelRatio;
  vAlpha=aAlpha*(uTwinkleFloor+(1.-uTwinkleFloor)*pow(.5+.5*sin(uTime*(.65+aSeed*.70)+aSeed*41.),2.));
  vRays=smoothstep(4.5,8.,aSize);vColor=aColor;
}`;
export const pointFragment=`
uniform float uCoreFalloff;
uniform float uRayGain;
varying float vAlpha;
varying float vRays;
varying vec3 vColor;
void main(){
  vec2 p=gl_PointCoord-.5;float r=length(p);
  float core=exp(-r*r*uCoreFalloff),glow=exp(-r*r*19.)*.065;
  float rays=(exp(-abs(p.x)*90.)*exp(-abs(p.y)*9.)+exp(-abs(p.y)*90.)*exp(-abs(p.x)*9.))*uRayGain*vRays;
  gl_FragColor=vec4(vColor,(core+glow+rays)*vAlpha);
  #include <colorspace_fragment>
}`;

export const lineVertex=`
attribute vec3 aColor;
attribute float aAlpha;
uniform vec2 uViewport;
varying vec3 vColor;
varying float vAlpha;
void main(){gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);vColor=aColor;vAlpha=aAlpha;}`;
export const lineFragment=`
varying vec3 vColor;
varying float vAlpha;
void main(){
  gl_FragColor=vec4(vColor,vAlpha);
  #include <colorspace_fragment>
}`;

export const trailVertex=`
attribute float aAlpha;
attribute float aAcross;
uniform vec2 uViewport;
varying float vAlpha;
varying float vAcross;
void main(){gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);vAlpha=aAlpha;vAcross=aAcross;}`;
export const trailFragment=`varying float vAlpha;varying float vAcross;void main(){gl_FragColor=vec4(.72,.83,.98,vAlpha*exp(-vAcross*vAcross*3.4)*.82);}`;
export const meteorHeadVertex=`
attribute float aAlpha;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uHeadSize;
varying float vAlpha;
void main(){gl_Position=vec4(position.x/uViewport.x*2.-1.,1.-position.y/uViewport.y*2.,0.,1.);gl_PointSize=uHeadSize*uPixelRatio;vAlpha=aAlpha;}`;
export const meteorHeadFragment=`varying float vAlpha;void main(){vec2 p=gl_PointCoord-.5;float core=exp(-dot(p,p)*90.);float glow=exp(-dot(p,p)*24.)*.18;gl_FragColor=vec4(.85,.92,1.,(core+glow)*vAlpha);}`;

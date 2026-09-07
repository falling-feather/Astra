export const orbitStarVertex=`
attribute vec2 aSpread;
attribute float aSize,aPhase;
attribute vec3 aColor;
uniform float uRadius,uWidth,uTurn,uTime,uPixelRatio;
varying vec3 vColor;
varying float vTwinkle;
void main(){
  float c=cos(uTurn),s=sin(uTurn);
  vec2 direction=mat2(c,-s,s,c)*position.xy;
  vec3 point=vec3(direction*(uRadius+aSpread.x*uWidth),aSpread.y*.36);
  vec4 viewPoint=modelViewMatrix*vec4(point,1.0);
  gl_Position=projectionMatrix*viewPoint;
  gl_PointSize=clamp(aSize*uPixelRatio*70.0/max(9.0,-viewPoint.z),.7,12.0);
  vColor=aColor;vTwinkle=.78+.22*sin(uTime*.4+aPhase*19.0);
}
`;

/** The toroidal clouds and local spiral concentrations use the same frame as the guides. */
export const orbitVolumeFragment=`
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform mat4 uInverseProjection,uCameraWorld,uInverseModel;
uniform vec3 uRadii,uWeights,uAngles,uWidths,uSeeds;
uniform vec3 uColor0,uColor1,uColor2;
uniform float uTime;
in vec2 vUv;
out vec4 outColor;
float n3(vec3 p){vec3 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return texture(uNoise,(cell+f+.5)/64.0).r;}
float fbm(vec3 p){return n3(p)*.53+n3(p*2.03+11.7)*.27+n3(p*4.09+29.3)*.13+n3(p*8.11+7.5)*.07;}
vec3 colorAt(int i){return i==0?uColor0:i==1?uColor1:uColor2;}
vec4 field(vec3 p){
  float r=length(p.xy),theta=atan(p.y,p.x);
  vec3 emission=vec3(0.0);float total=0.0;
  for(int i=0;i<3;i++){
    if(uWeights[i]<.002)continue;
    float dr=r-uRadii[i],width=uWidths[i];
    vec2 center=uRadii[i]*vec2(cos(uAngles[i]),sin(uAngles[i]));
    vec2 local=p.xy-center;
    float distance=length(local);
    if(abs(dr)>width*3.5&&distance>3.7)continue;
    vec3 q=vec3(cos(theta-uAngles[i])*28.0,sin(theta-uAngles[i])*28.0,dr*2.0+p.z*1.7)+uSeeds[i];
    q+=vec3(uTime*.014,0.0,0.0);
    float clumps=fbm(q);
    float wisps=fbm(q*2.4+vec3(3.5,dr*2.0,p.z));
    float ridge=dr+(clumps-.5)*width*1.3;
    float filament=exp(-ridge*ridge/(width*width*.7)-p.z*p.z*3.4);
    float envelope=exp(-dr*dr/(width*width*3.8)-p.z*p.z*1.8);
    float dust=filament*smoothstep(.30,.70,clumps)*(.26+wisps*.85)+envelope*.035;
    float mini=0.0;
    if(distance<3.7){
      float phase=atan(local.y,local.x)-log(max(distance,.09))*2.9-uSeeds[i];
      float arms=pow(.5+.5*cos(phase*2.0),7.0);
      mini=(arms*.5*exp(-distance*.8)+exp(-distance*3.4)*2.0)*exp(-p.z*p.z*3.2);
    }
    float density=(dust+mini)*uWeights[i];
    vec3 tint=colorAt(i);
    vec3 hue=mix(tint,vec3(.72,.91,1.0),min(.65,mini));
    emission+=hue*density*(1.15+wisps*.6);total+=density;
  }
  return vec4(emission,total);
}
void main(){
  vec4 projected=uInverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);
  vec3 worldDirection=normalize((uCameraWorld*vec4(projected.xyz/projected.w,0.0)).xyz);
  vec3 origin=(uInverseModel*uCameraWorld*vec4(0,0,0,1)).xyz;
  vec3 direction=normalize((uInverseModel*vec4(worldDirection,0)).xyz);
  vec3 bounds=vec3(46,46,2.2),inv=1.0/(direction+vec3(.00001));
  vec3 a=(-bounds-origin)*inv,b=(bounds-origin)*inv;
  vec3 nearV=min(a,b),farV=max(a,b);
  float start=max(max(nearV.x,nearV.y),max(nearV.z,0.0));
  float end=min(min(farV.x,farV.y),farV.z);
  if(end<=start){outColor=vec4(0);return;}
  float stepSize=(end-start)/48.0;
  float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  vec3 sum=vec3(0);float transmission=1.0;
  for(int j=0;j<48;j++){
    vec3 p=origin+direction*(start+(float(j)+jitter)*stepSize);
    vec4 sampleValue=field(p);
    if(sampleValue.a>.002){
      float alpha=1.0-exp(-sampleValue.a*stepSize*1.7);
      sum+=transmission*(sampleValue.rgb/sampleValue.a)*alpha;
      transmission*=1.0-alpha;
      if(transmission<.02)break;
    }
  }
  float alpha=1.0-transmission;
  outColor=vec4(sum/max(alpha,.001),alpha);
}
`;

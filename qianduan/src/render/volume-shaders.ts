export const volumeVertex=`
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;

/** Each pixel integrates light along a ray THROUGH a 3D density field. No image UVs. */
export const volumeFragment=`
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform mat4 uInverseProjection,uCameraWorld,uInverseModel;
uniform float uKind,uTime,uFrom,uTo,uBlend,uReveal,uOpacity;
uniform float uArms,uTwist,uBar,uFragments;
uniform vec3 uTint;
in vec2 vUv;
out vec4 outColor;
float noise3(vec3 p){vec3 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return texture(uNoise,(cell+f+.5)/64.0).r;}
float fbm(vec3 p){return noise3(p)*.5333+noise3(p*2.03+17.1)*.2667+noise3(p*4.07+37.4)*.1333+noise3(p*8.13+11.8)*.0667;}
mat2 turn(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

float cloudField(vec3 p,float theme){
  p.xy=turn(theme*.21)*p.xy;
  p+=vec3(theme*11.6,theme*8.1,theme*6.3);
  vec3 drift=vec3(uTime*.023,-uTime*.014,uTime*.011);
  vec3 q=p*.29+drift;
  vec3 warp=vec3(noise3(q*.41),noise3(q*.41+18.3),noise3(q*.41+43.7))-.5;
  float cloud=fbm(q+warp*3.4);
  float ridge=1.0-abs(noise3(q*.72+warp*1.2)-.5)*2.0;
  float bands=.05*sin(p.x*.24+p.y*.29+warp.z*3.0);
  float erosion=(1.0-fbm(q*3.2+warp))*.075;
  float detail=fbm(q*5.2+warp*2.0);
  return pow(smoothstep(.49,.70,cloud+ridge*.08+bands-erosion),1.35)*(.30+detail*1.35);
}
float nebulaDensity(vec3 p){
  float mixValue=smoothstep(0.0,1.0,uBlend);
  float density=uBlend>=1.0||uFrom==uTo?cloudField(p,uTo):mix(cloudField(p,uFrom),cloudField(p,uTo),mixValue);
  // A dark cavity on the left leaves the brand readable; depth stays three-dimensional.
  float cavity=smoothstep(.68,1.24,length((p-vec3(-8.0,2.0,4.0))/vec3(9.0,8.0,13.0)));
  vec3 envelope=1.0-smoothstep(vec3(16.0,10.0,7.0),vec3(25.0,17.0,13.0),abs(p));
  return density*cavity*envelope.x*envelope.y*envelope.z*.29*(.35+.65*uReveal);
}
float galacticDensity(vec3 p){
  float radius=length(p.xy)/16.0;
  if(radius>1.0)return 0.0;
  float theta=atan(p.y,p.x);
  float phase=theta*uArms-(2.0/.32-uTwist*2.0)*log(max(radius,.025));
  phase+=sin(radius*33.0+noise3(p*.6)*2.0)*.08;
  float winding=sin(phase*.5);
  float arm=exp(-winding*winding/(.08+radius*.035));
  float minor=exp(-pow(cos(phase*.5),2.0)/.024)*.20;
  float lane=exp(-pow(sin((phase+.37)*.5),2.0)/.013);
  float clumps=fbm(p*1.1+vec3(2.0,5.0,7.0));
  float fragments=mix(1.0,smoothstep(.25,.65,clumps),uFragments*.65);
  float height=.13+.40*exp(-radius*6.0);
  float disk=exp(-p.z*p.z/(height*height))*exp(-radius*1.85);
  float arms=(.22+(arm+minor)*(.70+clumps*.90))*disk*fragments;
  float bulge=exp(-radius*17.0-p.z*p.z*2.2)*.85;
  float bar=exp(-p.x*p.x*.16-p.y*p.y*1.6-p.z*p.z*3.0)*uBar*.4;
  return max(0.0,arms*(1.0-lane*.79)+bulge+bar)*(1.0-smoothstep(.72,1.0,radius))*1.7;
}
float densityAt(vec3 p){return uKind<.5?nebulaDensity(p):galacticDensity(p);}
vec3 themeColor(float theme,vec3 p){
  float blend=clamp(.5+p.x*.031+p.y*.017,0.0,1.0);
  if(theme<.5)return mix(vec3(.025,.25,.67),vec3(.32,.06,.53),blend);
  if(theme<1.5)return mix(vec3(.07,.07,.52),vec3(.57,.035,.19),blend);
  return mix(vec3(.015,.27,.34),vec3(.59,.28,.035),blend);
}
void main(){
  vec4 projected=uInverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);
  vec3 worldDirection=normalize((uCameraWorld*vec4(projected.xyz/projected.w,0.0)).xyz);
  vec3 origin=(uInverseModel*uCameraWorld*vec4(0.0,0.0,0.0,1.0)).xyz;
  vec3 direction=normalize((uInverseModel*vec4(worldDirection,0.0)).xyz);
  vec3 bounds=uKind<.5?vec3(25.0,17.0,13.0):vec3(16.5,16.5,2.5);
  vec3 invDir=1.0/(direction+vec3(.00001));
  vec3 t0=(-bounds-origin)*invDir,t1=(bounds-origin)*invDir;
  vec3 nearV=min(t0,t1),farV=max(t0,t1);
  float enter=max(max(nearV.x,nearV.y),max(nearV.z,0.0));
  float leave=min(min(farV.x,farV.y),farV.z);
  if(leave<=enter){outColor=vec4(0.0);return;}
  float stepSize=(leave-enter)/64.0;
  float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  float travel=enter+stepSize*jitter;
  float transmission=1.0;
  vec3 accumulated=vec3(0.0);
  vec3 lightDirection=normalize(vec3(-.38,.62,.69));
  for(int i=0;i<64;i++){
    vec3 p=origin+direction*travel;
    float density=densityAt(p);
    if(density>.003){
      vec3 color;
      if(uKind<.5){
        float shadow=densityAt(p+lightDirection*.6);
        float lit=clamp(.36+(density-shadow)*12.4,0.03,1.0);
        color=mix(themeColor(uFrom,p),themeColor(uTo,p),smoothstep(0.0,1.0,uBlend));
        float hot=exp(-length((p-vec3(5.0,2.0,3.0))*.17));
        color=mix(color,vec3(.9,.72,.52),hot*.18);
        color*=.045+lit*lit*1.7+hot*.28;
      }else{
        float radius=length(p.xy)/16.0;
        color=mix(vec3(.06,.22,.78)*uTint,vec3(1.05,.64,.25),exp(-radius*9.0));
        color+=vec3(.36,.025,.24)*smoothstep(.59,.73,fbm(p*1.1));
        color*=1.75+noise3(p*2.5)*.65;
      }
      float alpha=1.0-exp(-density*stepSize*(uKind<.5?1.0:2.5));
      accumulated+=transmission*color*alpha;
      transmission*=1.0-alpha;
      if(transmission<.018)break;
    }
    travel+=stepSize;
  }
  float alpha=(1.0-transmission)*uOpacity;
  outColor=vec4(accumulated/max(1.0-transmission,.001),alpha);
}
`;

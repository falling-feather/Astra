export const screenVertex=`
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}
`;

export const starVertex=`
attribute vec3 aOrigin,aColor;
attribute float aSize,aPhase;
uniform float uTime,uGather,uPixelRatio;
varying vec3 vColor;
varying float vTwinkle;
void main(){
  float ease=1.0-pow(1.0-clamp(uGather,0.0,1.0),3.0);
  vec3 point=mix(aOrigin,position,ease);
  vec4 viewPoint=modelViewMatrix*vec4(point,1.0);
  gl_Position=projectionMatrix*viewPoint;
  gl_PointSize=clamp(aSize*uPixelRatio*(55.0/max(8.0,-viewPoint.z)),.6,13.0);
  vColor=aColor;
  vTwinkle=.77+.23*sin(uTime*(.22+aPhase*.06)+aPhase*23.0);
}
`;
export const starFragment=`
uniform float uOpacity;
varying vec3 vColor;
varying float vTwinkle;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0;
  float d=dot(p,p);
  float rays=(exp(-abs(p.x)*48.0)*exp(-abs(p.y)*5.0)+exp(-abs(p.y)*48.0)*exp(-abs(p.x)*5.0))*.09;
  float alpha=(exp(-d*6.0)*.5+exp(-d*32.0)*.75+rays)*vTwinkle*uOpacity;
  if(alpha<.008)discard;
  gl_FragColor=vec4(vColor,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

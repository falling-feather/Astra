/** Shared projected starlight for the sky, sea and fixed coastal foreground. */
export function sampleEnvironmentLight(regions,weights,viewport,out){
  let total=0,x=0,r=0,g=0,b=0;
  for(let index=0;index<regions.length;index++){
    if(!weights[index])continue;
    const {projection,lightColor}=regions[index];
    const nx=projection.x/viewport.width,ny=projection.y/viewport.height;
    const visibility=Math.exp(-Math.pow((nx-.42)/.73,4)-Math.pow((ny-.36)/.85,4));
    const amount=weights[index]*visibility;
    total+=amount;x+=Math.max(.04,Math.min(.96,nx))*amount;
    r+=lightColor[0]*amount;g+=lightColor[1]*amount;b+=lightColor[2]*amount;
  }
  out.strength=Math.min(1,total);
  if(total<1e-6){out.x=.5;out.color.fill(0);return out;}
  out.x=x/total;
  const luminance=(r*.2126+g*.7152+b*.0722)/total;
  out.color[0]=r/total*.8+luminance*.2;
  out.color[1]=g/total*.8+luminance*.2;
  out.color[2]=b/total*.8+luminance*.2;
  return out;
}

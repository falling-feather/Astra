export interface GalaxyProfile {
  arms:number;
  twist:number;
  bar:number;
  fragments:number;
  rotation:number;
  tilt:number;
  tint:[number,number,number];
  seed:number;
}

// Visual identities, not a gravity simulation or a real galaxy catalogue.
// The stellar disk follows logarithmic arms, with a thicker central bulge.
export const GALAXY_PROFILES:GalaxyProfile[]=[
  {arms:2,twist:0,bar:0,fragments:0,rotation:.22,tilt:-.14,tint:[.72,1.12,1.38],seed:121},
  {arms:2,twist:.38,bar:1,fragments:0,rotation:1.08,tilt:-.23,tint:[.95,.84,1.44],seed:242},
  {arms:4,twist:-.25,bar:0,fragments:.45,rotation:-.32,tilt:-.08,tint:[1.22,.72,1.29],seed:363},
  {arms:4,twist:.7,bar:.35,fragments:0,rotation:.62,tilt:-.29,tint:[.64,1.26,1.04],seed:484},
  {arms:2,twist:-.65,bar:0,fragments:.7,rotation:-.7,tilt:-.16,tint:[1.45,1.02,.66],seed:605},
  {arms:2,twist:.92,bar:.15,fragments:1,rotation:.88,tilt:-.32,tint:[.65,.95,1.52],seed:726},
];

export function randomGenerator(seed:number):()=>number {
  return ()=>{seed=Math.imul(1664525,seed)+1013904223|0;return(seed>>>0)/4294967296;};
}

export function spiralPoint(radius:number,arm:number,profile:GalaxyProfile):[number,number] {
  const theta=(Math.log(Math.max(radius,.025))/.32-profile.twist*Math.log(Math.max(radius,.045)))*2/profile.arms+arm*Math.PI*2/profile.arms;
  return [Math.cos(theta)*radius,Math.sin(theta)*radius];
}

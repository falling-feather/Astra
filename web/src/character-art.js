// Registration points on the approved illustrated child. All rendered parts use this one artwork.
const scale=1.18/(1458-20);
const left={hip:[430,950],knee:[422,1170],ankle:[402,1384],shoulder:[345,430]};
const right={hip:[597,950],knee:[594,1170],ankle:[610,1384],shoulder:[675,430]};
export const ART=Object.freeze({width:1024,height:1536,ground:1458,center:512,scale,left,right});
export const PARTS={
  body:[[150,0],[870,0],[870,330],[704,365],[690,443],[650,548],[645,715],[670,936],[345,936],[340,839],[365,635],[360,530],[320,418],[150,335]],
  leftArm:[[190,385],[360,385],[382,500],[366,610],[349,735],[326,850],[333,970],[180,970]],
  rightArm:[[640,382],[830,382],[845,970],[675,970],[680,876],[659,744],[642,615],[631,507]],
  leftThigh:[[340,895],[513,895],[513,1194],[344,1194]],
  rightThigh:[[506,895],[671,895],[680,1194],[508,1194]],
  leftCalf:[[345,1138],[511,1138],[511,1410],[324,1410]],
  rightCalf:[[510,1138],[692,1138],[702,1410],[508,1410]],
  leftShoe:[[307,1326],[514,1326],[514,1475],[304,1475]],
  rightShoe:[[512,1326],[725,1326],[733,1475],[511,1475]],
};
export function artPoint(pixel){return {x:(pixel[0]-ART.center)*scale,y:(ART.ground-pixel[1])*scale,z:0};}

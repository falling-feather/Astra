import {describe,expect,it} from 'vitest';
import {archiveFrameIsDue} from '../src/v2/pages/archive-field/frame-pacing';
describe('archive frame pacing',()=>{
  it('limits 60/120 Hz screens to thirty draws per second',()=>{
    for(const refresh of [60,120]){
      let last:number|null=null,count=0;
      for(let frame=0;frame<refresh;frame++)if(archiveFrameIsDue(frame*1000/refresh,last,false)){last=frame*1000/refresh;count++;}
      expect(count).toBe(30);
    }
  });
  it('keeps first, resumed and explicit reduced-motion updates immediate',()=>{
    expect(archiveFrameIsDue(100,null,false)).toBe(true);
    expect(archiveFrameIsDue(101,100,true)).toBe(true);
    expect(archiveFrameIsDue(116,100,false)).toBe(false);
    expect(archiveFrameIsDue(300,100,false)).toBe(true);
  });
});

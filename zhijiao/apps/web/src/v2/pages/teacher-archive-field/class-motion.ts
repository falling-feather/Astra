import {CLASS_LANE_GAP} from './motion';
export const CLASS_MOVE_DURATION=1.25;
export type ClassMovePhase='idle'|'opening'|'forward'|'settling';
export interface ClassCommit {from:readonly number[];to:readonly number[]}
export interface ClassMove extends ClassCommit {target:number;elapsed:number}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp(value);return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;};
const progress=(time:number,start:number,end:number)=>ease((time-start)/(end-start));
const toFront=(order:readonly number[],target:number)=>[target,...order.filter(id=>id!==target)];

export function sampleClassMove(move:ClassMove,classId:number,elapsed=move.elapsed){
  const oldRank=move.from.indexOf(classId),newRank=move.to.indexOf(classId),targetRank=move.from.indexOf(move.target);
  const forward=progress(elapsed,.28,.88);
  const scatter=oldRank<targetRank?progress(elapsed,0,.28)*(1-progress(elapsed,.88,CLASS_MOVE_DURATION)):0;
  return {
    x:(oldRank+(newRank-oldRank)*forward)*CLASS_LANE_GAP,
    scatter,
    lift:classId===move.target?Math.sin(forward*Math.PI)*.12:0,
  };
}

/** Class IDs stay stable; only visual order is committed after a complete motion. */
export class ClassShelfMotion {
  order:readonly number[];
  move:ClassMove|null=null;
  private pending:number|null=null;
  constructor(ids:readonly number[]){this.order=[...ids];}
  get busy(){return this.move!==null;}
  get requested(){return this.pending??this.move?.target??this.order[0]!;}
  get phase():ClassMovePhase{
    if(!this.move)return 'idle';
    return this.move.elapsed<.28?'opening':this.move.elapsed<.88?'forward':'settling';
  }
  request(target:number,immediate=false):ClassCommit|null{
    if(!this.order.includes(target))return null;
    if(immediate){
      const commit={from:this.order,to:toFront(this.order,target)};
      this.order=commit.to;this.move=null;this.pending=null;
      return commit;
    }
    if(this.move){this.pending=target;return null;}
    if(this.order[0]!==target)this.move={from:this.order,to:toFront(this.order,target),target,elapsed:0};
    return null;
  }
  advance(delta:number,reduced=false):ClassCommit|null{
    if(!this.move)return null;
    if(reduced)return this.request(this.requested,true);
    this.move.elapsed+=Math.min(.2,Math.max(0,delta));
    if(this.move.elapsed<CLASS_MOVE_DURATION)return null;
    const commit={from:this.move.from,to:this.move.to};
    this.order=commit.to;this.move=null;
    const next=this.pending;this.pending=null;
    if(next!==null)this.request(next);
    return commit;
  }
}

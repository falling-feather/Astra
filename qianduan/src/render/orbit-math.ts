export const OUTER_RADIUS=32;
export const TRACK_SPACING=9;

export function trackRadius(slot:number):number {return OUTER_RADIUS-TRACK_SPACING*slot;}
export function trackAngle(slot:number):number {return (151-slot*38)*Math.PI/180;}
export function trackWidth(radius:number):number {return .38+radius*.025;}
export function orbitPoint(radius:number,angle:number):[number,number,number] {return [radius*Math.cos(angle),radius*Math.sin(angle),0];}

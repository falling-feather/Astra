import * as THREE from 'three';
import { CHILD_Z } from './motion.js';
import { ART, PARTS, artPoint } from './character-art.js';

/** Assemble the original artwork once in its neutral standing pose. */
export class ChildFigure {
  constructor(){
    this.root=new THREE.Group();this.root.name='still-illustrated-child';this.root.position.z=CHILD_Z;
    this.material=new THREE.MeshBasicMaterial({color:0x8c98ad,transparent:true,alphaTest:.62,depthWrite:true,side:THREE.DoubleSide});
    this.parts=[];
    this.bodyOrigin=[512,930];this.body=this.part(PARTS.body,this.bodyOrigin);this.body.renderOrder=3;
    this.limbs={};
    for(const side of ['left','right']){
      const registration=ART[side];
      const arm=this.part(PARTS[`${side}Arm`],registration.shoulder);
      this.limbs[side]={shoulder:arm,
        thigh:this.part(PARTS[`${side}Thigh`],registration.hip),
        calf:this.part(PARTS[`${side}Calf`],registration.knee),
        shoe:this.part(PARTS[`${side}Shoe`],registration.ankle)};
    }
  }
  async load(){
    this.texture=await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/child.png`);
    this.texture.colorSpace=THREE.SRGBColorSpace;this.material.map=this.texture;this.material.needsUpdate=true;
  }
  part(polygon,origin){
    const shape=new THREE.Shape(polygon.map(([x,y])=>new THREE.Vector2((x-origin[0])*ART.scale,(origin[1]-y)*ART.scale)));
    const geometry=new THREE.ShapeGeometry(shape);
    const vertices=geometry.attributes.position,uvs=geometry.attributes.uv;
    for(let i=0;i<vertices.count;i++){
      const x=vertices.getX(i)/ART.scale+origin[0],y=origin[1]-vertices.getY(i)/ART.scale;
      uvs.setXY(i,x/ART.width,1-y/ART.height);
    }
    const mesh=new THREE.Mesh(geometry,this.material),point=artPoint(origin);
    mesh.position.set(point.x,point.y,point.z);mesh.frustumCulled=false;
    this.root.add(mesh);this.parts.push(mesh);return mesh;
  }
  dispose(){this.parts.forEach(part=>part.geometry.dispose());this.material.dispose();this.texture?.dispose();}
}

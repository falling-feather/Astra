import type {ArchiveDossier} from './types';
import {publicAsset} from '../../../public-asset';

export function ArchiveCover({dossier,className=''}:{dossier:ArchiveDossier;className?:string}) {
  const direct=dossier.coverIndex===0;
  return <span className={'archive-photo '+(direct?'is-direct ':'')+className}>
    <img src={publicAsset(direct?'/assets/archive/xunpu-cover.png':'/assets/v3/course-covers.png')}
      alt={dossier.region+'课程情境插图'} draggable={false}
      style={direct?undefined:{left:String(-(dossier.coverIndex%3)*100)+'%',transform:'translateY(-'+(Math.floor(dossier.coverIndex/3)*50+25)+'%)'}}/>
  </span>;
}

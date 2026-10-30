import { PANORAMA_DUST_LAYER } from './panorama-scene-data.js';

export async function loadPanoramaSceneAssets(loader,catalog){
  const loaded=await loadPanoramaTextures(loader,[...catalog,PANORAMA_DUST_LAYER]);
  return {textures:loaded.slice(0,catalog.length),backgroundTexture:loaded[catalog.length]};
}

export async function loadPanoramaTextures(loader,catalog){
  const results=await Promise.allSettled(catalog.map(entry=>loader.loadAsync(entry.asset)));
  const failed=results.flatMap((result,index)=>result.status==='rejected'?[catalog[index].id]:[]);
  if(failed.length){
    for(const result of results)if(result.status==='fulfilled')result.value.dispose();
    throw new Error(`无法载入星云素材：${failed.join('、')}`);
  }
  return results.map(result=>result.value);
}

/** One renderer owns every GPU resource, including shared geometry, exactly once. */
export function createPanoramaResourceScope(){
  const resources=new Set();let disposed=false;
  return {
    own(resource){
      if(disposed){resource.dispose();throw new Error('全景渲染器已经关闭。');}
      resources.add(resource);return resource;
    },
    dispose(){
      if(disposed)return;disposed=true;
      for(const resource of [...resources].reverse())resource.dispose();
      resources.clear();
    },
    get disposed(){return disposed;},
  };
}

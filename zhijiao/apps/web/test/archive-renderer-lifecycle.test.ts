import {describe,expect,it,vi} from 'vitest';
import {Texture,TextureLoader} from 'three';
import {ArchiveFieldRenderer} from '../src/v2/pages/archive-field/renderer';

describe('archive renderer mounting',()=>{
  it('does not create a graphics context when an asynchronous mount is cancelled',async()=>{
    const controller=new AbortController(),texture=new Texture(),dispose=vi.spyOn(texture,'dispose');
    let finish!:(texture:Texture)=>void;
    const load=vi.spyOn(TextureLoader.prototype,'loadAsync').mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    try{
      const result=ArchiveFieldRenderer.create({} as HTMLCanvasElement,{hover:()=>{},anchor:()=>{}},controller.signal);
      controller.abort();finish(texture);
      await expect(result).rejects.toMatchObject({name:'AbortError'});
      expect(dispose).toHaveBeenCalledOnce();
    }finally{load.mockRestore();}
  });
});

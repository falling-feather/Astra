import {describe,expect,it,vi} from 'vitest';
import {publicAsset} from '../src/public-asset';
describe('public asset deployment paths',()=>{
  it('supports origin, repository and relative static hosting',()=>{
    expect(publicAsset('/assets/archive/charcoal-paper.png','/')).toBe('/assets/archive/charcoal-paper.png');
    expect(publicAsset('/assets/archive/charcoal-paper.png','/ganglian-zhixun/')).toBe('/ganglian-zhixun/assets/archive/charcoal-paper.png');
    expect(publicAsset('/assets/archive/charcoal-paper.png','./')).toBe('./assets/archive/charcoal-paper.png');
    expect(publicAsset('https://example.com/file.png','./')).toBe('https://example.com/file.png');
    expect(publicAsset('/api/files/123','./')).toBe('/api/files/123');
  });
  it('resolves a build variant while leaving originals available outside public builds',()=>{
    vi.stubGlobal('__PUBLIC_ASSET_MAP__',{'/assets/picture.png':'/assets/optimized/picture-ab12.webp'});
    try{
      expect(publicAsset('/assets/picture.png','./')).toBe('./assets/optimized/picture-ab12.webp');
      expect(publicAsset('/assets/other.png','/')).toBe('/assets/other.png');
    }finally{vi.unstubAllGlobals();}
    expect(publicAsset('/assets/picture.png','/')).toBe('/assets/picture.png');
  });
});

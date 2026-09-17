import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');

/** Build-only variants. Original artwork and atlas cell dimensions remain authoritative. */
export async function optimizePublicImages(paths,publicRoot,cacheRoot) {
  await mkdir(cacheRoot,{recursive:true});
  sharp.concurrency(2);
  const results=[];
  for(const path of paths) {
    if(!path.startsWith('/assets/')||path.includes('..')||path.includes('\\'))throw new Error('Invalid public asset path');
    const original=await readFile(resolve(publicRoot,path.slice(1)));
    const metadata=await sharp(original).metadata();
    const texture=path==='/assets/archive/charcoal-paper.png';
    const standaloneCover=path==='/assets/archive/xunpu-cover.png';
    const options={quality:metadata.hasAlpha?90:86,alphaQuality:100,effort:5,smartSubsample:true};
    const resize=texture?{width:512,height:512,fit:'inside',withoutEnlargement:true}:standaloneCover?{width:1280,withoutEnlargement:true}:null;
    const cacheKey=hash(hash(original)+JSON.stringify({options,resize,sharp:sharp.versions.sharp,vips:sharp.versions.vips,webp:sharp.versions.webp}));
    const cacheFile=resolve(cacheRoot,cacheKey+'.webp');
    let encoded;
    try{encoded=await readFile(cacheFile);}catch(error){
      if(error.code!=='ENOENT')throw error;
      let pipeline=sharp(original);
      if(resize)pipeline=pipeline.resize(resize);
      encoded=await pipeline.webp(options).toBuffer();
      await writeFile(cacheFile,encoded);
    }
    const info=await sharp(encoded).metadata();
    const name=basename(path).replace(/\.[^.]+$/u,'')+'-'+hash(encoded).slice(0,12)+'.webp';
    // This stable name also gives Vite's CSS resolver the exact public variant.
    const variantFile=resolve(cacheRoot,name);
    await writeFile(variantFile,encoded);
    results.push({originalPath:path,publicPath:'/assets/optimized/'+name,variantFile,name,originalBytes:original.length,bytes:encoded.length,width:info.width,height:info.height,hasAlpha:info.hasAlpha,options,resize});
  }
  return results;
}

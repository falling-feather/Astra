import {readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
export const TeachingMediaDisclosureKeyword='AITrainingDisclosure';
export const TeachingMediaDisclosureText='AI-generated or AI-assisted project asset; teaching simulation only; not documentary evidence; usage_scope=teaching_simulation_only';
type Chunk={type:string;data:Buffer;raw:Buffer};
function crc32(buffer:Buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;}
function chunks(buffer:Buffer):Chunk[]{
 if(buffer.length<8||!buffer.subarray(0,8).equals(signature))throw new Error('not a PNG file');
 const result:Chunk[]=[];let offset=8;
 while(offset<buffer.length){if(offset+12>buffer.length)throw new Error('truncated PNG chunk');const length=buffer.readUInt32BE(offset),end=offset+12+length;
  if(end>buffer.length)throw new Error('PNG chunk exceeds file boundary');const type=buffer.toString('ascii',offset+4,offset+8);
  result.push({type,data:buffer.subarray(offset+8,offset+8+length),raw:buffer.subarray(offset,end)});offset=end;if(type==='IEND')break;
 }
 if(result[0]?.type!=='IHDR'||result[0].data.length!==13||result.at(-1)?.type!=='IEND'||offset!==buffer.length)throw new Error('PNG chunk structure is incomplete');
 return result;
}
function isDisclosure(chunk:Chunk){const end=chunk.data.indexOf(0);return chunk.type==='tEXt'&&end>=0&&chunk.data.subarray(0,end).toString('latin1')===TeachingMediaDisclosureKeyword;}
/** Adds the same project disclosure as the source-asset CLI without decoding or changing pixels. */
export function pngWithTeachingDisclosure(buffer:Buffer):Buffer{
 const kept=chunks(buffer).filter(chunk=>!isDisclosure(chunk)),data=Buffer.from(`${TeachingMediaDisclosureKeyword}\0${TeachingMediaDisclosureText}`,'latin1'),type=Buffer.from('tEXt','ascii');
 const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(Buffer.concat([type,data])),data.length+8);
 return Buffer.concat([signature,kept[0]!.raw,chunk,...kept.slice(1).map(item=>item.raw)]);
}
export function verifyPngTeachingDisclosure(buffer:Buffer):void{
 const found=chunks(buffer).filter(isDisclosure);
 if(found.length!==1||found[0]!.data.subarray(found[0]!.data.indexOf(0)+1).toString('latin1')!==TeachingMediaDisclosureText)throw new Error('PNG teaching disclosure is absent or inconsistent');
}
export async function embedPngTeachingDisclosure(file:string):Promise<void>{
 if(extname(file).toLowerCase()!=='.png')throw new Error('only PNG disclosure is supported');
 const output=pngWithTeachingDisclosure(await readFile(file)),temporary=`${file}.${randomUUID()}.disclosure.tmp`;
 try{await writeFile(temporary,output,{flag:'wx'});await rename(temporary,file);}finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
}

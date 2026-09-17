import {expect,it} from 'vitest';
import {pngWithTeachingDisclosure,verifyPngTeachingDisclosure} from '../src/png-disclosure.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function imageData(bytes:Buffer){const index=bytes.indexOf(Buffer.from('IDAT'));return bytes.subarray(index,index+8+bytes.readUInt32BE(index-4));}
it('preserves encoded pixels, adds one disclosure and is idempotent',()=>{
 expect(()=>verifyPngTeachingDisclosure(png)).toThrow();const labeled=pngWithTeachingDisclosure(png);
 expect(imageData(labeled)).toEqual(imageData(png));expect(()=>verifyPngTeachingDisclosure(labeled)).not.toThrow();
 expect(pngWithTeachingDisclosure(labeled)).toEqual(labeled);
 expect(()=>pngWithTeachingDisclosure(png.subarray(0,png.length-5))).toThrow();
});

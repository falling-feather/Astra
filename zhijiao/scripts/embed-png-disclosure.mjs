import {readFile} from 'node:fs/promises';
import {embedPngTeachingDisclosure,verifyPngTeachingDisclosure} from '@ronggang/media-processing';

const args=process.argv.slice(2),checkOnly=args[0]==='--check',files=checkOnly?args.slice(1):args;
if(!files.length)throw new Error('usage: node scripts/embed-png-disclosure.mjs [--check] <png...>');
for(const file of files){if(checkOnly)verifyPngTeachingDisclosure(await readFile(file));else await embedPngTeachingDisclosure(file);}
console.log(`${checkOnly?'verified':'embedded'} ${files.length} PNG disclosure record(s)`);

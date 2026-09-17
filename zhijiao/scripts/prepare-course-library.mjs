import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.GANGLIAN_PREPARE_ORIGIN??'http://127.0.0.1:4173';
const login=await fetch(base+'/api/auth/demo-session',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({profileId:'teacher-class-a',sessionId:'demo-xunpu-v2'})});
if(!login.ok)throw new Error('Library authorization failed '+login.status);
const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
const headers={origin:base,cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
const courses=['course-xunpu-intangible-media','course-village-super-multiplatform','course-village-super-postpublication-context','course-ai-tourism-copyright-governance','course-scenic-rain-emergency-reporting'];
const documents=[
 {path:'资料/04-职业教育依据/03-融媒体技术与运营专业教学标准-2025.pdf',name:'vocational-media-standard-2025.pdf',title:'融媒体技术与运营专业教学标准（2025）原件',publisher:'中华人民共和国教育部',key:'vocational-media-standard-2025',courses},
 {path:'资料/04-职业教育依据/04-蟳埔簪花围技艺-DB3505T16-2024.pdf',name:'xunpu-standard-2024.pdf',title:'蟳埔女习俗 簪花围技艺 DB3505/T16—2024 原件',publisher:'泉州市市场监督管理局、泉州市文化广电和旅游局',key:'xunpu-standard-2024',courses:[courses[0]]},
 {path:'资料/04-职业教育依据/07-GB45438-2025-公开原件.pdf',name:'GB45438-2025.pdf',title:'人工智能生成合成内容标识方法 GB45438—2025 原件',publisher:'国家市场监督管理总局、国家标准化管理委员会',key:'gb45438-2025',courses:[courses[3]]},
 {path:'资料/04-职业教育依据/08-统计法-2024-公开原件.pdf',name:'statistics-law-2024.pdf',title:'中华人民共和国统计法（2024修订）原件',publisher:'全国人民代表大会常务委员会',key:'statistics-law-2024',courses:[courses[1],courses[2],courses[4]]}
];
const receipts=[];
for(const doc of documents){const contentBase64=(await readFile(resolve(root,doc.path))).toString('base64');for(const courseId of doc.courses){const start=Date.now();const response=await fetch(base+'/api/content-library/materials',{method:'POST',headers,body:JSON.stringify({courseId,sourceKey:doc.key+'-'+courseId,title:doc.title,kind:'course_material',fileName:doc.name,mimeType:'application/pdf',contentBase64,publisher:doc.publisher,rightsNote:'公开专业资料，用于本课程教学查阅与原文核验，保留原件、出处和适用范围，不宣称项目原创或专家评审。',allowModelContext:true})});const body=await response.json();const row={title:doc.title,courseId,status:response.status,elapsedMs:Date.now()-start,indexing:body.material?.indexing??body.indexing,message:body.message};receipts.push(row);console.log(JSON.stringify(row));}}
for(const courseId of courses){const start=Date.now();const response=await fetch(base+'/api/content-library/index',{method:'POST',headers,body:JSON.stringify({courseId})});const body=await response.json();const row={courseId,status:response.status,elapsedMs:Date.now()-start,indexing:body.material?.indexing??body.indexing,message:body.message};receipts.push(row);console.log(JSON.stringify(row));}
await mkdir(resolve(root,'.local/content-preparation'),{recursive:true});
await writeFile(resolve(root,'.local/content-preparation/receipt.json'),JSON.stringify(receipts,null,2));

if(receipts.some(row=>row.status>=400||row.indexing?.status==='failed'))process.exitCode=1;

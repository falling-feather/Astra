import {expect,it} from 'vitest';
import {courseFieldLessonsV3,postpublicationDocumentsV3} from '../src/index.js';
it('provides actual readable documents for every advertised classroom case material',()=>{
  expect(Object.keys(postpublicationDocumentsV3)).toHaveLength(8);
  for(const document of Object.values(postpublicationDocumentsV3))expect(document.body.length).toBeGreaterThan(150);
  expect(postpublicationDocumentsV3['xunpu-postpublication-material-full-interview']!.body).toContain('00:38');
  expect(postpublicationDocumentsV3['xunpu-postpublication-material-published-cut']!.body).toContain('只靠我一个人，这些准备工作肯定忙不过来。');
});
it.each(courseFieldLessonsV3.map(item=>[item.courseId,item.lesson] as const))('keeps a verification and two distinct follow-up receipts in %s',(_id,lesson)=>{
  const routes=lesson.choices.filter(choice=>choice.id.includes('-followup-'));
  expect(routes).toHaveLength(2);expect(routes[0]!.exclusiveGroup).toBe(routes[1]!.exclusiveGroup);
  expect(routes[0]!.response).not.toBe(routes[1]!.response);
  for(const route of routes){expect(route.requires).toHaveLength(1);expect(lesson.choices.some(choice=>choice.flags.includes(route.requires[0]!))).toBe(true);const material=lesson.materials.find(item=>item.id===route.materialIds[0]);expect(material?.requires).toContain(route.flags[0]);}
});

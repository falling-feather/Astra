import { expect, it } from "vitest";
import { hashCanonical, validateExplorationLesson, xunpuExplorationLesson,courseFieldLessonsV3,xunpuV4AdaptationVariants } from "@ronggang/course-content";
import { deriveAdaptiveFieldLesson } from "../src/adaptive-field-lesson.js";
import {LearnerAdaptationVariantRefV4Schema} from '@ronggang/contracts';
import {availableFieldChoices,createFieldInterview} from '@ronggang/world-core';

it('requires acquired sources rather than a claimed flag before the follow-up comparison',()=>{
 const lesson=deriveAdaptiveFieldLesson(courseFieldLessonsV3[1]!.lesson,'variant-xunpu-source-triangulation');
 const choice=lesson.choices.find(choice=>choice.id==='followup-source-compare')!,record=createFieldInterview(lesson,'learner','binding','session');
 record.flags.push(...choice.requires);
 expect(availableFieldChoices(lesson,record,choice.npcId).some(item=>item.id===choice.id)).toBe(false);
 record.materialIds.push(choice.requires[0]!.slice('acquired-material:'.length));
 expect(availableFieldChoices(lesson,record,choice.npcId).some(item=>item.id===choice.id)).toBe(false);
 record.materialIds.push(choice.requires[1]!.slice('acquired-material:'.length));
 expect(availableFieldChoices(lesson,record,choice.npcId).some(item=>item.id===choice.id)).toBe(true);
});

it('compiles all four follow-up conditions for all five courses without requiring Xunpu characters',()=>{
 for(const {lesson} of courseFieldLessonsV3){
  for(const variant of xunpuV4AdaptationVariants){const next=deriveAdaptiveFieldLesson(lesson,LearnerAdaptationVariantRefV4Schema.parse(variant.variantId));
   expect(validateExplorationLesson(next)).toEqual([]);expect(next.people.map(person=>person.id)).toEqual(lesson.people.map(person=>person.id));
   expect(next.workPlan?.contentHash).toBe(lesson.workPlan?.contentHash);expect(next.adaptedFromLessonHash).toBe(lesson.contentHash);
   expect(next.choices.length).toBeGreaterThan(lesson.choices.length);
  }
 }
});

it("freezes distinct executable interview conditions and preserves the source lesson", () => {
  const original = hashCanonical(xunpuExplorationLesson);
  const source = deriveAdaptiveFieldLesson(xunpuExplorationLesson, "variant-xunpu-source-triangulation");
  const consent = deriveAdaptiveFieldLesson(xunpuExplorationLesson, "variant-xunpu-consent-negotiation");
  const deadline = deriveAdaptiveFieldLesson(xunpuExplorationLesson, "variant-xunpu-deadline-service");
  const editorial = deriveAdaptiveFieldLesson(xunpuExplorationLesson, "variant-xunpu-editorial-independence");
  for (const lesson of [source, consent, deadline, editorial]) expect(validateExplorationLesson(lesson)).toEqual([]);
  expect(new Set([source, consent, deadline, editorial].map(item => item.contentHash)).size).toBe(4);
  expect(source.choices.find(item => item.id === "chen-mail")!.delayMinutes).toBe(9);
  expect(consent.choices.find(item => item.id === "ahuan-scope")!.requires).toContain("resident-purpose-clarified");
  expect(deadline.people.find(item => item.id === "entity-public-liaison")!.onSiteUntilMinute).toBe(12);
  expect(deadline.materials.find(item => item.id === "material-service-update")!.body).toContain("前12分钟");
  expect(editorial.choices.find(item => item.id === "wu-limited")!.requires).toContain("commercial-credit-clarified");
  expect(hashCanonical(xunpuExplorationLesson)).toBe(original);
  expect(deriveAdaptiveFieldLesson(xunpuExplorationLesson, "variant-xunpu-source-triangulation")).toEqual(source);
});

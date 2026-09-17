import { EvidenceAssessmentRubricV4Schema, type EvidenceAssessmentRubricV4 } from '@ronggang/agent-orchestrator';
import { hashCanonical, type ExplorationLesson } from '@ronggang/course-content';
import type { AssessmentCriterionIdV4 } from '@ronggang/contracts';

const focus: Record<AssessmentCriterionIdV4, { artifacts: string[]; expectations: string[] }> = {
 'criterion-fact-verification': { artifacts:['artifact-fact-check-sheet','artifact-feature-story'], expectations:['检查作品的具体主张是否与可核对来源、时点、范围相称；区分亲历、转述、仿真资料与公开背景。','没有手动引用卡不扣分；未核实或编造的核心判断应在理由中指明具体表述。'] },
 'criterion-interview-consent': { artifacts:['artifact-interview-plan-log','artifact-feature-story','artifact-rights-ledger'], expectations:['根据作品中实际呈现的人物主体、原意、沟通与公开范围评价；素材课程也可由许可沟通体现。','关系建立只有帮助产生实质调查、尊重意愿或合理协作时才具有价值，不按好友数量或讨好程度评分。'] },
 'criterion-editorial-judgment': { artifacts:['artifact-topic-brief','artifact-feature-story','artifact-publication-correction-decision'], expectations:['考察选题对明确受众的价值、不同立场的呈现及有理由的取舍。','学生可以拒绝编辑建议、换路线或保留有依据的判断，没有唯一标准选题。'] },
 'criterion-rights-governance': { artifacts:['artifact-rights-ledger','artifact-feature-story','artifact-publication-correction-decision'], expectations:['根据实际使用素材检查来源、生成属性、许可用途和公开说明；不使用某种素材不应被扣成缺少操作。','没有上传媒体成品时，只评价已提交的设计和文字说明，不假装看过图像或听过声音。'] },
 'criterion-multiplatform-production': { artifacts:['artifact-multiplatform-script','artifact-feature-story','artifact-publication-correction-decision'], expectations:['按本课交付要求评价信息结构、可读性、受众适配与各端事实一致性。','课程只要求文字服务稿或视觉方案时，不强制图像、音频、视频三件套；没有实际试用或传播数据时不推断效果。'] },
 'criterion-recovery-transfer': { artifacts:['artifact-transfer-reflection','artifact-publication-correction-decision','artifact-feature-story'], expectations:['评价学生是否能解释关键判断、局限以及可以实际执行的后续改进。','一次合理成稿可以得高分；不要求先犯错再修订，不按修订次数、字数或反思套话给分。'] },
};

export function fieldWorkRubric(lesson: ExplorationLesson | undefined, fallback: EvidenceAssessmentRubricV4): EvidenceAssessmentRubricV4 {
 if (!lesson?.workPlan) return fallback;
 const plan = lesson.workPlan, ids = new Set(plan.artifacts.map(artifact=>artifact.artifactId));
 const workBasis = {courseTitle:plan.title,assignment:lesson.assignment,learningObjectives:plan.learningObjectives,
  criteria:fallback.criteria.map(criterion=>{const rule=focus[criterion.criterionId],artifactRefs=rule.artifacts.filter(id=>ids.has(id));
   return {criterionId:criterion.criterionId,artifactRefs,expectations:[...rule.expectations,...artifactRefs.flatMap(id=>plan.artifacts.find(artifact=>artifact.artifactId===id)!.completionChecks)].slice(0,24)};})};
 const body={rubricVersion:`field-work/3.0.0/${plan.courseId}`,reviewStatus:fallback.reviewStatus,criteria:fallback.criteria,workBasis};
 return EvidenceAssessmentRubricV4Schema.parse({...body,rubricContentHash:hashCanonical({body,planHash:plan.contentHash,lessonHash:lesson.contentHash})});
}

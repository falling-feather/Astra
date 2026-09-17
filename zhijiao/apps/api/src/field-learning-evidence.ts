import type { AssessmentCriterionIdV4, LearningObservationV4 } from "@ronggang/contracts";
import { hashCanonical, teachingWorkContrasts } from "@ronggang/course-content";
import type { StructuredAssessmentEvidenceCodeV4, StructuredAssessmentEvidenceFactV4 } from "@ronggang/agent-orchestrator";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import type { FieldEvidenceSource } from "./field-evidence.js";
import type { FlagshipWorkRevisionV3 } from "./flagship-student-work-v3.js";

export const FieldLearningEvidenceVersion = "field-learning-evidence/1.0.1";
export type FieldReviewWork = Pick<FlagshipWorkRevisionV3, "artifactId" | "revisionId" | "contentHash" | "revisionNumber" | "parentRevisionId" | "fields" | "evidenceRefs" | "revisionNote">;
const excerpt = (value: string) => value.length > 700 ? `${value.slice(0, 699)}…` : value;
const sentences = (value: string) => value.split(/(?<=[。！？\n])/u).map(item => item.trim()).filter(Boolean);
// A discussion, quotation or rejected claim is not an asserted fact. Ambiguous
// wording stays for teacher review; these checks deliberately do not infer it.
const asserted = (sentence: string) => !/[“”「」]|不能|不等于|不(?:代表|意味(?:着)?|说明|证明|构成)|不是|未证实|待核|误称|错误|避免|更正|并非|不应/u.test(sentence);

interface ClaimCheck {
  id: string; criterion: AssessmentCriterionIdV4; materials: string[];
  relevant: RegExp; contradicts: RegExp; bounded: RegExp; explanation: string;
}
const claimChecks: readonly ClaimCheck[] = [
  { id: "prepared-count", criterion: "criterion-fact-verification", materials: ["material-resident-account", "material-workshop-notes"],
    relevant: /12|十二/u, contradicts: /(?:到场|参加|参与|来了)(?:了|人数为|人数是|人数|共)?\s*(?:12|十二)\s*(?:人|名)/u,
    bounded: /(?:12|十二)份[^。\n]{0,40}(?:准备|计划)[^。\n]{0,40}(?:不是|不代表|不等于)[^。\n]{0,20}(?:到场|参加)人数/u,
    explanation: "本场资料记录12份材料或计划体验位，实际到场人数没有登记。准备量不能替代到场统计。" },
  { id: "service-scope", criterion: "criterion-fact-verification", materials: ["material-service-update"],
    relevant: /咨询|街区|全街|20分钟|二十分钟/u, contradicts: /(?:整个街区|全街|街区全部)[^。\n]{0,10}(?:关闭|闭门|停止开放)/u,
    bounded: /(?:咨询[^。\n]{0,40}(?:结束|消息|时段|20分钟))[^。\n]{0,80}(?:(?:路线|资料|街区)[^。\n]{0,15}(?:仍|继续)开放|不(?:代表|等于)[^。\n]{0,12}街区关闭)/u,
    explanation: "补充回执限定现场咨询时段，之后通过工作消息联系；公共路线与资料查阅继续开放。" },
  { id: "heritage-year", criterion: "criterion-fact-verification", materials: ["material-local-standard", "material-conflicting-claim"],
    relevant: /2024|非遗|名录/u, contradicts: /2024年?[^。\n]{0,20}(?:入选|列入)[^。\n]{0,15}国家级非遗/u,
    bounded: /2024[^。\n]{0,24}(?:标准|技艺)[^。\n]{0,40}(?:不等于|不能|不是)[^。\n]{0,28}(?:非遗|名录)/u,
    explanation: "2024是所引地方标准的年份，不能据此推定国家级非遗名录身份或入选年份；名录主张须另核原件。" },
  { id: "resident-permission", criterion: "criterion-interview-consent", materials: ["material-resident-consent"],
    relevant: /阿环|林师傅|居民[^。\n]{0,15}(?:同意|引荐|录制)/u, contradicts: /(?:居民|阿环)[^。\n]{0,12}同意[^。\n]{0,20}(?:录音|拍脸|所有平台|任意传播)/u,
    bounded: /(?:文字记录|以文字)[^。\n]{0,60}(?:不包括|不代表|不能|不拍|不录|另行|仍须)/u,
    explanation: "本人的约定仅覆盖文字和不识别人物的环境画面，公开引语仍需核对语境。协调人引荐不能代替本人同意。" },
  { id: "sample-permission", criterion: "criterion-rights-governance", materials: ["material-commercial-offer", "material-license-note"],
    relevant: /样片|水印|许可|作者|人物公开/u, contradicts: /(?:作者|人物|店家|商户)[^。\n]{0,20}(?:都同意|任意转发|所有平台|已经授权)/u,
    bounded: /(?:核对单|样片)[^。\n]{0,80}(?:仍缺|待确认|未约定|没有许可)[^。\n]{0,60}(?:不使用|不用|暂缓|先不)/u,
    explanation: "样片核对单记录作者、人物公开范围和记者用途的缺口，不是发布许可。核对实际使用的文件与台账。" },
];
const choiceFacts: Readonly<Record<string, { code: StructuredAssessmentEvidenceCodeV4; criterion: AssessmentCriterionIdV4; detail: string }>> = {
  "ahuan-scope": { code: "consent_scope_recorded", criterion: "criterion-interview-consent", detail: "已与本人约定文字和环境画面；录音、面部及公开引语仍须分别确认。" },
  "zhou-no-closeup": { code: "consent_scope_recorded", criterion: "criterion-interview-consent", detail: "已接受受访者不使用近景的要求，选择不识别人物的替代画面；公开引语仍须确认。" },
  "ahuan-story": { code: "open_followup_recorded", criterion: "criterion-interview-consent", detail: "实际追问了具体经历，须在作品中保留受访者个人语境。" },
  "wu-self-shoot": { code: "commercial_exchange_disclosed_or_rejected", criterion: "criterion-editorial-judgment", detail: "已选择自行采集，商户样片只作线索；作品仍需对应真实媒体与权利记录。" },
  "wu-interview-only": { code: "commercial_exchange_disclosed_or_rejected", criterion: "criterion-editorial-judgment", detail: "已谢绝样片，保留经营者观点作为一个信源，没有以片源交换报道角度。" },
  "qiao-hold": { code: "deadline_tradeoff_evidenced", criterion: "criterion-editorial-judgment", detail: "已确认暂缓争议片段，后续应在发布决定中说明核验安排。" },
  "chen-remind": { code: "evidence_request_or_reasoned_rejection", criterion: "criterion-recovery-transfer", detail: "在邮件逾期后实际催办，取得资料前仍须保留未知。" },
};

/** Uses committed field sources and submitted work; never counts clicks or text length. */
export function buildFieldLearningEvidence(input: { world: SimulationSessionRecord; sources: FieldEvidenceSource[]; revisions: FieldReviewWork[] }): {
  observations: LearningObservationV4[]; facts: StructuredAssessmentEvidenceFactV4[];
} {
  if (!input.world.fieldInterview) return { observations: [], facts: [] };
  const observations: LearningObservationV4[] = [], facts: StructuredAssessmentEvidenceFactV4[] = [];
  const factKeys = new Set<string>();
  const observe = (id: string, value: Omit<LearningObservationV4, "observationId">) => observations.push({ observationId: `learning-${hashCanonical({ id, value }).slice(0, 24)}`, ...value });
  const add = (ref: string, code: StructuredAssessmentEvidenceCodeV4, kind: StructuredAssessmentEvidenceFactV4["sourceKind"], independence: string, source: unknown) => {
    const key = `${ref}:${code}`; if (factKeys.has(key)) return; factKeys.add(key);
    facts.push({ evidenceRef: ref, sourceKind: kind, evidenceCode: code, independenceKey: independence, sourceContentHash: hashCanonical({ version: FieldLearningEvidenceVersion, source }) });
  };
  const byRef = new Map(input.sources.map(source => [source.option.evidenceRef, source]));
  for (const source of input.sources) {
    const turn = source.turn; if (!turn) continue;
    if (source.option.eventType === "field_boundary_request") {
      add(turn.id, "consent_ignored", "student_behavior", `field-${source.event.id}`, source);
      observe(turn.id, { criterionId: "criterion-interview-consent", status: "conflict", title: "曾提出被拒绝的越界请求",
        detail: "该请求已被人物拒绝，没有授予进入或记录许可。后续可以说明目的、尊重拒绝并选择替代；原请求仍保留用于复核。",
        evidenceRefs: [turn.id], workExcerpt: excerpt(turn.studentText), sourceExcerpt: excerpt(turn.npcText) });
      continue;
    }
    const choice = turn.choiceConfirmed && turn.choiceId ? choiceFacts[turn.choiceId] : undefined;
    if (choice) {
      add(turn.id, choice.code, "student_behavior", `field-${source.event.id}`, source);
      observe(turn.id, { criterionId: choice.criterion, status: "observed", title: source.option.label, detail: choice.detail,
        evidenceRefs: [turn.id], workExcerpt: null, sourceExcerpt: excerpt(turn.npcText) });
    }
    if (/我是[^。\n]{0,20}(?:记者|学生)/u.test(turn.studentText) && /(?:采访|记录|报道)/u.test(turn.studentText)
      && /(?:只记文字|文字记录|不拍近景|不拍你的脸|不录音)/u.test(turn.studentText) && turn.topicId) {
      add(turn.id, "purpose_and_scope_declared", "student_behavior", `field-${source.event.id}`, source);
    }
    if (["ahuan-quote", "zhou-context"].includes(turn.topicId ?? "")) {
      add(turn.id, "open_followup_recorded", "student_behavior", `field-${source.event.id}`, source);
    }
  }
  for (const work of input.revisions) {
    const linked = work.evidenceRefs.flatMap(ref => byRef.get(ref) ?? []);
    const usable = linked.filter(source => source.material?.evidenceStatus !== "case_example" && source.material?.evidenceStatus !== "reference_guide");
    const text = work.fields.map(field => field.content).join("\n");
    if (work.artifactId === "artifact-feature-story") {
      const heading = work.fields.filter(field => ["headline", "lead"].includes(field.fieldId)).map(field => field.content).join("\n");
      if (heading) observe(`${work.revisionId}:headline-review`, { criterionId: "criterion-editorial-judgment", status: "needs_review", title: "核对标题、导语与岗位委托",
        detail: "请结合本次委托、受众和正文核验结果，判断标题是否夸大，是否把单一经营者立场当成报道结论。有限规则不能自动确认新闻价值。",
        evidenceRefs: [work.revisionId], workExcerpt: excerpt(heading), sourceExcerpt: null });
    }
    for (const check of claimChecks) {
      const references = usable.filter(source => source.material && check.materials.includes(source.material.id));
      const candidate = sentences(text).find(sentence => check.relevant.test(sentence));
      if (!candidate) continue;
      const contradiction = sentences(text).find(sentence => asserted(sentence) && check.contradicts.test(sentence));
      const bounded = sentences(text).find(sentence => check.bounded.test(sentence));
      const proof = references.find(source => source.material?.evidenceStatus !== "unverified_claim");
      if (!proof) {
        // Questions, research plans and explicit uncertainty do not assert that
        // the missing source has already established a fact.
        if (!contradiction && !bounded) continue;
        observe(`${work.revisionId}:${check.id}`, { criterionId: check.criterion, status: "gap", title: "该表述还缺本场来源", detail: check.explanation,
          evidenceRefs: [work.revisionId], workExcerpt: excerpt(candidate), sourceExcerpt: null });
        continue;
      }
      observe(`${work.revisionId}:${check.id}`, { criterionId: check.criterion, status: contradiction ? "conflict" : bounded ? "observed" : "needs_review",
        title: contradiction ? "作品表述与所引资料不一致" : bounded ? "作品保留了资料的适用范围" : "请核对作品与来源的范围",
        detail: check.explanation, evidenceRefs: [work.revisionId, ...references.map(source => source.option.evidenceRef)],
        workExcerpt: excerpt(contradiction ?? bounded ?? candidate), sourceExcerpt: excerpt(proof.material!.body) });
      if (contradiction) {
        const code = check.criterion === "criterion-interview-consent" ? "consent_ignored" : check.criterion === "criterion-rights-governance" ? "rights_scope_exceeded" : "current_unsupported_claim";
        add(work.revisionId, code, "artifact_revision", `work-${work.revisionId}`, { work, proof, contradiction });
      } else if (bounded && check.criterion === "criterion-fact-verification") {
        add(work.revisionId, "bounded_unknown", "artifact_revision", `work-${work.revisionId}`, { work, proof, bounded });
      } else if (bounded && check.criterion === "criterion-interview-consent" && usable.some(source => source.turn?.choiceConfirmed && ["ahuan-scope", "zhou-no-closeup"].includes(source.turn.choiceId ?? ""))) {
        add(work.revisionId, "consent_scope_recorded", "artifact_revision", `work-${work.revisionId}`, { work, proof, bounded });
      }
    }
    // An actual citation relationship and the student's compared scope are both
    // required. Possessing two source cards alone is not cross-verification.
    const materialLinks = usable.filter(source => source.material && !["unverified_claim", "case_example", "reference_guide"].includes(source.material.evidenceStatus ?? ""));
    const comparison = sentences(text).find(sentence => /(?:对照|比较|核对)[^。\n]{0,100}(?:范围|时点|准备|名录|版本)/u.test(sentence));
    if (comparison && new Set(materialLinks.map(source => source.material!.sourceUrl ?? source.material!.id)).size >= 2) {
      add(work.revisionId, "cross_source_comparison", "artifact_revision", `work-${work.revisionId}`, { work, comparison, sources: materialLinks });
    }
    if (work.artifactId === "artifact-interview-plan-log") {
      const scoped = usable.filter(source => source.turn?.choiceConfirmed && ["ahuan-scope", "zhou-no-closeup"].includes(source.turn.choiceId ?? ""));
      const scopeField = work.fields.find(field => field.fieldId === "consent")?.content;
      if (scopeField && scoped.length && /(?:文字|环境画面)/u.test(scopeField) && /(?:不拍|不录|另行确认|仍须|不能推定)/u.test(scopeField)) {
        add(work.revisionId, "consent_scope_recorded", "artifact_revision", `work-${work.revisionId}`, { scopeField, scoped });
      }
    }
    if (work.artifactId === "artifact-topic-brief") {
      const publicPurpose = work.fields.find(field => field.fieldId === "public_value")?.content;
      if (publicPurpose && usable.length >= 2 && /(?:游客|居民|读者|受众)/u.test(publicPurpose) && /(?:需要|避免|解决|说明|核实)/u.test(publicPurpose)) {
        add(work.revisionId, "public_value_tradeoff", "artifact_revision", `work-${work.revisionId}`, { publicPurpose, sources: usable });
      }
    }
    if (work.artifactId === "artifact-publication-correction-decision") {
      const decision = work.fields.find(field => field.fieldId === "publication_plan")?.content;
      if (decision && usable.some(source => source.material?.id === "material-service-update" || source.turn?.choiceId === "qiao-hold") && /(?:暂缓|限定|先发|时段|等待|延后)/u.test(decision)) {
        add(work.revisionId, "deadline_tradeoff_evidenced", "artifact_revision", `work-${work.revisionId}`, { decision, sources: usable });
      }
    }
    if (work.artifactId === "artifact-transfer-reflection") {
      const next = work.fields.find(field => field.fieldId === "next_job_transfer")?.content;
      const actual = usable.filter(source => source.turn?.choiceConfirmed || source.material?.id === "material-service-update");
      if (next && actual.length && /(?:下次|下一次|以后)[^。\n]{0,90}(?:如果|若|遇到)[^。\n]{0,90}(?:核对|确认|暂缓|修订|替代)/u.test(next)) {
        add(work.revisionId, "grounded_transfer_reflection", "artifact_revision", `work-${work.revisionId}`, { next, actual });
      }
    }
    for (const contrast of teachingWorkContrasts.filter(item => item.artifactId === work.artifactId)) {
      const field = work.fields.find(item => item.fieldId === contrast.fieldId);
      if (!field || observations.some(item => item.evidenceRefs.includes(work.revisionId) && item.criterionId === contrast.criterionId)) continue;
      const refs = usable.filter(source => source.material && contrast.materialIds.includes(source.material.id));
      observe(`${work.revisionId}:${contrast.exampleId}`, { criterionId: contrast.criterionId, status: refs.length ? "needs_review" : "gap", title: contrast.title,
        detail: `${contrast.reviewReason} ${contrast.evidenceCondition}`, evidenceRefs: [work.revisionId, ...refs.map(source => source.option.evidenceRef)],
        workExcerpt: excerpt(field.content), sourceExcerpt: refs[0]?.material ? excerpt(refs[0].material.body) : null });
    }
  }
  if (!input.revisions.length) observe("no-submitted-work", { criterionId: "criterion-fact-verification", status: "gap", title: "尚无送审作品可核对",
    detail: "先保留本人的问题、资料和实际安排；送审作品后，系统才能对照具体表述。过程观察不形成总分。", evidenceRefs: [], workExcerpt: null, sourceExcerpt: null });
  return { observations, facts };
}

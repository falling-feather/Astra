import { describe, expect, it } from "vitest";
import { xunpuExplorationLesson } from "@ronggang/course-content";
import type { FieldInterviewActionV1 } from "@ronggang/contracts";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";
import { resolveFieldEvidence } from "../src/field-evidence.js";
import { buildFieldLearningEvidence, type FieldReviewWork } from "../src/field-learning-evidence.js";

async function fixture() {
  const sessionId = "field-learning-review";
  const { engine } = await createV3WorldTestRuntime(sessionId);
  engine.registerFieldLesson(xunpuExplorationLesson);
  const identity = { actorId: "student-field-review", bindingId: "binding-field-review" };
  let seq = 0;
  const act = async (action: FieldInterviewActionV1) => engine.commitFieldInterview({ actorId: identity.actorId, lessonHash: xunpuExplorationLesson.contentHash,
    request: { schemaVersion: "field-interview-action/1.0.0", requestId: `field-learning-${++seq}`, sessionId, bindingId: identity.bindingId,
      expectedWorldStateVersion: (await engine.getRecord(sessionId)).currentSnapshot.stateVersion, action } });
  const review = async (revisions: FieldReviewWork[] = []) => {
    const world = await engine.getRecord(sessionId);
    return buildFieldLearningEvidence({ world, sources: resolveFieldEvidence(world, identity), revisions });
  };
  return { act, review };
}
function artifact(text: string, refs: string[], artifactId = "artifact-fact-check-sheet"): FieldReviewWork {
  return { artifactId, revisionId: "review-work-r1", contentHash: "a".repeat(64), revisionNumber: 1, parentRevisionId: null,
    fields: [{ fieldId: "fact_items", content: text }], evidenceRefs: refs, revisionNote: "按本次资料核对事实范围。" };
}

describe("source-grounded field learning observations", () => {
  it("quotes the actual submitted claim and source when preparation count is mistaken for attendance", async () => {
    const { act, review } = await fixture();
    await act({ kind: "choose", npcId: "entity-gatekeeper", choiceId: "lin-introduction", rationale: "请帮助接触愿意交谈的居民", channel: "scene" });
    await act({ kind: "travel", nodeId: "loc-community-courtyard" });
    await act({ kind: "talk", npcId: "entity-community-source", channel: "scene", text: "日常劳动具体怎么安排？" });
    const bad = await review([artifact("本次活动实际到场12人。", ["material-resident-account"])]);
    expect(bad.observations).toContainEqual(expect.objectContaining({ status: "conflict", workExcerpt: "本次活动实际到场12人。", sourceExcerpt: expect.stringContaining("不是实际到场人数") }));
    expect(bad.facts.some(fact => fact.evidenceCode === "current_unsupported_claim")).toBe(true);
    const bounded = await review([artifact("12份是材料准备量，不是实际到场人数；实际人数仍未登记。", ["material-resident-account"])]);
    expect(bounded.observations.some(item => item.status === "conflict")).toBe(false);
    expect(bounded.facts.some(fact => fact.evidenceCode === "bounded_unknown")).toBe(true);
    const unlinked = await review([artifact("12份是材料准备量，不是实际到场人数。", [])]);
    expect(unlinked.facts.some(fact => fact.evidenceCode === "bounded_unknown")).toBe(false);
  });

  it("keeps introductions and advice separate from confirmed personal consent, without requiring the resident route", async () => {
    const { act, review } = await fixture();
    await act({ kind: "choose", npcId: "entity-gatekeeper", choiceId: "lin-introduction", rationale: "请协调接触", channel: "scene" });
    expect((await review()).facts.some(fact => fact.evidenceCode === "consent_scope_recorded")).toBe(false);
    await act({ kind: "travel", nodeId: "loc-merchant-storefront" });
    await act({ kind: "talk", npcId: "entity-tourist", channel: "scene", text: "我是本次课堂实训的记者，想记录您的个人经历，我只记文字，不拍近景。" });
    await act({ kind: "choose", npcId: "entity-tourist", choiceId: "zhou-no-closeup", rationale: "尊重本人拒绝，改用环境画面", channel: "scene" });
    const result = await review();
    expect(result.facts.some(fact => fact.evidenceCode === "consent_scope_recorded")).toBe(true);
    expect(result.observations.some(item => item.status === "observed" && item.detail.includes("近景"))).toBe(true);
    expect(JSON.stringify(result.observations)).not.toContain('"score"');
  });

  it("does not turn greetings, copied examples, or discussion of an error into successful work evidence", async () => {
    const { act, review } = await fixture();
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "陈老师您好" });
    expect((await review()).facts).toEqual([]);
    await act({ kind: "talk", npcId: "entity-public-liaison", channel: "chat", text: "公告版本和咨询时段怎么核对？" });
    await act({ kind: "wait", minutes: 4 });
    await act({ kind: "inspect", materialId: "material-service-update" });
    const result = await review([artifact("不能写整个街区关闭，仍需核对原公告与补充回执。", ["material-notice-board"])]);
    expect(result.observations.some(item => item.status === "conflict")).toBe(false);
    expect(result.facts.some(fact => fact.evidenceCode === "verified_claim_supported")).toBe(false);
    const negated = await review([artifact("原公告与补充回执说明的范围并不相同，咨询方式的改变也不意味着整个街区关闭。", ["material-service-update"])]);
    expect(negated.observations.some(item => item.status === "conflict")).toBe(false);
  });

  it("retains an actual refused boundary request as counterevidence but excludes discussion and negation", async () => {
    const { act, review } = await fixture();
    await act({ kind: "talk", npcId: "entity-gatekeeper", channel: "scene", text: "我不会偷拍，我想了解遇到拒绝记录的人怎么办。" });
    expect((await review()).facts.some(item => item.evidenceCode === "consent_ignored")).toBe(false);
    await act({ kind: "talk", npcId: "entity-gatekeeper", channel: "scene", text: "我要冒充游客进去。" });
    expect((await review()).facts.some(item => item.evidenceCode === "consent_ignored")).toBe(true);
  });
});

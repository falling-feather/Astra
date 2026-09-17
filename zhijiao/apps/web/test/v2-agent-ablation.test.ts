import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GoldCompetitionReadinessSnapshot } from "@ronggang/contracts";
import { routeAllowsAdministratorData } from "../src/App";
import {
  buildAgentEvaluationView,
  parseAgentAblationEvidence,
  parseCrossCourseAgentRuleManifest,
} from "../src/v2/agent-ablation-models";
import {
  createHttpAdminGateway,
  type AdminGateway,
} from "../src/v2/admin-gateway";
import { parseV2Route } from "../src/v2/router";
import {
  AgentEvaluationSurface,
  loadAdminReadinessWorkspace,
} from "../src/v2/pages/admin-readiness-page";
import {
  crossCourseAgentRuleManifestWireFixture,
  insufficientAgentAblationEvidenceWireFixture,
} from "./v2-agent-ablation.fixture";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI-010 administrator rule and ablation evidence", () => {
  it("strictly parses five courses, thirty chapters and fourteen baseline nodes", () => {
    const manifest = parseCrossCourseAgentRuleManifest(
      crossCourseAgentRuleManifestWireFixture(),
    );
    const evidence = parseAgentAblationEvidence(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    expect(manifest.courses).toHaveLength(5);
    expect(manifest.courses.flatMap((course) => course.chapters)).toHaveLength(30);
    expect(manifest.baselineTopologyAgentIds).toHaveLength(14);
    expect(evidence.observationCount).toBe(0);
    expect(evidence.groups.map((group) => group.conditionCode)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(evidence.controls.conditionLabelsHidden).toBe(false);
    expect(evidence.blindReviewStatus).toBe("not_configured");
  });

  it("rejects extra keys, missing baseline nodes and supporting capabilities forged into the baseline", () => {
    const extra = structuredClone(crossCourseAgentRuleManifestWireFixture()) as
      ReturnType<typeof crossCourseAgentRuleManifestWireFixture> & { rawTrace?: unknown };
    extra.rawTrace = { providerRequestId: "private" };
    expect(() => parseCrossCourseAgentRuleManifest(extra)).toThrow(/冻结接口/u);

    const missingNode = structuredClone(crossCourseAgentRuleManifestWireFixture());
    missingNode.baselineTopologyAgentIds.pop();
    expect(() => parseCrossCourseAgentRuleManifest(missingNode)).toThrow(/数量/u);

    const forged = structuredClone(crossCourseAgentRuleManifestWireFixture());
    forged.courses[0]!.chapters[0]!.resolvedCandidateAgentIds.push(
      "agent-evidence-coach",
    );
    expect(() => parseCrossCourseAgentRuleManifest(forged)).toThrow(
      /十四节点候选集合/u,
    );

    const missingRuleCopy = structuredClone(
      crossCourseAgentRuleManifestWireFixture(),
    );
    delete (missingRuleCopy.courses[0]!.chapters[0]! as {
      selectWhen?: string;
    }).selectWhen;
    expect(() => parseCrossCourseAgentRuleManifest(missingRuleCopy)).toThrow(
      /冻结接口/u,
    );
  });

  it("rejects fabricated blindness, duplicate conditions, zero-sample metrics and false conclusions", () => {
    const fakeBlind = structuredClone(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    Reflect.set(fakeBlind.controls, "conditionLabelsHidden", true);
    expect(() => parseAgentAblationEvidence(fakeBlind)).toThrow(
      /conditionLabelsHidden/u,
    );

    const duplicateCondition = structuredClone(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    duplicateCondition.groups[1]!.conditionCode = "A";
    expect(() => parseAgentAblationEvidence(duplicateCondition)).toThrow(
      /唯一预登记条件/u,
    );

    const metricLeak = structuredClone(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    metricLeak.groups[0]!.metrics.taskCompletionRate = 1;
    expect(() => parseAgentAblationEvidence(metricLeak)).toThrow(/零样本/u);

    const falsePositive = structuredClone(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    falsePositive.runStatus = "completed";
    falsePositive.conclusion = "hypothesis_supported";
    falsePositive.gates = falsePositive.gates.map((gate) => ({
      ...gate,
      status: "passed" as const,
    }));
    expect(() => parseAgentAblationEvidence(falsePositive)).toThrow(/零样本/u);
  });

  it("fails closed when the manifest, topology or course eligibility drifts", () => {
    const manifest = parseCrossCourseAgentRuleManifest(
      crossCourseAgentRuleManifestWireFixture(),
    );
    const drifted = structuredClone(insufficientAgentAblationEvidenceWireFixture());
    drifted.ruleManifestHash = "0".repeat(64);
    expect(() => buildAgentEvaluationView(
      manifest,
      parseAgentAblationEvidence(drifted),
    )).toThrow(/冻结哈希/u);

    const eligibilityDrift = structuredClone(
      insufficientAgentAblationEvidenceWireFixture(),
    );
    eligibilityDrift.eligibility[0]!.reasonCode = "browser_selected_reason";
    expect(() => buildAgentEvaluationView(
      manifest,
      parseAgentAblationEvidence(eligibilityDrift),
    )).toThrow(/课程资格/u);
  });

  it("requests only the two frozen operator endpoints with credentials and abort propagation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const controller = new AbortController();
    const gateway = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), ...(init ? { init } : {}) });
        return String(input).endsWith("/api/admin/agent-rule-manifest")
          ? response(crossCourseAgentRuleManifestWireFixture())
          : response(insufficientAgentAblationEvidenceWireFixture());
      },
    });
    await gateway.getAgentRuleManifest(controller.signal);
    await gateway.getAgentAblationEvidence(controller.signal);
    expect(calls.map((call) => call.url)).toEqual([
      "http://api.local/api/admin/agent-rule-manifest",
      "http://api.local/api/admin/agent-ablation-evidence",
    ]);
    for (const call of calls) {
      expect(call.init?.credentials).toBe("include");
      expect(call.init?.signal).toBe(controller.signal);
      expect(new Headers(call.init?.headers).get("Accept")).toBe("application/json");
    }
  });

  it("starts readiness, rule and evidence reads together and builds only a coherent view", async () => {
    const methods: string[] = [];
    const gateway = {
      getReadiness: vi.fn(async () => {
        methods.push("readiness");
        return {} as GoldCompetitionReadinessSnapshot;
      }),
      getAgentRuleManifest: vi.fn(async () => {
        methods.push("manifest");
        return parseCrossCourseAgentRuleManifest(
          crossCourseAgentRuleManifestWireFixture(),
        );
      }),
      getAgentAblationEvidence: vi.fn(async () => {
        methods.push("evidence");
        return parseAgentAblationEvidence(
          insufficientAgentAblationEvidenceWireFixture(),
        );
      }),
    } as unknown as AdminGateway;
    const controller = new AbortController();
    const workspace = await loadAdminReadinessWorkspace(
      gateway,
      "demo-xunpu-v2",
      "binding-operator-demo",
      controller.signal,
    );
    expect(methods).toEqual(["readiness", "manifest", "evidence"]);
    expect(workspace.evaluation.manifest).toMatchObject({
      courseCount: 5,
      chapterCount: 30,
      baselineAgentCount: 14,
      supportingCapabilityIds: ["agent-evidence-coach"],
    });
    expect(gateway.getAgentRuleManifest).toHaveBeenCalledWith(controller.signal);
    expect(gateway.getAgentAblationEvidence).toHaveBeenCalledWith(controller.signal);
  });

  it("renders an honest open preregistration and zero-sample warning without a positive claim", () => {
    const view = buildAgentEvaluationView(
      parseCrossCourseAgentRuleManifest(crossCourseAgentRuleManifestWireFixture()),
      parseAgentAblationEvidence(insufficientAgentAblationEvidenceWireFixture()),
    );
    const markup = renderToStaticMarkup(createElement(AgentEvaluationSurface, {
      evaluation: view,
    }));
    expect(markup).toContain("5");
    expect(markup).toContain("30");
    expect(markup).toContain("14");
    expect(markup).toContain("辅助能力不计入十四节点基线");
    expect(markup).toContain("查看章节选择 / 跳过规则");
    expect(markup).toContain("不代表本次运行已经选中或跳过任何智能体");
    expect(markup).toContain("事件影响对象与候选智能体职责");
    expect(markup).toContain("当前不足以比较三种协作架构");
    expect(markup).toContain("私有随机盲分配尚未建立");
    expect(markup).toContain("预登记组 A");
    expect(markup).toContain("预登记组 B");
    expect(markup).toContain("预登记组 C");
    expect(markup).toContain("<strong>0</strong><span>条真实观察</span>");
    expect(markup).toContain("v2-ablation-boundary insufficient");
    expect(markup).not.toContain("优越");
    expect(markup).not.toContain("conditionCode");
    expect(markup).not.toContain("目标架构");
    expect(markup).not.toContain("single_generalist");
    expect(markup).not.toContain("hypothesis_supported");
  });

  it("keeps administrator readers unreachable from student and teacher first frames", () => {
    expect(routeAllowsAdministratorData(parseV2Route("/student/courses"))).toBe(false);
    expect(routeAllowsAdministratorData(
      parseV2Route("/student/training/demo-xunpu-v2"),
    )).toBe(false);
    expect(routeAllowsAdministratorData(parseV2Route("/teacher/classes"))).toBe(false);
    expect(routeAllowsAdministratorData(
      parseV2Route("/teacher/director/demo-xunpu-v2"),
    )).toBe(false);
    expect(routeAllowsAdministratorData(parseV2Route("/admin/readiness"))).toBe(true);
  });
});

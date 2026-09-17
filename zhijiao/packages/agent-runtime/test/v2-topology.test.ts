import { describe, expect, it } from "vitest";
import { AgentTopologyManifestSchema } from "@ronggang/contracts";
import {
  buildAgentTopologyManifest,
  productionAgentTemplateCatalog,
} from "../src/index.js";

describe("V2 production agent topology", () => {
  it("projects exactly the actual six-group fourteen-agent baseline", () => {
    const manifest = buildAgentTopologyManifest(
      "2026-08-09T08:30:00.000Z",
    );
    expect(AgentTopologyManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest.groups).toHaveLength(6);
    expect(manifest.agents).toHaveLength(14);
    expect(new Set(manifest.agents.map((agent) => agent.agentId)).size).toBe(14);
    expect(manifest.agents.map((agent) => agent.templateId).sort()).toEqual(
      productionAgentTemplateCatalog.list()
        .filter((entry) => entry.lifecycle === "baseline")
        .map((entry) => entry.template.templateId)
        .sort(),
    );
  });

  it("does not inflate the baseline with assistance candidates", () => {
    const manifest = buildAgentTopologyManifest(
      "2026-08-09T08:30:00.000Z",
    );
    expect(manifest.agents.some((agent) => (
      agent.templateId.startsWith("assistant/")
    ))).toBe(false);
    expect(manifest.agents.find((agent) => (
      agent.agentId === "agent-fact-checker"
    ))).toMatchObject({
      groupId: "fact_verification",
      allowedActions: ["propose_data_correction", "ask_for_evidence"],
    });
  });
});

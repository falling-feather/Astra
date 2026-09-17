import { describe, expect, it } from "vitest";
import { AgentDefinitionSchema } from "@ronggang/contracts";
import {
  AgentGraphValidationError,
  compileAgentGraph,
  factCheckerAgentDefinition,
} from "../src/index.js";

describe("agent graph", () => {
  it("compiles a reachable, versioned fact-checker graph", () => {
    const graph = compileAgentGraph(factCheckerAgentDefinition);
    expect(graph.nodeById.get("claim-router")?.kind).toBe("router");
    expect(graph.reachableNodeIds.has("done")).toBe(true);
  });

  it("rejects a graph with an edge pointing to an unknown node", () => {
    const broken = AgentDefinitionSchema.parse({
      ...factCheckerAgentDefinition,
      edges: factCheckerAgentDefinition.edges.map((edge, index) => index === 0 ? { ...edge, to: "missing-node" } : edge),
    });
    expect(() => compileAgentGraph(broken)).toThrow(AgentGraphValidationError);
  });

  it("rejects an unreachable node even when another terminal is reachable", () => {
    const broken = AgentDefinitionSchema.parse({
      ...factCheckerAgentDefinition,
      nodes: [
        ...factCheckerAgentDefinition.nodes,
        { nodeId: "orphan", kind: "terminal", label: "孤立节点", executorKey: null, promptTemplateId: null, toolName: null },
      ],
    });
    expect(() => compileAgentGraph(broken)).toThrow(/不可达节点/);
  });
});

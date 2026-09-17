import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentGraphEdge,
  type AgentGraphNode,
} from "@ronggang/contracts";

export class AgentGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGraphValidationError";
  }
}

export interface CompiledAgentGraph {
  definition: AgentDefinition;
  nodeById: ReadonlyMap<string, AgentGraphNode>;
  outgoingByNodeId: ReadonlyMap<string, readonly AgentGraphEdge[]>;
  reachableNodeIds: ReadonlySet<string>;
}

function uniqueBy<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new AgentGraphValidationError(`${label}重复：${value}`);
    seen.add(value);
  }
}

export function compileAgentGraph(rawDefinition: AgentDefinition): CompiledAgentGraph {
  const definition = AgentDefinitionSchema.parse(rawDefinition);
  uniqueBy(definition.nodes, (node) => node.nodeId, "节点 ID");
  uniqueBy(definition.edges, (edge) => edge.edgeId, "边 ID");

  const nodeById = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  if (!nodeById.has(definition.entryNodeId)) {
    throw new AgentGraphValidationError(`入口节点不存在：${definition.entryNodeId}`);
  }

  const outgoingByNodeId = new Map<string, AgentGraphEdge[]>();
  for (const edge of definition.edges) {
    if (!nodeById.has(edge.from)) throw new AgentGraphValidationError(`边 ${edge.edgeId} 的起点不存在：${edge.from}`);
    if (!nodeById.has(edge.to)) throw new AgentGraphValidationError(`边 ${edge.edgeId} 的终点不存在：${edge.to}`);
    const outgoing = outgoingByNodeId.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingByNodeId.set(edge.from, outgoing);
  }

  for (const node of definition.nodes) {
    const outgoing = outgoingByNodeId.get(node.nodeId) ?? [];
    outgoing.sort((left, right) => right.priority - left.priority || left.edgeId.localeCompare(right.edgeId));
    if (node.kind === "terminal" && outgoing.length > 0) {
      throw new AgentGraphValidationError(`终止节点不能继续连边：${node.nodeId}`);
    }
    if (node.kind !== "terminal" && outgoing.length === 0) {
      throw new AgentGraphValidationError(`非终止节点缺少后接边：${node.nodeId}`);
    }
    if (!["router", "terminal"].includes(node.kind) && node.executorKey === null) {
      throw new AgentGraphValidationError(`节点缺少执行器：${node.nodeId}`);
    }
    if (node.kind === "tool" && node.toolName === null) {
      throw new AgentGraphValidationError(`工具节点缺少 toolName：${node.nodeId}`);
    }
  }

  const reachableNodeIds = new Set<string>();
  const queue = [definition.entryNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);
    for (const edge of outgoingByNodeId.get(nodeId) ?? []) queue.push(edge.to);
  }

  const unreachable = definition.nodes.filter((node) => !reachableNodeIds.has(node.nodeId));
  if (unreachable.length > 0) {
    throw new AgentGraphValidationError(`存在不可达节点：${unreachable.map((node) => node.nodeId).join("、")}`);
  }
  const reachableTerminal = definition.nodes.some((node) => node.kind === "terminal" && reachableNodeIds.has(node.nodeId));
  if (!reachableTerminal) throw new AgentGraphValidationError("入口无法到达任何终止节点");

  return {
    definition,
    nodeById,
    outgoingByNodeId,
    reachableNodeIds,
  };
}

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { FieldInterviewActionResponseV1Schema, type FieldInterviewModelReceiptV1 } from "@ronggang/contracts";

type ToolName = NonNullable<FieldInterviewModelReceiptV1["toolName"]>;
type Result = z.infer<typeof FieldInterviewActionResponseV1Schema>;
interface Invocation { toolName: ToolName; execute(callRef: string): Promise<Result>; failure?: unknown }

/** Real MCP client/server transport stays in-process; only a server-issued invocation can write the world. */
export class FieldCharacterMcp {
  readonly #server = new McpServer({ name: "ganglian-character-tools", version: "3.0.0" });
  readonly #client = new Client({ name: "ganglian-field-runtime", version: "3.0.0" });
  readonly #invocations = new Map<string, Invocation>();
  readonly #ready: Promise<void>;
  constructor() {
    const descriptions: Record<ToolName, string> = {
      interview: "记录当前学生与人物的真实采访行动，交由世界内核核验并提交。",
      meet_person: "依据当前有效交流建立认识记录，不自动添加好友。",
      add_contact: "核验已认识、人物意愿及联络边界后建立工作联络，允许拒绝。",
      request_referral: "核验人物关系和已发布的引荐范围，记录实际介绍与新线索。",
    };
    for (const toolName of Object.keys(descriptions) as ToolName[]) this.#server.registerTool(toolName, {
      description: descriptions[toolName], inputSchema: { invocationRef: z.string().min(1) },
    }, async ({ invocationRef }) => {
      const invocation = this.#invocations.get(invocationRef);
      if (!invocation || invocation.toolName !== toolName) throw new Error("人物工具缺少有效的服务端调用上下文");
      try {
        const result = FieldInterviewActionResponseV1Schema.parse(await invocation.execute(invocationRef));
        return { content: [{ type: "text" as const, text: JSON.stringify({ eventId: result.eventId, replayed: result.replayed }) }], structuredContent: { ...result } };
      } catch (error) { invocation.failure = error; throw error; }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.#ready = (async () => { await this.#server.connect(serverTransport); await this.#client.connect(clientTransport); })();
  }
  async invoke(toolName: ToolName, execute: Invocation["execute"]): Promise<Result> {
    await this.#ready;
    const callRef = `character-tool-${randomUUID()}`, invocation: Invocation = { toolName, execute };
    this.#invocations.set(callRef, invocation);
    try {
      const result = await this.#client.callTool({ name: toolName, arguments: { invocationRef: callRef } });
      if (Object.hasOwn(invocation, "failure")) throw invocation.failure;
      if (result.isError) throw new Error("人物工具执行失败，未确认世界更新");
      return FieldInterviewActionResponseV1Schema.parse(result.structuredContent);
    } finally { this.#invocations.delete(callRef); }
  }
  async close() { await this.#ready; await this.#client.close(); await this.#server.close(); }
}

import { describe, expect, it } from "vitest";
import { TeachingTaskInputV1Schema } from "@ronggang/contracts";
import { createHttpTeachingTaskGateway } from "../src/v2/teaching-task-gateway";
import type { DemoAuthContext } from "../src/v2/models";

const auth: DemoAuthContext = { profileId: "teacher-class-a", principal: { principalId: "teacher-a", kind: "human", displayName: "教师", status: "active", createdAt: "2026-09-11T00:00:00.000Z" },
  bindings: [], csrfToken: "test-csrf", expiresAt: "2026-09-12T00:00:00.000Z" };
const input = TeachingTaskInputV1Schema.parse({ title: "", brief: "给社区游客做公共服务信息核对", audience: "游客", learnerContext: "已学过采访，练习核验", learnerLevel: "beginner", durationMinutes: 45,
  sourceKind: "teaching_example", sourceStatement: "自拟课堂示例", templateId: null });
const clarification = { status: "needs_clarification", questions: ["请明确本次要帮助受众解决的问题。"], supportedTemplates: ["public-service", "community-story"] };

describe("teaching task transport", () => {
  it("retries the same logical generation with the same request id after a connection failure", async () => {
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    const gateway = createHttpTeachingTaskGateway(auth, { apiBase: "http://api.local", fetchImpl: async (path, init) => {
      calls.push({ path: String(path), init });
      if (calls.length === 1) throw new TypeError("connection interrupted");
      return new Response(JSON.stringify(clarification), { headers: { "Content-Type": "application/json" } });
    } });
    const context = { bindingId: "teacher-binding", authorizationSessionId: "teacher-source-session" };
    await expect(gateway.generate(context, input)).rejects.toThrow("connection interrupted");
    expect(await gateway.generate(context, input)).toMatchObject({ status: "needs_clarification" });
    const first = JSON.parse(String(calls[0]!.init!.body)), second = JSON.parse(String(calls[1]!.init!.body));
    expect(first.requestId).toBe(second.requestId);
    expect(new Headers(calls[1]!.init!.headers).get("X-CSRF-Token")).toBe("test-csrf");
    expect(calls[1]!.init!.credentials).toBe("include");
    expect(second).not.toHaveProperty("actorId");
    expect(second).not.toHaveProperty("principalId");
    await gateway.generate(context, input);
    expect(JSON.parse(String(calls[2]!.init!.body)).requestId).not.toBe(first.requestId);
  });

  it("surfaces server authorization errors without manufacturing empty published tasks", async () => {
    const gateway = createHttpTeachingTaskGateway(auth, { fetchImpl: async () => new Response(JSON.stringify({ code: "access_denied", message: "该任务不属于本班" }), { status: 403 }) });
    await expect(gateway.workspace()).rejects.toMatchObject({ status: 403, code: "access_denied", message: "该任务不属于本班" });
  });
});

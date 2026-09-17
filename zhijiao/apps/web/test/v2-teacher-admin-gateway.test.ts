import { describe, expect, it, vi } from "vitest";
import type { DemoAuthContext } from "../src/v2/models";
import {
  createHttpAdminGateway,
  parseAdminTopologyResponse,
} from "../src/v2/admin-gateway";
import {
  createHttpTeacherGateway,
  submitTeacherGateDecision,
  TeacherGateConflictError,
  type TeacherGateway,
} from "../src/v2/teacher-gateway";
import { GatewayHttpError } from "../src/v2/gateway";
import type { TeacherGateDecisionInput } from "../src/v2/teacher-models";
import {
  adminEpisodeFixture,
  agentTopologyManifestFixture,
  teacherEpisodeFixture,
  teacherOutcomeReceiptFixture,
  teacherReviewTasksFixture,
  teacherReviewWorkspaceFixture,
  teacherSessionOverviewFixture,
} from "./v2-teacher-admin.fixture";
import { sessionExperienceDescriptorFixture } from "./v2-student.fixture";
import { completedBusinessOperationReceiptFixture } from "../../../packages/contracts/test/business-operation-receipt.fixture";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authFixture(): DemoAuthContext {
  return {
    profileId: "teacher-class-a",
    principal: {
      principalId: "principal-teacher-a",
      kind: "human",
      displayName: "蟳埔 A 班教师",
      status: "active",
      createdAt: "2026-08-09T01:00:00.000Z",
    },
    bindings: [{
      bindingId: "binding-teacher-a",
      principalId: "principal-teacher-a",
      sessionId: "session-xunpu-a",
      actorId: "teacher-main",
      actorKind: "teacher",
      roleId: "teacher",
      status: "active",
      createdAt: "2026-08-09T01:00:00.000Z",
      expiresAt: "2099-08-09T01:00:00.000Z",
    }],
    csrfToken: "csrf-teacher-a",
    expiresAt: "2099-08-09T01:00:00.000Z",
  };
}

const gateInput: TeacherGateDecisionInput = {
  sessionId: "session-xunpu-a",
  bindingId: "binding-teacher-a",
  gateId: "gate-xunpu-source-conflict",
  expectedTriggerEventId: "event-xunpu-source-conflict",
  expectedStateVersion: 18,
  decision: "approve",
  reason: "已核验公开来源与统计口径。",
};

const teacherOutcomeMethods = {
  getReviewTasks: async () => teacherReviewTasksFixture(),
  getCourseReview: async () => teacherReviewWorkspaceFixture(),
  finalizeReview: async () => teacherOutcomeReceiptFixture(),
};

function topologyRuntimeResponse(): unknown {
  const manifest = agentTopologyManifestFixture();
  return {
    ...manifest,
    agents: manifest.agents.map((agent) => ({
      ...agent,
      runtimeState: "idle",
      latestRun: null,
    })),
  };
}

describe("V2 teacher/admin real gateways", () => {
  it("uses the same strict session descriptor endpoint for teacher and administrator", async () => {
    const descriptor = sessionExperienceDescriptorFixture("flagship_v4", {
      sessionId: "session-xunpu-a",
    });
    const fetchImpl = vi.fn(async () => response({ descriptor }));
    const teacher = createHttpTeacherGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    const administrator = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl,
    });
    await expect(teacher.getSessionExperienceDescriptor(
      descriptor.sessionId,
      "binding-teacher-a",
    )).resolves.toEqual(descriptor);
    await expect(administrator.getSessionExperienceDescriptor(
      descriptor.sessionId,
      "binding-admin-a",
    )).resolves.toEqual(descriptor);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "http://api.local/api/sessions/session-xunpu-a/experience-descriptor?bindingId=binding-teacher-a",
      "http://api.local/api/sessions/session-xunpu-a/experience-descriptor?bindingId=binding-admin-a",
    ]);
  });

  it("posts the frozen teacher gate body with credentials and CSRF only", async () => {
    const fetchImpl = vi.fn(async () => response({
      schemaVersion: "teacher-gate-mutation-receipt/2.0.0",
      accepted: true,
      sessionId: gateInput.sessionId,
      stateVersion: 19,
      gateId: gateInput.gateId,
      decision: gateInput.decision,
    }));
    const gateway = createHttpTeacherGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await gateway.decideGate(gateInput);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://api.local/api/sessions/session-xunpu-a/teacher-gates/gate-xunpu-source-conflict/decisions",
    );
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-teacher-a");
    expect(JSON.parse(String(init?.body))).toEqual({
      bindingId: gateInput.bindingId,
      expectedStateVersion: gateInput.expectedStateVersion,
      decision: gateInput.decision,
      reason: gateInput.reason,
    });
  });

  it("uses only server-signed review tasks and the frozen finalize body", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const responses = [
      { tasks: teacherReviewTasksFixture() },
      { review: teacherReviewWorkspaceFixture() },
      { receipt: teacherOutcomeReceiptFixture() },
    ];
    const gateway = createHttpTeacherGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return response(responses.shift());
      },
    });
    await gateway.getReviewTasks("session-xunpu-001", "binding-teacher-a");
    await gateway.getCourseReview(
      "session-xunpu-001",
      "binding-teacher-a",
      "review-task-xunpu-001",
    );
    await gateway.finalizeReview({
      sessionId: "session-xunpu-001",
      bindingId: "binding-teacher-a",
      reviewTaskId: "review-task-xunpu-001",
      expectedEnrollmentStateVersion: 19,
      requestId: "request-teacher-review-001",
    });
    expect(calls.map(({ input }) => String(input))).toEqual([
      "http://api.local/api/sessions/session-xunpu-001/course-review-tasks?bindingId=binding-teacher-a",
      "http://api.local/api/sessions/session-xunpu-001/course-review?bindingId=binding-teacher-a&reviewTaskId=review-task-xunpu-001",
      "http://api.local/api/sessions/session-xunpu-001/course-reviews",
    ]);
    expect(new Headers(calls[2]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-teacher-a");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      bindingId: "binding-teacher-a",
      reviewTaskId: "review-task-xunpu-001",
      expectedEnrollmentStateVersion: 19,
      requestId: "request-teacher-review-001",
    });
    expect(String(calls[2]?.init?.body)).not.toContain("score");
    expect(String(calls[2]?.init?.body)).not.toContain("learnerRef");
  });

  it("confirms approve after the event wave advances to a new in-progress trigger", async () => {
    const nextEpisode = {
      ...teacherEpisodeFixture(),
      status: "in_progress" as const,
      stateVersion: 24,
      triggerEvent: {
        ...teacherEpisodeFixture().triggerEvent!,
        eventId: "event-xunpu-next-chapter",
        title: "下一章采访任务已激活",
      },
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
    };
    const gateway: TeacherGateway = {
      getSessionOverview: async () => teacherSessionOverviewFixture(),
      getCourses: async () => [],
      getEpisode: async () => nextEpisode,
      ...teacherOutcomeMethods,
      decideGate: async () => undefined,
    };
    await expect(submitTeacherGateDecision(
      gateway,
      gateInput,
      undefined,
      async () => undefined,
    )).resolves.toEqual(nextEpisode);
  });

  it("confirms request-evidence only from the same rejected gate without world writeback", async () => {
    const input = { ...gateInput, decision: "request_evidence" as const };
    const returned = {
      ...teacherEpisodeFixture(),
      stateVersion: 20,
      status: "failed" as const,
      teacherGate: {
        gateId: input.gateId,
        status: "rejected" as const,
        summary: "退回补证：学生需补齐统计口径。",
        reviewedAt: "2026-08-09T02:06:00.000Z",
      },
      authorityWriteback: null,
      failureCode: "teacher_rejected" as const,
    };
    const gateway: TeacherGateway = {
      getSessionOverview: async () => teacherSessionOverviewFixture(),
      getCourses: async () => [],
      getEpisode: async () => returned,
      ...teacherOutcomeMethods,
      decideGate: async () => undefined,
    };
    await expect(submitTeacherGateDecision(
      gateway,
      input,
      undefined,
      async () => undefined,
    )).resolves.toEqual(returned);
  });

  it("refreshes authoritative episode and fails closed on a 409 decision", async () => {
    const latest = { ...teacherEpisodeFixture(), stateVersion: 23 };
    const gateway: TeacherGateway = {
      getSessionOverview: async () => teacherSessionOverviewFixture(),
      getCourses: async () => [],
      getEpisode: async () => latest,
      ...teacherOutcomeMethods,
      decideGate: async () => {
        throw new GatewayHttpError(409, "state moved", "version_conflict");
      },
    };
    const error = await submitTeacherGateDecision(gateway, gateInput)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TeacherGateConflictError);
    expect((error as TeacherGateConflictError).episode).toEqual(latest);
  });

  it("strictly strips only frozen idle runtime fields from topology", () => {
    expect(parseAdminTopologyResponse(topologyRuntimeResponse()))
      .toEqual(agentTopologyManifestFixture());
    const forged = structuredClone(topologyRuntimeResponse()) as {
      agents: Array<Record<string, unknown>>;
    };
    forged.agents[0]!.runtimeState = "running";
    forged.agents[0]!.latestRun = { provider: "forged" };
    expect(() => parseAdminTopologyResponse(forged)).toThrow(
      /真实运行状态必须来自管理员 Episode/u,
    );
  });

  it("reads only real administrator endpoints with included credentials", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe("include");
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/admin/agent-topology")) return response(topologyRuntimeResponse());
      if (url.includes("/collaboration-episode?")) return response(adminEpisodeFixture());
      throw new Error(`unexpected ${url}`);
    });
    const gateway = createHttpAdminGateway({ apiBase: "http://api.local", fetchImpl });
    await gateway.getTopology();
    await gateway.getEpisode("session-xunpu-a", "binding-operator-a");
    expect(calls).toEqual([
      "http://api.local/api/admin/agent-topology",
      "http://api.local/api/sessions/session-xunpu-a/collaboration-episode?bindingId=binding-operator-a",
    ]);
    expect(calls.join(" ")).not.toContain("learning-activity");
    expect(calls.join(" ")).not.toContain("student-training-context");
  });

  it("reads the strict administrator business-operation timeline and rejects payload leakage", async () => {
    const receipt = completedBusinessOperationReceiptFixture();
    const calls: Array<{ url: string; credentials?: RequestCredentials }> = [];
    const gateway = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), credentials: init?.credentials });
        return response({ operations: [receipt] });
      },
    });

    await expect(gateway.getBusinessOperations!(
      "session-xunpu-a",
      "binding-operator-a",
    )).resolves.toEqual([receipt]);
    expect(calls).toEqual([{
      url: "http://api.local/api/v4/admin/sessions/session-xunpu-a/business-operations?bindingId=binding-operator-a",
      credentials: "include",
    }]);

    const forgedGateway = createHttpAdminGateway({
      fetchImpl: async () => response({
        operations: [{ ...receipt, rawPayload: { private: true } }],
      }),
    });
    await expect(forgedGateway.getBusinessOperations!(
      "session-xunpu-a",
      "binding-operator-a",
    )).rejects.toThrow();
  });

});

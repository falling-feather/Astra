import { describe, expect, it } from "vitest";
import {
  CollaborationStrategyService,
  InMemoryCollaborationStrategyStore,
  computeCollaborationStrategyContentHash,
} from "../src/collaboration-strategy-store.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";

const teacher = {
  actorId: "teacher-main",
  actorKind: "teacher",
} as const;
const student = {
  actorId: "student-editor",
  actorKind: "student",
} as const;
const now = "2026-07-30T16:30:00.000Z";

function service(store = new InMemoryCollaborationStrategyStore()) {
  return new CollaborationStrategyService(store, { now: () => now });
}

describe("CollaborationStrategyService", () => {
  it("creates an immutable draft with a stable normalized content hash", async () => {
    const first = collaborationStrategyContent({
      basisRefs: [
        {
          refType: "evidence",
          refId: "evidence:a",
          version: "revision",
        },
        {
          refType: "evidence",
          refId: "evidence",
          version: "a:revision",
        },
      ],
    });
    const second = collaborationStrategyContent({
      agentSet: [...first.agentSet].reverse(),
      permissions: [...first.permissions].reverse().map((permission) => ({
        ...permission,
        visibleScopes: [...permission.visibleScopes].reverse(),
        capabilities: [...permission.capabilities].reverse(),
      })),
      basisRefs: [...first.basisRefs].reverse(),
      evidenceRefs: [...first.evidenceRefs].reverse(),
      consequenceRefs: [...first.consequenceRefs].reverse(),
    });
    expect(computeCollaborationStrategyContentHash(first))
      .toBe(computeCollaborationStrategyContentHash(second));

    const created = await service().createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: second,
    }, teacher);
    expect(created).toMatchObject({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      createdBy: "teacher-main",
      governance: {
        status: "draft",
        revision: 0,
        latestReview: null,
      },
    });
    expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created.content.agentSet).toEqual([
      "agent-evidence-coach",
      "agent-material-understanding",
    ]);
  });

  it("allows only a teacher actor to create or govern a strategy", async () => {
    const target = service();
    await expect(target.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, student)).rejects.toMatchObject({
      code: "permission_denied",
    });

    const created = await target.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    await expect(target.transitionGovernance(
      created.strategyId,
      created.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: created.contentHash,
        action: "approve",
        reason: "确认该暴雨协作策略可复用。",
      },
      student,
    )).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  it("preserves content while applying legal governance and rejects rollback", async () => {
    const target = service();
    const draft = await target.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    const approved = await target.transitionGovernance(
      draft.strategyId,
      draft.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: draft.contentHash,
        action: "approve",
        reason: "教师核对依据、权限和学生选择后批准。",
      },
      teacher,
    );
    const disabled = await target.transitionGovernance(
      approved.strategyId,
      approved.version,
      {
        expectedStatus: "approved",
        expectedGovernanceRevision: 1,
        expectedContentHash: approved.contentHash,
        action: "disable",
        reason: "暂时停止后续复用。",
      },
      teacher,
    );
    const reapproved = await target.transitionGovernance(
      disabled.strategyId,
      disabled.version,
      {
        expectedStatus: "disabled",
        expectedGovernanceRevision: 2,
        expectedContentHash: disabled.contentHash,
        action: "approve",
        reason: "重新核验后恢复使用。",
      },
      teacher,
    );
    const retired = await target.transitionGovernance(
      reapproved.strategyId,
      reapproved.version,
      {
        expectedStatus: "approved",
        expectedGovernanceRevision: 3,
        expectedContentHash: reapproved.contentHash,
        action: "retire",
        reason: "该策略版本永久退出复用。",
      },
      teacher,
    );

    expect([
      approved.contentHash,
      disabled.contentHash,
      reapproved.contentHash,
      retired.contentHash,
    ]).toEqual(Array(4).fill(draft.contentHash));
    expect(retired.governance).toMatchObject({
      status: "retired",
      revision: 4,
      latestReview: {
        action: "retire",
        teacherActorId: "teacher-main",
      },
    });
    await expect(target.transitionGovernance(
      retired.strategyId,
      retired.version,
      {
        expectedStatus: "retired",
        expectedGovernanceRevision: 4,
        expectedContentHash: retired.contentHash,
        action: "approve",
        reason: "非法恢复已淘汰版本。",
      },
      teacher,
    )).rejects.toMatchObject({
      code: "invalid_governance_transition",
    });
  });

  it("fails closed on version gaps, unresolved drafts, duplicate approved versions and hash drift", async () => {
    const target = service();
    await expect(target.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 2,
      content: collaborationStrategyContent(),
    }, teacher)).rejects.toMatchObject({
      code: "version_drift",
    });

    const first = await target.createDraft({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    await expect(target.createDraft({
      strategyId: first.strategyId,
      version: 2,
      content: collaborationStrategyContent(),
    }, teacher)).rejects.toMatchObject({
      code: "unresolved_draft",
    });
    const approved = await target.transitionGovernance(
      first.strategyId,
      first.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: first.contentHash,
        action: "approve",
        reason: "批准第一版。",
      },
      teacher,
    );
    await expect(target.transitionGovernance(
      approved.strategyId,
      approved.version,
      {
        expectedStatus: "approved",
        expectedGovernanceRevision: 1,
        expectedContentHash: "0".repeat(64),
        action: "disable",
        reason: "陈旧哈希不得改变状态。",
      },
      teacher,
    )).rejects.toMatchObject({
      code: "content_hash_conflict",
    });

    const second = await target.createDraft({
      strategyId: first.strategyId,
      version: 2,
      content: collaborationStrategyContent({
        recommendationSummary: "第二版保持相同边界但更新教师建议摘要。",
      }),
    }, teacher);
    await expect(target.transitionGovernance(
      second.strategyId,
      second.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: second.contentHash,
        action: "approve",
        reason: "不能同时批准两个版本。",
      },
      teacher,
    )).rejects.toMatchObject({
      code: "approved_version_conflict",
    });

    await expect(target.createDraft({
      strategyId: first.strategyId,
      version: 1,
      content: collaborationStrategyContent({
        recommendationSummary: "尝试原地改写已批准版本。",
      }),
    }, teacher)).rejects.toMatchObject({
      code: "immutable_version",
    });
  });

  it("allows only one approved strategy across the frozen trigger event", async () => {
    const target = service();
    const first = await target.createDraft({
      strategyId: "strategy-rain-collaboration-primary",
      version: 1,
      content: collaborationStrategyContent(),
    }, teacher);
    await target.transitionGovernance(
      first.strategyId,
      first.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: first.contentHash,
        action: "approve",
        reason: "批准旗舰暴雨事件的主策略。",
      },
      teacher,
    );

    const competing = await target.createDraft({
      strategyId: "strategy-rain-collaboration-competing",
      version: 1,
      content: collaborationStrategyContent({
        recommendationSummary: "同一触发事件的竞争策略。",
      }),
    }, teacher);
    await expect(target.transitionGovernance(
      competing.strategyId,
      competing.version,
      {
        expectedStatus: "draft",
        expectedGovernanceRevision: 0,
        expectedContentHash: competing.contentHash,
        action: "approve",
        reason: "不得绕过全局唯一批准约束。",
      },
      teacher,
    )).rejects.toMatchObject({
      code: "approved_version_conflict",
      details: {
        triggerEventId: "flagship-event-rain-escalation",
      },
    });
  });
});

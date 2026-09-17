import { createHash } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DialogueTurnRequestV4SchemaVersion,
  FlagshipContentReferenceV4SchemaVersion,
  type DialogueEpisodeV4,
  type DialogueTurnRequestV4,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import {
  xunpuFlagshipContentV4,
} from "@ronggang/course-content";
import { afterEach, describe, expect, it } from "vitest";
import {
  DialogueClosedError,
  DialogueAudienceMismatchError,
  DialogueDefinitionDriftError,
  DialogueEpisodeEngineV4,
  DialogueIdempotencyConflictError,
  DialogueRevisionConflictError,
  DialogueWorldStateConflictError,
  InMemoryDialogueEpisodeStoreV4,
  JsonFileDialogueEpisodeStoreV4,
  classifyDialogueIntentV4,
  matchDialogueSignalsV4,
  type DialogueEpisodeStoreV4,
  type DialogueRuleSelectorV4,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
const learnerSubjectHash = "d".repeat(64);
const flagshipContentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: xunpuFlagshipContentV4.courseId,
    releaseId: "course-xunpu-r4",
    version: 4,
    contentHash: "a".repeat(64),
  },
  scenarioReleaseRef: {
    scenarioId: xunpuFlagshipContentV4.scenarioId,
    version: "4.0.0",
    contentHash: "b".repeat(64),
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-xunpu-r4",
    version: 4,
    contentHash: "c".repeat(64),
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function engine(
  store: DialogueEpisodeStoreV4 = new InMemoryDialogueEpisodeStoreV4(),
  selector?: DialogueRuleSelectorV4,
  selectorTimeoutMs?: number,
) {
  return new DialogueEpisodeEngineV4({
    store,
    definitions: xunpuFlagshipContentV4.dialogueScenes,
    npcDisplayNames: Object.fromEntries(xunpuFlagshipContentV4.cast.map((npc) => (
      [npc.entityId, npc.displayName]
    ))),
    ...(selector ? { selector } : {}),
    ...(selectorTimeoutMs === undefined ? {} : { selectorTimeoutMs }),
  });
}

async function begin(
  runtime: DialogueEpisodeEngineV4,
  npcRef: string,
  sessionId = `session-${npcRef}`,
) {
  return runtime.beginDialogue({
    requestId: `start-${npcRef}`,
    sessionId,
    learnerSubjectHash,
    studentActorRef: "actor-student-reporter",
    studentBindingRef: "binding-student-xunpu",
    npcRef,
    flagshipContentRef,
    openingStudentUtterance: "您好，我是学生记者，想先说明采访用途和公共区域边界。",
    sourceWorldStateVersion: 8,
    virtualMinute: 4,
    challengeLevel: 5,
    submittedAt: "2026-09-01T08:00:00.000Z",
  });
}

function turnRequest(
  episode: DialogueEpisodeV4,
  sequence: number,
  utterance: string,
  overrides: Partial<DialogueTurnRequestV4> = {},
): DialogueTurnRequestV4 {
  return {
    schemaVersion: DialogueTurnRequestV4SchemaVersion,
    requestId: `turn-request-${episode.episodeId}-${sequence}`,
    sessionId: episode.sessionId,
    bindingId: "binding-student-xunpu",
    episodeId: episode.episodeId,
    expectedEpisodeRevision: episode.revision,
    expectedWorldStateVersion: 8,
    turnToken: `dialogueturn_${"x".repeat(48)}`,
    utterance,
    submittedAt: `2026-09-01T08:0${sequence}:00.000Z`,
    ...overrides,
  };
}

async function say(
  runtime: DialogueEpisodeEngineV4,
  episode: DialogueEpisodeV4,
  sequence: number,
  utterance: string,
) {
  return runtime.submitTurn({
    request: turnRequest(episode, sequence, utterance),
    learnerSubjectHash,
    actualWorldStateVersion: 8,
    actualVirtualMinute: 4 + sequence,
  });
}

async function commit(
  runtime: DialogueEpisodeEngineV4,
  episode: DialogueEpisodeV4,
) {
  if (!episode.pendingResolution) throw new Error("fixture must be pending");
  return runtime.commitResolution({
    episodeId: episode.episodeId,
    expectedRevision: episode.revision,
    worldRequestId: episode.pendingResolution.worldRequestId,
    worldEventRef: `world-event-${episode.episodeId}`,
    resultingWorldStateVersion: 9,
    consequenceRef: `consequence-${episode.episodeId}`,
    committedAt: "2026-09-01T08:05:00.000Z",
  });
}

describe("自然语言对话意图范围", () => {
  it.each([
    ["我想结束对话，先离开。", "exit_conversation"],
    ["我不想结束对话，我还要继续追问来源。", "request_evidence"],
    ["资料里写着‘结束对话’，但我想继续确认来源。", "request_evidence"],
    ["我先说明身份和报道用途，再问能否采访。", "introduce_scope"],
    ["我不想说明身份。", "set_boundary"],
    ["我不谈来源。", "set_boundary"],
    ["我不想交换素材，也不谈合作。", "set_boundary"],
    ["抱歉，我收回刚才的越界请求。", "repair_breach"],
    ["我不需要道歉，我会继续核对来源。", "request_evidence"],
    ["资料里提到‘抱歉’只是例子，我会继续确认来源。", "request_evidence"],
    ["资料里提到‘我接受’只是错误示例，我不接受这个条件。", "set_boundary"],
    ["我接受这个采访条件。", "accept_condition"],
    ["你的意思是只在公共区域采访，对吗？", "reflect_back"],
    ["我不复述这句话，我会先核对来源。", "request_evidence"],
    ["资料里提到‘怎么看’只是例子，我不提开放问题。", "set_boundary"],
    ["我想问问你的看法。", "ask_open_question"],
    ["假设有人说抱歉，我会继续核对来源。", "request_evidence"],
  ] as const)("只把学生实际表达作为意图：%s", (utterance, expectedIntent) => {
    expect(classifyDialogueIntentV4(utterance)).toBe(expectedIntent);
  });

  it("对话信号不把引用或拒绝的违规词当作学生实际方案", () => {
    const definition = xunpuFlagshipContentV4.dialogueScenes.find(
      (candidate) => candidate.npcRef === "entity-gatekeeper",
    )!;
    const forceSignal = "signal-gatekeeper-force";
    expect(matchDialogueSignalsV4(
      definition,
      "资料里提到‘装游客’是违规说法，我会先说明身份。",
    )).not.toContain(forceSignal);
    expect(matchDialogueSignalsV4(
      definition,
      "假设有人装游客，我会拒绝并报告。",
    )).not.toContain(forceSignal);
    expect(matchDialogueSignalsV4(
      definition,
      "如果我装游客，我就进去。",
    )).toContain(forceSignal);
  });
});

describe("DialogueEpisodeEngineV4", () => {
  it.each([
    {
      label: "门卫协助联系人",
      npcRef: "entity-gatekeeper",
      first: "我是参加课程实训的学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
      second: "请帮我联系一位愿意受访的居民，我会再次征得同意。",
      route: "dialogue-route-assisted-contact",
    },
    {
      label: "门卫公共边缘观察",
      npcRef: "entity-gatekeeper",
      first: "我是参加课程实训的学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
      second: "我选择只在公共区域院落外沿观察，不拍门牌。",
      route: "dialogue-route-public-edge",
    },
    {
      label: "门卫无记录背景沟通",
      npcRef: "entity-gatekeeper",
      first: "我是参加课程实训的学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
      second: "我先做背景了解，不录音不拍摄；公开信息会另找本人采访或登记来源确认。",
      route: "dialogue-route-background-briefing",
    },
    {
      label: "传承人技艺观察",
      npcRef: "entity-inheritor",
      first: "能否讲讲你的个人实践？我关注日常劳动和文化主体，不代表整个社区；观察和引语之外的事实我会另查来源。",
      second: "我选择观察演示和手部技艺过程，只记录步骤，其他结论标明来源限定。",
      route: "dialogue-route-process-observation",
    },
    {
      label: "传承人经验深访",
      npcRef: "entity-inheritor",
      first: "能否讲讲你的个人实践？我关注日常劳动和文化主体，不代表整个社区；观察和引语之外的事实我会另查来源。",
      second: "我想听你讲述个人经历和日常变化，我会复述并确认引语，不代表整个社区。",
      route: "dialogue-route-context-interview",
    },
    {
      label: "传承人术语核对",
      npcRef: "entity-inheritor",
      first: "能否讲讲你的个人实践？我关注日常劳动和文化主体，不代表整个社区；观察和引语之外的事实我会另查来源。",
      second: "我选择做术语核对，请逐项核对步骤名称和标准定位；个人经验不代表整个社区。",
      route: "dialogue-route-terminology-check",
    },
    {
      label: "商户有限素材许可",
      npcRef: "entity-shopkeeper",
      first: "报道判断和标题独立，不用素材换标题。请说明作者、授权平台、期限和用途，并公开披露素材提供方。",
      second: "我选择使用原片，按有限授权登记作者、平台、期限和用途，并标注来源。",
      route: "dialogue-route-limited-material-license",
    },
    {
      label: "商户拒绝商业素材",
      npcRef: "entity-shopkeeper",
      first: "报道判断和标题独立，不用素材换标题。请说明作者、授权平台、期限和用途，并公开披露素材提供方。",
      second: "我选择不使用素材，自行拍摄；标题独立，只做标明商业立场的采访。",
      route: "dialogue-route-decline-commercial-assets",
    },
    {
      label: "商户样片仅作拍摄线索",
      npcRef: "entity-shopkeeper",
      first: "报道判断和标题独立，不用素材换标题。请说明作者、授权平台、期限和用途，并公开披露素材提供方。",
      second: "我只核对线索，仅现场查看，不复制原片也不导出文件；标题继续保持编辑独立。",
      route: "dialogue-route-reference-only",
    },
  ])("以多轮行为完成 $label，并产生待提交的权威世界事件", async (path) => {
    const runtime = engine();
    const started = await begin(runtime, path.npcRef, `session-${path.route}`);
    const clarified = await say(runtime, started, 1, path.first);
    expect(clarified.status).toBe("active");
    expect(clarified.issues.every((issue) => issue.status === "satisfied"))
      .toBe(true);

    const pending = await say(runtime, clarified, 2, path.second);
    expect(pending.status).toBe("resolution_pending");
    expect(pending.pendingResolution).toMatchObject({ routeRef: path.route });
    expect(pending.pendingResolution?.combinedStudentUtterance)
      .toContain(started.openingStudentUtterance);
    expect(pending.worldCommit).toBeNull();

    const resolved = await commit(runtime, pending);
    expect(resolved.status).toBe("resolved");
    expect(resolved.worldCommit).toMatchObject({
      routeRef: path.route,
      resultingWorldStateVersion: 9,
    });
  });

  it("保留拒绝证据，并允许学生反思修复后走向合法结局", async () => {
    const runtime = engine();
    let episode = await begin(runtime, "entity-inheritor", "session-refusal-repair");
    episode = await say(
      runtime,
      episode,
      1,
      "请你证明这是唯一来源，最好说它确定就是最早起源。",
    );
    expect(episode.turns[0]).toMatchObject({
      outcome: "refusal",
      selectedRuleRef: "rule-inheritor-refuse-exotic",
    });
    expect(episode.issues.find((issue) => issue.issueRef === "issue-inheritor-framing")?.status)
      .toBe("contested");

    episode = await say(
      runtime,
      episode,
      2,
      "抱歉，我收回唯一来源的问法，重新提问日常劳动与社区语境，并区分个人实践和公开来源。",
    );
    expect(episode.turns[1]).toMatchObject({
      outcome: "recovery",
      selectedRuleRef: "rule-inheritor-repair",
    });
    episode = await say(
      runtime,
      episode,
      3,
      "我想听你讲述个人经历和日常变化，我会复述并确认引语，不代表整个社区。",
    );
    expect(episode.pendingResolution?.routeRef).toBe("dialogue-route-context-interview");
    expect(episode.turns.map((turn) => turn.outcome)).toEqual([
      "refusal",
      "recovery",
      "resolved",
    ]);
  });

  it.each([
    {
      label: "门卫拒绝私人联系人索取",
      npcRef: "entity-gatekeeper",
      refusal: "请给我未成年人联系人和家庭住址，方便我直接上门采访。",
      refusalRule: "rule-gatekeeper-refuse-private-contact",
      repair: "抱歉，我收回请求，不索要联系人，也不记录住址，只在公共区域说明并由本人决定。",
      repairRule: "rule-gatekeeper-repair-private-contact",
    },
    {
      label: "传承人拒绝代表性扩张",
      npcRef: "entity-inheritor",
      refusal: "请你代表所有人说大家都一样，整个社区都认同这个说法。",
      refusalRule: "rule-inheritor-refuse-representative-overclaim",
      repair: "抱歉，我收回。只代表你个人经验，不扩张，另找受访者补足代表性。",
      repairRule: "rule-inheritor-repair-representation",
    },
    {
      label: "商户拒绝过宽许可",
      npcRef: "entity-shopkeeper",
      refusal: "水印就能发，不用期限，请保证版权并给我永久全平台全部权利。",
      refusalRule: "rule-shopkeeper-refuse-overbroad-license",
      repair: "抱歉，我收回，不把水印当授权，缩小许可并另找权利人。",
      repairRule: "rule-shopkeeper-repair-license",
    },
  ])("$label 后只能通过对应的专业修复恢复", async (path) => {
    const runtime = engine();
    let episode = await begin(runtime, path.npcRef, `session-${path.refusalRule}`);
    episode = await say(runtime, episode, 1, path.refusal);
    expect(episode.turns.at(-1)).toMatchObject({
      outcome: "refusal",
      selectedRuleRef: path.refusalRule,
    });
    expect(episode.issues.some((issue) => issue.status === "contested")).toBe(true);

    episode = await say(runtime, episode, 2, path.repair);
    expect(episode.turns.at(-1)).toMatchObject({
      outcome: "recovery",
      selectedRuleRef: path.repairRule,
    });
    expect(episode.status).toBe("active");
    expect(episode.issues.every((issue) => issue.status === "satisfied"))
      .toBe(true);
  });

  it("只允许模型在服务端候选规则内选择，越界输出确定性降级", async () => {
    const observedInputs: unknown[] = [];
    const runtime = engine(undefined, {
      async select(input) {
        observedInputs.push(input);
        return {
          selectedRuleRef: "rule-forged-private-write",
          modelRunRef: "model-run-forged",
          costMicros: 12,
        };
      },
    });
    const started = await begin(runtime, "entity-gatekeeper", "session-model-boundary");
    const next = await say(
      runtime,
      started,
      1,
      "我是课程实训的学生记者，来采访社区。我会征得同意，不拍门牌并允许撤回。",
    );
    expect(next.turns[0]?.selectedRuleRef).toBe("rule-gatekeeper-establish-scope");
    expect(next.runtimeReceipts[0]).toMatchObject({
      decisionMode: "deterministic_fallback",
      failureCode: "model_invalid_rule",
      modelRunRef: null,
    });
    const serialized = JSON.stringify(observedInputs[0]);
    expect(serialized).not.toContain("privateBoundaryHash");
    expect(serialized).not.toContain("近期有游客");
    expect(serialized).not.toContain("rule-forged-private-write");
  });

  it("模型超时不阻塞岗位世界，且不会伪装为 Live", async () => {
    const runtime = engine(undefined, {
      async select() {
        return new Promise(() => undefined);
      },
    }, 5);
    const started = await begin(runtime, "entity-gatekeeper", "session-model-timeout");
    const next = await say(
      runtime,
      started,
      1,
      "我是课程实训的学生记者，来采访社区。我会征得同意，不拍门牌并允许撤回。",
    );
    expect(next.runtimeReceipts[0]).toMatchObject({
      decisionMode: "deterministic_fallback",
      failureCode: "model_timeout",
      modelRunRef: null,
    });
  });

  it("学生、教师和管理员获得严格分层的同一因果事实", async () => {
    const runtime = engine();
    const started = await begin(runtime, "entity-gatekeeper", "session-role-views");
    const active = await say(
      runtime,
      started,
      1,
      "我是课程实训的学生记者，来采访社区。我会征得同意，不拍门牌并允许撤回。",
    );
    const student = runtime.project(active, "student");
    const teacher = runtime.project(active, "teacher");
    const admin = runtime.project(active, "admin");
    expect("causalSummary" in student).toBe(false);
    expect("runtime" in student).toBe(false);
    expect("runtime" in teacher).toBe(false);
    expect(teacher.audience).toBe("teacher");
    expect(admin.audience).toBe("admin");
    expect(student.openingStudentUtterance).toBe(started.openingStudentUtterance);
    if (admin.audience !== "admin") throw new Error("unexpected audience");
    expect(admin.runtime.receipts).toHaveLength(1);
    expect(JSON.stringify(student)).not.toContain(learnerSubjectHash);
    expect(JSON.stringify(teacher)).not.toContain(learnerSubjectHash);
    expect(JSON.stringify(teacher)).not.toContain("selectedRuleRef");
  });

  it("同请求同载荷安全重放，不同载荷、旧修订和世界漂移均失败关闭", async () => {
    const runtime = engine();
    const started = await begin(runtime, "entity-gatekeeper", "session-conflicts");
    const request = turnRequest(
      started,
      1,
      "我是课程实训的学生记者，来采访社区。我会征得同意，不拍门牌并允许撤回。",
    );
    const once = await runtime.submitTurn({
      request,
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 5,
    });
    const replay = await runtime.submitTurn({
      request,
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 5,
    });
    expect(replay).toEqual(once);

    await expect(runtime.submitTurn({
      request: { ...request, utterance: "相同 requestId 的不同内容" },
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 5,
    })).rejects.toBeInstanceOf(DialogueIdempotencyConflictError);
    await expect(runtime.submitTurn({
      request: turnRequest(once, 2, "继续", { expectedEpisodeRevision: 0 }),
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 6,
    })).rejects.toBeInstanceOf(DialogueRevisionConflictError);

    await expect(runtime.submitTurn({
      request: turnRequest(once, 3, "继续", { expectedWorldStateVersion: 9 }),
      learnerSubjectHash,
      actualWorldStateVersion: 9,
      actualVirtualMinute: 6,
    })).rejects.toBeInstanceOf(DialogueWorldStateConflictError);
    expect((await runtime.loadEpisode(once.episodeId))?.status).toBe("stale");
  });

  it("达到对话窗口后写入 expired 终态而不是继续生成回复", async () => {
    const runtime = engine();
    const started = await begin(runtime, "entity-gatekeeper", "session-expired");
    await expect(runtime.submitTurn({
      request: turnRequest(started, 1, "我再想想"),
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: started.expiresAtVirtualMinute,
    })).rejects.toBeInstanceOf(DialogueClosedError);
    expect((await runtime.loadEpisode(started.episodeId))?.status).toBe("expired");
  });

  it("把每轮岗位耗时计入高压响应窗口，并绑定学生 membership", async () => {
    const runtime = engine();
    let episode = await runtime.beginDialogue({
      requestId: "start-pressure-window",
      sessionId: "session-pressure-window",
      learnerSubjectHash,
      studentActorRef: "actor-student-reporter",
      studentBindingRef: "binding-student-xunpu",
      npcRef: "entity-gatekeeper",
      flagshipContentRef,
      openingStudentUtterance: "您好，我是学生记者，想先说明采访用途和公共区域边界。",
      sourceWorldStateVersion: 8,
      virtualMinute: 4,
      challengeLevel: 7,
      submittedAt: "2026-09-01T00:00:00.000Z",
    });
    await expect(runtime.submitTurn({
      request: {
        ...turnRequest(episode, 1, "我先观察一下再说明"),
        bindingId: "binding-forged-student",
      },
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 4,
    })).rejects.toBeInstanceOf(DialogueAudienceMismatchError);

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      episode = await runtime.submitTurn({
        request: turnRequest(episode, sequence, "我先观察一下再具体说明"),
        learnerSubjectHash,
        actualWorldStateVersion: 8,
        actualVirtualMinute: 4,
      });
    }
    expect(episode.elapsedDialogueMinutes).toBe(8);
    await expect(runtime.submitTurn({
      request: turnRequest(episode, 5, "我继续说明"),
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 4,
    })).rejects.toBeInstanceOf(DialogueClosedError);
    expect((await runtime.loadEpisode(episode.episodeId))?.status).toBe("expired");
  });

  it("定义哈希漂移时拒绝用新人物规则解释旧 Episode", async () => {
    const store = new InMemoryDialogueEpisodeStoreV4();
    const first = engine(store);
    const episode = await begin(first, "entity-gatekeeper", "session-dialogue-drift");
    const driftedDefinitions = structuredClone(xunpuFlagshipContentV4.dialogueScenes);
    driftedDefinitions[0]!.definitionHash = "e".repeat(64);
    const second = new DialogueEpisodeEngineV4({
      store,
      definitions: driftedDefinitions,
      npcDisplayNames: Object.fromEntries(
        xunpuFlagshipContentV4.cast.map((npc) => [npc.entityId, npc.displayName]),
      ),
    });
    await expect(second.loadEpisode(episode.episodeId))
      .rejects.toBeInstanceOf(DialogueDefinitionDriftError);
  });

  it("原子文件存储支持进程重启后恢复待结算回合", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-dialogue-v4-"));
    temporaryDirectories.push(directory);
    const first = engine(new JsonFileDialogueEpisodeStoreV4(directory));
    let episode = await begin(first, "entity-shopkeeper", "session-dialogue-restart");
    episode = await say(
      first,
      episode,
      1,
      "报道判断和标题独立，不用素材换标题。请说明作者、授权平台、期限和用途，并公开披露素材提供方。",
    );
    episode = await say(
      first,
      episode,
      2,
      "我选择使用原片，按有限授权登记作者、平台、期限和用途，并标注来源。",
    );
    expect(episode.status).toBe("resolution_pending");

    const second = engine(new JsonFileDialogueEpisodeStoreV4(directory));
    const recovered = await second.getCurrentEpisode(
      "session-dialogue-restart",
      learnerSubjectHash,
    );
    expect(recovered).toEqual(episode);
    expect(await second.listPendingEpisodes()).toEqual([episode]);
    const resolved = await commit(second, recovered!);
    expect(resolved.status).toBe("resolved");
  });

  it("清理崩溃遗留的旧文件锁后继续 CAS，不丢失 Episode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-dialogue-lock-v4-"));
    temporaryDirectories.push(directory);
    const store = new JsonFileDialogueEpisodeStoreV4(directory);
    const first = engine(store);
    const episode = await begin(first, "entity-gatekeeper", "session-stale-lock");
    const fileHash = createHash("sha256").update(episode.episodeId).digest("hex");
    const staleLock = join(directory, `${fileHash}.json.lock`);
    await writeFile(staleLock, "interrupted-before-metadata", "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(staleLock, staleTime, staleTime);

    const second = engine(new JsonFileDialogueEpisodeStoreV4(directory));
    const next = await second.submitTurn({
      request: turnRequest(episode, 1, "我先观察一下再具体说明"),
      learnerSubjectHash,
      actualWorldStateVersion: 8,
      actualVirtualMinute: 4,
    });
    expect(next.revision).toBe(1);
    expect((await second.loadEpisode(episode.episodeId))?.turnCount).toBe(1);
  });
});

import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Eye,
  Files,
  LoaderCircle,
  MapPin,
  MessageCircleMore,
  NotebookPen,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  StudentAgentCollaborationEpisodeV3,
  StudentWorkAction,
} from "@ronggang/contracts";
import { useExperienceGateway } from "../gateway";
import type {
  FlagshipAvailableAction,
  FlagshipWorkspaceArtifact,
  FlagshipWorkspaceView,
  FlagshipWorldView,
} from "../world-v3";
import { FlagshipWorkbenchV3 } from "./flagship-workbench-v3";
import StudentFlagshipWorldV4Page from "./student-flagship-world-v4";
import "./student-flagship-world.css";

interface StudentFlagshipWorldPageProps {
  sessionId: string;
  reporterBindingId: string;
  navigate(path: string): void;
}

interface FlagshipSnapshot {
  world: FlagshipWorldView;
  episode: StudentAgentCollaborationEpisodeV3;
  workspace: FlagshipWorkspaceView;
}

type FlagshipLoad =
  | { state: "loading" }
  | { state: "ready"; snapshot: FlagshipSnapshot }
  | { state: "error"; message: string };

const actionExperience: Record<string, {
  shortLabel: string;
  prompt: string;
  reflection: string;
}> = {
  "event-template-gatekeeper": {
    shortLabel: "说明采访来意",
    prompt: "您好，我是融媒体学生记者。我们只在公共区域采访，不进入私人住宅；我想先了解哪些对象适合公开采访。",
    reflection: "先说明职业身份、采访目的和不进入私人空间的边界，再争取现场准入。",
  },
  "event-template-inheritor": {
    shortLabel: "采访传承人",
    prompt: "黄老师，我不想只把簪花围当作好看的视觉符号。您认为报道必须让观众理解的文化语境是什么？",
    reflection: "把传承人作为文化主体提问，避免猎奇化和符号化叙事。",
  },
  "event-template-source-check": {
    shortLabel: "核验年份材料",
    prompt: "两份材料对关键年份说法不同：哪一份是原始出处？是否能与协会档案和传承人口述相互印证？",
    reflection: "不急于写成确定事实，先识别转引链并寻找两个独立来源。",
  },
  "event-template-publication": {
    shortLabel: "进入成稿工作台",
    prompt: "整理现场采访、来源核验、肖像授权和商业边界，形成可审核的融媒体报道成稿。",
    reflection: "公开发布不可逆，成稿必须同时具备事实依据、授权记录和更正入口。",
  },
  "event-template-community-source": {
    shortLabel: "协商公开边界",
    prompt: "阿环您好，我会说明报道用途，并尊重匿名、删题和撤回。哪些内容可以公开，哪些家庭与私人信息必须排除？",
    reflection: "在追问内容前先建立知情、匿名、删题与撤回边界。",
  },
  "event-template-researcher-probe": {
    shortLabel: "追问研究者",
    prompt: "陈老师，请帮我区分国家级名录、地方标准、口述材料和网络起源说法各自能证明到哪一步。",
    reflection: "把来源层级和事实置信度分开，不把文化传说写成唯一确定起源。",
  },
  "event-template-official-request": {
    shortLabel: "请求带时点数据",
    prompt: "蔡主任，请确认当前能够公开的统计值、统计时点、口径，以及下一次正式更新时间。",
    reflection: "旧公开值必须带时点，未完成汇总只能写状态和下一更新时间。",
  },
  "event-template-compare-sources": {
    shortLabel: "并列比对来源",
    prompt: "请将国务院名录、泉州地方标准与网络转引逐项并列，标出发布主体、年份和原始定位。",
    reflection: "回到原始发布机关和文件定位，避免把互相转引当作独立信源。",
  },
  "event-template-rights-inspection": {
    shortLabel: "核对素材权利",
    prompt: "许老师，请逐项确认素材作者、肖像主体、用途、期限、平台和是否允许二次剪辑；缺口请给出替换方案。",
    reflection: "把作者权、肖像同意和具体使用许可拆开记录。",
  },
  "event-template-verification-wait": {
    shortLabel: "等待必要核验",
    prompt: "我选择用十分钟等待原始来源或授权确认；期间先整理已确认事实、标注未知项，并在到时后决定限定发布或继续暂缓。",
    reflection: "等待必须有对象、时限、停止条件和并行任务，不能把停滞包装成审慎。",
  },
};

const endingExperience: Record<string, {
  title: string;
  summary: string;
  reflection: string;
  tone: "trusted" | "prudent" | "backlash" | "governance";
}> = {
  "ending-trusted-collaboration": {
    title: "可信合作",
    summary: "事实、文化主体、素材权利与未知项形成了可追溯闭环，报道在教师门后可信发布。",
    reflection: "回看哪些真实行动共同维护了准确、关系与公共信任。",
    tone: "trusted",
  },
  "ending-prudent-delay": {
    title: "审慎延误",
    summary: "你保住了必要核验与关系边界，但主动错过第一发布窗口；这不是自动低分，而是一项需要解释的职业取舍。",
    reflection: "复盘哪些等待合理，哪些核验本可前置或并行。",
    tone: "prudent",
  },
  "ending-traffic-backlash": {
    title: "流量反噬",
    summary: "作品获得短期触达，却因证据、文化主体或编辑独立性债务遭到质疑与退回。",
    reflection: "找到最早出现的风险信号，并设计一条可公开追溯的恢复路径。",
    tone: "backlash",
  },
  "ending-governance-failure": {
    title: "治理失败",
    summary: "权利、平台或公共安全风险越过红线，作品被阻断；失败行为与教师门决定都保留在证据链中。",
    reflection: "指出哪一个更早行动本可避免投诉、阻断或撤稿。",
    tone: "governance",
  },
};

const npcVisuals = [
  {
    entityId: "entity-gatekeeper",
    image: "/assets/flagship-world/npc-gatekeeper-lin-v1.webp",
    fallback: "林",
    position: "gatekeeper",
  },
  {
    entityId: "entity-inheritor",
    image: "/assets/flagship-world/npc-inheritor-huang-v1.webp",
    fallback: "黄",
    position: "inheritor",
  },
  {
    entityId: "entity-shopkeeper",
    image: "/assets/flagship-world/npc-shopkeeper-wu-v1.webp",
    fallback: "吴",
    position: "shopkeeper",
  },
] as const;

const eventEntity: Record<string, string> = {
  student_asks_gatekeeper: "entity-gatekeeper",
  student_asks_inheritor: "entity-inheritor",
  student_inspects_source: "entity-inheritor",
  shopkeeper_requests_placement: "entity-shopkeeper",
  tourist_withdraws_consent: "entity-tourist",
  system_clock_tick: "entity-editor",
  student_submits_story: "entity-platform",
  student_asks_community_source: "entity-community-source",
  student_probes_researcher: "entity-researcher",
  student_requests_official_data: "entity-public-liaison",
  student_compares_sources: "entity-researcher",
  student_inspects_rights: "entity-rights-contact",
  student_waits_for_verification: "entity-editor",
};

const decisionLabels = {
  accept: "采纳并执行",
  request_evidence: "要求补充依据",
  reject: "拒绝，自己处理",
} as const;

function uniqueClientRef(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function useFlagshipSnapshot(
  sessionId: string,
  bindingId: string,
  revision: number,
): [FlagshipLoad, (snapshot: FlagshipSnapshot) => void] {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<FlagshipLoad>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    if (!gateway.getFlagshipWorld
      || !gateway.getFlagshipEpisode
      || !gateway.getFlagshipWorkspace) {
      setLoad({
        state: "error",
        message: "客户端缺少冻结描述符要求的 V3 世界端口。",
      });
      return () => controller.abort();
    }
    setLoad({ state: "loading" });
    Promise.all([
      gateway.getFlagshipWorld(sessionId, bindingId, controller.signal),
      gateway.getFlagshipEpisode(sessionId, bindingId, controller.signal),
      gateway.getFlagshipWorkspace(sessionId, bindingId, controller.signal),
    ]).then(([world, episode, workspace]) => {
      if (!controller.signal.aborted) {
        setLoad({ state: "ready", snapshot: { world, episode, workspace } });
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({
        state: "error",
        message: cause instanceof Error ? cause.message : "现场暂时无法载入",
      });
    });
    return () => controller.abort();
  }, [bindingId, gateway, revision, sessionId]);
  return [load, (snapshot) => setLoad({ state: "ready", snapshot })];
}

function actionPayload(
  action: FlagshipAvailableAction,
  text: string,
): StudentWorkAction["action"] {
  switch (action.eventTemplateId) {
    case "event-template-gatekeeper":
      return {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
        utterance: text,
      };
    case "event-template-inheritor":
      return {
        verb: "probe",
        targetRef: { objectType: "entity", objectId: "entity-inheritor" },
        utterance: text,
      };
    case "event-template-source-check":
    case "event-template-compare-sources":
      return {
        verb: "compare",
        targetRefs: [
          { objectType: "entity", objectId: "entity-inheritor" },
          { objectType: "entity", objectId: "entity-cultural-association" },
        ],
        evidenceQuestion: text,
      };
    case "event-template-community-source":
      return {
        verb: "negotiate",
        targetRef: { objectType: "entity", objectId: "entity-community-source" },
        utterance: text,
      };
    case "event-template-researcher-probe":
      return {
        verb: "probe",
        targetRef: { objectType: "entity", objectId: "entity-researcher" },
        utterance: text,
      };
    case "event-template-official-request":
      return {
        verb: "ask",
        targetRef: { objectType: "entity", objectId: "entity-public-liaison" },
        utterance: text,
      };
    case "event-template-rights-inspection":
      return {
        verb: "inspect",
        targetRefs: [
          { objectType: "entity", objectId: "entity-rights-contact" },
          { objectType: "artifact", objectId: "artifact-rights-ledger" },
        ],
        evidenceQuestion: text,
      };
    case "event-template-verification-wait":
      return {
        verb: "wait",
        durationMinutes: 10,
        reason: text,
      };
    default:
      throw new Error("该行动需要先进入成稿工作台");
  }
}

function relevantAction(
  actions: FlagshipAvailableAction[],
  selectedId: string | null,
): FlagshipAvailableAction | null {
  return actions.find((action) => action.eventTemplateId === selectedId)
    ?? actions.find((action) => action.eventTemplateId === "event-template-gatekeeper")
    ?? actions[0]
    ?? null;
}

const workbenchActionIds = new Set([
  "event-template-topic-brief",
  "event-template-draft-story",
  "event-template-limited-alert",
  "event-template-correction",
  "event-template-publication",
]);

function WorldLoading({ navigate }: { navigate(path: string): void }) {
  return (
    <main className="flagship-state">
      <button type="button" onClick={() => navigate("/student/courses")}>
        <ArrowLeft size={18} />返回课程
      </button>
      <div><LoaderCircle className="spin" /><h1>正在进入蟳埔采访现场</h1><p>正在恢复人物关系、现场时间与上一轮行动后果。</p></div>
    </main>
  );
}

function WorldError({
  message,
  navigate,
  retry,
}: {
  message: string;
  navigate(path: string): void;
  retry(): void;
}) {
  return (
    <main className="flagship-state error">
      <button type="button" onClick={() => navigate("/student/courses")}>
        <ArrowLeft size={18} />返回课程
      </button>
      <div><AlertTriangle /><h1>现场连接中断</h1><p>{message}</p><button type="button" onClick={retry}><RefreshCw size={17} />重新连接</button></div>
    </main>
  );
}

export function StudentFlagshipWorldSurface({
  snapshot,
  reporterBindingId,
  navigate,
  onSnapshot,
}: {
  snapshot: FlagshipSnapshot;
  reporterBindingId: string;
  navigate(path: string): void;
  onSnapshot(snapshot: FlagshipSnapshot): void;
}) {
  const gateway = useExperienceGateway();
  const { world, episode, workspace } = snapshot;
  const ending = world.endingState.endingRef
    ? endingExperience[world.endingState.endingRef] ?? {
        title: "本局已结束",
        summary: "世界已根据你的真实行动、作品和教师门形成终局。",
        reflection: "进入评价复盘查看证据链。",
        tone: "prudent" as const,
      }
    : null;
  const completedEventTypes = new Set(workspace.evidenceCatalog
    .map((evidence) => evidence.eventType)
    .filter((eventType): eventType is string => eventType !== null));
  const eligibleFieldActions = world.availableActions.filter(
    (action) => !workbenchActionIds.has(action.eventTemplateId),
  );
  const fieldActions = [
    ...eligibleFieldActions.filter((action) => !completedEventTypes.has(action.eventType)),
    ...eligibleFieldActions.filter((action) => completedEventTypes.has(action.eventType)),
  ].slice(0, 3);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(
    fieldActions[0]?.eventTemplateId ?? null,
  );
  const selectedAction = relevantAction(fieldActions, selectedActionId);
  const selectedExperience = selectedAction
    ? actionExperience[selectedAction.eventTemplateId]
    : null;
  const [actionText, setActionText] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeEntityId = episode.triggerEvent
    ? eventEntity[episode.triggerEvent.eventType] ?? null
    : null;
  const selectedEntity = world.entities.find((entity) => entity.entityId === selectedEntityId)
    ?? null;
  const latestEvidence = episode.suggestion?.evidenceRefs ?? [];
  const canAct = episode.status === "waiting"
    || (episode.status === "decided"
      && episode.studentDecision?.decision !== "accept"
      && episode.teacherGate?.status !== "pending");
  const awaitingTeacher = episode.teacherGate?.status === "pending";

  const refreshWorld = async (
    nextEpisode: StudentAgentCollaborationEpisodeV3,
    nextWorkspace: FlagshipWorkspaceView = workspace,
  ) => {
    if (!gateway.getFlagshipWorld || !gateway.getFlagshipWorkspace) return;
    const [nextWorld, refreshedWorkspace] = await Promise.all([
      gateway.getFlagshipWorld(world.sessionId, reporterBindingId),
      gateway.getFlagshipWorkspace(world.sessionId, reporterBindingId),
    ]);
    onSnapshot({
      world: nextWorld,
      episode: nextEpisode,
      workspace: nextWorkspace === workspace ? refreshedWorkspace : nextWorkspace,
    });
  };

  const chooseAction = (action: FlagshipAvailableAction) => {
    setSelectedActionId(action.eventTemplateId);
    setActionText("");
    const targetEntity = action.affectedObjectRefs.find((reference) => reference.objectType === "entity");
    if (targetEntity) setSelectedEntityId(targetEntity.objectId);
  };

  const submitAction = async () => {
    if (!gateway.submitFlagshipAction || !selectedAction || !selectedExperience) return;
    if (actionText.trim().length < 12) {
      setMessage("请把你的实际提问或核验思路说完整，再让现场人物回应。");
      return;
    }
    setBusy("action");
    setMessage(null);
    try {
      const nextEpisode = await gateway.submitFlagshipAction({
        sessionId: world.sessionId,
        bindingId: reporterBindingId,
        requestId: uniqueClientRef("student-world-action"),
        eventTemplateId: selectedAction.eventTemplateId,
        serverIssuedActionRef: selectedAction.serverIssuedActionRef,
        expectedWorldStateVersion: world.worldStateVersion,
        action: actionPayload(selectedAction, actionText.trim()),
        sourceWorldEventIds: episode.triggerEvent ? [episode.triggerEvent.eventId] : [],
        reflectionNote: "学生已提交自写现场表达，后续将结合 NPC 回应与世界后果复盘。",
      });
      onSnapshot({ world, episode: nextEpisode, workspace });
      setDecisionRationale("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "现场行动提交失败");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (
    decision: "accept" | "request_evidence" | "reject",
  ) => {
    if (!gateway.decideFlagshipEpisode) return;
    const rationale = decisionRationale.trim();
    if (!rationale) {
      setMessage("请先写下你采纳、补证或拒绝的理由。");
      return;
    }
    setBusy(decision);
    setMessage(null);
    try {
      const nextEpisode = await gateway.decideFlagshipEpisode({
        sessionId: world.sessionId,
        bindingId: reporterBindingId,
        episodeId: episode.episodeId,
        decisionRef: uniqueClientRef("student-episode-decision"),
        decision,
        rationale,
      });
      await refreshWorld(nextEpisode);
      if (decision !== "request_evidence") {
        setActionText("");
        setSelectedActionId(null);
      }
      setDecisionRationale("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "决定暂时无法记录");
    } finally {
      setBusy(null);
    }
  };

  const advance = async () => {
    if (!gateway.advanceFlagshipWorld) return;
    setBusy("advance");
    setMessage(null);
    try {
      const result = await gateway.advanceFlagshipWorld(world.sessionId, reporterBindingId);
      setMessage(result.advance.reason);
      await refreshWorld(result.episode);
      setActionText("");
      setSelectedActionId(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "现场暂时没有继续变化");
    } finally {
      setBusy(null);
    }
  };

  const saveWork = async (input: {
    artifact: FlagshipWorkspaceArtifact;
    fields: Array<{ fieldId: string; content: string }>;
    evidenceRefs: string[];
    revisionNote: string;
  }) => {
    if (!gateway.saveFlagshipWorkRevision) return;
    setBusy(`save:${input.artifact.artifactId}`);
    setMessage(null);
    try {
      const nextWorkspace = await gateway.saveFlagshipWorkRevision({
        sessionId: world.sessionId,
        bindingId: reporterBindingId,
        artifactId: input.artifact.artifactId,
        requestId: uniqueClientRef("student-work-revision"),
        expectedRevisionNumber: input.artifact.revisionCount,
        fields: input.fields,
        evidenceRefs: input.evidenceRefs,
        revisionNote: input.revisionNote,
      });
      onSnapshot({ world, episode, workspace: nextWorkspace });
      setMessage("新版本已保存到服务端，并生成不可混淆的内容哈希。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品版本保存失败");
    } finally {
      setBusy(null);
    }
  };

  const submitWork = async (artifact: FlagshipWorkspaceArtifact, supplement?: import("@ronggang/contracts").WorkSupplementSelectionV3) => {
    if (!gateway.submitFlagshipWorkRevision || !artifact.latestRevision) return;
    setBusy(`submit:${artifact.artifactId}`);
    setMessage(null);
    try {
      const nextWorkspace = await gateway.submitFlagshipWorkRevision({
        sessionId: world.sessionId,
        bindingId: reporterBindingId,
        artifactId: artifact.artifactId,
        requestId: uniqueClientRef("student-work-submit"),
        revisionId: artifact.latestRevision.revisionId,
        contentHash: artifact.latestRevision.contentHash,
        ...(supplement ? { supplement } : {}),
      });
      onSnapshot({ world, episode, workspace: nextWorkspace });
      setMessage("当前版本已锁定送审；后续修改必须形成新的修订链。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品锁定送审失败");
    } finally {
      setBusy(null);
    }
  };

  const submitWorkToWorld = async (
    eventTemplateId: "event-template-draft-story" | "event-template-publication",
    artifact: FlagshipWorkspaceArtifact,
  ) => {
    if (!gateway.submitFlagshipAction || !artifact.latestRevision) return;
    if (episode.status === "suggestion_ready" || awaitingTeacher) {
      setMessage("请先处理当前协作建议或教师门，再把作品交给编辑部。");
      return;
    }
    const availableAction = world.availableActions.find(
      (action) => action.eventTemplateId === eventTemplateId,
    );
    if (!availableAction) {
      setMessage("当前世界状态尚未开放这项编辑部行动。");
      return;
    }
    setBusy(eventTemplateId);
    setMessage(null);
    try {
      const revision = artifact.latestRevision;
      const action: StudentWorkAction["action"] = eventTemplateId === "event-template-draft-story"
        ? {
            verb: "draft",
            artifactId: artifact.artifactId,
            revisionId: revision.revisionId,
            parentRevisionId: revision.parentRevisionId,
            contentHash: revision.contentHash,
          }
        : {
            verb: "submit",
            artifactId: artifact.artifactId,
            revisionId: revision.revisionId,
            contentHash: revision.contentHash,
            evidenceRefs: revision.evidenceRefs,
          };
      const nextEpisode = await gateway.submitFlagshipAction({
        sessionId: world.sessionId,
        bindingId: reporterBindingId,
        requestId: uniqueClientRef("student-work-world-action"),
        eventTemplateId,
        serverIssuedActionRef: availableAction.serverIssuedActionRef,
        expectedWorldStateVersion: world.worldStateVersion,
        action,
        sourceWorldEventIds: episode.triggerEvent ? [episode.triggerEvent.eventId] : [],
        reflectionNote: eventTemplateId === "event-template-draft-story"
          ? "我提交的是服务端真实修订版本，希望编辑部只依据该版本和证据给出反馈。"
          : "全部必交成果已经锁定；我申请进入发布教师门，并接受公开后果与更正责任。",
      });
      onSnapshot({ world, episode: nextEpisode, workspace });
      setWorkbenchOpen(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品未能进入世界协作流程");
    } finally {
      setBusy(null);
    }
  };

  const timeProgress = Math.min(100, Math.max(0,
    (world.virtualTime.elapsedMinutes / Math.max(1,
      world.virtualTime.elapsedMinutes + world.virtualTime.remainingMinutes)) * 100));
  const evidenceIndicators = world.indicators.filter((indicator) => [
    "community_trust", "evidence_confidence", "editorial_independence", "copyright_risk",
  ].includes(indicator.variableId));

  if (workbenchOpen) {
    return (
      <FlagshipWorkbenchV3
        bindingId={reporterBindingId}
        workspace={workspace}
        busy={busy}
        message={message}
        onClose={() => setWorkbenchOpen(false)}
        onSave={saveWork}
        onSubmit={submitWork}
        onReviewDraft={(artifact) => submitWorkToWorld("event-template-draft-story", artifact)}
        onPublish={(artifact) => submitWorkToWorld("event-template-publication", artifact)}
      />
    );
  }

  return (
    <main className="flagship-world" aria-label="蟳埔旗舰持续世界">
      <div className="flagship-world-scene" aria-hidden="true" />
      <header className="flagship-hud">
        <button className="flagship-back" type="button" onClick={() => navigate("/student/courses")}>
          <ArrowLeft /><span>离开现场</span>
        </button>
        <div className="flagship-objective">
          <span><Compass size={16} />当前岗位目标</span>
          <strong>取得可信采访材料，完成一篇经得起核验的现场报道</strong>
        </div>
        <div className="flagship-timebox">
          <Clock3 />
          <div><span>采访窗口</span><strong>{world.virtualTime.remainingMinutes}<small> 分钟</small></strong></div>
          <div className="flagship-time-track"><i style={{ width: `${timeProgress}%` }} /></div>
        </div>
        <div className="flagship-challenge">
          <span>适应性压力</span><strong>{world.challenge.level}<small>/7</small></strong>
        </div>
      </header>

      <section className="flagship-location" aria-label="现场位置">
        <MapPin size={16} /><span>泉州 · 蟳埔社区 · 蚵壳厝巷口</span><b><Radio size={14} />世界进行中</b>
      </section>

      <section className="flagship-playfield" aria-label="可探索的采访现场">
        <div className="flagship-scene-copy">
          <span>第一现场</span>
          <h1>巷口的人不会按脚本等待你</h1>
          <p>先观察，再选择向谁开口。你的表达会改变准入、信任、时间与后续冲突。</p>
        </div>
        {npcVisuals.map((visual) => {
          const entity = world.entities.find((candidate) => candidate.entityId === visual.entityId);
          if (!entity) return null;
          const active = activeEntityId === entity.entityId || selectedEntityId === entity.entityId;
          return (
            <button
              key={entity.entityId}
              type="button"
              className={`flagship-npc ${visual.position}${active ? " active" : ""}`}
              onClick={() => setSelectedEntityId(entity.entityId)}
              aria-label={`查看${entity.title}的现场状态`}
            >
              <img src={visual.image} alt="" />
              <span className="flagship-npc-label">
                <b>{entity.title}</b><small>{entity.professionalRole ?? "现场人物"}</small>
              </span>
              {activeEntityId === entity.entityId ? <i>正在回应</i> : null}
            </button>
          );
        })}
        {selectedEntity ? (
          <aside className="flagship-entity-dialogue" aria-live="polite">
            <button type="button" onClick={() => setSelectedEntityId(null)} aria-label="关闭人物信息"><X /></button>
            <span>{selectedEntity.professionalRole ?? "现场对象"}</span>
            <h2>{selectedEntity.title}</h2>
            <p>{selectedEntity.publicSummary}</p>
            <small>{selectedEntity.status === "available" ? "可以尝试交流" : "现场状态已经改变"}</small>
          </aside>
        ) : null}
      </section>

      <button
        className={`flagship-side-tool notebook${notebookOpen ? " active" : ""}`}
        type="button"
        aria-label="打开采访本"
        onClick={() => setNotebookOpen((value) => !value)}
      >
        <NotebookPen /><span>采访本</span>
      </button>
      <button
        className={`flagship-side-tool pulse${pulseOpen ? " active" : ""}`}
        type="button"
        aria-label="打开现场感知"
        onClick={() => setPulseOpen((value) => !value)}
      >
        <Eye /><span>现场感知</span>
      </button>
      <button
        className="flagship-side-tool workbench"
        type="button"
        aria-label={`打开编辑部，已锁定 ${workspace.completion.submittedRequiredCount} / ${workspace.completion.requiredArtifactCount} 项必交成果`}
        onClick={() => setWorkbenchOpen(true)}
      >
        <Files /><span>编辑部 {workspace.completion.submittedRequiredCount}/{workspace.completion.requiredArtifactCount}</span>
      </button>

      {notebookOpen ? (
        <aside className="flagship-drawer notebook" aria-label="采访本">
          <header><div><BookOpenText /><span><small>FIELD NOTES</small><strong>我的采访本</strong></span></div><button type="button" onClick={() => setNotebookOpen(false)}><X /></button></header>
          <section><h2>已经掌握</h2>
            {world.facts.length > 0 ? world.facts.map((fact) => (
              <p key={fact.factId}><ShieldCheck /><span>{fact.status === "confirmed" ? "已确认的现场事实" : "仍需交叉核验的主张"}</span></p>
            )) : <p><MessageCircleMore /><span>还没有形成可用采访证据，先与现场人物交流。</span></p>}
          </section>
          <section><h2>本轮依据</h2>
            {latestEvidence.length > 0
              ? latestEvidence.map((reference) => <p key={reference}><CheckCircle2 /><span>已记录一条可回溯依据</span></p>)
              : <p><Compass /><span>建议的依据会在你主动查看后进入这里。</span></p>}
          </section>
        </aside>
      ) : null}

      {pulseOpen ? (
        <aside className="flagship-drawer pulse" aria-label="现场感知">
          <header><div><Radio /><span><small>WORLD PULSE</small><strong>你能感知到的变化</strong></span></div><button type="button" onClick={() => setPulseOpen(false)}><X /></button></header>
          {evidenceIndicators.map((indicator) => (
            <section key={indicator.variableId} className={`band-${indicator.band}`}>
              <div><strong>{indicator.title}</strong><span>{indicator.band === "high" ? "强" : indicator.band === "medium" ? "中" : "弱"}</span></div>
              <p>{indicator.studentProjection}</p>
            </section>
          ))}
          <small>这里只呈现记者能感知的现场信号，不显示后台数值与运行日志。</small>
        </aside>
      ) : null}

      {episode.status === "suggestion_ready" && episode.suggestion ? (
        <section className="flagship-conversation" aria-label="当前人物回应与协作建议">
          <div className="flagship-conversation-source">
            <span>{episode.triggerEvent?.sourceKind === "npc_intent" ? "现场人物主动找到了你" : "你的行动引发了现场回应"}</span>
            <h2>{episode.triggerEvent?.title}</h2>
          </div>
          <div className="flagship-advice">
            <span><Sparkles />{episode.suggestion.displayName}</span>
            <p>{episode.suggestion.summary}</p>
            <details><summary>为什么这样建议</summary><p>{episode.suggestion.rationale}</p></details>
          </div>
          <label>
            <span>写下你的判断（必填）</span>
            <textarea required value={decisionRationale} onChange={(event) => setDecisionRationale(event.target.value)} placeholder="你为什么采纳、补证或拒绝？" />
          </label>
          <div className="flagship-decision-actions">
            <button type="button" disabled={busy !== null || !decisionRationale.trim()} onClick={() => void decide("request_evidence")}>{decisionLabels.request_evidence}</button>
            <button type="button" disabled={busy !== null || !decisionRationale.trim()} onClick={() => void decide("reject")}>{decisionLabels.reject}</button>
            <button className="primary" type="button" disabled={busy !== null || !decisionRationale.trim()} onClick={() => void decide("accept")}>
              {busy === "accept" ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{decisionLabels.accept}
            </button>
          </div>
        </section>
      ) : null}

      {awaitingTeacher ? (
        <section className="flagship-gate-wait" role="status">
          <ShieldCheck /><div><span>高风险行动已停在教师门</span><strong>世界没有偷偷发布，等待教师确认肖像或发布风险。</strong></div>
        </section>
      ) : null}

      {episode.status === "failed" ? (
        <section className="flagship-gate-wait failure" role="alert">
          <AlertTriangle /><div><span>本轮智能协作未能安全完成</span><strong>{episode.failure?.safeMessage ?? "请刷新现场后重新行动。"}</strong></div>
        </section>
      ) : null}

      {world.endingState.status !== "active" && ending ? (
        <section className={`flagship-ending ${ending.tone}`}>
          {ending.tone === "trusted" ? <CheckCircle2 /> : <AlertTriangle />}
          <span>本局结局</span><h2>{ending.title}</h2><p>{ending.summary}</p>
          <small>{ending.reflection}</small>
          <button type="button" onClick={() => navigate(`/student/reviews/${encodeURIComponent(world.sessionId)}`)}>进入评价复盘<ChevronRight /></button>
        </section>
      ) : null}

      {world.endingState.status === "active" && episode.status !== "suggestion_ready" && !awaitingTeacher ? (
        <footer className="flagship-action-dock">
          {episode.status === "completed" ? (
            <div className="flagship-consequence">
              <CheckCircle2 /><span><small>现场已回应</small><strong>{episode.consequence?.publicSummary ?? "你的选择已经改变了现场。"}</strong></span>
              <button type="button" disabled={busy !== null} onClick={() => void advance()}>
                {busy === "advance" ? <LoaderCircle className="spin" /> : <Radio />}让世界继续演进
              </button>
            </div>
          ) : canAct ? (
            <>
              <div className="flagship-action-picker" role="list" aria-label="可选择的采访行动">
                {fieldActions.map((action) => (
                  <button
                    type="button"
                    role="listitem"
                    key={action.eventTemplateId}
                    className={selectedAction?.eventTemplateId === action.eventTemplateId ? "active" : ""}
                    onClick={() => chooseAction(action)}
                  >
                    {actionExperience[action.eventTemplateId]?.shortLabel ?? action.title}
                  </button>
                ))}
              </div>
              <div className="flagship-composer">
                <div><span>你准备怎么做？</span><strong>{selectedExperience?.shortLabel}</strong></div>
                <label className="flagship-action-entry">
                  <textarea
                    value={actionText}
                    placeholder={selectedExperience?.prompt ?? selectedAction?.cue}
                    onChange={(event) => setActionText(event.target.value)}
                    aria-label="输入你的实际采访行动"
                  />
                  <small>请用自己的话行动；灰色文字只是情境提示，不会替你提交标准答案。</small>
                </label>
                <button className="primary" type="button" disabled={busy !== null || !selectedAction || actionText.trim().length === 0} onClick={() => void submitAction()}>
                  {busy === "action" ? <LoaderCircle className="spin" /> : <Send />}执行行动
                </button>
              </div>
            </>
          ) : null}
          {message ? <p className="flagship-action-message" aria-live="polite">{message}</p> : null}
        </footer>
      ) : null}
    </main>
  );
}

export default function StudentFlagshipWorldPage({
  sessionId,
  reporterBindingId,
  navigate,
}: StudentFlagshipWorldPageProps) {
  return <StudentFlagshipWorldV4Page
    sessionId={sessionId}
    reporterBindingId={reporterBindingId}
    navigate={navigate}
  />;
}

export function StudentFlagshipWorldV3Page({
  sessionId,
  reporterBindingId,
  navigate,
}: StudentFlagshipWorldPageProps) {
  const [revision, setRevision] = useState(0);
  const [load, setSnapshot] = useFlagshipSnapshot(
    sessionId,
    reporterBindingId,
    revision,
  );
  if (load.state === "loading") return <WorldLoading navigate={navigate} />;
  if (load.state === "error") {
    return (
      <WorldError
        message={load.message}
        navigate={navigate}
        retry={() => setRevision((value) => value + 1)}
      />
    );
  }
  return (
    <StudentFlagshipWorldSurface
      snapshot={load.snapshot}
      reporterBindingId={reporterBindingId}
      navigate={navigate}
      onSnapshot={setSnapshot}
    />
  );
}

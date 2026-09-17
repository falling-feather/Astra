import type {
  StudentAgentCollaborationEpisodeV3,
  StudentWorkAction,
  FieldExplorationViewV4,
  FieldInterviewViewV1,
  FieldInterviewActionV1,
  FieldInterviewActionRequestV1,
} from "@ronggang/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileImage,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Mic2,
  RefreshCw,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useExperienceGateway,
  GatewayHttpError,
  type ExperienceGateway,
} from "../gateway";
import { groundedCitationStanceLabelV4 } from "../flagship-v4";
import type { StudentDialogueEpisodeEnvelopeV4 } from "../dialogue-v4";
import type {
  FlagshipExperienceViewV4,
  FlagshipMediaCatalogItemV4,
  FlagshipMediaOperationInputV4,
  FlagshipMediaWorkspaceV4,
  FlagshipSemanticActionReceiptV4,
  GroundedCollaborationStudentEnvelopeV4,
  PublicSemanticSelectionV4,
} from "../flagship-v4";
import type {
  FlagshipWorkspaceArtifact,
  FlagshipWorkspaceView,
  FlagshipWorldView,
} from "../world-v3";
import { FlagshipWorkbenchV3 } from "./flagship-workbench-v3";
import { StudentFlagshipDialogueV4Panel } from "./student-flagship-dialogue-v4";
import { NodeFieldShell } from "./node-field/shell";
import { NodeInterviewShell } from "./node-field/interview-shell";
import { currentInteractionText, resolveFieldSelection } from "../field-exploration-v4";
import "./student-flagship-world-v4.css";

interface StudentFlagshipWorldV4PageProps {
  sessionId: string;
  reporterBindingId: string;
  navigate(path: string): void;
}

interface StudentWorldSnapshotV4 {
  interview?: FieldInterviewViewV1 | null;
  field: FieldExplorationViewV4;
  experience: FlagshipExperienceViewV4;
  dialogue: StudentDialogueEpisodeEnvelopeV4 | null;
  media: FlagshipMediaWorkspaceV4;
  businessEpisode: StudentAgentCollaborationEpisodeV3 | null;
  world: FlagshipWorldView;
  workspace: FlagshipWorkspaceView;
}

type LoadState =
  | { state: "loading" }
  | { state: "ready"; snapshot: StudentWorldSnapshotV4 }
  | { state: "error"; message: string };

type MediaOperationKind = "crop" | "trim" | "mask" | "remove_metadata";
type PackageMediaKind = "image" | "audio" | "video";
type ProductionSurface = "story" | "media" | null;

type FlagshipWorldGatewayV4 = ExperienceGateway & Required<Pick<
  ExperienceGateway,
  | "getFlagshipExperienceV4"
  | "getExplorationFieldV4"
  | "startFlagshipDialogueV4"
  | "getFlagshipDialogueV4"
  | "submitFlagshipDialogueTurnV4"
  | "submitSemanticActionV4"
  | "decideGroundedSuggestionV4"
  | "getFlagshipMediaWorkspaceV4"
  | "createFlagshipMediaRevisionV4"
  | "flagshipMediaAssetUrlV4"
  | "getFlagshipWorld"
  | "getFlagshipEpisode"
  | "submitFlagshipAction"
  | "decideFlagshipEpisode"
  | "getFlagshipWorkspace"
  | "saveFlagshipWorkRevision"
  | "submitFlagshipWorkRevision"
>>;

const packageKinds: readonly PackageMediaKind[] = [
  "image",
  "audio",
  "video",
];

const decisionLabels = {
  accept: "采纳并承担后果",
  request_evidence: "要求补证",
  reject: "拒绝并自行判断",
} as const;

function uniqueClientRef(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function hasV4Gateway(gateway: ExperienceGateway): gateway is FlagshipWorldGatewayV4 {
  return Boolean(
    gateway.getFlagshipExperienceV4
    && gateway.getExplorationFieldV4
    && gateway.startFlagshipDialogueV4
    && gateway.getFlagshipDialogueV4
    && gateway.submitFlagshipDialogueTurnV4
    && gateway.submitSemanticActionV4
    && gateway.decideGroundedSuggestionV4
    && gateway.getFlagshipMediaWorkspaceV4
    && gateway.createFlagshipMediaRevisionV4
    && gateway.flagshipMediaAssetUrlV4
    && gateway.getFlagshipWorld
    && gateway.getFlagshipEpisode
    && gateway.submitFlagshipAction
    && gateway.decideFlagshipEpisode
    && gateway.getFlagshipWorkspace
    && gateway.saveFlagshipWorkRevision
    && gateway.submitFlagshipWorkRevision,
  );
}

async function readDeclaredInterview(gateway: ExperienceGateway, experience: FlagshipExperienceViewV4, bindingId: string, signal?: AbortSignal) {
  if (!experience.fieldInterviewEnabled) return null;
  if (!gateway.getFieldInterviewV1) throw new Error("客户端缺少当前课程声明的开放采访入口");
  return gateway.getFieldInterviewV1(experience.sessionId, bindingId, signal);
}

function productionSurfaceForReceipt(
  receipt: FlagshipSemanticActionReceiptV4,
): Exclude<ProductionSurface, null> {
  if (receipt.decision.status !== "accepted") return "story";
  const canonical = receipt.decision.canonicalAction;
  const referencedIds = [...canonical.targetRefs, ...canonical.materialRefs]
    .map((reference) => reference.objectId.toLowerCase());
  const mediaReference = referencedIds.some((reference) => (
    /(?:media|camera|photo|image|audio|video|consent|rights|素材|图片|录音|视频)/u
      .test(reference)
  ));
  return mediaReference ? "media" : "story";
}

function selectionKey(selection: PublicSemanticSelectionV4): string {
  return selection.selectionToken;
}

function mediaKindLabel(kind: FlagshipMediaCatalogItemV4["mediaKind"]): string {
  switch (kind) {
    case "image": return "图片";
    case "audio": return "录音";
    case "video": return "视频";
    case "synthetic_capture": return "仿真截图";
  }
}

function mediaKindIcon(kind: FlagshipMediaCatalogItemV4["mediaKind"]) {
  if (kind === "audio") return <Mic2 />;
  if (kind === "video") return <Film />;
  return <ImageIcon />;
}

function operationOptions(
  asset: FlagshipMediaCatalogItemV4,
): Array<{ kind: MediaOperationKind; label: string; explanation: string }> {
  const common = [{
    kind: "remove_metadata" as const,
    label: "清除元数据",
    explanation: "生成不含原始文件元数据的新版本，原件保持不变。",
  }];
  if (asset.mediaKind === "audio") {
    return [
      { kind: "trim", label: "截取有效片段", explanation: "截取前 2.5 秒作为采访声样。" },
      ...common,
    ];
  }
  if (asset.mediaKind === "video") {
    return [
      { kind: "trim", label: "截取有效片段", explanation: "截取前 2.5 秒作为短视频素材。" },
      { kind: "crop", label: "调整画面构图", explanation: "保留画面中央 90% 区域。" },
      { kind: "mask", label: "遮挡敏感区域", explanation: "遮挡画面右上角的识别区域。" },
      ...common,
    ];
  }
  return [
    { kind: "crop", label: "调整画面构图", explanation: "保留画面中央 90% 区域。" },
    { kind: "mask", label: "遮挡敏感区域", explanation: "遮挡画面右上角的识别区域。" },
    ...common,
  ];
}

function mediaOperation(
  asset: FlagshipMediaCatalogItemV4,
  kind: MediaOperationKind,
  rationale: string,
): FlagshipMediaOperationInputV4 {
  if (kind === "trim") {
    return {
      operationKind: "trim",
      inputAssetRef: asset.assetRef,
      startMs: 0,
      endMs: 2_500,
      rationale,
    };
  }
  if (kind === "crop") {
    return {
      operationKind: "crop",
      inputAssetRef: asset.assetRef,
      region: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      rationale,
    };
  }
  return {
    operationKind: "redact",
    inputAssetRef: asset.assetRef,
    region: kind === "mask"
      ? { x: 0.72, y: 0.04, width: 0.24, height: 0.2 }
      : { x: 0, y: 0, width: 1, height: 1 },
    redactionKind: kind,
    rationale,
  };
}

function SourceMedia({ asset }: { asset: FlagshipMediaCatalogItemV4 }) {
  if (asset.mediaKind === "audio") {
    return <audio controls src={asset.publicPath}>浏览器不支持音频预览。</audio>;
  }
  if (asset.mediaKind === "video") {
    return <video controls playsInline src={asset.publicPath}>浏览器不支持视频预览。</video>;
  }
  return <img src={asset.publicPath} alt={asset.title} />;
}

function DerivedMedia({
  source,
  url,
}: {
  source: FlagshipMediaWorkspaceV4["revisions"][number]["derivedAssets"][number];
  url: string;
}) {
  if (source.mediaKind === "audio") return <audio controls src={url} />;
  if (source.mediaKind === "video") return <video controls playsInline src={url} />;
  return <img src={url} alt="学生处理后的媒体版本" />;
}

export function MediaWorkbenchV4({
  gateway,
  sessionId,
  bindingId,
  workspace,
  initialAssetRef,
  onWorkspace,
  onClose,
}: {
  gateway: ExperienceGateway & Required<Pick<
    ExperienceGateway,
    "createFlagshipMediaRevisionV4" | "flagshipMediaAssetUrlV4"
  >>;
  sessionId: string;
  bindingId: string;
  workspace: FlagshipMediaWorkspaceV4;
  initialAssetRef?: string | undefined;
  onWorkspace(workspace: FlagshipMediaWorkspaceV4): void;
  onClose(): void;
}) {
  const [selectedRef, setSelectedRef] = useState(
    workspace.catalog.find((asset) => asset.assetRef === initialAssetRef)?.assetRef
      ?? workspace.catalog.find((asset) => asset.mediaKind === "image")?.assetRef
      ?? workspace.catalog[0]?.assetRef
      ?? "",
  );
  const selected = workspace.catalog.find((asset) => asset.assetRef === selectedRef)
    ?? workspace.catalog[0]
    ?? null;
  const options = selected ? operationOptions(selected) : [];
  const [operationKind, setOperationKind] = useState<MediaOperationKind>(
    options[0]?.kind ?? "remove_metadata",
  );
  const [rationale, setRationale] = useState("");
  const [packageAssetRefs, setPackageAssetRefs] = useState<Record<PackageMediaKind, string>>(
    () => Object.fromEntries(packageKinds.map((kind) => [
      kind,
      kind==='image' ? workspace.catalog.find((asset) => asset.mediaKind === kind)?.assetRef ?? "" : "",
    ])) as Record<PackageMediaKind, string>,
  );
  const [busy, setBusy] = useState<"draft" | "submitted" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latest = workspace.revisions.at(-1) ?? null;
  const latestDerived = latest?.derivedAssets.at(-1) ?? null;

  useEffect(() => {
    if (selected && !operationOptions(selected).some((item) => item.kind === operationKind)) {
      setOperationKind(operationOptions(selected)[0]?.kind ?? "remove_metadata");
    }
  }, [operationKind, selected]);

  const saveRevision = async () => {
    if (!selected || rationale.trim().length < 8) {
      setMessage("请先选择一项素材，并说明本次编辑判断。 ");
      return;
    }
    setBusy("draft");
    setMessage(null);
    try {
      const next = await gateway.createFlagshipMediaRevisionV4({
        sessionId,
        bindingId,
        artifactRef: "artifact-multiplatform-package",
        requestId: uniqueClientRef("media-revision"),
        expectedRevisionNumber: workspace.revisions.length,
        status: "draft",
        sourceAssetRefs: [selected.assetRef],
        operations: [mediaOperation(selected, operationKind, rationale.trim())],
        supportingEvidenceRefs: [selected.rightsReceiptRef],
        studentEditorialRationale: rationale.trim(),
      });
      onWorkspace(next);
      setMessage("真实派生文件已经生成；原件、权利回执和父版本均保留。 ");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "媒体版本保存失败");
    } finally {
      setBusy(null);
    }
  };

  const submitPackage = async () => {
    const selectedKinds=packageKinds.filter(kind=>packageAssetRefs[kind]);
    const packageAssets = selectedKinds.map((kind) => (
      workspace.catalog.find((asset) => asset.assetRef === packageAssetRefs[kind])
    ));
    if (packageAssets.length===0 || packageAssets.some((asset) => !asset) || rationale.trim().length < 8) {
      setMessage("请至少选择一项本次实际使用的素材，并说明编辑判断。");
      return;
    }
    const assets = packageAssets as FlagshipMediaCatalogItemV4[];
    setBusy("submitted");
    setMessage(null);
    try {
      const next = await gateway.createFlagshipMediaRevisionV4({
        sessionId,
        bindingId,
        artifactRef: "artifact-multiplatform-package",
        requestId: uniqueClientRef("media-submission"),
        expectedRevisionNumber: workspace.revisions.length,
        status: "submitted",
        sourceAssetRefs: assets.map((asset) => asset.assetRef),
        operations: assets.map((asset) => mediaOperation(
          asset,
          asset.mediaKind === "image" ? "crop" : "trim",
          rationale.trim(),
        )),
        supportingEvidenceRefs: assets.map((asset) => asset.rightsReceiptRef),
        studentEditorialRationale: rationale.trim(),
      });
      onWorkspace(next);
      setMessage("所选素材已经形成同一送审版本，原件、使用说明和处理结果均已保留。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "融媒体包提交失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flagship-v4-media" aria-label="融媒体素材工作台">
      <header>
        <div><WandSparkles /><span><small>真实文件处理</small><h1>融媒体素材台</h1></span></div>
        <button type="button" onClick={onClose} aria-label="关闭素材台"><X /></button>
      </header>
      <div className="flagship-v4-media-layout">
        <aside className="flagship-v4-source-list">
          <h2>1. 选择本课素材</h2>
          <p>这些是课程发布的教学素材。先核对来源和使用范围，再决定怎样用于作品。</p>
          <div>
            {workspace.catalog.map((asset) => (
              <button
                type="button"
                key={asset.assetRef}
                className={asset.assetRef === selected?.assetRef ? "active" : ""}
                onClick={() => setSelectedRef(asset.assetRef)}
              >
                {mediaKindIcon(asset.mediaKind)}
                <span><strong>{asset.title}</strong><small>{mediaKindLabel(asset.mediaKind)} · {asset.rightsStatus === "cleared" ? "已清权" : "限课堂使用"}</small></span>
                {asset.assetRef === selected?.assetRef ? <Check /> : null}
              </button>
            ))}
          </div>
          <section className="flagship-v4-package-builder">
            <h3>本次选用的素材</h3>
            <p>按作品需要选择，未使用的类型可以留空。</p>
            {packageKinds.filter(kind=>workspace.catalog.some(asset=>asset.mediaKind===kind)).map((kind) => (
              <label key={kind}>
                <span>{kind === "image" ? "图像" : kind === "audio" ? "音频" : "视频"}</span>
                <select
                  aria-label={`选择送审${kind === "image" ? "图像" : kind === "audio" ? "音频" : "视频"}`}
                  value={packageAssetRefs[kind]}
                  onChange={(event) => setPackageAssetRefs((current) => ({
                    ...current,
                    [kind]: event.target.value,
                  }))}
                >
                  <option value="">本次不使用</option>
                  {workspace.catalog.filter((asset) => asset.mediaKind === kind).map((asset) => (
                    <option key={asset.assetRef} value={asset.assetRef}>{asset.title}</option>
                  ))}
                </select>
              </label>
            ))}
          </section>
        </aside>

        <main className="flagship-v4-editor">
          {selected ? (
            <>
              <div className="flagship-v4-media-preview"><SourceMedia asset={selected} /></div>
              <section className="flagship-v4-source-boundary">
                <ShieldCheck /><div><strong>{selected.title}</strong><p>{selected.sourceFactBoundary}</p><small>{selected.aiDisclosure.disclosureText}</small></div>
              </section>
              <h2>2. 选择真实处理动作</h2>
              <div className="flagship-v4-operation-list">
                {options.map((option) => (
                  <button
                    type="button"
                    key={option.kind}
                    className={operationKind === option.kind ? "active" : ""}
                    onClick={() => setOperationKind(option.kind)}
                  >
                    <Scissors /><span><strong>{option.label}</strong><small>{option.explanation}</small></span>
                  </button>
                ))}
              </div>
              <label className="flagship-v4-rationale">
                <span>3. 写下你的编辑判断</span>
                <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="说明本次裁剪、遮挡或截取的目的，以及需要保留的事实与使用边界。" />
              </label>
              <div className="flagship-v4-media-actions">
                <button className="flagship-v4-save-media" type="button" disabled={busy !== null || rationale.trim().length < 8} onClick={() => void saveRevision()}>
                  {busy === "draft" ? <LoaderCircle className="spin" /> : <FileImage />}生成草稿版本
                </button>
                <button
                  className="flagship-v4-submit-media"
                  type="button"
                  disabled={busy !== null || rationale.trim().length < 8 || latest?.status === "submitted"}
                  onClick={() => void submitPackage()}
                >
                  {busy === "submitted" ? <LoaderCircle className="spin" /> : <ShieldCheck />}
                  {latest?.status === "submitted" ? "素材版本已锁定送审" : "锁定并提交所选素材"}
                </button>
              </div>
              {message ? <p className="flagship-v4-media-message" aria-live="polite">{message}</p> : null}
            </>
          ) : <p>当前课程没有可处理的媒体素材。</p>}
        </main>

        <aside className="flagship-v4-revision-rail">
          <h2>版本结果</h2>
          {latest && latestDerived ? (
            <>
              <div className="flagship-v4-derived-preview">
                <DerivedMedia
                  source={latestDerived}
                  url={gateway.flagshipMediaAssetUrlV4(sessionId, bindingId, latestDerived.assetRef)}
                />
              </div>
              <strong>R{latest.revisionNumber} · {latest.status === "draft" ? "草稿" : latest.status === "locked" ? "已锁定" : "已提交"}</strong>
              <p>{latest.studentEditorialRationale}</p>
              <dl>
                <div><dt>真实字节</dt><dd>{Math.ceil(latestDerived.byteLength / 1024)} KB</dd></div>
                <div><dt>内容哈希</dt><dd>{latestDerived.contentHash.slice(0, 12)}…</dd></div>
                <div><dt>父素材</dt><dd>{latestDerived.parentAssetRefs.length} 项</dd></div>
                <div><dt>权利回执</dt><dd>{latest.rightsLedgerRefs.length} 项</dd></div>
              </dl>
            </>
          ) : (
            <div className="flagship-v4-empty-revision">
              <FileImage /><strong>尚无学生版本</strong><p>执行一次处理动作后，这里才会出现真实文件和修订收据。</p>
            </div>
          )}
          <small>新版本不会覆盖原件。预览字节会再次核对服务端哈希。</small>
        </aside>
      </div>
    </section>
  );
}

function StudentSuggestionV4({
  collaboration,
  rationale,
  busy,
  onRationale,
  onDecision,
}: {
  collaboration: GroundedCollaborationStudentEnvelopeV4;
  rationale: string;
  busy: string | null;
  onRationale(value: string): void;
  onDecision(decision: "accept" | "request_evidence" | "reject"): void;
}) {
  const { episode } = collaboration;
  if (episode.status === "failed") {
    return <section className="flagship-v4-advice failure"><AlertTriangle /><div><h2>协作未能形成安全建议</h2><p>{episode.failure?.safeMessage}</p></div></section>;
  }
  if (!episode.suggestion) return null;
  return (
    <section
      className="flagship-v4-advice"
      aria-label="当前唯一专业建议"
      data-episode-id={episode.episodeId}
    >
      <header><Sparkles /><span><small>当前唯一专业建议</small><h2>{episode.suggestion.professionalRole}</h2></span></header>
      <p>{episode.suggestion.summary}</p>
      <details>
        <summary>查看依据与协作过程</summary>
        <p>{episode.suggestion.rationale}</p>
        <ol>
          {episode.suggestion.knowledgeCitations.map((citation) => (
            <li key={`${citation.knowledgeRef}:${citation.fragmentRef ?? citation.sourceContentHash}`}>
              {citation.sourceUrl
                ? <a href={citation.sourceUrl} target="_blank" rel="noreferrer">{citation.sourceTitle}</a>
                : <span>{citation.sourceTitle}（本地材料）</span>}
              <b>{groundedCitationStanceLabelV4(citation.stance)}</b>
              <span>{citation.locator}</span>
              {citation.snippet ? <small>{citation.snippet}</small> : null}
            </li>
          ))}
        </ol>
      </details>
      {episode.status === "suggestion_ready" ? (
        <>
          <label><span>写下你的岗位判断</span><textarea value={rationale} onChange={(event) => onRationale(event.target.value)} placeholder="为什么采纳、补证或拒绝？" required /></label>
          <div>
            <button type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("request_evidence")}>{decisionLabels.request_evidence}</button>
            <button type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("reject")}>{decisionLabels.reject}</button>
            <button className="primary" data-primary-action="true" type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("accept")}>
              {busy === "accept" ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{decisionLabels.accept}
            </button>
          </div>
        </>
      ) : (
        <div className="flagship-v4-decision-record"><CheckCircle2 /><span>你已选择：{episode.studentDecision ? decisionLabels[episode.studentDecision.decision] : "等待记录"}</span></div>
      )}
    </section>
  );
}

export function StudentEvidenceWaitV4({
  collaboration,
  evidenceState,
  busy,
  canContinueFieldAction,
  canRefreshEvidence,
  onRefreshEvidence,
}: {
  collaboration: GroundedCollaborationStudentEnvelopeV4;
  evidenceState: NonNullable<GroundedCollaborationStudentEnvelopeV4["episode"]["evidenceState"]>;
  busy: string | null;
  canContinueFieldAction: boolean;
  canRefreshEvidence: boolean;
  onRefreshEvidence(): void;
}) {
  return (
    <section
      className="flagship-v4-teacher-wait"
      data-round-focus="waiting_evidence"
      data-episode-id={collaboration.episode.episodeId}
    >
      <AlertTriangle />
      <div>
        <small>当前唯一下一步</small>
        <h2>协作等待补充证据</h2>
        <p>当前没有形成可供采纳、要求补证或拒绝的 Grounded 专业建议；未解决结果不会伪装成 V3 建议。</p>
        {evidenceState.gaps.length > 0 ? (
          <div>
            <strong>待补材料</strong>
            <ul>
              {evidenceState.gaps.map((item) => <li key={`gap-${item}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {evidenceState.conflicts.length > 0 ? (
          <div>
            <strong>来源冲突</strong>
            <ul>
              {evidenceState.conflicts.map((item) => <li key={`conflict-${item}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {evidenceState.expired.length > 0 ? (
          <div>
            <strong>已过期材料</strong>
            <ul>
              {evidenceState.expired.map((item) => <li key={`expired-${item}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {evidenceState.revoked.length > 0 ? (
          <div>
            <strong>已撤回材料</strong>
            <ul>
              {evidenceState.revoked.map((item) => <li key={`revoked-${item}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {evidenceState.reason ? <p>{evidenceState.reason}</p> : null}
        {evidenceState.authorizationExpiresAt ? <small>授权有效期：{evidenceState.authorizationExpiresAt}</small> : null}
        {canContinueFieldAction ? (
          <p className="flagship-v4-inline-warning"><AlertTriangle />现场岗位行动仍可继续；本次协作未形成建议，不会替你写入世界结果。</p>
        ) : null}
        <button
          data-primary-action="true"
          type="button"
          disabled={busy !== null || !canRefreshEvidence}
          title={canRefreshEvidence ? undefined : "当前学生端等待网关接入补证刷新端口"}
          onClick={onRefreshEvidence}
        >
          {busy === "refresh-evidence" ? <LoaderCircle className="spin" /> : <RefreshCw />}
          补充资料后重新协作
        </button>
        {!canRefreshEvidence ? <small>补证刷新端口尚未接入，补充资料后请重新进入现场。</small> : null}
      </div>
    </section>
  );
}

function StudentBusinessSuggestion({
  episode,
  rationale,
  busy,
  onRationale,
  onDecision,
}: {
  episode: StudentAgentCollaborationEpisodeV3;
  rationale: string;
  busy: string | null;
  onRationale(value: string): void;
  onDecision(decision: "accept" | "request_evidence" | "reject"): void;
}) {
  if (episode.status === "failed") {
    return (
      <section className="flagship-v4-advice failure">
        <AlertTriangle />
        <div><h2>专业协作未能形成安全建议</h2><p>{episode.failure?.safeMessage}</p></div>
      </section>
    );
  }
  if (episode.status !== "suggestion_ready" || !episode.suggestion) return null;
  return (
    <section
      className="flagship-v4-advice"
      aria-label="当前唯一专业建议"
      data-episode-id={episode.episodeId}
    >
      <header><Sparkles /><span><small>当前唯一专业建议</small><h2>{episode.suggestion.displayName}</h2></span></header>
      <p>{episode.suggestion.summary}</p>
      <details>
        <summary>查看这条建议的岗位依据</summary>
        <p>{episode.suggestion.rationale}</p>
        <small>建议依据已由服务端核对；你仍需独立作出岗位决定。</small>
      </details>
      <label><span>写下你的岗位判断</span><textarea value={rationale} onChange={(event) => onRationale(event.target.value)} placeholder="为什么采纳、补证或拒绝？" required /></label>
      <div>
        <button type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("request_evidence")}>{decisionLabels.request_evidence}</button>
        <button type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("reject")}>{decisionLabels.reject}</button>
        <button className="primary" data-primary-action="true" type="button" disabled={busy !== null || rationale.trim().length === 0} onClick={() => onDecision("accept")}>
          {busy === "accept" ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{decisionLabels.accept}
        </button>
      </div>
    </section>
  );
}

function actionSelectionGroups(window: NonNullable<FlagshipExperienceViewV4["actionWindow"]>) {
  return {
    people: window.selections.filter((selection) => selection.displayKind === "npc"),
    objects: window.selections.filter((selection) => selection.displayKind !== "npc"),
  };
}

function optionalBusinessEpisode(cause: unknown): null {
  if (cause instanceof GatewayHttpError && cause.status === 404) return null;
  throw cause;
}

export function StudentFlagshipWorldV4Surface({
  gateway,
  snapshot,
  reporterBindingId,
  navigate,
  onSnapshot,
}: {
  gateway: FlagshipWorldGatewayV4;
  snapshot: StudentWorldSnapshotV4;
  reporterBindingId: string;
  navigate(path: string): void;
  onSnapshot(snapshot: StudentWorldSnapshotV4): void;
}) {
  const { experience, field } = snapshot;
  const window = experience.actionWindow;
  const selectionGroups = useMemo(
    () => window ? actionSelectionGroups(window) : { people: [], objects: [] },
    [window],
  );
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(() => new Set());
  const [focusedPersonId, setFocusedPersonId] = useState<string | null>(null);
  const [viewpoint, setViewpoint] = useState<string | null>(experience.scene.sceneRef);
  const selectedTokens = new Set([...selectedObjectIds].flatMap(id => {
    const selection = resolveFieldSelection(field, experience, id);
    return selection ? [selection.selectionToken] : [];
  }));
  const [utterance, setUtterance] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [busy, setBusyState] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const refreshEpoch = useRef(0);
  const pendingRefreshes = useRef(0);
  const authSuspended = useRef(false);
  const setBusy = useCallback((value: string | null) => {
    busyRef.current = value;
    if (value !== null) refreshEpoch.current++;
    setBusyState(value);
  }, []);
  const [productionSurface, setProductionSurface] = useState<ProductionSurface>(null);
  const [requestedMediaRef, setRequestedMediaRef] = useState<string | undefined>();

  useEffect(() => {
    setClarification(null);
  }, [window?.actionWindowRef]);

  const collaboration = experience.collaboration
    && experience.collaboration.episode.audience === "student"
    ? experience.collaboration as GroundedCollaborationStudentEnvelopeV4
    : null;
  const activeDialogue = snapshot.dialogue?.episode.status === "active"
    ? snapshot.dialogue
    : null;
  const businessSuggestion = !collaboration
    && snapshot.businessEpisode?.status === "suggestion_ready"
    && snapshot.businessEpisode.suggestion
    ? snapshot.businessEpisode
    : null;
  const consequenceSummary = snapshot.businessEpisode?.consequence?.publicSummary ?? null;
  const waitingTeacher = snapshot.businessEpisode?.teacherGate?.status === "pending";
  const evidenceState = collaboration?.episode.evidenceState;
  const waitingEvidence = collaboration?.episode.status === "waiting"
    && (evidenceState?.status === "needs_evidence" || evidenceState?.status === "unavailable");
  const suggestionReady = collaboration?.episode.status === "suggestion_ready"
    || businessSuggestion !== null;
  const selectedObjects = window?.selections.filter((selection) => (
    selectedTokens.has(selectionKey(selection))
  )) ?? [];
  const worldEnded = snapshot.world.endingState.status !== "active";
  const selectedPeople = selectedObjects.filter((selection) => selection.displayKind === "npc");
  const canStartDialogue = !activeDialogue
    && !suggestionReady
    && !waitingTeacher
    && !worldEnded
    && selectedObjects.length === 1
    && selectedPeople.length === 1;

  const refresh = async (overrides: Partial<Pick<
    StudentWorldSnapshotV4,
    "dialogue" | "media" | "workspace"
  >> = {}) => {
    const epoch = ++refreshEpoch.current;
    pendingRefreshes.current++;
    try {
    const [nextExperience, nextDialogue, nextBusinessEpisode, nextWorld, nextWorkspace, nextField, nextMedia] = await Promise.all([
      gateway.getFlagshipExperienceV4(experience.sessionId, reporterBindingId),
      gateway.getFlagshipDialogueV4(experience.sessionId, reporterBindingId),
      gateway.getFlagshipEpisode(experience.sessionId, reporterBindingId).catch(optionalBusinessEpisode),
      gateway.getFlagshipWorld(experience.sessionId, reporterBindingId),
      overrides.workspace
        ? Promise.resolve(overrides.workspace)
        : gateway.getFlagshipWorkspace(experience.sessionId, reporterBindingId),
      gateway.getExplorationFieldV4(experience.sessionId, reporterBindingId),
      overrides.media
        ? Promise.resolve(overrides.media)
        : gateway.getFlagshipMediaWorkspaceV4(experience.sessionId, reporterBindingId, "artifact-multiplatform-package"),
    ]);
    const nextInterview = await readDeclaredInterview(gateway, nextExperience, reporterBindingId);
    if (epoch !== refreshEpoch.current) return;
    onSnapshot({
      field: nextField,
      interview: nextInterview,
      experience: nextExperience,
      dialogue: overrides.dialogue === undefined ? nextDialogue : overrides.dialogue,
      media: nextMedia,
      businessEpisode: nextBusinessEpisode,
      world: nextWorld,
      workspace: nextWorkspace,
    });
    } catch (cause) {
      if (cause instanceof GatewayHttpError && (cause.status === 401 || cause.status === 403)) authSuspended.current = true;
      throw cause;
    } finally { pendingRefreshes.current--; }
  };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (document.hidden || busyRef.current || pendingRefreshes.current || authSuspended.current) return;
      void refreshRef.current().catch(() => setMessage(authSuspended.current ? "当前登录状态需要更新，已暂停同步。请重新进入学生端继续。" : "现场同步暂时中断，已保留当前输入。可点击刷新重新连接。"));
    }, 5000);
    return () => { globalThis.clearInterval(timer); refreshEpoch.current++; };
  }, []);

  const toggleSelection = (selection: PublicSemanticSelectionV4) => {
    const id = field.selectionBindings.find(binding => binding.selectionToken === selection.selectionToken)?.objectId;
    if (!id) return;
    setSelectedObjectIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitAction = async (input?: { text: string; selections: PublicSemanticSelectionV4[] }): Promise<boolean> => {
    const text = (input?.text ?? utterance).trim();
    const chosen = input?.selections ?? selectedObjects;
    if (busyRef.current) return false;
    if (!window || text.length < 2 || (selectedObjectIds.size > 0 && !chosen.length && !input)) {
      setMessage("请先用自己的话说明你准备做什么。 ");
      return false;
    }
    setBusy("action");
    setMessage(null);
    setClarification(null);
    try {
      const receipt = await gateway.submitSemanticActionV4({
        schemaVersion: "semantic-action-request/4.0.0",
        requestId: uniqueClientRef("semantic-action"),
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        actionWindowRef: window.actionWindowRef,
        actionWindowHash: window.actionWindowHash,
        expectedWorldStateVersion: window.worldStateVersion,
        utterance: text,
        selections: chosen.map((selection) => ({
          selectionToken: selection.selectionToken,
          displayKind: selection.displayKind,
        })),
        submittedAt: new Date().toISOString(),
      });
      setMessage(receipt.execution.safeMessage);
      if (receipt.decision.status === "clarification_required") {
        setClarification(receipt.decision.clarification.prompt);
      }
      if (receipt.execution.status === "workspace_required") {
        setProductionSurface(productionSurfaceForReceipt(receipt));
      }
      await refresh();
      const accepted = receipt.execution.status !== "zero_write";
      if (accepted) setUtterance("");
      return accepted;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "岗位行动暂时无法提交");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const startDialogue = async (input?: { text: string; selection: PublicSemanticSelectionV4 }): Promise<boolean> => {
    const text = (input?.text ?? utterance).trim();
    const chosen = input ? [input.selection] : selectedPeople;
    if (busyRef.current) return false;
    if (!window || (!input && !canStartDialogue) || activeDialogue || suggestionReady || waitingTeacher || worldEnded || chosen.length !== 1 || text.length < 2) {
      setMessage("请先只选择一位现场人物，再用自己的话说明采访来意。");
      return false;
    }
    setBusy("dialogue-start");
    setMessage(null);
    setClarification(null);
    try {
      const response = await gateway.startFlagshipDialogueV4({
        schemaVersion: "semantic-action-request/4.0.0",
        requestId: uniqueClientRef("dialogue-start"),
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        actionWindowRef: window.actionWindowRef,
        actionWindowHash: window.actionWindowHash,
        expectedWorldStateVersion: window.worldStateVersion,
        utterance: text,
        selections: chosen.map((selection) => ({
          selectionToken: selection.selectionToken,
          displayKind: selection.displayKind,
        })),
        submittedAt: new Date().toISOString(),
      });
      setMessage(response.safeMessage);
      if (response.status === "opened") {
        await refresh({ dialogue: response.dialogue });
        setUtterance("");
        return true;
      } else {
        setClarification(response.safeMessage);
        await refresh();
        return false;
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "人物对话暂时无法开始");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submitDialogueTurn = async (turnUtterance: string): Promise<boolean> => {
    if (busyRef.current) return false;
    const dialogue = snapshot.dialogue;
    if (!dialogue || dialogue.episode.status !== "active" || !dialogue.turnToken
      || !gateway.submitFlagshipDialogueTurnV4) {
      setMessage("当前人物对话已经结束，请刷新现场后继续。");
      return false;
    }
    setBusy("dialogue-turn");
    setFocusedPersonId(dialogue.episode.npc.npcRef);
    setMessage(null);
    try {
      const nextDialogue = await gateway.submitFlagshipDialogueTurnV4({
        schemaVersion: "dialogue-turn-request/4.0.0",
        requestId: uniqueClientRef("dialogue-turn"),
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        episodeId: dialogue.episode.episodeId,
        expectedEpisodeRevision: dialogue.episode.turnCount,
        expectedWorldStateVersion: experience.worldStateVersion,
        turnToken: dialogue.turnToken,
        utterance: turnUtterance,
        submittedAt: new Date().toISOString(),
      });
      setMessage(nextDialogue?.episode.status === "exited"
        ? "人物对话已结束；你可以回到现场继续行动。"
        : "人物回应已记录，可以继续交流或查看采访本。");
      await refresh({ dialogue: nextDialogue });
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "人物回合暂时无法提交");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const exitDialogue = () => {
    void submitDialogueTurn("我先结束对话，谢谢；后续需要时我会重新说明用途和范围。");
  };

  const decideSuggestion = async (
    decision: "accept" | "request_evidence" | "reject",
  ) => {
    const rationale = decisionRationale.trim();
    if (!rationale) {
      setMessage("请先写下你的判断依据，再选择采纳、补证或拒绝。");
      return;
    }
    if (!collaboration?.decisionToken && (!businessSuggestion || !gateway.decideFlagshipEpisode)) {
      setMessage("当前建议决定令牌已失效，请刷新现场。 ");
      return;
    }
    setBusy(decision);
    setMessage(null);
    try {
      if (collaboration?.decisionToken) {
        await gateway.decideGroundedSuggestionV4({
          sessionId: experience.sessionId,
          bindingId: reporterBindingId,
          episodeId: collaboration.episode.episodeId,
          decisionToken: collaboration.decisionToken,
          decisionRef: uniqueClientRef("grounded-decision"),
          decision,
          rationale,
        });
      } else if (businessSuggestion && gateway.decideFlagshipEpisode) {
        await gateway.decideFlagshipEpisode({
          sessionId: experience.sessionId,
          bindingId: reporterBindingId,
          episodeId: businessSuggestion.episodeId,
          decisionRef: uniqueClientRef("business-decision"),
          decision,
          rationale,
        });
      }
      setDecisionRationale("");
      setMessage(decision === "accept"
        ? "已记录你的判断，现场将根据这个决定继续变化。"
        : "已记录你的判断，可以继续补充资料或调整做法。");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "建议决定暂时无法记录");
    } finally {
      setBusy(null);
    }
  };

  const refreshGroundedEvidence = async () => {
    if (!collaboration) return;
    const refreshEvidence = gateway.refreshGroundedEvidenceV4;
    if (!refreshEvidence) {
      setMessage("当前学生端尚未接入补证刷新端口；补充资料后请重新进入现场。 ");
      return;
    }
    setBusy("refresh-evidence");
    setMessage(null);
    try {
      await refreshEvidence({
        sessionId: experience.sessionId,
        episodeId: collaboration.episode.episodeId,
        bindingId: reporterBindingId,
      });
      await refresh();
      setMessage("补证资料已刷新，协作结果已重新加载。 ");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "补证刷新暂时无法完成");
    } finally {
      setBusy(null);
    }
  };

  const activeWorldPulse = experience.worldPulse.status === "npc_action_pending"
    ? experience.worldPulse
    : null;
  const primaryQuestion = activeWorldPulse
    ? `${activeWorldPulse.speaker}正在等待你的回应`
    : "你准备如何推进这一轮采访？";

  const saveWork = async (input: {
    artifact: FlagshipWorkspaceArtifact;
    fields: Array<{ fieldId: string; content: string }>;
    evidenceRefs: string[];
    revisionNote: string;
  }) => {
    setBusy(`save:${input.artifact.artifactId}`);
    setMessage(null);
    try {
      const nextWorkspace = await gateway.saveFlagshipWorkRevision({
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        artifactId: input.artifact.artifactId,
        requestId: uniqueClientRef("student-work-revision"),
        expectedRevisionNumber: input.artifact.revisionCount,
        fields: input.fields,
        evidenceRefs: input.evidenceRefs,
        revisionNote: input.revisionNote,
      });
      onSnapshot({ ...snapshot, workspace: nextWorkspace });
      setMessage("新版本已保存，可以继续修改或锁定送审。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品版本保存失败");
    } finally {
      setBusy(null);
    }
  };

  const submitWork = async (artifact: FlagshipWorkspaceArtifact, supplement?: import("@ronggang/contracts").WorkSupplementSelectionV3) => {
    if (!artifact.latestRevision) return;
    setBusy(`submit:${artifact.artifactId}`);
    setMessage(null);
    try {
      const nextWorkspace = await gateway.submitFlagshipWorkRevision({
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        artifactId: artifact.artifactId,
        requestId: uniqueClientRef("student-work-submit"),
        revisionId: artifact.latestRevision.revisionId,
        contentHash: artifact.latestRevision.contentHash,
        ...(supplement ? { supplement } : {}),
      });
      onSnapshot({ ...snapshot, workspace: nextWorkspace });
      setMessage("当前版本已锁定送审。继续修改时将保存为新的版本。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品锁定送审失败");
    } finally {
      setBusy(null);
    }
  };

  const completeCourse = async () => {
    if(!gateway.getStudy||!gateway.completeStudy)throw new Error('当前连接未启用课程完成服务');
    setBusy('complete-course');setMessage(null);
    try{
      const state=await gateway.getStudy();
      const run=state.runs.find(run=>run.sessionId===experience.sessionId);
      if(run?.status==='completed'){navigate('/student/courses');return;}
      if(!run||state.currentSessionId!==experience.sessionId)throw new Error('本场不再是当前课程，请从档案查看历史记录。');
      await gateway.completeStudy({requestId:uniqueClientRef('complete-course'),sessionId:experience.sessionId,expectedRevision:state.revision,confirmation:'complete'});
      navigate('/student/courses');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'课程暂未完成，请保留作品后重试。');}
    finally{setBusy(null);}
  };

  const submitWorkToWorld = async (
    eventTemplateId: "event-template-draft-story" | "event-template-publication",
    artifact: FlagshipWorkspaceArtifact,
  ) => {
    if (!artifact.latestRevision) return;
    if (suggestionReady || waitingTeacher) {
      setMessage("请先处理当前协作建议或教师门，再把作品交给编辑部。");
      return;
    }
    const availableAction = snapshot.world.availableActions.find(
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
      await gateway.submitFlagshipAction({
        sessionId: experience.sessionId,
        bindingId: reporterBindingId,
        requestId: uniqueClientRef("student-work-world-action"),
        eventTemplateId,
        serverIssuedActionRef: availableAction.serverIssuedActionRef,
        expectedWorldStateVersion: snapshot.world.worldStateVersion,
        action,
        sourceWorldEventIds: snapshot.businessEpisode?.triggerEvent
          ? [snapshot.businessEpisode.triggerEvent.eventId]
          : [],
        reflectionNote: eventTemplateId === "event-template-draft-story"
          ? "我提交服务端真实修订版本，请编辑部只依据该版本和已绑定证据给出反馈。"
          : "全部必交成果已经锁定；我申请进入发布教师门，并承担公开后果与更正责任。",
      });
      setProductionSurface(null);
      await refresh({ workspace: snapshot.workspace });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作品未能进入世界协作流程");
    } finally {
      setBusy(null);
    }
  };

  const uiBusy = authSuspended.current ? "auth-required" : busy;

  if (productionSurface === "story") {
    return (
      <div className="node-production-adapter"><FlagshipWorkbenchV3
        bindingId={reporterBindingId}
        {...(snapshot.interview?.title ? { courseTitle: snapshot.interview.title } : {})}
        workspace={snapshot.workspace}
        busy={uiBusy}
        message={message}
        onClose={() => setProductionSurface(null)}
        onComplete={completeCourse}
        onSave={saveWork}
        onSubmit={submitWork}
        onReviewDraft={(artifact) => submitWorkToWorld("event-template-draft-story", artifact)}
        onPublish={(artifact) => submitWorkToWorld("event-template-publication", artifact)}
      /></div>
    );
  }

  if (productionSurface === "media") {
    return (
      <div className="node-production-adapter"><MediaWorkbenchV4
        gateway={gateway}
        sessionId={experience.sessionId}
        bindingId={reporterBindingId}
        workspace={snapshot.media}
        initialAssetRef={requestedMediaRef}
        onWorkspace={(media) => onSnapshot({ ...snapshot, media })}
        onClose={() => setProductionSurface(null)}
      /></div>
    );
  }

  const allPeople = [...new Map(field.nodes.flatMap(node => node.people).map(person => [person.entityId, person])).values()];
  const selectedPerson = allPeople.find(person => person.entityId === (activeDialogue?.episode.npc.npcRef ?? focusedPersonId)) ?? null;
  const personForSelection = (selection: PublicSemanticSelectionV4) => {
    const id = field.selectionBindings.find(binding => binding.selectionToken === selection.selectionToken)?.objectId;
    return allPeople.find(person => person.entityId === id);
  };
  const personMayStart = canStartDialogue && !!selectedPeople[0] && !!personForSelection(selectedPeople[0])?.supportsDialogue;
  const choosePerson = (id: string) => {
    const person = allPeople.find(candidate => candidate.entityId === id);
    if (person && !person.presence.canContact) { setMessage(person.presence.prerequisite.reason); return; }
    if (activeDialogue && activeDialogue.episode.npc.npcRef !== id) {
      setMessage(`请先继续或结束与${activeDialogue.episode.npc.displayName}的交谈。`);
      return;
    }
    setFocusedPersonId(id); setSelectedObjectIds(new Set([id])); setMessage(null);
  };
  const chooseObject = (id: string) => {
    if (activeDialogue) { setMessage("请先结束当前人物交谈，再进行资料操作。"); return; }
    setFocusedPersonId(null); setSelectedObjectIds(new Set([id])); setMessage(null);
  };
  const sendWorkMessage = async (personId: string, text: string): Promise<boolean> => {
    if (suggestionReady || waitingTeacher || worldEnded) { setMessage("请先处理当前岗位决定或教师反馈。"); return false; }
    if (activeDialogue) {
      if (activeDialogue.episode.npc.npcRef !== personId) { setMessage("当前还有一段交谈尚未结束。"); return false; }
      return submitDialogueTurn(text);
    }
    const selection = resolveFieldSelection(field, experience, personId);
    const person = allPeople.find(candidate => candidate.entityId === personId);
    if (!selection || !person || !person.presence.canContact || person.status !== "available") { setMessage(person?.presence.prerequisite.reason ?? "当前尚未开放这位人物的交流，请先完成现场已开放的行动。"); return false; }
    setFocusedPersonId(personId);
    return person.supportsDialogue ? startDialogue({ text, selection }) : submitAction({ text, selections: [selection] });
  };
  const guidance = worldEnded ? (
    <section className="flagship-v4-ending" data-round-focus="review"><CheckCircle2 /><div><h2>回看本次采访与作品</h2><p>评价将读取你实际完成的现场行动、作品版本、岗位决定和教师反馈。</p><button className="node-primary" data-primary-action="true" type="button" onClick={() => navigate(`/student/reviews/${encodeURIComponent(experience.sessionId)}`)}>进入评价复盘</button></div></section>
  ) : waitingEvidence && collaboration && evidenceState ? (
    <StudentEvidenceWaitV4 collaboration={collaboration} evidenceState={evidenceState} busy={uiBusy} canContinueFieldAction={window !== null || snapshot.world.availableActions.length > 0} canRefreshEvidence={typeof gateway.refreshGroundedEvidenceV4 === "function"} onRefreshEvidence={() => void refreshGroundedEvidence()} />
  ) : suggestionReady && collaboration ? (
    <div data-round-focus="suggestion"><StudentSuggestionV4 collaboration={collaboration} rationale={decisionRationale} busy={uiBusy} onRationale={setDecisionRationale} onDecision={decision => void decideSuggestion(decision)} /></div>
  ) : suggestionReady && businessSuggestion ? (
    <div data-round-focus="suggestion"><StudentBusinessSuggestion episode={businessSuggestion} rationale={decisionRationale} busy={uiBusy} onRationale={setDecisionRationale} onDecision={decision => void decideSuggestion(decision)} /></div>
  ) : waitingTeacher ? (
    <section className="flagship-v4-teacher-wait" data-round-focus="teacher-gate"><ShieldCheck /><div><h2>等待教师处理专业问题</h2><p>已经提交的问题会由教师处理。你可以查看当前记录与作品。</p><button className="node-secondary" type="button" data-primary-action="true" disabled={uiBusy !== null} onClick={() => void refresh()}>检查教师决定</button></div></section>
  ) : consequenceSummary ? <p>{consequenceSummary}</p> : null;
  const interaction = activeDialogue ? (
    <StudentFlagshipDialogueV4Panel dialogue={activeDialogue} busy={busy !== null} onSubmit={text => void submitDialogueTurn(text)} onExit={exitDialogue} />
  ) : suggestionReady || waitingTeacher || worldEnded ? (
    <section><h2>{selectedPerson?.displayName ?? "现场反馈"}</h2><p>{currentInteractionText(focusedPersonId, snapshot.dialogue?.episode ?? null, field.actionConversations) ?? "问题已记录，请查看本轮岗位协作与现场反馈。"}</p></section>
  ) : window ? (
    <section className="node-action-entry" data-round-focus="field-action">
      <h2>{selectedPerson?.displayName ?? "现场行动"}<small>{selectedPerson?.professionalRole ?? "观察、核验与制作"}</small></h2>
      <p>{selectedPerson?.publicGoal ?? primaryQuestion}</p>
      {selectedPerson && !selectedObjects.length ? <p className="node-response-note">当前任务尚未开放这位人物的交流。你可以先完成已开放的采访或资料核验。</p> : null}
      {!selectedPerson ? <div className="node-selected-objects" aria-label="可选择的资料与对象">{selectionGroups.objects.map(selection => <button type="button" key={selection.selectionToken} className={selectedTokens.has(selection.selectionToken) ? "active" : ""} onClick={() => toggleSelection(selection)} title={selection.consequenceHint}>{selection.label}</button>)}</div> : null}
      <form onSubmit={event => { event.preventDefault(); if (personMayStart) void startDialogue(); else void submitAction(); }}>
        <label><span>{selectedPerson ? "说说你的来意与问题" : "你准备怎么做？"}</span><textarea aria-label={selectedPerson ? `向${selectedPerson.displayName}说明来意` : "你准备怎么做？"} value={utterance} onChange={event => setUtterance(event.target.value)} maxLength={2000} placeholder={selectedPerson ? "说明身份、采访范围，再提出一个具体问题。" : "说明你想观察或核实什么，依据是什么……"} disabled={uiBusy !== null} /></label>
        <button className="node-primary" type="submit" data-primary-action="true" disabled={uiBusy !== null || utterance.trim().length < 2 || (selectedObjectIds.size > 0 && !selectedObjects.length)}>{busy ? <LoaderCircle className="spin" /> : <Send />}{personMayStart ? `与${selectedPerson?.displayName ?? "人物"}开始交谈` : selectedPerson ? "发送这一问题" : "执行这一行动"}</button>
      </form>
      {clarification ? <p className="node-response-note" role="status">{clarification}</p> : null}
    </section>
  ) : <p>现场暂时没有开放的新行动，可以查看工作记录或刷新。</p>;
  if (snapshot.interview && gateway.submitFieldInterviewV1) return <NodeInterviewShell
    view={snapshot.interview} field={field} world={snapshot.world} workspace={snapshot.workspace} busy={uiBusy !== null} message={message}
    worldPulse={experience.worldPulse}
    guidance={guidance} guidanceRequired={suggestionReady || waitingTeacher || worldEnded}
    onAction={async (action: FieldInterviewActionV1) => {
      if (busyRef.current || !snapshot.interview || !gateway.submitFieldInterviewV1) return false;
      setBusy("interview-action"); setMessage(null);
      let saved = false;
      try {
        const request: FieldInterviewActionRequestV1 = { schemaVersion: "field-interview-action/1.0.0", requestId: uniqueClientRef("field-interview"),
          sessionId: experience.sessionId, bindingId: reporterBindingId, expectedWorldStateVersion: snapshot.interview.worldStateVersion, action };
        const interview = await gateway.submitFieldInterviewV1(request);
        saved = true; onSnapshot({ ...snapshot, interview });
        await refresh();
        return true;
      } catch (cause) {
        setMessage(saved ? "这次操作已保存，其他现场信息同步暂时失败，可以重新同步。" : cause instanceof Error ? cause.message : "暂时没有收到回应，你的输入仍保留。");
        return saved;
      } finally { setBusy(null); }
    }}
    onRefresh={async () => { await refresh().catch(cause => setMessage(cause instanceof Error ? cause.message : "现场同步暂时失败。")); }}
    onWork={(kind) => setProductionSurface(kind)} onExit={() => navigate("/student/courses")}
  />;

  return <NodeFieldShell
    field={field} experience={experience} world={snapshot.world} workspace={snapshot.workspace} media={snapshot.media}
    viewpoint={viewpoint} selectedPerson={selectedPerson} activeDialogueNpc={activeDialogue?.episode.npc.npcRef ?? null}
    busy={uiBusy} message={message} guidance={guidance} interaction={interaction}
    guidanceKey={worldEnded ? `ending:${experience.worldStateVersion}` : collaboration ? `${collaboration.episode.episodeId}:${collaboration.episode.status}` : businessSuggestion?.episodeId ?? (waitingTeacher ? snapshot.businessEpisode?.episodeId ?? "teacher-wait" : null)}
    guidanceRequired={suggestionReady || waitingTeacher || worldEnded}
    onViewpoint={setViewpoint} onPerson={choosePerson} onObject={chooseObject} onMessage={sendWorkMessage}
    requiresReauth={authSuspended.current}
    onRefresh={async () => {
      if (authSuspended.current) { globalThis.location.reload(); return; }
      await refresh().catch(cause => setMessage(cause instanceof Error ? cause.message : "现场同步暂时失败，当前记录仍保留。"));
    }}
    onWork={(kind, assetRef) => { setRequestedMediaRef(assetRef); setProductionSurface(kind); }} onReview={() => navigate(`/student/reviews/${encodeURIComponent(experience.sessionId)}`)}
    onExit={() => navigate("/student/courses")}
  />;
}

export default function StudentFlagshipWorldV4Page({
  sessionId,
  reporterBindingId,
  navigate,
}: StudentFlagshipWorldV4PageProps) {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!hasV4Gateway(gateway)) {
      setLoad({
        state: "error",
        message: "客户端缺少冻结描述符要求的 V4 旗舰端口。",
      });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ state: "loading" });
    Promise.all([
      gateway.getFlagshipExperienceV4(sessionId, reporterBindingId, controller.signal),
      gateway.getFlagshipDialogueV4(sessionId, reporterBindingId, controller.signal),
      gateway.getFlagshipMediaWorkspaceV4(
        sessionId,
        reporterBindingId,
        "artifact-multiplatform-package",
        controller.signal,
      ),
      gateway.getFlagshipEpisode(sessionId, reporterBindingId, controller.signal).catch(optionalBusinessEpisode),
      gateway.getFlagshipWorld(sessionId, reporterBindingId, controller.signal),
      gateway.getFlagshipWorkspace(sessionId, reporterBindingId, controller.signal),
      gateway.getExplorationFieldV4(sessionId, reporterBindingId, controller.signal),
    ]).then(async ([experience, dialogue, media, businessEpisode, world, workspace, field]) => {
      if (controller.signal.aborted) return;
      const interview = await readDeclaredInterview(gateway, experience, reporterBindingId, controller.signal);
      if (!controller.signal.aborted) setLoad({
        state: "ready",
        snapshot: { field, experience, dialogue, media, businessEpisode, world, workspace, interview },
      });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({
        state: "error",
        message: cause instanceof Error ? cause.message : "无法进入旗舰岗位世界",
      });
    });
    return () => controller.abort();
  }, [gateway, reporterBindingId, revision, sessionId]);

  if (load.state === "loading") {
    return <main className="flagship-v4-state"><button type="button" onClick={() => navigate("/student/courses")}><ArrowLeft />返回课程</button><section><LoaderCircle className="spin" /><h1>正在恢复岗位实训现场</h1><p>同步当前场景、人物计划、采访时间和作品版本。</p></section></main>;
  }
  if (load.state === "error") {
    return <main className="flagship-v4-state error"><button type="button" onClick={() => navigate("/student/courses")}><ArrowLeft />返回课程</button><section><AlertTriangle /><h1>现场暂时不可用</h1><p>{load.message}</p><button type="button" onClick={() => setRevision((value) => value + 1)}><RefreshCw />重新连接</button></section></main>;
  }
  if (!hasV4Gateway(gateway)) return null;
  return (
    <StudentFlagshipWorldV4Surface
      key={`${sessionId}:${reporterBindingId}`}
      gateway={gateway}
      snapshot={load.snapshot}
      reporterBindingId={reporterBindingId}
      navigate={navigate}
      onSnapshot={(snapshot) => setLoad(current => current.state === "ready"
        && current.snapshot.experience.sessionId === snapshot.experience.sessionId
        && current.snapshot.media.bindingId === snapshot.media.bindingId
        ? { state: "ready", snapshot } : current)}
    />
  );
}

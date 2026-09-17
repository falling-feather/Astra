import type {
  SimulationEventReceipt,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";

export interface XunpuWorldDirectorAdvanceResultV3 {
  scheduled: boolean;
  receipt: SimulationEventReceipt | null;
  reason: string;
}

/**
 * Deterministic, fail-closed scene policy for the first flagship vertical.
 * The browser can only ask to continue; it cannot choose an NPC, event type,
 * affected object or expected consequence. A later Live scene-director may
 * propose the same directive, but the authoritative enqueue boundary remains
 * this server policy plus WorldSimulationEngineV3 validation.
 */
export class XunpuWorldDirectorV3 {
  constructor(private readonly engine: Pick<
    WorldSimulationEngineV3,
    "getRecord" | "enqueueNpcEvent" | "enqueueSystemClockEvent"
  >) {}

  async advance(sessionId: string): Promise<XunpuWorldDirectorAdvanceResultV3> {
    const record = await this.engine.getRecord(sessionId);
    const blocking = record.queue
      .filter((event) => event.status === "queued" || event.status === "awaiting_gate")
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (blocking) {
      return {
        scheduled: false,
        receipt: null,
        reason: blocking.status === "awaiting_gate"
          ? "当前高风险后果仍在等待教师门。"
          : "世界中已有尚未处理的现场事件。",
      };
    }
    if (record.currentSnapshot.endingState.status !== "active") {
      return {
        scheduled: false,
        receipt: null,
        reason: "本局世界已进入结局，不能继续注入冲突。",
      };
    }
    const handledTypes = new Set(
      record.queue
        .filter((event) => event.status === "committed" || event.status === "rejected")
        .map((event) => event.eventType),
    );
    const candidates = [
      handledTypes.has("student_inspects_rights")
        && !handledTypes.has("rights_contact_flags_scope")
        ? {
            sourceKind: "npc_intent" as const,
            eventTemplateId: "event-template-rights-contact",
            label: "rights-scope-mismatch",
            reason: "学生完成初步权利核对后，权利联络人主动指出跨平台许可缺口。",
          }
        : null,
      handledTypes.has("student_drafts_story")
        && !handledTypes.has("safety_rumor_emerges")
        ? {
            sourceKind: "system_clock" as const,
            eventTemplateId: "event-template-safety-rumor",
            label: "safety-rumor-emerges",
            reason: "成稿推进期间，带有公共安全风险的未核截图进入编辑部。",
          }
        : null,
      handledTypes.has("student_asks_gatekeeper")
        && handledTypes.has("student_asks_community_source")
        && handledTypes.has("student_asks_inheritor")
        && (
          handledTypes.has("student_compares_sources")
          || handledTypes.has("student_inspects_source")
          || handledTypes.has("student_probes_researcher")
        )
        && !handledTypes.has("shopkeeper_requests_placement")
        ? {
          sourceKind: "npc_intent" as const,
          eventTemplateId: "event-template-shopkeeper",
          label: "shopkeeper-placement",
          reason: "学生完成准入、主体采访与首轮信源核验后，商户主动以素材换取商业植入。",
        }
        : null,
      // The shopkeeper opening the negotiation is not the student's answer.
      // Keep the world open for a free-text counteroffer before advancing the
      // clock, otherwise the queued clock event disables the very action the
      // learner is expected to perform.
      handledTypes.has("student_resolves_commercial_exchange")
        && !handledTypes.has("system_clock_tick")
        ? {
            sourceKind: "system_clock" as const,
            eventTemplateId: "event-template-clock",
            label: "first-clock-tick",
            reason: "商业边界协商消耗了采访窗口，虚拟时钟继续推进。",
          }
        : null,
      handledTypes.has("system_clock_tick")
          && !handledTypes.has("tourist_withdraws_consent")
        ? {
              sourceKind: "npc_intent" as const,
              eventTemplateId: "event-template-visual-consent",
              label: "tourist-consent-withdrawal",
              reason: "剪辑准备阶段，游客主动撤回近景肖像授权。",
            }
        : null,
    ];
    const next = candidates.find((candidate) => candidate !== null
      && record.release.eventTemplates.some((template) => (
        template.eventTemplateId === candidate.eventTemplateId
        && template.sourceKind === candidate.sourceKind
        && template.challengeLevels.includes(
          record.challengeAssignment.challengeLevel,
        )
      ))) ?? null;
    if (!next) {
      return {
        scheduled: false,
        receipt: null,
        reason: "当前应由学生主动采访、核验信源或提交作品，情境导演不替代岗位行动。",
      };
    }
    const sequenceKey = `${record.currentSnapshot.stateVersion}-${next.label}`;
    const input = {
      sessionId,
      eventTemplateId: next.eventTemplateId,
      sourceRef: `scene-director-intent-${sequenceKey}`,
      requestId: `scene-director-request-${sequenceKey}`,
      expectedWorldStateVersion: record.currentSnapshot.stateVersion,
      notBeforeVirtualMinute: record.currentSnapshot.virtualTime.elapsedMinutes,
    };
    const receipt = next.sourceKind === "npc_intent"
      ? await this.engine.enqueueNpcEvent(input)
      : await this.engine.enqueueSystemClockEvent(input);
    return { scheduled: true, receipt, reason: next.reason };
  }
}

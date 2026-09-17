import { createHash } from "node:crypto";
import {
  CrossCourseAgentRuleManifestSchema,
  CrossCourseAgentRuleManifestSchemaVersion,
  CourseReleaseSchema,
  type AgentTopologyManifest,
  type CourseRelease,
  type CrossCourseAgentResolution,
  type CrossCourseAgentRuleManifest,
  type ScenarioReleaseReference,
} from "@ronggang/contracts";
import {
  courseContentReleases,
  hashCanonical,
  type CourseContentRelease,
} from "@ronggang/course-content";
import { assistanceTemplateProfiles } from "./definitions/assistants.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function hashV2AgentEvidence(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function hasCanonicalCourseReleaseHash(release: CourseRelease): boolean {
  const { contentHash: _contentHash, ...hashInput } = release;
  return hashCanonical(hashInput) === release.contentHash;
}

function activeRuntimeRelease(
  source: CourseContentRelease,
  releases: readonly CourseRelease[],
): CourseRelease | null {
  const matching = releases.filter((release) => (
    release.courseId === source.releaseRef.courseId
  ));
  if (matching.length > 1) {
    throw new Error(`课程 ${source.releaseRef.courseId} 同时登记了多个活动发布版`);
  }
  return matching[0] ?? null;
}

function resolutionOf(input: {
  sourceAgentId: string;
  baselineAgentIds: ReadonlySet<string>;
  assistanceByAgentId: ReadonlyMap<string, { active: boolean }>;
}): CrossCourseAgentResolution {
  if (input.baselineAgentIds.has(input.sourceAgentId)) {
    return {
      sourceAgentId: input.sourceAgentId,
      targetKind: "baseline_topology",
      targetAgentId: input.sourceAgentId,
      status: "exact",
      enabled: true,
    };
  }
  const assistance = input.assistanceByAgentId.get(input.sourceAgentId);
  if (assistance) {
    return {
      sourceAgentId: input.sourceAgentId,
      targetKind: "supporting_capability",
      targetAgentId: input.sourceAgentId,
      status: "exact",
      enabled: assistance.active,
    };
  }
  return {
    sourceAgentId: input.sourceAgentId,
    targetKind: "supporting_capability",
    targetAgentId: null,
    status: "unresolved",
    enabled: false,
  };
}

function isContentOnly(release: CourseRelease): boolean {
  return release.releaseId.includes("content.1")
    || release.scenarioReleaseRef.version.includes("content");
}

export function buildCrossCourseAgentRuleManifest(input: {
  topology: AgentTopologyManifest;
  courseReleases: readonly CourseRelease[];
  publishedScenarioRefs: readonly ScenarioReleaseReference[];
  generatedAt?: string;
}): CrossCourseAgentRuleManifest {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const courseReleases = input.courseReleases.map((release) => (
    CourseReleaseSchema.parse(release)
  ));
  const baselineAgentIds = new Set(
    input.topology.agents.map((agent) => agent.agentId),
  );
  const assistanceByAgentId = new Map(
    assistanceTemplateProfiles.map((profile) => [
      profile.agentId,
      { active: profile.active },
    ]),
  );
  const courses = courseContentReleases.map((source) => {
    const release = activeRuntimeRelease(source, courseReleases);
    const chapters = source.sections.map((section) => {
      if (section.dynamicEvents.length !== 1 || section.agentSelectionRules.length !== 1) {
        throw new Error(`章节 ${section.sectionId} 必须且只能声明一个动态事件和一条智能体规则`);
      }
      const event = section.dynamicEvents[0]!;
      const rule = section.agentSelectionRules[0]!;
      const sameSet = (left: readonly string[], right: readonly string[]) => (
        left.length === right.length
        && new Set(left).size === left.length
        && new Set(right).size === right.length
        && left.every((item) => right.includes(item))
      );
      if (
        !sameSet(event.affectedAgentIds, rule.affectedAgentIds)
        || !sameSet(event.candidateAgentIds, rule.candidateAgentIds)
      ) {
        throw new Error(`章节 ${section.sectionId} 的事件与调度规则智能体集合不一致`);
      }
      const agentResolutions = rule.candidateAgentIds.map((sourceAgentId) => (
        resolutionOf({ sourceAgentId, baselineAgentIds, assistanceByAgentId })
      ));
      const resolvedCandidateAgentIds = agentResolutions.flatMap((resolution) => (
        resolution.targetKind === "baseline_topology"
        && resolution.status !== "unresolved"
        && resolution.targetAgentId !== null
          ? [resolution.targetAgentId]
          : []
      ));
      const resolvedAffectedAgentIds = agentResolutions.flatMap((resolution) => (
        rule.affectedAgentIds.includes(resolution.sourceAgentId)
        && resolution.targetKind === "baseline_topology"
        && resolution.status !== "unresolved"
        && resolution.targetAgentId !== null
          ? [resolution.targetAgentId]
          : []
      ));
      const rulePayload = {
        chapterId: section.sectionId,
        order: section.order,
        eventRef: {
          eventId: event.eventId,
          triggerKind: event.trigger.kind,
          triggerRef: event.trigger.ref,
        },
        ruleId: rule.ruleId,
        selectWhen: rule.selectWhen,
        skipWhen: rule.skipWhen,
        sourceAffectedAgentIds: [...rule.affectedAgentIds],
        sourceCandidateAgentIds: [...rule.candidateAgentIds],
        agentResolutions,
        resolvedAffectedAgentIds,
        resolvedCandidateAgentIds,
        maximumSelectedAgents: rule.maximumSelectedAgents,
        teacherGateIds: [section.teacherGate.gateId],
      };
      return {
        ...rulePayload,
        ruleHash: hashV2AgentEvidence(rulePayload),
      };
    });
    const unresolved = chapters.some((chapter) => (
      chapter.agentResolutions.some((resolution) => resolution.status === "unresolved")
    ));
    const releaseHashAligned = release !== null
      && hasCanonicalCourseReleaseHash(release);
    const releaseAligned = release !== null
      && releaseHashAligned
      && release.chapters.length === source.sections.length
      && source.sections.every((section, index) => {
        const chapter = release.chapters[index];
        const event = section.dynamicEvents[0];
        const rule = section.agentSelectionRules[0];
        return chapter !== undefined
          && event !== undefined
          && rule !== undefined
          && chapter.chapterId === section.sectionId
          && chapter.order === section.order
          && sameOrderedValues(
            chapter.availableActionIds,
            section.actions.map((action) => action.actionId),
          )
          && sameOrderedValues(
            chapter.dynamicEventIds,
            section.dynamicEvents.map((candidate) => candidate.eventId),
          )
          && sameOrderedValues(
            chapter.candidateAgentIds,
            [...new Set(section.agentSelectionRules.flatMap(
              (candidate) => candidate.candidateAgentIds,
            ))],
          )
          && sameOrderedValues(
            chapter.teacherGateIds,
            [section.teacherGate.gateId],
          );
      });
    const scenarioPublished = release !== null
      && input.publishedScenarioRefs.some((reference) => (
        reference.scenarioId === release.scenarioReleaseRef.scenarioId
        && reference.version === release.scenarioReleaseRef.version
        && reference.contentHash === release.scenarioReleaseRef.contentHash
      ));
    const runtimeEligibility = unresolved
      ? {
          status: "unresolved_agent_ref" as const,
          reasonCode: "unresolved_agent_reference",
          explanation: "课程规则仍包含未登记的智能体引用，运行与消融均失败关闭。",
        }
      : release === null || isContentOnly(release)
        ? {
            status: "content_only" as const,
            reasonCode: "runtime_scenario_not_published",
            explanation: "课程内容已冻结，但真实运行情境尚未发布，不生成运行观察。",
          }
        : !releaseAligned
          ? {
              status: "version_hash_drift" as const,
              reasonCode: "course_rule_release_drift",
              explanation: "活动课程发布版与冻结章节、事件或候选智能体规则不一致。",
            }
          : !scenarioPublished
            ? {
                status: "runtime_unavailable" as const,
                reasonCode: "scenario_release_not_registered",
                explanation: "课程引用的情境发布版未在服务端目录中精确注册。",
              }
        : {
            status: "runtime_ready" as const,
            reasonCode: "runtime_release_exact_match",
            explanation: "课程、情境与智能体规则均已按不可变引用精确发布。",
          };
    const effectiveRelease = release ?? {
      courseId: source.releaseRef.courseId,
      releaseId: source.releaseRef.releaseId,
      version: 1,
      contentHash: source.releaseRef.contentHash,
      scenarioReleaseRef: {
        scenarioId: `scenario-${source.releaseRef.courseId.replace(/^course-/u, "")}`,
        version: "2.0.0-content.1",
        contentHash: source.releaseRef.contentHash,
      },
    };
    return {
      courseReleaseRef: {
        courseId: effectiveRelease.courseId,
        releaseId: effectiveRelease.releaseId,
        version: effectiveRelease.version,
        contentHash: effectiveRelease.contentHash,
      },
      scenarioReleaseRef: structuredClone(effectiveRelease.scenarioReleaseRef),
      runtimeEligibility,
      chapters,
    };
  });
  const topologyHash = hashV2AgentEvidence({
    groups: input.topology.groups,
    agents: input.topology.agents,
    edges: input.topology.edges,
  });
  const contentSnapshotHash = hashV2AgentEvidence(
    courseContentReleases.map((release) => release.releaseRef),
  );
  const stableRuleSet = {
    schemaVersion: CrossCourseAgentRuleManifestSchemaVersion,
    manifestId: "v2-cross-course-agent-rules",
    topologyHash,
    baselineTopologyAgentIds: input.topology.agents.map((agent) => agent.agentId),
    contentSnapshotHash,
    courses,
  };
  const manifestWithoutHash = { ...stableRuleSet, generatedAt };
  return verifyCrossCourseAgentRuleManifestIntegrity({
    ...manifestWithoutHash,
    manifestHash: hashV2AgentEvidence(stableRuleSet),
  });
}

export function verifyCrossCourseAgentRuleManifestIntegrity(
  value: unknown,
): CrossCourseAgentRuleManifest {
  const manifest = CrossCourseAgentRuleManifestSchema.parse(value);
  const stableRuleSet = {
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    topologyHash: manifest.topologyHash,
    baselineTopologyAgentIds: manifest.baselineTopologyAgentIds,
    contentSnapshotHash: manifest.contentSnapshotHash,
    courses: manifest.courses,
  };
  if (hashV2AgentEvidence(stableRuleSet) !== manifest.manifestHash) {
    throw new Error("跨课程智能体规则清单哈希漂移");
  }
  return manifest;
}

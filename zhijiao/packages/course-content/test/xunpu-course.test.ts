import { describe, expect, it } from "vitest";
import { CourseReleaseSchema } from "@ronggang/contracts";
import {
  canonicalStringify,
  hashCourseContentRelease,
  hashKnowledgeRecord,
  publishInteractiveXunpuContractCourseRelease,
  publishXunpuContractCourseRelease,
  validateCourseContentRelease,
  xunpuContractCourseRelease,
  xunpuCourseRelease,
  xunpuCourseSectionIds,
  xunpuKnowledgeRecordCount,
} from "../src/index.js";
import { xunpuCourseFixture } from "./xunpu.fixture.js";

const validationOptions = {
  expectedCourseId: "course-xunpu-intangible-media",
  expectedSectionCount: 7,
  minimumKnowledgeRecordCount: 24,
} as const;

describe("泉州蟳埔旗舰课程内容", () => {
  it("交付 7 个有序小节与 24 条全部可定位、可引用的知识记录", () => {
    const report = validateCourseContentRelease(
      xunpuCourseRelease,
      validationOptions,
    );

    expect(report).toEqual({
      valid: true,
      sectionCount: 7,
      knowledgeRecordCount: 24,
      qualifiedKnowledgeRecordCount: 24,
      referencedKnowledgeRecordCount: 24,
      dynamicEventCount: 7,
      issues: [],
    });
    expect(xunpuKnowledgeRecordCount).toBe(24);
    expect(xunpuCourseSectionIds).toEqual([
      "xunpu-topic-brief",
      "xunpu-source-map",
      "xunpu-interview-plan",
      "xunpu-field-reporting",
      "xunpu-fact-check",
      "xunpu-story-revision",
      "xunpu-publish-review",
    ]);
  });

  it("每节完整声明目标、任务、来源、隐藏事实、动作、事件、智能体、成果、证据、量规、教师门和迁移反思", () => {
    for (const section of xunpuCourseRelease.sections) {
      expect(section.objectives.length).toBeGreaterThan(0);
      expect(section.taskBrief.length).toBeGreaterThan(20);
      expect(section.publicSourceKnowledgeIds.length).toBeGreaterThan(0);
      expect(section.hiddenFacts.length).toBeGreaterThan(0);
      expect(section.hiddenFacts.every((fact) => (
        fact.visibility === "teacher_and_engine"
        && fact.summary.startsWith("仿真")
      ))).toBe(true);
      expect(section.actions.length).toBeGreaterThan(0);
      expect(section.actions.filter((action) => action.primary)).toHaveLength(1);
      expect(section.dynamicEvents.length).toBeGreaterThan(0);
      expect(section.agentSelectionRules.length).toBeGreaterThan(0);
      expect(section.artifact.completionCriteria.length).toBeGreaterThan(0);
      expect(section.evidenceRequirements.length).toBeGreaterThan(0);
      expect(section.rubric.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
      expect(section.teacherGate.checks.length).toBeGreaterThan(0);
      expect(section.migrationReflection.requiredComparisonDimensions.length)
        .toBeGreaterThan(0);
    }
    expect(xunpuCourseRelease.sections.filter((section) => (
      section.artifact.finalCourseArtifact
    ))).toHaveLength(1);
  });

  it("冻结记者单主岗、单条建议和采纳/补证/拒绝决定", () => {
    expect(xunpuCourseRelease.primaryJob).toEqual({
      jobId: "integrated-media-reporter",
      label: "融媒体采编岗",
      learnerRoleId: "reporter",
      learnerRoleLabel: "记者",
    });
    for (const section of xunpuCourseRelease.sections) {
      expect(section.adviceDecisionPolicy).toEqual({
        allowedDecisions: ["accept", "request_more_evidence", "reject"],
        rationaleRequiredOnReject: true,
        onlyOneVisibleSuggestionAtATime: true,
      });
      for (const rule of section.agentSelectionRules) {
        expect(rule.maximumSelectedAgents).toBeLessThanOrEqual(
          rule.candidateAgentIds.length,
        );
        expect(rule.skipWhen.length).toBeGreaterThan(0);
      }
    }
    expect(xunpuCourseRelease.sections[1]?.actions.some((action) => (
      action.intent === "decide_agent_contribution"
    ))).toBe(true);
  });

  it("导出严格 CourseRelease/2.0.0 兼容快照供 A 轨冻结 Schema 解析", () => {
    const parsed = CourseReleaseSchema.parse(xunpuContractCourseRelease);
    expect(Object.keys(xunpuContractCourseRelease).sort()).toEqual([
      "chapters",
      "contentHash",
      "courseId",
      "primaryJob",
      "publishedAt",
      "releaseId",
      "releaseStatus",
      "scenarioReleaseRef",
      "schemaVersion",
      "sources",
      "studentDecisionOptions",
      "summary",
      "title",
      "version",
    ]);
    expect(xunpuContractCourseRelease.schemaVersion).toBe(
      "course-release/2.0.0",
    );
    expect(xunpuContractCourseRelease.releaseStatus).toBe("released");
    expect(xunpuContractCourseRelease.version).toBe(1);
    expect(xunpuContractCourseRelease.sources).toHaveLength(24);
    expect(xunpuContractCourseRelease.chapters).toHaveLength(7);
    expect(xunpuContractCourseRelease.chapters.at(-1)?.finalChapter).toBe(true);
    expect(xunpuContractCourseRelease.studentDecisionOptions).toEqual([
      "accept",
      "request_evidence",
      "reject",
    ]);
    expect(parsed.contentHash).toBe(xunpuContractCourseRelease.contentHash);
  });

  it("知识记录具备来源、locator、版本、状态与独立稳定哈希", () => {
    const hashes = new Set<string>();
    for (const record of xunpuCourseRelease.knowledgeRecords) {
      expect(record.source.url).toMatch(/^https:\/\//u);
      expect(record.source.locator.length).toBeGreaterThan(4);
      expect(record.source.sourceVersion.length).toBeGreaterThan(4);
      expect(record.source.accessStatus).toBe("reachable_on_check_date");
      expect(record.source.storedExcerpt).toBeNull();
      expect(record.reviewStatus).toBe("pending_expert_review");
      expect(record.reusePolicy).toBe("metadata_link_and_paraphrase_only");
      expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(hashKnowledgeRecord(record)).toBe(record.contentHash);
      hashes.add(record.contentHash);
    }
    expect(hashes).toHaveLength(24);
    expect(xunpuCourseRelease.knowledgeRecords.find((record) => (
      record.knowledgeId === "xunpu-k014-source-status-over-topic-match"
    ))?.source.publicationStatus).toBe("historical_status_marker");
  });

  it("课程与知识哈希对键序无关，对内容变化敏感", () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, list: [2, 1] };
    const right = { list: [2, 1], nested: { a: 1, b: 2 }, z: 1 };
    expect(canonicalStringify(left)).toBe(canonicalStringify(right));
    expect(hashCourseContentRelease(xunpuCourseRelease)).toBe(
      xunpuCourseRelease.releaseRef.contentHash,
    );
    expect(hashCourseContentRelease(xunpuCourseFixture())).toBe(
      xunpuCourseRelease.releaseRef.contentHash,
    );

    const tampered = xunpuCourseFixture();
    tampered.sections[0]!.title = "被篡改的小节标题";
    expect(hashCourseContentRelease(tampered)).not.toBe(
      xunpuCourseRelease.releaseRef.contentHash,
    );
    expect(validateCourseContentRelease(tampered, validationOptions).issues)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "course_hash_drift" }),
      ]));
  });

  it("内容发布对象被深冻结且调用方只能克隆后适配", () => {
    expect(Object.isFrozen(xunpuCourseRelease)).toBe(true);
    expect(Object.isFrozen(xunpuCourseRelease.releaseRef)).toBe(true);
    expect(Object.isFrozen(xunpuCourseRelease.sections)).toBe(true);
    expect(Object.isFrozen(xunpuCourseRelease.sections[0])).toBe(true);
    expect(Object.isFrozen(xunpuCourseRelease.knowledgeRecords)).toBe(true);
    expect(Object.isFrozen(xunpuCourseRelease.knowledgeRecords[0]?.source)).toBe(true);
  });

  it("以新不可变发布版绑定真实情境引用而不改写内容快照", () => {
    const published = publishXunpuContractCourseRelease({
      scenarioId: "scenario-xunpu-media",
      version: "2.0.0",
      contentHash: "a".repeat(64),
    });
    expect(CourseReleaseSchema.parse(published)).toEqual(published);
    expect(published).toMatchObject({
      version: 2,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.1",
      scenarioReleaseRef: {
        scenarioId: "scenario-xunpu-media",
        version: "2.0.0",
        contentHash: "a".repeat(64),
      },
    });
    expect(published.contentHash).not.toBe(
      xunpuContractCourseRelease.contentHash,
    );
    expect(xunpuContractCourseRelease.version).toBe(1);
    expect(xunpuContractCourseRelease.scenarioReleaseRef.version).toBe(
      "2.0.0-content.1",
    );
    expect(Object.isFrozen(published)).toBe(true);
  });

  it("为可交互情境发布第三个不可变课程版本并保留历史运行版", () => {
    const interactive = publishInteractiveXunpuContractCourseRelease({
      scenarioId: "scenario-xunpu-media",
      version: "2.0.1",
      contentHash: "b".repeat(64),
    });
    expect(CourseReleaseSchema.parse(interactive)).toEqual(interactive);
    expect(interactive).toMatchObject({
      version: 3,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.2",
      scenarioReleaseRef: {
        scenarioId: "scenario-xunpu-media",
        version: "2.0.1",
        contentHash: "b".repeat(64),
      },
    });
    expect(interactive.contentHash).not.toBe(
      publishXunpuContractCourseRelease({
        scenarioId: "scenario-xunpu-media",
        version: "2.0.0",
        contentHash: "a".repeat(64),
      }).contentHash,
    );
    expect(Object.isFrozen(interactive)).toBe(true);
  });

  it("拒绝缺节、未知知识、坏来源、知识漂移和非记者主岗", () => {
    const malformed = xunpuCourseFixture();
    malformed.sections.pop();
    malformed.sections[0]!.publicSourceKnowledgeIds = ["unknown-knowledge"];
    malformed.knowledgeRecords[0]!.source.url = "http://example.invalid/source";
    malformed.knowledgeRecords[1]!.teachingSummary = "漂移";
    malformed.primaryJob.learnerRoleId = "editor" as "reporter";

    const report = validateCourseContentRelease(malformed, validationOptions);
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "section_count" }),
      expect.objectContaining({ code: "unknown_knowledge" }),
      expect.objectContaining({ code: "source_url" }),
      expect.objectContaining({ code: "knowledge_hash_drift" }),
      expect.objectContaining({ code: "learner_role" }),
      expect.objectContaining({ code: "course_hash_drift" }),
    ]));
  });

  it("不包含未授权图片、音频、视频、LOGO 文件或来源原文", () => {
    const serialized = JSON.stringify(xunpuCourseRelease);
    expect(xunpuCourseRelease.mediaPolicy.repositoryMediaAssets).toEqual([]);
    expect(serialized).not.toMatch(/file:\/\//iu);
    expect(serialized).not.toMatch(
      /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav)(?:[?"#]|$)/iu,
    );
    expect(serialized).not.toMatch(/data:(?:image|audio|video)\//iu);
    expect(xunpuCourseRelease.knowledgeRecords.every((record) => (
      record.source.storedExcerpt === null
      && /不复制|不保存/u.test(record.source.rightsNote)
    ))).toBe(true);
  });

  it("检测显式媒体资产与课程级哈希漂移", () => {
    const malformed = xunpuCourseFixture() as unknown as ReturnType<
      typeof xunpuCourseFixture
    > & { mediaPolicy: { repositoryMediaAssets: string[] } };
    malformed.mediaPolicy.repositoryMediaAssets.push("unlicensed-photo.jpg");

    const report = validateCourseContentRelease(malformed, validationOptions);
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unlicensed_media" }),
      expect.objectContaining({ code: "embedded_media_reference" }),
      expect.objectContaining({ code: "course_hash_drift" }),
    ]));
  });
});

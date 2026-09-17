import { describe, expect, it } from "vitest";
import { CourseReleaseSchema } from "@ronggang/contracts";
import {
  aiCopyrightContractCourseRelease,
  aiCopyrightCourseRelease,
  aiCopyrightKnowledgeRecordCount,
  courseContentKnowledgeRecordCount,
  courseContentReleaseCount,
  courseContentReleases,
  courseContentSectionCount,
  hashCourseContentRelease,
  hashKnowledgeRecord,
  migrationContractCourseReleases,
  migrationKnowledgeRecordCount,
  migrationKnowledgeRecords,
  rainEmergencyContractCourseRelease,
  rainEmergencyCourseRelease,
  rainEmergencyKnowledgeRecordCount,
  validateCourseContentRelease,
  villagePostpublicationContractCourseRelease,
  villagePostpublicationCourseRelease,
  villagePostpublicationKnowledgeRecordCount,
  villageSuperContractCourseRelease,
  villageSuperCourseRelease,
  villageSuperKnowledgeRecordCount,
  type CourseContentRelease,
} from "../src/index.js";
import { migrationCourseFixture } from "./migration.fixture.js";

const migrationCourses = [
  villageSuperCourseRelease,
  villagePostpublicationCourseRelease,
  aiCopyrightCourseRelease,
  rainEmergencyCourseRelease,
] as const;

const expected = [
  {
    content: villageSuperCourseRelease,
    contract: villageSuperContractCourseRelease,
    courseId: "course-village-super-multiplatform",
    releaseId: "release-course-village-super-multiplatform-2.0.0-content.1",
    scenarioId: "scenario-village-super-multiplatform",
    chapters: [
      "village-super-platform-map",
      "village-super-story-angle",
      "village-super-storyboard",
      "village-super-live-update",
      "village-super-platform-adaptation",
      "village-super-data-review",
    ],
  },
  {
    content: villagePostpublicationCourseRelease,
    contract: villagePostpublicationContractCourseRelease,
    courseId: "course-village-super-postpublication-context",
    releaseId: "release-course-village-super-postpublication-context-1.0.0-content.1",
    scenarioId: "scenario-village-super-postpublication-context",
    chapters: [
      "village-postpublication-context-triage",
      "village-postpublication-interview-audit",
      "village-postpublication-scope-negotiation",
      "village-postpublication-multiplatform-correction",
      "village-postpublication-impact-review",
    ],
  },
  {
    content: aiCopyrightCourseRelease,
    contract: aiCopyrightContractCourseRelease,
    courseId: "course-ai-tourism-copyright-governance",
    releaseId: "release-course-ai-tourism-copyright-governance-2.0.0-content.1",
    scenarioId: "scenario-ai-tourism-copyright-governance",
    chapters: [
      "ai-copyright-source-ledger",
      "ai-copyright-generation-assessment",
      "ai-copyright-rights-check",
      "ai-copyright-labeling",
      "ai-copyright-platform-review",
      "ai-copyright-complaint-correction",
    ],
  },
  {
    content: rainEmergencyCourseRelease,
    contract: rainEmergencyContractCourseRelease,
    courseId: "course-scenic-rain-emergency-reporting",
    releaseId: "release-course-scenic-rain-emergency-reporting-2.0.0-content.1",
    scenarioId: "scenario-scenic-rain-emergency-reporting",
    chapters: [
      "rain-warning-verification",
      "rain-closure-brief",
      "rain-visitor-guidance",
      "rain-rumor-check",
      "rain-reopen-criteria",
      "rain-multiplatform-continuous-update",
    ],
  },
] as const;

const knownAgentIds = new Set([
  "agent-teaching",
  "agent-scene-director",
  "agent-interviewee",
  "agent-chief",
  "agent-fact-checker",
  "agent-copyright",
  "agent-governance-copyright",
  "agent-governance-content-safety",
  "agent-governance-platform-rule",
  "agent-platform",
  "agent-evidence-assessor",
  "agent-work-quality-assessor",
  "agent-collaboration-assessor",
  "agent-learning",
]);

describe("CONTENT-007/013 迁移课程", () => {
  it("四门迁移内容发布均通过完整性验证并严格使用冻结课程与章节 ID", () => {
    for (const item of expected) {
      const report = validateCourseContentRelease(item.content, {
        expectedCourseId: item.courseId,
        expectedSectionCount: item.content === villagePostpublicationCourseRelease ? 5 : 6,
        minimumKnowledgeRecordCount: item.content === villagePostpublicationCourseRelease ? 10 : 12,
      });
      const expectedSectionCount = item.content === villagePostpublicationCourseRelease ? 5 : 6;
      const expectedKnowledgeCount = item.content === villagePostpublicationCourseRelease ? 10 : 12;
      expect(report).toEqual({
        valid: true,
        sectionCount: expectedSectionCount,
        knowledgeRecordCount: expectedKnowledgeCount,
        qualifiedKnowledgeRecordCount: expectedKnowledgeCount,
        referencedKnowledgeRecordCount: expectedKnowledgeCount,
        dynamicEventCount: expectedSectionCount,
        issues: [],
      });
      expect(item.content.releaseRef.releaseId).toBe(item.releaseId);
      expect(item.content.releaseRef.version).toBe(
        item.content === villagePostpublicationCourseRelease
          ? "1.0.0-content.1"
          : "2.0.0-content.1",
      );
      expect(item.content.sections.map((section) => section.sectionId))
        .toEqual(item.chapters);
    }
  });

  it("五门课程合计 30 节与 70 条可定位知识，CONTENT-013 保留独立来源记录", () => {
    expect(courseContentReleaseCount).toBe(5);
    expect(courseContentSectionCount).toBe(30);
    expect(courseContentKnowledgeRecordCount).toBe(70);
    expect(courseContentReleases.map((course) => course.releaseRef.courseId))
      .toHaveLength(5);
    expect(migrationKnowledgeRecordCount).toBe(36);
    expect(villageSuperKnowledgeRecordCount).toBe(12);
    expect(villagePostpublicationKnowledgeRecordCount).toBe(10);
    expect(aiCopyrightKnowledgeRecordCount).toBe(12);
    expect(rainEmergencyKnowledgeRecordCount).toBe(12);
  });

  it("每节具备任务、仿真事实、三项动作、动态事件、单条建议、证据、100 分量规、教师门和迁移反思", () => {
    for (const course of migrationCourses) {
      for (const section of course.sections) {
        expect(section.objectives).toHaveLength(3);
        expect(section.taskBrief.length).toBeGreaterThan(30);
        expect(section.publicSourceKnowledgeIds.length).toBeGreaterThan(0);
        expect(section.hiddenFacts.length).toBeGreaterThan(0);
        expect(section.hiddenFacts.every((fact) => (
          fact.visibility === "teacher_and_engine"
          && fact.summary.startsWith("仿真情境：")
        ))).toBe(true);
        expect(section.actions).toHaveLength(3);
        expect(section.actions.filter((action) => action.primary)).toHaveLength(1);
        expect(section.dynamicEvents).toHaveLength(1);
        expect(section.agentSelectionRules).toHaveLength(1);
        expect(section.adviceDecisionPolicy).toEqual({
          allowedDecisions: ["accept", "request_more_evidence", "reject"],
          rationaleRequiredOnReject: true,
          onlyOneVisibleSuggestionAtATime: true,
        });
        expect(section.evidenceRequirements).toHaveLength(3);
        expect(section.rubric.reduce((total, criterion) => (
          total + criterion.weight
        ), 0)).toBe(100);
        expect(section.teacherGate.checks.length).toBeGreaterThan(0);
        expect(section.migrationReflection.requiredComparisonDimensions.length)
          .toBeGreaterThan(0);
      }
      expect(course.sections.filter((section) => (
        section.artifact.finalCourseArtifact
      ))).toHaveLength(1);
      expect(course.sections.at(-1)?.artifact.finalCourseArtifact).toBe(true);
      expect(course.sections.some((section) => (
        section.dynamicEvents[0]?.teacherApprovalRequired
      ))).toBe(true);
    }
  });

  it("候选与受影响智能体均来自冻结六组十四智能体且按事件选择必要子集", () => {
    for (const course of migrationCourses) {
      for (const section of course.sections) {
        const event = section.dynamicEvents[0]!;
        const rule = section.agentSelectionRules[0]!;
        for (const agentId of [
          ...event.candidateAgentIds,
          ...event.affectedAgentIds,
          ...rule.candidateAgentIds,
          ...rule.affectedAgentIds,
        ]) {
          expect(knownAgentIds.has(agentId)).toBe(true);
        }
        expect(rule.maximumSelectedAgents).toBeLessThan(
          knownAgentIds.size,
        );
        expect(rule.maximumSelectedAgents).toBeLessThanOrEqual(
          rule.candidateAgentIds.length,
        );
        expect(rule.skipWhen.length).toBeGreaterThan(10);
      }
    }
  });

  it("36 条知识记录全部具备 HTTPS、日期、定位、版本、待外审状态、版权边界与独立稳定 SHA-256", () => {
    const ids = new Set<string>();
    const hashes = new Set<string>();
    for (const record of migrationKnowledgeRecords) {
      expect(record.source.url).toMatch(/^https:\/\//u);
      expect(record.source.publicationDate).toMatch(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u);
      expect(record.source.accessedAt).toBe("2026-08-09");
      expect(record.source.locator.length).toBeGreaterThan(4);
      expect(record.source.sourceVersion.length).toBeGreaterThan(4);
      expect(record.source.accessStatus).toBe("reachable_on_check_date");
      expect(record.source.storedExcerpt).toBeNull();
      expect(record.source.rightsNote).toMatch(/不复制|不保存/u);
      expect(record.reviewStatus).toBe("pending_expert_review");
      expect(record.reusePolicy).toBe("metadata_link_and_paraphrase_only");
      expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(hashKnowledgeRecord(record)).toBe(record.contentHash);
      ids.add(record.knowledgeId);
      hashes.add(record.contentHash);
    }
    expect(ids.size).toBe(36);
    expect(hashes.size).toBe(36);
  });

  it("四门 CourseRelease/2.0.0 均可解析且明确保持 content-only scenario 占位", () => {
    expect(migrationContractCourseReleases).toHaveLength(4);
    for (const item of expected) {
      expect(CourseReleaseSchema.parse(item.contract)).toEqual(item.contract);
      expect(item.contract).toMatchObject({
        schemaVersion: "course-release/2.0.0",
        courseId: item.courseId,
        releaseId: item.releaseId,
        version: 1,
        scenarioReleaseRef: {
          scenarioId: item.scenarioId,
          version: item.content === villagePostpublicationCourseRelease
            ? "1.0.0-content.1"
            : "2.0.0-content.1",
        },
        studentDecisionOptions: ["accept", "request_evidence", "reject"],
      });
      expect(item.contract.chapters).toHaveLength(item.content.sections.length);
      expect(item.contract.sources).toHaveLength(item.content.knowledgeRecords.length);
    }
  });

  it("公开课程契约只暴露隐藏事实引用，不泄漏仿真事实摘要或事件内部载荷", () => {
    const villageSerialized = JSON.stringify(villageSuperContractCourseRelease);
    const aiSerialized = JSON.stringify(aiCopyrightContractCourseRelease);
    const rainSerialized = JSON.stringify(rainEmergencyContractCourseRelease);
    expect(villageSerialized).not.toContain("两份平台数据使用了不同统计时间窗");
    expect(villageSerialized).not.toContain("短视频素材仍按原窗口交付");
    expect(aiSerialized).not.toContain("购买生成工具会员即自动取得所有商业发布权");
    expect(aiSerialized).not.toContain("平台尚未批准，任何世界发布写入都必须保持关闭");
    expect(rainSerialized).not.toContain("景区正在会商，尚未形成闭园决定");
    expect(rainSerialized).not.toContain("旧缓存和合作账号构成两个待修复渠道");
    for (const contract of migrationContractCourseReleases) {
      expect(contract.chapters.every((chapter) => (
        chapter.hiddenFactRefs.length > 0
      ))).toBe(true);
    }
  });

  it("课程与知识哈希确定性稳定，任何内容漂移均失败关闭", () => {
    for (const course of migrationCourses) {
      const clone = migrationCourseFixture(course);
      expect(hashCourseContentRelease(clone)).toBe(
        course.releaseRef.contentHash,
      );
      clone.sections[0]!.taskBrief = "篡改后的任务";
      const report = validateCourseContentRelease(clone);
      expect(report.valid).toBe(false);
      expect(report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "course_hash_drift" }),
      ]));
    }
  });

  it("拒绝重复 ID、重复知识哈希、坏版权说明和未知来源引用", () => {
    const duplicate = migrationCourseFixture(villageSuperCourseRelease);
    duplicate.sections[0]!.actions[1]!.actionId =
      duplicate.sections[0]!.actions[0]!.actionId;
    duplicate.knowledgeRecords[1]!.contentHash =
      duplicate.knowledgeRecords[0]!.contentHash;
    duplicate.knowledgeRecords[2]!.source.rightsNote = "可自由复制全部内容";
    duplicate.sections[0]!.publicSourceKnowledgeIds = ["unknown-source-record"];
    const report = validateCourseContentRelease(duplicate);
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_id" }),
      expect.objectContaining({ code: "copyright_note" }),
      expect.objectContaining({ code: "unknown_knowledge" }),
      expect.objectContaining({ code: "knowledge_hash_drift" }),
      expect.objectContaining({ code: "course_hash_drift" }),
    ]));
  });

  it("拒绝隐藏事实越界、未标注仿真以及未授权媒体引用", () => {
    const malformed = migrationCourseFixture(rainEmergencyCourseRelease) as unknown as
      ReturnType<typeof migrationCourseFixture> & {
        mediaPolicy: { repositoryMediaAssets: string[] };
      };
    malformed.sections[0]!.hiddenFacts[0]!.visibility = "student" as "teacher_and_engine";
    malformed.sections[0]!.hiddenFacts[0]!.summary = "真实景区已经闭园";
    malformed.mediaPolicy.repositoryMediaAssets.push("rain-photo.jpg");
    const report = validateCourseContentRelease(
      malformed as CourseContentRelease,
    );
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "hidden_fact_visibility" }),
      expect.objectContaining({ code: "hidden_fact_isolation" }),
      expect.objectContaining({ code: "unlicensed_media" }),
      expect.objectContaining({ code: "embedded_media_reference" }),
      expect.objectContaining({ code: "course_hash_drift" }),
    ]));
  });

  it("内容包不复制未授权图像、音视频、页面截图或原文摘录", () => {
    for (const course of migrationCourses) {
      const serialized = JSON.stringify(course);
      expect(course.mediaPolicy.repositoryMediaAssets).toEqual([]);
      expect(serialized).not.toMatch(/file:\/\//iu);
      expect(serialized).not.toMatch(
        /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav)(?:[?"#]|$)/iu,
      );
      expect(serialized).not.toMatch(/data:(?:image|audio|video)\//iu);
      expect(course.knowledgeRecords.every((record) => (
        record.source.storedExcerpt === null
      ))).toBe(true);
    }
  });

  it("课程发布对象与嵌套数据均为不可变快照", () => {
    for (const course of migrationCourses) {
      expect(Object.isFrozen(course)).toBe(true);
      expect(Object.isFrozen(course.releaseRef)).toBe(true);
      expect(Object.isFrozen(course.sections)).toBe(true);
      expect(Object.isFrozen(course.sections[0])).toBe(true);
      expect(Object.isFrozen(course.knowledgeRecords)).toBe(true);
      expect(Object.isFrozen(course.knowledgeRecords[0]?.source)).toBe(true);
    }
  });
});

import {
  aiCopyrightCourseRelease,
  publishRuntimeContractCourseRelease,
  rainEmergencyCourseRelease,
  villagePostpublicationCourseRelease,
  villageSuperCourseRelease,
} from "@ronggang/course-content";
import {
  buildMigrationRuntimeScenario,
  type MigrationRuntimeScenarioProfile,
} from "./migration-runtime-scenario.js";
import { createStaticScenarioRelease } from "./scenario-resolver.js";

const villageRuntime1Profile: MigrationRuntimeScenarioProfile = {
  scenarioId: "scenario-village-super-multiplatform",
  version: "2.0.0",
  teamId: "team-village-super-01",
  startVirtualTime: "15:00",
  openingBrief: "先确认多平台共同事实底座，再依次完成受众地图、选题、分镜、直播更新、平台适配与数据复盘。",
  simulationDomain: "village-super-multiplatform-reporting",
};

const aiCopyrightRuntime1Profile: MigrationRuntimeScenarioProfile = {
  scenarioId: "scenario-ai-tourism-copyright-governance",
  version: "2.0.0",
  teamId: "team-ai-copyright-01",
  startVirtualTime: "10:00",
  openingBrief: "先登记素材与生成链，再完成生成判断、权利核查、内容标识、平台预检和投诉更正。",
  simulationDomain: "ai-tourism-copyright-governance",
};

const rainRuntime1Profile: MigrationRuntimeScenarioProfile = {
  scenarioId: "scenario-scenic-rain-emergency-reporting",
  version: "2.0.0",
  teamId: "team-rain-emergency-01",
  startVirtualTime: "08:00",
  openingBrief: "先核验气象预警，再连续完成闭园快讯、游客疏导、谣言核查、复开条件与多平台更新。",
  simulationDomain: "scenic-rain-emergency-reporting",
};

const villagePostpublicationRuntime1Profile: MigrationRuntimeScenarioProfile = {
  scenarioId: "scenario-village-super-postpublication-context",
  version: "1.0.0",
  teamId: "team-village-postpublication-01",
  startVirtualTime: "18:00",
  openingBrief: "从已发布的仿真村超短视频收到语境质疑开始，先核对完整采访与旧剪辑，再协商人物范围、跨平台回应、更正送审和影响复盘。",
  simulationDomain: "village-super-postpublication-context",
};

const successorProfile = (
  profile: MigrationRuntimeScenarioProfile,
): MigrationRuntimeScenarioProfile => ({
  ...profile,
  version: "2.0.1",
  intermediateBusinessReviewMode: "completion_teacher_gate",
});
const villagePostpublicationSuccessorProfile: MigrationRuntimeScenarioProfile = {
  ...villagePostpublicationRuntime1Profile,
  version: "1.0.1",
  intermediateBusinessReviewMode: "completion_teacher_gate",
};

const villageRuntime1Build = buildMigrationRuntimeScenario(
  villageSuperCourseRelease,
  villageRuntime1Profile,
);
const aiCopyrightRuntime1Build = buildMigrationRuntimeScenario(
  aiCopyrightCourseRelease,
  aiCopyrightRuntime1Profile,
);
const rainRuntime1Build = buildMigrationRuntimeScenario(
  rainEmergencyCourseRelease,
  rainRuntime1Profile,
);
const villagePostpublicationRuntime1Build = buildMigrationRuntimeScenario(
  villagePostpublicationCourseRelease,
  villagePostpublicationRuntime1Profile,
);

const villageBuild = buildMigrationRuntimeScenario(
  villageSuperCourseRelease,
  successorProfile(villageRuntime1Profile),
);
const aiCopyrightBuild = buildMigrationRuntimeScenario(
  aiCopyrightCourseRelease,
  successorProfile(aiCopyrightRuntime1Profile),
);
const rainBuild = buildMigrationRuntimeScenario(
  rainEmergencyCourseRelease,
  successorProfile(rainRuntime1Profile),
);
const villagePostpublicationBuild = buildMigrationRuntimeScenario(
  villagePostpublicationCourseRelease,
  villagePostpublicationSuccessorProfile,
);

// Immutable runtime.1 lineage retained for historical sessions.
export const villageSuperRuntime1Scenario = villageRuntime1Build.scenario;
export const aiCopyrightRuntime1Scenario = aiCopyrightRuntime1Build.scenario;
export const rainEmergencyRuntime1Scenario = rainRuntime1Build.scenario;
export const villagePostpublicationRuntime1Scenario = villagePostpublicationRuntime1Build.scenario;

export const villageSuperRuntime1SeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-village-super-multiplatform-2.0.0-baseline",
  package: villageSuperRuntime1Scenario,
  publishedAt: "2026-08-09T15:00:00.000Z",
});
export const aiCopyrightRuntime1SeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-ai-tourism-copyright-governance-2.0.0-baseline",
  package: aiCopyrightRuntime1Scenario,
  publishedAt: "2026-08-09T15:00:00.000Z",
});
export const rainEmergencyRuntime1SeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-scenic-rain-emergency-reporting-2.0.0-baseline",
  package: rainEmergencyRuntime1Scenario,
  publishedAt: "2026-08-09T15:00:00.000Z",
});
export const villagePostpublicationRuntime1SeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-village-super-postpublication-context-1.0.0-baseline",
  package: villagePostpublicationRuntime1Scenario,
  publishedAt: "2026-09-07T00:00:00.000Z",
});

export const villageSuperRuntime1ScenarioContentHash =
  "e27066fbc3dc25811af3f1973ac1238e3884dfb86e9f7fdb50e1aa16be0f694a";
export const aiCopyrightRuntime1ScenarioContentHash =
  "ba1f6ec1f0ba66e9145987773d680db71192e6cb07b59c499706f7ee9303d196";
export const rainEmergencyRuntime1ScenarioContentHash =
  "a5a5faf8a37c287db8e4bdcae6f05980d6d6613d1138bae75c3092108a46de9c";
export const villagePostpublicationRuntime1ScenarioContentHash =
  villagePostpublicationRuntime1SeedRelease.ref.contentHash;

export const villageSuperRuntime1CourseRelease =
  publishRuntimeContractCourseRelease(
    villageSuperCourseRelease,
    villageSuperRuntime1SeedRelease.ref,
    {
      releaseId: "release-course-village-super-multiplatform-2.0.0-runtime.1",
      version: 2,
      publishedAt: "2026-08-09T15:05:00.000Z",
    },
  );
export const aiCopyrightRuntime1CourseRelease =
  publishRuntimeContractCourseRelease(
    aiCopyrightCourseRelease,
    aiCopyrightRuntime1SeedRelease.ref,
    {
      releaseId: "release-course-ai-tourism-copyright-governance-2.0.0-runtime.1",
      version: 2,
      publishedAt: "2026-08-09T15:05:00.000Z",
    },
  );
export const rainEmergencyRuntime1CourseRelease =
  publishRuntimeContractCourseRelease(
    rainEmergencyCourseRelease,
    rainEmergencyRuntime1SeedRelease.ref,
    {
      releaseId: "release-course-scenic-rain-emergency-reporting-2.0.0-runtime.1",
      version: 2,
      publishedAt: "2026-08-09T15:05:00.000Z",
    },
  );
export const villagePostpublicationRuntime1CourseRelease =
  publishRuntimeContractCourseRelease(
    villagePostpublicationCourseRelease,
    villagePostpublicationRuntime1SeedRelease.ref,
    {
      releaseId: "release-course-village-super-postpublication-context-1.0.0-runtime.1",
      version: 2,
      publishedAt: "2026-09-07T00:05:00.000Z",
    },
  );

export const villageSuperRuntime1CourseContentHash =
  "bcdd310bfcf1c7eab59176a0aa743b9949a8b4239b99c88ae25ef58481ff3491";
export const aiCopyrightRuntime1CourseContentHash =
  "67cdc4d1dcaab6fffa5ae52072af9e3c725edc7cc18f813de10bf086394102e3";
export const rainEmergencyRuntime1CourseContentHash =
  "5e9f1208f8338a5688c03e6ae4e9ebda8ac3d62b57277351e47fa44610771757";
export const villagePostpublicationRuntime1CourseContentHash =
  villagePostpublicationRuntime1CourseRelease.contentHash;

export const migrationRuntime1Scenarios = Object.freeze([
  villageSuperRuntime1Scenario,
  villagePostpublicationRuntime1Scenario,
  aiCopyrightRuntime1Scenario,
  rainEmergencyRuntime1Scenario,
]);
export const migrationRuntime1SeedReleases = Object.freeze([
  villageSuperRuntime1SeedRelease,
  villagePostpublicationRuntime1SeedRelease,
  aiCopyrightRuntime1SeedRelease,
  rainEmergencyRuntime1SeedRelease,
]);
export const migrationRuntime1CourseReleases = Object.freeze([
  villageSuperRuntime1CourseRelease,
  villagePostpublicationRuntime1CourseRelease,
  aiCopyrightRuntime1CourseRelease,
  rainEmergencyRuntime1CourseRelease,
]);

// runtime.2 is the active successor: authored order and a single reachable X
// gate; intermediate B events remain authoritative but create no candidate.
export const villageSuperRuntimeScenario = villageBuild.scenario;
export const villageSuperRuntimeSectionMappings = villageBuild.sectionMappings;
export const aiCopyrightRuntimeScenario = aiCopyrightBuild.scenario;
export const aiCopyrightRuntimeSectionMappings = aiCopyrightBuild.sectionMappings;
export const rainEmergencyRuntimeScenario = rainBuild.scenario;
export const villagePostpublicationRuntimeScenario = villagePostpublicationBuild.scenario;
export const villagePostpublicationRuntimeSectionMappings = villagePostpublicationBuild.sectionMappings;
export const rainEmergencyRuntimeSectionMappings = rainBuild.sectionMappings;

export const villageSuperRuntimeSeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-village-super-multiplatform-2.0.1-authored-sequence",
  package: villageSuperRuntimeScenario,
  publishedAt: "2026-08-10T00:30:00.000Z",
});
export const aiCopyrightRuntimeSeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-ai-tourism-copyright-governance-2.0.1-authored-sequence",
  package: aiCopyrightRuntimeScenario,
  publishedAt: "2026-08-10T00:30:00.000Z",
});
export const rainEmergencyRuntimeSeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-scenic-rain-emergency-reporting-2.0.1-authored-sequence",
  package: rainEmergencyRuntimeScenario,
  publishedAt: "2026-08-10T00:30:00.000Z",
});
export const villagePostpublicationRuntimeSeedRelease = createStaticScenarioRelease({
  releaseId: "release-scenario-village-super-postpublication-context-1.0.1-authored-sequence",
  package: villagePostpublicationRuntimeScenario,
  publishedAt: "2026-09-07T00:30:00.000Z",
});

// Frozen after ScenarioPackageSchema parsing and canonical release hashing.
export const villageSuperRuntimeScenarioContentHash =
  "fe770d1de7fa40951d06b65821377b7ae950db73b85e162d89415f32d6f19899";
export const aiCopyrightRuntimeScenarioContentHash =
  "02adeb97ab7df90bb7fb85ada06edcd10ba6f476a0206b985fbd28013a74ea5c";
export const rainEmergencyRuntimeScenarioContentHash =
  "db8e066a0216455c7bd941ff4b02037b5339a35b96185c016c520fcab8c21aa0";
export const villagePostpublicationRuntimeScenarioContentHash =
  villagePostpublicationRuntimeSeedRelease.ref.contentHash;

export const villageSuperRuntimeCourseRelease =
  publishRuntimeContractCourseRelease(
    villageSuperCourseRelease,
    villageSuperRuntimeSeedRelease.ref,
    {
      releaseId: "release-course-village-super-multiplatform-2.0.0-runtime.2",
      version: 3,
      publishedAt: "2026-08-10T00:35:00.000Z",
    },
  );
export const aiCopyrightRuntimeCourseRelease =
  publishRuntimeContractCourseRelease(
    aiCopyrightCourseRelease,
    aiCopyrightRuntimeSeedRelease.ref,
    {
      releaseId: "release-course-ai-tourism-copyright-governance-2.0.0-runtime.2",
      version: 3,
      publishedAt: "2026-08-10T00:35:00.000Z",
    },
  );
export const rainEmergencyRuntimeCourseRelease =
  publishRuntimeContractCourseRelease(
    rainEmergencyCourseRelease,
    rainEmergencyRuntimeSeedRelease.ref,
    {
      releaseId: "release-course-scenic-rain-emergency-reporting-2.0.0-runtime.2",
      version: 3,
      publishedAt: "2026-08-10T00:35:00.000Z",
    },
  );
export const villagePostpublicationRuntimeCourseRelease =
  publishRuntimeContractCourseRelease(
    villagePostpublicationCourseRelease,
    villagePostpublicationRuntimeSeedRelease.ref,
    {
      releaseId: "release-course-village-super-postpublication-context-1.0.0-runtime.2",
      version: 3,
      publishedAt: "2026-09-07T00:35:00.000Z",
    },
  );

export const villagePostpublicationRuntimeLaunchSuggestion = Object.freeze({
  courseId: "course-village-super-postpublication-context",
  scenarioId: "scenario-village-super-postpublication-context",
  runtimeScenarioReleaseId: villagePostpublicationRuntimeSeedRelease.ref.releaseId,
  runtimeCourseReleaseId: villagePostpublicationRuntimeCourseRelease.releaseId,
  entryNodeId: "village-postpublication-context-triage",
  studentRoleId: "reporter",
  sessionIdPrefix: "session-village-postpublication-context",
  launchMode: "new_session_only" as const,
  note: "新独立案例只为新会话签发；旧 course-village-super-multiplatform 会话不迁移、不改写。",
});

// Frozen immutable CourseRelease/2.0.0 hashes for server-side drift checks.
export const villageSuperRuntimeCourseContentHash =
  "661d4b118ac032657a3f67e06377098d4c0daa7fec8ce3f289d816ba3448927f";
export const aiCopyrightRuntimeCourseContentHash =
  "e1f888d464a5562b9797287d3d72ba726099a8990d0c6174824c07d963976633";
export const rainEmergencyRuntimeCourseContentHash =
  "cc18cb1586ceb218540a1b388ae589d20ce4869c2e93f0020648482c58bd8e6c";
export const villagePostpublicationRuntimeCourseContentHash =
  villagePostpublicationRuntimeCourseRelease.contentHash;

export const migrationRuntimeScenarios = Object.freeze([
  villageSuperRuntimeScenario,
  villagePostpublicationRuntimeScenario,
  aiCopyrightRuntimeScenario,
  rainEmergencyRuntimeScenario,
]);
export const migrationRuntimeSeedReleases = Object.freeze([
  villageSuperRuntimeSeedRelease,
  villagePostpublicationRuntimeSeedRelease,
  aiCopyrightRuntimeSeedRelease,
  rainEmergencyRuntimeSeedRelease,
]);
export const migrationRuntimeCourseReleases = Object.freeze([
  villageSuperRuntimeCourseRelease,
  villagePostpublicationRuntimeCourseRelease,
  aiCopyrightRuntimeCourseRelease,
  rainEmergencyRuntimeCourseRelease,
]);

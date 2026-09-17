import { hashCanonical } from "@ronggang/course-content";
import type { ContentStore } from "@ronggang/content-store";
import { buildContentLibrarySeed, type ContentLibrarySeedRecord } from "./content-library.js";

const curatorVersion = "xunpu-independent-sources/2026-09-07.1";
const curated = [
  {
    knowledgeId: "xunpu-k001-heritage-status-boundary", claimRef: "claim-heritage-listing-2008",
    teachingSummary: "国务院公布的第二批国家级非物质文化遗产名录收录蟳埔女习俗，序号1004、编号Ⅹ—97、申报地区为福建省泉州市丰泽区。教学报道应把名录项目身份与簪花围具体技艺的地方标准区分，不能写成2007年已入选。",
    sourceId: "source-curated-xunpu-national-list-2008", title: "国务院关于公布第二批国家级非物质文化遗产名录和第一批国家级非物质文化遗产扩展项目名录的通知",
    publisher: "国务院（文化和旅游部政府信息公开）", url: "https://zwgk.mct.gov.cn/zfxxgkml/fwzwhyc/202012/t20201210_918992.html",
    publicationDate: "2008-06-07", locator: "第二批名录民俗类：序号1004、编号Ⅹ—97、蟳埔女习俗",
    sourceVersion: "国发〔2008〕19号，原文2008-06-07；文旅部公开页2010-01-13；教学整理2026-09-07",
  },
  {
    knowledgeId: "xunpu-k018-network-claim-needs-verification", claimRef: "claim-source-verification",
    teachingSummary: "新闻职业伦理要求认真核实消息来源，保持信息真实、准确、全面、客观；发现报道失实时及时更正。课程将这些要求转化为来源矩阵、原始定位和公开更正记录，不能以转引次数替代核验。",
    sourceId: "source-curated-xunpu-journalism-ethics-2019", title: "中国新闻工作者职业道德准则", publisher: "中国记协（新华社受权播发）",
    url: "https://www.xinhuanet.com/politics/2019-12/15/c_1125348618.htm", publicationDate: "2019-12-15", locator: "第三条第1—4项：新闻真实性、消息来源核实与更正要求",
    sourceVersion: "2019年修订发布文本；教学整理2026-09-07",
  },
  {
    knowledgeId: "xunpu-k033-ai-explicit-label", claimRef: "claim-ai-label",
    teachingSummary: "深度合成服务可能导致公众混淆或者误认时，应在生成或编辑内容的合理位置作显著标识，向公众说明深度合成情况；其他适用服务也应提供相应标识功能。课程据此检查可见提示，并结合2025年现行标识办法核对发布场景。",
    sourceId: "source-curated-xunpu-deep-synthesis-2022", title: "互联网信息服务深度合成管理规定", publisher: "国家互联网信息办公室、工业和信息化部、公安部",
    url: "https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm", publicationDate: "2022-12-11", locator: "第三章第十六至十八条，重点第十七条",
    sourceVersion: "三部门令第12号；2023-01-10施行；教学整理2026-09-07",
  },
  {
    knowledgeId: "xunpu-k034-ai-implicit-label", claimRef: "claim-ai-label",
    teachingSummary: "GB 45438—2025第6.1节规定文件元数据隐式标识要素，包含生成合成属性、服务提供者名称或编码，以及内容制作和传播编号，并规定相应格式。媒体制作应同时核对可见提示与文件元数据，不能用仅有的可见水印代替隐式标识检查。",
    sourceId: "source-curated-xunpu-gb45438-2025", title: "网络安全技术 人工智能生成合成内容标识方法（GB 45438—2025）", publisher: "国家市场监督管理总局、国家标准化管理委员会",
    url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F32EA2A561F1886CD8D606513512D547", publicationDate: "2025-02-28",
    locator: "第6.1节及附录E、F；标准正文第4页（政府公开PDF第8页）", sourceVersion: "GB 45438—2025；2025-09-01实施；教学整理2026-09-07",
  },
] as const;

export function buildFlagshipKnowledgeCurations(): Array<{ originalHash: string; record: ContentLibrarySeedRecord }> {
  const seeds = new Map(buildContentLibrarySeed().map((seed) => [seed.knowledgeId, seed]));
  return curated.map(({ claimRef, teachingSummary, knowledgeId, ...source }) => {
    const original = seeds.get(knowledgeId);
    if (!original?.contentHash) throw new Error(`旗舰补源缺少原知识记录：${knowledgeId}`);
    const record: ContentLibrarySeedRecord = { ...original, teachingSummary,
      source: { ...source, accessedAt: "2026-09-07T00:00:00.000Z", rightsNote: "公开来源元数据与教学转译；未将外部原件字节随源码发布，仍待专业教师复核。" },
      reviewStatus: "pending_expert_review", reviewNote: "依据不同原始文件补齐支撑，保留既有课程版本；本整理不代表教师外审。",
      metadata: { ...original.metadata, curatorVersion, previousBundledHash: original.contentHash,
        groundedClaimRelations: [{ claimRef, relation: "supports" }] },
    };
    record.contentHash = hashCanonical({ ...record, contentHash: null });
    return { originalHash: original.contentHash, record };
  });
}

/** An append-only bundled revision; teacher changes and revoked grants always win. */
export async function applyFlagshipKnowledgeCurations(store: ContentStore): Promise<void> {
  for (const { originalHash, record } of buildFlagshipKnowledgeCurations()) {
    let current = await store.getKnowledge(record.knowledgeId);
    if (!current) continue;
    if (current.contentHash === originalHash) {
      await store.importKnowledgeSeed([record]);
      current = await store.getKnowledge(record.knowledgeId);
    }
    if (!current || current.contentHash !== record.contentHash || !current.sourceRevisionId) continue;
    for (const purpose of ["teaching", "model_context"] as const) {
      const grants = await store.listUsageGrants({ sourceRevisionId: current.sourceRevisionId, purpose });
      if (grants.some((grant) => grant.courseId === record.courseId && grant.subjectRef == null)) continue;
      await store.grantUsage({ sourceRevisionId: current.sourceRevisionId, courseId: record.courseId, purpose, scope: "course",
        grantedBy: curatorVersion, note: "公开来源教学整理；原件未入库时不得称原文，专业审核保持待复核。" });
    }
  }
}

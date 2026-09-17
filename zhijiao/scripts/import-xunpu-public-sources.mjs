import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit teacher-side import. It never opens an active PGlite directory or re-grants an existing upload.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const base = option("--origin");
if (!base) throw new Error("用法：node scripts/import-xunpu-public-sources.mjs --origin http://127.0.0.1:4176 [--report .local/已有目录/source-import.json]");
const origin = new URL(base);
if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || origin.username || origin.password || origin.search) throw new Error("本工具只连接明确指定的本机演示服务");
const courseId = "course-xunpu-intangible-media";
const profileId = option("--profile") ?? "teacher-class-a";
const files = [
  {
    sourceKey: "official-xunpu-technique-standard-2024", file: "资料/04-职业教育依据/04-蟳埔簪花围技艺-DB3505T16-2024.pdf",
    title: "非物质文化遗产 蟳埔女习俗 簪花围技艺（官方原件）", publisher: "泉州市市场监督管理局、泉州市文化广电和旅游局", publicationDate: "2024-07-17",
    canonicalUrl: "https://scjgj.quanzhou.gov.cn/xxgk/zfxxgk/fdzdgknr/ywgz/202407/P020240722394947013233.pdf",
    sha256: "a1fb7fede7ef2524c1df9f9a690d346439fb02cdfddada0b52548ce70239de6a",
    knowledgeIds: ["xunpu-k002-custom-and-zanhuawei-definition", "xunpu-k003-cultural-respect", "xunpu-k004-technique-sequence", "xunpu-k005-daily-festival-difference", "xunpu-k006-documentation-and-archive", "xunpu-k007-transmission-and-public-communication"],
  },
  {
    sourceKey: "official-moe-media-standard-2025", file: "资料/04-职业教育依据/03-融媒体技术与运营专业教学标准-2025.pdf",
    title: "融媒体技术与运营专业教学标准（高等职业教育专科，官方原件）", publisher: "教育部", publicationDate: null,
    canonicalUrl: "https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548141306012.pdf",
    sha256: "8b2e4f20f6e9095ff768e57cf759eab480d1abca39b09c7febef687272f6c600",
    knowledgeIds: ["xunpu-k022-real-project-scenario-teaching", "xunpu-k023-integrated-production-workflow"],
  },
];
const loaded = await Promise.all(files.map(async (file) => {
  const bytes = await readFile(resolve(root, file.file));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`原件哈希不匹配：${file.file}`);
  return { ...file, bytes };
}));
const login = await fetch(new URL("/api/auth/demo-session", origin), { method: "POST", headers: { origin: origin.origin, "content-type": "application/json" }, body: JSON.stringify({ profileId, sessionId: "demo-xunpu-v2" }) });
if (!login.ok) throw new Error(`教师演示身份进入失败：${login.status}`);
const auth = await login.json();
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie || !auth.csrfToken || !auth.principal?.principalId) throw new Error("教师会话响应不完整");
async function request(path, body) {
  const response = await fetch(new URL(path, origin), { method: body === undefined ? "GET" : "POST", headers: {
    cookie, origin: origin.origin, "content-type": "application/json", ...(body === undefined ? {} : { "x-csrf-token": auth.csrfToken }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`资料接口${response.status}：${path}；${result.message ?? result.error ?? "请求失败"}`);
  return result;
}
const jobs = (await request("/api/content-library/jobs")).jobs;
const knowledge = (await request(`/api/content-library/knowledge?courseId=${courseId}&limit=200`)).knowledge;
const report = { createdAt: new Date().toISOString(), origin: origin.origin, courseId, originals: [], knowledgeUpdates: [], preservedKnowledge: [] };
for (const file of loaded) {
  const sourceId = `material-${createHash("sha256").update(JSON.stringify([auth.principal.principalId, courseId, file.sourceKey])).digest("hex").slice(0, 32)}`;
  const previous = jobs.find(job => job.sourceId === sourceId && job.status === "succeeded" && job.parsedRevisionId);
  let imported;
  if (previous) {
    const { revision } = await request(`/api/content-library/revisions/${encodeURIComponent(previous.parsedRevisionId)}`);
    if (revision.sourceByteHash !== file.sha256) throw new Error(`已有资料与目标原件不同：${sourceId}`);
    imported = { sourceId, status: "existing_preserved", sourceByteHash: file.sha256, parsedRevisionId: previous.parsedRevisionId };
  } else {
    imported = (await request("/api/content-library/materials", {
      courseId, sourceKey: file.sourceKey, title: file.title, kind: "course_material", fileName: file.file.split("/").at(-1),
      mimeType: "application/pdf", contentBase64: file.bytes.toString("base64"), publisher: file.publisher, canonicalUrl: file.canonicalUrl,
      ...(file.publicationDate ? { publicationDate: file.publicationDate } : {}), allowModelContext: true,
      rightsNote: "从发布机构官网取得的公开标准原件，用于本课程教学、资料核验与模型上下文。原件取得不代表专业复核完成；不授予其他用途或替代素材权利核验。",
    })).material;
    if (!imported.parsedRevisionId || !["completed", "already_completed"].includes(imported.status)) throw new Error(`原件已保存但解析尚未完成：${sourceId}`);
  }
  report.originals.push({ file: file.file, bytes: file.bytes.length, ...imported });
  for (const knowledgeId of file.knowledgeIds) {
    const existing = knowledge.find(record => record.knowledgeId === knowledgeId);
    if (!existing) throw new Error(`知识未发布：${knowledgeId}`);
    if (existing.sourceRevisionId === imported.parsedRevisionId || existing.revisionNumber !== 1) {
      report.preservedKnowledge.push({ knowledgeId, revisionNumber: existing.revisionNumber, reason: existing.sourceRevisionId === imported.parsedRevisionId ? "already_bound" : "existing_revision_preserved" });
      continue;
    }
    const result = await request("/api/content-library/knowledge", {
      knowledgeId, courseId, sourceRevisionId: imported.parsedRevisionId, title: existing.title, teachingSummary: existing.teachingSummary,
      applicableSectionIds: existing.applicableSectionIds ?? [], tags: existing.tags ?? [], groundedClaimRelations: existing.metadata?.groundedClaimRelations ?? [],
    });
    report.knowledgeUpdates.push({ knowledgeId, revisionNumber: result.knowledge.revisionNumber, sourceRevisionId: imported.parsedRevisionId, reviewStatus: result.knowledge.reviewStatus });
  }
}
const output = option("--report");
if (output) {
  const path = resolve(root, output), child = relative(resolve(root, ".local"), path);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("报告只能放在项目.local内的已有目录");
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(report, null, 2));

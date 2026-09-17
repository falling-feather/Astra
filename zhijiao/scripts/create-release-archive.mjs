import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  resolve,
} from "node:path";
import {
  captureCommand,
  projectRoot,
  runCommand,
} from "./lib/release-process.mjs";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-dir");
const repositoryRoot = projectRoot;
const outputDir = resolve(
  outputIndex >= 0
    ? args[outputIndex + 1] ?? ""
    : resolve(repositoryRoot, "release-artifacts"),
);
if (outputIndex >= 0 && !args[outputIndex + 1]) {
  throw new Error("--output-dir 缺少目录");
}
const packageJson = JSON.parse(await readFile(
  resolve(projectRoot, "package.json"),
  "utf8",
));
const version = String(packageJson.version);
const status = (await captureCommand("git", ["status", "--porcelain"], {
  cwd: repositoryRoot,
})).stdout.trim();
if (status) throw new Error("正式源码归档要求干净工作树");
const head = (await captureCommand("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
})).stdout.trim();
const tagName = `V${version}`;
const tagType = (await captureCommand(
  "git",
  ["cat-file", "-t", tagName],
  { cwd: repositoryRoot },
)).stdout.trim();
if (tagType !== "tag") throw new Error(`${tagName} 必须是 annotated tag`);
const target = (await captureCommand(
  "git",
  ["rev-list", "-n", "1", tagName],
  { cwd: repositoryRoot },
)).stdout.trim();
if (target !== head) throw new Error(`${tagName} 未指向当前 HEAD`);

const lockfileSha256 = createHash("sha256").update(
  await readFile(resolve(projectRoot, "pnpm-lock.yaml")),
).digest("hex");
let releaseCheck;
try {
  releaseCheck = JSON.parse(await readFile(
    resolve(projectRoot, ".release-audit", "release-check.json"),
    "utf8",
  ));
} catch (error) {
  throw new Error(
    `正式源码归档缺少最终 release-check 收据：${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
if (
  releaseCheck.schema !== "ronggang.release-check.v1"
  || releaseCheck.status !== "verified"
  || releaseCheck.policy?.cleanRequired !== true
  || releaseCheck.policy?.annotatedTagRequired !== true
  || releaseCheck.audit?.schema !== "ronggang.release-audit.v1"
  || releaseCheck.audit?.status !== "verified"
  || releaseCheck.audit?.version !== version
  || releaseCheck.audit?.productVersion !== version
  || releaseCheck.audit?.lockfileSha256 !== lockfileSha256
  || releaseCheck.audit?.git?.head !== head
  || releaseCheck.audit?.git?.clean !== true
  || releaseCheck.audit?.git?.tagType !== "tag"
  || releaseCheck.audit?.git?.tagTarget !== head
  || !releaseCheck.audit?.releaseEvidence
) {
  throw new Error(
    "最终 release-check 收据未绑定当前版本、锁文件、HEAD、annotated tag 或完整发布证据",
  );
}

await mkdir(outputDir, { recursive: true });
const archivePath = resolve(outputDir, `ronggang-v${version}-source.zip`);
await runCommand("git", [
  "archive",
  "--format=zip",
  `--output=${archivePath}`,
  "HEAD",
  "--",
  ".gitattributes",
  ".gitignore",
  "doc/00-项目总纲.md",
  "doc/01-开发者文档.md",
  "doc/02-项目规划.md",
  "doc/03-开发历史.md",
  "doc/04-智能体设计架构.md",
  "doc/01-子文档",
  "doc/02-子文档",
  "doc/03-子文档",
  "doc/image",
  "资料/资料索引.md",
  "资料/01-赛事要求",
  "资料/02-浙传专业特色",
  "资料/03-智能体技术路线",
  "资料/04-职业教育依据",
  ".env.example",
  ".node-version",
  ".nvmrc",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  "启动职教星云.cmd",
  "启动职教星云.ps1",
  "tsconfig.base.json",
  "apps",
  "artifacts",
  "e2e",
  "packages",
  "scripts",
  "deploy",
], {
  cwd: repositoryRoot,
  label: "release source archive",
});
const digest = createHash("sha256")
  .update(await readFile(archivePath))
  .digest("hex");
const checksumPath = `${archivePath}.sha256`;
await writeFile(
  checksumPath,
  `${digest}  ${basename(archivePath)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  schema: "ronggang.release-source-archive.v1",
  status: "verified",
  version,
  head,
  tagName,
  releaseCheckAt: releaseCheck.checkedAt,
  lockfileSha256,
  archivePath,
  checksumPath,
  sha256: digest,
  excludedSensitiveArchives: [
    "doc/05-对话快照",
    "资料/90-历史资料归档",
    "资料/91-视觉与演示资产",
  ],
}, null, 2)}\n`);

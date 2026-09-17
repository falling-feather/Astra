import {
  access,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  relative,
  resolve,
} from "node:path";
import { projectRoot } from "./lib/release-process.mjs";
import { validatePlanningReservations } from "./lib/planning-document.mjs";

const repositoryRoot = projectRoot;
const docRoot = resolve(repositoryRoot, "doc");
const requiredDocuments = [
  "00-项目总纲.md",
  "01-开发者文档.md",
  "02-项目规划.md",
  "03-开发历史.md",
  "04-智能体设计架构.md",
];

try {
  await access(docRoot);
} catch (error) {
  if (
    error.code === "ENOENT"
    && process.env.RONGGANG_DOC_CHECK_OPTIONAL === "1"
  ) {
    process.stdout.write(
      "release docs check skipped: standalone source package has no repository doc root\n",
    );
    process.exit(0);
  }
  throw new Error(`缺少项目文档目录：${docRoot}`);
}

const documents = new Map(await Promise.all(requiredDocuments.map(
  async (name) => [
    name,
    await readFile(resolve(docRoot, name), "utf8"),
  ],
)));
const packageJson = JSON.parse(await readFile(
  resolve(projectRoot, "package.json"),
  "utf8",
));
const productVersionSource = await readFile(
  resolve(projectRoot, "packages/contracts/src/version.ts"),
  "utf8",
);
const productVersion = productVersionSource.match(
  /export const ProductVersion = "([^"]+)" as const;/u,
)?.[1];
if (productVersion !== packageJson.version) {
  throw new Error(
    `ProductVersion ${String(productVersion)} 与根 manifest ${String(packageJson.version)} 不一致`,
  );
}
const expectedVersion = `V${packageJson.version}`;
const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
for (const name of requiredDocuments) {
  const text = documents.get(name);
  if (!text?.startsWith("# ")) {
    throw new Error(`${name} 缺少一级标题`);
  }
}
if (!new RegExp(
  `^\\| 当前开发版本 \\| \`${escapedVersion}\``,
  "mu",
).test(documents.get("00-项目总纲.md"))) {
  throw new Error(`00-项目总纲未登记当前版本 ${expectedVersion}`);
}
if (!new RegExp(
  `^> \\*\\*文档梗概\\*\\*：记录当前 \`${escapedVersion}\``,
  "mu",
).test(documents.get("01-开发者文档.md"))) {
  throw new Error(`01-开发者文档未登记当前版本 ${expectedVersion}`);
}
if (!new RegExp(
  `^> \\*\\*文档梗概\\*\\*：[^\\n]*当前发布(?:基线|候选)为 \`${escapedVersion}\``,
  "mu",
).test(documents.get("03-开发历史.md"))) {
  throw new Error(`03-开发历史当前发布基线不是 ${expectedVersion}`);
}
if (!new RegExp(`\`${escapedVersion}\``, "u").test(
  documents.get("04-智能体设计架构.md").slice(0, 4_000),
)) {
  throw new Error(`04-智能体设计架构开篇未登记 ${expectedVersion}`);
}

const planning = validatePlanningReservations(documents.get("02-项目规划.md"));
const planningSummary = planning.summary;

async function collectMarkdownFiles(directory) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await collectMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(path);
    }
  }
  return result;
}

const linkDocumentPaths = [
  ...requiredDocuments.map((name) => resolve(docRoot, name)),
  ...await collectMarkdownFiles(resolve(docRoot, "01-子文档")),
  ...await collectMarkdownFiles(resolve(docRoot, "02-子文档")),
  ...await collectMarkdownFiles(resolve(docRoot, "03-子文档")),
];
for (const path of linkDocumentPaths) {
  const name = relative(docRoot, path).replaceAll("\\", "/");
  const text = await readFile(path, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/gu;
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (
      target.startsWith("#")
      || /^[a-z]+:\/\//iu.test(target)
      || target.startsWith("mailto:")
    ) {
      continue;
    }
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    target = target.split("#", 1)[0];
    if (!target) continue;
    const targetPath = resolve(dirname(path), target);
    try {
      await access(targetPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`${name} 含失效本地链接：${match[1]}`);
      }
      throw error;
    }
  }
}

process.stdout.write(
  `release docs ok: ${requiredDocuments.length} primary documents, ${linkDocumentPaths.length} linked documents, ${planning.taskCount} tasks, product=${expectedVersion}, planning=${planningSummary}\n`,
);

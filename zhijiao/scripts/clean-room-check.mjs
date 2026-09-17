import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  captureCommand,
  pnpmExecutable,
  projectRoot,
  runCommand,
} from "./lib/release-process.mjs";
import { assertRuntimePrerequisites } from "./check-runtime-prerequisites.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const buildOnly = args.includes("--build-only");
const allowDirty = args.includes("--allow-dirty");
const skipBrowserInstall =
  process.env.CLEAN_ROOM_SKIP_BROWSER_INSTALL === "1";
if (!buildOnly && skipBrowserInstall) {
  throw new Error(
    "full clean-room 不允许跳过 Chromium 安装；如只需构建检查请使用 --build-only",
  );
}
const keep = process.env.CLEAN_ROOM_KEEP === "1";
const repositoryRoot = projectRoot;
const receiptPath = resolve(
  projectRoot,
  ".release-audit",
  "clean-room-check.json",
);
await rm(receiptPath, { force: true });
const version = String(JSON.parse(await readFile(
  resolve(projectRoot, "package.json"),
  "utf8",
)).version);
const gitStatus = (await captureCommand(
  "git",
  ["status", "--porcelain"],
  {
    cwd: repositoryRoot,
    label: "inspect clean-room source status",
  },
)).stdout.trim();
const sourceClean = gitStatus.length === 0;
if (!sourceClean && !allowDirty) {
  throw new Error(
    "clean-room 发布收据要求干净工作树；开发态检查必须显式使用 --allow-dirty",
  );
}
const candidateHead = (await captureCommand(
  "git",
  ["rev-parse", "HEAD"],
  {
    cwd: repositoryRoot,
    label: "resolve clean-room candidate HEAD",
  },
)).stdout.trim();
const candidateTree = (await captureCommand(
  "git",
  ["rev-parse", "HEAD^{tree}"],
  {
    cwd: repositoryRoot,
    label: "resolve clean-room candidate tree",
  },
)).stdout.trim();
const lockfileSha256 = createHash("sha256").update(
  await readFile(resolve(projectRoot, "pnpm-lock.yaml")),
).digest("hex");
const tempParent = resolve(projectRoot, '.local', 'release-validation');
await mkdir(tempParent, { recursive: true });
const root = await mkdtemp(join(tempParent, "ronggang-clean-room-"));
const cleanProject = resolve(root, "source");

function copyFilter(source) {
  const pathFromRoot = relative(projectRoot, source);
  if (!pathFromRoot) return true;
  const segments = pathFromRoot.split(sep);
  if (
    segments[0] === "资料"
    && (
      segments[1] === "90-历史资料归档"
      || segments[1] === "91-视觉与演示资产"
    )
  ) {
    return false;
  }
  return !segments.some((segment) => (
    segment === "node_modules"
    || segment === "dist"
    || segment === "coverage"
    || segment === ".env"
    || segment === ".env.local"
    || segment === ".local-secrets"
    || segment === ".local"
    || segment === "playwright-report"
    || segment === "test-results"
    || segment === ".release-audit"
    || segment === ".git"
    || segment === ".pnpm-store"
    || segment === ".vite"
    || segment === ".data"
    || segment === ".data-demo"
    || segment.startsWith(".data-")
  ));
}

async function assertMissing(path, label) {
  try {
    await lstat(path);
    throw new Error(`干净源副本意外包含 ${label}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

try {
  await assertRuntimePrerequisites();
  const sourceFiles = (await captureCommand('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
  ], {cwd: projectRoot})).stdout.split('\0').filter(Boolean);
  await mkdir(cleanProject, {recursive: true});
  const copiedFiles = [];
  for (const name of new Set(sourceFiles)) {
    const source = resolve(projectRoot, name);
    if (!source.startsWith(`${resolve(projectRoot)}${sep}`) || !copyFilter(source)) continue;
    try { await lstat(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const target = resolve(cleanProject, name);
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target);
    copiedFiles.push(name);
  }
  // The exported tree has no Git metadata. Retain exactly the source enumeration
  // so the same secret scanner can inspect it without touching private files.
  await writeFile(resolve(cleanProject, '.release-source-files.json'), JSON.stringify(copiedFiles), 'utf8');
  await Promise.all([
    assertMissing(resolve(cleanProject, "node_modules"), "node_modules"),
    assertMissing(resolve(cleanProject, "dist"), "dist"),
    assertMissing(resolve(cleanProject, ".env.local"), ".env.local"),
    assertMissing(resolve(cleanProject, ".data"), ".data"),
  ]);

  const installArgs = ["install", "--frozen-lockfile"];
  if (process.env.CLEAN_ROOM_OFFLINE === "1") installArgs.push("--offline");
  await runCommand(pnpmExecutable, installArgs, {
    cwd: cleanProject,
    env: { CI: "1" },
    label: "clean-room frozen install",
  });
  if (
    !buildOnly
    && !skipBrowserInstall
  ) {
    await runCommand(
      pnpmExecutable,
      ["browser:install"],
      {
        cwd: cleanProject,
        label: "clean-room Chromium install",
      },
    );
  }
  if (buildOnly) {
    await runCommand(pnpmExecutable, ["preflight"], {
      cwd: cleanProject,
      label: "clean-room prerequisites",
    });
    await runCommand(pnpmExecutable, ["check:versions"], {
      cwd: cleanProject,
      label: "clean-room version audit",
    });
    await runCommand(pnpmExecutable, ["build"], {
      cwd: cleanProject,
      label: "clean-room production build",
    });
  } else {
    await runCommand(pnpmExecutable, ["check"], {
      cwd: cleanProject,
      env: { RONGGANG_DOC_CHECK_OPTIONAL: "1", RONGGANG_EXPORTED_SOURCE: "1" },
      label: "clean-room full gate",
    });
  }
  const receipt = {
    schema: "ronggang.clean-room-check.v1",
    checkedAt: new Date().toISOString(),
    status: !buildOnly && sourceClean
      ? "verified"
      : "candidate_verified",
    version,
    mode: buildOnly ? "build-only" : "full",
    candidateHead,
    candidateTree,
    sourceClean,
    lockfileSha256,
    sourceExcluded: [
      "node_modules",
      "dist",
      ".env.local",
      ".local-secrets",
      ".local",
      ".data*",
      "资料/90-历史资料归档",
      "资料/91-视觉与演示资产",
    ],
    frozenLockfile: true,
    browserInstall: !buildOnly && !skipBrowserInstall,
    keptAt: keep ? cleanProject : null,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  if (!keep) {
    const resolvedTemp = tempParent;
    const resolvedRoot = resolve(root);
    if (
      resolvedRoot.startsWith(`${resolvedTemp}${sep}`)
      && basename(resolvedRoot).startsWith("ronggang-clean-room-")
    ) {
      await rm(resolvedRoot, { recursive: true, force: true });
    }
  }
}

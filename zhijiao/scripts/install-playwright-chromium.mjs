import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import {
  homedir,
  tmpdir,
} from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import {
  pnpmExecutable,
  projectRoot,
  runCommand,
} from "./lib/release-process.mjs";

async function standardInstall() {
  await runCommand(
    pnpmExecutable,
    ["exec", "playwright", "install", "chromium"],
    {
      cwd: projectRoot,
      label: "Playwright Chromium install",
    },
  );
}

if (process.platform !== "win32") {
  await standardInstall();
  process.stdout.write("Playwright Chromium install verified\n");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const testPackagePath = require.resolve("@playwright/test/package.json");
const testRequire = createRequire(testPackagePath);
const corePackagePath = testRequire.resolve("playwright-core/package.json");
const corePackageRoot = dirname(corePackagePath);
const browsers = JSON.parse(await readFile(
  resolve(corePackageRoot, "browsers.json"),
  "utf8",
)).browsers;
const byName = (name) => {
  const descriptor = browsers.find((browser) => browser.name === name);
  if (!descriptor) throw new Error(`Playwright 缺少浏览器描述：${name}`);
  return descriptor;
};
const chromium = byName("chromium");
const headless = byName("chromium-headless-shell");
const ffmpeg = byName("ffmpeg");
if (
  !/^\d+$/u.test(chromium.revision)
  || chromium.revision !== headless.revision
  || !/^\d+\.\d+\.\d+\.\d+$/u.test(chromium.browserVersion)
  || !/^\d+$/u.test(ffmpeg.revision)
) {
  throw new Error("Playwright 浏览器描述格式不受支持");
}

const configuredBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
const registryRoot = configuredBrowsersPath === "0"
  ? resolve(corePackageRoot, ".local-browsers")
  : configuredBrowsersPath
    ? (
        isAbsolute(configuredBrowsersPath)
          ? resolve(configuredBrowsersPath)
          : resolve(
              process.env.INIT_CWD ?? process.cwd(),
              configuredBrowsersPath,
            )
      )
    : resolve(
        process.env.LOCALAPPDATA
          ?? join(homedir(), "AppData", "Local"),
        "ms-playwright",
      );
await mkdir(registryRoot, { recursive: true });

const downloadRoot = await mkdtemp(
  join(tmpdir(), "ronggang-playwright-install-"),
);
const installations = [
  {
    name: "chromium",
    directory: `chromium-${chromium.revision}`,
    url:
      `https://storage.googleapis.com/chrome-for-testing-public/${chromium.browserVersion}/win64/chrome-win64.zip`,
    executable: join("chrome-win64", "chrome.exe"),
  },
  {
    name: "chromium-headless-shell",
    directory: `chromium_headless_shell-${headless.revision}`,
    url:
      `https://storage.googleapis.com/chrome-for-testing-public/${headless.browserVersion}/win64/chrome-headless-shell-win64.zip`,
    executable: join(
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    ),
  },
  {
    name: "ffmpeg",
    directory: `ffmpeg-${ffmpeg.revision}`,
    url:
      `https://cdn.playwright.dev/builds/ffmpeg/${ffmpeg.revision}/ffmpeg-win64.zip`,
    executable: "ffmpeg-win64.exe",
  },
];

function assertOwnedRegistryPath(path, expectedName) {
  const resolvedPath = resolve(path);
  if (
    dirname(resolvedPath) !== registryRoot
    || basename(resolvedPath) !== expectedName
  ) {
    throw new Error(`拒绝操作非 Playwright 版本目录：${resolvedPath}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function parseRemoteSize(response) {
  const contentRange = response.headers.get("content-range");
  const contentRangeMatch = contentRange?.match(/\/(\d+)$/u);
  const rawSize = contentRangeMatch?.[1]
    ?? response.headers.get("content-length");
  if (!rawSize || !/^\d+$/u.test(rawSize)) return null;
  const size = Number(rawSize);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

async function probeRemoteSize(url, label) {
  let latestError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "accept-encoding": "identity",
        },
        signal: AbortSignal.timeout(30_000),
      });
      const headSize = head.ok ? parseRemoteSize(head) : null;
      if (headSize !== null) return headSize;

      const range = await fetch(url, {
        redirect: "follow",
        headers: {
          "accept-encoding": "identity",
          range: "bytes=0-0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      const rangeSize = range.ok ? parseRemoteSize(range) : null;
      await range.body?.cancel();
      if (rangeSize !== null) return rangeSize;
      throw new Error(
        `HEAD HTTP ${head.status}、Range HTTP ${range.status} 均未返回有效总长度`,
      );
    } catch (error) {
      latestError = error;
      if (attempt < 3) {
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, attempt * 1_000);
        });
      }
    }
  }
  throw new Error(
    `${label} 无法探测远端文件大小`,
    { cause: latestError },
  );
}

function assertOwnedDownloadPath(path, expectedName) {
  const resolvedPath = resolve(path);
  if (
    dirname(resolvedPath) !== downloadRoot
    || basename(resolvedPath) !== expectedName
  ) {
    throw new Error(`拒绝写入非本次下载目录：${resolvedPath}`);
  }
}

async function inspectPartialDownload(outputPath, expectedSize, label) {
  try {
    const entry = await lstat(outputPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`${label} 下载目标不是普通文件：${outputPath}`);
    }
    if (entry.size > expectedSize) {
      throw new Error(
        `${label} 已有部分文件大于远端文件：${entry.size} > ${expectedSize}`,
      );
    }
    return entry.size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function download(url, outputPath, expectedName, label) {
  assertOwnedDownloadPath(outputPath, expectedName);
  const expectedSize = await probeRemoteSize(url, label);
  const partialSize = await inspectPartialDownload(
    outputPath,
    expectedSize,
    label,
  );
  process.stdout.write(
    `Downloading ${label} from official browser storage `
      + `(resume=${partialSize}, total=${expectedSize})\n`,
  );
  if (partialSize < expectedSize) {
    await runCommand(
      "curl.exe",
      [
        "--location",
        "--fail",
        "--show-error",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--continue-at",
        "-",
        "--connect-timeout",
        "30",
        "--speed-limit",
        "1024",
        "--speed-time",
        "90",
        "--retry",
        "8",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--output",
        outputPath,
        url,
      ],
      {
        cwd: downloadRoot,
        label: `${label} resumable download`,
      },
    );
  }
  const actualSize = await inspectPartialDownload(
    outputPath,
    expectedSize,
    label,
  );
  if (
    !Number.isSafeInteger(actualSize)
    || actualSize <= 0
    || actualSize !== expectedSize
  ) {
    throw new Error(
      `${label} 下载大小不一致：期待 ${expectedSize}，实际 ${actualSize}`,
    );
  }
}

try {
  for (const installation of installations) {
    const destination = resolve(registryRoot, installation.directory);
    assertOwnedRegistryPath(destination, installation.directory);
    if (
      await exists(resolve(destination, "INSTALLATION_COMPLETE"))
      && await exists(resolve(destination, installation.executable))
    ) {
      continue;
    }
    const archiveName = `${installation.directory}.zip`;
    const archivePath = resolve(downloadRoot, archiveName);
    const stagingName =
      `.ronggang-${installation.directory}-${randomUUID()}`;
    const staging = resolve(registryRoot, stagingName);
    assertOwnedRegistryPath(staging, stagingName);
    await mkdir(staging, { recursive: false });
    try {
      await download(
        installation.url,
        archivePath,
        archiveName,
        installation.name,
      );
      await runCommand(
        "tar.exe",
        ["-xf", archivePath, "-C", staging],
        {
          cwd: downloadRoot,
          label: `extract ${installation.name}`,
        },
      );
      await access(resolve(staging, installation.executable));
      await writeFile(
        resolve(staging, "INSTALLATION_COMPLETE"),
        "",
        { flag: "wx", mode: 0o600 },
      );
      if (await exists(destination)) {
        await rm(destination, { recursive: true, force: true });
      }
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  await standardInstall();
} finally {
  const resolvedTemp = resolve(tmpdir());
  const resolvedDownloadRoot = resolve(downloadRoot);
  if (
    resolvedDownloadRoot.startsWith(`${resolvedTemp}${sep}`)
    && basename(resolvedDownloadRoot).startsWith(
      "ronggang-playwright-install-",
    )
  ) {
    await rm(resolvedDownloadRoot, { recursive: true, force: true });
  }
}

process.stdout.write(
  "Playwright Chromium install verified from official browser storage\n",
);

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  captureCommand,
  pnpmExecutable,
  projectRoot,
} from "./lib/release-process.mjs";

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (!match) throw new Error(`无法解析版本：${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function versionAtLeast(actual, minimum) {
  return (
    actual.major > minimum.major
    || (
      actual.major === minimum.major
      && (
        actual.minor > minimum.minor
        || (
          actual.minor === minimum.minor
          && actual.patch >= minimum.patch
        )
      )
    )
  );
}

export async function assertRuntimePrerequisites() {
  const packageJson = JSON.parse(await readFile(
    resolve(projectRoot, "package.json"),
    "utf8",
  ));
  const requiredNode = { major: 22, minor: 12, patch: 0 };
  const node = parseVersion(process.version);
  if (!versionAtLeast(node, requiredNode)) {
    throw new Error(
      `需要 Node.js >=22.12.0，当前为 ${process.version}`,
    );
  }
  const declaredManager = String(packageJson.packageManager ?? "");
  const declaredPnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/u.exec(
    declaredManager,
  )?.[1];
  if (!declaredPnpmVersion) {
    throw new Error(
      `packageManager 必须固定精确 pnpm 版本，当前为 ${declaredManager || "未声明"}`,
    );
  }
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent && !userAgent.startsWith("pnpm/")) {
    throw new Error("请使用 Corepack/pnpm 执行项目脚本");
  }
  const userAgentPnpmVersion = /^pnpm\/([^\s]+)/u.exec(userAgent)?.[1];
  const actualPnpmVersion = userAgentPnpmVersion
    ?? (await captureCommand(pnpmExecutable, ["--version"], {
      cwd: projectRoot,
      label: "pnpm --version",
    })).stdout.trim();
  if (actualPnpmVersion !== declaredPnpmVersion) {
    throw new Error(
      `pnpm 版本必须与 packageManager 一致：期待 ${declaredPnpmVersion}，实际 ${actualPnpmVersion}`,
    );
  }
  return {
    node: process.version,
    packageManager: declaredManager,
    pnpmVersion: actualPnpmVersion,
  };
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await assertRuntimePrerequisites();
  process.stdout.write(
    `runtime prerequisites ok: node=${result.node}, ${result.packageManager}\n`,
  );
}

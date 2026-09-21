import { spawn } from "node:child_process";
import {
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  resolve,
  sep,
} from "node:path";

function stateFileForCurrentRun() {
  const runId = (process.env.E2E_RUN_ID ?? "")
    .replace(/[^a-zA-Z0-9._-]/gu, "_");
  return runId
    ? join(tmpdir(), `ronggang-e2e-stack-${runId}.json`)
    : null;
}

async function taskkill(pid) {
  await new Promise((resolvePromise) => {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    killer.once("error", resolvePromise);
    killer.once("exit", resolvePromise);
  });
}

async function terminatePidTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await taskkill(pid);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process is already gone.
    }
  }
}

async function removeOwnedDataDir(dataDir) {
  if (typeof dataDir !== "string" || dataDir.length === 0) return;
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedDataDir = resolve(dataDir);
  const isOwnedDirectory = (
    resolvedDataDir.startsWith(`${resolvedTempRoot}${sep}`)
    && basename(resolvedDataDir).startsWith("ronggang-e2e-")
  );
  if (!isOwnedDirectory) {
    throw new Error(
      `Refusing to remove E2E data outside the owned temp prefix: ${resolvedDataDir}`,
    );
  }
  await rm(resolvedDataDir, { recursive: true, force: true });
  await unlink(resolve(
    dirname(resolvedDataDir),
    `.${basename(resolvedDataDir)}.ronggang-runtime.lock`,
  )).catch(() => undefined);
}

export default async function globalTeardown() {
  const stateFile = stateFileForCurrentRun();
  if (!stateFile) return;

  let state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (state?.schema !== "ronggang.e2e-stack.v1") {
    throw new Error("Refusing to clean an unrecognized E2E stack state file.");
  }

  await terminatePidTree(state.ownerPid);
  await Promise.allSettled(
    (Array.isArray(state.serverPids) ? state.serverPids : [])
      .map(terminatePidTree),
  );
  await removeOwnedDataDir(state.dataDir);
  await unlink(stateFile).catch(() => undefined);
}

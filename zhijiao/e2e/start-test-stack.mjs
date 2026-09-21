import { spawn } from "node:child_process";
import {
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function localHttpLocation(value, label) {
  const location = new URL(value);
  if (
    location.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(location.hostname)
    || location.pathname !== "/"
    || location.search
    || location.hash
  ) {
    throw new Error(`${label} must be a bare local HTTP origin`);
  }
  return location;
}

const apiLocation = localHttpLocation(
  process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3001",
  "E2E_API_ORIGIN",
);
const webLocation = localHttpLocation(
  process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:5173",
  "E2E_WEB_ORIGIN",
);
const apiOrigin = apiLocation.origin;
const webOrigin = webLocation.origin;
const apiPort = apiLocation.port || "80";
const webPort = webLocation.port || "80";
const runId = (process.env.E2E_RUN_ID ?? String(process.pid))
  .replace(/[^a-zA-Z0-9._-]/gu, "_");
const stateFile = join(tmpdir(), `ronggang-e2e-stack-${runId}.json`);
const children = new Set();
const serverPids = new Set();
let dataDir = null;
let shutdownPromise = null;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: options.detached ?? false,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function rejectIfExited(child, label) {
  return new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(new Error(
        `${label} exited before shutdown (code=${code}, signal=${signal ?? "none"})`,
      ));
    });
  });
}

function waitUntilExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    child.once("exit", onExit);
  });
}

function waitForExitWithoutTimeout(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
  });
}

async function waitForUrl(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let latestError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      latestError = `HTTP ${response.status}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${label} did not become ready: ${latestError}`);
}

async function assertUrlUnavailable(url, label) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    throw new Error(
      `${label} endpoint is already reachable at ${url} (HTTP ${response.status}). `
      + "Fresh-data E2E must own its API and Web ports; stop the existing demo stack first.",
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("endpoint is already reachable")) {
      throw error;
    }
  }
}

async function terminateTree(child) {
  if (
    child.pid === undefined
    || child.exitCode !== null
    || child.signalCode !== null
  ) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      killer.once("error", resolvePromise);
      killer.once("exit", resolvePromise);
    });
    if (!await waitUntilExit(child, 5_000)) {
      child.kill("SIGTERM");
      await waitUntilExit(child, 2_000);
    }
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  if (await waitUntilExit(child, 5_000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await waitUntilExit(child, 2_000);
}

async function persistStackState() {
  if (!dataDir) return;
  await writeFile(
    stateFile,
    `${JSON.stringify({
      schema: "ronggang.e2e-stack.v1",
      ownerPid: process.pid,
      createdAt: new Date().toISOString(),
      dataDir,
      serverPids: [...serverPids],
    })}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

async function removeOwnedDataDir() {
  if (!dataDir) return;
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
  dataDir = null;
}

function shutdown(exitCode, reason) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const activeChildren = [...children];
    await Promise.allSettled(activeChildren.map(terminateTree));
    try {
      await removeOwnedDataDir();
    } catch (error) {
      process.stderr.write(
        `[e2e] cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      exitCode = 1;
    }
    await unlink(stateFile).catch(() => undefined);
    if (reason) process.stderr.write(`[e2e] ${reason}\n`);
    process.exit(exitCode);
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    void shutdown(0, null);
  });
}

try {
  await Promise.all([
    assertUrlUnavailable(`${apiOrigin}/health`, "API"),
    assertUrlUnavailable(webOrigin, "Web"),
  ]);
  dataDir = await mkdtemp(join(tmpdir(), "ronggang-e2e-"));
  await persistStackState();
  const api = run(pnpm, ["--filter", "@ronggang/api", "start"], {
    detached: process.platform !== "win32",
    env: {
      HOST: apiLocation.hostname,
      PORT: apiPort,
      DATA_DIR: dataDir,
      MODEL_PROVIDER: "deterministic",
      MODEL_PROFILE_ID: "deterministic-e2e",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_LIVE_SMOKE: "0",
      STARTUP_RECOVERY_MODE: "blocking",
      WEB_ALLOWED_ORIGINS: webOrigin,
    },
  });
  if (api.pid !== undefined) serverPids.add(api.pid);
  await persistStackState();
  const apiExitedEarly = rejectIfExited(api, "API");
  await Promise.race([
    waitForUrl(`${apiOrigin}/health`, "API"),
    apiExitedEarly,
  ]);
  void apiExitedEarly.catch(() => undefined);

  const web = run(pnpm, [
    "--filter",
    "@ronggang/web",
    "preview",
    "--host",
    webLocation.hostname,
    "--port",
    webPort,
    "--strictPort",
  ], {
    detached: process.platform !== "win32",
    env: {
      VITE_API_PROXY_TARGET: apiOrigin,
    },
  });
  if (web.pid !== undefined) serverPids.add(web.pid);
  await persistStackState();
  const webExitedEarly = rejectIfExited(web, "Web");
  // playwright.config.ts owns the Web readiness URL and deadline. A second
  // independent probe must not terminate a stack already accepted by Playwright.
  void webExitedEarly.catch(() => undefined);

  process.stdout.write(
    `[e2e] API ready; Playwright will verify Web readiness; data=${dataDir}\n`,
  );
  await Promise.race([
    waitForExitWithoutTimeout(api),
    waitForExitWithoutTimeout(web),
  ]);
  await shutdown(1, "An E2E server exited unexpectedly.");
} catch (error) {
  await shutdown(
    1,
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
}

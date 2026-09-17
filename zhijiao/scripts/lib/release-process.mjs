import {
  fork,
  spawn,
} from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  dirname,
  resolve,
} from "node:path";

export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const pnpmExecutable = process.platform === "win32"
  ? "corepack.cmd"
  : "corepack";

function childEnvironment(overrides = {}) {
  return {
    ...process.env,
    ...overrides,
  };
}

export function spawnLogged(command, args, options = {}) {
  const launchArgs = command === pnpmExecutable
    ? ["pnpm", ...args]
    : args;
  return spawn(command, launchArgs, {
    cwd: options.cwd ?? projectRoot,
    env: childEnvironment(options.env),
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
}

export function runCommand(command, args, options = {}) {
  const child = spawnLogged(command, args, options);
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(
        `${options.label ?? command} failed (code=${code}, signal=${signal ?? "none"})`,
      ));
    });
  });
}

export function captureCommand(command, args, options = {}) {
  const child = spawnLogged(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${options.label ?? command} failed (code=${code}, signal=${signal ?? "none"}): ${stderr.trim()}`,
      ));
    });
  });
}

export function forkApi(entry, options = {}) {
  return fork(entry, [], {
    cwd: options.cwd ?? projectRoot,
    env: childEnvironment(options.env),
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
}

export function waitForExit(child, timeoutMs) {
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

export async function terminateProcessTree(child, timeoutMs = 8_000) {
  if (
    child.exitCode !== null
    || child.signalCode !== null
    || child.pid === undefined
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
  } else {
    child.kill("SIGTERM");
  }
  if (await waitForExit(child, timeoutMs)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

export async function stopApiGracefully(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(
      `API 在请求优雅停机前已经退出（code=${child.exitCode}, signal=${child.signalCode ?? "none"}）`,
    );
  }
  if (!child.connected) {
    throw new Error("API IPC 已断开，无法证明优雅停机");
  }

  return new Promise((resolvePromise, reject) => {
    let acknowledged = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const onMessage = (message) => {
      if (
        message
        && typeof message === "object"
        && message.type === "ronggang.shutdown-complete.v1"
      ) {
        acknowledged = true;
      }
    };
    const onExit = (code, signal) => {
      if (!acknowledged) {
        finish(new Error(
          `API 未确认 shutdown-complete 即退出（code=${code}, signal=${signal ?? "none"}）`,
        ));
        return;
      }
      if (code !== 0 || signal !== null) {
        finish(new Error(
          `API 确认停机后未干净退出（code=${code}, signal=${signal ?? "none"}）`,
        ));
        return;
      }
      finish(null, {
        acknowledged: true,
        exitCode: code,
        signal,
        mode: "ipc_graceful_close",
      });
    };
    const onError = (error) => finish(error);
    const timer = setTimeout(() => {
      finish(new Error(
        `API 在 ${timeoutMs}ms 内未完成带确认的优雅停机`,
      ));
    }, timeoutMs);

    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
    child.send({ type: "ronggang.shutdown.v1" }, (error) => {
      if (error) finish(error);
    });
  });
}

export async function waitForHttpJson(
  url,
  label,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  let latestError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        ...options.request,
        signal: AbortSignal.timeout(2_500),
      });
      const text = await response.text();
      if (response.ok) {
        if (options.parseJson === false) return text;
        return text.length === 0 ? null : JSON.parse(text);
      }
      latestError = `HTTP ${response.status}: ${text.slice(0, 240)}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${label} did not become ready: ${latestError}`);
}

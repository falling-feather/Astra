import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import {
  forkApi,
  pnpmExecutable,
  projectRoot,
  runCommand,
  spawnLogged,
  stopApiGracefully,
  terminateProcessTree,
  waitForHttpJson,
} from "./lib/release-process.mjs";
import { assertRuntimePrerequisites } from "./check-runtime-prerequisites.mjs";

try {
  process.loadEnvFile(resolve(projectRoot, ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const args = new Set(process.argv.slice(2));
const smoke = args.has("--smoke");
const freshData = args.has("--fresh-data");
const reuseData = args.has("--reuse-data") || (!freshData && process.env.DEMO_REUSE_DATA === "1");
if (reuseData && freshData) {
  throw new Error("--reuse-data 与 --fresh-data 不能同时使用");
}
if (smoke && freshData) {
  throw new Error("--smoke 已使用临时数据，不能再指定 --fresh-data");
}
const openBrowser = process.env.DEMO_OPEN_BROWSER === "1";
const openRole = process.env.DEMO_OPEN_ROLE?.trim() || "student";
if (!new Set(["student", "teacher"]).has(openRole)) {
  throw new Error(`DEMO_OPEN_ROLE 无效：${openRole}`);
}
const demoModelProvider = process.env.DEMO_MODEL_PROVIDER?.trim()
  || process.env.MODEL_PROVIDER?.trim()
  || "deterministic";
const host = process.env.DEMO_HOST ?? "127.0.0.1";
const apiPort = Number(process.env.DEMO_API_PORT ?? 3001);
const webPort = Number(process.env.DEMO_WEB_PORT ?? 4173);
for (const [label, value] of [["API", apiPort], ["Web", webPort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${label} 端口无效：${value}`);
  }
}
const apiOrigin = `http://${host}:${apiPort}`;
const webOrigin = `http://${host}:${webPort}`;
const expectedVersion = String(JSON.parse(await readFile(
  resolve(projectRoot, "package.json"),
  "utf8",
)).version);
let ownedDataDir = null;
const smokeRoot = resolve(projectRoot, ".local", "smoke-runs");
if (smoke) await mkdir(smokeRoot, { recursive: true });
const dataDir = smoke
  ? (ownedDataDir = await mkdtemp(join(smokeRoot, "run-")))
  : freshData
    ? resolve(
          projectRoot,
          ".local", "fresh-runs", `${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}`,
        )
    : process.env.DEMO_DATA_DIR
      ? resolve(process.env.DEMO_DATA_DIR)
      : resolve(projectRoot, ".local", "data");
const children = new Set();
let closing = null;

if (!smoke && !reuseData) {
  try {
    const info = await lstat(dataDir);
    if (!info.isDirectory() || (await readdir(dataDir)).length > 0) {
      throw new Error(
        `演示数据目录已存在或非空：${dataDir}；确认复用时显式设置 DEMO_REUSE_DATA=1`,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function roleUrls(origin) {
  return {
    student: `${origin}/`,
    teacher: `${origin}/login?role=teacher`,
  };
}

function openExternalBrowser(url) {
  const command = process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => {
    process.stderr.write(`[demo] 无法自动打开浏览器：${error.message}\n`);
  });
  child.unref();
}

async function cleanupOwnedData() {
  if (!ownedDataDir) return;
  const target = ownedDataDir;
  ownedDataDir = null;
  await rm(target, { recursive: true, force: true });
  await unlink(resolve(
    dirname(target),
    `.${basename(target)}.ronggang-runtime.lock`,
  )).catch(() => undefined);
}

async function shutdown(exitCode = 0) {
  if (closing) return closing;
  closing = (async () => {
    const active = [...children];
    const api = active.find((child) => child.channel);
    const others = active.filter((child) => child !== api);
    await Promise.allSettled(others.map((child) => terminateProcessTree(child)));
    if (api) await stopApiGracefully(api);
    await cleanupOwnedData();
    return exitCode;
  })();
  return closing;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    void shutdown().then((exitCode) => {
      process.exitCode = exitCode;
    });
  });
}

await assertRuntimePrerequisites();
if (process.env.DEMO_SKIP_BUILD !== "1") {
  await runCommand(pnpmExecutable, ["build"], {
    cwd: projectRoot,
    label: "production build",
  });
}

const api = forkApi(resolve(projectRoot, "apps/api/dist/main.js"), {
  cwd: projectRoot,
  env: {
    NODE_ENV: "production",
    HOST: host,
    PORT: String(apiPort),
    DATA_DIR: dataDir,
    MODEL_PROVIDER: demoModelProvider,
    MODEL_PROFILE_ID: process.env.MODEL_PROFILE_ID?.trim() || "showcase-demo",
    MODEL_TIMEOUT_MS: process.env.MODEL_TIMEOUT_MS?.trim() || "20000",
    MODEL_MAX_RETRIES: process.env.MODEL_MAX_RETRIES?.trim() || "1",
    SHOWCASE_DETERMINISTIC_STRUCTURED:
      process.env.SHOWCASE_DETERMINISTIC_STRUCTURED?.trim()
      || "0",
    ...(demoModelProvider === "deepseek" ? {
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    } : {}),
    IFLYTEK_MODE: process.env.IFLYTEK_MODE?.trim() || "mock",
    DEEPSEEK_LIVE_SMOKE: "0",
    STARTUP_RECOVERY_MODE: "blocking",
    WEB_ALLOWED_ORIGINS: [...new Set([...(process.env.WEB_ALLOWED_ORIGINS ?? "").split(",").map(value=>value.trim()).filter(Boolean),webOrigin])].join(","),
  },
});
children.add(api);
api.once("exit", () => children.delete(api));

try {
  const health = await waitForHttpJson(
    `${apiOrigin}/health`,
    "production API",
  );
  if (health?.version !== expectedVersion) {
    throw new Error(
      `API 版本不一致：期待 ${expectedVersion}，实际 ${health?.version ?? "missing"}`,
    );
  }

  const web = spawnLogged(pnpmExecutable, [
    "--filter",
    "@ronggang/web",
    "preview",
    "--host",
    host,
    "--port",
    String(webPort),
    "--strictPort",
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      VITE_API_PROXY_TARGET: apiOrigin,
    },
  });
  children.add(web);
  web.once("exit", () => children.delete(web));
  await waitForHttpJson(webOrigin, "production Web preview", {
    parseJson: false,
  });
  const proxiedHealth = await waitForHttpJson(
    `${webOrigin}/health`,
    "preview-proxied API health",
  );
  if (proxiedHealth?.version !== expectedVersion) {
    throw new Error("Web preview 没有代理到当前演示 API");
  }

  const profiles = await waitForHttpJson(
    `${webOrigin}/api/auth/demo-profiles`,
    "preview-proxied demo profiles",
  );
  const profileById = new Map(
    (profiles?.profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const operator = profileById.get("operator-demo");
  const teacherA = profileById.get("teacher-class-a");
  const teacherB = profileById.get("teacher-class-b");
  if (!operator || !teacherA || !teacherB) {
    throw new Error("演示身份目录缺少操作员或 A/B 班教师");
  }
  const sessionIds = [teacherA.defaultSessionId, teacherB.defaultSessionId];
  if (
    sessionIds.some((sessionId) => !sessionId)
    || new Set(sessionIds).size !== 2
    || !teacherA.authorizedSessionIds?.includes(teacherA.defaultSessionId)
    || !teacherB.authorizedSessionIds?.includes(teacherB.defaultSessionId)
    || !operator.authorizedSessionIds?.includes(operator.defaultSessionId)
  ) {
    throw new Error("演示身份目录未形成相互隔离的 A/B 授权会话");
  }
  const login = await waitForHttpJson(
    `${webOrigin}/api/auth/demo-session`,
    "preview-proxied demo login",
    {
      request: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: webOrigin,
        },
        body: JSON.stringify({
          profileId: "operator-demo",
          sessionId: operator.defaultSessionId,
        }),
      },
    },
  );
  if (!Array.isArray(login?.bindings) || login.bindings.length < 3) {
    throw new Error("生产演示栈没有签发完整师生岗位绑定");
  }

  const entryUrls = roleUrls(webOrigin);

  process.stdout.write(`${JSON.stringify({
    schema: "ronggang.demo-stack.v1",
    status: smoke ? "smoke_verified" : "ready",
    version: health.version,
    apiOrigin,
    webOrigin,
    dataDir,
    authorizedSessionIds: sessionIds,
    bindingCount: login.bindings.length,
    previewProxyVerified: true,
    entryUrls,
  }, null, 2)}\n`);

  if (smoke) {
    process.exitCode = await shutdown();
  } else {
    process.stdout.write(
      [
        "体验入口：",
        `  学生：${entryUrls.student}`,
        `  教师：${entryUrls.teacher}`,
        "演示栈保持运行；输入 stop 回车，或按 Ctrl+C 停止。",
        "",
      ].join("\n"),
    );
    if (openBrowser) openExternalBrowser(entryUrls[openRole]);
    const stopFromInput = (chunk) => {
      if (String(chunk).trim().toLowerCase() === "stop") {
        process.stdin.pause();
        void shutdown().then(code => { process.exitCode = code; });
      }
    };
    process.stdin.on("data", stopFromInput);
    await Promise.race([
      new Promise((resolvePromise) => api.once("exit", resolvePromise)),
      new Promise((resolvePromise) => web.once("exit", resolvePromise)),
      new Promise((resolvePromise) => {
        closing?.then(resolvePromise);
      }),
    ]);
    process.stdin.off("data", stopFromInput);
    process.stdin.destroy();
    process.exitCode = await (closing ?? shutdown(1));
  }
} catch (error) {
  await shutdown(1);
  throw error;
}

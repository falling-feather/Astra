import {
  existsSync,
  readdirSync,
} from "node:fs";
import {
  homedir,
  tmpdir,
} from "node:os";
import { join } from "node:path";
import {
  chromium,
  defineConfig,
  devices,
} from "@playwright/test";

const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:5173";
const artifactRoot = process.env.E2E_ARTIFACT_DIR
  ?? join(tmpdir(), "ronggang-playwright");

function browserCacheRoot(): string {
  if (
    process.env.PLAYWRIGHT_BROWSERS_PATH
    && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
  ) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === "win32") {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  }
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "ms-playwright")
    : join(homedir(), ".cache", "ms-playwright");
}

function findLocalChromiumFallback(): string | undefined {
  const configured = process.env.E2E_CHROMIUM_EXECUTABLE;
  if (configured) return configured;
  if (existsSync(chromium.executablePath()) || process.env.CI) return undefined;

  const cacheRoot = browserCacheRoot();
  if (!existsSync(cacheRoot)) return undefined;
  const revisions = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
    .sort((left, right) => (
      Number(right.name.slice("chromium-".length))
      - Number(left.name.slice("chromium-".length))
    ));
  const executableSuffixes = process.platform === "win32"
    ? [
        ["chrome-win64", "chrome.exe"],
        ["chrome-win", "chrome.exe"],
      ]
    : process.platform === "darwin"
      ? [
          ["chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"],
          ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
        ]
      : [
          ["chrome-linux64", "chrome"],
          ["chrome-linux", "chrome"],
        ];

  for (const revision of revisions) {
    for (const suffix of executableSuffixes) {
      const candidate = join(cacheRoot, revision.name, ...suffix);
      if (existsSync(candidate)) {
        process.stderr.write(
          `[e2e] exact Chromium is absent; using installed fallback ${revision.name}\n`,
        );
        return candidate;
      }
    }
  }
  return undefined;
}

const chromiumExecutablePath = findLocalChromiumFallback();
const e2eRunId = process.env.E2E_RUN_ID
  ?? `${process.pid}-${Date.now()}`;
process.env.E2E_RUN_ID = e2eRunId;
const webServerEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);

export default defineConfig({
  testDir: "./e2e",
  // Static tour assets need a separate server and must not hit the dynamic API stack.
  testIgnore: "**/public-demo.spec.ts",
  globalTeardown: "./e2e/global-teardown.mjs",
  outputDir: join(artifactRoot, "test-results"),
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  forbidOnly: Boolean(process.env.CI),
  // Keep failures visible; each run owns a fresh data directory.
  retries: 0,
  reporter: [
    ["line"],
    ["html", {
      open: "never",
      outputFolder: join(artifactRoot, "html-report"),
    }],
  ],
  use: {
    baseURL: webOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : undefined,
      },
    },
  ],
  webServer: {
    command: "node e2e/start-test-stack.mjs",
    url: webOrigin,
    timeout: 240_000,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    env: {
      ...webServerEnv,
      E2E_RUN_ID: e2eRunId,
    },
  },
});

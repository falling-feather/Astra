import { createApp } from "./server.js";
import { loadLocalEnvironment } from "./load-local-env.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnvironment();
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const appPromise = createApp({
  logger: true,
  awaitStartupRecovery: process.env.STARTUP_RECOVERY_MODE === "blocking",
  dataDir: resolve(repositoryRoot, process.env.DATA_DIR ?? ".local/data"),
});

let requestedSignal: NodeJS.Signals | null = null;
let shutdownPromise: Promise<void> | null = null;
function shutdown(signal: NodeJS.Signals): Promise<void> {
  requestedSignal ??= signal;
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const app = await appPromise;
    app.log.info({ signal }, "closing API and releasing data-directory lease");
    await app.close();
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

process.once("message", (message: unknown) => {
  if (
    !message
    || typeof message !== "object"
    || (message as { type?: unknown }).type !== "ronggang.shutdown.v1"
  ) {
    return;
  }
  void shutdown("SIGTERM").then(() => {
    process.send?.({ type: "ronggang.shutdown-complete.v1" });
    process.disconnect?.();
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
    process.disconnect?.();
  });
});

let app: Awaited<typeof appPromise> | null = null;
try {
  app = await appPromise;
  if (requestedSignal) {
    await shutdown(requestedSignal);
  } else {
    await app.listen({ port, host });
  }
} catch (error) {
  if (app) {
    app.log.error(error);
    await app.close().catch((closeError) => app?.log.error(closeError));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}

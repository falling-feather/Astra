import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFastEmbedProvider } from "../src/embeddings.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workerFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ronggang-embedding-concurrency-"));
  temporaryDirectories.push(directory);
  const workerPath = join(directory, "worker.mjs");
  await writeFile(workerPath, `
import { appendFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input);
const label = payload.texts[0];
const lock = join(payload.cacheDir, 'active');
const events = join(payload.cacheDir, 'events');
try { mkdirSync(lock); }
catch { console.log(JSON.stringify({ok:false,error:{message:'concurrent model workers'}})); process.exit(1); }
appendFileSync(events, 'start:' + label + '\\n');
await new Promise(resolve => setTimeout(resolve, 120));
appendFileSync(events, 'end:' + label + '\\n');
rmdirSync(lock);
if (label === 'fail') {
  console.log(JSON.stringify({ok:false,error:{message:'expected worker failure'}}));
  process.exit(1);
}
console.log(JSON.stringify({ok:true,modelVersion:payload.modelVersion,dimension:2,vectors:payload.texts.map(text => [text.length, 1])}));
`, "utf8");
  return {
    directory,
    provider: new LocalFastEmbedProvider({ pythonExecutable: process.execPath, workerPath, modelDir: directory }),
  };
}

describe("local embedding worker concurrency", () => {
  it("queues overlapping document and query work instead of loading two model processes", async () => {
    const { provider, directory } = await workerFixture();
    const [documents, query] = await Promise.allSettled([
      provider.embedDocuments(["documents", "second"]),
      provider.embedQuery("query"),
    ]);
    expect(documents.status).toBe("fulfilled");
    expect(query.status).toBe("fulfilled");
    if (documents.status === "fulfilled") expect(documents.value.vectors).toEqual([[9, 1], [6, 1]]);
    if (query.status === "fulfilled") expect(query.value.vector).toEqual([5, 1]);
    expect(await readFile(join(directory, "events"), "utf8")).toBe("start:documents\nend:documents\nstart:query\nend:query\n");
  });

  it("reports a failed worker while still running the next queued query", async () => {
    const { provider } = await workerFixture();
    const [failed, next] = await Promise.allSettled([provider.embedQuery("fail"), provider.embedQuery("next")]);
    expect(failed.status).toBe("rejected");
    if (failed.status === "rejected") expect(failed.reason.message).toBe("expected worker failure");
    expect(next.status).toBe("fulfilled");
    if (next.status === "fulfilled") expect(next.value.vector).toEqual([4, 1]);
  });
});

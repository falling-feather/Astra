import {
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";
import {
  captureCommand,
  pnpmExecutable,
  projectRoot,
  runCommand,
} from "./lib/release-process.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const allowDirty = args.includes("--allow-dirty");
const requireTag = args.includes("--require-tag");
if (allowDirty && requireTag) {
  throw new Error("--allow-dirty 不能与 --require-tag 同时使用");
}
const requireClean = !allowDirty;
const receiptPath = resolve(
  projectRoot,
  ".release-audit",
  "release-check.json",
);

await rm(receiptPath, { force: true });
await runCommand(pnpmExecutable, ["check"], {
  cwd: projectRoot,
  label: "full release gate",
});

const auditArgs = ["scripts/release-audit.mjs"];
if (requireClean) auditArgs.push("--require-clean");
if (requireTag) auditArgs.push("--require-tag");
auditArgs.push("--require-receipts");
const audit = JSON.parse((await captureCommand(
  process.execPath,
  auditArgs,
  {
    cwd: projectRoot,
    label: "release audit",
  },
)).stdout);

const receipt = {
  schema: "ronggang.release-check.v1",
  checkedAt: new Date().toISOString(),
  status: requireTag ? "verified" : "candidate_verified",
  command: "pnpm check",
  policy: {
    cleanRequired: requireClean,
    annotatedTagRequired: requireTag,
  },
  audit,
};
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(
  receiptPath,
  `${JSON.stringify(receipt, null, 2)}\n`,
  {
    encoding: "utf8",
    mode: 0o600,
  },
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

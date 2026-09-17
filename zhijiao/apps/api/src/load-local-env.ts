import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export function loadLocalEnvironment(cwd = process.cwd()): string | null {
  const candidates = [
    resolve(cwd, ".env.local"),
    resolve(cwd, "../../.env.local"),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (!selected) return null;
  loadEnvFile(selected);
  return selected;
}

import { createHash } from "node:crypto";
import {
  ScenarioPackageSchema,
  type ScenarioPackage,
} from "@ronggang/contracts";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function hashScenarioPackage(rawPackage: ScenarioPackage): string {
  return hashCanonical(ScenarioPackageSchema.parse(rawPackage));
}

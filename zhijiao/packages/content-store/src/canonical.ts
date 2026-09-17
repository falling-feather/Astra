import { createHash } from "node:crypto";

function canonicalize(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Hash input contains a non-finite number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString("hex"));
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => {
        const nested = record[key];
        if (nested === undefined) throw new TypeError(`Hash input contains undefined at ${path}.${key}`);
        return `${JSON.stringify(key)}:${canonicalize(nested, `${path}.${key}`)}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`Hash input contains unsupported ${typeof value} at ${path}`);
}

export function canonicalStringify(value: unknown): string {
  return canonicalize(value, "$" );
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix: string, ...parts: readonly unknown[]): string {
  return `${prefix}-${hashCanonical(parts).slice(0, 32)}`;
}

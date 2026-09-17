import { createHash } from "node:crypto";
import type {
  CourseContentRelease,
  CourseContentReleaseDraft,
  KnowledgeRecord,
  KnowledgeRecordDraft,
} from "./types.js";

function canonicalStringifyInternal(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`规范化哈希不接受非有限数值：${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => (
      canonicalStringifyInternal(item, `${path}[${index}]`)
    )).join(",")}]`;
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => {
        const nested = objectValue[key];
        if (nested === undefined) {
          throw new TypeError(`规范化哈希不接受 undefined：${path}.${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalStringifyInternal(nested, `${path}.${key}`)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`规范化哈希不支持 ${typeof value}：${path}`);
}

export function canonicalStringify(value: unknown): string {
  return canonicalStringifyInternal(value, "$");
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function createKnowledgeRecord(
  draft: KnowledgeRecordDraft,
): Readonly<KnowledgeRecord> {
  return deepFreeze({
    ...draft,
    contentHash: hashCanonical(draft),
  });
}

export function hashKnowledgeRecord(record: KnowledgeRecord): string {
  const { contentHash: _contentHash, ...draft } = record;
  return hashCanonical(draft);
}

export function createCourseContentRelease(
  draft: CourseContentReleaseDraft,
): Readonly<CourseContentRelease> {
  const contentHash = hashCanonical(draft);
  return deepFreeze({
    ...draft,
    releaseRef: {
      ...draft.releaseRef,
      contentHash,
    },
  });
}

export function hashCourseContentRelease(release: CourseContentRelease): string {
  const { contentHash: _contentHash, ...releaseRef } = release.releaseRef;
  return hashCanonical({ ...release, releaseRef });
}

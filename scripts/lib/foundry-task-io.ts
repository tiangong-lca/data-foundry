import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import type { JsonRecord, FileReference } from "./foundry-task-types.ts";
export const shaPattern = /^[0-9a-f]{64}$/u;
export const maxDocumentBytes = 8 * 1024 * 1024;
export const maxIndexBytes = 64 * 1024 * 1024;

export function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
export function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("task_document_invalid", "Task document must be a JSON object.");
  return value as JsonRecord;
}
export function exact(value: JsonRecord, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("task_document_invalid", "Task document has missing or unsupported fields.");
}
export function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
export function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function taskPath(context: FoundryRuntimeContext, relative: string): string {
  return resolveFoundryOutput(context, relative);
}
export function relative(context: FoundryRuntimeContext, file: string): string {
  return path.relative(context.taskRoot!, taskPath(context, file)).split(path.sep).join("/");
}
export function readTaskBytes(
  context: FoundryRuntimeContext,
  file: string,
  limit = maxDocumentBytes,
): Buffer {
  const target = taskPath(context, file);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    fail("task_document_invalid", "Task metadata must be a bounded regular file.");
  const content = fs.readFileSync(target);
  if (content.length > limit)
    fail("task_document_invalid", "Task metadata changed beyond its limit while reading.");
  return content;
}
export function readTaskJson(context: FoundryRuntimeContext, file: string): JsonRecord {
  try {
    return object(JSON.parse(readTaskBytes(context, file).toString("utf8")));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("task_document_invalid", "Task metadata could not be read as complete JSON.");
  }
}
export function reference(value: unknown, expectedPath?: string): FileReference {
  const ref = object(value);
  exact(ref, ["path", "sha256"]);
  if (
    typeof ref.path !== "string" ||
    !ref.path ||
    path.isAbsolute(ref.path) ||
    ref.path.split(/[\\/]/u).includes("..") ||
    typeof ref.sha256 !== "string" ||
    !shaPattern.test(ref.sha256) ||
    (expectedPath && ref.path !== expectedPath)
  )
    fail(
      "task_reference_invalid",
      "Task metadata references must be exact contained content facts.",
    );
  return { path: ref.path, sha256: ref.sha256 };
}
export function facts(value: unknown): FoundryInputFact[] {
  if (!Array.isArray(value) || value.length > 100_000)
    fail("task_inputs_invalid", "Task input facts must be a bounded array.");
  const result = value.map((item) => {
    const fact = object(item);
    exact(fact, ["path", "bytes", "sha256"]);
    if (
      typeof fact.path !== "string" ||
      !fact.path ||
      typeof fact.bytes !== "number" ||
      !Number.isSafeInteger(fact.bytes) ||
      fact.bytes < 0 ||
      typeof fact.sha256 !== "string" ||
      !shaPattern.test(fact.sha256)
    )
      fail("task_inputs_invalid", "Task file facts require path, size and SHA-256.");
    return { path: fact.path, bytes: fact.bytes, sha256: fact.sha256 };
  });
  if (new Set(result.map((fact) => fact.path)).size !== result.length)
    fail("task_inputs_invalid", "Task file facts must be unique.");
  return result;
}
export function sameFact(left: FoundryInputFact, right: FoundryInputFact): boolean {
  return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

import { fileURLToPath } from "node:url";

export const foundryCiReporterPath = fileURLToPath(import.meta.url);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Node test event.");
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid Node test measurement.");
  return value;
}

/** Preserve runner-owned counters and test identity without serializing errors or test output. */
export default async function* report(source: AsyncIterable<unknown>): AsyncGenerator<string> {
  for await (const item of source) {
    const event = object(item);
    if (!["test:pass", "test:fail", "test:summary"].includes(String(event.type))) continue;
    const data = object(event.data);
    if (event.type === "test:summary") {
      const counts = object(data.counts);
      if (
        typeof data.success !== "boolean" ||
        (data.file !== undefined && typeof data.file !== "string")
      )
        throw new Error("Invalid Node test summary.");
      yield `${JSON.stringify({ type: "summary", file: data.file, success: data.success, duration_ms: number(data.duration_ms), counts: Object.fromEntries(["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites"].map((key) => [key, number(counts[key])])) })}\n`;
    } else {
      const details = object(data.details);
      if (
        typeof data.name !== "string" ||
        (data.file !== undefined && typeof data.file !== "string")
      )
        throw new Error("Invalid Node test identity.");
      yield `${JSON.stringify({ type: "case", name: data.name, file: data.file, nesting: number(data.nesting), passed: event.type === "test:pass", skipped: Boolean(data.skip), todo: Boolean(data.todo), kind: details.type, duration_ms: number(details.duration_ms) })}\n`;
    }
  }
}
